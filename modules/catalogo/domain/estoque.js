import { localDate } from '@macuxi/comum';
/** RN-CAT-07: aviso discreto quando `stale` é true. */
export const AVISO_ESTOQUE_DESATUALIZADO = 'Estoque desatualizado';
export const ROTULO_SEM_HORA = 'Sem hora de atualização';
/** Texto da faixa para as telas (app e BKO usam o mesmo). */
export const ROTULO_FAIXA_ESTOQUE = { disponivel: 'Disponível', baixo: 'Estoque baixo', sem_estoque: 'Sem estoque' };
/** 0 ou menos = sem estoque; de 1 até `baixoAte` = baixo; acima = disponível. */
export function faixaDeEstoque(quantidade, baixoAte) {
    if (quantidade <= 0)
        return 'sem_estoque';
    return quantidade <= baixoAte ? 'baixo' : 'disponivel';
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
export function estoqueVisivel(produtoId, saldos, opcoes) {
    const agora = Date.parse(opcoes.agora);
    if (Number.isNaN(agora))
        throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
    const { estoque_baixo_ate: baixoAte, estoque_mostrar_quantidade: mostrar, estoque_defasado_horas: horas } = opcoes.parametros;
    const permitidas = opcoes.filiais === null ? null : new Set(opcoes.filiais);
    const porFilial = new Map();
    for (const s of saldos) {
        if (permitidas && !permitidas.has(s.branch_id))
            continue;
        const q = Number.isFinite(s.quantity) ? Math.max(0, Math.trunc(s.quantity)) : 0;
        const t = s.updated_at ? Date.parse(s.updated_at) : NaN;
        const atual = porFilial.get(s.branch_id) ?? { nome: s.branch_name, quantidade: 0, atualizado: null, semHora: false };
        atual.quantidade += q;
        if (Number.isNaN(t))
            atual.semHora = true;
        else
            atual.atualizado = atual.atualizado === null ? t : Math.min(atual.atualizado, t);
        porFilial.set(s.branch_id, atual);
    }
    const filiais = [...porFilial.entries()].sort(([ia, a], [ib, b]) => cmp(a.nome, b.nome) || cmp(ia, ib));
    const total = filiais.reduce((acc, [, f]) => acc + f.quantidade, 0);
    const horas_conhecidas = filiais.map(([, f]) => f.atualizado).filter((t) => t !== null);
    const maisAntiga = horas_conhecidas.length > 0 ? Math.min(...horas_conhecidas) : null;
    const algumSemHora = filiais.some(([, f]) => f.semHora);
    return {
        product_id: produtoId,
        band: faixaDeEstoque(total, baixoAte),
        quantity: mostrar ? total : null,
        by_branch: filiais.map(([id, f]) => ({
            branch_id: id,
            branch_name: f.nome,
            band: faixaDeEstoque(f.quantidade, baixoAte),
            quantity: mostrar ? f.quantidade : null,
        })),
        updated_at: maisAntiga === null ? null : new Date(maisAntiga).toISOString(),
        stale: filiais.length > 0 && (algumSemHora || (maisAntiga !== null && agora - maisAntiga > horas * 3_600_000)),
    };
}
/**
 * RN-CAT-07: "Atualizado às hh:mm" no fuso do tenant; se a atualização foi em outro dia (no fuso do tenant),
 * "Atualizado em dd/mm às hh:mm". Sem hora conhecida: "Sem hora de atualização".
 */
export function rotuloAtualizacaoEstoque(estoque, agora, fuso) {
    if (estoque.updated_at === null)
        return ROTULO_SEM_HORA;
    const t = new Date(estoque.updated_at);
    const a = new Date(agora);
    if (Number.isNaN(t.getTime()) || Number.isNaN(a.getTime()))
        throw new RangeError('Informe os instantes em ISO 8601 UTC.');
    const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
    if (localDate(t, fuso) === localDate(a, fuso))
        return `Atualizado às ${hora}`;
    const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(t);
    return `Atualizado em ${dia} às ${hora}`;
}
/**
 * RN-CORE-39 + RN-CAT-07: filiais cujo saldo o usuário vê (o argumento `filiais` de `estoqueVisivel`). Com cliente no
 * contexto vale só a filial dele (sem saldo nela = 0, nunca o da padrão); sem cliente, a carteira ou o tenant todo (`null`).
 */
export function filiaisDoEstoque(e) {
    if (e.filialDoCliente !== null)
        return [e.filialDoCliente];
    return e.escopo === 'tenant' ? null : e.filiaisDaCarteira;
}
