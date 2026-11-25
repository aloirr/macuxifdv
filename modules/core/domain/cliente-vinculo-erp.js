import { motivoRecusaCortado } from './cliente-pre-cadastro';
/**
 * Vínculo com o código do ERP (RN-CORE-78, RN-INT-22; ADR 0069 item 8): o ERP manda. O código vale sobre o recusado (o ERP recusou e
 * depois criou o cliente) e vale vindo de revisão anterior (a `revisao` do retorno, ausente = a atual); revisão maior que a do cliente
 * é desconhecida. O mesmo código de novo é reentrega; código diferente para quem já tem é conflito.
 */
export function decidirVinculoErp(cliente, codigo, codigoEmUsoPorOutro, revisao) {
    const novo = codigo.trim();
    if (!cliente)
        return { acao: 'recusar', resultado: 'nao_encontrado' };
    if (cliente.external_id !== null) {
        return cliente.external_id === novo ? { acao: 'nada', resultado: 'ja_vinculado' } : { acao: 'recusar', resultado: 'conflito' };
    }
    if (revisao !== undefined && revisao > (cliente.revisao_cadastro ?? 1))
        return { acao: 'nada', resultado: 'revisao_desconhecida' };
    if (codigoEmUsoPorOutro)
        return { acao: 'recusar', resultado: 'codigo_em_uso' };
    return { acao: 'gravar' };
}
/** Erros comparados sem depender da ordem (o ERP pode reenviar em outra ordem). */
const chaveErros = (erros) => (erros ?? []).map((e) => JSON.stringify([e.campo, e.codigo, e.mensagem])).sort().join('\n');
/**
 * Recusa do ERP (RN-CORE-78, RN-INT-22): cliente que já tem código não é recusado depois. A `revisao` do retorno (ausente = a atual)
 * menor que a do cliente não vale sobre a nova; maior é desconhecida. Na revisão atual grava em 'pendente' (ou legado 'aprovado' sem
 * código); já 'recusado' com o mesmo motivo e os mesmos erros é repetição; com outro motivo ou outros erros é fato novo e grava.
 * Sem `retorno` (chamador antigo), recusado é sempre repetição.
 */
export function decidirRecusaErp(cliente, retorno) {
    if (!cliente)
        return { acao: 'nada', resultado: 'nao_encontrado' };
    if (cliente.external_id !== null)
        return { acao: 'nada', resultado: 'ja_vinculado' };
    const atual = cliente.revisao_cadastro ?? 1;
    const revisao = retorno?.revisao ?? atual;
    if (revisao < atual)
        return { acao: 'nada', resultado: 'revisao_antiga' };
    if (revisao > atual)
        return { acao: 'nada', resultado: 'revisao_desconhecida' };
    if (cliente.status_cadastro !== 'recusado')
        return { acao: 'gravar' };
    if (!retorno)
        return { acao: 'nada', resultado: 'ja_recusado' };
    const mesmo = motivoRecusaCortado(retorno.motivo) === motivoRecusaCortado(cliente.motivo_recusa) && chaveErros(retorno.erros) === chaveErros(cliente.erros_recusa);
    return mesmo ? { acao: 'nada', resultado: 'ja_recusado' } : { acao: 'gravar' };
}
