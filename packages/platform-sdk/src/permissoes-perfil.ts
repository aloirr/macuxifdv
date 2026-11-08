/**
 * Motor de permissões por perfil (ADR 0033; T-0111/T-0112; doc 03 §2 "padrão de fábrica editável").
 *
 * O controle de "quem pode o quê" fica nos PERFIS DE ACESSO do tenant, editados pelo admin no BKO, e não em regra fixa no código:
 * - CHAVE: o nome estável de uma permissão. As da plataforma (onde entra, escopo de dados, usuários, senhas e perfis) ficam aqui
 *   (`CHAVES_PLATAFORMA`); as dos módulos são as ações do manifesto (`<entidade>.<verbo>`, ADR 0004), agrupadas por área.
 * - PADRÃO DE FÁBRICA (`matrizDeFabrica`): o valor inicial de cada perfil base = as chaves da plataforma abaixo + o `perfis` de
 *   cada ação do manifesto. O banco guarda só o que o tenant mudou (`SobreposicaoPermissao`); o resto segue a fábrica.
 * - PERFIL: de fábrica (código = o perfil base, não apaga) ou personalizado (criado a partir de um perfil base, que não muda).
 * - MULTIPERFIL (RN-CORE-01): o usuário tem um ou mais perfis; vale a UNIÃO das permissões (nível mais alto, alvos somados).
 * - LIMITES TRAVADOS: nenhuma sobreposição os vence. RN-CORE-33 (vendedor, promotor e supervisor, e os derivados, nunca entram no
 *   BKO nem no portal; o portal é só do admin) e RN-PRO-01 (promotor nunca escreve pedido) valem em cada perfil e, no multiperfil,
 *   pela regra MAIS RESTRITIVA (basta um perfil do usuário para travar). O escopo de dados nunca passa o da base. A senha de quem
 *   tem perfil de base admin e a própria nunca são redefinidas por aqui. O tenant sempre tem um admin ativo com a gestão de
 *   usuários e perfis, e o admin não a tira de si (`validarAcessoDoTenant`). RN-CORE-32 vale para toda senha (nenhuma chave a
 *   desliga).
 * A API resolve os perfis do usuário A CADA REQUISIÇÃO (como a licença; nunca no JWT) e entrega em `ctx.usuario.perfis`;
 * a rota declara a chave em `acao` ou consulta `pode(ctx.usuario.perfis, chave, alvo?)`. Tudo aqui é função pura.
 */
import { z } from 'zod';
import type { Escopo } from './acesso';
import type { Manifesto } from './manifesto';
import { ACAO_RE, ehAcaoDeEscritaDePedido, PERFIS, type ModuloId, type Perfil } from './nomes';

// ---------------------------------------------------------------- níveis

/** Níveis de alcance, do menor ao maior. `proprio` = só o que é do usuário; `carteira` = clientes da carteira (RN-CORE-04). */
export const NIVEIS_ESCOPO = ['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'] as const;
export type NivelEscopo = (typeof NIVEIS_ESCOPO)[number];

/** Níveis de alçada (aprovar desconto e crédito), do menor ao maior. */
export const NIVEIS_ALCADA = ['ate_alcada', 'acima_alcada'] as const;
export type NivelAlcada = (typeof NIVEIS_ALCADA)[number];

export const FAMILIAS_NIVEL = { escopo: NIVEIS_ESCOPO, alcada: NIVEIS_ALCADA } as const;
export type FamiliaNivel = keyof typeof FAMILIAS_NIVEL;
export type NivelPermissao = NivelEscopo | NivelAlcada;

/** Família e posição de um nível (as famílias não repetem nomes). `null` = nível desconhecido. */
function posicaoDoNivel(n: string): { familia: FamiliaNivel; i: number } | null {
  for (const familia of Object.keys(FAMILIAS_NIVEL) as FamiliaNivel[]) {
    const i = (FAMILIAS_NIVEL[familia] as readonly string[]).indexOf(n);
    if (i >= 0) return { familia, i };
  }
  return null;
}

// ---------------------------------------------------------------- valores e chaves

/** Perfis-alvo: `'*'` = todos os perfis do tenant que não são de base admin (inclusive os personalizados criados depois). */
export const ALVO_TODOS = '*';

