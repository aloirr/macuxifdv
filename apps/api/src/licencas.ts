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
 *
 * ADR 0073 (E4/E6, troca de leitura dos perfis): a marca do tenant (`plataforma.catalogo_aplicado`, 0105) vem na mesma linha do
 * tenant (subconsulta, sem ida a mais ao banco) e decide o motor (`motorDoTenant`). Só no motor 'cargo' (tenant em 'concessao',
 * ligado pela 0109) a fonte lê também o perfil do usuário por `plataforma.perfil_do_usuario` (0109: código, cargo, base congelada
 * e concessões); no 'base' (tenant em 'legado', sem marca ou atrás da versão do código) nada muda. `perfis_do_usuario` segue lida
 * nos dois motores: dá os módulos do perfil (licença) e, no 'legado', os perfis do motor antigo.
 */
import {
  CargoSchema,
  ehModulo,
  motorDePermissao,
  type MotorPermissao,
  type PerfilPorCargo,
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
  /** ADR 0073 (E4): marca da transição do tenant (`plataforma.catalogo_aplicado`). Ausente = sem marca (motor antigo). */
  catalogo?: CatalogoAplicado | null;
  /**
   * ADR 0073 (E4/E6): perfil do usuário (vivo e ativo: código, cargo, base congelada e concessões), lido só no motor 'cargo'.
   * Ausente = não lido (motor 'base'); `null` = usuário sem perfil vivo e ativo (nada permitido no caminho novo, falha fechada).
   */
  perfilPorCargo?: PerfilDoUsuarioPorCargo | null;
}

/** Linha viva de `plataforma.catalogo_aplicado` (0105): versão do catálogo aplicada e a leitura do tenant na transição. */
export interface CatalogoAplicado {
  versao: number;
  leitura: 'legado' | 'concessao';
}

/**
 * O que `camposPeloCargo` precisa do perfil do usuário e a base congelada (`plataforma.perfil.base`, o valor de
 * `core.usuario.perfil` na fase 1; ausente ou fora de `PERFIS` = sem base).
 */
export type PerfilDoUsuarioPorCargo = Pick<PerfilPorCargo, 'codigo' | 'cargo' | 'permissoes'> & { base?: Perfil | null };

/**
 * Motor da permissão do tenant (ADR 0073 §6, RN-CORE-35): 'cargo' só com a leitura 'concessao' E o catálogo na versão do código
 * (`motorDePermissao`); 'legado', sem marca ou versão atrás = 'base' (o motor de hoje).
 */
export function motorDoTenant(catalogo: CatalogoAplicado | null | undefined): MotorPermissao {
  return motorDePermissao(catalogo?.leitura === 'concessao' ? catalogo.versao : null);
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
  /** ADR 0073 (E4): marca da transição (também do super-admin, que usa a parte do tenant). */
  catalogo?: CatalogoAplicado | null;
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
  // catálogo aplicado (0105, ADR 0073 E4): a linha viva de versão mais alta, na mesma consulta (RLS do tenant)
  const linha = (
    await db.query<LinhaMarcaTenant & { fuso: string; catalogo: unknown }>(
      `select fuso, nome, nome_fantasia, logo_sha256, logo_tipo, logo_largura_px, logo_altura_px,
              (to_jsonb(t) ->> 'ocultar_marca_macuxi')::boolean as ocultar_marca_macuxi,
              (select jsonb_build_object('versao', c.versao, 'leitura', c.leitura) from plataforma.catalogo_aplicado c
                where c.tenant_id = t.id and c.deleted_at is null order by c.versao desc limit 1) as catalogo
         from plataforma.tenant t where t.id = plataforma.tenant_atual()`,
    )
  ).rows[0];
  const ativosNoTenant = modulos(tenant.rows);
  return {
    ativosNoTenant,
    parametros: comEmpresa(parametrosPorModulo(params.rows, ativosNoTenant), linha),
    fuso: linha?.fuso ?? null,
    catalogo: catalogoDe(linha?.catalogo),
  };
}

