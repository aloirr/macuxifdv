/**
 * Validade próxima e avarias (RF-PRO-07, RN-PRO-08). Datas de vencimento são datas civis `AAAA-MM-DD`;
 * o "hoje" é a data civil no fuso do tenant (instantes ficam em UTC; ver `dataLocal`).
 */
import { diffDays, localDate } from '@macuxi/comum';
import { ehDataCivil, ehInteiroNaoNegativo } from './numeros';
import { resolverParametros, type ParametrosPromotor } from './parametros';

export const FAIXAS_RISCO = ['vencido', 'critico', 'atencao', 'ok'] as const;
export type FaixaRisco = (typeof FAIXAS_RISCO)[number];

export const ROTULO_FAIXA_RISCO: Readonly<Record<FaixaRisco, string>> = {
  vencido: 'Vencido',
  critico: 'Crítico',
  atencao: 'Atenção',
  ok: 'Dentro do prazo',
};

/** Data civil (AAAA-MM-DD) de um instante UTC no fuso do tenant (padrão America/Manaus). */
export function dataLocal(instante: Date | string, fuso = 'America/Manaus'): string {
  return localDate(typeof instante === 'string' ? new Date(instante) : instante, fuso);
}

/** Dias até vencer = validade − hoje, em dias civis (negativo = já venceu). */
export function diasAteVencer(validade: string, hoje: string): number {
  if (!ehDataCivil(validade) || !ehDataCivil(hoje)) throw new RangeError('Informe as datas no formato AAAA-MM-DD.');
  return diffDays(hoje, validade);
}

type LimitesValidade = Pick<ParametrosPromotor, 'validade_proxima_dias' | 'validade_critica_dias'>;

/** RN-PRO-08: validade próxima = vencimento em até [30] dias (inclui o que já venceu). */
export function ehValidadeProxima(dias: number, limiteDias: number = resolverParametros().validade_proxima_dias): boolean {
  return dias <= limiteDias;
}

/**
 * Faixa de risco (definida pelo Promotor sobre RN-PRO-08): vencido (< 0 dia), crítico (0 a 7),
 * atenção (8 até o limite de validade próxima, 30) e ok (acima). Limites configuráveis.
 */
export function faixaDeRisco(dias: number, limites: Partial<LimitesValidade> = {}): FaixaRisco {
  const p = resolverParametros(limites);
  if (dias < 0) return 'vencido';
  if (dias <= p.validade_critica_dias) return 'critico';
  if (dias <= p.validade_proxima_dias) return 'atencao';
  return 'ok';
}

export function validarItemValidade(i: { validade: string; quantidade: number }): string[] {
  const erros: string[] = [];
  if (!ehDataCivil(i.validade)) erros.push('Informe a data de validade no formato dia/mês/ano.');
  if (!ehInteiroNaoNegativo(i.quantidade) || i.quantidade < 1) erros.push('Informe a quantidade como número inteiro, de 1 em diante.');
  return erros;
}

export interface ResumoValidade {
  por_faixa: Record<FaixaRisco, { itens: number; unidades: number }>;
  /** Itens com validade próxima (≤ limite), incluindo vencidos. */
  proximas_itens: number;
  proximas_unidades: number;
}

export function resumirValidade(
  itens: readonly { validade: string; quantidade: number }[],
  hoje: string,
  limites: Partial<LimitesValidade> = {},
): ResumoValidade {
  const p = resolverParametros(limites);
  const por_faixa = Object.fromEntries(FAIXAS_RISCO.map((f) => [f, { itens: 0, unidades: 0 }])) as ResumoValidade['por_faixa'];
  let proximas_itens = 0;
  let proximas_unidades = 0;
  for (const i of itens) {
    const dias = diasAteVencer(i.validade, hoje);
    const f = faixaDeRisco(dias, p);
    por_faixa[f].itens += 1;
    por_faixa[f].unidades += i.quantidade;
    if (ehValidadeProxima(dias, p.validade_proxima_dias)) {
      proximas_itens += 1;
      proximas_unidades += i.quantidade;
    }
  }
  return { por_faixa, proximas_itens, proximas_unidades };
}

/** RF-PRO-07: avaria exige quantidade, motivo e foto. */
export function validarAvaria(a: { quantidade: number; motivo: string; tem_foto: boolean }): string[] {
  const erros: string[] = [];
  if (!ehInteiroNaoNegativo(a.quantidade) || a.quantidade < 1) erros.push('Informe a quantidade avariada como número inteiro, de 1 em diante.');
  if (!a.motivo.trim()) erros.push('Informe o motivo da avaria.');
  if (!a.tem_foto) erros.push('Tire a foto do produto avariado.');
  return erros;
}

export interface ResumoAvarias {
  ocorrencias: number;
  unidades: number;
  por_motivo: Record<string, number>;
}

export function resumirAvarias(avarias: readonly { quantidade: number; motivo: string }[]): ResumoAvarias {
  const por_motivo: Record<string, number> = {};
  let unidades = 0;
  for (const a of avarias) {
    unidades += a.quantidade;
    por_motivo[a.motivo] = (por_motivo[a.motivo] ?? 0) + a.quantidade;
  }
  return { ocorrencias: avarias.length, unidades, por_motivo };
}
