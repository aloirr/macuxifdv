/**
 * Carga do PDF do visor (T-0186, v1.0.16; regras puras em `@/lib/visor-pdf`): o download do visor de foto
 * (`baixarArquivoDoVisor`) para um temporário do cache do app que a tela apaga ao fechar.
 * Nada fica guardado e nada vai para o log.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { TEXTO_FOTO_INDISPONIVEL } from '@/lib/foto-pdv';
import type { EstadoVisor } from '@/lib/visor-foto';
import { bytesDoPdfAceitos, nomePdfTemporario, PASTA_PDF_TEMPORARIO, type PdfCarregado } from '@/lib/visor-pdf';
import { baixarArquivoDoVisor } from '@/services/foto-pdv';

function pasta(): Directory {
  return new Directory(Paths.cache, PASTA_PDF_TEMPORARIO);
}

/** Apaga todos os temporários (antes de abrir outro e no bloqueio do aparelho, RN-CORE-15). Nunca lança. */
export function limparPdfsTemporarios(): void {
  if (Platform.OS === 'web') return;
  try {
    const p = pasta();
    if (p.exists) p.delete();
  } catch {
    // sem pasta ou já apagada
  }
}

/** Apaga o temporário da tela que fechou. Nunca lança. */
function apagarPdfTemporario(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // já apagado
  }
}

/** Baixa o PDF e grava o temporário; devolve o `file://` ou a mensagem. Nunca lança. */
export async function carregarPdf(arquivoId: string): Promise<PdfCarregado> {
  const r = await baixarArquivoDoVisor(arquivoId);
  if (r.tipo === 'erro') return r;
  if (!bytesDoPdfAceitos(r.bytes)) return { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
  try {
    limparPdfsTemporarios();
    const p = pasta();
    p.create({ intermediates: true, idempotent: true });
    const arq = new File(p, nomePdfTemporario(arquivoId, Date.now().toString(36)));
    arq.create({ overwrite: true });
    arq.write(r.bytes);
    return { tipo: 'ok', uri: arq.uri };
  } catch {
    return { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
  }
}

/**
 * A abertura da tela: carrega e entrega o estado; o devolvido é o fechar (desmontar ou voltar), que apaga o temporário,
 * também quando ele só fica pronto depois de a tela fechar.
 */
export function abrirPdfNaTela(arquivoId: string, aoEstado: (e: EstadoVisor) => void): () => void {
  let aberta = true;
  let temporario: string | null = null;
  aoEstado({ tipo: 'carregando' });
  void carregarPdf(arquivoId).then((r) => {
    if (r.tipo === 'ok') temporario = r.uri;
    if (aberta) aoEstado(r);
    else if (temporario) apagarPdfTemporario(temporario);
  });
  return () => {
    aberta = false;
    if (temporario) apagarPdfTemporario(temporario);
  };
}
