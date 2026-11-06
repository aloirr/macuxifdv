/**
 * Aceite do convite de 1º acesso (T-0087, RN-CORE-31): rota pública `POST /v1/auth/convite/aceitar` `{ token, senha }`.
 * - token inválido, usado, revogado, vencido, de usuário inativo ou de quem já tem senha (RN-CORE-31): MESMA resposta 410 (não revela qual);
 * - uso único: o convite é consumido na mesma transação em que a senha é gravada (argon2id), com `for update`;
 * - senha fraca (política `validarSenhaInicial`): 422 sem consumir o convite;
 * - depois do aceite a pessoa entra pelo login normal (código da empresa + e-mail + a senha nova);
 * - sem e-mail, token ou senha em log; auditoria só com ids.
 */
import type { ContextoPublico } from '@macuxi/platform-sdk';
import { CODIGOS_EQUIPE_CSV, type AceitarConviteRequest, type AceitarConviteResposta } from '../contracts';
import { avaliarConvite, validarSenhaInicial } from '../domain';
import { erroHttp } from './erros';
import { lerConvite } from './seguranca-convite';
import { gastarTempoDeSenha, hashSenha } from './seguranca';

const MENSAGEM_INVALIDO = 'Este convite não vale mais: ele já foi usado ou venceu. Peça um convite novo ao administrador da sua empresa.';

interface LinhaConvite {
  id: string;
  usuario_id: string;
  expira_em: Date;
  usado_em: Date | null;
  revogado_em: Date | null;
  email: string;
  nome: string;
  ativo: boolean;
  senha_hash: string | null;
}

export async function aceitarConvite(ctx: ContextoPublico<AceitarConviteRequest>): Promise<AceitarConviteResposta> {
  const lido = lerConvite(ctx.corpo.token);
  if (!lido) {
    await gastarTempoDeSenha(ctx.corpo.senha);
    throw erroHttp(410, CODIGOS_EQUIPE_CSV.conviteInvalido, MENSAGEM_INVALIDO);
  }
  const agora = ctx.agora();
  const r = await ctx.banco.comTenant(lido.tenantId, async (db) => {
    const c = (
      await db.query<LinhaConvite>(
        `select c.id, c.usuario_id, c.expira_em, c.usado_em, c.revogado_em, u.email, u.nome, u.ativo, u.senha_hash
           from core.usuario_convite c join core.usuario u on u.id = c.usuario_id and u.deleted_at is null
          where c.token_hash = $1 and c.deleted_at is null for update of c`,
        [lido.hash],
      )
    ).rows[0];
    if (!c || !c.ativo || c.senha_hash !== null || avaliarConvite({ expira_em: new Date(c.expira_em), usado_em: c.usado_em ? new Date(c.usado_em) : null, revogado_em: c.revogado_em ? new Date(c.revogado_em) : null }, agora) !== 'valido') {
      return { tipo: 'invalido' as const };
    }
    const fraca = validarSenhaInicial(ctx.corpo.senha, c.email);
    if (fraca) return { tipo: 'fraca' as const, mensagem: fraca };
    const senhaHash = await hashSenha(ctx.corpo.senha);
    await db.query('update core.usuario set senha_hash = $2, tentativas_falhas = 0, bloqueio_ate = null where id = $1', [c.usuario_id, senhaHash]);
    await db.query('update core.usuario_convite set usado_em = $2 where id = $1', [c.id, agora.toISOString()]);
    await db.query('update core.usuario_convite set revogado_em = now() where usuario_id = $1 and usado_em is null and revogado_em is null', [c.usuario_id]);
    await db.query('update core.sessao set revogado_em = now() where usuario_id = $1 and revogado_em is null', [c.usuario_id]);
    await db.query(
      `insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, request_id)
       values (plataforma.tenant_atual(), $1, 'core', 'usuario.convite_aceito', 'usuario', $1, null, $2::jsonb, $3)`,
      [c.usuario_id, JSON.stringify({ senha_definida: true }), ctx.requestId],
    );
    const t = (await db.query<{ codigo: string }>('select codigo from plataforma.tenant where id = plataforma.tenant_atual()')).rows[0];
    return { tipo: 'ok' as const, codigo: t?.codigo ?? '', email: c.email, nome: c.nome, usuarioId: c.usuario_id };
  });
  if (r.tipo === 'invalido') {
    await gastarTempoDeSenha(ctx.corpo.senha);
    throw erroHttp(410, CODIGOS_EQUIPE_CSV.conviteInvalido, MENSAGEM_INVALIDO);
  }
  if (r.tipo === 'fraca') throw erroHttp(422, CODIGOS_EQUIPE_CSV.senhaFraca, r.mensagem);
  ctx.log.info({ tenant_id: lido.tenantId, usuario_id: r.usuarioId }, 'convite aceito');
  return { codigo_empresa: r.codigo, email: r.email, nome: r.nome };
}
