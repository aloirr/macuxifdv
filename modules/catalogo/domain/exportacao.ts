/**
 * Exportação do catálogo (RF-CAT-09, T-0085 fatia C): monta os dados que o BKO transforma em PDF e Excel.
 * Função pura. Sistema › grupo › linha = níveis 1, 2 e 3 da árvore do produto (o vínculo de trilha mais funda);
 * referências saem como o cadastro as guarda (máx. 3, marca ativa, RN-CAT-09) e "oferece junto" com até 5 ids.
 */
import type { Referencia } from '../contracts';
import { nomeMarcaDaReferencia, type MapaMarcas } from './marcas';
import { montarArvore, trilhaDe, type NoCatalogo, type VinculoProdutoNo } from './arvore';
import type { ProdutoCatalogo } from './vitrine';

/** Teto de produtos numa resposta (página única, sem paginação): acima disso a resposta marca `truncado`. */
export const LIMITE_EXPORTACAO = 20_000;
export const MAX_REFERENCIAS_EXPORTACAO = 3;
export const MAX_OFERECE_JUNTO_EXPORTACAO = 5;

export interface ProdutoDaExportacao {
  id: string;
  codigo: string;
  descricao: string;
  aplicacao: string | null;
  hierarquia: { sistema: string | null; grupo: string | null; linha: string | null };
  referencias: { marca_id: string; marca_nome: string | null; codigo: string }[];
  oferece_junto: string[];
}

export interface EntradaExportacao {
  produtos: readonly ProdutoCatalogo[];
  nos: readonly NoCatalogo[];
  vinculos: readonly VinculoProdutoNo[];
  /** produto_id → ids "oferece junto" na ordem do cadastro. */
  ofereceJunto: ReadonlyMap<string, readonly string[]>;
  /** Cadastro de marcas do Catálogo (`catalogo.marca_concorrente`, RN-CAT-09); vazio/ausente = usa o retrato `marca_nome` da referência. */
  marcas?: MapaMarcas;
}

const porCodigo = (a: { codigo: string; id: string }, b: { codigo: string; id: string }) => a.codigo.localeCompare(b.codigo, 'pt-BR') || a.id.localeCompare(b.id);

export function montarExportacao(e: EntradaExportacao): { produtos: ProdutoDaExportacao[]; truncado: boolean } {
  const arvore = montarArvore(e.nos);
  const ativos = new Set(e.produtos.filter((p) => p.ativo).map((p) => p.id));
  const trilhaPorProduto = new Map<string, NoCatalogo[]>();
  for (const v of e.vinculos) {
    if (v.deleted_at) continue;
    const trilha = trilhaDe(arvore, v.no_id);
    const atual = trilhaPorProduto.get(v.produto_id);
    if (trilha.length > (atual?.length ?? 0)) trilhaPorProduto.set(v.produto_id, trilha);
  }
  const todos = e.produtos
    .filter((p) => p.ativo)
    .map((p): ProdutoDaExportacao => {
      const t = trilhaPorProduto.get(p.id) ?? [];
      const referencias: readonly Referencia[] = p.referencias ?? [];
      return {
        id: p.id,
        codigo: p.sku,
        descricao: p.nome,
        aplicacao: p.aplicacao?.trim() ? p.aplicacao : null,
        hierarquia: { sistema: t[0]?.nome ?? null, grupo: t[1]?.nome ?? null, linha: t[2]?.nome ?? null },
        referencias: referencias.slice(0, MAX_REFERENCIAS_EXPORTACAO).map((r) => ({ marca_id: r.marca_id, marca_nome: nomeMarcaDaReferencia(r.marca_id, r.marca_nome, e.marcas ?? new Map()), codigo: r.codigo })),
        oferece_junto: (e.ofereceJunto.get(p.id) ?? []).filter((id) => id !== p.id && ativos.has(id)).slice(0, MAX_OFERECE_JUNTO_EXPORTACAO),
      };
    })
    .sort(porCodigo);
  return { produtos: todos.slice(0, LIMITE_EXPORTACAO), truncado: todos.length > LIMITE_EXPORTACAO };
}
