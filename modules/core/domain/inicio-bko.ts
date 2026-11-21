/**
 * Início do BKO (T-0189; RN-CORE-64, RN-CORE-65, RN-CORE-66). Funções puras: saudação, os pedidos do "Hoje", o horário esperado da
 * carga e a carga que não ocorreu, o cadastro incompleto e a montagem dos alertas do cartão "Precisa de você" (a única área de alertas).
 * A API e a tela usam as mesmas funções. Alerta de módulo sem licença nunca é montado.
 */
import { formatHHMM, greeting } from '@macuxi/comum/fuso';
import { instanteNoFuso } from '@macuxi/comum/relogio';
import { Entidade, ENTIDADES, ROTULO_ENTIDADE } from '../../integracao/contracts';
import {
  HORARIO_CARGA_PADRAO,
  PARAMETRO_HORARIO_CARGA,
  type ErroHorarioCarga,
  type HorarioCarga,
  type HorarioCargaPut,
} from '../contracts/inicio-bko';
import { HoraHHMM } from '../contracts/hora';
import { dataLocal } from './checkin';
import { saudacaoComNome } from './nome';
import { CAMPOS_CADASTRO_CLIENTE, ROTULO_CAMPO_CADASTRO, cadastroCompleto, type CampoCadastroCliente, type DadosCadastro } from './cadastro';

/** RN-CORE-64: "Bom dia, Ana." (até 11h59), "Boa tarde" (até 17h59), "Boa noite", pela hora no fuso do tenant. Sem nome, só a saudação. */
export const saudacaoDoBko = (agora: Date, fuso: string, nomeCompleto: string | null | undefined): string => saudacaoComNome(greeting(agora, fuso), nomeCompleto ?? '');

// ---------- RN-CORE-65: horário esperado da carga ----------

const HHMM = (v: unknown): v is string => HoraHHMM.safeParse(v).success;

/** Chaves em ordem alfabética: o valor gravado e o lido comparam igual (idempotência do PUT). */
const ordenado = (o: Record<string, string | null>): Record<string, string | null> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

type LinhaParametro = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/** RN-CORE-65: valor efetivo do parâmetro `integracao.horario_carga`; ausente ou inválido = 06:00 para todas; override inválido é ignorado. */
export function horarioCargaDasLinhas(linhas: readonly LinhaParametro[]): HorarioCarga {
  const v = linhas.find((l) => l.modulo === 'core' && l.chave === PARAMETRO_HORARIO_CARGA && !l.deleted_at)?.valor;
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as { padrao?: unknown; entidades?: unknown }) : {};
  const entidades: Record<string, string | null> = {};
  if (o.entidades && typeof o.entidades === 'object' && !Array.isArray(o.entidades)) {
    for (const [k, h] of Object.entries(o.entidades as Record<string, unknown>)) if (Entidade.safeParse(k).success && (h === null || HHMM(h))) entidades[k] = h;
  }
  return { padrao: HHMM(o.padrao) ? o.padrao : HORARIO_CARGA_PADRAO, entidades: ordenado(entidades) };
}

export type ResultadoHorarioCarga = { ok: true; valores: HorarioCarga } | { ok: false; erros: ErroHorarioCarga[] };

/** RN-CORE-65: valida a edição (HH:MM de 00:00 a 23:59; `null` = sem horário). Mensagens em português com a ação seguinte. */
export function validarHorarioCarga(e: HorarioCargaPut): ResultadoHorarioCarga {
  const erros: ErroHorarioCarga[] = [];
  if (!HHMM(e.padrao)) erros.push({ campo: 'padrao', mensagem: 'Informe o horário padrão no formato HH:MM, de 00:00 a 23:59.' });
  const entidades: Record<string, string | null> = {};
  for (const [k, h] of Object.entries(e.entidades)) {
    if (!Entidade.safeParse(k).success) erros.push({ campo: 'entidades', mensagem: `Entidade "${k}" desconhecida. Escolha uma da lista.` });
    else if (h !== null && !HHMM(h)) erros.push({ campo: 'entidades', mensagem: `Horário de ${rotuloDaEntidade(k)} inválido. Use HH:MM, de 00:00 a 23:59, ou deixe sem horário.` });
    else entidades[k] = h;
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valores: { padrao: e.padrao, entidades: ordenado(entidades) } };
}