/** Valor de uma permissão concedida. Chave ausente = negada (falha fechada). */
export interface ValorPermissao {
  /** Só em chave com nível (`DefinicaoChave.nivel`). */
  nivel?: NivelPermissao;
  /** Só em chave com alvos (`senha.redefinir`): códigos de perfil ou `ALVO_TODOS`. */
  alvos?: readonly string[];
}

/** Chave → valor. Só as concedidas aparecem. */
export type PermissoesDoPerfil = Readonly<Record<string, ValorPermissao>>;

/** Áreas da página "Perfis de acesso" (agrupamento; a chave não muda quando a área muda). */
export const AREAS_PERMISSAO = [
  'acesso',
  'dados',
  'usuarios',
  'clientes',
  'pedidos',
  'catalogo',
  'trade',
  'pesquisa',
  'treinamento',
  'metas',
  'gestao',
  'integracao',
  'administracao',
] as const;
export type AreaPermissao = (typeof AREAS_PERMISSAO)[number];

export interface DefinicaoChave {
  chave: string;
  area: AreaPermissao;
  /** Módulo dono (licença): a chave só vale com ele efetivo. As da plataforma são do `core` (sempre ativo). */
  modulo: ModuloId;
  descricao: string;
  /** Chave com nível (o valor leva `nivel` desta família). */
  nivel?: FamiliaNivel;
  /** Chave com perfis-alvo (o valor leva `alvos`). */
  alvos?: true;
  /** Nunca vale sobre o próprio usuário (`AlvoPermissao.proprio`). */
  nuncaNoProprio?: true;
}

/** Chaves da plataforma (o SDK é o dono; ADR 0033). Os módulos não declaram estas chaves no manifesto. */
export const CHAVES_PLATAFORMA = {
  'acesso.campo': { area: 'acesso', descricao: 'Entra no app Macuxi Campo' },
  'acesso.gestao': { area: 'acesso', descricao: 'Entra no app Macuxi Gestão' },
  'acesso.bko': { area: 'acesso', descricao: 'Entra no backoffice (BKO)' },
  'acesso.portal': { area: 'acesso', descricao: 'Entra no portal de implantação (config.)' },
  'dados.escopo': { area: 'dados', nivel: 'escopo', descricao: 'Escopo de dados: carteira própria, equipe, equipes abaixo ou toda a empresa (RN-CORE-04)' },
  'usuario.criar': { area: 'usuarios', descricao: 'Criar usuário (RN-CORE-34)' },
  'usuario.editar': { area: 'usuarios', descricao: 'Editar usuário: nome, e-mail, equipe e perfis' },
  'usuario.desativar': { area: 'usuarios', nuncaNoProprio: true, descricao: 'Desativar e reativar usuário (nunca o próprio)' },
  'senha.redefinir': { area: 'usuarios', alvos: true, nuncaNoProprio: true, descricao: 'Redefinir a senha dos perfis escolhidos (nunca a de admin nem a própria)' },
  'perfil.gerir': { area: 'usuarios', descricao: 'Gerenciar os perfis de acesso' },
} as const satisfies Readonly<Record<string, Omit<DefinicaoChave, 'chave' | 'modulo'>>>;
export type ChavePlataforma = keyof typeof CHAVES_PLATAFORMA;

export const ehChavePlataforma = (chave: string): chave is ChavePlataforma => Object.hasOwn(CHAVES_PLATAFORMA, chave);

/** Onde o usuário entra → chave. */
export const CHAVE_ACESSO = { campo: 'acesso.campo', gestao: 'acesso.gestao', bko: 'acesso.bko', portal: 'acesso.portal' } as const;
export type LugarDeAcesso = keyof typeof CHAVE_ACESSO;

/** A gestão do acesso que o tenant nunca perde e que o admin não tira de si (último admin; doc 03 §2). */
export const CHAVES_GESTAO_DO_ACESSO = ['perfil.gerir', 'usuario.criar', 'usuario.editar', 'usuario.desativar'] as const;

/** Perfis base que nunca entram no BKO nem no portal (RN-CORE-33), nem os perfis derivados deles. */
export const BASES_SEM_BKO: readonly Perfil[] = ['vendedor', 'promotor', 'supervisor'];

// ---------------------------------------------------------------- padrão de fábrica

/**
 * Padrão de fábrica das chaves da plataforma por perfil base (doc 03 §2 e premissas P2/P7 da T-0094): onde entra (os apps de cada
 * perfil e o BKO; o portal só o admin), o escopo de dados (RN-CORE-04) e a gestão de usuários, senhas e perfis só no admin, que
 * redefine a senha de todos os perfis menos a de admin e a própria.
 */
