/**
 * Foto do PDV no shell (T-0147): a carga dos bytes de um arquivo da plataforma para o visor de foto comum (`app/foto.tsx`,
 * RD-0088; a porta que o Core chama é `abrirFoto`, services/visor-foto.ts). Regras puras em `@/lib/foto-pdv`. O download usa o token da sessão (`ApiClient.bytes`, renova no 401) e não grava nada em disco nem em
 * log; a fonte (API e sinal) é ligada pelo estado da plataforma (`ligarFonteFotoPdv`), como a miniatura do catálogo.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { nomeArquivoFoto, PASTA_FOTOS } from '@/lib/foto';
import { fonteDaFoto, MAX_BYTES_VISOR, TEXTO_FOTO_INDISPONIVEL, TEXTO_SEM_SINAL_FOTO } from '@/lib/foto-pdv';
import { tipoDosBytes, uriDaImagem } from '@/lib/visualizar-arquivo';
import { NetworkError, type ApiClient } from '@/services/api';

let fonte: { api: () => ApiClient; online: () => boolean } | null = null;

/** Liga a API e o sinal da sessão ao visualizador; devolve o desligar (logout, troca de sessão). */
export function ligarFonteFotoPdv(api: () => ApiClient, online: () => boolean): () => void {
  const minha = { api, online };
  fonte = minha;
  return () => {
    if (fonte === minha) fonte = null;
  };
}

function arquivoLocal(arquivoId: string): string | null {
  if (Platform.OS === 'web') return null;
  const f = new File(new Directory(Paths.document, PASTA_FOTOS), nomeArquivoFoto(arquivoId));
  return f.exists && f.size > 0 ? f.uri : null;
}

export type FotoCarregada = { tipo: 'ok'; uri: string } | { tipo: 'erro'; mensagem: string };

/** Local primeiro (vale sem sinal); senão `GET /v1/arquivos/<id>` em memória. Nunca lança. */
export async function carregarFotoPdv(arquivoId: string): Promise<FotoCarregada> {
  let local: string | null = null;
  try {
    local = arquivoLocal(arquivoId);
  } catch {
    local = null;
  }
  const f = fonte;
  const decisao = fonteDaFoto(local, f?.online() ?? false, f !== null && Platform.OS !== 'web');
  if (decisao.tipo === 'local') return { tipo: 'ok', uri: decisao.uri };
  if (decisao.tipo === 'erro' || !f)
    return { tipo: 'erro', mensagem: decisao.tipo === 'erro' ? decisao.mensagem : TEXTO_FOTO_INDISPONIVEL };
  try {
    const bytes = await f.api().bytes(`/v1/arquivos/${encodeURIComponent(arquivoId)}`, {
      maxBytes: MAX_BYTES_VISOR,
      timeoutMs: 20_000,
    });
    const tipo = bytes ? tipoDosBytes(bytes) : null;
    return bytes && tipo
      ? { tipo: 'ok', uri: uriDaImagem(tipo, bytes) }
      : { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
  } catch (e) {
    return {
      tipo: 'erro',
      mensagem: e instanceof NetworkError ? TEXTO_SEM_SINAL_FOTO : TEXTO_FOTO_INDISPONIVEL,
    };
  }
}
