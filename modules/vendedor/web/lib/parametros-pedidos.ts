import { VALIDADE_MAX_DIAS, VALIDADE_MIN_DIAS, TITULO_VENCIDO_DIAS_MAX, TITULO_VENCIDO_DIAS_MIN, validarTituloVencidoDias, validarValidadeOrcamentoDias, type ResultadoParametroPedidos } from '../../domain';
import type { ParametrosPedidos } from '../../contracts';

export type ChaveParametroPedidos = keyof ParametrosPedidos;

export interface CampoParametroPedidos {
  rotulo: string;
  ajuda: string;
  sucesso: string;
  validar: (valor: unknown) => ResultadoParametroPedidos;
}

/** Textos e regra de cada painel de Parâmetros › Pedidos (spec 7.3 e 7.4); o formulário é um só. */
export const CAMPOS_PARAMETROS_PEDIDOS: Record<ChaveParametroPedidos, CampoParametroPedidos> = {
  titulo_vencido_dias: {
    rotulo: 'Atraso tolerado',
    ajuda: `De ${TITULO_VENCIDO_DIAS_MIN} a ${TITULO_VENCIDO_DIAS_MAX} dias. Acima desse atraso, o pedido do cliente vai para aprovação.`,
    sucesso: 'Atraso tolerado salvo.',
    validar: validarTituloVencidoDias,
  },
  validade_orcamento_dias: {
    rotulo: 'Preço vale por',
    ajuda: `De ${VALIDADE_MIN_DIAS} a ${VALIDADE_MAX_DIAS} dias corridos depois do dia em que o orçamento é salvo. Depois, o orçamento vira pedido pelo preço do dia.`,
    sucesso: 'Preço do orçamento salvo.',
    validar: validarValidadeOrcamentoDias,
  },
};

/** RN-VEN-13 e RN-VEN-18: `null` = a pessoa não mexeu (vale o salvo). Salvar só liga com valor diferente do salvo. */
export function alterado(texto: string | null, salvo: number): boolean {
  return texto !== null && texto !== String(salvo);
}

/** Valida ao tocar em Salvar: vazio ou fora da faixa devolve a mensagem do domain ("Use um número de ..."). */
export function conferirParametro(campo: CampoParametroPedidos, texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const t = texto.trim();
  const r = campo.validar(t === '' ? Number.NaN : Number(t));
  return r.ok ? { ok: true, valor: r.valor } : { ok: false, erro: r.mensagem };
}
