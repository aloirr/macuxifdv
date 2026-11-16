/** Decisão de `core.credencial_conferir@1` (RN-INT-16, RN-CORE-15); a semântica dos resultados está no contrato. Pura. */
import type { ResultadoCredencial } from '../contracts';
import { estadoDoLogin } from './auth';

export interface EntradaCredencial {
  /** Linha do usuário no tenant (inclui excluído); `null` = não existe. */
  usuario: { ativo: boolean; excluido: boolean; bloqueadoEm: Date | null; bloqueioAte: Date | null } | null;
  /** A senha confere com o hash atual (sempre calculado, mesmo sem usuário, para igualar o tempo). */
  senhaConfere: boolean;
  /** A permissão EFETIVA do usuário no tenant inclui a ação pedida (perfis personalizados, RN-CORE-35); quem monta resolve com o motor do SDK. */
  permitido: boolean;
  agora: Date;
}

export function decidirCredencial(e: EntradaCredencial): ResultadoCredencial {
  if (!e.usuario || !e.senhaConfere) return 'incorreta';
  if (e.usuario.excluido) return 'bloqueado';
  if (estadoDoLogin({ ativo: e.usuario.ativo, bloqueadoEm: e.usuario.bloqueadoEm, bloqueioAte: e.usuario.bloqueioAte, agora: e.agora }) !== 'ok') return 'bloqueado';
  return e.permitido ? 'ok' : 'sem_permissao';
}
