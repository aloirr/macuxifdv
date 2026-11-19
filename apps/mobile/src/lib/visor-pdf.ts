/**
 * Visor de PDF do shell (T-0186, v1.0.16; pedido do dono do produto: "visualizar sem baixar, sob demanda, sem guardar no
 * aparelho, com o react-native-pdf"). O Core chama a porta `abrirArquivo` com `formato: 'pdf'` (NF e documentos do cliente)
 * e o shell abre a rota `/pdf`. Puro, para teste: o formato, a rota, a assinatura dos bytes, o temporário e a fonte.
 *
 * Os bytes vêm do download do visor (`baixarArquivoDoVisor`, services/foto-pdv.ts), só com sinal. O react-native-pdf
 * só desenha arquivo do disco: o PDF vai para um temporário na pasta de cache `visor-pdf/`, apagado ao fechar a tela; a
 * pasta inteira é apagada antes de cada abertura (sobra de app encerrado) e no bloqueio do aparelho (RN-CORE-15).
 */
import { nomeArquivoFoto } from './foto';
import { pedidoDaRota, type PedidoVerFoto } from './foto-pdv';
import { rotaDoVisor } from './visor-foto';

export const ROTA_VISOR_PDF = '/pdf';
/** Pasta dos temporários, dentro do cache do app. */
export const PASTA_PDF_TEMPORARIO = 'visor-pdf';

/** Rota do visor de PDF; lança se o arquivo não for UUID. */
export function rotaDoVisorPdf(p: PedidoVerFoto): { pathname: typeof ROTA_VISOR_PDF; params: Record<string, string> } {
  return { ...rotaDoVisor(p), pathname: ROTA_VISOR_PDF };
}

/** Parâmetros da rota `/pdf` (os mesmos da foto do PDV); `null` = arquivo ausente ou inválido. */
export const pedidoDoVisorPdf = pedidoDaRota;

/** Nome do temporário: o arquivo e um sufixo da abertura (duas aberturas seguidas não disputam o mesmo arquivo). */
export function nomePdfTemporario(arquivoId: string, sufixo: string): string {
  const base = nomeArquivoFoto(arquivoId).replace(/\.jpg$/, '');
  const s = sufixo.replace(/[^a-z0-9]/gi, '').slice(0, 16);
  return `${base}-${s || '0'}.pdf`;
}

type FontePdf = { uri: string; cache: false };

/** Fonte do componente: o temporário local, sem o cache do react-native-pdf. */
export function fonteDoPdf(uri: string): FontePdf {
  return { uri, cache: false };
}

export type PdfCarregado = { tipo: 'ok'; uri: string } | { tipo: 'erro'; mensagem: string };

/** Depois de baixar: só PDF de verdade (assinatura `%PDF`) abre. */
export function bytesDoPdfAceitos(b: Uint8Array | null): b is Uint8Array {
  return b !== null && b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}
