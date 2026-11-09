/**
 * RN-CORE-36 / RN-VEN-16 / RN-VEN-24: pendências de preenchimento do Novo pedido, cada uma com a aba onde se corrige.
 * Função pura; a tela só mostra o bloco "Falta para salvar" no Resumo e a bolinha na aba (padrão em `@macuxi/ui`).
 * O formato de cada pendência é o `PendenciaPreenchimento` do `@macuxi/ui` (id estável, texto sem verbo e sem ponto final, aba).
 * RD-0037: o texto e a aba vêm do CÓDIGO do erro (`PENDENCIA_POR_CODIGO`), nunca da comparação com a mensagem.
 */
export type AbaDoPedido = 'venda' | 'itens' | 'entrega' | 'resumo';

export interface PendenciaDoPedido {
  id: string;
  texto: string;
  aba: AbaDoPedido;
}

/** Código estável de cada erro do cálculo; a mensagem é só texto para o vendedor, nunca é lida para decidir. */
export type CodigoErroCalculo = 'sem_preco' | 'medida_indisponivel' | 'desconto_e_acrescimo' | 'desconto_acima_total' | 'desconto_acima_tabela' | 'acima_alcada';
/** RN-VEN-24/25: código estável da recusa do pagamento (vem de `validarPagamento`). */
export type CodigoErroPagamento = 'forma_indisponivel' | 'prazo_indisponivel' | 'forma_nao_aceita' | 'prazo_acima_medio';

/** Erro do cálculo do pedido: `alvo` = `'pedido'` ou o nome do item; `limite` só na alçada (ex.: "20%"). */
export interface ErroDeCalculo {
  codigo: CodigoErroCalculo;
  alvo: 'pedido' | { item: string };
  mensagem: string;
  limite?: string;
}

export interface EntradaPendencias {
  itens: number;
  quantidade_invalida: boolean;
  /** Situação do pagamento (forma e prazo ficam na aba Venda). */
  pagamento: { tipo: 'ok' } | { tipo: 'sem_forma_permitida' } | { tipo: 'forma' } | { tipo: 'prazo' } | { tipo: 'invalido'; codigo: CodigoErroPagamento; mensagem: string };
  /** Frete (RN-VEN-16): `transportadora` = FOB sem transportadora; `cnpj` = transportadora digitada com CNPJ inválido. */
  frete: 'ok' | 'transportadora' | 'cnpj';
  /** `CalculoPedido.pendencias`: erros do cálculo (item sem preço, medida, desconto, alçada), com código. */
  erros_calculo: readonly ErroDeCalculo[];
}

const NOMES_DA_ABA: Record<AbaDoPedido, string> = { venda: 'Venda', itens: 'Itens', entrega: 'Entrega', resumo: 'Resumo' };

type Alvo = ErroDeCalculo['alvo'];
const nomeDoAlvo = (a: Alvo): string => (a === 'pedido' ? 'pedido' : a.item);

/** Código → o que falta, em substantivo (spec §1.2): sem ordem ("Reduza…") e sem "Pedido:". Erros do pedido inteiro (ajuste, alçada) se corrigem no Resumo; os de item, em Itens. */
export const PENDENCIA_POR_CODIGO: Record<CodigoErroCalculo | CodigoErroPagamento, { texto: (alvo: Alvo, limite?: string) => string; aba: (alvo: Alvo) => AbaDoPedido }> = {
  sem_preco: { texto: (a) => `${nomeDoAlvo(a)} sem preço na tabela do cliente`, aba: () => 'itens' },
  medida_indisponivel: { texto: (a) => `Medida de ${nomeDoAlvo(a)}`, aba: () => 'itens' },
  desconto_e_acrescimo: {
    texto: (a) => (a === 'pedido' ? 'Desconto ou acréscimo do pedido (só um dos dois)' : `Desconto ou acréscimo de ${a.item} (só um dos dois)`),
    aba: (a) => (a === 'pedido' ? 'resumo' : 'itens'),
  },
  desconto_acima_total: { texto: () => 'Desconto do pedido acima do total dos itens', aba: () => 'resumo' },
  desconto_acima_tabela: { texto: (a) => `Desconto de ${nomeDoAlvo(a)} acima do preço de tabela`, aba: () => 'itens' },
  acima_alcada: { texto: (_a, limite) => `Desconto acima da alçada máxima${limite ? ` (${limite})` : ''}`, aba: () => 'resumo' },
  forma_indisponivel: { texto: () => 'Forma de pagamento (a escolhida saiu da lista)', aba: () => 'venda' },
  prazo_indisponivel: { texto: () => 'Prazo de pagamento (o escolhido não vale para esta forma)', aba: () => 'venda' },
  forma_nao_aceita: { texto: () => 'Forma de pagamento aceita pelo cliente', aba: () => 'venda' },
  prazo_acima_medio: { texto: () => 'Prazo dentro do prazo médio do cliente', aba: () => 'venda' },
};

/** Pendências na ordem das abas: Venda (forma, prazo), Itens (itens, cálculo), Entrega (frete), Resumo (ajuste do pedido). */
export function pendenciasDePreenchimento(e: EntradaPendencias): PendenciaDoPedido[] {
  const r: PendenciaDoPedido[] = [];
  if (e.itens === 0) r.push({ id: 'sem-item', texto: 'Pelo menos 1 item', aba: 'itens' });
  if (e.quantidade_invalida) r.push({ id: 'quantidade', texto: 'Quantidade dos itens', aba: 'itens' });
  switch (e.pagamento.tipo) {
    case 'sem_forma_permitida':
      r.push({ id: 'forma', texto: 'Forma de pagamento aceita pelo cliente', aba: 'venda' });
      break;
    case 'forma':
      r.push({ id: 'forma', texto: 'Forma de pagamento', aba: 'venda' });
      break;
    case 'prazo':
      r.push({ id: 'prazo', texto: 'Prazo de pagamento', aba: 'venda' });
      break;
    case 'invalido':
      r.push({ id: 'pagamento', texto: PENDENCIA_POR_CODIGO[e.pagamento.codigo].texto('pedido'), aba: 'venda' });
      break;
    default:
  }
  e.erros_calculo.forEach((x, i) => {
    const d = PENDENCIA_POR_CODIGO[x.codigo];
    r.push({ id: `calculo-${i}`, texto: d.texto(x.alvo, x.limite), aba: d.aba(x.alvo) });
  });
  if (e.frete !== 'ok') r.push({ id: 'frete', texto: e.frete === 'cnpj' ? 'CNPJ da transportadora' : 'Transportadora do frete FOB', aba: 'entrega' });
  const ordem: AbaDoPedido[] = ['venda', 'itens', 'entrega', 'resumo'];
  return r.map((p, i) => ({ p, i })).sort((a, b) => ordem.indexOf(a.p.aba) - ordem.indexOf(b.p.aba) || a.i - b.i).map((x) => x.p);
}

/** Linha do bloco: "Transportadora do frete FOB — aba Entrega". */
export function linhaDaPendenciaDoPedido(p: PendenciaDoPedido): string {
  return `${p.texto} — aba ${NOMES_DA_ABA[p.aba]}`;
}