/** jsonb `{ versao, leitura }` → `CatalogoAplicado`; fora do formato = sem marca (motor antigo). */
function catalogoDe(bruto: unknown): CatalogoAplicado | null {
  const c = bruto as { versao?: unknown; leitura?: unknown } | null | undefined;
  if (!c || !Number.isInteger(c.versao) || (c.leitura !== 'legado' && c.leitura !== 'concessao')) return null;
  return { versao: c.versao as number, leitura: c.leitura };
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

/** Concessões (jsonb `{ chave: { nivel?, alvos? } }`) → permissões; item fora do formato é ignorado (o banco valida na escrita). */
function concessoesDe(bruto: unknown): PerfilPorCargo['permissoes'] {
  const saida: Record<string, { nivel?: NivelPermissao; alvos?: string[] }> = {};
  if (!bruto || typeof bruto !== 'object') return saida;
  for (const [chave, v] of Object.entries(bruto as Record<string, { nivel?: unknown; alvos?: unknown } | null>)) {
    if (!v || typeof v !== 'object') continue;
    const alvos = Array.isArray(v.alvos) ? v.alvos.filter((a): a is string => typeof a === 'string') : null;
    saida[chave] = { ...(ehNivel(v.nivel) ? { nivel: v.nivel } : {}), ...(alvos && alvos.length > 0 ? { alvos } : {}) };
  }
  return saida;
}

/**
 * ADR 0073 §2.7 (E6): o perfil vivo e ativo do usuário no tenant do contexto (um só, RN-CORE-54) por
 * `plataforma.perfil_do_usuario` (0109, SECURITY INVOKER: a RLS vale; 0 ou 1 linha). No tenant em 'concessao', `permissoes` são
 * as concessões vivas. Sem perfil ou cargo desconhecido = `null` (falha fechada); base fora de `PERFIS` = sem base.
 */
async function lerPerfilDoUsuario(db: ClienteBanco, usuarioId: string): Promise<PerfilDoUsuarioPorCargo | null> {
  const r = await db.query<{ codigo: string; cargo: string; base: string | null; permissoes: unknown }>(
    'select codigo, cargo, base, permissoes from plataforma.perfil_do_usuario($1)',
    [usuarioId],
  );
  const l = r.rows[0];
  const cargo = CargoSchema.safeParse(l?.cargo);
  if (!l || !cargo.success) return null;
  return { codigo: l.codigo, cargo: cargo.data, base: l.base && ehPerfil(l.base) ? l.base : null, permissoes: concessoesDe(l.permissoes) };
}

export const licencasDoBanco: FonteLicencas = (usuario, banco) =>
  banco.comTenant(usuario.tenant_id, async (db) => {
    const t = await lerTenant(db);
    const { perfis, doPerfil } = await lerPerfis(db, usuario.id);
    const removidos = await db.query<{ modulo: string }>(
      "select modulo from plataforma.usuario_modulo where usuario_id = $1 and efeito = 'remover' and deleted_at is null",
      [usuario.id],
    );
    // ADR 0073 (E6): o perfil por concessão só no motor 'cargo' (no 'base' o tenant pode não ter concessões)
    const perfilPorCargo = motorDoTenant(t.catalogo) === 'cargo' ? { perfilPorCargo: await lerPerfilDoUsuario(db, usuario.id) } : {};
    return { ...t, doPerfil, removidosDoUsuario: modulos(removidos.rows), perfis, ...perfilPorCargo };
  });

/** Licenças do tenant da chave do Conector (`plataforma.tenant_modulo`, `parametro`, `tenant.fuso`), uma transação. */
export const licencasDoTenantNoBanco: FonteLicencasTenant = (tenantId, banco) => banco.comTenant(tenantId, lerTenant);