const FABRICA_PLATAFORMA: Readonly<Record<Perfil, PermissoesDoPerfil>> = {
  vendedor: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'carteira' } },
  promotor: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'carteira' } },
  supervisor: { 'acesso.gestao': {}, 'dados.escopo': { nivel: 'equipe' } },
  gerente: { 'acesso.gestao': {}, 'acesso.bko': {}, 'dados.escopo': { nivel: 'equipes_abaixo' } },
  analista: { 'acesso.bko': {}, 'dados.escopo': { nivel: 'tenant' } },
  assistente: { 'acesso.bko': {}, 'dados.escopo': { nivel: 'tenant' } },
  admin: {
    'acesso.bko': {},
    'acesso.portal': {},
    'dados.escopo': { nivel: 'tenant' },
    'usuario.criar': {},
    'usuario.editar': {},
    'usuario.desativar': {},
    'senha.redefinir': { alvos: [ALVO_TODOS] },
    'perfil.gerir': {},
  },
};

/** Padrão de fábrica de todos os perfis base: chave → valor. */
export type MatrizFabrica = Readonly<Record<Perfil, PermissoesDoPerfil>>;

/** Plataforma + `perfis` de cada ação dos manifestos instalados (ADR 0004). Erro se um manifesto declarar chave da plataforma. */
export function matrizDeFabrica(manifestos: readonly Manifesto[]): MatrizFabrica {
  const m = Object.fromEntries(PERFIS.map((p) => [p, { ...FABRICA_PLATAFORMA[p] }])) as Record<Perfil, Record<string, ValorPermissao>>;
  for (const man of manifestos) {
    for (const [acao, def] of Object.entries(man.acoes)) {
      if (ehChavePlataforma(acao)) throw new Error(`Ação ${acao} do módulo ${man.id} é chave da plataforma (ADR 0033)`);
      for (const p of def.perfis) m[p][acao] = {};
    }
  }
  return m;
}

/** Escopo de dados máximo de um perfil base (o personalizado herda e só pode reduzir). */
export const escopoMaximoDaBase = (base: Perfil): NivelEscopo => FABRICA_PLATAFORMA[base]['dados.escopo']?.nivel as NivelEscopo;

const AREA_DO_MODULO: Readonly<Record<Exclude<ModuloId, 'core'>, AreaPermissao>> = {
  catalogo: 'catalogo',
  vendedor: 'pedidos',
  promotor: 'trade',
  pesquisa: 'pesquisa',
  treinamento: 'treinamento',
  gestor: 'gestao',
  integracao: 'integracao',
};
const AREA_DA_ENTIDADE_DO_CORE: Readonly<Record<string, AreaPermissao>> = {
  meta: 'metas',
  plano_rv: 'metas',
  rv: 'metas',
  cliente: 'clientes',
  carteira: 'clientes',
  usuario: 'usuarios',
};

/** Área de uma ação de módulo na página (pelo módulo; no Core, pela entidade). */
export function areaDaAcao(modulo: ModuloId, acao: string): AreaPermissao {
  if (modulo !== 'core') return AREA_DO_MODULO[modulo];
  return AREA_DA_ENTIDADE_DO_CORE[acao.slice(0, acao.indexOf('.'))] ?? 'administracao';
}

/** Catálogo de chaves (plataforma + ações dos manifestos), na ordem das áreas e depois da chave. Base da página e da validação. */
export function catalogoDePermissoes(manifestos: readonly Manifesto[]): DefinicaoChave[] {
  const lista: DefinicaoChave[] = Object.entries(CHAVES_PLATAFORMA).map(([chave, d]) => ({ chave, modulo: 'core' as const, ...d }));
  for (const m of manifestos) {
    for (const [acao, def] of Object.entries(m.acoes)) lista.push({ chave: acao, area: areaDaAcao(m.id, acao), modulo: m.id, descricao: def.descricao ?? acao });
  }
  const ordem = (a: AreaPermissao) => AREAS_PERMISSAO.indexOf(a);
  return lista.sort((a, b) => ordem(a.area) - ordem(b.area) || a.chave.localeCompare(b.chave));
}

// ---------------------------------------------------------------- perfis do tenant

