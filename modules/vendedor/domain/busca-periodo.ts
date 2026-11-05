/**
 * Busca e período da lista de Pedidos (T-0077, RF-VEN-05): texto sem acento/maiúscula, número sem zeros à esquerda, período
 * Dia | Mês | Ano no fuso do tenant, "emitido OU mudou de status no período" e contagem por situação. Funções puras, sem
 * relógio: o instante de "agora" e o fuso chegam por parâmetro. Dinheiro em centavos.
 */
import { localIsoDate } from '@macuxi/comum/fuso';

export interface ItemDaBusca {
  id: string;
  /** número exibido ao usuário (sequencial do tenant, ex.: "000011"); vazio no pedido ainda na fila */
  numero: string;
  nome_fantasia: string;
  razao_social: string;
  tipo?: 'pedido' | 'orcamento';
  status: string;
  /** ainda na fila do aparelho */
  local: boolean;
  total_cents: number;
  /** ISO UTC da emissão (`received_at`) */
  emitido_em: string;
  /** ISO UTC da última mudança de status (`Order.status_changed_at`, dos eventos); vazio = nunca mudou */
  status_alterado_em?: string | null;
}

// ---------- texto ----------

/** Sem acento, sem maiúscula, sem espaços nas pontas. */
export function normalizarTexto(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** "000011" -> "11"; só zeros -> "0". */
export function numeroSemZeros(n: string): string {
  const t = n.trim().replace(/^0+/, '');
  return t === '' && n.trim() !== '' ? '0' : t;
}

/** RF-VEN-05: acha por fantasia, razão social ou número (com ou sem zeros à esquerda). Busca vazia casa tudo. */
export function casaComBusca(i: Pick<ItemDaBusca, 'numero' | 'nome_fantasia' | 'razao_social'>, busca: string): boolean {
  const q = normalizarTexto(busca);
  if (!q) return true;
  if (normalizarTexto(i.nome_fantasia).includes(q) || normalizarTexto(i.razao_social).includes(q)) return true;
  if (/^\d+$/.test(q) && i.numero) {
    return numeroSemZeros(i.numero).includes(numeroSemZeros(q)) || i.numero.includes(q);
  }
  return false;
}

export interface TrechoDoTexto {
  texto: string;
  destaque: boolean;
}

/** Quebra `texto` em trechos marcando a primeira ocorrência de `busca` (sem acento/maiúscula), preservando o original. */
export function destacarTrecho(texto: string, busca: string): TrechoDoTexto[] {
  const q = normalizarTexto(busca);
  if (!q) return [{ texto, destaque: false }];
  // normaliza caractere a caractere para manter o mapa de posições com o original
  const chars = Array.from(texto);
  let norm = '';
  const inicio: number[] = [];
  chars.forEach((c, idx) => {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) inicio.push(idx);
    norm += n;
  });
  const achou = norm.indexOf(q);
  if (achou < 0) return [{ texto, destaque: false }];
  const de = inicio[achou]!;
  const ate = (inicio[achou + q.length - 1] ?? chars.length - 1) + 1;
  const partes: TrechoDoTexto[] = [
    { texto: chars.slice(0, de).join(''), destaque: false },
    { texto: chars.slice(de, ate).join(''), destaque: true },
    { texto: chars.slice(ate).join(''), destaque: false },
  ];
  return partes.filter((p) => p.texto !== '');
}

// ---------- período ----------

