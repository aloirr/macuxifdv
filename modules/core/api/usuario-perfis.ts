/**
 * Perfis do usuário (T-0111/T-0112; RN-CORE-01/35; ADR 0033): escolha, conferência dos limites e gravação em `plataforma.usuario_perfil`.
 * O primeiro perfil da lista é o principal: a base dele vai em `core.usuario.perfil` (token, apps). Os limites são os do SDK
 * (`validarAcessoDoTenant`): usuário sem perfil, perfil desativado, último admin e autogestão.
 */
import { ErroRegraNegocio, type ClienteBanco, type ContextoBase, type Perfil } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import type { PerfilDoUsuario } from '../contracts';
import { avaliarEstadoDePerfis } from '../domain';
import { carregar, motorDe } from './perfis';

export const MENSAGEM_PERFIL_INDISPONIVEL = 'Um dos perfis escolhidos foi desativado. Feche e abra o formulário de novo.';

/** Os perfis ativos escolhidos, na ordem pedida (o primeiro é o principal). Código inexistente ou inativo = 422. */
export async function perfisEscolhidos(db: ClienteBanco, codigos: readonly string[]): Promise<PerfilDoUsuario[]> {
  const unicos = [...new Set(codigos)];
  const r = await db.query<PerfilDoUsuario>('select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo and codigo = any($1::text[])', [unicos]);
  const porCodigo = new Map(r.rows.map((p) => [p.codigo, p]));
  const lista = unicos.map((c) => porCodigo.get(c));
  if (lista.length === 0 || lista.some((p) => !p)) throw new ErroRegraNegocio('PERFIL_INDISPONIVEL', MENSAGEM_PERFIL_INDISPONIVEL, { regra: 'RN-CORE-01' });
  return lista as PerfilDoUsuario[];
}

/** Códigos dos perfis vivos do usuário (para a auditoria e a comparação). */
export async function codigosDoUsuario(db: ClienteBanco, usuarioId: string): Promise<string[]> {
  const r = await db.query<{ codigo: string }>(
    `select p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
      where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`,
    [usuarioId],
  );
  return r.rows.map((x) => x.codigo);
}

/**
 * Perfis reais e vivos do usuário (código e base), do principal ao fim por código. Decide quem redefine a senha de quem (RN-CORE-34/35),
 * os apps do e-mail e a recusa de edição: nunca só o principal. Sem nenhuma linha em `usuario_perfil` (usuário antigo): cai no principal.
 */
export async function refsDoUsuario(db: ClienteBanco, usuarioId: string, principal: Perfil): Promise<{ codigo: string; base: Perfil }[]> {
  const r = await db.query<{ codigo: string; base: Perfil }>(
    `select p.codigo, p.base from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
      where up.usuario_id = $1 and up.deleted_at is null order by p.codigo`,
    [usuarioId],
  );
  return r.rows.length > 0 ? r.rows : [{ codigo: principal, base: principal }];
}

/** Limites do tenant com este usuário já nos perfis/situação novos (RN-CORE-01/35). `usuarioId` novo = criação. */
export async function conferirPerfisDoUsuario(ctx: ContextoBase, db: ClienteBanco, usuarioId: string, codigos: readonly string[], ativo: boolean): Promise<void> {
  const c = await carregar(db, true);
  const novo = { id: usuarioId, ativo, perfis: [...codigos] };
  const existia = c.usuarios.some((u) => u.id === usuarioId);
  const depoisUsuarios = existia ? c.usuarios.map((u) => (u.id === usuarioId ? novo : u)) : [...c.usuarios, novo];
  const { catalogo, matriz } = motorDe(ctx);
  const r = avaliarEstadoDePerfis({
    atorId: ctx.usuario.id,
    antes: { perfis: c.perfis, usuarios: c.usuarios },
    depois: { perfis: c.perfis, usuarios: depoisUsuarios },
    matriz,
    catalogo: catalogo.length > 0 ? catalogo : undefined,
  });
  if (r.ok) return;
  const v = r.violacoes[0]!;
  throw new ErroRegraNegocio(v.codigo, v.mensagem, { regra: v.regra });
}

/** Deixa o usuário só com estes perfis (soft delete do que saiu; insere o que entrou). */
export async function gravarPerfisDoUsuario(db: ClienteBanco, usuarioId: string, codigos: readonly string[]): Promise<void> {
  const vivos = await db.query<{ id: string; codigo: string }>(
    `select up.id, p.codigo from plataforma.usuario_perfil up join plataforma.perfil p on p.id = up.perfil_id
      where up.usuario_id = $1 and up.deleted_at is null`,
    [usuarioId],
  );
  const querem = new Set(codigos);
  const tem = new Set(vivos.rows.map((v) => v.codigo));
  for (const v of vivos.rows) if (!querem.has(v.codigo)) await db.query('update plataforma.usuario_perfil set deleted_at = now() where id = $1', [v.id]);
  for (const codigo of codigos) {
    if (tem.has(codigo)) continue;
    await db.query(
      `insert into plataforma.usuario_perfil (id, tenant_id, usuario_id, perfil_id)
       select $3, plataforma.tenant_atual(), $1, id from plataforma.perfil where codigo = $2 and deleted_at is null`,
      [usuarioId, codigo, randomUUID()],
    );
  }
}

export const principalDe = (perfis: readonly PerfilDoUsuario[]): Perfil => perfis[0]!.base;
