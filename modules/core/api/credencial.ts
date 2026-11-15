/**
 * `core.credencial_conferir@1` (T-0173, RN-INT-16): confere a senha de um usuário do tenant para outro módulo (o Hub, na autorização de
 * reprocessamento). Usa o MESMO argon2id do login (`verificarSenha`/`gastarTempoDeSenha`); sempre uma conferência, exista o usuário ou não.
 * A senha nunca é gravada, logada nem devolvida. Não conta tentativas: o limite é de quem chama.
 */
import { estadoDoLogin } from '../domain/auth';
import { implementarConsulta, matrizDeFabrica, pode, type ContextoConsulta, type MatrizFabrica, type MotorPermissoes, type Perfil } from '@macuxi/platform-sdk';
import { CONSULTA_CREDENCIAL_CONFERIR, CONSULTA_USUARIOS_COM_ACAO, type CredencialConferirSaida, type UsuariosComAcaoSaida } from '../contracts';
import { decidirCredencial } from '../domain/credencial';
import { resolverLinhasDePerfil, perfisEfetivosDoUsuario } from './perfis-do-usuario';
import { gastarTempoDeSenha, verificarSenha } from './seguranca';

const data = (v: unknown): Date | null => (v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v)));

/**
 * Matriz de fábrica com as ações dos módulos (a mesma da API, `ContextoBase.permissoes`). Sem ela, só as chaves da plataforma e as
 * sobreposições concedidas valem: falha fechada (`sem_permissao`), nunca aberta.
 */
const matrizDe = (ctx: ContextoConsulta): MatrizFabrica => (ctx as ContextoConsulta & { permissoes?: MotorPermissoes }).permissoes?.matriz ?? matrizDeFabrica([]);

export const consultaCredencialConferir = implementarConsulta(CONSULTA_CREDENCIAL_CONFERIR, async (entrada, ctx): Promise<CredencialConferirSaida> => {
  // tenant explícito além da RLS (defesa em profundidade)
  const r = await ctx.db.query<{ senha_hash: string | null; ativo: boolean; bloqueado_em: unknown; bloqueio_ate: unknown; deleted_at: unknown; perfil: string }>(
    'select senha_hash, ativo, bloqueado_em, bloqueio_ate, deleted_at, perfil from core.usuario where id = $1 and tenant_id = $2',
    [entrada.usuario_id, ctx.usuario.tenant_id],
  );
  const u = r.rows[0] ?? null;
  let senhaConfere = false;
  if (u?.senha_hash) senhaConfere = await verificarSenha(entrada.senha, u.senha_hash);
  else await gastarTempoDeSenha(entrada.senha);
  // permissão EFETIVA (perfis personalizados, multiperfil), sempre calculada, exista o usuário ou não: mesmo caminho e mesmo custo
  const perfis = await perfisEfetivosDoUsuario(ctx.db, entrada.usuario_id, (u?.perfil ?? 'vendedor') as Perfil, matrizDe(ctx));
  const permitido = u !== null && pode(perfis, entrada.acao.acao);
  const resultado = decidirCredencial({
    usuario: u ? { ativo: u.ativo, excluido: data(u.deleted_at) !== null, bloqueadoEm: data(u.bloqueado_em), bloqueioAte: data(u.bloqueio_ate) } : null,
    senhaConfere,
    permitido,
    agora: ctx.agora(),
  });
  return { resultado };
});

/** RN-INT-16 / RN-CORE-35: quem pode `acao` pela permissão efetiva. Ativos e liberados para entrar; só id e nome. */
export const consultaUsuariosComAcao = implementarConsulta(CONSULTA_USUARIOS_COM_ACAO, async (entrada, ctx): Promise<UsuariosComAcaoSaida> => {
  const matriz = matrizDe(ctx);
  const r = await ctx.db.query<{ id: string; nome: string; perfil: string; ativo: boolean; bloqueado_em: unknown; bloqueio_ate: unknown; codigo: string | null; base: string | null; fabrica: boolean | null; sobreposicoes: unknown }>(
    `select u.id, u.nome, u.perfil, u.ativo, u.bloqueado_em, u.bloqueio_ate, p.codigo, p.base, p.fabrica, p.sobreposicoes
       from core.usuario u
       left join lateral plataforma.perfis_do_usuario(u.id) p on true
      where u.tenant_id = $1 and u.deleted_at is null and u.ativo
      order by u.nome, u.id`,
    [ctx.usuario.tenant_id],
  );
  const porUsuario = new Map<string, { id: string; nome: string; perfil: string; bloqueadoEm: Date | null; bloqueioAte: Date | null; linhas: { codigo: string; base: string; fabrica: boolean; sobreposicoes: unknown }[] }>();
  for (const l of r.rows) {
    const e = porUsuario.get(l.id) ?? { id: l.id, nome: l.nome, perfil: l.perfil, bloqueadoEm: data(l.bloqueado_em), bloqueioAte: data(l.bloqueio_ate), linhas: [] };
    if (l.codigo !== null && l.base !== null) e.linhas.push({ codigo: l.codigo, base: l.base, fabrica: l.fabrica === true, sobreposicoes: l.sobreposicoes });
    porUsuario.set(l.id, e);
  }
  const agora = ctx.agora();
  const usuarios = [...porUsuario.values()]
    .filter((e) => estadoDoLogin({ ativo: true, bloqueadoEm: e.bloqueadoEm, bloqueioAte: e.bloqueioAte, agora }) === 'ok')
    .filter((e) => pode(resolverLinhasDePerfil(e.linhas, e.perfil as Perfil, matriz), entrada.acao))
    .map((e) => ({ id: e.id, nome: e.nome }));
  return { usuarios };
});
