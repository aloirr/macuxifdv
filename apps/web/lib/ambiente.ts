'use client';

/**
 * Ambiente do navegador entregue às páginas dos módulos (platform-sdk `AmbienteAparelho`, T-0001 A3):
 * `useHttp()`/`useAmbiente()` usam o `api()` do platform-sdk/web (token da sessão, proxy, 401 encerra a sessão).
 * As páginas web podem continuar usando `api()` direto; isto dá o mesmo contrato das telas do app.
 */
import { criarClienteHttp, ErroHttp, ErroSemConexao, type AmbienteAparelho, type UsuarioAmbiente } from '@macuxi/platform-sdk';
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';

export function criarAmbienteWeb(usuario: () => UsuarioAmbiente | null): AmbienteAparelho {
  const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
  const http = criarClienteHttp(
    async <T,>(metodo: string, caminho: string, opcoes: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown }) => {
      const query = opcoes.query ? Object.fromEntries(Object.entries(opcoes.query).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v])) : undefined;
      try {
        return await api<T>(caminho, { method: metodo as 'GET' | 'POST' | 'PUT' | 'DELETE', query, body: opcoes.body });
      } catch (e) {
        if (e instanceof ApiRequestError) {
          if (e.status === 0) throw new ErroSemConexao(e.message);
          throw new ErroHttp(e.status, e.code, e.message, e.details);
        }
        throw e;
      }
    },
    { online },
  );
  return { http, online, novoId: () => crypto.randomUUID(), usuario };
}
