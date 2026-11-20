/**
 * Fonte das licenças do usuário (RN-CORE-01/02/03), lida A CADA REQUISIÇÃO (nunca do JWT, S0-055):
 * `plataforma.tenant_modulo` (ativos no tenant), os perfis de acesso do usuário com os módulos padrão de cada um
 * (`plataforma.perfis_do_usuario`, 0041; multiperfil = união, RN-CORE-01/35) e `plataforma.usuario_modulo` (exceções que
 * removem). Tudo dentro de `comTenant` (RLS do tenant do token).
 * O cálculo dos efetivos é o do platform-sdk (`modulosEfetivos`), feito em `createApp`.
 *
 * Parâmetros do tenant: fonte ÚNICA `plataforma.parametro` (uma linha por módulo + chave, doc 03 "Parâmetros do
 * tenant"; desenho T-0016 §7). `tenant_modulo.parametros` é legado e não é lido (decisão da onda 1 da Sprint 1).
 *
 * Fuso do tenant (`plataforma.tenant.fuso`): lido aqui também e entregue às rotas como `ctx.fuso()` (T-0035).
 * Nome e logo da empresa (T-0182, desenho §3.1): da mesma linha do tenant, entram nos parâmetros do Core como as chaves
 * reservadas `empresa_nome`, `empresa_logo` e `empresa_ocultar_marca_macuxi` (0091; `parametrosDaEmpresa` do SDK; sobrescrevem uma linha de `plataforma.parametro`
 * com o mesmo nome). Assim chegam ao aparelho pelo `GET /v1/me/modulos` e pelo `GET /v1/sync/novidades`, e trocar a logo ou
 * o nome muda o `versao_licencas`.
 * Rotas de Conector (ADR 0013): `licencasDoTenantNoBanco`, só a parte do tenant (não há usuário nem perfil).
 */
import {
  ehModulo,
  NIVEIS_ALCADA,
  parametrosDaEmpresa,
  NIVEIS_ESCOPO,
  PERFIS,
  uniaoDosModulosDosPerfis,
  type AcessoBanco,
  type ClienteBanco,
  type LinhaMarcaTenant,
  type ModuloId,
  type NivelPermissao,
  type Perfil,
  type PerfilDeAcesso,
  type SobreposicaoPermissao,
  type UsuarioAutenticado,
} from '@macuxi/platform-sdk';

