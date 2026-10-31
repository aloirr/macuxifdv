/**
 * Fonte das licenças do usuário (RN-CORE-01/02/03), lida A CADA REQUISIÇÃO (nunca do JWT, S0-055):
 * `plataforma.tenant_modulo` (ativos no tenant), `plataforma.perfil_modulo` (padrão do perfil) e
 * `plataforma.usuario_modulo` (exceções que removem). Tudo dentro de `comTenant` (RLS do tenant do token).
 * O cálculo dos efetivos é o do platform-sdk (`modulosEfetivos`), feito em `createApp`.
 */
import { ehModulo, type AcessoBanco, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';

export interface LicencasUsuario {
  ativosNoTenant: ModuloId[];
  doPerfil: ModuloId[];
  removidosDoUsuario: ModuloId[];
  /** Parâmetros do módulo no tenant (`tenant_modulo.parametros`), devolvidos em `GET /v1/me/modulos`. */
  parametros: Partial<Record<ModuloId, Record<string, unknown>>>;
}

export type FonteLicencas = (usuario: UsuarioAutenticado, banco: AcessoBanco) => Promise<LicencasUsuario>;

/** Ids que não são módulos do produto (ex.: `teste` da fixture) são ignorados. */
const modulos = (xs: readonly { modulo: string }[]): ModuloId[] => xs.map((x) => x.modulo).filter(ehModulo);

export const licencasDoBanco: FonteLicencas = (usuario, banco) =>
  banco.comTenant(usuario.tenant_id, async (db) => {
    const tenant = await db.query<{ modulo: string; parametros: Record<string, unknown> | null }>(
      'select modulo, parametros from plataforma.tenant_modulo where ativo and deleted_at is null',
    );
    const perfil = await db.query<{ modulo: string }>('select modulo from plataforma.perfil_modulo where perfil = $1 and deleted_at is null', [usuario.perfil]);
    const removidos = await db.query<{ modulo: string }>(
      "select modulo from plataforma.usuario_modulo where usuario_id = $1 and efeito = 'remover' and deleted_at is null",
      [usuario.id],
    );
    const parametros: LicencasUsuario['parametros'] = {};
    for (const l of tenant.rows) if (ehModulo(l.modulo)) parametros[l.modulo] = l.parametros ?? {};
    return {
      ativosNoTenant: modulos(tenant.rows),
      doPerfil: modulos(perfil.rows),
      removidosDoUsuario: modulos(removidos.rows),
      parametros,
    };
  });
