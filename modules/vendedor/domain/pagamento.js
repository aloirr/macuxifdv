/**
 * Forma de pagamento e prazo do pedido (T-0089; RN-VEN-24 e RN-VEN-25), título vencido (RN-VEN-13) e crédito do cliente
 * (RN-VEN-12). Funções puras: o app e a API usam as mesmas, e a API sempre revalida.
 */
import { haVersaoNova, versaoAppValida } from '@macuxi/platform-sdk';
/** RN-VEN-24: média das parcelas, arredondada PARA CIMA (28/56 = 42; 30/45 = 38; premissa P2). Lista vazia é erro de programação. */
export function prazoMedioDias(parcelas) {
    if (parcelas.length === 0)
        throw new Error('RN-VEN-24: o prazo precisa de ao menos uma parcela.');
    const soma = parcelas.reduce((a, b) => a + b, 0);
    return Math.ceil(soma / parcelas.length);
}
/** RN-VEN-24: o texto da lista mostra só o prazo ("28/56 dias"), nunca o prazo médio; `[0]` = "À vista". */
export function descricaoPrazo(parcelas) {
    if (parcelas.length === 1 && parcelas[0] === 0)
        return 'À vista';
    return `${parcelas.join('/')} dias`;
}
/** Descrição do ERP; sem ela (emissor ou dado antigo), o texto das parcelas (`descricaoPrazo`). */
export function descricaoDoPrazo(p) {
    return p.descricao?.trim() || descricaoPrazo(p.parcelas_dias);
}
function porOrdem(a, b) {
    return a.ordem - b.ordem || a.codigo.localeCompare(b.codigo);
}
/** RN-VEN-25: as formas ativas que o cliente aceita, por ordem. Lista do cliente nula ou vazia = todas as ativas; código sem forma é ignorado. */
export function formasDoCliente(formas, codigosDoCliente) {
    const todas = formas.filter((f) => f.ativo).sort(porOrdem);
    if (!codigosDoCliente || codigosDoCliente.length === 0)
        return todas;
    const permitidos = new Set(codigosDoCliente);
    return todas.filter((f) => permitidos.has(f.codigo));
}
/** RN-VEN-25 (ADR 0072): o prazo cabe no teto de prazo médio do cliente (nulo ou ausente = sem teto; igual ao teto vale). */
export function prazoDentroDoTeto(prazo, tetoDias) {
    return tetoDias === null || tetoDias === undefined || prazo.prazo_medio_dias <= tetoDias;
}
/** Primeira versão do app que filtra os prazos pelo teto do cliente (RN-VEN-25). */
export const VERSAO_MINIMA_TETO_PRAZO = '1.0.34';
/** RN-VEN-25 (opção A do dono do produto): teto só a partir de VERSAO_MINIMA_TETO_PRAZO; sem cabeçalho, versão menor ou inválida, não aplica. */
export function aplicaTetoDoCliente(v) {
    return !!v && versaoAppValida(v) && !haVersaoNova(v, VERSAO_MINIMA_TETO_PRAZO);
}
/** RN-VEN-24/25: os prazos ativos da forma, por ordem, só os que cabem no prazo médio máximo do cliente (`tetoDias`; nulo = sem teto). */
export function prazosDaForma(prazos, formaId, tetoDias) {
    return prazos.filter((p) => p.ativo && p.forma_pagamento_id === formaId && prazoDentroDoTeto(p, tetoDias)).sort(porOrdem);
}
/** RN-VEN-24: a primeira forma permitida que tenha prazo ativo, com o primeiro prazo dela; ou `null`. */
export function pagamentoPadrao(formasPermitidas, prazos, tetoDias) {
    for (const forma of formasPermitidas) {
        const prazo = prazosDaForma(prazos, forma.id, tetoDias)[0];
        if (prazo)
            return { forma, prazo };
    }
    return null;
}
/** RN-VEN-24 (forma/prazo existem, ativos, prazo da forma) e RN-VEN-25 (forma aceita pelo cliente). */
export function validarPagamento(i) {
    const { forma, prazo, cliente } = i;
    if (!forma || !forma.ativo)
        return { ok: false, codigo: 'RN-VEN-24', motivo: 'forma_indisponivel', mensagem: 'Forma de pagamento indisponível. Escolha outra forma na lista.' };
    if (!prazo || !prazo.ativo || prazo.forma_pagamento_id !== forma.id) {
        return { ok: false, codigo: 'RN-VEN-24', motivo: 'prazo_indisponivel', mensagem: 'Prazo indisponível para esta forma. Escolha outro prazo na lista.' };
    }
    const lista = cliente.formas_pagamento;
    if (lista && lista.length > 0 && !lista.includes(forma.codigo)) {
        return { ok: false, codigo: 'RN-VEN-25', motivo: 'forma_nao_aceita', mensagem: 'Este cliente não aceita esta forma de pagamento. Escolha outra forma.' };
    }
    if (!prazoDentroDoTeto(prazo, cliente.prazo_medio_max_dias)) {
        return { ok: false, codigo: 'RN-VEN-25', motivo: 'prazo_acima_do_cliente', mensagem: 'Este prazo passa do prazo médio do cliente. Escolha um prazo menor.' };
    }
    return { ok: true };
}
export const MSG_PERCENTUAL_DO_PRAZO_MUDOU = 'Este prazo de pagamento mudou. Atualize o app e refaça o pedido.';
export function revalidarPercentualDoPrazo(i) {
    const push = i.push ?? 0;
    const vigente = i.vigente ?? 0;
    if (Math.round(push * 100) === Math.round(vigente * 100))
        return { ok: true, percentual: push, mudou_depois: false };
    const mudouDepois = !!i.cadastro_atualizado_em && Date.parse(i.cadastro_atualizado_em) > Date.parse(i.criado_em);
    if (mudouDepois)
        return { ok: true, percentual: push, mudou_depois: true };
    return { ok: false, codigo: 'RN-VEN-45', mensagem: MSG_PERCENTUAL_DO_PRAZO_MUDOU };
}
export const MOTIVO_FORMA_NAO_ACEITA = 'Este cliente não aceita esta forma';
/**
 * RN-VEN-25 (T-0129): todas as formas ativas, por ordem; a que o cadastro do cliente não aceita vem desabilitada, com o motivo
 * (nunca some nem é trocada em silêncio). Lista do cliente nula ou vazia = todas habilitadas.
 */
export function formasDaLista(formas, codigosDoCliente) {
    const permitidos = codigosDoCliente && codigosDoCliente.length > 0 ? new Set(codigosDoCliente) : null;
    return formas
        .filter((f) => f.ativo)
        .sort(porOrdem)
        .map((forma) => (permitidos && !permitidos.has(forma.codigo) ? { forma, habilitada: false, motivo: MOTIVO_FORMA_NAO_ACEITA } : { forma, habilitada: true }));
}
/** Parâmetro `titulo_vencido_dias` do Vendedor (padrão 5; nenhum parâmetro do Vendedor é semeado por migração). */
export const TITULO_VENCIDO_DIAS_PADRAO = 5;
/** `titulo_vencido_dias` do tenant (inteiro 0..365; ausente ou inválido = 5). */
export function tituloVencidoDias(parametros) {
    const bruto = parametros['titulo_vencido_dias'];
    const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= 365 ? n : TITULO_VENCIDO_DIAS_PADRAO;
}
