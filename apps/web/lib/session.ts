'use client';

/**
 * Sessão do BKO: a sessão genérica do platform-sdk tipada com o usuário do shell.
 * - API real (padrão): usuário do login do Core (`SessaoResposta`): perfil do doc 03, empresa e fuso do tenant.
 * - Demonstração (mock-api): o papel em inglês da Fase M (`role`) é convertido para o `perfil` do doc 03.
 * Daí em diante o shell só olha `perfil` (menus, permissões por ação, acesso ao BKO — Q6).
 */
import type { FakeUser, SessaoResposta } from '@macuxi/core/contracts';
import { perfilDaFaseM, type Perfil } from '@macuxi/platform-sdk';
import { api, clearSession, getRefreshToken, MODO_API, saveSession, useSession } from '@macuxi/platform-sdk/web';

export interface UsuarioSessao extends Partial<Omit<FakeUser, 'id' | 'name' | 'email'>> {
  id: string;
  name: string;
  email: string;
  perfil: Perfil | null;
  /** Nome e fuso do tenant (login real; na demo vêm de `GET /me`). */
  empresa?: string;
  fuso?: string;
}

export function usuarioDaFaseM(u: FakeUser): UsuarioSessao & FakeUser {
  return { ...u, perfil: perfilDaFaseM(u.role) };
}

export function useSessao() {
  return useSession<UsuarioSessao>();
}

/** Demonstração (mock-api). */
export function salvarSessao(token: string, usuario: FakeUser) {
  saveSession(token, usuarioDaFaseM(usuario));
}

/** Login real do Core: tokens (acesso + refresh) e o usuário com a empresa. */
export function salvarSessaoReal(s: SessaoResposta) {
  const usuario: UsuarioSessao = { id: s.usuario.id, name: s.usuario.nome, email: s.usuario.email, perfil: s.usuario.perfil, empresa: s.tenant.nome, fuso: s.tenant.fuso };
  saveSession(s.access_token, usuario, s.refresh_token);
}

/** Sai: na API real revoga a família do refresh no servidor (melhor esforço) e limpa o navegador. */
export function encerrarSessao() {
  const refresh = getRefreshToken();
  clearSession();
  if (MODO_API === 'v1' && refresh) void api('/auth/logout', { method: 'POST', body: { refresh_token: refresh } }).catch(() => undefined);
}
