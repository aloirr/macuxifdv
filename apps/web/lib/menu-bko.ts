/**
 * Menu lateral do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M4): funções puras do shell.
 * - Todo grupo tem título; grupos e itens em ordem alfabética pt-BR (`compararRotuloMenu` do SDK).
 * - O grupo e o título vêm do SDK (`grupoMenu`/`rotuloGrupo`, ADR 0050); só o grupo "Mais" (slot `menu.itens` do Core)
 *   é do shell. Auditoria (página da plataforma) fica em Sistema.
 * - Grupo sem item visível não aparece (a licença e o perfil já filtraram a `navegacao`: RN-CORE-01/03, ADR 0004).
 * - Altura do menu aberto (título 30 px, item 32 px, 2 px entre grupos) decide entre "tudo aberto" e a sanfona (§M3).
 */
import { compararRotuloMenu, ROTULO_GRUPO_MENU, type ItemNavegacao } from '@macuxi/platform-sdk';

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
}

/** Item de navegação do SDK (`ItemNavegacao`), só com o que o menu usa. */
export type EntradaNavegacao = Pick<ItemNavegacao<unknown>, 'grupoMenu' | 'rotuloGrupo' | 'caminho' | 'rotulo' | 'testID'>;

/** Item do slot `menu.itens` do Core (`ItemMenu`). */
export interface EntradaMais {
  caminho: string;
  rotulo: string;
  testID: string;
}

/** Páginas da própria plataforma (RN-AUD-01: trilha de auditoria, para todo perfil que entra no BKO). */
export const ITENS_PLATAFORMA: readonly ItemMenuBko[] = [{ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' }];

/** Medidas do menu (§M4), em px. */
export const ALTURA_TITULO = 30;
export const ALTURA_ITEM = 32;
export const ESPACO_ENTRE_GRUPOS = 2;

/** Caminho do slot "Mais" (escrito pelo módulo, com ou sem barra inicial) → href. */
const href = (caminho: string) => `/${caminho.replace(/^\/+/, '')}`;

/** Grupos do menu, em ordem alfabética, cada um com os itens em ordem alfabética. */
export function montarGruposMenu(entrada: { navegacao: readonly EntradaNavegacao[]; mais?: readonly EntradaMais[]; plataforma: boolean }): GrupoMenuBko[] {
  const grupos = new Map<string, GrupoMenuBko>();
  const incluir = (id: string, titulo: string, item: ItemMenuBko) => {
    const g = grupos.get(id) ?? { id, titulo, itens: [] };
    g.itens.push(item);
    grupos.set(id, g);
  };
  for (const n of entrada.navegacao) incluir(n.grupoMenu, n.rotuloGrupo, { href: `/${n.caminho}`, label: n.rotulo, testId: n.testID });
  for (const i of entrada.mais ?? []) incluir('mais', 'Mais', { href: href(i.caminho), label: i.rotulo, testId: i.testID });
  if (entrada.plataforma) for (const i of ITENS_PLATAFORMA) incluir('sistema', ROTULO_GRUPO_MENU.sistema, i);
  return [...grupos.values()]
    .map((g) => ({ ...g, itens: g.itens.sort((a, b) => compararRotuloMenu(a.label, b.label)) }))
    .sort((a, b) => compararRotuloMenu(a.titulo, b.titulo));
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
  return grupos.find((g) => g.itens.some((i) => i.href === href))?.id ?? null;
}

/**
 * Altura da lista do menu (px): todo grupo mostra o título; os grupos em `abertos` mostram também os itens.
 * `abertos = 'todos'` mede o menu inteiro aberto.
 */
export function alturaDoMenu(grupos: readonly GrupoMenuBko[], abertos: 'todos' | ReadonlySet<string>): number {
  if (grupos.length === 0) return 0;
  const itens = grupos.reduce((soma, g) => soma + (abertos === 'todos' || abertos.has(g.id) ? g.itens.length : 0), 0);
  return grupos.length * ALTURA_TITULO + itens * ALTURA_ITEM + (grupos.length - 1) * ESPACO_ENTRE_GRUPOS;
}

/** Tudo aberto cabe na altura disponível (entre a marca e o rodapé)? Senão, sanfona (§M3). */
export function cabeTudoAberto(grupos: readonly GrupoMenuBko[], alturaDisponivel: number): boolean {
  return alturaDoMenu(grupos, 'todos') <= alturaDisponivel;
}
