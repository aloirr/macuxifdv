import { imprimirHtml } from '@macuxi/platform-sdk/web';
import type { OrderDetail } from '../../../contracts';
import { buildOrderPdfHtml, orderPdfFileName, pdfDoPedido, type OrderPdfView } from '../../../domain/pdf-pedido';

/** Abre o diálogo de impressão do PDF do pedido (cliente | interno), pela gaveta ou pelo "⋯" da linha. */
export async function exportarPdfDoPedido(dados: OrderDetail, view: OrderPdfView, ctx: { empresa: string; tz: string }): Promise<void> {
  const pdf = pdfDoPedido(dados);
  const html = buildOrderPdfHtml(pdf, view, { tenant_name: ctx.empresa, product_name: 'Macuxi FDV', tz: ctx.tz, generated_at: new Date().toISOString() });
  // o título vira o nome sugerido do arquivo no "Salvar como PDF" do navegador
  await imprimirHtml(html, orderPdfFileName(pdf.number, pdf.created_at, ctx.tz, pdf.tipo).replace(/\.pdf$/, ''));
}
