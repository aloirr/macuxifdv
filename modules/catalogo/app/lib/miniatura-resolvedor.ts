/**
 * Download da miniatura (T-0097 a). Puro (sem react-native): as portas `fetch` e `prefetch` são injetadas pela tela.
 * URL http(s) externa → HEAD (confere `content-length` ≤ `bytes_max`) + prefetch. URL relativa (`/v1/arquivos/<id>`,
 * autenticada) só baixa se o shell injetar um resolvedor (`definirResolvedorMiniatura`). Se o resolvedor devolver
 * `file://` (cache local do app: o shell já baixou com o token e conferiu o teto), vale como está: 'ok' sem HEAD nem prefetch.
 */
import type { MiniaturaProduto } from '../../contracts';
import type { ResultadoDownload } from './miniatura';

export type ResolvedorMiniatura = (url: string, m: MiniaturaProduto) => string | null | Promise<string | null>;
let resolvedor: ResolvedorMiniatura | null = null;
export function definirResolvedorMiniatura(r: ResolvedorMiniatura | null): void {
  resolvedor = r;
}

export const ehHttp = (u: string): boolean => /^https?:\/\//i.test(u);
export const ehArquivoLocal = (u: string): boolean => /^file:\/\//i.test(u);

export async function urlBaixavel(m: MiniaturaProduto): Promise<string | null> {
  if (ehHttp(m.url)) return m.url;
  return resolvedor ? resolvedor(m.url, m) : null;
}

export interface PortasDownload {
  fetch: (uri: string, init: { method: 'HEAD' }) => Promise<{ ok: boolean; headers: { get(nome: string): string | null } }>;
  prefetch: (uri: string) => Promise<boolean>;
}

export async function baixarMiniatura(m: MiniaturaProduto, portas: PortasDownload): Promise<ResultadoDownload> {
  try {
    const uri = await urlBaixavel(m);
    if (!uri) return 'falhou';
    if (ehArquivoLocal(uri)) return 'ok';
    if (!ehHttp(uri)) return 'falhou';
    const cabecalho = await portas.fetch(uri, { method: 'HEAD' });
    if (!cabecalho.ok) return 'falhou';
    const tamanho = Number(cabecalho.headers.get('content-length'));
    if (!Number.isFinite(tamanho) || tamanho <= 0) return 'falhou';
    if (tamanho > m.bytes_max) return 'grande';
    return (await portas.prefetch(uri)) ? 'ok' : 'falhou';
  } catch {
    return 'falhou';
  }
}