export interface EntradaCargasAtrasadas {
  agora: Date;
  fuso: string;
  /** Hoje é dia útil do calendário do tenant (`calendarioDoTenant` + `ehDiaUtil`). */
  dia_util: boolean;
  horario: HorarioCarga;
  /** Última carga recebida por entidade (só entidades que já receberam carga). */
  ultimas: readonly { entidade: string; recebido_em: string }[];
}

/**
 * RN-CORE-65: entidades cuja carga não ocorreu. Só em dia útil; alerta quando agora ≥ horário de hoje (do override, ou o padrão) e a última carga
 * recebida é anterior a esse horário. Override `null` = sem horário = sem alerta.
 */
export function cargasAtrasadas(e: EntradaCargasAtrasadas): { entidade: string; ultima_em: string }[] {
  if (!e.dia_util) return [];
  const hoje = dataLocal(e.agora, e.fuso);
  const saida: { entidade: string; ultima_em: string }[] = [];
  const proprios: Record<string, string | null | undefined> = e.horario.entidades;
  for (const u of e.ultimas) {
    const h = u.entidade in proprios ? proprios[u.entidade] : e.horario.padrao;
    if (h === null || h === undefined) continue;
    const esperada = instanteNoFuso(hoje, h, e.fuso);
    if (e.agora.getTime() >= esperada.getTime() && new Date(u.recebido_em).getTime() < esperada.getTime()) saida.push({ entidade: u.entidade, ultima_em: u.recebido_em });
  }
  return saida.sort((a, b) => a.entidade.localeCompare(b.entidade));
}

// ---------- RN-CORE-66: cadastro incompleto ----------

/**
 * RN-CORE-66: conta os clientes (já ativos e do escopo) com cadastro incompleto pela lista efetiva da RN-CORE-16 (`camposExigidos`) e
 * indica o campo que mais falta (empate: a ordem canônica dos campos).
 */
export function cadastroIncompletoDoEscopo(
  clientes: readonly DadosCadastro[],
  exigidos: readonly CampoCadastroCliente[],
): { quantidade: number; campo: string | null } {
  const falta = new Map<CampoCadastroCliente, number>();
  let quantidade = 0;
  for (const c of clientes) {
    const r = cadastroCompleto(c, exigidos);
    if (r.completo) continue;
    quantidade += 1;
    for (const f of r.campos_faltantes) falta.set(f, (falta.get(f) ?? 0) + 1);
  }
  let top: CampoCadastroCliente | null = null;
  for (const c of CAMPOS_CADASTRO_CLIENTE) if (falta.has(c) && (top === null || (falta.get(c) ?? 0) > (falta.get(top) ?? 0))) top = c;
  return { quantidade, campo: top ? ROTULO_CAMPO_CADASTRO[top] : null };
}

// ---------- RN-CORE-64: alertas ----------

export type GravidadeAlertaInicio = 'falha' | 'atencao';
export interface ParteTexto {
  texto: string;
  negrito?: boolean;
}
export interface AlertaInicio {
  id: string;
  gravidade: GravidadeAlertaInicio;
  partes: ParteTexto[];
  acao: { rotulo: string; caminho: string };
}

export interface EntradaAlertasInicio {
  agora: Date;
  fuso: string;
  /** Licença dos módulos no tenant: alerta de módulo sem licença não aparece. */
  licencas: { integracao: boolean; gestor: boolean; vendedor: boolean };
  /** Cada assunto ausente (undefined/null) = sem dado ou sem permissão: não vira alerta. */
  mensagens_paradas?: { quantidade: number; desde: string | null } | null;
  lotes_falhos?: readonly { lote_id: string; entidade: string; quando: string; linhas: number }[] | null;
  cargas_atrasadas?: readonly { entidade: string; ultima_em: string | null }[] | null;
  aprovacoes?: { quantidade: number; mais_antigo_em: string | null } | null;
  alertas_abertos?: number | null;
  usuarios_senha_vencida?: number | null;
  cadastro_incompleto?: { quantidade: number; campo: string | null } | null;
}

