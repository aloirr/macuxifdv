/**
 * Alertas do gestor (RF-GES-07, P1) por regra parametrizável (`alerta_regra`).
 *  - `avaliarAlertas` gera as CONDIÇÕES que valem agora (sem estado), só para regras ligadas e módulos ativos;
 *  - `reconciliarAlertas` compara com os alertas já gravados e devolve o que abrir, atualizar e encerrar:
 *      · deduplicação pela chave `<tipo>:<alvo_id>` (um alerta aberto por chave);
 *      · encerramento AUTOMÁTICO quando a condição deixa de valer (ou a regra/módulo é desligado);
 *      · alerta dispensado pelo gestor não reabre enquanto a condição persiste; se sumir e voltar, abre outro.
 * O "dia" é a data civil no fuso do tenant. Funções puras e idempotentes.
 */
import type { ParametrosAlertasProdutividade } from '@macuxi/core/contracts';
import { diffDays } from '@macuxi/comum';
import { RegraAlerta, TIPOS_ALERTA, TIPOS_ALERTA_PRODUTIVIDADE, type CondicaoAlerta, type FrequenciaVisita, type MembroEquipe, type MotivoEncerramento, type Severidade, type StatusAlerta, type TipoAlerta } from '../contracts';
import { nivelDaFilaDoGestor, pedidoPendenteDeAprovacao, situacaoDoPrazo } from './aprovacoes';
import { situacaoDaRota } from './agora';
import { ehDiaUtil, horasUteisEntre, instanteDoHorarioLocal } from './horario-comercial';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { arredondar, instanteMs, percentual, textoDoMinuto } from './numeros';
import { atendida, diaLocal, diasUteisDoMes, painelDoMes, statusDoDia } from './painel';
import { resolverParametros, type ParametrosGestor } from './parametros';
import { carteiraPendente, entradaNaCarteira, type EstadoProjecao } from './projecao';

/** Regra padrão de cada tipo (valores entre colchetes do doc 02/03 e premissas da T-0014, em regras.md). */
export const REGRAS_PADRAO: Readonly<Record<TipoAlerta, RegraAlerta>> = Object.freeze({
  // RN-GES-01/02: o limite é do CLIENTE (frequência × tolerância) e a carência do cliente novo, ambos parâmetros do
  // tenant (`pct_tolerancia_frequencia`, `dias_sem_visita_padrao`, `dias_carencia_cliente_novo`); a regra só liga/desliga
  cliente_sem_visita: { tipo: 'cliente_sem_visita', ativa: true, limiar: null, janela_dias: null, amostra_min: null, severidade: 'atencao' },
  // limiar = % do ritmo esperado; amostra_min = dias úteis decorridos mínimos
  ritmo_abaixo_meta: { tipo: 'ritmo_abaixo_meta', ativa: true, limiar: 80, janela_dias: null, amostra_min: 3, severidade: 'atencao' },
  // sem limiar próprio: o prazo vem de `prazo_aprovacao_dias_uteis` do tenant (RN-GES-03, o mesmo da fila de aprovação)
  pedido_aguardando_aprovacao: { tipo: 'pedido_aguardando_aprovacao', ativa: true, limiar: null, janela_dias: null, amostra_min: null, severidade: 'critica' },
  // limiar = nº de visitas da loja com ruptura dentro da janela
  ruptura_recorrente: { tipo: 'ruptura_recorrente', ativa: true, limiar: 3, janela_dias: 14, amostra_min: null, severidade: 'atencao' },
  // limite vem de `permanencia_min_min` (RN-PRO-07), parâmetro único do tenant
  visita_curta: { tipo: 'visita_curta', ativa: true, limiar: null, janela_dias: 3, amostra_min: null, severidade: 'info' },
  // limiar = % máximo de fotos sem GPS; amostra_min = nº mínimo de fotos
  fotos_sem_gps: { tipo: 'fotos_sem_gps', ativa: true, limiar: 20, janela_dias: 7, amostra_min: 10, severidade: 'atencao' },
  // T-0180 / D4: sem campos próprios; o liga/desliga e o destino Gestor vêm do parâmetro de produtividade do core (`tiposAtivos`)
  parado_entre_visitas: { tipo: 'parado_entre_visitas', ativa: true, limiar: null, janela_dias: null, amostra_min: null, severidade: 'atencao' },
  sem_checkin_inicio: { tipo: 'sem_checkin_inicio', ativa: true, limiar: null, janela_dias: null, amostra_min: null, severidade: 'atencao' },
});

