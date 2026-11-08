/**
 * T-0133 (RN-VEN-30, RF-VEN-05): parte PURA das tags de status do histórico do pedido e do orçamento, a mesma no app
 * (Campo e Gestão, `TagHistorico`/`HistoricoEmTags` do kit mobile) e no BKO (`TagHistorico`/`HistoricoEmTags` do kit web).
 * Spec: docs/design/pedido-v2.md §5.
 *
 * O histórico mostra só tags de status, com data e hora curtas, sem frase ("Salvo · 08/11 10:35"). Rejeitado e Cancelado
 * levam o motivo em 1 linha. O autor só aparece quando não é o vendedor do pedido (o módulo diz, `autorEhVendedor`).
 * Status que não tem tag (ex.: `enviado_erp`, evento "Editado") NÃO aparece: nunca se mostra texto técnico
 * ("Recebido pelo servidor") nem o código cru.
 * Sem regra de negócio: o kit só traduz o status que o módulo manda em rótulo, tom e leitura. Aceita o vocabulário do
 * contrato (RN-VEN-30: `rascunho`, `na_fila`…) e os ids do banco (`draft`, `queued`…), para nenhum módulo repetir o mapa.
 * Sem react-native: roda em Node (Vitest).
 */
import { MONTHS, zonedParts } from '@macuxi/comum/fuso';

/** Pedido ou orçamento (RN-VEN-18: o orçamento é o `tipo = orcamento` do mesmo registro, com ciclo próprio). */
export type TipoDoRegistro = 'pedido' | 'orcamento';

/** Tons da tag: os mesmos nomes do `TomEstado` do kit mobile (cor SEMPRE com texto). */
export type TomTag = 'sucesso' | 'aviso' | 'erro' | 'neutro' | 'destaque';

interface DefinicaoTag {
  rotulo: string;
  tom: TomTag;
  /** mostra o motivo em 1 linha (Rejeitado, Cancelado) */
  comMotivo?: boolean;
  /** "Transformado em pedido nº 000013" */
  comNumero?: boolean;
}

const SALVO: DefinicaoTag = { rotulo: 'Salvo', tom: 'neutro' };
const CANCELADO: DefinicaoTag = { rotulo: 'Cancelado', tom: 'erro', comMotivo: true };

/**
 * Pedido (RN-VEN-30, texto do dono do produto de 08/11 tarde). `null` = status sem tag (não aparece no histórico).
 * `enviado_erp` fica sem tag: é passo interno entre Aprovado e Recebido no ERP (premissa da T-0133, ajustável).
 */
const TAGS_PEDIDO: Readonly<Record<string, DefinicaoTag | null>> = {
  rascunho: SALVO,
  draft: SALVO,
  na_fila: { rotulo: 'Na fila', tom: 'aviso' },
  queued: { rotulo: 'Na fila', tom: 'aviso' },
  recebido: { rotulo: 'Enviado', tom: 'neutro' },
  received: { rotulo: 'Enviado', tom: 'neutro' },
  em_aprovacao: { rotulo: 'Em aprovação', tom: 'destaque' },
  pending_approval: { rotulo: 'Em aprovação', tom: 'destaque' },
  aprovado: { rotulo: 'Aprovado', tom: 'sucesso' },
  approved: { rotulo: 'Aprovado', tom: 'sucesso' },
  rejeitado: { rotulo: 'Rejeitado', tom: 'erro', comMotivo: true },
  rejected: { rotulo: 'Rejeitado', tom: 'erro', comMotivo: true },
  enviado_erp: null,
  sent_to_erp: null,
  integrado_erp: { rotulo: 'Recebido no ERP', tom: 'sucesso' },
  integrated: { rotulo: 'Recebido no ERP', tom: 'sucesso' },
  faturado_parcial: { rotulo: 'Faturado parcial', tom: 'sucesso' },
  invoiced_partial: { rotulo: 'Faturado parcial', tom: 'sucesso' },
  faturado: { rotulo: 'Faturado', tom: 'sucesso' },
  faturado_total: { rotulo: 'Faturado', tom: 'sucesso' },
  invoiced: { rotulo: 'Faturado', tom: 'sucesso' },
  cancelado: CANCELADO,
  cancelled: CANCELADO,
};

/** Orçamento (RN-VEN-30 e RN-VEN-18): Salvo · Transformado em pedido nº · Vencido · Cancelado. */
const TAGS_ORCAMENTO: Readonly<Record<string, DefinicaoTag | null>> = {
  salvo: SALVO,
  aberto: SALVO,
  rascunho: SALVO,
  draft: SALVO,
  convertido: { rotulo: 'Transformado em pedido', tom: 'sucesso', comNumero: true },
  transformado: { rotulo: 'Transformado em pedido', tom: 'sucesso', comNumero: true },
  vencido: { rotulo: 'Vencido', tom: 'aviso' },
  cancelado: CANCELADO,
  cancelled: CANCELADO,
};

/** Todos os rótulos possíveis, por tipo (a spec e o teste conferem a lista da RN-VEN-30). */
export function rotulosDoHistorico(tipo: TipoDoRegistro): string[] {
  const mapa = tipo === 'orcamento' ? TAGS_ORCAMENTO : TAGS_PEDIDO;
  const vistos = new Set<string>();
  for (const d of Object.values(mapa)) if (d) vistos.add(d.comNumero ? `${d.rotulo} nº` : d.rotulo);
  return [...vistos];
}

