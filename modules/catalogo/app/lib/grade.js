import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
import { textoDeEstoque, textoEquivaleA } from './apresentacao';
import { filhosDe, produtosDoNo, trilhaDe } from '../../domain/arvore';
export const SEM_FILTRO = { sistemaId: null, categoriaId: null };
/** Sistema = 1º nível da árvore; categoria = filhos dele. Nível abaixo da categoria não vira chip (spec §1). */
export function chipsDaGrade(a, f) {
    return { sistemas: filhosDe(a, null), categorias: f.sistemaId ? filhosDe(a, f.sistemaId) : [] };
}
/** Abertura com `?no=`: nó de 1º nível = sistema; mais fundo = a categoria (nível 2) e o sistema dela. Nó que não existe = sem filtro. */
export function filtroDoNo(a, noId) {
    if (!noId || !a.nos.has(noId))
        return SEM_FILTRO;
    const trilha = trilhaDe(a, noId);
    return { sistemaId: trilha[0]?.id ?? null, categoriaId: trilha[1]?.id ?? null };
}
export const escolherSistema = (f, id) => (id === f.sistemaId ? f : { sistemaId: id, categoriaId: null });
export const escolherCategoria = (f, id) => ({ ...f, categoriaId: id });
/** Produtos que a grade pode mostrar; `undefined` = sem restrição por árvore. */
export function produtosDoFiltro(a, vinculos, f) {
    const no = f.categoriaId ?? f.sistemaId;
    return no ? produtosDoNo(a, vinculos, no) : undefined;
}
const TOM_ESTADO = { success: 'sucesso', warning: 'aviso', danger: 'erro', neutral: 'neutro' };
/** Tag única de estoque do cartão (spec catalogo-grade §4): "Estoque: N"; `null` = o perfil não vê estoque (RN-CAT-05). Sem saldo recebido = "Estoque: 0" (RN-CORE-39 com cliente). */
export function tagDeEstoque(item) {
    const a = item.availability;
    if (!item.price_stock_visible || !a)
        return null;
    const t = a.by_branch.length === 0 ? textoDeEstoque('sem_estoque', a.quantity, a.quantity !== null) : textoDeEstoque(a.band, a.quantity);
    return { texto: t.texto, tom: TOM_ESTADO[t.tom] };
}
/** Contagem do cabeçalho: "40 produtos", "1 produto". */
export function subtituloDaGrade(total) {
    return `${total.toLocaleString('pt-BR')} ${total === 1 ? 'produto' : 'produtos'}`;
}
/** Duas colunas: [[a, b], [c, d], [e]]. */
export function emLinhas(itens, colunas = 2) {
    const r = [];
    for (let i = 0; i < itens.length; i += colunas)
        r.push(itens.slice(i, i + colunas));
    return r;
}
/** Linha da marca do cartão (spec §2, RN-CAT-09): "Equivale a Freiomax CB 3401" quando há equivalência; senão a marca. */
export function linhaDaMarca(item) {
    const equivale = textoEquivaleA(item);
    return equivale ? `Equivale a ${equivale}` : item.brand ?? '';
}
/**
 * Códigos do cartão em duas linhas (catalogo-campo-v2 §1): em cima a marca (ou "Equivale a ..."), embaixo o código do produto com o
 * copiar. O copiar leva SÓ o código do produto (`erp_code`), sem marca (R-20261115-084500). O código da marca não vem no contrato
 * (hoje está no nome do produto), então a linha de cima mostra só a marca.
 */
export function codigosDoCartao(item) {
    return { marca: linhaDaMarca(item), produto: item.erp_code, copiar: item.erp_code };
}
/** Preço do cartão: o valor quando vendável; senão a mensagem única do domain (RN-CAT-05); `null` = o perfil não vê preço. */
export function precoDoCartao(preco) {
    if (!preco)
        return null;
    return preco.vendavel ? preco.texto : MENSAGEM_SEM_PRECO_CATALOGO;
}
/** TalkBack do cartão: "Açúcar cristal 1 kg, Doce Vale, R$ 4,95, 6 em estoque". */
export function rotuloAcessivelDoCartao(partes) {
    return partes.filter((p) => Boolean(p && p.trim())).join(', ');
}