export type RegrasAlerta = Record<TipoAlerta, RegraAlerta>;

/** Módulo de origem dos dados de cada regra (`core` = sempre ativo). */
export const MODULO_DO_ALERTA: Readonly<Record<TipoAlerta, 'core' | 'vendedor' | 'promotor'>> = {
  cliente_sem_visita: 'core',
  ritmo_abaixo_meta: 'vendedor',
  pedido_aguardando_aprovacao: 'vendedor',
  ruptura_recorrente: 'promotor',
  visita_curta: 'promotor',
  fotos_sem_gps: 'promotor',
  parado_entre_visitas: 'core',
  sem_checkin_inicio: 'core',
};

/** Mistura os ajustes do tenant (parciais por tipo) com os padrões e valida cada regra. */
export function resolverRegras(ajustes: Partial<Record<TipoAlerta, Partial<RegraAlerta>>> = {}): RegrasAlerta {
  const out = {} as RegrasAlerta;
  for (const tipo of TIPOS_ALERTA) {
    const r = RegraAlerta.safeParse({ ...REGRAS_PADRAO[tipo], ...(ajustes[tipo] ?? {}), tipo });
    if (!r.success) {
      const i = r.error.issues[0]!;
      throw new RangeError(`Regra de alerta ${tipo} inválida em "${i.path.join('.')}": ${i.message}`);
    }
    if (tipo === 'cliente_sem_visita' && r.data.limiar !== null) {
      throw new RangeError(
        'Regra de alerta cliente_sem_visita: o limite vem da frequência de visita do cliente (RN-GES-01). Ajuste pct_tolerancia_frequencia, dias_sem_visita_padrao ou dias_carencia_cliente_novo nos parâmetros do tenant.',
      );
    }
    if (tipo === 'pedido_aguardando_aprovacao' && r.data.limiar !== null) {
      throw new RangeError(
        'Regra de alerta pedido_aguardando_aprovacao: o prazo vem do parâmetro do tenant prazo_aprovacao_dias_uteis (RN-GES-03), o mesmo da fila de aprovação; a regra só liga ou desliga.',
      );
    }
    out[tipo] = r.data;
  }
  return out;
}

/** RN-GES-01: frequência de visita do cliente em dias. */
export const FREQUENCIA_EM_DIAS: Readonly<Record<FrequenciaVisita, number>> = Object.freeze({ semanal: 7, quinzenal: 14, mensal: 30 });

/**
 * RN-GES-01: dias sem visita tolerados para o cliente = ⌊frequência × (1 + pct_tolerancia_frequencia ÷ 100)⌋
 * (semanal 10, quinzenal 21, mensal 45 com 50%); sem frequência = `dias_sem_visita_padrao` (30). Alerta quando PASSA do limite.
 */
export function limiteDiasSemVisita(frequencia: FrequenciaVisita | null | undefined, params: Pick<ParametrosGestor, 'pct_tolerancia_frequencia' | 'dias_sem_visita_padrao'>): number {
  if (!frequencia) return params.dias_sem_visita_padrao;
  return Math.floor(arredondar(FREQUENCIA_EM_DIAS[frequencia] * (1 + params.pct_tolerancia_frequencia / 100), 6));
}

/** T-0180 / D4: tipo de produtividade (liga/desliga e destino Gestor vêm do parâmetro do core, não de `alerta_regra`). */
export const ehTipoProdutividade = (t: TipoAlerta): t is (typeof TIPOS_ALERTA_PRODUTIVIDADE)[number] => (TIPOS_ALERTA_PRODUTIVIDADE as readonly string[]).includes(t);

/**
 * Tipos que valem agora: regra ligada E módulo de origem ativo (RN-CORE-03). Os de produtividade (D4) valem com a regra E o
 * destino Gestor ligados no parâmetro do core; sem o parâmetro (`produtividade` ausente) não valem.
 */
export function tiposAtivos(regras: RegrasAlerta, modulos: ReadonlySet<string>, produtividade?: ParametrosAlertasProdutividade): Set<TipoAlerta> {
  return new Set(
    TIPOS_ALERTA.filter((t) => {
      if (!(MODULO_DO_ALERTA[t] === 'core' || modulos.has(MODULO_DO_ALERTA[t]))) return false;
      if (!ehTipoProdutividade(t)) return regras[t].ativa;
      const r = produtividade?.[t];
      return r !== undefined && r.ativa && r.gestor;
    }),
  );
}

