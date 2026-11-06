/**
 * Índice de busca textual do Catálogo no aparelho (FTS5; desenho T-0008 §2.2–2.6; docs/banco/aparelho-sqlite.md §4).
 * Tabelas e colunas são da migração v1 de `db/aparelho.ts` (dono: banco-dados): colunas na MESMA ordem de
 * `COLUNAS_BUSCA_CATALOGO` (o SDK confere com `pragma_table_info`). Fontes: `produto` (Core, módulo em `depende`) e
 * `produto_atributo` (Catálogo); os atributos são lidos pelo índice `catalogo__produto_atributo_produto`.
 * O índice só pré-seleciona candidatos em catálogos grandes; o ranking é sempre o do domain (`app/lib/local.ts`).
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { definirIndiceBusca, type LinhaSync } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type { ProdutoAtributoSync, ProdutoConteudoSync, ProdutoReferenciaSync } from '../contracts';
import { expandirAplicacao } from '../domain/aplicacao';
import { codigoCompacto } from '../domain/ranking';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { ID_INDICE_BUSCA } from './lib/local';

type Coluna = (typeof COLUNAS_BUSCA_CATALOGO)[number];

/** Pesos do `bm25` (confirmados com o banco-dados, R-20261031-205433): código pesa mais, atributo menos. */
export const PESOS_BUSCA_CATALOGO: Readonly<Record<Coluna, number>> = { sku: 10, ean: 10, codigos: 8, nome: 5, marca: 3, categoria: 2, atributos: 1, aplicacao: 2, referencias: 8 };

/** Ano civil do índice (a expansão de faixas abertas); a coluna guarda os anos calculados na hora de indexar (T-0084 §3.6). */
const anoDoIndice = () => Number(criarRelogio().iso().slice(0, 4));

export const INDICE_BUSCA_CATALOGO = definirIndiceBusca<Coluna>({
  id: ID_INDICE_BUSCA,
  modulo: 'catalogo',
  tabelaDoc: TABELAS_BUSCA_CATALOGO.doc,
  tabelaFts: TABELAS_BUSCA_CATALOGO.fts,
  colunaChave: TABELAS_BUSCA_CATALOGO.colunaChave,
  colunas: PESOS_BUSCA_CATALOGO,
  fontes: ['produto', 'produto_atributo', 'produto_conteudo', 'produto_referencia'],
  // produto_conteudo e produto_referencia apontam para o produto pelo produto_id (T-0084 §6, T-0085 §7)
  chaveDe: (entidade, linha) => (entidade === 'produto' ? linha.id : ((linha as Partial<ProdutoAtributoSync>).produto_id ?? null)),
  async documento(id, ler) {
    const [p] = await ler.porIds<ProdutoSync & LinhaSync>('produto', [id]);
    // removido ou inativo sai do índice (RN-CAT-01: produto inativo não aparece)
    if (!p || p.deleted_at || !p.ativo) return null;
    const attrs = (await ler.porCampo<ProdutoAtributoSync & LinhaSync>('produto_atributo', 'produto_id', id)).filter((a) => !a.deleted_at);
    const [conteudo] = (await ler.porCampo<ProdutoConteudoSync & LinhaSync>('produto_conteudo', 'produto_id', id)).filter((c) => !c.deleted_at);
    const refs = (await ler.porCampo<ProdutoReferenciaSync & LinhaSync>('produto_referencia', 'produto_id', id)).filter((x) => !x.deleted_at).sort((a, b) => a.ordem - b.ordem);
    const codigos = [...new Set([codigoCompacto(p.sku), codigoCompacto(p.external_id), ...refs.map((x) => codigoCompacto(x.codigo))].filter(Boolean))].join(' ');
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
      aplicacao: expandirAplicacao(conteudo?.aplicacao, { anoAtual: anoDoIndice() }).textoIndice,
      referencias: refs.map((x) => x.codigo).join(' '),
    };
  },
});