/** Código do perfil no tenant: o de fábrica = o perfil base; o personalizado = minúsculas, dígitos e `_` (único no tenant). */
export const CODIGO_PERFIL_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** O que o tenant mudou numa chave em relação à fábrica da base (`plataforma.perfil_permissao`). */
export interface SobreposicaoPermissao {
  chave: string;
  /** `false` = tira a chave que a fábrica dá. */
  concedida: boolean;
  /** Ausente/nulo = o nível da fábrica (ou o menor da família, se a fábrica não dá a chave). */
  nivel?: NivelPermissao | null;
  /** Ausente/nulo = os alvos da fábrica (ou nenhum). */
  alvos?: readonly string[] | null;
}

/** Perfil de acesso do tenant (`plataforma.perfil` + as sobreposições). */
export interface PerfilDeAcesso {
  codigo: string;
  base: Perfil;
  ativo: boolean;
  /** Perfil de fábrica: código = base; não é apagado nem desativado. */
  fabrica: boolean;
  sobreposicoes: readonly SobreposicaoPermissao[];
}

/** Perfil de fábrica sem nada mudado (tenant sem linhas, super-admin, testes). */
export const perfilDeFabrica = (base: Perfil): PerfilDeAcesso => ({ codigo: base, base, ativo: true, fabrica: true, sobreposicoes: [] });

/** Perfil já resolvido para a requisição: fábrica da base + sobreposições + limites travados do perfil. */
export interface PerfilDaRequisicao {
  codigo: string;
  base: Perfil;
  permissoes: PermissoesDoPerfil;
}

/**
 * Zod de `PerfilDaRequisicao` para respostas ao cliente (R-20261107-233521, item 3): `GET /v1/me/modulos` passa a levar os
 * perfis resolvidos (campo aditivo `perfis?` no contrato do Core) para os shells montarem a visão com o que o tenant mudou.
 * Só a forma; os limites (RN-CORE-33/35) já vêm aplicados por `resolverPerfil` e a API revalida em toda rota.
 */
export const PerfilDaRequisicaoSchema = z
  .object({
    codigo: z.string().regex(CODIGO_PERFIL_RE),
    base: z.enum(PERFIS),
    permissoes: z.record(
      z.string().regex(ACAO_RE),
      z.object({ nivel: z.enum([...NIVEIS_ESCOPO, ...NIVEIS_ALCADA]).optional(), alvos: z.array(z.string().min(1)).optional() }).strict(),
    ),
  })
  .strict();

/** Referência a um perfil (alvo de `senha.redefinir`, auditoria). */
export interface RefPerfil {
  codigo: string;
  base: Perfil;
}

export interface TravaDaChave {
  regra: string;
  mensagem: string;
}

/**
 * Limite travado de uma chave para um perfil base (o cadeado da página, com a regra). `null` = editável.
 * No multiperfil (`combinarPerfis`, RN-CORE-35), os limites de ACESSO (BKO, portal) valem se QUALQUER perfil do usuário os tiver;
 * os de ação travam só o perfil.
 */
export function travaDaChave(base: Perfil, chave: string): TravaDaChave | null {
  const nome = ROTULO_BASE[base];
  if (chave === CHAVE_ACESSO.bko && BASES_SEM_BKO.includes(base)) return { regra: 'RN-CORE-33', mensagem: `${nome} nunca entra no BKO (RN-CORE-33).` };
  if (chave === CHAVE_ACESSO.portal && base !== 'admin') return { regra: 'RN-CORE-33', mensagem: `O portal é só do admin (RN-CORE-33).` };
  if (base === 'promotor' && ehAcaoDeEscritaDePedido(chave)) return { regra: 'RN-PRO-01', mensagem: 'Promotor nunca cria, edita, cancela ou exclui pedido (RN-PRO-01).' };
  return null;
}

const ROTULO_BASE: Readonly<Record<Perfil, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente',
  admin: 'Admin',
};

function menorNivel(chave: string): NivelPermissao | undefined {
  const familia = ehChavePlataforma(chave) ? (CHAVES_PLATAFORMA[chave] as Partial<DefinicaoChave>).nivel : undefined;
  return familia ? FAMILIAS_NIVEL[familia][0] : undefined;
}

