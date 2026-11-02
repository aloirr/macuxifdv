/**
 * Índice de busca textual do Catálogo no aparelho (FTS5; desenho T-0008 §2.2–2.6; docs/banco/aparelho-sqlite.md §4).
 * Tabelas e colunas são da migração v1 de `db/aparelho.ts` (dono: banco-dados): colunas na MESMA ordem de
 * `COLUNAS_BUSCA_CATALOGO` (o SDK confere com `pragma_table_info`). Fontes: `produto` (Core, módulo em `depende`) e
 * `produto_atributo` (Catálogo); os atributos são lidos pelo índice `catalogo__produto_atributo_produto`.
 * O índice só pré-seleciona candidatos em catálogos grandes; o ranking é sempre o do domain (`app/lib/local.ts`).
 */
import { definirIndiceBusca, normalizarBusca, type LinhaSync } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type { ProdutoAtributoSync } from '../contracts';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { ID_INDICE_BUSCA } from './lib/local';

type Coluna = (typeof COLUNAS_BUSCA_CATALOGO)[number];

/** Pesos do `bm25` (confirmados com o banco-dados, R-20261031-205433): código pesa mais, atributo menos. */
export const PESOS_BUSCA_CATALOGO: Readonly<Record<Coluna, number>> = { sku: 10, ean: 10, codigos: 8, nome: 5, marca: 3, categoria: 2, atributos: 1 };

/** Forma compacta `[a-z0-9]` de um código (`DET-5L` → `det5l`), para achar o SKU digitado sem hífen. */
export const compacto = (s: string | null | undefined): string => (s ? normalizarBusca(s).join('') : '');

export const INDICE_BUSCA_CATALOGO = definirIndiceBusca<Coluna>({
  id: ID_INDICE_BUSCA,
  modulo: 'catalogo',
  tabelaDoc: TABELAS_BUSCA_CATALOGO.doc,
  tabelaFts: TABELAS_BUSCA_CATALOGO.fts,
  colunaChave: TABELAS_BUSCA_CATALOGO.colunaChave,
  colunas: PESOS_BUSCA_CATALOGO,
  fontes: ['produto', 'produto_atributo'],
  chaveDe: (entidade, linha) => (entidade === 'produto' ? linha.id : ((linha as Partial<ProdutoAtributoSync>).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<ProdutoSync & LinhaSync>('produto', [id]);
    // removido ou inativo sai do índice (RN-CAT-01: produto inativo não aparece)
    if (!p || p.deleted_at || !p.ativo) return null;
    const attrs = (await ler.porCampo<ProdutoAtributoSync & LinhaSync>('produto_atributo', 'produto_id', id)).filter((a) => !a.deleted_at);
    const codigos = [...new Set([compacto(p.sku), compacto(p.external_id)].filter(Boolean))].join(' ');
    return {
      sku: p.sku,
      ean: p.ean,
      codigos,
      nome: p.nome,
      marca: p.marca,
      categoria: p.categoria,
      atributos: attrs
        .map((a) => `${a.nome} ${a.valor}`)
        .sort()
        .join(' '),
    };
  },
});
