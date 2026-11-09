/**
 * Exportar PDF do pedido.
 * - Celular: expo-print gera o arquivo (A4) e expo-sharing abre o compartilhar (WhatsApp, e-mail, arquivos).
 * - Navegador: o expo-print no web chama window.print() da PÁGINA ATUAL e ignora o `html`; por isso imprimimos
 *   o HTML num iframe oculto (a impressão do navegador permite "Salvar como PDF"; o <title> sugere o nome do arquivo).
 *   O último iframe fica no DOM (id `order-pdf-frame`) até a próxima exportação.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { aguardarAteAbrir, comLimiteDeTempo, MENSAGEM_PDF_FALHA } from './limite-tempo';

/** A4 em pontos (72 por polegada). */
const A4 = { width: 595, height: 842 };

export type PdfExportResult = { kind: 'shared' } | { kind: 'saved'; uri: string } | { kind: 'printed' } | { kind: 'cancelado' };

/** Limite para gerar o arquivo; compartilhar não tem limite (o usuário escolhe o app), só a espera para liberar a folha. */
export const LIMITE_GERAR_PDF_MS = 20_000;
const ESPERA_ABRIR_COMPARTILHAR_MS = 1_500;

/**
 * `cancelado`: a pessoa fechou a folha durante a geração (relato de 08/11: "gera enquanto a tela estiver aberta; fechou,
 * cancela"). O arquivo que o sistema ainda terminar de gerar é ignorado e o compartilhar não abre.
 */
export async function exportPdf(html: string, fileName: string, cancelado: () => boolean = () => false): Promise<PdfExportResult> {
  if (Platform.OS === 'web') {
    printHtmlOnWeb(html);
    return { kind: 'printed' };
  }
  let uri: string;
  try {
    ({ uri } = await comLimiteDeTempo(Print.printToFileAsync({ html, ...A4 }), LIMITE_GERAR_PDF_MS, 'gerar PDF'));
  } catch (e) {
    // o detalhe técnico fica só no log; a folha mostra a mensagem amigável
    console.warn('[pdf] falha ao gerar o arquivo', e);
    throw new Error(MENSAGEM_PDF_FALHA);
  }
  if (cancelado()) return { kind: 'cancelado' };
  // TODO: renomear o arquivo para `fileName` exige expo-file-system (não é dependência do app hoje); o nome vai no título.
  if (await Sharing.isAvailableAsync()) {
    try {
      // no Android o shareAsync pode só resolver quando o usuário volta do compartilhar: após 1,5 s a folha é liberada
      await aguardarAteAbrir(Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: fileName }), ESPERA_ABRIR_COMPARTILHAR_MS);
    } catch (e) {
      console.warn('[pdf] falha ao abrir o compartilhar', e);
      throw new Error(MENSAGEM_PDF_FALHA);
    }
    return { kind: 'shared' };
  }
  return { kind: 'saved', uri };
}

/** Só o que usamos do DOM (o tsconfig do app não carrega a lib DOM). */
interface ElementoMinimo {
  id: string;
  style: object;
  srcdoc: string;
  onload: (() => void) | null;
  contentWindow: { focus(): void; print(): void } | null;
  remove(): void;
  setAttribute(nome: string, valor: string): void;
}
interface DocumentMinimo {
  getElementById(id: string): ElementoMinimo | null;
  createElement(tag: 'iframe'): ElementoMinimo;
  body: { appendChild(el: ElementoMinimo): void };
}

function printHtmlOnWeb(html: string) {
  const doc = (globalThis as unknown as { document?: DocumentMinimo }).document;
  if (!doc) return;
  doc.getElementById('order-pdf-frame')?.remove();
  const frame = doc.createElement('iframe');
  frame.id = 'order-pdf-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) return;
    w.focus();
    w.print();
  };
  frame.srcdoc = html;
  doc.body.appendChild(frame);
}
