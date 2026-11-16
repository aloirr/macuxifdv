import type { AmbienteAparelho } from '@macuxi/platform-sdk';
import { imprimirHtml } from '@macuxi/platform-sdk/web';
import type { OrderDetail } from '../../../contracts';
import { logoSrcDoPdf, nomeDaEmpresaParaPdf } from '../../../domain/empresa-pdf';
import { buildOrderPdfHtml, orderPdfFileName, pdfDoPedido, type OrderPdfView } from '../../../domain/pdf-pedido';

/** Texto de erro quando a impressão não abre (toast da lista e aviso da gaveta). */
export const ERRO_IMPRESSAO = (detalhe: string) => `Não deu para abrir a impressão: ${detalhe} Tente de novo ou permita pop-ups deste site.`;

/**
 * Abre o diálogo de impressão do PDF do pedido (cliente | interno), pela gaveta ou pelo "⋯" da linha. Nome e logo da empresa
 * saem do ambiente (T-0182): sem logo, a logo padrão.
 */
export async function exportarPdfDoPedido(dados: OrderDetail, view: OrderPdfView, ctx: { ambiente: Pick<AmbienteAparelho, 'parametros' | 'logoDaEmpresa'>; tz: string }): Promise<void> {
  const pdf = pdfDoPedido(dados);
  const html = buildOrderPdfHtml(pdf, view, { tenant_name: nomeDaEmpresaParaPdf(ctx.ambiente.parametros?.('core')), product_name: 'Macuxi FDV', tz: ctx.tz, ...(await logoSrcDoPdf(ctx.ambiente)), generated_at: new Date().toISOString() });
  // o título vira o nome sugerido do arquivo no "Salvar como PDF" do navegador
  await imprimirHtml(html, orderPdfFileName(pdf.number, pdf.created_at, ctx.tz, pdf.tipo).replace(/\.pdf$/, ''));
}
