/**
 * Curvas ABC do cliente (RN-CORE-49): mês atual contra a média dos 3 meses anteriores, em três dimensões
 * (faturamento, volume, frequência). Funções puras; faixas por tenant pelo mecanismo `parametro` (módulo `core`).
 * Decisão do dono do produto (14/11/2026, 6h16): "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média.
 * Curva C abaixo da media." Ou seja: A ≥ +20%; B de 0% (inclusive, na média) até abaixo de +20%; C abaixo de 0%.
 */
import {
  CURVA_ABC_PCT_MAX,
  CURVA_ABC_PCT_MIN,
  DIMENSOES_CURVA_ABC,
  PARAMETRO_CURVA_ABC_FATURAMENTO,
  PARAMETRO_CURVA_ABC_FREQUENCIA,
  PARAMETRO_CURVA_ABC_VOLUME,
  type DimensaoCurvaAbc,
  type ErroParametroCurvaAbc,
  type FaixaCurvaAbc,
  type ParametrosCurvaAbc,
} from '../contracts/curvas-abc';
export type FaixasCurvaAbc = FaixaCurvaAbc;
export type FaixasPorDimensao = ParametrosCurvaAbc;

export const FAIXAS_CURVA_ABC_PADRAO: FaixasCurvaAbc = { a_min_pct: 20, b_min_pct: 0 };
/** Padrão por dimensão (RN-CORE-49): cada dimensão começa igual. */
export const PARAMETROS_CURVA_ABC_PADRAO: ParametrosCurvaAbc = {
  faturamento: { ...FAIXAS_CURVA_ABC_PADRAO },
  volume: { ...FAIXAS_CURVA_ABC_PADRAO },
  frequencia: { ...FAIXAS_CURVA_ABC_PADRAO },
};
export const CHAVE_DA_DIMENSAO: Record<DimensaoCurvaAbc, string> = {
  faturamento: PARAMETRO_CURVA_ABC_FATURAMENTO,
  volume: PARAMETRO_CURVA_ABC_VOLUME,
  frequencia: PARAMETRO_CURVA_ABC_FREQUENCIA,
};
const PCT_MIN = CURVA_ABC_PCT_MIN;
const PCT_MAX = CURVA_ABC_PCT_MAX;

export type CurvaAbc = 'A' | 'B' | 'C';
export type DimensaoCurva = DimensaoCurvaAbc;
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
  if (pct >= faixas.b_min_pct) return 'B';
  return 'C';
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
export function curvasAbcDoCliente(historico: readonly LinhaHistoricoCurva[], hoje: string, parametros: FaixasPorDimensao): CurvaDoCliente[] {
  const atual = hoje.slice(0, 7);
  const anteriores = [1, 2, 3].map((n) => mesAnterior(atual, n));
  const limite = anteriores[2] as string;
  if (!historico.some((x) => x.ano_mes <= limite)) return [];
  const saida: CurvaDoCliente[] = [];
  for (const d of DIMENSOES) {
    const media = anteriores.reduce((s, m) => s + somaDoMes(historico, m, d.campo), 0) / 3;
    if (media <= 0) continue;
    const pct = ((somaDoMes(historico, atual, d.campo) - media) / media) * 100;
    const curva = curvaPelaVariacao(pct, parametros[d.dimensao]);
    saida.push({ dimensao: d.dimensao, curva, rotulo: `${d.nome} ${curva}` });
  }
  return saida;
}

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

const pctValido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= PCT_MIN && v <= PCT_MAX;
const faixaValida = (v: unknown): v is FaixaCurvaAbc => {
  if (typeof v !== 'object' || v === null) return false;
  const { a_min_pct: a, b_min_pct: b } = v as Record<string, unknown>;
  return pctValido(a) && pctValido(b) && a > b;
};

/** Faixas efetivas das 3 dimensões a partir das linhas `parametro`; cada dimensão ausente, apagada ou inválida cai no padrão sozinha. */
export function faixasCurvaAbcDasLinhas(linhas: readonly Linha[]): FaixasPorDimensao {
  const faixa = (d: DimensaoCurvaAbc): FaixaCurvaAbc => {
    const v = linhas.find((x) => x.modulo === 'core' && x.chave === CHAVE_DA_DIMENSAO[d] && !x.deleted_at)?.valor;
    return faixaValida(v) ? { a_min_pct: v.a_min_pct, b_min_pct: v.b_min_pct } : { ...FAIXAS_CURVA_ABC_PADRAO };
  };
  return { faturamento: faixa('faturamento'), volume: faixa('volume'), frequencia: faixa('frequencia') };
}

export const ROTULOS_DIMENSAO_CURVA: Record<DimensaoCurvaAbc, string> = { faturamento: 'Faturamento', volume: 'Volume', frequencia: 'Frequência' };

export type ResultadoParametrosCurvaAbc = { ok: true; valores: ParametrosCurvaAbc } | { ok: false; erros: ErroParametroCurvaAbc[] };

/** RN-CORE-49: valida a edição do BKO. Mensagens em português com a ação seguinte; o campo é `<dimensao>.<a_min_pct|b_min_pct>`. */
export function validarParametrosCurvaAbc(e: ParametrosCurvaAbc): ResultadoParametrosCurvaAbc {
  const erros: ErroParametroCurvaAbc[] = [];
  for (const d of DIMENSOES_CURVA_ABC) {
    const f = e[d];
    const nome = ROTULOS_DIMENSAO_CURVA[d];
    const bom = { a_min_pct: pctValido(f.a_min_pct), b_min_pct: pctValido(f.b_min_pct) };
    for (const c of ['a_min_pct', 'b_min_pct'] as const) {
      if (!bom[c]) erros.push({ campo: `${d}.${c}`, mensagem: `${nome}: informe um percentual de ${PCT_MIN} a ${PCT_MAX} para a curva ${c === 'a_min_pct' ? 'A' : 'B'}.` });
    }
    if (bom.a_min_pct && bom.b_min_pct && f.a_min_pct <= f.b_min_pct) erros.push({ campo: `${d}.a_min_pct`, mensagem: `${nome}: a curva A deve começar acima da curva B. Aumente o valor de A ou diminua o de B.` });
  }
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, valores: { faturamento: { ...e.faturamento }, volume: { ...e.volume }, frequencia: { ...e.frequencia } } };
}