/** Tira o que um limite travado proíbe a um perfil base e corta o escopo de dados no da base. */
function aplicarTravasDoPerfil(base: Perfil, p: Record<string, ValorPermissao>): void {
  for (const chave of Object.keys(p)) if (travaDaChave(base, chave)) delete p[chave];
  const escopo = p['dados.escopo'];
  if (escopo) {
    const max = escopoMaximoDaBase(base);
    const pos = escopo.nivel ? posicaoDoNivel(escopo.nivel) : null;
    // nível ausente ou fora da família = o menor escopo de dados (falha fechada); acima da base = o da base
    if (!pos || pos.familia !== 'escopo') p['dados.escopo'] = { nivel: 'carteira' };
    else if (pos.i > NIVEIS_ESCOPO.indexOf(max)) p['dados.escopo'] = { nivel: max };
  }
}

/** Fábrica da base + sobreposições do tenant + limites travados do perfil. */
export function resolverPerfil(perfil: PerfilDeAcesso, matriz: MatrizFabrica): PerfilDaRequisicao {
  const fabrica = matriz[perfil.base];
  const p: Record<string, ValorPermissao> = { ...fabrica };
  for (const s of perfil.sobreposicoes) {
    if (!s.concedida) {
      delete p[s.chave];
      continue;
    }
    const daFabrica = fabrica[s.chave];
    const nivel = s.nivel ?? daFabrica?.nivel ?? menorNivel(s.chave);
    const alvos = s.alvos ?? daFabrica?.alvos;
    p[s.chave] = { ...(nivel ? { nivel } : {}), ...(alvos ? { alvos: [...alvos] } : {}) };
  }
  aplicarTravasDoPerfil(perfil.base, p);
  return { codigo: perfil.codigo, base: perfil.base, permissoes: p };
}

/**
 * Multiperfil (RN-CORE-01; RN-CORE-35, confirmada pelo dono do produto em 07/11/2026): nas AÇÕES vale a UNIÃO dos perfis (nível
 * mais alto, alvos somados); os limites travados de ação (ex.: RN-PRO-01, escrita de pedido) já saíram de cada perfil em
 * `resolverPerfil` — travam o PERFIL, não o usuário: vendedor + promotor cria pedido pelo perfil de vendedor. Nos ACESSOS (BKO e
 * portal, RN-CORE-33) vale a regra MAIS RESTRITIVA: basta um perfil de base vendedor, promotor ou supervisor para fechar o BKO e o
 * portal; basta um que não seja admin para fechar o portal. Sem perfil = nada.
 */
/** RN-CORE-35: acessos em que o multiperfil segue a regra mais restritiva (os outros limites travam só o perfil). */
const CHAVES_DE_ACESSO_RESTRITIVAS = [CHAVE_ACESSO.bko, CHAVE_ACESSO.portal] as const;

export function combinarPerfis(perfis: readonly PerfilDaRequisicao[]): PermissoesDoPerfil {
  const u: Record<string, ValorPermissao> = {};
  for (const perfil of perfis) {
    for (const [chave, v] of Object.entries(perfil.permissoes)) {
      const atual = u[chave];
      if (!atual) {
        u[chave] = { ...v, ...(v.alvos ? { alvos: [...v.alvos] } : {}) };
        continue;
      }
      const nivel = maiorNivel(atual.nivel, v.nivel);
      const alvos = somarAlvos(atual.alvos, v.alvos);
      u[chave] = { ...(nivel ? { nivel } : {}), ...(alvos ? { alvos } : {}) };
    }
  }
  for (const perfil of perfis) for (const chave of CHAVES_DE_ACESSO_RESTRITIVAS) if (u[chave] && travaDaChave(perfil.base, chave)) delete u[chave];
  return u;
}

function maiorNivel(a: NivelPermissao | undefined, b: NivelPermissao | undefined): NivelPermissao | undefined {
  if (!a || !b) return a ?? b;
  const pa = posicaoDoNivel(a);
  const pb = posicaoDoNivel(b);
  if (!pa || !pb || pa.familia !== pb.familia) return a;
  return pb.i > pa.i ? b : a;
}

function somarAlvos(a: readonly string[] | undefined, b: readonly string[] | undefined): readonly string[] | undefined {
  if (!a || !b) return a ?? b;
  if (a.includes(ALVO_TODOS) || b.includes(ALVO_TODOS)) return [ALVO_TODOS];
  return [...new Set([...a, ...b])].sort();
}

// ---------------------------------------------------------------- consulta

/** Sobre quem a ação recai (usuário-alvo): se é o próprio e os perfis dele. */
export interface AlvoPermissao {
  proprio: boolean;
  perfis: readonly RefPerfil[];
}