/** Entidades da carga do ERP que o tenant pode ajustar em Parâmetros (RN-CORE-65): as da Integração. */
export const ENTIDADES_DE_CARGA = ENTIDADES;
export const rotuloDaEntidade = (e: string): string => ROTULO_ENTIDADE[e as Entidade] ?? e;

const milhar = (n: number) => n.toLocaleString('pt-BR');
const plural = (n: number, um: string, varios: string) => `${milhar(n)} ${n === 1 ? um : varios}`;

/** "15/11 às 00:47" no fuso do tenant. */
export function dataHoraCurta(iso: string, fuso: string): string {
  const d = dataLocal(iso, fuso);
  return `${d.slice(8, 10)}/${d.slice(5, 7)} às ${formatHHMM(iso, fuso)}`;
}

function duracaoCurta(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

/**
 * RN-CORE-64: do último lote de cada entidade, os que falharam (um já recuperado por lote posterior não alerta). `linhas` = linhas com erro,
 * ou as recebidas quando o lote falhou sem detalhar por linha.
 */
export function lotesFalhosParaOInicio(
  lotes: readonly { lote_id: string; entidade: string; status: string; recebido_em: string; com_erro: number; recebidas: number }[],
): { lote_id: string; entidade: string; quando: string; linhas: number }[] {
  const ultimo = new Map<string, (typeof lotes)[number]>();
  for (const l of lotes) {
    const atual = ultimo.get(l.entidade);
    if (!atual || new Date(l.recebido_em).getTime() > new Date(atual.recebido_em).getTime()) ultimo.set(l.entidade, l);
  }
  return [...ultimo.values()]
    .filter((l) => l.status === 'falhou')
    .map((l) => ({ lote_id: l.lote_id, entidade: l.entidade, quando: l.recebido_em, linhas: l.com_erro > 0 ? l.com_erro : l.recebidas }))
    .sort((a, b) => b.quando.localeCompare(a.quando) || a.entidade.localeCompare(b.entidade));
}

/**
 * RN-CORE-64: monta o cartão "Precisa de você". Falhas (vermelho) antes de atenção (amarelo); dentro de cada grupo, a ordem fixa abaixo; um
 * alerta por fato. Assunto sem quantidade, sem licença do módulo ou sem permissão não aparece; lista vazia = "Nada pendente.".
 */
export function montarAlertasInicio(e: EntradaAlertasInicio): AlertaInicio[] {
  const falhas: AlertaInicio[] = [];
  const atencao: AlertaInicio[] = [];
  const { agora, fuso, licencas } = e;
  const monitor = { rotulo: 'Integração ERP', caminho: '/integracao' };

  if (licencas.integracao) {
    const m = e.mensagens_paradas;
    if (m && m.quantidade > 0) {
      const desde: ParteTexto[] = m.desde ? [{ texto: ` desde ${dataHoraCurta(m.desde, fuso)}` }] : [];
      falhas.push({ id: 'mensagens_paradas', gravidade: 'falha', partes: [{ texto: 'Integração com o ERP: ' }, { texto: plural(m.quantidade, 'mensagem parada', 'mensagens paradas'), negrito: true }, ...desde], acao: monitor });
    }
    for (const l of e.lotes_falhos ?? []) {
      falhas.push({
        id: `lote_falhou:${l.lote_id}`,
        gravidade: 'falha',
        partes: [{ texto: `Lote de ${rotuloDaEntidade(l.entidade)} falhou em ${dataHoraCurta(l.quando, fuso)} — ` }, { texto: plural(l.linhas, 'linha com erro', 'linhas com erro'), negrito: true }],
        acao: { rotulo: 'Ver lote', caminho: `/integracao?lote=${l.lote_id}` },
      });
    }
    // RN-CORE-65: a carga que não ocorreu é atenção (amarelo), não falha
    for (const c of e.cargas_atrasadas ?? []) {
      atencao.push({
        id: `carga_atrasada:${c.entidade}`,
        gravidade: 'atencao',
        partes: [{ texto: 'Carga de ' }, { texto: rotuloDaEntidade(c.entidade), negrito: true }, { texto: ` não chegou hoje — ${c.ultima_em ? `a última foi em ${dataHoraCurta(c.ultima_em, fuso)}` : 'ainda não houve carga'}` }],
        acao: monitor,
      });
    }
  }
  const ap = e.aprovacoes;
  if (licencas.gestor && licencas.vendedor && ap && ap.quantidade > 0) {
    const idade: ParteTexto[] = ap.mais_antigo_em ? [{ texto: ` — o mais antigo há ${duracaoCurta(agora.getTime() - new Date(ap.mais_antigo_em).getTime())}` }] : [];
    atencao.push({ id: 'aprovacoes', gravidade: 'atencao', partes: [{ texto: plural(ap.quantidade, 'pedido', 'pedidos'), negrito: true }, { texto: ` esperando aprovação` }, ...idade], acao: { rotulo: 'Aprovações', caminho: '/aprovacoes' } });
  }
  if (licencas.gestor && e.alertas_abertos && e.alertas_abertos > 0) {
    atencao.push({ id: 'alertas', gravidade: 'atencao', partes: [{ texto: plural(e.alertas_abertos, 'alerta aberto', 'alertas abertos'), negrito: true }], acao: { rotulo: 'Alertas', caminho: '/alertas' } });
  }
  if (e.usuarios_senha_vencida && e.usuarios_senha_vencida > 0) {
    const n = e.usuarios_senha_vencida;
    atencao.push({ id: 'usuarios_senha', gravidade: 'atencao', partes: [{ texto: plural(n, 'usuário', 'usuários'), negrito: true }, { texto: ` com senha temporária vencida` }], acao: { rotulo: 'Usuários', caminho: '/usuarios' } });
  }
  const ci = e.cadastro_incompleto;
  if (ci && ci.quantidade > 0) {
    atencao.push({
      id: 'cadastro_incompleto',
      gravidade: 'atencao',
      partes: [{ texto: plural(ci.quantidade, 'cliente', 'clientes'), negrito: true }, { texto: ` com cadastro incompleto${ci.campo ? ` — o que mais falta: ${ci.campo}` : ''}` }],
      acao: { rotulo: 'Clientes', caminho: '/clientes' },
    });
  }
  return [...falhas, ...atencao];
}

// ---------- RN-CORE-64: derivações dos dados lidos de outros módulos ----------

/** RN-CORE-64: a aprovação mais antiga da fila (menor `solicitada_em`); fila vazia = null. */
export function aprovacaoMaisAntiga(solicitadas: readonly string[]): string | null {
  let menor: string | null = null;
  for (const s of solicitadas) if (menor === null || new Date(s).getTime() < new Date(menor).getTime()) menor = s;
  return menor;
}

/** RN-CORE-64: quantos pedidos da fila foram solicitados HOJE (dia civil no fuso do tenant): a linha "N em aprovação" do cartão Pedidos. */
export function aprovacoesSolicitadasHoje(itens: readonly { pedido_id: string; solicitada_em: string }[], agora: Date, fuso: string): number {
  const hoje = dataLocal(agora, fuso);
  return new Set(itens.filter((i) => dataLocal(i.solicitada_em, fuso) === hoje).map((i) => i.pedido_id)).size;
}

/**
 * RN-CORE-64: o cartão Pedidos conta os aprovados do dia (Vendedor) mais os de hoje em aprovação (status distintos: nunca contam duas vezes);
 * "N em aprovação" é o subconjunto de `total`.
 */
export const pedidosDeHoje = (aprovadosHoje: number, emAprovacaoHoje: number): { total: number; em_aprovacao: number } => ({ total: aprovadosHoje + emAprovacaoHoje, em_aprovacao: emAprovacaoHoje });
