/**
 * Porta `abrirArquivo` que o shell registra no Core (T-0186, RD-2356 e RD-2374): foto de fachada e documentos do cliente no
 * Cliente 360. Só visualizar (P15 e P17), só imagem (o PDF fica para a v1.0.16). Regras puras em `@/lib/visualizar-arquivo`.
 * - Formato que o visor abre (`FORMATOS_DO_VISOR`): o visor de foto comum (`abrirFoto`, RD-0088), bytes só em memória.
 * - Sem formato: a rota `/arquivo` (`app/arquivo.tsx`), que baixa pela API da sessão (`ApiClient.bytes`, renova no 401) e
 *   olha os bytes: imagem fica em memória; o resto não abre.
 * - Outro formato (PDF de um Core antigo): não abre nem baixa nada.
 * Nada vai para o disco nem para log (nem o id do arquivo).
 */
import type { PedidoAbrirArquivo } from '@macuxi/core/app';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import {
  ehImagem,
  MAX_BYTES_ARQUIVO,
  rotaDoArquivo,
  semFormato,
  TEXTO_ARQUIVO_INDISPONIVEL,
  TEXTO_SEM_INTERNET,
  tipoDosBytes,
  uriDaImagem,
} from '@/lib/visualizar-arquivo';
import { NetworkError } from '@/services/api';
import { fonteDeArquivos } from './foto-pdv';
import { abrirFoto } from './visor-foto';

/** A porta registrada no Core. Nunca lança: arquivo inválido ou formato que o visor não abre não abre nada. */
export function abrirArquivo(p: PedidoAbrirArquivo): void {
  if (ehImagem(p.formato)) {
    abrirFoto({ arquivo_id: p.arquivo_id, titulo: p.titulo, ...(p.subtitulo ? { subtitulo: p.subtitulo } : {}) });
    return;
  }
  if (!semFormato(p.formato)) return;
  let rota: ReturnType<typeof rotaDoArquivo>;
  try {
    rota = rotaDoArquivo(p);
  } catch {
    return;
  }
  router.push(rota as never);
}

export type ArquivoBaixado = { tipo: 'imagem'; uri: string } | { tipo: 'erro'; mensagem: string };

/** Baixa o arquivo para ver; só imagem abre, e fica em memória. Nunca lança. */
export async function baixarArquivo(arquivoId: string): Promise<ArquivoBaixado> {
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
  return { tipo: 'imagem', uri: uriDaImagem(tipo, bytes) };
}