export interface EntradaAvaliacao {
  estado: EstadoProjecao;
  /** Cadastro de usuários (Core): vendedor inativo não gera alerta. */
  membros: readonly MembroEquipe[];
  /** Instante UTC da avaliação. */
  agora: string;
  modulos: ReadonlySet<string>;
  regras: RegrasAlerta;
  params?: Partial<ParametrosGestor>;
  /** T-0180 / D4: parâmetro `alertas.produtividade` do Core (`core.produtividade_equipe@1`); sem ele os alertas de produtividade não são avaliados. */
  produtividade?: ParametrosAlertasProdutividade;
  /**
   * T-0180 / ADR 0059 §5: último contato do aparelho de cada usuário (UTC; `core.produtividade_equipe@1`). O alerta de produtividade
   * só abre com contato POSTERIOR ao início da parada (não acusa quem trabalhou sem sinal e ainda não sincronizou); sem contato, não abre.
   */
  ultimo_contato_em?: Readonly<Record<string, string | null>>;
}

const chaveDe = (tipo: TipoAlerta, alvo: string) => `${tipo}:${alvo}`;
/** D4 / ADR 0059 §7: os dois tipos de produtividade dividem a chave, para haver um alerta vivo por pessoa (o mais novo substitui). */
const chaveProdutividade = (usuarioId: string) => `produtividade:${usuarioId}`;
const naJanela = (dia: string, hoje: string, janela: number) => dia >= somarDiasCivis(hoje, -(janela - 1)) && dia <= hoje;

