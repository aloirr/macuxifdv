/**
 * Alertas do gestor (RF-GES-07, P1) por regra parametrizável (`alerta_regra`).
 *  - `avaliarAlertas` gera as CONDIÇÕES que valem agora (sem estado), só para regras ligadas e módulos ativos;
 *  - `reconciliarAlertas` compara com os alertas já gravados e devolve o que abrir, atualizar e encerrar:
 *      · deduplicação pela chave `<tipo>:<alvo_id>` (um alerta aberto por chave);
 *      · encerramento AUTOMÁTICO quando a condição deixa de valer (ou a regra/módulo é desligado);
 *      · alerta dispensado pelo gestor não reabre enquanto a condição persiste; se sumir e voltar, abre outro.
 * O "dia" é a data civil no fuso do tenant. Funções puras e idempotentes.
 */
import { businessDays, diffDays } from '@macuxi/comum';
import { RegraAlerta, TIPOS_ALERTA, type CondicaoAlerta, type MembroEquipe, type MotivoEncerramento, type Severidade, type StatusAlerta, type TipoAlerta } from '../contracts';
import { pedidoPendenteDeAprovacao } from './aprovacoes';
import { arredondar, horasEntre, percentual, somarDias } from './numeros';
import { diaLocal, painelDoMes } from './painel';
import { resolverParametros, type ParametrosGestor } from './parametros';
import type { EstadoProjecao } from './projecao';

/** Regra padrão de cada tipo (valores entre colchetes do doc 02/03 e premissas da T-0014, em regras.md). */
export const REGRAS_PADRAO: Readonly<Record<TipoAlerta, RegraAlerta>> = Object.freeze({
  // RF-GES-07: "cliente sem compra há [30] dias" — aqui por VISITA; mesmo padrão de 30
  cliente_sem_visita: { tipo: 'cliente_sem_visita', ativa: true, limiar: 30, janela_dias: null, amostra_min: null, severidade: 'atencao' },
  // limiar = % do ritmo esperado; amostra_min = dias úteis decorridos mínimos
  ritmo_abaixo_meta: { tipo: 'ritmo_abaixo_meta', ativa: true, limiar: 80, janela_dias: null, amostra_min: 3, severidade: 'atencao' },
  // limiar = horas de espera
  pedido_aguardando_aprovacao: { tipo: 'pedido_aguardando_aprovacao', ativa: true, limiar: 24, janela_dias: null, amostra_min: null, severidade: 'critica' },
  // limiar = nº de visitas da loja com ruptura dentro da janela
  ruptura_recorrente: { tipo: 'ruptura_recorrente', ativa: true, limiar: 3, janela_dias: 14, amostra_min: null, severidade: 'atencao' },
  // limite vem de `permanencia_min_min` (RN-PRO-07), parâmetro único do tenant
  visita_curta: { tipo: 'visita_curta', ativa: true, limiar: null, janela_dias: 3, amostra_min: null, severidade: 'info' },
  // limiar = % máximo de fotos sem GPS; amostra_min = nº mínimo de fotos
  fotos_sem_gps: { tipo: 'fotos_sem_gps', ativa: true, limiar: 20, janela_dias: 7, amostra_min: 10, severidade: 'atencao' },
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
    out[tipo] = r.data;
  }
  return out;
}

/** Tipos que valem agora: regra ligada E módulo de origem ativo (RN-CORE-03). */
export function tiposAtivos(regras: RegrasAlerta, modulos: ReadonlySet<string>): Set<TipoAlerta> {
  return new Set(TIPOS_ALERTA.filter((t) => regras[t].ativa && (MODULO_DO_ALERTA[t] === 'core' || modulos.has(MODULO_DO_ALERTA[t]))));
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
}

const chaveDe = (tipo: TipoAlerta, alvo: string) => `${tipo}:${alvo}`;
const naJanela = (dia: string, hoje: string, janela: number) => dia >= somarDias(hoje, -(janela - 1)) && dia <= hoje;

