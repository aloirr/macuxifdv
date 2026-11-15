/**
 * Menu lateral do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M4; ADR 0058, spec
 * docs/design/menu-parametros/spec.md §2–§3): funções puras do shell.
 * - Todo grupo tem título; grupos pelo `compararGrupoMenu` do SDK (alfabético, Parâmetros e Sistema fixos no fim, D1) e
 *   itens em ordem alfabética pt-BR (`compararRotuloMenu`).
 * - O grupo e o título vêm do SDK (`grupoMenu`/`rotuloGrupo`, ADR 0050); só o grupo "Mais" (slot `menu.itens` do Core)
 *   é do shell. Auditoria (página da plataforma) fica em Sistema; "Parâmetros" (página da plataforma, `/parametros`) entra
 *   quando a visão tem alguma seção de Parâmetros.
 * - D9: grupo com um item só vira item direto de 1º nível (rótulo do grupo, `href` do item), sem sanfona.
 * - Vitrine sem licença (ADR 0058): grupo com todos os itens `bloqueado` aparece desativado (cadeado, não abre nem navega).
 * - Grupo sem item visível não aparece (a licença e o perfil já filtraram a `navegacao`: RN-CORE-01/03, ADR 0004).
 * - Altura do menu aberto (título 30 px, item 32 px, 2 px entre grupos) decide entre "tudo aberto" e a sanfona (§M3);
 *   item direto e entrada bloqueada ocupam só a linha do título.
 */
import { compararGrupoMenu, compararRotuloMenu, ROTULO_GRUPO_MENU, type ItemNavegacao } from '@macuxi/platform-sdk';

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
  /** ADR 0058: módulo de vitrine que a empresa não contratou (cadeado, "Contrate o módulo para usar"); não navega. */
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

/** Página Parâmetros (ADR 0058, D3/D10): item direto, logo acima de Sistema. */
export const ITEM_PARAMETROS: ItemMenuBko = { href: '/parametros', label: ROTULO_GRUPO_MENU.parametros, testId: 'nav-plataforma-parametros' };

/** Texto do balão e da seção bloqueada (spec §3). */
export const TEXTO_SEM_LICENCA = 'Contrate o módulo para usar';

/** Medidas do menu (§M4), em px. */
export const ALTURA_TITULO = 30;
export const ALTURA_ITEM = 32;
export const ESPACO_ENTRE_GRUPOS = 2;
/**
 * Balão "Contrate o módulo para usar" (spec §3): ocupa a linha logo abaixo da entrada bloqueada, dentro do menu (6 px da
 * seta + 32 px do balão), para nunca cobrir o conteúdo. Um balão por vez: a lista reserva uma linha dele quando há
 * entrada bloqueada, e abrir o balão não muda o modo (aberto ou sanfona) nem cria rolagem.
 */
export const ALTURA_DICA = 38;

/** Caminho do slot "Mais" (escrito pelo módulo, com ou sem barra inicial) → href. */
const href = (caminho: string) => `/${caminho.replace(/^\/+/, '')}`;

/** Grupos do menu (ordem do `compararGrupoMenu`), cada um com os itens em ordem alfabética. */
export function montarGruposMenu(entrada: {
  navegacao: readonly EntradaNavegacao[];
  mais?: readonly EntradaMais[];
  plataforma: boolean;
  /** A visão tem ao menos uma seção de Parâmetros (`visao.parametros`). */
  parametros?: boolean;
}): GrupoMenuBko[] {
  const grupos = new Map<string, { id: string; titulo: string; itens: (ItemMenuBko & { bloqueado: boolean })[] }>();
  const incluir = (id: string, titulo: string, item: ItemMenuBko, bloqueado = false) => {
    const g = grupos.get(id) ?? { id, titulo, itens: [] };
    g.itens.push({ ...item, bloqueado });
    grupos.set(id, g);
  };
  for (const n of entrada.navegacao) incluir(n.grupoMenu, n.rotuloGrupo, { href: `/${n.caminho}`, label: n.rotulo, testId: n.testID }, n.bloqueado === true);
  for (const i of entrada.mais ?? []) incluir('mais', 'Mais', { href: href(i.caminho), label: i.rotulo, testId: i.testID });
  if (entrada.plataforma) for (const i of ITENS_PLATAFORMA) incluir('sistema', ROTULO_GRUPO_MENU.sistema, i);
  if (entrada.parametros) incluir('parametros', ROTULO_GRUPO_MENU.parametros, ITEM_PARAMETROS);
  return [...grupos.values()]
    .flatMap((g): GrupoMenuBko[] => {
      const bloqueado = g.itens.every((i) => i.bloqueado);
      // grupo misto: o item bloqueado não aparece (a vitrine é por grupo inteiro, spec §3)
      const itens = (bloqueado ? g.itens : g.itens.filter((i) => !i.bloqueado))
        .map(({ href: h, label, testId }) => ({ href: h, label, testId }))
        .sort((a, b) => compararRotuloMenu(a.label, b.label));
      const direto = itens.length === 1;
      return [{ id: g.id, titulo: g.titulo, itens, direto, bloqueado, testId: (direto ? itens[0]?.testId : undefined) ?? `nav-grupo-${g.id}` }];
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
export const soTitulo = (g: GrupoMenuBko) => g.direto || g.bloqueado;

/**
 * Altura da lista do menu (px): toda entrada mostra o título; os grupos em `abertos` mostram também os itens. Item direto e
 * entrada bloqueada nunca abrem. `abertos = 'todos'` mede o menu inteiro aberto. Com entrada bloqueada, soma a linha do
 * balão (`ALTURA_DICA`).
 */
export function alturaDoMenu(grupos: readonly GrupoMenuBko[], abertos: 'todos' | ReadonlySet<string>): number {
  if (grupos.length === 0) return 0;
  const itens = grupos.reduce((soma, g) => soma + (!soTitulo(g) && (abertos === 'todos' || abertos.has(g.id)) ? g.itens.length : 0), 0);
  const dica = grupos.some((g) => g.bloqueado) ? ALTURA_DICA : 0;
  return grupos.length * ALTURA_TITULO + itens * ALTURA_ITEM + (grupos.length - 1) * ESPACO_ENTRE_GRUPOS + dica;
}

/** Tudo aberto cabe na altura disponível (entre a marca e o rodapé)? Senão, sanfona (§M3). */
export function cabeTudoAberto(grupos: readonly GrupoMenuBko[], alturaDisponivel: number): boolean {
  return alturaDoMenu(grupos, 'todos') <= alturaDisponivel;
}