export interface LicencasUsuario {
  ativosNoTenant: ModuloId[];
  doPerfil: ModuloId[];
  removidosDoUsuario: ModuloId[];
  /** Parâmetros do módulo no tenant (`plataforma.parametro`: chave → valor), devolvidos em `GET /v1/me/modulos`. */
  parametros: Partial<Record<ModuloId, Record<string, unknown>>>;
  /** Fuso IANA do tenant (`plataforma.tenant.fuso`); vira `ctx.fuso()` (ausente/inválido = America/Manaus, T-0035). */
  fuso?: string | null;
  /**
   * ADR 0033 (T-0111/T-0112): perfis de acesso do usuário (`plataforma.perfil` + sobreposições), lidos com as licenças. Ausente =
   * a fonte ainda não lê perfis (vale o perfil de fábrica do token); vazio = usuário sem perfil (nada permitido, RN-CORE-01).
   */
  perfis?: PerfilDeAcesso[];
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

/** Licenças e parâmetros do tenant SEM usuário (rotas de Conector, ADR 0013 §3 item 4): quem chama é uma máquina, sem perfil. */
export interface LicencasTenant {
  ativosNoTenant: ModuloId[];
  parametros: LicencasUsuario['parametros'];
  fuso?: string | null;
}

export type FonteLicencasTenant = (tenantId: string, banco: AcessoBanco) => Promise<LicencasTenant>;

/** Parte do tenant (módulos ativos, parâmetros e fuso), dentro de uma transação já com o tenant (RLS). */
async function lerTenant(db: ClienteBanco): Promise<LicencasTenant> {
  const tenant = await db.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where ativo and deleted_at is null');
  const params = await db.query<{ modulo: string; chave: string; valor: unknown }>(
    'select modulo, chave, valor from plataforma.parametro where deleted_at is null order by modulo, chave',
  );
  // fuso (T-0035), nome e logo (T-0182) do tenant: o módulo não lê plataforma.tenant (regra 1, S0-014).
  // `ocultar_marca_macuxi` (0091, item 15) lido pelo jsonb da linha: antes da 0091 vem `null` (= false) em vez de 42703, que
  // derrubaria o login e o `/v1/me/modulos` de todos se a API subir antes da migração.
  const linha = (
    await db.query<LinhaMarcaTenant & { fuso: string }>(
      `select fuso, nome, nome_fantasia, logo_sha256, logo_tipo, logo_largura_px, logo_altura_px,
              (to_jsonb(t) ->> 'ocultar_marca_macuxi')::boolean as ocultar_marca_macuxi
         from plataforma.tenant t where t.id = plataforma.tenant_atual()`,
    )
  ).rows[0];
  const ativosNoTenant = modulos(tenant.rows);
  return { ativosNoTenant, parametros: comEmpresa(parametrosPorModulo(params.rows, ativosNoTenant), linha), fuso: linha?.fuso ?? null };
}

/** Chaves reservadas `empresa_nome`/`empresa_logo` nos parâmetros do Core (T-0182); sem a linha do tenant ou sem o Core, nada muda. */
export function comEmpresa(parametros: LicencasUsuario['parametros'], linha: LinhaMarcaTenant | undefined): LicencasUsuario['parametros'] {
  if (!linha || !parametros.core) return parametros;
  return { ...parametros, core: { ...parametros.core, ...parametrosDaEmpresa(linha) } };
}

/** Linha de `plataforma.perfis_do_usuario` (0041; ADR 0033). */
interface LinhaPerfilDoUsuario {
  codigo: string;
  base: string;
  fabrica: boolean;
  sobreposicoes: unknown;
  modulos: string[] | null;
}

const ehPerfil = (p: string): p is Perfil => (PERFIS as readonly string[]).includes(p);
const ehNivel = (n: unknown): n is NivelPermissao => typeof n === 'string' && ([...NIVEIS_ESCOPO, ...NIVEIS_ALCADA] as readonly string[]).includes(n);

/** `sobreposicoes` (jsonb da 0041) → `SobreposicaoPermissao[]`; item fora do formato é ignorado (o banco já valida na escrita). */
function sobreposicoesDe(bruto: unknown): SobreposicaoPermissao[] {
  if (!Array.isArray(bruto)) return [];
  const saida: SobreposicaoPermissao[] = [];
  for (const i of bruto as { chave?: unknown; concedida?: unknown; nivel?: unknown; alvos?: unknown }[]) {
    if (typeof i?.chave !== 'string' || typeof i.concedida !== 'boolean') continue;
    const alvos = Array.isArray(i.alvos) ? i.alvos.filter((a): a is string => typeof a === 'string') : null;
    saida.push({ chave: i.chave, concedida: i.concedida, nivel: ehNivel(i.nivel) ? i.nivel : null, alvos });
  }
  return saida;
}

/**
 * ADR 0033 (T-0111/T-0112): perfis de acesso do usuário NO TENANT da transação (`plataforma.perfis_do_usuario`, 0041, SECURITY
 * INVOKER: a RLS vale) e a UNIÃO dos módulos padrão deles (RN-CORE-01). Base desconhecida = perfil ignorado (falha fechada).
 */
async function lerPerfis(db: ClienteBanco, usuarioId: string): Promise<{ perfis: PerfilDeAcesso[]; doPerfil: ModuloId[] }> {
  const r = await db.query<LinhaPerfilDoUsuario>('select codigo, base, fabrica, sobreposicoes, modulos from plataforma.perfis_do_usuario($1)', [usuarioId]);
  const linhas = r.rows.filter((l) => ehPerfil(l.base));
  return {
    perfis: linhas.map((l) => ({ codigo: l.codigo, base: l.base as Perfil, ativo: true, fabrica: l.fabrica, sobreposicoes: sobreposicoesDe(l.sobreposicoes) })),
    doPerfil: uniaoDosModulosDosPerfis(linhas.map((l) => (l.modulos ?? []).filter(ehModulo))),
  };
}

export const licencasDoBanco: FonteLicencas = (usuario, banco) =>
  banco.comTenant(usuario.tenant_id, async (db) => {
    const t = await lerTenant(db);
    const { perfis, doPerfil } = await lerPerfis(db, usuario.id);
    const removidos = await db.query<{ modulo: string }>(
      "select modulo from plataforma.usuario_modulo where usuario_id = $1 and efeito = 'remover' and deleted_at is null",
      [usuario.id],
    );
    return { ...t, doPerfil, removidosDoUsuario: modulos(removidos.rows), perfis };
  });

/** Licenças do tenant da chave do Conector (`plataforma.tenant_modulo`, `parametro`, `tenant.fuso`), uma transação. */
export const licencasDoTenantNoBanco: FonteLicencasTenant = (tenantId, banco) => banco.comTenant(tenantId, lerTenant);
