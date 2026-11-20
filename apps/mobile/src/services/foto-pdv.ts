/**
 * Foto do PDV no shell (T-0147): a carga dos bytes de um arquivo da plataforma para o visor de foto comum (`app/foto.tsx`,
 * RD-0088; a porta que o Core chama é `abrirFoto`, services/visor-foto.ts). Regras puras em `@/lib/foto-pdv`. O download
 * (`baixarArquivoDoVisor`, também do visor de PDF) usa o token da sessão (`ApiClient.bytes`, `no-store`, renova no 401) e
 * não grava nada em disco nem em log; a fonte (API e sinal) é ligada pelo estado da plataforma (`ligarFonteFotoPdv`).
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { nomeArquivoFoto, PASTA_FOTOS } from '@/lib/foto';
import { fonteDaFoto, MAX_BYTES_VISOR, TEXTO_FOTO_INDISPONIVEL, TEXTO_SEM_SINAL_FOTO } from '@/lib/foto-pdv';
import type { VisorCarregado } from '@/lib/visor-foto';
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

/**
 * Tempo limite do download dos dois visores (foto e PDF). 30 s: o teto é o mesmo (`MAX_BYTES_VISOR`, 20 MB) e o PDF da NF
 * ou do documento chega perto dele no 3G/4G fraco da rua; 20 s cortava esse caso, e quem espera vê o carregando.
 */
const TEMPO_LIMITE_VISOR_MS = 30_000;

export type ArquivoBaixado = { tipo: 'ok'; bytes: Uint8Array } | { tipo: 'erro'; mensagem: string };

/** `GET /v1/arquivos/<id>` em memória: sem sinal, "Sem internet"; sem sessão, vazio ou erro, indisponível. Nunca lança. */
export async function baixarArquivoDoVisor(arquivoId: string): Promise<ArquivoBaixado> {
  const f = fonte;
  const decisao = fonteDaFoto(null, f?.online() ?? false, f !== null && Platform.OS !== 'web');
  if (decisao.tipo === 'erro' || !f)
    return { tipo: 'erro', mensagem: decisao.tipo === 'erro' ? decisao.mensagem : TEXTO_FOTO_INDISPONIVEL };
  try {
    const bytes = await f.api().bytes(`/v1/arquivos/${encodeURIComponent(arquivoId)}`, {
      maxBytes: MAX_BYTES_VISOR,
      timeoutMs: TEMPO_LIMITE_VISOR_MS,
    });
    return bytes ? { tipo: 'ok', bytes } : { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
  } catch (e) {
    return {
      tipo: 'erro',
      mensagem: e instanceof NetworkError ? TEXTO_SEM_SINAL_FOTO : TEXTO_FOTO_INDISPONIVEL,
    };
  }
}

function arquivoLocal(arquivoId: string): string | null {
  if (Platform.OS === 'web') return null;
  const f = new File(new Directory(Paths.document, PASTA_FOTOS), nomeArquivoFoto(arquivoId));
  return f.exists && f.size > 0 ? f.uri : null;
}

/** Local primeiro (vale sem sinal); senão o download do visor, em memória. Nunca lança. */
export async function carregarFotoPdv(arquivoId: string): Promise<VisorCarregado> {
  let local: string | null = null;
  try {
    local = arquivoLocal(arquivoId);
  } catch {
    local = null;
  }
  if (local) return { tipo: 'ok', uri: local };
  const r = await baixarArquivoDoVisor(arquivoId);
  if (r.tipo === 'erro') return r;
  const tipo = tipoDosBytes(r.bytes);
  return tipo ? { tipo: 'ok', uri: uriDaImagem(tipo, r.bytes) } : { tipo: 'erro', mensagem: TEXTO_FOTO_INDISPONIVEL };
}
