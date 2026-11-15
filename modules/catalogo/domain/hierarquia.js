/**
 * Navegação pela hierarquia do catálogo (RF-CAT-09, T-0142): a página inicial do Catálogo é a própria hierarquia, do maior
 * agrupamento para o menor (sistema › grupo › linha › produtos). Função pura: o app (offline, SQLite) e a API/BKO carregam
 * as linhas e usam a mesma regra. Decisões do dono do produto (R-20261109-065241 e R-20261109-065415):
 * 1. começa pelo nível mais alto que existir e pula os vazios (item sem produto ativo não aparece);
 * 2. nível com um item só pula direto para o de baixo (a trilha não guarda o nível pulado);
 * 3. sem hierarquia nenhuma, lista de produtos com a busca;
 * 4. contagem de produtos ativos ao lado de cada nível: ativos e não excluídos, sem filtro de estoque, distintos.
 * Nenhum produto some: o ligado direto a um nível que também tem filhos vai para "Outros produtos" daquele nível; o ativo
 * fora da árvore vai para "Sem classificação" na raiz (spec `docs/design/catalogo-por-linha.md` §1).
 */
import { montarArvore, trilhaDe } from './arvore';
/** Id do item virtual dos produtos ativos que não estão em nenhum nível da árvore ("Sem classificação"). */
export const NO_SEM_LINHA = 'sem-linha';
/** Prefixo do id do item virtual "Outros produtos" (`outros:<id do nível>`): os produtos ligados direto a um nível com filhos. */
export const PREFIXO_OUTROS = 'outros:';
export const NOME_SEM_CLASSIFICACAO = 'Sem classificação';
export const NOME_OUTROS_PRODUTOS = 'Outros produtos';
/** Nome do nível (RF-CAT-09): 1 sistema, 2 grupo, 3 linha; abaixo disso a árvore do ERP segue com "Nível n". */
export function rotuloDoNivel(nivel) {
    return nivel === 1 ? 'Sistema' : nivel === 2 ? 'Grupo' : nivel === 3 ? 'Linha' : `Nível ${nivel}`;
}
/** Cabeçalho da lista no plural (nomes do ERP): "Sistemas", "Grupos", "Linhas"; níveis mais fundos ou sem nome: "Categorias". */
export function rotuloPluralDoNivel(nivel) {
    return nivel === 1 ? 'Sistemas' : nivel === 2 ? 'Grupos' : nivel === 3 ? 'Linhas' : 'Categorias';
}
/** Ids dos produtos ativos e não excluídos (base da contagem; estoque não entra). */
export function idsAtivos(produtos) {
    return new Set(produtos.filter((p) => p.ativo && !p.deleted_at).map((p) => p.id));
}
export function navegarHierarquia(arvoreOuNos, vinculos, ativos, noId) {
    const arvore = Array.isArray(arvoreOuNos) ? montarArvore(arvoreOuNos) : arvoreOuNos;
    const doNo = new Map();
    const vinculados = new Set();
    for (const v of vinculos) {
        if (v.deleted_at || !arvore.nos.has(v.no_id) || !ativos.has(v.produto_id))
            continue;
        doNo.set(v.no_id, (doNo.get(v.no_id) ?? new Set()).add(v.produto_id));
        vinculados.add(v.produto_id);
    }
    const semLinha = [...ativos].filter((id) => !vinculados.has(id));
    // produtos distintos do nó e de tudo abaixo, calculados uma vez por nó
    const memo = new Map();
    const coletar = (id) => {
        const guardado = memo.get(id);
        if (guardado)
            return guardado;
        const r = new Set(doNo.get(id) ?? []);
        for (const f of arvore.filhos.get(id) ?? [])
            for (const p of coletar(f.id))
                r.add(p);
        memo.set(id, r);
        return r;
    };
    const diretosDe = (id) => (id === null ? [] : [...(doNo.get(id) ?? [])]);
    const item = (n) => ({ id: n.id, no: n, codigo: n.codigo, nome: n.nome, rotuloNivel: rotuloDoNivel(n.nivel), total: coletar(n.id).size });
    const itensDe = (paiId) => {
        const r = (arvore.filhos.get(paiId) ?? []).filter((n) => coletar(n.id).size > 0).map(item);
        if (r.length === 0)
            return r;
        const diretos = diretosDe(paiId);
        if (diretos.length > 0)
            r.push({ id: PREFIXO_OUTROS + paiId, no: null, codigo: PREFIXO_OUTROS + paiId, nome: NOME_OUTROS_PRODUTOS, rotuloNivel: NOME_OUTROS_PRODUTOS, total: diretos.length });
        if (paiId === null && semLinha.length > 0)
            r.push({ id: NO_SEM_LINHA, no: null, codigo: NO_SEM_LINHA, nome: NOME_SEM_CLASSIFICACAO, rotuloNivel: NOME_SEM_CLASSIFICACAO, total: semLinha.length });
        return r;
    };
    /** Onde a navegação para ao abrir `id`: desce enquanto o nível tiver um item só (que seja um nível real). */
    const resolver = (id) => {
        let atual = id;
        for (;;) {
            const itens = itensDe(atual);
            if (itens.length === 1 && itens[0].no)
                atual = itens[0].no.id;
            else
                return atual;
        }
    };
    /** Caminho da raiz até o nível real `idReal` (e o item virtual, se for o caso); só é tocável o que leva a uma tela diferente da atual. */
    const montarCaminho = (idReal, virtual) => {
        const atualId = virtual ? virtual.id : idReal;
        const caminho = trilhaDe(arvore, idReal).map((n) => ({ id: n.id, codigo: n.codigo, nome: n.nome, tocavel: resolver(n.id) !== atualId }));
        if (virtual)
            caminho.push({ id: virtual.id, codigo: virtual.id, nome: virtual.nome, tocavel: false });
        return { caminho, raizTocavel: resolver(null) !== atualId };
    };
    const virtual = noId === NO_SEM_LINHA ? NO_SEM_LINHA : noId?.startsWith(PREFIXO_OUTROS) ? noId : null;
    if (virtual === NO_SEM_LINHA && semLinha.length > 0 && itensDe(null).length > 0) {
        return { tipo: 'produtos', ...montarCaminho(null, { id: NO_SEM_LINHA, nome: NOME_SEM_CLASSIFICACAO }), noId: NO_SEM_LINHA, semHierarquia: false, produtoIds: semLinha };
    }
    if (virtual && virtual !== NO_SEM_LINHA) {
        const pai = virtual.slice(PREFIXO_OUTROS.length);
        const diretos = diretosDe(arvore.nos.has(pai) ? pai : null);
        if (diretos.length > 0 && itensDe(pai).length > 0)
            return { tipo: 'produtos', ...montarCaminho(pai, { id: virtual, nome: NOME_OUTROS_PRODUTOS }), noId: virtual, semHierarquia: false, produtoIds: diretos };
    }
    const atual = resolver(noId !== null && arvore.nos.has(noId) ? noId : null);
    const itens = itensDe(atual);
    if (itens.length === 0) {
        if (atual === null)
            return { tipo: 'produtos', caminho: [], raizTocavel: false, noId: null, semHierarquia: true, produtoIds: [...ativos] };
        return { tipo: 'produtos', ...montarCaminho(atual), noId: atual, semHierarquia: false, produtoIds: [...coletar(atual)] };
    }
    return { tipo: 'niveis', ...montarCaminho(atual), rotuloPlural: rotuloPluralDoNivel(itens.find((i) => i.no)?.no?.nivel ?? 4), niveis: itens, total: atual === null ? ativos.size : coletar(atual).size };
}
