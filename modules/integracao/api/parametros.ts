/**
 * Parâmetros do Hub lidos de `plataforma.parametro` (módulo `integracao`, via `ctx.parametros()`): mesclados sobre
 * `PARAMETROS_PADRAO`. Valor fora da faixa ou do tipo = padrão + aviso no log (nunca derruba a rota; desenho T-0032 §7).
 */
import type { LogRota } from '@macuxi/platform-sdk';
import { PARAMETROS_PADRAO, type ParametrosHub } from '../domain';

/** Chaves numéricas simples: `minimo` (inclusive) e se aceita fração. */
const NUMEROS: Readonly<Partial<Record<keyof ParametrosHub, { minimo: number; inteiro: boolean }>>> = {
  limiteRegistrosLote: { minimo: 1, inteiro: true },
  toleranciaContagem: { minimo: 0, inteiro: false },
  toleranciaSomaPct: { minimo: 0, inteiro: false },
  timeoutEnvioMin: { minimo: 1, inteiro: false },
  janelaVersaoAnteriorMeses: { minimo: 0, inteiro: false },
  ttlSessaoMin: { minimo: 1, inteiro: false },
  limiteInativacaoPct: { minimo: 0.01, inteiro: false },
  limiteLinhasInvalidas: { minimo: 0, inteiro: true },
  limiteCorpoLoteBytes: { minimo: 1024, inteiro: true },
  limiteCorpoGeralBytes: { minimo: 1024, inteiro: true },
  convivenciaChaveMin: { minimo: 0, inteiro: true },
  convivenciaChaveMaxMin: { minimo: 1, inteiro: true },
  ttlConfirmacaoInativacaoDias: { minimo: 1, inteiro: true },
  pedidosPorConsulta: { minimo: 1, inteiro: true },
  tentativasAlertaPedido: { minimo: 1, inteiro: true },
  esperaMaxDependenciaMin: { minimo: 0, inteiro: false },
  sinalAtrasadoMin: { minimo: 1, inteiro: false },
  sinalAlertaMin: { minimo: 1, inteiro: false },
};

const MAXIMOS: Readonly<Partial<Record<keyof ParametrosHub, number>>> = {
  limiteInativacaoPct: 100,
  limiteCorpoLoteBytes: 32 * 1024 * 1024,
  limiteCorpoGeralBytes: 32 * 1024 * 1024,
  limiteRegistrosLote: 50_000,
  pedidosPorConsulta: 100,
};

function balde(v: unknown): { capacidade: number; reposicaoPorMin: number } | null {
  if (!v || typeof v !== 'object') return null;
  const { capacidade, reposicaoPorMin } = v as Record<string, unknown>;
  if (typeof capacidade !== 'number' || typeof reposicaoPorMin !== 'number') return null;
  if (!Number.isFinite(capacidade) || !Number.isFinite(reposicaoPorMin) || capacidade < 1 || reposicaoPorMin <= 0) return null;
  return { capacidade, reposicaoPorMin };
}

/** Parâmetros efetivos do tenant: o que for válido substitui o padrão; o resto fica no padrão e vai para o log como aviso. */
export function lerParametrosHub(brutos: Readonly<Record<string, unknown>>, log?: LogRota): ParametrosHub {
  const saida: Record<string, unknown> = { ...PARAMETROS_PADRAO };
  const recusados: string[] = [];
  for (const [chave, valor] of Object.entries(brutos)) {
    if (!Object.hasOwn(PARAMETROS_PADRAO, chave)) continue;
    const regra = NUMEROS[chave as keyof ParametrosHub];
    if (regra) {
      const max = MAXIMOS[chave as keyof ParametrosHub];
      const ok = typeof valor === 'number' && Number.isFinite(valor) && valor >= regra.minimo && (!regra.inteiro || Number.isInteger(valor)) && (max === undefined || valor <= max);
      if (ok) saida[chave] = valor;
      else recusados.push(chave);
    } else if (chave === 'versoesSuportadas') {
      if (Array.isArray(valor) && valor.length > 0 && valor.every((x) => typeof x === 'string' && x.length > 0)) saida[chave] = Object.freeze([...(valor as string[])]);
      else recusados.push(chave);
    } else if (chave === 'taxaPorConector') {
      const o = valor as Record<string, unknown> | null;
      const lote = balde(o?.lote);
      const geral = balde(o?.geral);
      if (lote && geral) saida[chave] = { lote, geral };
      else recusados.push(chave);
    }
  }
  if (recusados.length > 0) log?.warn({ parametros: recusados }, 'parâmetro do Hub fora da faixa: usando o padrão');
  return saida as unknown as ParametrosHub;
}
