/**
 * Mapa único dos módulos, parte de texto (R-20261114-143500, revisão do BKO §P10; achado N-1 do v1017 do Campo): id → nome →
 * frase de valor. Puro, sem React: o BKO (`@macuxi/ui/web`, que junta o ícone e o cartão) e os apps (`@macuxi/ui/mobile` e
 * `@macuxi/ui/mobile/puro`) leem o MESMO nome. Nenhuma tela mostra o id ("vendedor", "integracao").
 *
 * Core e Integração entram em toda empresa. O Catálogo é nativo (sem frase de valor), mas no portal é opcional.
 */

/** Os ids dos módulos, os mesmos do `MODULOS` do platform-sdk (o kit não depende do SDK). */
export const IDS_DOS_MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
export type IdDoModulo = (typeof IDS_DOS_MODULOS)[number];

export const MODULOS_NATIVOS: readonly IdDoModulo[] = ['catalogo', 'core', 'integracao'];

export interface TextoDoModulo {
  nome: string;
  /** Frase de valor do cartão: o que a equipe ganha, em uma linha. Os nativos não têm (não aparecem em lista). */
  valor?: string;
}

export const TEXTOS_DOS_MODULOS: Readonly<Record<IdDoModulo, TextoDoModulo>> = {
  catalogo: { nome: 'Catálogo' },
  core: { nome: 'Core' },
  gestor: { nome: 'Gestor', valor: 'Equipe, aprovações e indicadores.' },
  integracao: { nome: 'Integração com o ERP' },
  pesquisa: { nome: 'Pesquisa', valor: 'Questionários na visita, com fotos e resultados.' },
  promotor: { nome: 'Promotor', valor: 'Gôndola, share, preço, ruptura e validade no PDV.' },
  treinamento: { nome: 'Treinamento', valor: 'Trilhas, quizzes e ranking para a equipe de campo.' },
  vendedor: { nome: 'Vendedor', valor: 'Pedidos e orçamentos no app.' },
};

/** O id é de um módulo conhecido pelo kit. */
export const ehIdDoModulo = (id: string): id is IdDoModulo => (IDS_DOS_MODULOS as readonly string[]).includes(id);

/** Nome do módulo para a tela (nunca o id). Id desconhecido (servidor mais novo) aparece como veio. */
export function nomeDoModulo(id: string): string {
  return ehIdDoModulo(id) ? TEXTOS_DOS_MODULOS[id].nome : id;
}
