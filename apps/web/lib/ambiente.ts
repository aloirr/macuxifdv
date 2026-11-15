'use client';

/**
 * Ambiente do navegador entregue às páginas dos módulos (platform-sdk `AmbienteAparelho`, T-0001 A3):
 * `useHttp()`/`useAmbiente()` usam o `api()` do platform-sdk/web (token da sessão, proxy, 401 encerra a sessão).
 * As páginas web podem continuar usando `api()` direto; isto dá o mesmo contrato das telas do app.
 * T-0182: `logoDaEmpresa` (PDF de pedido e orçamento) busca a logo da empresa da sessão pela rota do aparelho (o BKO é sempre
 * online), a partir do `empresa_logo` dos parâmetros do Core em `/v1/me/modulos`.
 */
import { MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import {
  criarClienteHttp,
  empresaDosParametros,
  ErroHttp,
  ErroSemConexao,
  rotaLogoDoAparelho,
  type AmbienteAparelho,
  type UsuarioAmbiente,
} from '@macuxi/platform-sdk';
import { api, apiFetch, ApiRequestError } from '@macuxi/platform-sdk/web';

import { semV1 } from './portal-rotas';

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
export async function logoDaEmpresaWeb(): Promise<string | null> {
  try {
    const r = MeusModulosRespostaSchema.parse(await api<unknown>('/me/modulos'));
    const logo = empresaDosParametros(r.modulos.find((m) => m.id === 'core')?.parametros)?.logo;
    if (!logo) return null;
    const res = await apiFetch(semV1(rotaLogoDoAparelho(logo.sha256)));
    return await dataUriDoBlob(await res.blob());
  } catch {
    return null;
  }
}

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
  return { http, online, novoId: () => crypto.randomUUID(), usuario, logoDaEmpresa: logoDaEmpresaWeb };
}
