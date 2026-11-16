/**
 * Produto do Catálogo a partir do retrato do Core (`core.cadastro_resumo@1`, T-0119). Causa do defeito "marca e categoria
 * vazias na busca": o repositório fixava `marca: ''`/`categoria: ''`/`ean: null` porque a consulta não os devolvia. Marca,
 * categoria e EAN são aditivos e opcionais no contrato (emissor antigo = ausentes). Puro: sem I/O.
 */
import type { ProdutoCatalogo } from '../domain/vitrine';

/** Campos do produto do Core que o Catálogo usa; os três últimos são aditivos (ausente = emissor antigo). */
export interface ProdutoDoCore {
  id: string;
  sku: string;
  nome: string;
  unidade: string;
  ativo: boolean;
  marca?: string | null;
  categoria?: string | null;
  ean?: string | null;
  external_id?: string | null;
}

const texto = (v: string | null | undefined): string => (v ?? '').trim();

export function produtoDoCadastroCore(p: ProdutoDoCore): ProdutoCatalogo {
  const ean = texto(p.ean);
  return {
    id: p.id,
    sku: p.sku,
    ean: ean === '' ? null : ean,
    external_id: texto(p.external_id) || null,
    nome: p.nome,
    marca: texto(p.marca),
    categoria: texto(p.categoria),
    unidade: p.unidade,
    ativo: p.ativo,
    atributos: [],
    thumbnail_url: null,
    campanha: false,
    vendas: 0,
  };
}
