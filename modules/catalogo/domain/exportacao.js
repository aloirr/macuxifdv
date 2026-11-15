import { nomeMarcaDaReferencia } from './marcas';
import { montarArvore, trilhaDe } from './arvore';
/** Teto de produtos numa resposta (página única, sem paginação): acima disso a resposta marca `truncado`. */
export const LIMITE_EXPORTACAO = 20_000;
export const MAX_REFERENCIAS_EXPORTACAO = 3;
export const MAX_OFERECE_JUNTO_EXPORTACAO = 5;
const porCodigo = (a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR') || a.id.localeCompare(b.id);
export function montarExportacao(e) {
    const arvore = montarArvore(e.nos);
    const ativos = new Set(e.produtos.filter((p) => p.ativo).map((p) => p.id));
    const trilhaPorProduto = new Map();
    for (const v of e.vinculos) {
        if (v.deleted_at)
            continue;
        const trilha = trilhaDe(arvore, v.no_id);
        const atual = trilhaPorProduto.get(v.produto_id);
        if (trilha.length > (atual?.length ?? 0))
            trilhaPorProduto.set(v.produto_id, trilha);
    }
    const todos = e.produtos
        .filter((p) => p.ativo)
        .map((p) => {
        const t = trilhaPorProduto.get(p.id) ?? [];
        const referencias = p.referencias ?? [];
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