/** Condições de alerta que valem em `agora`, ordenadas por chave (resultado estável). */
export function avaliarAlertas(e: EntradaAvaliacao): CondicaoAlerta[] {
  const params = resolverParametros(e.params);
  const ativos = tiposAtivos(e.regras, e.modulos);
  const hoje = diaLocal(e.agora, params.fuso);
  const out: CondicaoAlerta[] = [];
  const ativoNoCadastro = (id: string | null): boolean => {
    if (!id) return false;
    const m = e.membros.find((x) => x.id === id);
    return !m || m.ativo; // fora do cadastro: não bloqueia (o cadastro pode estar defasado)
  };

  // --- cliente da carteira sem visita há X dias ---
  if (ativos.has('cliente_sem_visita')) {
    const r = e.regras.cliente_sem_visita;
    const ultima = new Map<string, string>(); // cliente → último dia com check-in (qualquer usuário)
    for (const v of Object.values(e.estado.visitas)) {
      if (!v.checkin) continue;
      const dia = diaLocal(v.checkin.checkin_em, params.fuso);
      if (!ultima.has(v.checkin.cliente_id) || dia > ultima.get(v.checkin.cliente_id)!) ultima.set(v.checkin.cliente_id, dia);
    }
    for (const [clienteId, c] of Object.entries(e.estado.clientes)) {
      if (!c.ativo || !ativoNoCadastro(c.vendedor_id)) continue;
      const dia = ultima.get(clienteId);
      const dias = dia ? diffDays(dia, hoje) : null;
      if (dias !== null && dias < r.limiar!) continue;
      const nome = c.nome ?? 'Cliente';
      out.push({
        chave: chaveDe('cliente_sem_visita', clienteId),
        tipo: 'cliente_sem_visita',
        alvo_tipo: 'cliente',
        alvo_id: clienteId,
        responsavel_id: c.vendedor_id,
        valor: dias,
        limiar: r.limiar,
        severidade: r.severidade,
        mensagem: dias === null ? `${nome} nunca foi visitado.` : `${nome} está sem visita há ${dias} dias (limite ${r.limiar}).`,
      });
    }
  }

  // --- ritmo abaixo da meta ---
  if (ativos.has('ritmo_abaixo_meta')) {
    const r = e.regras.ritmo_abaixo_meta;
    const decorridos = businessDays(hoje.slice(0, 7), hoje, params.feriados).elapsed;
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

  // --- pedido aguardando aprovação há X horas ---
  if (ativos.has('pedido_aguardando_aprovacao')) {
    const r = e.regras.pedido_aguardando_aprovacao;
    for (const [pedidoId, a] of Object.entries(e.estado.aprovacoes)) {
      if (!pedidoPendenteDeAprovacao(e.estado, pedidoId)) continue;
      const horas = horasEntre(a.solicitada_em, e.agora);
      if (horas < r.limiar!) continue;
      out.push({
        chave: chaveDe('pedido_aguardando_aprovacao', pedidoId),
        tipo: 'pedido_aguardando_aprovacao',
        alvo_tipo: 'pedido',
        alvo_id: pedidoId,
        responsavel_id: a.vendedor_id,
        valor: horas,
        limiar: r.limiar,
        severidade: r.severidade,
        mensagem: `Pedido aguardando aprovação há ${horas} h (limite ${r.limiar} h).`,
      });
    }
  }

  // --- trade: só com Promotor ativo; visitas abaixo da permanência mínima não contam nas rupturas (RN-PRO-07) ---
  const lojas = Object.values(e.estado.visitas_loja);

  if (ativos.has('ruptura_recorrente')) {
    const r = e.regras.ruptura_recorrente;
    const janela = r.janela_dias ?? 14;
    const valida = new Set(lojas.filter((l) => l.permanencia_min >= params.permanencia_min_min).map((l) => l.visita_loja_id));
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
      if (l.permanencia_min >= params.permanencia_min_min || !naJanela(diaLocal(l.checkin_em, params.fuso), hoje, janela)) continue;
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
      if (l.fotos_total === null || l.fotos_sem_gps === null || !naJanela(diaLocal(l.checkin_em, params.fuso), hoje, janela)) continue;
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
    if (!o.tipos_ativos.has(ficaCom.tipo)) {
      ops.encerrar.push({ id: ficaCom.id, motivo: 'regra_inativa', encerrado_em: o.agora });
    } else if (!c) {
      ops.encerrar.push({ id: ficaCom.id, motivo: 'condicao_normalizada', encerrado_em: o.agora });
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
