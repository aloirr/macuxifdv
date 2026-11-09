import { formatarDocumento } from '@macuxi/comum';
import { formatarCep } from '@macuxi/comum/endereco';
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

// ---------- novo pedido de distribuidora (T-0061): frete, transportadora e endereço no detalhe ----------
/** "CIF · por conta da empresa" / "FOB · por conta do cliente". */
export function textoDaModalidade(f: OrderDetail['freight']): string {
  if (!f) return '—';
  return f.modality === 'CIF' ? 'CIF · por conta da empresa' : 'FOB · por conta do cliente';
}

/** Transportadora do FOB: nome, CNPJ formatado e telefone; "digitada" avisa que não está na lista do BKO. */
export function textoDaTransportadora(f: OrderDetail['freight']): string | null {
  if (!f || f.modality !== 'FOB' || !f.carrier_name) return null;
  const cnpj = f.carrier_document ? ` · CNPJ ${formatarDocumento(f.carrier_document)}` : '';
  const fone = f.carrier_phone ? ` · ${f.carrier_phone}` : '';
  return `${f.carrier_name}${cnpj}${fone}${f.carrier_typed ? ' · digitada pelo vendedor' : ''}`;
}

/** RN-VEN-17 (T-0141): selo do endereço digitado só neste pedido; o PDF não leva a marca. */
export const SELO_ENDERECO_EDITADO = 'Editado neste pedido';
export function enderecoFoiEditado(e: OrderDetail['delivery_address']): boolean {
  return e?.origem === 'editado';
}

export function textoDoEnderecoEntrega(e: OrderDetail['delivery_address']): string | null {
  if (!e) return null;
  const rua = [[e.logradouro, e.numero].filter((x) => x && x.trim()).join(', '), e.complemento].filter((x) => x && x.trim()).join(' – ');
  const cep = e.cep ? `CEP ${formatarCep(e.cep)}` : '';
  return [rua, e.bairro, e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : '', cep].filter((x) => x && x.trim()).join(' · ') || null;
}

/** Desconto/acréscimo do item para a tabela: "−10%", "+5%" ou "—". */
export function textoDoAjusteDoItem(it: OrderDetail['items'][number]): string {
  if ((it.surcharge_pct ?? 0) > 0) return `+${it.surcharge_pct!.toLocaleString('pt-BR')}%`;
  if (it.discount_pct > 0) return `−${it.discount_pct.toLocaleString('pt-BR')}%`;
  return '—';
}
