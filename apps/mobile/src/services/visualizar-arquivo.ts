/**
 * Porta `abrirArquivo` que o shell registra no Core (T-0186, RD-2356): "Ver PDF" da NF e "abrir documento" no Cliente 360.
 * Só visualizar (P15 e P17). Regras puras em `@/lib/visualizar-arquivo`.
 * - Formato de imagem: o visor de foto comum (`abrirFoto`, RD-0088), bytes só em memória.
 * - O resto: a rota `/arquivo` (`app/arquivo.tsx`), que baixa pela API da sessão (`ApiClient.bytes`, renova no 401) e olha
 *   os bytes: imagem fica em memória; PDF vai para um arquivo temporário em `<cache>/visualizar/`, apagado ao fechar.
 * Nada vai para os documentos do app nem para log (nem o id do arquivo).
 */
import type { PedidoAbrirArquivo } from '@macuxi/core/app';
import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import {
  ehImagem,
  MAX_BYTES_ARQUIVO,
  PASTA_VISUALIZAR,
  rotaDoArquivo,
  TEXTO_ARQUIVO_INDISPONIVEL,
  TEXTO_PDF_SEM_VISOR,
  TEXTO_SEM_INTERNET,
  tipoDosBytes,
  uriDaImagem,
} from '@/lib/visualizar-arquivo';
import { NetworkError } from '@/services/api';
import { uuid } from './device';
import { fonteDeArquivos } from './foto-pdv';
import { abrirFoto } from './visor-foto';

/** A porta registrada no Core. Nunca lança: arquivo inválido não abre nada. */
export function abrirArquivo(p: PedidoAbrirArquivo): void {
  if (ehImagem(p.formato)) {
    abrirFoto({ arquivo_id: p.arquivo_id, titulo: p.titulo, ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) });
    return;
  }
  let rota: ReturnType<typeof rotaDoArquivo>;
  try {
    rota = rotaDoArquivo(p);
  } catch {
    return;
  }
  router.push(rota as never);
}

export type ArquivoBaixado = { tipo: 'imagem'; uri: string } | { tipo: 'pdf'; uri: string } | { tipo: 'erro'; mensagem: string };

function pastaTemporaria(): Directory {
  return new Directory(Paths.cache, PASTA_VISUALIZAR);
}

/** Apaga a pasta temporária inteira (sobra de uma abertura interrompida, ou ao fechar). */
export function limparTemporarios(): void {
  if (Platform.OS === 'web') return;
  try {
    const pasta = pastaTemporaria();
    if (pasta.exists) pasta.delete();
  } catch {
    // nada a apagar
  }
}

/**
 * Baixa o arquivo para ver. `pdf` = o aparelho tem o visor de PDF; sem ele, o PDF não é gravado e volta a mensagem.
 * Nunca lança.
 */
export async function baixarArquivo(arquivoId: string, opcoes: { pdf: boolean }): Promise<ArquivoBaixado> {
  const fonte = fonteDeArquivos();
  if (!fonte || Platform.OS === 'web') return { tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL };
  if (!fonte.online()) return { tipo: 'erro', mensagem: TEXTO_SEM_INTERNET };
  let bytes: Uint8Array | null;
  try {
    bytes = await fonte.api().bytes(`/v1/arquivos/${encodeURIComponent(arquivoId)}`, { maxBytes: MAX_BYTES_ARQUIVO, timeoutMs: 30_000 });
  } catch (e) {
    return { tipo: 'erro', mensagem: e instanceof NetworkError ? TEXTO_SEM_INTERNET : TEXTO_ARQUIVO_INDISPONIVEL };
  }
  const tipo = bytes ? tipoDosBytes(bytes) : null;
  if (!bytes || !tipo) return { tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL };
  if (tipo !== 'pdf') return { tipo: 'imagem', uri: uriDaImagem(tipo, bytes) };
  if (!opcoes.pdf) return { tipo: 'erro', mensagem: TEXTO_PDF_SEM_VISOR };
  try {
    limparTemporarios();
    const pasta = pastaTemporaria();
    pasta.create({ intermediates: true });
    const arquivo = new File(pasta, `${uuid()}.pdf`);
    arquivo.create();
    arquivo.write(bytes);
    return { tipo: 'pdf', uri: arquivo.uri };
  } catch {
    limparTemporarios();
    return { tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL };
  }
}
