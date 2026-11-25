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

/** Chave bloqueada: roda `auditarBloqueio` (423) e lança o 423; livre: não faz nada. Usado pelo login e pela troca de senha do portal. */
export async function barrarSeBloqueado(bloqueadoAte: Date | null, agora: Date, auditarBloqueio: () => Promise<void>): Promise<void> {
  if (!chaveBloqueada(bloqueadoAte, agora)) return;
  await auditarBloqueio();
  exigirChaveLivre(bloqueadoAte, agora);
}

/** Senha errada: conta a falha, audita (423 se esta falha bloqueou, senão 401) e lança o 423 ou o 401 com `mensagem`. */
export async function contarFalhaDeSenha(
  contar: () => Promise<{ falhas: number; bloqueado_ate: Date | null }>,
  agora: Date,
  mensagem: string,
  auditarFalha: (status: 401 | 423, falhas: number) => Promise<void>,
): Promise<never> {
  const r = await contar();
  await auditarFalha(chaveBloqueada(r.bloqueado_ate, agora) ? 423 : 401, r.falhas);
  exigirChaveLivre(r.bloqueado_ate, agora);
  throw erroHttp(401, CODIGOS_PORTAL.credenciais, mensagem);
}
