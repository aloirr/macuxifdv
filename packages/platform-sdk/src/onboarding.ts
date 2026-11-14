/**
 * RN-CORE-31 Onboarding de tenant (desenho docs/desenho/T-0083.md §2 e §4). Função pura: valida a entrada do comando
 * `pnpm tenant:criar` e monta, a partir dos manifestos instalados, o plano que vai para `plataforma.provisionar_tenant`:
 * tenant (padrões da 0001), licenças dos módulos pedidos (core sempre; módulo sem a dependência obrigatória é recusado,
 * RN-CORE-03, nunca ligado sozinho), módulos por perfil (= `manifest.perfis`) e o admin inicial.
 *
 * Fora daqui: normalização do e-mail e política da senha do admin (domain do Core, `normalizarEmail` e
 * `validarSenhaInicial`, aplicados pelo comando), hash da senha (comando) e a gravação idempotente (banco).
 * Parâmetros padrão não geram linha (RN-CORE-31: vale o padrão do doc 03 enquanto o tenant não grava o seu).
 */
import { ehFusoValido } from './fuso';
import { ordenarPorDependencia, type Manifesto } from './manifesto';
import { MODULOS, type ModuloId, type Perfil } from './nomes';

/** Padrão da coluna `plataforma.tenant.fuso` (0001). */
export const FUSO_PADRAO_ONBOARDING = 'America/Sao_Paulo';
/** Padrão da coluna `plataforma.tenant.plano` (0001). */
export const PLANO_PADRAO_ONBOARDING = 'piloto';
/** Mesmo check `tenant_codigo_formato` da 0001. */
export const CODIGO_TENANT_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

const NOME_MAX = 200;
const PLANO_MAX = 40;
const DOCUMENTO_MAX = 20;
const EMAIL_MAX = 254;

export interface EntradaOnboarding {
  codigo: string;
  nome: string;
  documento?: string | null;
  /** IANA; ausente = `America/Sao_Paulo`. */
  fuso?: string | null;
  /** Ausente = `piloto`. */
  plano?: string | null;
  /** Módulos pedidos (core entra sempre). */
  modulos: readonly string[];
  /** Teto de licenças por módulo pedido (inteiro ≥ 0); ausente = sem teto. */
  licencas?: Readonly<Record<string, number>>;
  admin: { email: string; nome: string };
}

export interface ModuloDoPlano {
  modulo: ModuloId;
  licencas: number | null;
  /** Perfis padrão que usam o módulo (`plataforma.perfil_modulo`). */
  perfis: Perfil[];
}

export interface PlanoOnboarding {
  tenant: { codigo: string; nome: string; documento: string | null; fuso: string; plano: string };
  /** Em ordem de dependência, core primeiro. */
  modulos: ModuloDoPlano[];
  /** E-mail só aparado: a normalização é a do Core (`normalizarEmail`), aplicada pelo comando. */
  admin: { email: string; nome: string; perfil: 'admin' };
}

export type CodigoErroOnboarding =
  | 'CODIGO_INVALIDO'
  | 'NOME_INVALIDO'
  | 'DOCUMENTO_INVALIDO'
  | 'FUSO_INVALIDO'
  | 'PLANO_INVALIDO'
  | 'MODULO_DESCONHECIDO'
  | 'DEPENDENCIA_FALTANDO'
  | 'PROMOTOR_COM_VENDEDOR'
  | 'LICENCA_INVALIDA'
  | 'LICENCA_SEM_MODULO'
  | 'ADMIN_INVALIDO';

export interface ErroOnboarding {
  codigo: CodigoErroOnboarding;
  campo: string;
  mensagem: string;
  modulo?: string;
  dependencia?: string;
}

export type ResultadoOnboarding = { ok: true; plano: PlanoOnboarding } | { ok: false; erros: ErroOnboarding[] };

const ehModuloId = (m: string): m is ModuloId => (MODULOS as readonly string[]).includes(m);

