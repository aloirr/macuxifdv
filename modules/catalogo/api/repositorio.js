import { agruparTermosSemResultado } from '../domain/conteudo';
import { precosDaFilialSemCliente } from '../domain/preco-filial';
/** Filial padrão do repositório em memória (testes e demo sem banco). */
export const FILIAL_PADRAO_MEMORIA = '0f000000-0000-4000-8000-0000000000a0';
/** Repositório em memória por tenant: um tenant nunca enxerga o outro (RN-CAT-01). Devolve a fábrica e o estado (para os testes). */
export function criarRepositorioMemoria(porTenant) {
    const estados = new Map();
    const estado = (tenant) => {
        let e = estados.get(tenant);
        if (!e) {
            e = { dados: porTenant[tenant] ?? { produtos: [] }, usoIa: new Map(), buscas: [] };
            estados.set(tenant, e);
        }
        return e;
    };
    const fabrica = (ctx) => {
        const e = estado(ctx.usuario.tenant_id);
        const d = e.dados;
        const usuario = ctx.usuario.id;
        const copia = (v) => structuredClone(v);
        return {
            async produtos() {
                return copia(d.produtos);
            },
            async produto(id) {
                return copia(d.produtos.find((p) => p.id === id) ?? null);
            },
            async sinonimos() {
                return copia(d.sinonimos ?? []);
            },
            async precos(clienteId, produtoIds, filialId) {
                const ids = new Set(produtoIds);
                if (clienteId === null && filialId) {
                    const padraoId = d.filiaisDaTela?.padraoId ?? FILIAL_PADRAO_MEMORIA;
                    const daFilial = (d.itensPreco ?? []).filter((i) => i.price_table_id !== null && (i.filial_id ?? padraoId) === filialId);
                    const tabelas = (d.tabelas ?? []).map((t) => ({ id: t.id, codigo: t.codigo, ativo: t.ativo }));
                    const itens = precosDaFilialSemCliente(tabelas, daFilial.map((i) => ({ tabela_preco_id: i.price_table_id, produto_id: i.product_id, preco_cents: i.price_cents, vigencia_inicio: i.valid_from ?? null, vigencia_fim: i.valid_to ?? null }))).filter((i) => ids.has(i.product_id));
                    return { tabelaClienteId: null, itens: copia(itens) };
                }
                const tabela = clienteId === null ? null : (d.tabelaDoCliente?.[clienteId] ?? null);
                const itens = (d.itensPreco ?? []).filter((i) => ids.has(i.product_id) && i.price_table_id === tabela);
                return { tabelaClienteId: tabela, itens: copia(itens) };
            },
            async promocoes(produtoIds) {
                const ids = new Set(produtoIds);
                return copia((d.promocoes ?? []).filter((p) => ids.has(p.product_id)));
            },
            async saldos(produtoIds) {
                const ids = new Set(produtoIds);
                return new Map([...(d.saldos ?? new Map()).entries()].filter(([k]) => ids.has(k)).map(([k, v]) => [k, copia(v)]));
            },
            async filiaisDoUsuario() {
                return d.filiaisDoUsuario?.[usuario] ? [...d.filiaisDoUsuario[usuario]] : null;
            },
            async conteudo(produtoId) {
                return { conteudo: copia(d.conteudos?.get(produtoId) ?? null), midias: copia(d.midias?.get(produtoId) ?? []) };
            },
            async usoIa(dia) {
                if (d.semCotaIa)
                    return 'indisponivel';
                const n = e.usoIa.get(`${usuario}:${dia}`);
                return n === undefined ? null : { dia, consultas: n };
            },
            async debitarIa(dia, limite) {
                // atômico no event loop: lê e grava sem await no meio (como o UPDATE ... WHERE usadas < limite do banco)
                const k = `${usuario}:${dia}`;
                const n = e.usoIa.get(k) ?? 0;
                if (n >= limite)
                    return false;
                e.usoIa.set(k, n + 1);
                return true;
            },
            async registrarBusca(r) {
                e.buscas.push({ ...r });
            },
            async termosSemResultado(desde, limite) {
                return agruparTermosSemResultado(e.buscas, desde, limite);
            },
            async salvarSinonimo(id, s) {
                const lista = (d.sinonimos ??= []);
                const i = lista.findIndex((x) => x.id === id);
                const novo = { id, term: s.term, synonyms: [...s.synonyms], active: s.active };
                if (i >= 0)
                    lista[i] = { ...lista[i], ...novo };
                else
                    lista.push(novo);
                return { criado: i < 0 };
            },
            async removerSinonimo(id) {
                const lista = d.sinonimos ?? [];
                const i = lista.findIndex((x) => x.id === id);
                if (i < 0)
                    return false;
                lista.splice(i, 1);
                return true;
            },
            async marcarDestaque(produtoId, destaque) {
                const p = d.produtos.find((x) => x.id === produtoId);
                if (p)
                    p.campanha = destaque;
            },
            async definirFotoPrincipal(produtoId, arquivoId) {
                const p = d.produtos.find((x) => x.id === produtoId);
                const url = `/v1/arquivos/${arquivoId}`;
                if (!p || p.thumbnail_url === url)
                    return { alterou: false };
                p.thumbnail_url = url;
                return { alterou: true };
            },
            async extrasFicha(produtoId) {
                const ids = d.ofereceJunto?.get(produtoId) ?? [];
                const ofereceJunto = ids.flatMap((id) => {
                    const p = d.produtos.find((x) => x.id === id);
                    return p ? [{ produto_id: p.id, erp_code: p.sku, description: p.nome }] : [];
                });
                return { ofereceJunto, etiquetas: [...(d.etiquetas?.get(produtoId) ?? [])] };
            },
            async marcasConcorrentes() {
                return new Map(d.marcas ?? []);
            },
            async marcasCadastro() {
                const refs = d.referencias ?? new Map();
                return [...(d.marcas ?? new Map()).entries()]
                    .map(([id, m]) => ({ id, nome: m.nome, ativo: m.ativo, external_id: d.marcasExternas?.get(id) ?? null, referencias: [...refs.values()].flat().filter((r) => r.marca_id === id).length }))
                    .sort((a, b) => a.nome.toLowerCase().localeCompare(b.nome.toLowerCase(), 'pt-BR') || a.id.localeCompare(b.id));
            },
            async gravarMarca(id, m) {
                if (d.marcasIdsEmUso?.has(id))
                    return false;
                (d.marcas ??= new Map()).set(id, { nome: m.nome, ativo: m.ativo });
                (d.marcasExternas ??= new Map()).set(id, m.external_id);
                return true;
            },
            async dadosExportacao() {
                return { nos: copia(d.nos ?? []), vinculos: copia(d.vinculos ?? []), ofereceJunto: new Map([...(d.ofereceJunto ?? new Map()).entries()].map(([k, v]) => [k, [...v]])) };
            },
            async filiaisDaTela() {
                return d.filiaisDaTela ?? { padraoId: FILIAL_PADRAO_MEMORIA, filiais: [{ id: FILIAL_PADRAO_MEMORIA, nome: 'Filial padrão', padrao: true }] };
            },
            async tabelasPreco(filialId) {
                const padrao = (d.filiaisDaTela?.padraoId ?? FILIAL_PADRAO_MEMORIA) === filialId;
                const daFilial = (i) => (i.filial_id ?? (d.filiaisDaTela?.padraoId ?? FILIAL_PADRAO_MEMORIA)) === filialId || (padrao && i.filial_id === undefined);
                return (d.tabelas ?? []).map((t) => ({ ...t, itens: (d.itensPreco ?? []).filter((i) => i.price_table_id === t.id && i.unit == null && daFilial(i)).length }));
            },
            async precosUnidade(tabelaId, filialId) {
                const padraoId = d.filiaisDaTela?.padraoId ?? FILIAL_PADRAO_MEMORIA;
                return (d.itensPreco ?? [])
                    .filter((i) => i.price_table_id === tabelaId && i.unit == null && (i.filial_id ?? padraoId) === filialId)
                    .map((i) => ({ produto_id: i.product_id, preco_cents: i.price_cents, vigencia_inicio: i.valid_from ?? null, vigencia_fim: i.valid_to ?? null }));
            },
            async faixas() {
                return copia(d.faixas ?? []);
            },
            async salvarFaixa(id, f) {
                const lista = (d.faixas ??= []);
                const i = lista.findIndex((x) => x.id === id);
                const nova = { id, external_id: i >= 0 ? lista[i].external_id : null, produto_id: f.produto_id, medida: f.medida, quantidade_minima: f.quantidade_minima, preco_unidade_cents: f.preco_unidade_cents, vigencia_inicio: f.vigencia_inicio, vigencia_fim: f.vigencia_fim, tabela_preco_id: f.tabela_preco_id, ativo: f.ativo };
                if (i >= 0)
                    lista[i] = nova;
                else
                    lista.push(nova);
                return { criado: i < 0 };
            },
            async removerFaixa(id) {
                const lista = d.faixas ?? [];
                const i = lista.findIndex((x) => x.id === id);
                if (i >= 0)
                    lista.splice(i, 1);
                return i >= 0;
            },
            async salvarCadastroCatalogo(produtoId, c) {
                const p = d.produtos.find((x) => x.id === produtoId);
                const criado = !!p && !p.aplicacao && (p.referencias ?? []).length === 0;
                const marcas = d.marcas ?? new Map();
                if (p) {
                    p.aplicacao = c.aplicacao?.trim() ?? '';
                    if (c.referencias !== undefined) {
                        p.referencias = c.referencias.flatMap((r) => {
                            const m = marcas.get(r.marca_id);
                            return m ? [{ marca_id: r.marca_id, marca_nome: m.nome, codigo: r.codigo.trim() }] : [];
                        });
                    }
                }
                (d.ofereceJunto ??= new Map()).set(produtoId, [...c.oferece_junto]);
                (d.etiquetas ??= new Map()).set(produtoId, c.etiquetas.map((e) => e.trim()));
                return { criado };
            },
            async salvarConteudo(produtoId, c, em) {
                const conteudos = (d.conteudos ??= new Map());
                const criado = !conteudos.has(produtoId);
                conteudos.set(produtoId, { description: c.description, selling_points: [...c.selling_points], faq: c.faq.map((f) => ({ ...f })), updated_at: em });
                const p = d.produtos.find((x) => x.id === produtoId);
                if (p && c.aplicacao !== undefined)
                    p.aplicacao = c.aplicacao?.trim() ?? '';
                if (p)
                    p.atributos = c.attributes.map((a) => ({ ...a }));
                return { criado };
            },
        };
    };
    return { fabrica, estado };
}
