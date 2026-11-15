/**
 * `core.credencial_conferir@1` (T-0173, RN-INT-16): confere a senha de um usuário do tenant para outro módulo (o Hub, na autorização de
 * reprocessamento). Usa o MESMO argon2id do login (`verificarSenha`/`gastarTempoDeSenha`); sempre uma conferência, exista o usuário ou não.
 * A senha nunca é gravada, logada nem devolvida. Não conta tentativas: o limite é de quem chama.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CREDENCIAL_CONFERIR, type CredencialConferirSaida } from '../contracts';
import { decidirCredencial } from '../domain/credencial';
import { gastarTempoDeSenha, verificarSenha } from './seguranca';

const data = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

export const consultaCredencialConferir = implementarConsulta(CONSULTA_CREDENCIAL_CONFERIR, async (entrada, ctx): Promise<CredencialConferirSaida> => {
  const r = await ctx.db.query<{ senha_hash: string | null; ativo: boolean; bloqueado_em: unknown; bloqueio_ate: unknown; deleted_at: unknown }>(
    'select senha_hash, ativo, bloqueado_em, bloqueio_ate, deleted_at from core.usuario where id = $1',
    [entrada.usuario_id],
  );
  const u = r.rows[0] ?? null;
  let senhaConfere = false;
  if (u?.senha_hash) senhaConfere = await verificarSenha(entrada.senha, u.senha_hash);
  else await gastarTempoDeSenha(entrada.senha);
  const resultado = decidirCredencial({
    usuario: u ? { ativo: u.ativo, excluido: data(u.deleted_at) !== null, bloqueadoEm: data(u.bloqueado_em), bloqueioAte: data(u.bloqueio_ate) } : null,
    senhaConfere,
    agora: ctx.agora(),
  });
  return { resultado };
});
