/**
 * Menu lateral do BKO (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M4): funções puras do shell.
 * - Todo grupo tem título; grupos e itens em ordem alfabética pt-BR, sem diferenciar acento e caixa.
 * - Auditoria (página da plataforma) fica em Sistema; o slot `menu.itens` do Core entra no grupo "Mais".
 * - Grupo sem item visível some (a licença e o perfil já filtraram a `navegacao`: RN-CORE-01/03, ADR 0004).
 * - Altura do menu aberto (título 30 px, item 32 px, 2 px entre grupos) decide entre "tudo aberto" e a sanfona (§M3).
 * Funciona com o `grupo` de hoje do SDK (`operacao|cadastros|analise|administracao`) e com os 9 grupos do §M2.
 */

export interface ItemMenuBko {
  href: string;
  label: string;
  testId: string;
}

export interface GrupoMenuBko {
  /** Chave estável do grupo (`grupo` do SDK, `mais` ou `sistema`). */
  id: string;
  titulo: string;
  itens: ItemMenuBko[];
}

/** Item de navegação do SDK (`ItemNavegacao`), só com o que o menu usa. */
export interface EntradaNavegacao {
  grupo: string;
  caminho: string;
  rotulo: string;
  testID: string;
}

/** Item do slot `menu.itens` do Core (`ItemMenu`). */
export interface EntradaMais {
  caminho: string;
  rotulo: string;
  testID: string;
}

/**
 * Rótulo de cada grupo do §M2. `administracao` é PROVISÓRIO: some quando o SDK trocar o tipo `grupo` pelos 9 grupos
 * (engenheiro-software, `packages/platform-sdk/src/shell.ts`) e os módulos migrarem as páginas.
 */
export const ROTULO_GRUPO: Readonly<Record<string, string>> = {
  acesso: 'Acesso',
  analise: 'Análise',
  cadastros: 'Cadastros',
  comercial: 'Comercial',
  comunicacao: 'Comunicação',
  conteudo_campo: 'Conteúdo de campo',
  operacao: 'Operação',
  produtos: 'Produtos',
  sistema: 'Sistema',
  administracao: 'Administração',
};

/** Páginas da própria plataforma (RN-AUD-01: trilha de auditoria, para todo perfil que entra no BKO). */
export const ITENS_PLATAFORMA: readonly ItemMenuBko[] = [{ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' }];

/** Medidas do menu (§M4), em px. */
export const ALTURA_TITULO = 30;
export const ALTURA_ITEM = 32;
export const ESPACO_ENTRE_GRUPOS = 2;

const compararPtBr = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

/** Grupos do menu, em ordem alfabética, cada um com os itens em ordem alfabética. */
export function montarGruposMenu(entrada: { navegacao: readonly EntradaNavegacao[]; mais?: readonly EntradaMais[]; plataforma: boolean }): GrupoMenuBko[] {
  const grupos = new Map<string, ItemMenuBko[]>();
  const incluir = (id: string, item: ItemMenuBko) => grupos.set(id, [...(grupos.get(id) ?? []), item]);
  for (const n of entrada.navegacao) incluir(n.grupo, { href: `/${n.caminho.replace(/^\/+/, '')}`, label: n.rotulo, testId: n.testID });
  for (const i of entrada.mais ?? []) incluir('mais', { href: `/${i.caminho.replace(/^\/+/, '')}`, label: i.rotulo, testId: i.testID });
  if (entrada.plataforma) for (const i of ITENS_PLATAFORMA) incluir('sistema', i);
  return [...grupos]
    .filter(([, itens]) => itens.length > 0)
    .map(([id, itens]) => ({ id, titulo: id === 'mais' ? 'Mais' : (ROTULO_GRUPO[id] ?? id), itens: [...itens].sort((a, b) => compararPtBr(a.label, b.label)) }))
    .sort((a, b) => compararPtBr(a.titulo, b.titulo));
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
