/**
 * "Ainda carregando" × "não há" do estoque no cartão do catálogo (T-0192, docs/design/catalogo-grade.md §7.2). Puro. O critério é do aparelho
 * inteiro: só há "carregando" com a carga em andamento (`sync.pendentes`) e o catálogo lido do aparelho (`modoCarga === 'local'`).
 * Em modo `api` o estoque vem da API, já real; em `sem_sinal` não há cartão.
 */
import { VALOR_SEM_DADO } from '@macuxi/ui/mobile/puro';
import type { ModoDaCarga } from './carga-online';

const CHAVE_DE_ESTOQUE = 'estoque_saldo';

/** Textos do chip de estoque carregando (§7.3): o traço no lugar do número; a frase do leitor de tela. */
export const TEXTO_ESTOQUE_CARREGANDO = `Estoque: ${VALOR_SEM_DADO}`;
export const LEITURA_ESTOQUE_CARREGANDO = 'Estoque carregando';

export function cargaDoEstoque(sync: object, modoCarga: ModoDaCarga): boolean {
  if (modoCarga !== 'local') return false;
  const pendentes = (sync as { pendentes?: readonly string[] }).pendentes ?? [];
  return pendentes.includes(CHAVE_DE_ESTOQUE);
}

/** RN-CAT-05: o perfil que não vê preço e estoque (`price_stock_visible` falso) não ganha chip nem leitura de "carregando". */
export function estoqueCarregandoVisivel(estoqueCarregando: boolean, priceStockVisible: boolean): boolean {
  return estoqueCarregando && priceStockVisible;
}
