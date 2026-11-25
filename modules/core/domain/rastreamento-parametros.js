/** RN-CORE-13: "sem expediente cadastrado, o tracking não liga, mesmo com `rastreamento.ativo`" (§4.1). */
export function validarParametrosRastreamento(p) {
    const temFaixa = Object.values(p.expediente).some((faixas) => faixas.length > 0);
    if (p.ativo && !temFaixa) {
        return { ok: false, erros: [{ campo: 'expediente', mensagem: 'Para ligar o rastreamento, defina o expediente de pelo menos um dia da semana.' }] };
    }
    return { ok: true };
}
