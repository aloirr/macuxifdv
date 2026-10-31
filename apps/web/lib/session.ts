'use client';

/**
 * Sessão do BKO: a sessão genérica do platform-sdk tipada com o usuário do shell.
 * O papel em inglês da Fase M (`role`) é convertido no login para o `perfil` do doc 03 e, daí em
 * diante, o shell só olha `perfil` (menus, permissões por ação, acesso ao BKO — Q6).
 */
import type { FakeUser } from '@macuxi/core/contracts';
import { perfilDaFaseM, type Perfil } from '@macuxi/platform-sdk';
import { clearSession, saveSession, useSession } from '@macuxi/platform-sdk/web';

export interface UsuarioSessao extends FakeUser {
  perfil: Perfil | null;
}

export function usuarioDaFaseM(u: FakeUser): UsuarioSessao {
  return { ...u, perfil: perfilDaFaseM(u.role) };
}

export function useSessao() {
  return useSession<UsuarioSessao>();
}

export function salvarSessao(token: string, usuario: FakeUser) {
  saveSession(token, usuarioDaFaseM(usuario));
}

export { clearSession as encerrarSessao };
