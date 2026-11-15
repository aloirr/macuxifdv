/**
 * Textos e tons do cartão e da ficha no app (puro, testável em Node). A decisão (preço da tabela do cliente, faixa de
 * estoque, quem vê) é do domain; aqui só a forma de mostrar.
 */
import { formatBRL } from '@macuxi/comum';
import { AVISO_ESTOQUE_DESATUALIZADO, ROTULO_FAIXA_ESTOQUE, rotuloAtualizacaoEstoque } from '../../domain/estoque';
import { MENSAGEM_SEM_PRECO_CATALOGO } from '../../domain/vitrine';
/** Preço do cartão; `null` = o perfil não vê preço (RN-CAT-05: nada aparece, nem "sem preço"). */
export function rotuloPreco(item) {
    if (!item.price_stock_visible || !item.price)
        return null;
    const p = item.price;
    if (p.sellable && p.price_cents !== null)
        return { texto: formatBRL(p.price_cents), riscado: p.on_promotion && p.base_cents !== null ? formatBRL(p.base_cents) : null, vendavel: true };
    return { texto: p.notice ?? MENSAGEM_SEM_PRECO_CATALOGO, riscado: null, vendavel: false };
}
/** Estoque que acende o tom de aviso: de 1 a 9 (docs/design/catalogo-grade.md §4); 10 ou mais é sucesso. */
export const ESTOQUE_MINIMO_SUCESSO = 10;
/**
 * Tag única de estoque (spec catalogo-grade §4, catalogo-campo-v2 §3): "Estoque: 84" (10 ou mais, sucesso), "Estoque: 6" (1 a 9, aviso),
 * "Estoque: 0" (zero ou nenhum saldo recebido, perigo). Tenant que esconde a quantidade (`quantity` nulo): "Em estoque", "Pouco estoque", "Sem estoque".
 */
export function textoDeEstoque(band, quantity, semSaldo = false) {
    const mostra = quantity !== null || semSaldo;
    if (semSaldo || band === 'sem_estoque' || (quantity !== null && quantity <= 0))
        return { texto: mostra ? 'Estoque: 0' : 'Sem estoque', tom: 'danger' };
    if (quantity === null)
        return band === 'baixo' ? { texto: 'Pouco estoque', tom: 'warning' } : { texto: 'Em estoque', tom: 'success' };
    return { texto: `Estoque: ${quantity.toLocaleString('pt-BR')}`, tom: quantity >= ESTOQUE_MINIMO_SUCESSO ? 'success' : 'warning' };
}
/** Linha por filial na ficha: "Matriz: Disponível · 1.200" (número em pt-BR quando o tenant o mostra). */
export function rotuloEstoqueFilial(b) {
    const faixa = ROTULO_FAIXA_ESTOQUE[b.band];
    return `${b.branch_name}: ${b.quantity !== null && b.band !== 'sem_estoque' ? `${faixa} · ${b.quantity.toLocaleString('pt-BR')}` : faixa}`;
}
/**
 * Estoque do cartão e da ficha (RN-CAT-07); `null` = o perfil não vê estoque (RN-CAT-05). Sem nenhum saldo recebido vale 0
 * ("Estoque: 0", vermelho): acabou o "Estoque sem informação". Com cliente, a filial dele (RN-CORE-39).
 */
export function rotuloEstoque(item, agora, fuso) {
    const a = item.availability;
    if (!item.price_stock_visible || !a)
        return null;
    if (a.by_branch.length === 0)
        return { ...textoDeEstoque('sem_estoque', a.quantity, a.quantity !== null), detalhe: '', desatualizado: false };
    const hora = rotuloAtualizacaoEstoque(a, agora, fuso);
    return { ...textoDeEstoque(a.band, a.quantity), detalhe: a.stale ? `${AVISO_ESTOQUE_DESATUALIZADO} · ${hora}` : hora, desatualizado: a.stale };
}
/** Linha secundária do cartão: marca · código. */
export function subtituloProduto(item) {
    return [item.brand, item.erp_code].filter((s) => s && s.trim()).join(' · ');
}
// ---------- aplicação e referência cruzada (RN-CAT-12, RN-CAT-09; T-0084/T-0085) ----------
/** "Freiomax CB 3401": marca + código. */
export function textoEquivaleA(item) {
    return item.equivale_a ? `${item.equivale_a.marca_nome} ${item.equivale_a.codigo}` : null;
}
/** Ficha: acima de 6 linhas a aplicação vem recolhida com "ver mais" (estimativa por quebra de linha e ~46 caracteres por linha). */
export const LINHAS_APLICACAO_RECOLHIDA = 6;
export function aplicacaoPrecisaRecolher(texto) {
    const linhas = texto.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 46)), 0);
    return linhas > LINHAS_APLICACAO_RECOLHIDA;
}
/**
 * Ficha, "Oferece junto" (UX A3): o item abre quando o produto está no aparelho ou há sinal para buscá-lo na API.
 * Sem sinal e com a ficha vinda da API (produto fora do aparelho), a linha não toca e explica o motivo.
 */
export function estadoOfereceJunto(e) {
    return e.online || e.fichaNoAparelho ? { toca: true, apoio: null } : { toca: false, apoio: 'Ainda não está no aparelho' };
}
