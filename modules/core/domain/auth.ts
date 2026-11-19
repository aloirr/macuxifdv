/**
 * Autenticação do Core como regras puras (RF-CORE-01; doc 04 "Segurança": JWT de acesso 15 min + refresh rotativo
 * 30 dias). A API (`api/autenticacao.ts`) só orquestra: o relógio, o banco e o hash entram por parâmetro.
 *
 * - Bloqueio por tentativas: [5] falhas seguidas bloqueiam o login por [15] min; senha certa zera a contagem.
 *   Usuário inativo ou bloqueado pelo admin (`bloqueado_em`) nunca entra.
 * - Refresh rotativo: cada refresh só vale UMA vez. Apresentar de novo um refresh já usado indica cópia/roubo e
 *   derruba a família inteira (todos os refresh descendentes do mesmo login).
 */
export const MAX_FALHAS_LOGIN = 5;
export const BLOQUEIO_LOGIN_MINUTOS = 15;
export const ACESSO_MINUTOS = 15;
export const REFRESH_DIAS = 30;

export type EstadoLogin = 'ok' | 'inativo' | 'bloqueado_admin' | 'bloqueado_tentativas';

export interface EntradaEstadoLogin {
  ativo: boolean;
  bloqueadoEm: Date | null;
  bloqueioAte: Date | null;
  agora: Date;
}

/** Pode tentar logar? (a senha só é conferida se o estado for `ok` ou para decidir a mensagem). */
export function estadoDoLogin(e: EntradaEstadoLogin): EstadoLogin {
  if (!e.ativo) return 'inativo';
  if (e.bloqueadoEm) return 'bloqueado_admin';
  if (e.bloqueioAte && e.bloqueioAte.getTime() > e.agora.getTime()) return 'bloqueado_tentativas';
  return 'ok';
}

export interface ContagemFalhas {
  falhas: number;
  bloqueioAte: Date | null;
}

/** RN: falha de senha. Passado o bloqueio anterior, a contagem recomeça; na [5ª] falha seguida bloqueia por [15] min. */
export function registrarFalhaDeLogin(atual: { falhas: number; bloqueioAte: Date | null }, agora: Date): ContagemFalhas {
  const expirou = atual.bloqueioAte !== null && atual.bloqueioAte.getTime() <= agora.getTime();
  const falhas = (expirou ? 0 : atual.falhas) + 1;
  if (falhas >= MAX_FALHAS_LOGIN) return { falhas, bloqueioAte: new Date(agora.getTime() + BLOQUEIO_LOGIN_MINUTOS * 60_000) };
  return { falhas, bloqueioAte: null };
}

/** RN-CORE-01: minutos que faltam para o fim do bloqueio por tentativas, arredondados para cima (mínimo 1 enquanto bloqueado). */
export function minutosRestantesDoBloqueio(bloqueioAte: Date, agora: Date): number {
  return Math.max(1, Math.ceil((bloqueioAte.getTime() - agora.getTime()) / 60_000));
}

/** Senha certa: zera a contagem e o bloqueio temporário. */
export function zerarFalhasDeLogin(): ContagemFalhas {
  return { falhas: 0, bloqueioAte: null };
}

export type EstadoRefresh = 'valido' | 'expirado' | 'reutilizado' | 'revogado';

export interface EntradaRefresh {
  expiraEm: Date;
  usadoEm: Date | null;
  revogadoEm: Date | null;
  agora: Date;
}

/** `reutilizado` = já trocado antes: a API revoga a família inteira e exige novo login. */
export function estadoDoRefresh(e: EntradaRefresh): EstadoRefresh {
  if (e.revogadoEm) return 'revogado';
  if (e.usadoEm) return 'reutilizado';
  if (e.expiraEm.getTime() <= e.agora.getTime()) return 'expirado';
  return 'valido';
}

export const expiracaoDoAcesso = (agora: Date): Date => new Date(agora.getTime() + ACESSO_MINUTOS * 60_000);
export const expiracaoDoRefresh = (agora: Date): Date => new Date(agora.getTime() + REFRESH_DIAS * 86_400_000);

/** Segundos até o acesso expirar (campo `expires_in` do login). */
export const SEGUNDOS_DO_ACESSO = ACESSO_MINUTOS * 60;
