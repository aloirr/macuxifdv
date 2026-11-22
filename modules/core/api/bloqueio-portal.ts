/** 423 do portal por tentativas (RN-CORE-31): ponto único, usado pelo login do portal e pelas ações do `apps/api`. */
import { bloqueioPorTentativas } from '../domain/auth';
import { chaveBloqueada } from '../domain/super-admin';
import { CODIGOS_PORTAL } from '../contracts/plataforma';
import { erroHttp } from './erros';

/** Lança `ErroHttpModulo` (423, `CODIGOS_PORTAL.bloqueado`, `detalhes.minutos_restantes`) se a chave está bloqueada; senão não faz nada. */
export function exigirChaveLivre(bloqueadoAte: Date | null, agora: Date): void {
  if (!chaveBloqueada(bloqueadoAte, agora)) return;
  const { mensagem, detalhes } = bloqueioPorTentativas(bloqueadoAte, agora);
  throw erroHttp(423, CODIGOS_PORTAL.bloqueado, mensagem, detalhes);
}