/** Um evento do histórico, como o módulo tem (status no vocabulário do contrato ou do banco). */
export interface EventoDoHistorico {
  /** estável (chave e testID); sem ele, usa status + data */
  id?: string;
  status: string;
  /** ISO UTC do evento */
  em: string;
  /** Só Rejeitado e Cancelado mostram (1 linha). */
  motivo?: string | null;
  /** Nome de quem fez (ex.: "Carla Souza"). Só aparece com `autorEhVendedor` falso. */
  autor?: string | null;
  /** O autor é o vendedor do pedido: o nome não aparece (RN-VEN-30). */
  autorEhVendedor?: boolean;
  /** Orçamento transformado: número do pedido gerado ("000013"). */
  numeroPedido?: string | null;
}

export interface TagDoHistorico {
  id: string;
  /** "Salvo", "Rejeitado", "Transformado em pedido nº 000013" */
  rotulo: string;
  /** "08/11 10:35" (no fuso do tenant; de outro ano, "08/11/25 10:35") */
  quando: string;
  /** Texto da tag: "Salvo · 08/11 10:35" ou, com autor, "Aprovado · 08/11 11:20 · Carla Souza". */
  texto: string;
  tom: TomTag;
  /** Linha abaixo da tag (Rejeitado, Cancelado), já numa linha só; null = sem linha. */
  motivo: string | null;
  /** Leitura do TalkBack: "Rejeitado, 8 de novembro às 14:02, por Carla Souza. Motivo: desconto acima da alçada". */
  leitura: string;
  /** ms do evento (ordem) */
  instante: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

function instanteDe(em: string | Date | number): number {
  const t = (em instanceof Date ? em : new Date(em)).getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

/** "08/11 10:35" no fuso do tenant; de outro ano que o de `agora`, "08/11/25 10:35". Data inválida → "". */
export function quandoCurto(em: string | Date | number, agora: string | Date | number, tz: string): string {
  if (!Number.isFinite(instanteDe(em))) return '';
  const p = zonedParts(em, tz);
  const anoAgora = Number.isFinite(instanteDe(agora)) ? zonedParts(agora, tz).year : p.year;
  const data = p.year === anoAgora ? `${pad(p.day)}/${pad(p.month)}` : `${pad(p.day)}/${pad(p.month)}/${pad(p.year % 100)}`;
  return `${data} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Leitura do TalkBack da data: "8 de novembro às 10:35" (de outro ano, "8 de novembro de 2025 às 10:35"). */
export function leituraDoQuando(em: string | Date | number, agora: string | Date | number, tz: string): string {
  if (!Number.isFinite(instanteDe(em))) return '';
  const p = zonedParts(em, tz);
  const anoAgora = Number.isFinite(instanteDe(agora)) ? zonedParts(agora, tz).year : p.year;
  const ano = p.year === anoAgora ? '' : ` de ${p.year}`;
  return `${p.day} de ${MONTHS[p.month - 1]}${ano} às ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Motivo em uma linha: sem quebras nem espaços repetidos; vazio → null. */
export function motivoEmUmaLinha(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').replace(/\s+/g, ' ').trim();
  return m || null;
}

/**
 * A tag de um evento, ou null quando o status não tem tag (não aparece) ou a data é inválida.
 * Ex.: { status: 'rejeitado', em, motivo: 'Desconto acima da alçada', autor: 'Carla Souza' } →
 * texto "Rejeitado · 08/11 14:02 · Carla Souza", motivo "Desconto acima da alçada", tom erro.
 */
export function tagDoHistorico(evento: EventoDoHistorico, ctx: { tipo: TipoDoRegistro; tz: string; agora: string | Date | number }): TagDoHistorico | null {
  const mapa = ctx.tipo === 'orcamento' ? TAGS_ORCAMENTO : TAGS_PEDIDO;
  const chave = evento.status.trim().toLowerCase();
  const def = Object.prototype.hasOwnProperty.call(mapa, chave) ? mapa[chave] : null;
  if (!def) return null;
  const instante = instanteDe(evento.em);
  if (!Number.isFinite(instante)) return null;
  const numero = def.comNumero ? (evento.numeroPedido ?? '').trim() : '';
  const rotulo = numero ? `${def.rotulo} nº ${numero}` : def.rotulo;
  const quando = quandoCurto(evento.em, ctx.agora, ctx.tz);
  const autor = !evento.autorEhVendedor ? (evento.autor ?? '').trim() : '';
  const motivo = def.comMotivo ? motivoEmUmaLinha(evento.motivo) : null;
  const texto = [rotulo, quando, autor].filter(Boolean).join(' · ');
  const leitura = `${rotulo}, ${leituraDoQuando(evento.em, ctx.agora, ctx.tz)}${autor ? `, por ${autor}` : ''}${motivo ? `. Motivo: ${motivo}` : ''}`;
  return { id: evento.id ?? `${chave}-${instante}`, rotulo, quando, texto, tom: def.tom, motivo, leitura, instante };
}

/** As tags do histórico em ordem de acontecimento (a mais antiga primeiro; a última é o status de agora), sem as que não têm tag. */
export function tagsDoHistorico(eventos: ReadonlyArray<EventoDoHistorico>, ctx: { tipo: TipoDoRegistro; tz: string; agora: string | Date | number }): TagDoHistorico[] {
  return eventos
    .map((e, i) => ({ t: tagDoHistorico(e, ctx), i }))
    .filter((x): x is { t: TagDoHistorico; i: number } => x.t !== null)
    .sort((a, b) => a.t.instante - b.t.instante || a.i - b.i)
    .map((x) => x.t);
}

/** Leitura do bloco inteiro para o TalkBack: "Histórico: 3 etapas". O título vem da tela. */
export function leituraDoHistorico(titulo: string, n: number): string {
  return `${titulo}: ${n === 1 ? '1 etapa' : `${n} etapas`}`;
}
