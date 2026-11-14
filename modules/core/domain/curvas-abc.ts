/**
 * Curvas ABC do cliente (RN-CORE-49): mês atual contra a média dos 3 meses anteriores, em três dimensões
 * (faturamento, volume, frequência). Funções puras; faixas por tenant pelo mecanismo `parametro` (módulo `core`).
 * Decisão do dono do produto (14/11/2026, 6h16): "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média.
 * Curva C abaixo da media." Ou seja: A ≥ +20%; B de 0% (inclusive, na média) até abaixo de +20%; C abaixo de 0%.
 */
export interface FaixasCurvaAbc {
  /** Variação mínima (%) sobre a média para a curva A. */
  a_min_pct: number;
  /** Variação (%) abaixo da qual é curva C. */
  c_abaixo_pct: number;
}

export const FAIXAS_CURVA_ABC_PADRAO: FaixasCurvaAbc = { a_min_pct: 20, c_abaixo_pct: 0 };
export const PARAMETRO_CURVA_A_MIN = 'cliente.curva_abc.a_min_pct';
export const PARAMETRO_CURVA_C_ABAIXO = 'cliente.curva_abc.c_abaixo_pct';
const PCT_MIN = -100;
const PCT_MAX = 1000;

export type CurvaAbc = 'A' | 'B' | 'C';
export type DimensaoCurva = 'faturamento' | 'volume' | 'frequencia';
export interface CurvaDoCliente {
  dimensao: DimensaoCurva;
  curva: CurvaAbc;
  rotulo: string;
}
export interface LinhaHistoricoCurva {
  ano_mes: string;
  valor_cents: number;
  itens: number;
  pedidos: number;
}

const DIMENSOES: ReadonlyArray<{ dimensao: DimensaoCurva; nome: string; campo: 'valor_cents' | 'itens' | 'pedidos' }> = [
  { dimensao: 'faturamento', nome: 'Faturamento', campo: 'valor_cents' },
  { dimensao: 'volume', nome: 'Volume', campo: 'itens' },
  { dimensao: 'frequencia', nome: 'Frequência', campo: 'pedidos' },
];

export function curvaPelaVariacao(pct: number, faixas: FaixasCurvaAbc): CurvaAbc {
  if (pct >= faixas.a_min_pct) return 'A';
  if (pct < faixas.c_abaixo_pct) return 'C';
  return 'B';
}

function mesAnterior(anoMes: string, n: number): string {
  const [a, m] = anoMes.split('-').map(Number) as [number, number];
  const idx = a * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Soma (ERP + Macuxi) do campo no mês. */
const somaDoMes = (h: readonly LinhaHistoricoCurva[], mes: string, campo: 'valor_cents' | 'itens' | 'pedidos') =>
  h.filter((x) => x.ano_mes === mes).reduce((s, x) => s + x[campo], 0);

export function totalDoMes(historico: readonly LinhaHistoricoCurva[], anoMes: string): number {
  return somaDoMes(historico, anoMes, 'valor_cents');
}

/** `hoje` = 'AAAA-MM-DD' (dia local do tenant). Sem histórico até o 3º mês anterior, `[]`. */
export function curvasAbcDoCliente(historico: readonly LinhaHistoricoCurva[], hoje: string, faixas: FaixasCurvaAbc): CurvaDoCliente[] {
  const atual = hoje.slice(0, 7);
  const anteriores = [1, 2, 3].map((n) => mesAnterior(atual, n));
  const limite = anteriores[2] as string;
  if (!historico.some((x) => x.ano_mes <= limite)) return [];
  const saida: CurvaDoCliente[] = [];
  for (const d of DIMENSOES) {
    const media = anteriores.reduce((s, m) => s + somaDoMes(historico, m, d.campo), 0) / 3;
    if (media <= 0) continue;
    const pct = ((somaDoMes(historico, atual, d.campo) - media) / media) * 100;
    const curva = curvaPelaVariacao(pct, faixas);
    saida.push({ dimensao: d.dimensao, curva, rotulo: `${d.nome} ${curva}` });
  }
  return saida;
}

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

const pctValido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= PCT_MIN && v <= PCT_MAX;

/** Faixas efetivas a partir das linhas `parametro`; ausente, apagada, inválida, ou a ≤ c, cai no padrão. */
export function faixasCurvaAbcDasLinhas(linhas: readonly Linha[]): FaixasCurvaAbc {
  const viva = (chave: string) => linhas.find((x) => x.modulo === 'core' && x.chave === chave && !x.deleted_at)?.valor;
  const a = viva(PARAMETRO_CURVA_A_MIN);
  const c = viva(PARAMETRO_CURVA_C_ABAIXO);
  const faixas = { a_min_pct: pctValido(a) ? a : FAIXAS_CURVA_ABC_PADRAO.a_min_pct, c_abaixo_pct: pctValido(c) ? c : FAIXAS_CURVA_ABC_PADRAO.c_abaixo_pct };
  return faixas.a_min_pct <= faixas.c_abaixo_pct ? { ...FAIXAS_CURVA_ABC_PADRAO } : faixas;
}
