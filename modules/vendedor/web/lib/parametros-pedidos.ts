import {
  MSG_PEDIDO_MINIMO_CENTS,
  VALIDADE_MAX_DIAS,
  VALIDADE_MIN_DIAS,
  TITULO_VENCIDO_DIAS_MAX,
  TITULO_VENCIDO_DIAS_MIN,
  validarPedidoMinimoCents,
  validarTituloVencidoDias,
  validarValidadeOrcamentoDias,
  type AcaoCreditoExcedido,
  type AcaoEstoqueInsuficiente,
  type ResultadoParametroPedidos,
} from '../../domain';
import type { ParametrosPedidos } from '../../contracts';

/** As chaves em dias (o formulário numérico); as outras três têm painel próprio. */
export type ChaveParametroPedidos = 'titulo_vencido_dias' | 'validade_orcamento_dias';
export type ChaveDoPainelPedidos = keyof ParametrosPedidos;

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

/** Textos de sucesso de cada painel (spec 7.3, 7.4 e 7.5). */
export const SUCESSO_PARAMETRO: Record<ChaveDoPainelPedidos, string> = {
  titulo_vencido_dias: CAMPOS_PARAMETROS_PEDIDOS.titulo_vencido_dias.sucesso,
  validade_orcamento_dias: CAMPOS_PARAMETROS_PEDIDOS.validade_orcamento_dias.sucesso,
  pedido_minimo_cents: 'Pedido mínimo salvo.',
  credito_excedido_acao: 'Crédito excedido salvo.',
  estoque_insuficiente_acao: 'Estoque insuficiente salvo.',
};

/** RN-VEN-22 (spec 7.5.1): "R$ 1.500,00" digitado com vírgula vira centavos. Texto vazio ou fora do formato = `NaN`. */
export function centavosDoTexto(texto: string): number {
  const t = texto.trim().replace(/\./g, '');
  if (!/^\d+(,\d{1,2})?$/.test(t)) return Number.NaN;
  const [reais, centavos = ''] = t.split(',');
  return Number(reais) * 100 + Number(centavos.padEnd(2, '0'));
}

/** Centavos como o campo mostra: "1.500,00" (o "R$" fica no campo). */
export function textoDeCentavos(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** RN-VEN-22: com "Exigir a partir de" marcada vale de R$ 0,01 a R$ 100.000,00; vazio, zero ou fora devolve a mensagem do domain. */
export function conferirPedidoMinimo(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const cents = centavosDoTexto(texto);
  const r = validarPedidoMinimoCents(cents);
  return r.ok && r.valor > 0 ? { ok: true, valor: r.valor } : { ok: false, erro: MSG_PEDIDO_MINIMO_CENTS };
}

export interface OpcaoDeAcao<T extends string> {
  valor: T;
  rotulo: string;
  /** só "Enviar para aprovação" tem apoio (spec 7.5): o resto é o rótulo */
  apoio?: string;
}

/** RN-VEN-12 (spec 7.5.2): pedido a prazo acima do crédito disponível. */
export const OPCOES_CREDITO_EXCEDIDO: readonly OpcaoDeAcao<AcaoCreditoExcedido>[] = [
  { valor: 'aprovacao', rotulo: 'Enviar para aprovação', apoio: 'Quem aprova está em Alçadas.' },
  { valor: 'orcamento', rotulo: 'Só como orçamento' },
  { valor: 'avisar', rotulo: 'Avisar e enviar' },
];

/** RN-VEN-20 (spec 7.5.3): item com quantidade acima do estoque da filial. */
export const OPCOES_ESTOQUE_INSUFICIENTE: readonly OpcaoDeAcao<AcaoEstoqueInsuficiente>[] = [
  { valor: 'orcamento', rotulo: 'Só como orçamento' },
  { valor: 'aprovacao', rotulo: 'Enviar para aprovação', apoio: 'Quem aprova está em Alçadas.' },
  { valor: 'avisar', rotulo: 'Avisar e enviar' },
];
