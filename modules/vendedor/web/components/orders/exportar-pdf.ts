import { imprimirHtml } from '@macuxi/platform-sdk/web';
import type { OrderDetail } from '../../../contracts';
import { buildOrderPdfHtml, orderPdfFileName, pdfDoPedido, type OrderPdfView } from '../../../domain/pdf-pedido';

/** Texto de erro quando a impressão não abre (toast da lista e aviso da gaveta). */
export const ERRO_IMPRESSAO = (detalhe: string) => `Não deu para abrir a impressão: ${detalhe} Tente de novo ou permita pop-ups deste site.`;

/** Abre o diálogo de impressão do PDF do pedido (cliente | interno), pela gaveta ou pelo "⋯" da linha. */
export async function exportarPdfDoPedido(dados: OrderDetail, view: OrderPdfView, ctx: { empresa: string; tz: string; /** data URI da logo da empresa; vazio = logo padrão (BKO ainda sem fonte da logo) */ logo_src?: string | null }): Promise<void> {
  const pdf = pdfDoPedido(dados);
  const html = buildOrderPdfHtml(pdf, view, { tenant_name: ctx.empresa, product_name: 'Macuxi FDV', tz: ctx.tz, ...(ctx.logo_src ? { logo_src: ctx.logo_src } : {}), generated_at: new Date().toISOString() });
  // o título vira o nome sugerido do arquivo no "Salvar como PDF" do navegador
  await imprimirHtml(html, orderPdfFileName(pdf.number, pdf.created_at, ctx.tz, pdf.tipo).replace(/\.pdf$/, ''));
}