/** Os perfis-alvo cobrem TODOS os perfis do alvo, e nenhum deles é de base admin (a senha de admin não é redefinida por aqui). */
function alvoCoberto(alvos: readonly string[], perfisDoAlvo: readonly RefPerfil[]): boolean {
  if (perfisDoAlvo.length === 0) return false;
  return perfisDoAlvo.every((p) => p.base !== 'admin' && (alvos.includes(ALVO_TODOS) || alvos.includes(p.codigo)));
}

/**
 * O usuário com estes perfis pode `chave`? Sem perfis = não (falha fechada). Com `alvo`: chave `nuncaNoProprio` recusa o próprio;
 * chave com alvos exige que eles cubram todos os perfis do alvo. Sem `alvo`, chave com alvos = "pode para alguém" (mostrar o
 * botão). A licença do módulo dono NÃO é conferida aqui: na rota, `acao` + `verificarAcao` conferem as duas coisas.
 */
export function pode(perfis: readonly PerfilDaRequisicao[] | null | undefined, chave: string, alvo?: AlvoPermissao): boolean {
  if (!perfis || perfis.length === 0) return false;
  const v = combinarPerfis(perfis)[chave];
  if (!v) return false;
  if (!alvo) return true;
  if (alvo.proprio && ehChavePlataforma(chave) && (CHAVES_PLATAFORMA[chave] as Partial<DefinicaoChave>).nuncaNoProprio) return false;
  if (v.alvos) return alvoCoberto(v.alvos, alvo.perfis);
  return true;
}

/** Nível concedido (o mais alto entre os perfis) ou `null` se a chave não está concedida. */
export function nivelPermitido(perfis: readonly PerfilDaRequisicao[] | null | undefined, chave: string): NivelPermissao | null {
  if (!perfis || perfis.length === 0) return null;
  return combinarPerfis(perfis)[chave]?.nivel ?? null;
}

/** Escopo de dados efetivo (RN-CORE-04): o maior entre os perfis; sem perfil ou sem a chave = `carteira` (o menor). */
export function escopoDosPerfis(perfis: readonly PerfilDaRequisicao[] | null | undefined): Escopo {
  const n = nivelPermitido(perfis, 'dados.escopo');
  return n === 'equipe' || n === 'equipes_abaixo' || n === 'tenant' ? n : 'carteira';
}

/** O usuário entra em `lugar` (Campo, Gestão, BKO, portal)? Já com RN-CORE-33 pela regra mais restritiva. */
export const podeEntrar = (perfis: readonly PerfilDaRequisicao[] | null | undefined, lugar: LugarDeAcesso): boolean => pode(perfis, CHAVE_ACESSO[lugar]);

/** Algum perfil do usuário tem esta base? (ex.: RN-PRO-01 na rota de pedido.) */
export const temPerfilDeBase = (perfis: readonly { base: Perfil }[] | null | undefined, base: Perfil): boolean => !!perfis?.some((p) => p.base === base);

/** Chaves concedidas, em ordem (para `GET /v1/me` e testes). */
export const chavesPermitidas = (perfis: readonly PerfilDaRequisicao[] | null | undefined): string[] =>
  perfis && perfis.length > 0 ? Object.keys(combinarPerfis(perfis)).sort() : [];

// ---------------------------------------------------------------- validação dos limites travados (escrita)

/**
 * Regra dos limites dos perfis de acesso que não têm RN própria (último admin, autogestão, alvo admin, perfil de fábrica, base
 * imutável) e do multiperfil (RN-CORE-35 no doc 03; ADR 0033).
 */
export const REGRA_LIMITES_PERFIL = 'RN-CORE-35';

export type CodigoViolacao =
  | 'CODIGO_INVALIDO'
  | 'CODIGO_REPETIDO'
  | 'CHAVE_DESCONHECIDA'
  | 'VALOR_INVALIDO'
  | 'TRAVA_DO_PERFIL'
  | 'ESCOPO_ACIMA_DA_BASE'
  | 'SENHA_ALVO_INVALIDO'
  | 'PERFIL_FABRICA_AUSENTE'
  | 'BASE_ALTERADA'
  | 'USUARIO_SEM_PERFIL'
  | 'PERFIL_INDISPONIVEL'
  | 'ULTIMO_ADMIN'
  | 'AUTOGESTAO';

export interface ViolacaoLimite {
  codigo: CodigoViolacao;
  /** RN que explica (a API responde 422 com ela no `codigo`). */
  regra: string;
  mensagem: string;
  perfil?: string;
  chave?: string;
  usuario_id?: string;
}

