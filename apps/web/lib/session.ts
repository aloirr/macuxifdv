'use client';

/**
 * Sessão do BKO: a sessão genérica do platform-sdk tipada com o usuário do shell.
 * - API real (padrão): usuário do login do Core (`SessaoWebResposta`): perfil do doc 03, empresa e fuso do tenant.
 * - Demonstração (mock-api): o papel em inglês da Fase M (`role`) é convertido para o `perfil` do doc 03.
 * Daí em diante o shell só olha `perfil` (menus, permissões por ação, acesso ao BKO — Q6).
 *
 * T-0117 (ADR 0038): o token de renovação mora no cookie httpOnly que a API grava em `/api-proxy/auth` (o rewrite do Next
 * repassa `Cookie` e `Set-Cookie`); o JavaScript do BKO nunca o vê. Login e troca de senha vão no modo cookie
 * (`sessaoWeb: true` → `X-Macuxi-CSRF: 1`) e a resposta vem sem o token de renovação; o acesso fica no `sessionStorage` da aba e só
 * o usuário vai ao `localStorage` (SDK). Sair = `encerrarSessaoWeb()` (revoga a família e apaga o cookie).
 */
import {
  SessaoWebRespostaSchema,
  type FakeUser,
  type LoginSenhaRequest,
  type SessaoWebResposta,
  type TrocarSenhaRequest,
} from '@macuxi/core/contracts';
import { perfilDaFaseM, type Perfil } from '@macuxi/platform-sdk';
import { api, encerrarSessaoWeb, saveSession, useSession } from '@macuxi/platform-sdk/web';

import { CAMINHO_TROCAR_SENHA } from './ciclo-senha';

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

/** `POST /auth/login` no modo cookie: a API grava o cookie de renovação; o corpo traz o acesso, o usuário e o tenant. */
export async function pedirLogin(corpo: LoginSenhaRequest): Promise<SessaoWebResposta> {
  return SessaoWebRespostaSchema.parse(await api<unknown>('/auth/login', { method: 'POST', body: corpo, sessaoWeb: true }));
}

/** `POST /auth/senha/trocar` no modo cookie: a troca revoga as sessões antigas e a API grava o cookie da sessão nova. */
export async function pedirTrocaDeSenha(corpo: TrocarSenhaRequest): Promise<SessaoWebResposta> {
  return SessaoWebRespostaSchema.parse(await api<unknown>(CAMINHO_TROCAR_SENHA, { method: 'POST', body: corpo, sessaoWeb: true }));
}

/** Login real do Core: o acesso (na aba) e o usuário com a empresa. O token de renovação já está no cookie httpOnly. */
export function salvarSessaoReal(s: SessaoWebResposta) {
  const usuario: UsuarioSessao = { id: s.usuario.id, name: s.usuario.nome, email: s.usuario.email, perfil: s.usuario.perfil, empresa: s.tenant.nome, fuso: s.tenant.fuso };
  saveSession(s.access_token, usuario);
}

/** Sai: limpa o navegador (todas as abas) e, na API real, revoga a família do refresh e apaga o cookie (melhor esforço). */
export function encerrarSessao(): Promise<void> {
  return encerrarSessaoWeb();
}