/** Condições de alerta que valem em `agora`, ordenadas por chave (resultado estável). */
export function avaliarAlertas(e: EntradaAvaliacao): CondicaoAlerta[] {
  const params = resolverParametros(e.params);
  const ativos = tiposAtivos(e.regras, e.modulos, e.produtividade);
  const hoje = diaLocal(e.agora, params.fuso);
  const out: CondicaoAlerta[] = [];
  const ativoNoCadastro = (id: string | null): boolean => {
    if (!id) return false;
    const m = e.membros.find((x) => x.id === id);
    return !m || m.ativo; // fora do cadastro: não bloqueia (o cadastro pode estar defasado)
  };

  // --- RN-GES-01/02: cliente da carteira sem visita além do limite do cliente; nunca visitado só depois da carência ---
  if (ativos.has('cliente_sem_visita')) {
    const r = e.regras.cliente_sem_visita;
    const ultima = new Map<string, string>(); // cliente → último dia com check-in (qualquer usuário)
    for (const v of Object.values(e.estado.visitas)) {
      if (!v.checkin) continue;
      const dia = diaLocal(v.checkin.checkin_em, params.fuso);
      if (!ultima.has(v.checkin.cliente_id) || dia > ultima.get(v.checkin.cliente_id)!) ultima.set(v.checkin.cliente_id, dia);
    }
    for (const [clienteId, c] of Object.entries(e.estado.clientes)) {
      // T-0046: carteira pendente (evento sem o dono, mais novo) não alerta; vira aviso em `situacaoDaCarteira`
      if (!c.ativo || !ativoNoCadastro(c.vendedor_id) || carteiraPendente(e.estado, clienteId)) continue;
      const nome = c.nome ?? 'Cliente';
      const dia = ultima.get(clienteId);
      let valor: number | null;
      let limiar: number;
      let mensagem: string;
      if (dia) {
        valor = diffDays(dia, hoje);
        limiar = limiteDiasSemVisita(c.frequencia_visita, params);
        if (valor <= limiar) continue;
        const freq = c.frequencia_visita ? `frequência ${c.frequencia_visita}` : 'sem frequência definida';
        mensagem = `${nome} está sem visita há ${valor} dias (${freq}, limite ${limiar}).`;
      } else {
        const desde = entradaNaCarteira(e.estado, clienteId);
        const naCarteira = desde ? diffDays(diaLocal(desde, params.fuso), hoje) : null;
        limiar = params.dias_carencia_cliente_novo;
        if (naCarteira === null || naCarteira <= limiar) continue; // RN-GES-02: só alerta ao PASSAR da carência
        valor = null;
        mensagem = `${nome} nunca foi visitado (${naCarteira} dias na carteira; carência ${limiar}).`;
      }
      out.push({
        chave: chaveDe('cliente_sem_visita', clienteId),
        tipo: 'cliente_sem_visita',
        alvo_tipo: 'cliente',
        alvo_id: clienteId,
        responsavel_id: c.vendedor_id,
        valor,
        limiar,
        severidade: r.severidade,
        mensagem,
      });
    }
  }

  // --- ritmo abaixo da meta ---
  if (ativos.has('ritmo_abaixo_meta')) {
    const r = e.regras.ritmo_abaixo_meta;
    const decorridos = diasUteisDoMes(hoje.slice(0, 7), hoje, params).elapsed;
    if (decorridos >= (r.amostra_min ?? 0)) {
      for (const m of e.membros) {
        if (m.perfil !== 'vendedor' || !m.ativo) continue;
        const ritmo = painelDoMes(e.estado, m.id, hoje, params).ritmo_pct;
        if (ritmo === null || ritmo >= r.limiar!) continue;
        out.push({
          chave: chaveDe('ritmo_abaixo_meta', m.id),
          tipo: 'ritmo_abaixo_meta',
          alvo_tipo: 'usuario',
          alvo_id: m.id,
          responsavel_id: m.id,
          valor: ritmo,
          limiar: r.limiar,
          severidade: r.severidade,
          mensagem: `${m.nome} está com ${ritmo}% do ritmo esperado da meta (mínimo ${r.limiar}%).`,
        });
      }
    }
  }

  // --- RN-GES-03: pedido aguardando aprovação depois de PASSAR do prazo em dias úteis (o mesmo prazo da fila) ---
  if (ativos.has('pedido_aguardando_aprovacao')) {
    const r = e.regras.pedido_aguardando_aprovacao;
    for (const [pedidoId, a] of Object.entries(e.estado.aprovacoes)) {
      // RN-GES-03 / RF-VEN-09: mesmo filtro da fila (nível analista é da fila do BKO do Vendedor, não da equipe)
      if (!nivelDaFilaDoGestor(a.nivel) || !pedidoPendenteDeAprovacao(e.estado, pedidoId)) continue;
      const prazo = situacaoDoPrazo(a.solicitada_em, e.agora, params);
      if (prazo.situacao !== 'vencido') continue;
      const horas = horasUteisEntre(a.solicitada_em, e.agora, params);
      const horasDoPrazo = horasUteisEntre(a.solicitada_em, prazo.prazo_em, params);
      const dias = params.prazo_aprovacao_dias_uteis;
      out.push({
        chave: chaveDe('pedido_aguardando_aprovacao', pedidoId),
        tipo: 'pedido_aguardando_aprovacao',
        alvo_tipo: 'pedido',
        alvo_id: pedidoId,
        responsavel_id: a.vendedor_id,
        valor: horas,
        limiar: horasDoPrazo,
        severidade: r.severidade,
        mensagem: `Pedido aguardando aprovação além do prazo de ${dias} ${dias === 1 ? 'dia útil' : 'dias úteis'} (${horas} horas úteis de espera).`,
      });
    }
  }

  // --- trade: só com Promotor ativo; visitas abaixo da permanência mínima não contam nas rupturas (RN-PRO-07) ---
  const lojas = Object.values(e.estado.visitas_loja);

  if (ativos.has('ruptura_recorrente')) {
    const r = e.regras.ruptura_recorrente;
    const janela = r.janela_dias ?? 14;
    const valida = new Set(lojas.filter((l) => atendida(l) && l.permanencia_min >= params.permanencia_min_min).map((l) => l.visita_loja_id));
    const porLoja = new Map<string, { visitas: Set<string>; promotor: string; ultimo: string }>();
    for (const x of Object.values(e.estado.rupturas)) {
      if (x.status === 'presente' || !valida.has(x.visita_loja_id) || !naJanela(diaLocal(x.registrado_em, params.fuso), hoje, janela)) continue;
      const g = porLoja.get(x.cliente_id) ?? { visitas: new Set<string>(), promotor: x.promotor_id, ultimo: x.registrado_em };
      g.visitas.add(x.visita_loja_id);
      if (x.registrado_em >= g.ultimo) {
        g.ultimo = x.registrado_em;
        g.promotor = x.promotor_id;
      }
      porLoja.set(x.cliente_id, g);
    }
    for (const [clienteId, g] of porLoja) {
      if (g.visitas.size < r.limiar!) continue;
      out.push({
        chave: chaveDe('ruptura_recorrente', clienteId),
        tipo: 'ruptura_recorrente',
        alvo_tipo: 'cliente',
        alvo_id: clienteId,
        responsavel_id: g.promotor,
        valor: g.visitas.size,
        limiar: r.limiar,
        severidade: r.severidade,
        mensagem: `Ruptura em ${g.visitas.size} visitas à loja nos últimos ${janela} dias (limite ${r.limiar}).`,
      });
    }
  }

  if (ativos.has('visita_curta')) {
    const r = e.regras.visita_curta;
    const janela = r.janela_dias ?? 3;
    for (const l of lojas) {
      // RN-CORE-14: cliente fechado (loja_fechada/acesso_negado) é saída rápida legítima, não visita curta
      if (!atendida(l) || l.permanencia_min >= params.permanencia_min_min || !naJanela(diaLocal(l.checkin_em, params.fuso), hoje, janela)) continue;
      out.push({
        chave: chaveDe('visita_curta', l.visita_loja_id),
        tipo: 'visita_curta',
        alvo_tipo: 'visita_loja',
        alvo_id: l.visita_loja_id,
        responsavel_id: l.promotor_id,
        valor: arredondar(l.permanencia_min),
        limiar: params.permanencia_min_min,
        severidade: r.severidade,
        mensagem: `Visita de ${arredondar(l.permanencia_min)} min, abaixo do mínimo de ${params.permanencia_min_min} min.`,
      });
    }
  }

  if (ativos.has('fotos_sem_gps')) {
    const r = e.regras.fotos_sem_gps;
    const janela = r.janela_dias ?? 7;
    const porPromotor = new Map<string, { total: number; sem: number }>();
    for (const l of lojas) {
      if (!naJanela(diaLocal(l.checkin_em, params.fuso), hoje, janela)) continue;
      const g = porPromotor.get(l.promotor_id) ?? { total: 0, sem: 0 };
      g.total += l.fotos_total;
      g.sem += l.fotos_sem_gps;
      porPromotor.set(l.promotor_id, g);
    }
    for (const [promotorId, g] of porPromotor) {
      const pct = percentual(g.sem, g.total);
      if (pct === null || g.total < (r.amostra_min ?? 0) || pct <= r.limiar!) continue;
      out.push({
        chave: chaveDe('fotos_sem_gps', promotorId),
        tipo: 'fotos_sem_gps',
        alvo_tipo: 'usuario',
        alvo_id: promotorId,
        responsavel_id: promotorId,
        valor: pct,
        limiar: r.limiar,
        severidade: r.severidade,
        mensagem: `${pct}% das fotos dos últimos ${janela} dias sem GPS (limite ${r.limiar}%).`,
      });
    }
  }

  // --- T-0180 / D4: produtividade do dia, no escopo do gestor, um alerta aberto por pessoa, sem push (D3) ---
  const horaLocal = (instante: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: params.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instante));
  const agoraMs = instanteMs(e.agora);
  const expediente = ehDiaUtil(hoje, params) && agoraMs >= instanteDoHorarioLocal(hoje, params.horario_comercial.inicio, params.fuso) && agoraMs < instanteDoHorarioLocal(hoje, params.horario_comercial.fim, params.fuso);
  if (e.produtividade && expediente && (ativos.has('parado_entre_visitas') || ativos.has('sem_checkin_inicio'))) {
    const prod = e.produtividade;
    for (const m of e.membros) {
      if ((m.perfil !== 'vendedor' && m.perfil !== 'promotor') || !m.ativo) continue;
      const dia = statusDoDia(e.estado, m.id, hoje, params);
      // RN-CORE-26: parado = sem check-in aberto, paradas pendentes e `parado_min` desde o último checkout; o gestor só vê `gestor_depois_min` depois
      if (ativos.has('parado_entre_visitas') && dia === 'em_rota') {
        const rota = situacaoDaRota(e.estado, m.id, hoje, params.fuso);
        const parado = rota.ultimo_checkout_em ? Math.floor((agoraMs - instanteMs(rota.ultimo_checkout_em)) / 60_000) : null;
        const contato = e.ultimo_contato_em?.[m.id] ?? null;
        const comSinal = rota.ultimo_checkout_em !== null && contato !== null && instanteMs(contato) > instanteMs(rota.ultimo_checkout_em);
        if (rota.paradas_pendentes > 0 && rota.ultimo_checkout_em && comSinal && parado !== null && parado >= params.parado_min + prod.parado_entre_visitas.gestor_depois_min) {
          out.push({
            chave: chaveProdutividade(m.id),
            tipo: 'parado_entre_visitas',
            alvo_tipo: 'usuario',
            alvo_id: m.id,
            responsavel_id: m.id,
            valor: parado,
            limiar: params.parado_min + prod.parado_entre_visitas.gestor_depois_min,
            severidade: e.regras.parado_entre_visitas.severidade,
            mensagem: `${m.nome}: último checkout às ${horaLocal(rota.ultimo_checkout_em)}.`,
          });
          continue; // um alerta de produtividade por pessoa
        }
      }
      const ate = instanteDoHorarioLocal(hoje, textoDoMinuto(prod.sem_checkin_inicio.ate_min), params.fuso);
      const contatoDoDia = e.ultimo_contato_em?.[m.id] ?? null;
      if (ativos.has('sem_checkin_inicio') && dia === 'sem_checkin' && agoraMs >= ate && contatoDoDia !== null && instanteMs(contatoDoDia) > ate) {
        out.push({
          chave: chaveProdutividade(m.id),
          tipo: 'sem_checkin_inicio',
          alvo_tipo: 'usuario',
          alvo_id: m.id,
          responsavel_id: m.id,
          valor: null,
          limiar: null,
          severidade: e.regras.sem_checkin_inicio.severidade,
          mensagem: m.nome,
        });
      }
    }
  }

  return out.sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
}