/** Usuário do tenant visto pela validação (sem dado pessoal). */
export interface UsuarioDoAcesso {
  id: string;
  ativo: boolean;
  /** Códigos dos perfis (RN-CORE-01: um ou mais). */
  perfis: readonly string[];
}

export interface EstadoAcessoTenant {
  perfis: readonly PerfilDeAcesso[];
  usuarios: readonly UsuarioDoAcesso[];
}

const violacao = (codigo: CodigoViolacao, regra: string, mensagem: string, extra: Omit<ViolacaoLimite, 'codigo' | 'regra' | 'mensagem'> = {}): ViolacaoLimite => ({
  codigo,
  regra,
  mensagem,
  ...extra,
});

/**
 * Sobreposições de um perfil que a página não pode gravar: chave fora do catálogo, valor fora do formato da chave, limite travado
 * (RN-CORE-33, RN-PRO-01), escopo acima da base (RN-CORE-04) e alvo de senha que não existe ou é de base admin.
 * `perfisDoTenant` (código → base) confere os alvos; `catalogo` confere as chaves (ausente = só o formato das da plataforma).
 */
export function validarPerfil(perfil: PerfilDeAcesso, perfisDoTenant: ReadonlyMap<string, Perfil>, catalogo?: readonly DefinicaoChave[]): ViolacaoLimite[] {
  const erros: ViolacaoLimite[] = [];
  const P = { perfil: perfil.codigo };
  if (!CODIGO_PERFIL_RE.test(perfil.codigo) || (perfil.fabrica && perfil.codigo !== perfil.base)) {
    erros.push(violacao('CODIGO_INVALIDO', REGRA_LIMITES_PERFIL, 'Código de perfil inválido.', P));
  }
  const defs = new Map<string, Partial<DefinicaoChave>>(Object.entries(CHAVES_PLATAFORMA));
  for (const d of catalogo ?? []) defs.set(d.chave, d);
  for (const s of perfil.sobreposicoes) {
    const C = { ...P, chave: s.chave };
    const def = defs.get(s.chave);
    if (!def && catalogo) {
      erros.push(violacao('CHAVE_DESCONHECIDA', REGRA_LIMITES_PERFIL, `Permissão desconhecida: ${s.chave}.`, C));
      continue;
    }
    if (!s.concedida) continue;
    const trava = travaDaChave(perfil.base, s.chave);
    if (trava) {
      erros.push(violacao('TRAVA_DO_PERFIL', trava.regra, trava.mensagem, C));
      continue;
    }
    if (s.nivel != null) {
      const pos = posicaoDoNivel(s.nivel);
      if (!def?.nivel || !pos || pos.familia !== def.nivel) erros.push(violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Nível inválido em ${s.chave}.`, C));
      else if (s.chave === 'dados.escopo' && pos.i > NIVEIS_ESCOPO.indexOf(escopoMaximoDaBase(perfil.base))) {
        erros.push(violacao('ESCOPO_ACIMA_DA_BASE', 'RN-CORE-04', `O escopo de dados não pode passar o do perfil base ${ROTULO_BASE[perfil.base]}.`, C));
      }
    }
    if (s.alvos != null) {
      if (!def?.alvos) {
        erros.push(violacao('VALOR_INVALIDO', REGRA_LIMITES_PERFIL, `Perfis-alvo não se aplicam a ${s.chave}.`, C));
        continue;
      }
      for (const a of s.alvos) {
        if (a === ALVO_TODOS) continue;
        const base = perfisDoTenant.get(a);
        if (!base) erros.push(violacao('SENHA_ALVO_INVALIDO', REGRA_LIMITES_PERFIL, `Perfil-alvo inexistente: ${a}.`, C));
        else if (base === 'admin') erros.push(violacao('SENHA_ALVO_INVALIDO', REGRA_LIMITES_PERFIL, 'A senha de um perfil de admin não é redefinida por aqui.', C));
      }
    }
  }
  return erros;
}

/** Usuário ativo com perfil de base admin, que entra no BKO e tem toda a gestão do acesso (último admin; doc 03 §2). */
function ehAdminComGestao(u: UsuarioDoAcesso, porCodigo: ReadonlyMap<string, PerfilDeAcesso>, matriz: MatrizFabrica): boolean {
  if (!u.ativo) return false;
  const perfis = u.perfis.map((c) => porCodigo.get(c)).filter((p): p is PerfilDeAcesso => !!p && p.ativo);
  if (!perfis.some((p) => p.base === 'admin')) return false;
  const resolvidos = perfis.map((p) => resolverPerfil(p, matriz));
  return pode(resolvidos, CHAVE_ACESSO.bko) && CHAVES_GESTAO_DO_ACESSO.every((c) => pode(resolvidos, c));
}

export interface EntradaValidacaoAcesso {
  /** Estado gravado antes da alteração (ausente = criação do zero, ex.: semeadura). */
  antes?: EstadoAcessoTenant;
  depois: EstadoAcessoTenant;
  /** Quem altera (usuário do tenant). Ausente = sistema (migração, provisionamento): sem a regra da autogestão. */
  atorId?: string;
  matriz: MatrizFabrica;
  catalogo?: readonly DefinicaoChave[];
}

/**
 * Limites travados do tenant inteiro, para TODA escrita em perfis, sobreposições ou perfis de usuário (domain do Core e API):
 * cada perfil (`validarPerfil`); códigos únicos; os 7 perfis de fábrica presentes e ativos; base imutável; todo usuário com ao
 * menos um perfil ativo (RN-CORE-01); ao menos um admin ativo com a gestão do acesso; o ator que a tinha não a perde.
 * Lista vazia = pode gravar.
 */
export function validarAcessoDoTenant(e: EntradaValidacaoAcesso): ViolacaoLimite[] {
  const erros: ViolacaoLimite[] = [];
  const porCodigo = new Map<string, PerfilDeAcesso>();
  for (const p of e.depois.perfis) {
    if (porCodigo.has(p.codigo)) erros.push(violacao('CODIGO_REPETIDO', REGRA_LIMITES_PERFIL, `Já existe um perfil com o código ${p.codigo}.`, { perfil: p.codigo }));
    porCodigo.set(p.codigo, p);
  }
  const bases = new Map([...porCodigo].map(([c, p]) => [c, p.base] as const));
  for (const p of e.depois.perfis) erros.push(...validarPerfil(p, bases, e.catalogo));
  for (const base of PERFIS) {
    const f = porCodigo.get(base);
    if (!f || !f.fabrica || f.base !== base || !f.ativo) {
      erros.push(violacao('PERFIL_FABRICA_AUSENTE', REGRA_LIMITES_PERFIL, `O perfil de fábrica ${ROTULO_BASE[base]} não pode ser apagado nem desativado.`, { perfil: base }));
    }
  }
  for (const a of e.antes?.perfis ?? []) {
    const d = porCodigo.get(a.codigo);
    if (d && d.base !== a.base) erros.push(violacao('BASE_ALTERADA', REGRA_LIMITES_PERFIL, 'O perfil base não muda depois de criado.', { perfil: a.codigo }));
  }
  for (const u of e.depois.usuarios) {
    if (u.perfis.length === 0) {
      erros.push(violacao('USUARIO_SEM_PERFIL', 'RN-CORE-01', 'Todo usuário precisa de pelo menos um perfil.', { usuario_id: u.id }));
      continue;
    }
    for (const c of u.perfis) {
      if (!porCodigo.get(c)?.ativo) erros.push(violacao('PERFIL_INDISPONIVEL', 'RN-CORE-01', 'Perfil inexistente ou desativado no usuário.', { usuario_id: u.id, perfil: c }));
    }
  }
  if (!e.depois.usuarios.some((u) => ehAdminComGestao(u, porCodigo, e.matriz))) {
    erros.push(violacao('ULTIMO_ADMIN', REGRA_LIMITES_PERFIL, 'A empresa ficaria sem nenhum admin ativo com a gestão de usuários e perfis.'));
  }
  if (e.atorId && e.antes) {
    const antesPorCodigo = new Map(e.antes.perfis.map((p) => [p.codigo, p] as const));
    const atorAntes = e.antes.usuarios.find((u) => u.id === e.atorId);
    const atorDepois = e.depois.usuarios.find((u) => u.id === e.atorId);
    if (atorAntes && ehAdminComGestao(atorAntes, antesPorCodigo, e.matriz) && !(atorDepois && ehAdminComGestao(atorDepois, porCodigo, e.matriz))) {
      erros.push(violacao('AUTOGESTAO', REGRA_LIMITES_PERFIL, 'Você não pode tirar de si mesmo a gestão de usuários e perfis. Peça a outro admin.', { usuario_id: e.atorId }));
    }
  }
  return erros;
}
