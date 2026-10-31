/**
 * Ambiente do aparelho entregue aos módulos (platform-sdk `AmbienteAparelho`, T-0001 A3): HTTP com a sessão
 * sobre o `ApiClient`, modo sem sinal, UUID do aparelho e usuário logado. Chega às etapas de sync (`ctx`) e às
 * telas (`useAmbiente()` / `useHttp()`); os módulos nunca importam `apps/*`.
 *
 * Erros traduzidos para o contrato do SDK: `NetworkError` → `ErroSemConexao`; `HttpError` → `ErroHttp`.
 */
import { criarClienteHttp, ErroHttp, ErroSemConexao, type AmbienteAparelho, type UsuarioAmbiente } from '@macuxi/platform-sdk';

import { ApiClient, HttpError, NetworkError } from './api';
import { uuid } from './device';

export interface FontesAmbiente {
  /** Cliente da API com a URL do servidor e o token da sessão atuais. */
  api: () => ApiClient;
  /** Modo sem sinal desligado e sessão aberta. */
  online: () => boolean;
  usuario: () => UsuarioAmbiente | null;
}

/** Erro do `ApiClient` no contrato do SDK (o que módulos e a tela de login do Core entendem). */
export function traduzirErro(e: unknown): unknown {
  if (e instanceof NetworkError) return new ErroSemConexao(e.message);
  if (e instanceof HttpError) return new ErroHttp(e.status, e.code, e.message, e.details);
  return e;
}

export function criarAmbienteDoAparelho(f: FontesAmbiente): AmbienteAparelho {
  const http = criarClienteHttp(
    async <T,>(metodo: string, caminho: string, opcoes: { query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; headers?: Record<string, string>; timeoutMs?: number }) => {
      try {
        return (await f.api().request<T>(metodo, caminho, opcoes)).data;
      } catch (e) {
        throw traduzirErro(e);
      }
    },
    { online: f.online },
  );
  return { http, online: f.online, novoId: uuid, usuario: f.usuario };
}