export interface AlertaExistente {
  id: string;
  chave: string;
  tipo: TipoAlerta;
  status: StatusAlerta;
  valor: number | null;
  mensagem: string;
  severidade: Severidade;
  aberto_em: string;
}

export interface OperacoesAlerta {
  abrir: CondicaoAlerta[];
  atualizar: { id: string; valor: number | null; mensagem: string; severidade: Severidade }[];
  encerrar: { id: string; motivo: MotivoEncerramento; encerrado_em: string }[];
}

/**
 * Compara as condições atuais com os alertas gravados. `tipos_ativos` = `tiposAtivos(regras, modulos)`: alertas de tipo
 * desligado/sem módulo são encerrados (`regra_inativa`). Idempotente: aplicar o resultado e reconciliar de novo dá vazio.
 */
export function reconciliarAlertas(existentes: readonly AlertaExistente[], condicoes: readonly CondicaoAlerta[], o: { agora: string; tipos_ativos: ReadonlySet<TipoAlerta> }): OperacoesAlerta {
  const ops: OperacoesAlerta = { abrir: [], atualizar: [], encerrar: [] };
  const porChave = new Map<string, CondicaoAlerta>();
  for (const c of condicoes) if (!porChave.has(c.chave)) porChave.set(c.chave, c);

  const vivos = new Map<string, AlertaExistente[]>();
  for (const a of existentes) {
    if (a.status === 'encerrado') continue;
    vivos.set(a.chave, [...(vivos.get(a.chave) ?? []), a]);
  }

  const mantidos = new Set<string>();
  for (const [chave, grupo] of vivos) {
    grupo.sort((x, y) => (x.aberto_em < y.aberto_em ? -1 : x.aberto_em > y.aberto_em ? 1 : x.id < y.id ? -1 : 1));
    const [ficaCom, ...repetidos] = grupo as [AlertaExistente, ...AlertaExistente[]];
    for (const d of repetidos) ops.encerrar.push({ id: d.id, motivo: 'duplicado', encerrado_em: o.agora });
    const c = porChave.get(chave);
    // D4: mesma chave com tipo diferente (os dois de produtividade): o mais novo substitui o vivo, mesmo dispensado
    const substitui = c !== undefined && c.tipo !== ficaCom.tipo && o.tipos_ativos.has(c.tipo);
    if (!o.tipos_ativos.has(ficaCom.tipo)) {
      ops.encerrar.push({ id: ficaCom.id, motivo: 'regra_inativa', encerrado_em: o.agora });
      if (substitui) ops.abrir.push(c);
    } else if (!c) {
      ops.encerrar.push({ id: ficaCom.id, motivo: 'condicao_normalizada', encerrado_em: o.agora });
    } else if (substitui) {
      ops.encerrar.push({ id: ficaCom.id, motivo: 'condicao_normalizada', encerrado_em: o.agora });
      ops.abrir.push(c);
    } else {
      mantidos.add(chave);
      if (ficaCom.status === 'aberto' && (ficaCom.valor !== c.valor || ficaCom.mensagem !== c.mensagem || ficaCom.severidade !== c.severidade)) {
        ops.atualizar.push({ id: ficaCom.id, valor: c.valor, mensagem: c.mensagem, severidade: c.severidade });
      }
    }
  }
  for (const [chave, c] of porChave) if (!mantidos.has(chave) && !vivos.has(chave) && o.tipos_ativos.has(c.tipo)) ops.abrir.push(c);
  return ops;
}
