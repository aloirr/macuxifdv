import { FAIXA_TITULO_VENCIDO_DIAS, FAIXA_VALIDADE_ORCAMENTO_DIAS, type ParametrosPedidos, type PutParametrosPedidosRequest } from '../../contracts';

/** Parâmetros › Pedidos (v1.0.37): o que a pessoa digitou, campo a campo. */
export interface FormParametrosPedidos {
  validade: string;
  atraso: string;
}

export const formDosParametrosPedidos = (p: ParametrosPedidos): FormParametrosPedidos => ({ validade: String(p.validade_orcamento_dias), atraso: String(p.titulo_vencido_dias) });

const inteiro = (t: string): number => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : Number.NaN);
const fora = (n: number, f: { min: number; max: number }) => !(n >= f.min && n <= f.max);

export interface ErrosParametrosPedidos {
  validade?: string;
  atraso?: string;
}

/** Mensagem de cada campo fora da faixa (a API revalida e responde 422 com a mesma faixa). */
export function errosDosParametrosPedidos(f: FormParametrosPedidos): ErrosParametrosPedidos {
  const erros: ErrosParametrosPedidos = {};
  if (fora(inteiro(f.validade), FAIXA_VALIDADE_ORCAMENTO_DIAS)) erros.validade = `Informe de ${FAIXA_VALIDADE_ORCAMENTO_DIAS.min} a ${FAIXA_VALIDADE_ORCAMENTO_DIAS.max} dias.`;
  if (fora(inteiro(f.atraso), FAIXA_TITULO_VENCIDO_DIAS)) erros.atraso = `Informe de ${FAIXA_TITULO_VENCIDO_DIAS.min} a ${FAIXA_TITULO_VENCIDO_DIAS.max} dias.`;
  return erros;
}

export const houveMudancaPedidos = (f: FormParametrosPedidos, salvo: FormParametrosPedidos): boolean => f.validade.trim() !== salvo.validade || f.atraso.trim() !== salvo.atraso;

/** Salvar liga só com mudança e sem erro. */
export const podeSalvarPedidos = (f: FormParametrosPedidos, salvo: FormParametrosPedidos): boolean => houveMudancaPedidos(f, salvo) && Object.keys(errosDosParametrosPedidos(f)).length === 0;

/** Corpo do PUT: só o que mudou. */
export function corpoDosParametrosPedidos(f: FormParametrosPedidos, salvo: FormParametrosPedidos): PutParametrosPedidosRequest {
  return {
    ...(f.validade.trim() !== salvo.validade ? { validade_orcamento_dias: inteiro(f.validade) } : {}),
    ...(f.atraso.trim() !== salvo.atraso ? { titulo_vencido_dias: inteiro(f.atraso) } : {}),
  };
}
