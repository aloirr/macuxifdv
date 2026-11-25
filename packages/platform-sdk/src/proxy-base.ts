/**
 * Prefixo do proxy same-origin do Next (rewrite `/api-proxy/:path*` → API; desenho T-0038 §3). Fonte única (RD-3572):
 * o cliente web (`web/api.ts`), o caminho do cookie de sessão (`cookie-sessao.ts`) e o `apps/web` (proxy e rewrites, que
 * rodam no servidor e não podem importar `@macuxi/platform-sdk/web`, 'use client') leem daqui, por `@macuxi/platform-sdk`.
 */
export const PROXY_BASE = '/api-proxy';