export type TipoPeriodo = 'dia' | 'mes' | 'ano';
/** `valor`: AAAA-MM-DD (dia), AAAA-MM (mês) ou AAAA (ano), sempre data civil no fuso do tenant. */
export interface Periodo {
  tipo: TipoPeriodo;
  valor: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** O período que contém o instante `agora`, no fuso do tenant (padrão da tela: `periodoDe('mes', agora, tz)`). */
export function periodoDe(tipo: TipoPeriodo, agora: string | Date, tz: string): Periodo {
  const dia = localIsoDate(agora, tz);
  return { tipo, valor: tipo === 'dia' ? dia : tipo === 'mes' ? dia.slice(0, 7) : dia.slice(0, 4) };
}

/** Passo do ‹ › (±1 dia, mês ou ano), na data civil. */
export function deslocarPeriodo(p: Periodo, passo: number): Periodo {
  if (p.tipo === 'ano') return { tipo: 'ano', valor: String(Number(p.valor) + passo) };
  if (p.tipo === 'mes') {
    const [a, m] = p.valor.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(a, m - 1 + passo, 1));
    return { tipo: 'mes', valor: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}` };
  }
  const [a, m, dd] = p.valor.split('-').map(Number) as [number, number, number];
  return { tipo: 'dia', valor: new Date(Date.UTC(a, m - 1, dd + passo)).toISOString().slice(0, 10) };
}

const DIAS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Nome do mês (1 a 12) com inicial maiúscula. */
export function nomeDoMes(mes: number): string {
  return MESES[mes - 1] ?? '';
}

/** "Seg, 02/11/2026" · "Novembro 2026" · "2026". */
export function rotuloDoPeriodo(p: Periodo): string {
  if (p.tipo === 'ano') return p.valor;
  if (p.tipo === 'mes') {
    const [a, m] = p.valor.split('-').map(Number) as [number, number];
    return `${nomeDoMes(m)} ${a}`;
  }
  const [a, m, d] = p.valor.split('-').map(Number) as [number, number, number];
  return `${DIAS_CURTOS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${pad(d)}/${pad(m)}/${a}`;
}

/** Os 12 meses (AAAA-MM) de um ano, para a lista de meses. */
export function mesesDoPeriodo(ano: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`);
}

/** Datas civis (no fuso) em que o item "aconteceu": emissão e última mudança de status. */
function datasDoItem(i: ItemDaBusca, tz: string): string[] {
  const out = [localIsoDate(i.emitido_em, tz)];
  if (i.status_alterado_em) out.push(localIsoDate(i.status_alterado_em, tz));
  return out;
}

/** RF-VEN-05: entra se foi emitido no período OU mudou de status nele. */
export function itemNoPeriodo(i: ItemDaBusca, p: Periodo, tz: string): boolean {
  return datasDoItem(i, tz).some((d) => d.startsWith(p.valor));
}

/**
 * A lista: com texto na busca ignora o período (procura em tudo que o aparelho tem); sem texto, vale o período.
 * Mantém a ordem recebida.
 */
export function filtrarLista(itens: readonly ItemDaBusca[], o: { periodo: Periodo; busca: string; tz: string }): ItemDaBusca[] {
  if (normalizarTexto(o.busca)) return itens.filter((i) => casaComBusca(i, o.busca));
  return itens.filter((i) => itemNoPeriodo(i, o.periodo, o.tz));
}

/** Dias (AAAA-MM-DD, ordenados) do mês que têm pedido, para a marca no calendário. */
export function diasComPedido(itens: readonly ItemDaBusca[], mes: string, tz: string): string[] {
  const s = new Set<string>();
  for (const i of itens) for (const d of datasDoItem(i, tz)) if (d.startsWith(mes)) s.add(d);
  return [...s].sort();
}

// ---------- situação ----------

export type SituacaoDaLista = 'todos' | 'aguardando' | 'aprovados' | 'rejeitados' | 'orcamentos' | 'na_fila';

export const ROTULO_SITUACAO: Record<SituacaoDaLista, string> = {
  todos: 'Todos',
  aguardando: 'Aguardando',
  aprovados: 'Aprovados',
  rejeitados: 'Rejeitados',
  orcamentos: 'Orçamentos',
  na_fila: 'Na fila',
};

const APROVADOS = ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced'];

/** A situação (um chip) a que o item pertence. Cancelado só aparece em Todos. */
export function situacaoDoItem(i: Pick<ItemDaBusca, 'tipo' | 'status' | 'local'>): Exclude<SituacaoDaLista, 'todos'> | null {
  if (i.tipo === 'orcamento') return 'orcamentos';
  if (i.local || i.status === 'queued') return 'na_fila';
  if (i.status === 'pending_approval') return 'aguardando';
  if (APROVADOS.includes(i.status)) return 'aprovados';
  if (i.status === 'rejected') return 'rejeitados';
  return null;
}

export function itemNaSituacao(i: Pick<ItemDaBusca, 'tipo' | 'status' | 'local'>, s: SituacaoDaLista): boolean {
  return s === 'todos' || situacaoDoItem(i) === s;
}

export type ContagemPorSituacao = Record<SituacaoDaLista, number> & { chips: Array<{ id: SituacaoDaLista; rotulo: string; quantidade: number }> };

/** Contagem para a linha única de chips; `chips` traz só as situações que têm itens (e Todos). */
export function contarPorSituacao(itens: readonly ItemDaBusca[]): ContagemPorSituacao {
  const c: Record<SituacaoDaLista, number> = { todos: itens.length, aguardando: 0, aprovados: 0, rejeitados: 0, orcamentos: 0, na_fila: 0 };
  for (const i of itens) {
    const s = situacaoDoItem(i);
    if (s) c[s] += 1;
  }
  const ordem: SituacaoDaLista[] = ['todos', 'aguardando', 'aprovados', 'rejeitados', 'orcamentos', 'na_fila'];
  const chips = ordem.filter((id) => id === 'todos' || c[id] > 0).map((id) => ({ id, rotulo: ROTULO_SITUACAO[id], quantidade: c[id] }));
  return { ...c, chips };
}

/** "9 pedidos · R$ 4.023": pedidos que valem (sem orçamento e sem cancelado; RN-VEN-18, RN-CORE-21). */
export function resumoDaLista(itens: readonly ItemDaBusca[]): { quantidade: number; total_cents: number } {
  const v = itens.filter((i) => i.tipo !== 'orcamento' && i.status !== 'cancelled');
  return { quantidade: v.length, total_cents: v.reduce((s, i) => s + i.total_cents, 0) };
}

/** Janela de pedidos que o aparelho guarda (dias). */
export const JANELA_DIAS = 90;

/** Último dia (AAAA-MM-DD) do período. */
function ultimoDia(p: Periodo): string {
  if (p.tipo === 'dia') return p.valor;
  if (p.tipo === 'ano') return `${p.valor}-12-31`;
  const [a, m] = p.valor.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/**
 * RF-VEN-05: o período inteiro é anterior à janela do aparelho (mais de 90 dias): só o servidor tem; sem sinal a tela diz
 * "Disponível com conexão".
 */
export function periodoForaDaJanela(p: Periodo, agora: string | Date, tz: string, dias = JANELA_DIAS): boolean {
  const t = typeof agora === 'string' ? new Date(agora).getTime() : agora.getTime();
  return ultimoDia(p) < localIsoDate(new Date(t - dias * 86_400_000), tz);
}

/**
 * RF-VEN-05: o período começa antes da janela do aparelho e termina dentro dela (ex.: agosto): a lista mostra só o que o
 * aparelho tem e a tela avisa.
 */
export function periodoParcialNaJanela(p: Periodo, agora: string | Date, tz: string, dias = JANELA_DIAS): boolean {
  if (periodoForaDaJanela(p, agora, tz, dias)) return false;
  const t = typeof agora === 'string' ? new Date(agora).getTime() : agora.getTime();
  const limite = localIsoDate(new Date(t - dias * 86_400_000), tz);
  const primeiro = p.tipo === 'dia' ? p.valor : p.tipo === 'mes' ? `${p.valor}-01` : `${p.valor}-01-01`;
  return primeiro < limite;
}

/** Situação da lista que a tela escolhida (chip, card do Início) vale: com texto na busca vale sempre Todos. */
export function situacaoEfetiva<S extends string>(escolhida: S, buscando: boolean): S | 'todos' {
  return buscando ? 'todos' : escolhida;
}

/** Linha de chips com o chip ativo sempre presente, mesmo com 0 itens (não some sob o dedo). */
export function chipsComAtivo(chips: ContagemPorSituacao['chips'], ativo: string): ContagemPorSituacao['chips'] {
  if (chips.some((c) => c.id === ativo) || !(ativo in ROTULO_SITUACAO)) return chips;
  const id = ativo as SituacaoDaLista;
  return [...chips, { id, rotulo: ROTULO_SITUACAO[id], quantidade: 0 }];
}

/** Resumo da tela: com o chip Orçamentos ativo conta e soma os orçamentos; nos demais, os pedidos que valem. */
export function resumoDaSituacao(itens: readonly ItemDaBusca[], situacao: string): { quantidade: number; total_cents: number; orcamentos: boolean } {
  if (situacao === 'orcamentos') {
    const o = itens.filter((i) => i.tipo === 'orcamento');
    return { quantidade: o.length, total_cents: o.reduce((s, i) => s + i.total_cents, 0), orcamentos: true };
  }
  return { ...resumoDaLista(itens), orcamentos: false };
}

/**
 * T-0077 D1 (RF-VEN-05): data da última mudança de status do pedido, a partir dos eventos do aparelho (`pedido_evento`,
 * `de` ≠ nulo = troca de status). Só o evento de criação = nunca mudou (null). Sem nenhum evento no aparelho, cai no
 * `updated_at` da linha (aproximação); vazio = null.
 */
export function ultimaMudancaDeStatus(eventos: ReadonlyArray<{ de: string | null; ocorrido_em: string }>, updatedAt: string): string | null {
  if (eventos.length === 0) return updatedAt || null;
  let ultima: string | null = null;
  for (const e of eventos) if (e.de !== null && (ultima === null || e.ocorrido_em > ultima)) ultima = e.ocorrido_em;
  return ultima;
}
