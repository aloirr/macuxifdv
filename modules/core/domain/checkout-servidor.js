/**
 * RN-CORE-12 / RN-CORE-14 revalidadas na API (T-0039). Função pura sobre `prepararCheckoutVisita`: o servidor não confia
 * nas etapas que o aparelho diz ter cumprido; usa a verificação de cada módulo ativo (contrato `etapas-checkout`).
 * Códigos de recusa: `MOTIVO_INVALIDO` (motivo fora da lista ativa do tenant), `RN-CORE-14` (cliente fechado), `RN-CORE-12`.
 */
import { prepararCheckoutVisita } from './checkout';
/**
 * RN-CORE-12: motivo do próprio tenant vale se ativo, ou se estava ativo no checkout (checkout offline antes da desativação).
 * Sem data de desativação, motivo desativado do tenant é aceito; inexistente/de outro tenant (`null`) é recusado.
 */
function motivoValeNoCheckout(e) {
    const m = e.motivo;
    if (!m)
        return false;
    if (!m.desativadoEm)
        return true;
    const des = Date.parse(m.desativadoEm);
    const chk = e.checkoutEm ? Date.parse(e.checkoutEm) : NaN;
    if (Number.isNaN(des))
        return true;
    return !Number.isNaN(chk) && chk <= des;
}
export function avaliarCheckoutNoServidor(e) {
    if (e.motivoId && !motivoValeNoCheckout(e))
        return { pode: false, codigo: 'MOTIVO_INVALIDO', pendencias: ['motivo'], etapasRegistro: [] };
    const etapas = e.verificacoes.map((v) => ({ modulo: v.modulo, id: v.etapa, rotulo: v.rotulo, obrigatoria: v.obrigatoria, concluida: v.concluida }));
    const textoLivre = Boolean(e.motivoTexto?.trim());
    const prep = prepararCheckoutVisita({
        escolha: e.resultadoInformado === 'cliente_fechado' ? null : e.resultadoInformado,
        vendedorEfetivo: e.vendedorEfetivo,
        // texto livre sem item da lista conta como motivo de não venda (compatibilidade com o contrato do push)
        motivo: e.motivo ? { tipo: e.motivo.tipo } : textoLivre ? { tipo: 'nao_venda' } : null,
        fotoFachada: e.fotoFachada,
        temPedido: e.temPedido,
        etapas,
    });
    // cliente fechado no cadastro do tenant manda: outro resultado informado = aparelho incoerente (fugiria das etapas)
    const incoerente = e.resultadoInformado !== 'cliente_fechado' && prep.resultado === 'cliente_fechado';
    const pendencias = incoerente ? ['resultado'] : prep.pendencias;
    const pode = prep.pode && !incoerente;
    const codigo = pode ? null : e.resultadoInformado === 'cliente_fechado' ? 'RN-CORE-14' : 'RN-CORE-12';
    return { pode, codigo, pendencias, etapasRegistro: pode ? prep.etapasRegistro : [] };
}
