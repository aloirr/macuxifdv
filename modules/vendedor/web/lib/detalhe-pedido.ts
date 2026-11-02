import { OrderDetail } from '../../contracts';

export const MSG_ITENS_INDISPONIVEIS = 'Não foi possível carregar os itens deste pedido. Tente de novo; se continuar, avise o suporte.';
export const MSG_SEM_DOCUMENTO = 'CNPJ/CPF não informado no cadastro do cliente.';
export const DICA_PDF_SEM_DETALHE = 'Os itens do pedido ainda não carregaram. Use "Tentar de novo" no detalhe e depois gere o PDF.';

/**
 * T-0059: leitura tolerante SÓ na exibição. Pedido antigo cujo retrato do cliente veio sem documento (nulo/ausente)
 * abre normalmente, com `semDocumento` para o aviso em português. O contrato de escrita (`ClienteDoPedido`) segue exigindo documento.
 */
export function lerDetalheDoPedido(bruto: unknown): { pedido: OrderDetail; semDocumento: boolean } {
  let semDocumento = false;
  let entrada = bruto;
  const cliente = (bruto as { cliente?: { documento?: unknown } | null } | null)?.cliente;
  if (cliente && typeof cliente === 'object' && (cliente.documento == null || (typeof cliente.documento === 'string' && cliente.documento.trim() === ''))) {
    semDocumento = true;
    entrada = { ...(bruto as object), cliente: { ...cliente, documento: '' } };
  }
  const pedido = OrderDetail.parse(entrada);
  return { pedido, semDocumento };
}
