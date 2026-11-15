/** Decisão da conferência de credencial para outros módulos (RN-INT-16; RN-CORE-15). Pura. */
import { estadoDoLogin } from './auth';

export type ResultadoCredencial = 'ok' | 'incorreta' | 'bloqueado';

export interface EntradaCredencial {
  /** Linha do usuário no tenant (inclui excluído); `null` = não existe. */
  usuario: { ativo: boolean; excluido: boolean; bloqueadoEm: Date | null; bloqueioAte: Date | null } | null;
  /** A senha confere com o hash atual (sempre calculado, mesmo sem usuário, para igualar o tempo). */
  senhaConfere: boolean;
  agora: Date;
}

/** Só quem acertou a senha descobre que o usuário está bloqueado; o resto é `incorreta`. */
export function decidirCredencial(e: EntradaCredencial): ResultadoCredencial {
  if (!e.usuario || !e.senhaConfere) return 'incorreta';
  if (e.usuario.excluido) return 'bloqueado';
  return estadoDoLogin({ ativo: e.usuario.ativo, bloqueadoEm: e.usuario.bloqueadoEm, bloqueioAte: e.usuario.bloqueioAte, agora: e.agora }) === 'ok' ? 'ok' : 'bloqueado';
}
