/**
 * Menu lateral do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M4; ADR 0060, spec
 * docs/design/menu-parametros/spec.md §2–§3): funções puras do shell.
 * - Todo grupo tem título; grupos pelo `compararGrupoMenu` do SDK (alfabético, Parâmetros e Sistema fixos no fim, D1) e
 *   itens em ordem alfabética pt-BR (`compararRotuloMenu`).
 * - O grupo e o título vêm do SDK (`grupoMenu`/`rotuloGrupo`, ADR 0050); só o grupo "Mais" (slot `menu.itens` do Core)
 *   é do shell. Auditoria (página da plataforma) fica em Sistema; "Parâmetros" (página da plataforma, `/parametros`) entra
 *   quando a página Parâmetros tem alguma seção. Página de módulo no grupo 'parametros' em `parametros/<secao>` não vira item: é seção da página.
 * - D9: grupo com um item só vira item direto de 1º nível (rótulo do grupo, `href` do item), sem sanfona.
 * - Vitrine sem licença (ADR 0060): grupo com todos os itens `bloqueado` aparece desativado (cadeado, não abre nem navega).
 * - Grupo sem item visível não aparece (a licença e o perfil já filtraram a `navegacao`: RN-CORE-01/03, ADR 0004).
 * - Altura do menu aberto (título 30 px, item 32 px, 2 px entre grupos) decide entre "tudo aberto" e a sanfona (§M3);
 *   item direto e entrada bloqueada ocupam só a linha do título. A conta supõe um item por linha; o shell confere a altura real.
 * - Densidade compacta (v1.0.18, notebook 1366×768 com ~650 px úteis): só na sanfona, quando o pior grupo aberto na densidade
 *   normal não cabe (`piorSanfona > disponivel`); título 24 px e item 28 px numa linha só (rótulo com reticências).
 */
import { compararGrupoMenu, compararRotuloMenu, ROTULO_GRUPO_MENU, type ItemNavegacao } from '@macuxi/platform-sdk';
import { secaoDaPagina } from './parametros';

export interface ItemMenuBko {
  href: string;
  label: string;
  testId: string;
}

export interface GrupoMenuBko {
  /** Chave estável do grupo (`grupoMenu` do SDK ou `mais`). */
  id: string;
  titulo: string;
  itens: ItemMenuBko[];
  /** D9: um item só; aparece como item direto (rótulo do grupo, `href` do item). */
  direto: boolean;
  /** ADR 0060: módulo de vitrine que a empresa não contratou (cadeado, "Contrate o módulo para usar"); não navega. */
  bloqueado: boolean;
  /** data-testid da linha de 1º nível: o do item no item direto; `nav-grupo-<id>` no grupo. */
  testId: string;
}

/** Item de navegação do SDK (`ItemNavegacao`), só com o que o menu usa. */
export type EntradaNavegacao = Pick<ItemNavegacao<unknown>, 'grupoMenu' | 'rotuloGrupo' | 'caminho' | 'rotulo' | 'testID' | 'bloqueado'>;

/** Item do slot `menu.itens` do Core (`ItemMenu`). */
export interface EntradaMais {
  caminho: string;
  rotulo: string;
  testID: string;
}

