'use client';

/**
 * Ambiente do navegador entregue às páginas dos módulos (platform-sdk `AmbienteAparelho`, T-0001 A3):
 * `useHttp()`/`useAmbiente()` usam o `api()` do platform-sdk/web (token da sessão, proxy, 401 encerra a sessão).
 * As páginas web podem continuar usando `api()` direto; isto dá o mesmo contrato das telas do app.
 * T-0182: `logoDaEmpresa` (PDF de pedido e orçamento) converte a logo da empresa da sessão em data URI. Os bytes vêm de quem
 * chama (`lerLogo`): o shell lê o cache de `qk.modulos` e de `consultaLogoDaEmpresa` (`lib/queries.ts`), sem um segundo
 * `GET /v1/me/modulos` (RD-0700) nem um segundo download da logo (RD-1325).
 * D-PAR-04: `parametros(modulo)` (o `useParametros` das páginas) lê o mapa que quem chama passa: o shell passa os
 * `modulos[].parametros` da mesma consulta `qk.modulos`; módulo sem entrada (ou carregando) = `SEM_PARAMETROS`.
 */
import {
  criarClienteHttp,
  ErroHttp,
  ErroSemConexao,
  leitorDeParametros,
  type AmbienteAparelho,
  type ParametrosModulos,
  type UsuarioAmbiente,
} from '@macuxi/platform-sdk';
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';

/** `Blob` → data URI (`data:image/png;base64,…`), o formato que o PDF embute. */
function dataUriDoBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(leitor.error ?? new Error('logo ilegível'));
    leitor.readAsDataURL(blob);
  });
}

/** Logo da empresa da sessão como data URI; sem logo, sem rede ou servidor anterior à T-0182 = `null` (o PDF usa a padrão). */
export async function logoDaEmpresaWeb(lerLogo: () => Promise<Blob | null>): Promise<string | null> {
  try {
    const bytes = await lerLogo();
    return bytes ? await dataUriDoBlob(bytes) : null;
  } catch {
    return null;
  }
}

export function criarAmbienteWeb(
  usuario: () => UsuarioAmbiente | null,
  lerLogo: () => Promise<Blob | null>,
  parametros: ParametrosModulos | undefined,
): AmbienteAparelho {
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
  return { http, online, novoId: () => crypto.randomUUID(), usuario, parametros: leitorDeParametros(parametros), logoDaEmpresa: () => logoDaEmpresaWeb(lerLogo) };
}