/** RN-CORE-31: valida a entrada e monta o plano de onboarding. Junta todos os erros (nunca lança). */
export function planoDeOnboarding(e: EntradaOnboarding, manifestos: readonly Manifesto[]): ResultadoOnboarding {
  const erros: ErroOnboarding[] = [];
  const erro = (x: ErroOnboarding) => erros.push(x);

  const codigo = e.codigo.trim().toLowerCase();
  if (!CODIGO_TENANT_RE.test(codigo)) {
    erro({ codigo: 'CODIGO_INVALIDO', campo: 'codigo', mensagem: 'O código do tenant tem de 2 a 40 caracteres: letras minúsculas, números e hífen, começando por letra ou número.' });
  }
  const nome = e.nome.trim();
  if (nome.length === 0 || nome.length > NOME_MAX) erro({ codigo: 'NOME_INVALIDO', campo: 'nome', mensagem: `Informe o nome do tenant (até ${NOME_MAX} caracteres).` });
  const documento = e.documento?.trim() || null;
  if (documento && documento.length > DOCUMENTO_MAX) erro({ codigo: 'DOCUMENTO_INVALIDO', campo: 'documento', mensagem: `O documento pode ter até ${DOCUMENTO_MAX} caracteres.` });
  const fuso = e.fuso == null || e.fuso.trim() === '' ? FUSO_PADRAO_ONBOARDING : e.fuso.trim();
  if (!ehFusoValido(fuso)) erro({ codigo: 'FUSO_INVALIDO', campo: 'fuso', mensagem: 'Fuso desconhecido: use um nome IANA, como America/Manaus.' });
  const plano = e.plano == null ? PLANO_PADRAO_ONBOARDING : e.plano.trim();
  if (plano.length === 0 || plano.length > PLANO_MAX) erro({ codigo: 'PLANO_INVALIDO', campo: 'plano', mensagem: `Informe o plano (até ${PLANO_MAX} caracteres) ou deixe o padrão "${PLANO_PADRAO_ONBOARDING}".` });

  const instalados = new Map(manifestos.map((m) => [m.id, m] as const));
  const pedidos = new Set<ModuloId>(['core']);
  for (const bruto of e.modulos) {
    const m = bruto.trim().toLowerCase();
    if (ehModuloId(m) && instalados.has(m)) pedidos.add(m);
    else erro({ codigo: 'MODULO_DESCONHECIDO', campo: 'modulos', modulo: m, mensagem: `Módulo desconhecido ou não instalado: ${m || '(vazio)'}.` });
  }
  for (const id of pedidos) {
    const m = instalados.get(id)!;
    for (const d of m.depende) {
      if (!pedidos.has(d)) {
        erro({ codigo: 'DEPENDENCIA_FALTANDO', campo: 'modulos', modulo: id, dependencia: d, mensagem: `O módulo ${id} depende de ${d}: inclua ${d} em --modulos.` });
      }
    }
    // RN-PRO-01: o promotor nunca recebe o módulo Vendedor (os manifestos já garantem; aqui é a segunda trava).
    if (id === 'vendedor' && m.perfis.includes('promotor')) {
      erro({ codigo: 'PROMOTOR_COM_VENDEDOR', campo: 'modulos', modulo: id, mensagem: 'RN-PRO-01: o perfil promotor não pode receber o módulo vendedor.' });
    }
  }

  const licencas = new Map<string, number>();
  for (const [bruto, n] of Object.entries(e.licencas ?? {})) {
    const m = bruto.trim().toLowerCase();
    if (!Number.isInteger(n) || n < 0) erro({ codigo: 'LICENCA_INVALIDA', campo: 'licencas', modulo: m, mensagem: `Licenças de ${m}: informe um número inteiro maior ou igual a zero.` });
    else if (!ehModuloId(m) || !pedidos.has(m)) erro({ codigo: 'LICENCA_SEM_MODULO', campo: 'licencas', modulo: m, mensagem: `Licenças para ${m}, que não está em --modulos.` });
    else licencas.set(m, n);
  }

  const adminEmail = e.admin.email.trim();
  const adminNome = e.admin.nome.trim();
  if (adminEmail.length === 0 || adminEmail.length > EMAIL_MAX) erro({ codigo: 'ADMIN_INVALIDO', campo: 'admin.email', mensagem: 'Informe o e-mail do admin inicial.' });
  if (adminNome.length === 0 || adminNome.length > NOME_MAX) erro({ codigo: 'ADMIN_INVALIDO', campo: 'admin.nome', mensagem: `Informe o nome do admin inicial (até ${NOME_MAX} caracteres).` });

  if (erros.length > 0) return { ok: false, erros };

  const modulos = ordenarPorDependencia(manifestos.filter((m) => pedidos.has(m.id))).map(
    (m): ModuloDoPlano => ({ modulo: m.id, licencas: licencas.get(m.id) ?? null, perfis: [...m.perfis] }),
  );
  return {
    ok: true,
    plano: { tenant: { codigo, nome, documento, fuso, plano }, modulos, admin: { email: adminEmail, nome: adminNome, perfil: 'admin' } },
  };
}

/**
 * Entrada do passo Empresa do portal (T-0087; ADR 0029): igual à do comando, sem o admin inicial. Sem `codigo` (R-20261114-170600;
 * 0068), o código da licença (`UF` + 4 dígitos) é sorteado pelo banco: o plano sai com `codigo` nulo.
 */
export type EntradaOnboardingSemAdmin = Omit<EntradaOnboarding, 'admin' | 'codigo'> & { codigo?: string | null };
export type PlanoOnboardingSemAdmin = { tenant: Omit<PlanoOnboarding['tenant'], 'codigo'> & { codigo: string | null }; modulos: ModuloDoPlano[] };
export type ResultadoOnboardingSemAdmin = { ok: true; plano: PlanoOnboardingSemAdmin } | { ok: false; erros: ErroOnboarding[] };

/** Código de preenchimento, só para reusar a validação quando o código vem do sorteio do banco (nunca vai ao banco). */
const CODIGO_DO_SORTEIO = 'sorteio';

/**
 * RN-CORE-31 no portal de implantação: as mesmas regras do `planoDeOnboarding` (código, nome, fuso, módulos, dependências,
 * RN-PRO-01, licenças), sem o admin inicial — no portal, o admin inicial é conferido pela API (RN-CORE-34).
 */
export function planoDeOnboardingSemAdmin(e: EntradaOnboardingSemAdmin, manifestos: readonly Manifesto[]): ResultadoOnboardingSemAdmin {
  const sorteio = e.codigo == null || e.codigo.trim() === '';
  // admin (e, no sorteio, código) de preenchimento: só para reusar a validação; as regras deles não valem aqui
  const r = planoDeOnboarding({ ...e, codigo: sorteio ? CODIGO_DO_SORTEIO : (e.codigo as string), admin: { email: 'sem-admin', nome: 'sem-admin' } }, manifestos);
  if (!r.ok) return { ok: false, erros: r.erros.filter((x) => x.codigo !== 'ADMIN_INVALIDO') };
  const { admin: _semAdmin, tenant, modulos } = r.plano;
  return { ok: true, plano: { tenant: { ...tenant, codigo: sorteio ? null : tenant.codigo }, modulos } };
}
