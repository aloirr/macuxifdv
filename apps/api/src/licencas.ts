/**
 * Fonte das licenças do usuário (RN-CORE-01/02/03), lida A CADA REQUISIÇÃO (nunca do JWT, S0-055):
 * `plataforma.tenant_modulo` (ativos no tenant), `plataforma.perfil_modulo` (padrão do perfil) e
 * `plataforma.usuario_modulo` (exceções que removem). Tudo dentro de `comTenant` (RLS do tenant do token).
 * O cálculo dos efetivos é o do platform-sdk (`modulosEfetivos`), feito em `createApp`.
 *
 * Parâmetros do tenant: fonte ÚNICA `plataforma.parametro` (uma linha por módulo + chave, doc 03 "Parâmetros do
 * tenant"; desenho T-0016 §7). `tenant_modulo.parametros` é legado e não é lido (decisão da onda 1 da Sprint 1).
 *
 * Fuso do tenant (`plataforma.tenant.fuso`): lido aqui também e entregue às rotas como `ctx.fuso()` (T-0035).
 */
import { ehModulo, type AcessoBanco, type ModuloId, type UsuarioAutenticado } from '@macuxi/platform-sdk';

export interface LicencasUsuario {
  ativosNoTenant: ModuloId[];
  doPerfil: ModuloId[];
  removidosDoUsuario: ModuloId[];
  /** Parâmetros do módulo no tenant (`plataforma.parametro`: chave → valor), devolvidos em `GET /v1/me/modulos`. */
  parametros: Partial<Record<ModuloId, Record<string, unknown>>>;
  /** Fuso IANA do tenant (`plataforma.tenant.fuso`); vira `ctx.fuso()` (ausente/inválido = America/Manaus, T-0035). */
  fuso?: string | null;
}

export type FonteLicencas = (usuario: UsuarioAutenticado, banco: AcessoBanco) => Promise<LicencasUsuario>;

/** Ids que não são módulos do produto (ex.: `teste` da fixture) são ignorados. */
const modulos = (xs: readonly { modulo: string }[]): ModuloId[] => xs.map((x) => x.modulo).filter(ehModulo);

/** Linhas de `plataforma.parametro` → `{ modulo: { chave: valor } }`, só de módulos do produto ativos no tenant. */
export function parametrosPorModulo(
  linhas: readonly { modulo: string; chave: string; valor: unknown }[],
  ativos: readonly ModuloId[],
): LicencasUsuario['parametros'] {
  const saida: LicencasUsuario['parametros'] = {};
  for (const m of ativos) saida[m] = {};
  for (const l of linhas) {
    if (!ehModulo(l.modulo) || !ativos.includes(l.modulo)) continue;
    (saida[l.modulo] ??= {})[l.chave] = l.valor;
  }
  return saida;
}

export const licencasDoBanco: FonteLicencas = (usuario, banco) =>
  banco.comTenant(usuario.tenant_id, async (db) => {
    const tenant = await db.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null');
    const perfil = await db.query<{ modulo: string }>('select modulo from plataforma.perfil_modulo where perfil = $1 and deleted_at is null', [usuario.perfil]);
    const removidos = await db.query<{ modulo: string }>(
      "select modulo from plataforma.usuario_modulo where usuario_id = $1 and efeito = 'remover' and deleted_at is null",
      [usuario.id],
    );
    const params = await db.query<{ modulo: string; chave: string; valor: unknown }>(
      'select modulo, chave, valor from plataforma.parametro where deleted_at is null order by modulo, chave',
    );
    // fuso do tenant para ctx.fuso() (T-0035): o módulo não lê plataforma.tenant (regra 1, S0-014)
    const fuso = await db.query<{ fuso: string }>('select fuso from plataforma.tenant where id = plataforma.tenant_atual()');
    const ativosNoTenant = modulos(tenant.rows);
    return {
      ativosNoTenant,
      doPerfil: modulos(perfil.rows),
      removidosDoUsuario: modulos(removidos.rows),
      parametros: parametrosPorModulo(params.rows, ativosNoTenant),
      fuso: fuso.rows[0]?.fuso ?? null,
    };
  });