/** Páginas da própria plataforma (RN-AUD-01: trilha de auditoria, para todo perfil que entra no BKO). */
export const ITENS_PLATAFORMA: readonly ItemMenuBko[] = [{ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' }];

/** Página Parâmetros (ADR 0060, D3/D10): item direto, logo acima de Sistema. */
const ITEM_PARAMETROS: ItemMenuBko = { href: '/parametros', label: ROTULO_GRUPO_MENU.parametros, testId: 'nav-plataforma-parametros' };

/** Texto do balão e da seção bloqueada (spec §3). */
export const TEXTO_SEM_LICENCA = 'Contrate o módulo para usar';

/** Medidas do menu (§M4), em px. */
export const ALTURA_TITULO = 30;
export const ALTURA_ITEM = 32;
export const ESPACO_ENTRE_GRUPOS = 2;
/** Densidade compacta (v1.0.18): título h-6 e item py-1 + leading-5. */
export const ALTURA_TITULO_COMPACTA = 24;
export const ALTURA_ITEM_COMPACTA = 28;

export type DensidadeMenu = 'normal' | 'compacta';
const MEDIDAS: Record<DensidadeMenu, { titulo: number; item: number }> = {
  normal: { titulo: ALTURA_TITULO, item: ALTURA_ITEM },
  compacta: { titulo: ALTURA_TITULO_COMPACTA, item: ALTURA_ITEM_COMPACTA },
};

/** Caminho do slot "Mais" (escrito pelo módulo, com ou sem barra inicial) → href. */
const href = (caminho: string) => `/${caminho.replace(/^\/+/, '')}`;

/** Grupos do menu (ordem do `compararGrupoMenu`), cada um com os itens em ordem alfabética. */
export function montarGruposMenu(entrada: {
  navegacao: readonly EntradaNavegacao[];
  mais?: readonly EntradaMais[];
  plataforma: boolean;
  /** A página Parâmetros tem ao menos uma seção (`secoesParametros`). */
  parametros?: boolean;
}): GrupoMenuBko[] {
  const grupos = new Map<string, { id: string; titulo: string; itens: (ItemMenuBko & { bloqueado: boolean })[] }>();
  const incluir = (id: string, titulo: string, item: ItemMenuBko, bloqueado = false) => {
    const g = grupos.get(id) ?? { id, titulo, itens: [] };
    g.itens.push({ ...item, bloqueado });
    grupos.set(id, g);
  };
  for (const n of entrada.navegacao) {
    // página de módulo no grupo Parâmetros (ex.: o de-para em `parametros/integracao`): é seção da página Parâmetros
    if (secaoDaPagina(n)) continue;
    incluir(n.grupoMenu, n.rotuloGrupo, { href: `/${n.caminho}`, label: n.rotulo, testId: n.testID }, n.bloqueado === true);
  }
  for (const i of entrada.mais ?? []) incluir('mais', 'Mais', { href: href(i.caminho), label: i.rotulo, testId: i.testID });
  if (entrada.parametros) incluir('parametros', ROTULO_GRUPO_MENU.parametros, ITEM_PARAMETROS);
  if (entrada.plataforma) for (const i of ITENS_PLATAFORMA) incluir('sistema', ROTULO_GRUPO_MENU.sistema, i);
  return [...grupos.values()]
    .map((g): GrupoMenuBko => {
      const bloqueado = g.itens.every((i) => i.bloqueado);
      // grupo misto: o item bloqueado não aparece (a vitrine é por grupo inteiro, spec §3)
      const itens = (bloqueado ? g.itens : g.itens.filter((i) => !i.bloqueado))
        .map(({ href: h, label, testId }) => ({ href: h, label, testId }))
        .sort((a, b) => compararRotuloMenu(a.label, b.label));
      const direto = itens.length === 1;
      return { id: g.id, titulo: g.titulo, itens, direto, bloqueado, testId: (direto ? itens[0]?.testId : undefined) ?? `nav-grupo-${g.id}` };
    })
    .sort(compararGrupoMenu);
}

/** Hrefs que a tela atual pode acender (sem as entradas bloqueadas). */
export function hrefsNavegaveis(grupos: readonly GrupoMenuBko[]): string[] {
  return grupos.filter((g) => !g.bloqueado).flatMap((g) => g.itens.map((i) => i.href));
}

/** Item da tela atual: a rota mais longa que casa com o endereço (`/catalogo/marcas` não acende `/catalogo`). */
export function hrefAtivo(pathname: string, hrefs: readonly string[]): string | null {
  let melhor: string | null = null;
  for (const h of hrefs) {
    const casa = pathname === h || pathname.startsWith(`${h}/`);
    if (casa && (melhor === null || h.length > melhor.length)) melhor = h;
  }
  return melhor;
}

/** Grupo que contém a tela atual (ou null). */
export function grupoDaTela(grupos: readonly GrupoMenuBko[], href: string | null): string | null {
  if (href === null) return null;
  return grupos.find((g) => !g.bloqueado && g.itens.some((i) => i.href === href))?.id ?? null;
}

/** A linha de 1º nível só tem o título (item direto ou entrada bloqueada): não abre. */
const soTitulo = (g: GrupoMenuBko) => g.direto || g.bloqueado;

/**
 * Altura da lista do menu (px): toda entrada mostra o título; os grupos em `abertos` mostram também os itens. Item direto e
 * entrada bloqueada nunca abrem. `abertos = 'todos'` mede o menu inteiro aberto. O balão da entrada bloqueada fica fora
 * da lista (fixo à direita do menu) e não conta.
 */
export function alturaDoMenu(grupos: readonly GrupoMenuBko[], abertos: 'todos' | ReadonlySet<string>, densidade: DensidadeMenu = 'normal'): number {
  if (grupos.length === 0) return 0;
  const { titulo, item } = MEDIDAS[densidade];
  const itens = grupos.reduce((soma, g) => soma + (!soTitulo(g) && (abertos === 'todos' || abertos.has(g.id)) ? g.itens.length : 0), 0);
  return grupos.length * titulo + itens * item + (grupos.length - 1) * ESPACO_ENTRE_GRUPOS;
}

/** Tudo aberto cabe na altura disponível (entre a marca e o rodapé)? Senão, sanfona (§M3). Sempre na densidade normal. */
export function cabeTudoAberto(grupos: readonly GrupoMenuBko[], alturaDisponivel: number): boolean {
  return alturaDoMenu(grupos, 'todos') <= alturaDisponivel;
}

/** Altura da sanfona com o maior grupo aberto: títulos + itens do maior grupo + espaços entre grupos. */
export function piorSanfona(grupos: readonly GrupoMenuBko[], densidade: DensidadeMenu = 'normal'): number {
  const maior = grupos.reduce<GrupoMenuBko | null>((m, g) => (!soTitulo(g) && g.itens.length > (m?.itens.length ?? 0) ? g : m), null);
  return alturaDoMenu(grupos, new Set(maior ? [maior.id] : []), densidade);
}

/** Densidade da sanfona (regra no cabeçalho). */
export function densidadeDoMenu(grupos: readonly GrupoMenuBko[], alturaDisponivel: number): DensidadeMenu {
  return piorSanfona(grupos) > alturaDisponivel ? 'compacta' : 'normal';
}

/**
 * Destino do endereço antigo que virou painel de Parâmetros, com a query atual preservada antes da âncora
 * (`/usuarios-e-modulos?modulos_perfil=promotor` → `/parametros/acesso?modulos_perfil=promotor#core-usuarios-e-modulos`; ADR 0060).
 */
export function destinoComBusca(destino: string, busca: string): string {
  const q = busca.startsWith('?') ? busca.slice(1) : busca;
  if (!q) return destino;
  const i = destino.indexOf('#');
  const base = i < 0 ? destino : destino.slice(0, i);
  const ancora = i < 0 ? '' : destino.slice(i);
  return `${base}${base.includes('?') ? '&' : '?'}${q}${ancora}`;
}
