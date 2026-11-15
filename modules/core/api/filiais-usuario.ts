/**
 * Filial do usuário na API (T-0176; RN-CORE-39 revista; migração 0077 `core.usuario_filial`). A regra é a do domain
 * (`validarFiliaisDoUsuario`); aqui a API revalida com o estado do banco e grava por SQL direto (o espelho Drizzle é do banco-dados).
 * Remover o vínculo é soft delete. O "vendedor" é o cargo do perfil (`core.v_usuario_hierarquia`, 0069). O banco recusa 2 filiais
 * vivas para o vendedor (23514 `usuario_filial_vendedor_uma`, gatilho adiado: o `set constraints ... immediate` faz o erro sair no comando).
 * Sem dado pessoal em log.
 */
import { ErroHttpModulo, ErroRegraNegocio, type Cargo, type ClienteBanco } from '@macuxi/platform-sdk';
import { CODIGOS_FILIAL_USUARIO, MENSAGEM_FILIAL_DO_VENDEDOR, MENSAGEM_FILIAL_INVALIDA, MENSAGEM_SEM_PERMISSAO_FILIAL } from '../contracts';
import { filiaisInexistentes, perfilEditaFilial, validarFiliaisDoUsuario, vendedorBloqueadoPorFilial } from '../domain';

/** Filiais vivas do usuário (ordem estável). */
export async function filiaisDoUsuario(db: ClienteBanco, usuarioId: string): Promise<string[]> {
  const r = await db.query<{ filial_id: string }>('select filial_id from core.usuario_filial where usuario_id = $1 and deleted_at is null order by created_at, filial_id', [usuarioId]);
  return r.rows.map((l) => l.filial_id);
}

/** Filiais de vários usuários, de uma vez (leitura da lista no BKO). */
export async function filiaisDosUsuarios(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (ids.length === 0) return m;
  const r = await db.query<{ usuario_id: string; filial_id: string }>(
    'select usuario_id, filial_id from core.usuario_filial where usuario_id = any($1::uuid[]) and deleted_at is null order by created_at, filial_id',
    [[...ids]],
  );
  for (const l of r.rows) m.set(l.usuario_id, [...(m.get(l.usuario_id) ?? []), l.filial_id]);
  return m;
}

/** Cargo atual do usuário (`core.v_usuario_hierarquia`). */
export async function cargoDoUsuario(db: ClienteBanco, usuarioId: string): Promise<Cargo | null> {
  const r = await db.query<{ cargo: Cargo | null }>('select cargo from core.v_usuario_hierarquia where usuario_id = $1', [usuarioId]);
  return r.rows[0]?.cargo ?? null;
}

/** RN-CORE-39: vendedor (cargo) sem filial viva = bloqueado no app. Usuário inexistente ou de outro cargo = falso. */
export async function vendedorSemFilial(db: ClienteBanco, usuarioId: string): Promise<boolean> {
  if ((await cargoDoUsuario(db, usuarioId)) !== 'vendedor') return false;
  return vendedorBloqueadoPorFilial({ cargo: 'vendedor', filiais: await filiaisDoUsuario(db, usuarioId) });
}

/** Só admin e analista informam `filial_ids` (a rota já checou a ação `usuario.criar|editar`): 403 para os demais. */
export function exigirQuemEditaFilial(perfil: string): void {
  if (!perfilEditaFilial(perfil)) throw new ErroHttpModulo(403, CODIGOS_FILIAL_USUARIO.semPermissao, MENSAGEM_SEM_PERMISSAO_FILIAL);
}

/** 422 se a quantidade não bate com o cargo (RN-CORE-39) ou se alguma filial não existe, foi excluída ou é de outro tenant (RLS). */
export async function conferirFiliaisDoUsuario(db: ClienteBanco, cargo: Cargo | null, filiais: readonly string[]): Promise<string[]> {
  const unicas = [...new Set(filiais)];
  const erro = validarFiliaisDoUsuario(cargo, unicas);
  if (erro) throw new ErroRegraNegocio(erro.codigo, erro.mensagem, { campo: 'filial_ids' });
  if (unicas.length > 0) {
    const r = await db.query<{ id: string }>('select id from core.filial where id = any($1::uuid[]) and deleted_at is null', [unicas]);
    const faltam = filiaisInexistentes(unicas, r.rows.map((l) => l.id));
    if (faltam.length > 0) throw new ErroRegraNegocio(CODIGOS_FILIAL_USUARIO.invalida, MENSAGEM_FILIAL_INVALIDA, { campo: 'filial_ids' });
  }
  return unicas;
}

/**
 * Troca a lista de filiais do usuário: tira as que saíram (soft delete) e põe as novas. Devolve se algo mudou. O erro do banco
 * "vendedor com 2+ filiais" vira 422 com a frase do vendedor.
 */
export async function gravarFiliaisDoUsuario(db: ClienteBanco, usuarioId: string, filiais: readonly string[]): Promise<boolean> {
  const novas = [...new Set(filiais)];
  const atuais = await filiaisDoUsuario(db, usuarioId);
  const sairam = atuais.filter((f) => !novas.includes(f));
  const entraram = novas.filter((f) => !atuais.includes(f));
  if (sairam.length === 0 && entraram.length === 0) return false;
  try {
    if (sairam.length > 0) await db.query('update core.usuario_filial set deleted_at = now() where usuario_id = $1 and filial_id = any($2::uuid[]) and deleted_at is null', [usuarioId, sairam]);
    for (const f of entraram) {
      await db.query('insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values (plataforma.tenant_atual(), $1, $2)', [usuarioId, f]);
    }
    await db.query('set constraints usuario_filial_conferir_vendedor immediate');
  } catch (e) {
    if ((e as { code?: string; constraint?: string })?.code === '23514' && (e as { constraint?: string }).constraint === 'usuario_filial_vendedor_uma') {
      throw new ErroRegraNegocio(CODIGOS_FILIAL_USUARIO.quantidade, MENSAGEM_FILIAL_DO_VENDEDOR, { campo: 'filial_ids' });
    }
    throw e;
  }
  return true;
}

/**
 * Carga do ERP (`integracao.vendedor.atualizado@1`, `filial_external_id` opcional do Hub): ausente, nulo ou vazio = não altera;
 * presente = a filial do vendedor passa a ser a de mesmo `external_id` e troca a anterior. Filial inexistente = não grava e registra
 * o erro (só os códigos do ERP, sem dado pessoal); o vendedor segue sem filial, bloqueado no app. Só o cargo vendedor (uma filial).
 */
export async function aplicarFilialDoErp(
  ctx: { db: ClienteBanco; log: { warn: (o: Record<string, unknown>, m?: string) => void } },
  usuarioId: string,
  vendedorExternalId: string,
  filialExternalId: string | null | undefined,
): Promise<'gravada' | 'inalterada' | 'filial_inexistente' | 'ignorada'> {
  const codigo = typeof filialExternalId === 'string' ? filialExternalId.trim() : '';
  if (codigo === '') return 'inalterada';
  if ((await cargoDoUsuario(ctx.db, usuarioId)) !== 'vendedor') return 'ignorada';
  const f = await ctx.db.query<{ id: string }>('select id from core.filial where external_id = $1 and deleted_at is null', [codigo]);
  if (!f.rows[0]) {
    ctx.log.warn({ external_id: vendedorExternalId, filial_external_id: codigo }, 'filial do vendedor não encontrada: não gravada, o vendedor segue sem filial');
    return 'filial_inexistente';
  }
  return (await gravarFiliaisDoUsuario(ctx.db, usuarioId, [f.rows[0].id])) ? 'gravada' : 'inalterada';
}
