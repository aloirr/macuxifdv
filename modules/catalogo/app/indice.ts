/**
 * Índice de busca textual do Catálogo no aparelho (FTS5; desenho T-0008 §2.2–2.6; docs/banco/aparelho-sqlite.md §4).
 * Tabelas e colunas são da migração v1 de `db/aparelho.ts` (dono: banco-dados): colunas na MESMA ordem de
 * `COLUNAS_BUSCA_CATALOGO` (o SDK confere com `pragma_table_info`). Fontes: `produto` (Core, módulo em `depende`) e
 * `produto_atributo` (Catálogo); os atributos são lidos pelo índice `catalogo__produto_atributo_produto`.
 * O índice só pré-seleciona candidatos em catálogos grandes; o ranking é sempre o do domain (`app/lib/local.ts`).
 */
import { definirIndiceBusca, type LinhaSync } from '@macuxi/platform-sdk';
import type { ProdutoSync } from '@macuxi/core/contracts';
import type { ProdutoAtributoSync, ProdutoConteudoSync, ProdutoReferenciaSync } from '../contracts';
import { expandirAplicacao, FAIXA_MAXIMA_ANOS } from '../domain/aplicacao';
import { codigosCompactosDoProduto, marcasDasReferencias, textoDescricaoParaBusca } from '../domain/ranking';
import { COLUNAS_BUSCA_CATALOGO, TABELAS_BUSCA_CATALOGO } from '../db/aparelho';
import { ID_INDICE_BUSCA } from './lib/local';

type Coluna = (typeof COLUNAS_BUSCA_CATALOGO)[number];

/** Pesos do `bm25` (confirmados com o banco-dados, R-20261031-205433): código pesa mais, atributo menos. */
export const PESOS_BUSCA_CATALOGO: Readonly<Record<Coluna, number>> = { sku: 10, ean: 10, codigos: 8, nome: 5, marca: 3, categoria: 2, atributos: 1, aplicacao: 2, referencias: 8 };

/**
 * Texto da coluna `aplicacao` do índice (RN-CAT-12; T-0096): igual ao do domain, mas cada faixa aberta ("2018 em
 * diante", "2018>", "a partir de 2018") vai do ano de início até o TETO que o domain jamais passa (início +
 * `FAIXA_MAXIMA_ANOS`), em vez de parar no ano atual + 1. Assim o documento não depende do relógio: na virada do ano
 * "civic 2028" segue achando "2018 em diante" sem reindexar. O índice só pré-seleciona candidatos; o corte no ano
 * atual + 1 (fuso do tenant) é do ranking do domain, que recalcula a faixa na hora da consulta (`app/lib/local.ts`).
 *
 * Custo: 1 chamada do domain sem faixa aberta (ano 0) + 1 por janela de 41 anos com ano no texto (na prática 1 ou 2).
 * Numa janela [A-39, A+1] toda faixa aberta é válida com `anoAtual = A`; a que não aparece na chamada sem faixa aberta
 * é aberta, e o seu início vem em `de`.
 */
export function textoIndiceAplicacao(texto: string | null | undefined): string {
  const t = texto ?? '';
  const base = expandirAplicacao(t, { anoAtual: 0 }); // limite 1: nenhuma faixa aberta vale, só as fechadas
  if (base.anos.length === 0) return base.textoIndice;
  const gerados = base.textoIndice === t ? [] : base.textoIndice.slice(t.length + 1).split(' ').map(Number);
  const literais = new Set(base.anos);
  for (const g of gerados) literais.delete(g);
  const fechadas = new Set(base.faixas.map((f) => `${f.inicio}:${f.fim}`));
  const todos = new Set(base.anos);
  const janelas = new Set(base.anos.map((a) => Math.floor((a - PRIMEIRO_ANO) / JANELA)));
  for (const w of janelas) {
    const anoAtual = PRIMEIRO_ANO + w * JANELA + FAIXA_MAXIMA_ANOS - 1;
    for (const f of expandirAplicacao(t, { anoAtual }).faixas) {
      if (fechadas.has(`${f.inicio}:${f.fim}`)) continue;
      for (let a = f.de; a <= f.de + FAIXA_MAXIMA_ANOS; a++) todos.add(a);
    }
  }
  const novos = [...todos].filter((a) => !literais.has(a)).sort((x, y) => x - y);
  return novos.length === 0 ? t : `${t} ${novos.join(' ')}`;
}

/** Janela de anos de início em que uma chamada só do domain valida toda faixa aberta (`anoAtual - 39 ..= anoAtual + 1`). */
const JANELA = FAIXA_MAXIMA_ANOS + 1;
/** Começo das janelas: um antes do menor ano que o domain reconhece (1900). */
const PRIMEIRO_ANO = 1899;

/**
 * Formato do documento (`v5` = marca das referências na coluna `marca` e descrição longa em `atributos`, RN-CAT-08/09; `v4` = faixa
 * aberta até o teto, T-0096). Sem o ano: a virada do ano não reindexa nada; a troca de versão reindexa uma vez no app atualizado.
 */
export const versaoDocumentosCatalogo = () => 'v5';

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
  versaoDocumentos: versaoDocumentosCatalogo,
  async documento(id, ler) {
    const [p] = await ler.porIds<ProdutoSync & LinhaSync>('produto', [id]);
    // removido ou inativo sai do índice (RN-CAT-01: produto inativo não aparece)
    if (!p || p.deleted_at || !p.ativo) return null;
    const attrs = (await ler.porCampo<ProdutoAtributoSync & LinhaSync>('produto_atributo', 'produto_id', id)).filter((a) => !a.deleted_at);
    const [conteudo] = (await ler.porCampo<ProdutoConteudoSync & LinhaSync>('produto_conteudo', 'produto_id', id)).filter((c) => !c.deleted_at);
    const refs = (await ler.porCampo<ProdutoReferenciaSync & LinhaSync>('produto_referencia', 'produto_id', id)).filter((x) => !x.deleted_at).sort((a, b) => a.ordem - b.ordem);
    const codigos = codigosCompactosDoProduto(p.sku, p.external_id, refs.map((x) => x.codigo)).join(' ');
    return {
      sku: p.sku,
      ean: p.ean,
      codigos,
      nome: p.nome,
      marca: `${p.marca} ${marcasDasReferencias(refs)}`.trim(),
      categoria: p.categoria,
      atributos: attrs
        .map((a) => `${a.nome} ${a.valor}`)
        .sort()
        .concat(textoDescricaoParaBusca(conteudo?.descricao) || [])
        .join(' '),
      aplicacao: textoIndiceAplicacao(conteudo?.aplicacao),
      referencias: refs.map((x) => x.codigo).join(' '),
    };
  },
});
