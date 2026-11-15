export const ROTULO_NAO_ENVIADO = 'Não enviado — módulo desativado';
/** Aplica a resposta do push a um item: 403 MODULO_INATIVO vira rejeitado; o resto segue a regra normal do motor. */
export function estadoAposPush(resposta) {
    if (resposta.ok)
        return 'enviado';
    if (resposta.status === 403 && resposta.codigo === 'MODULO_INATIVO')
        return 'rejeitado_modulo_inativo';
    return 'falhou';
}
/** Itens do módulo que ainda NÃO chegaram ao servidor (tudo que não está `enviado`). */
export function naoEnviadosDoModulo(fila, modulo) {
    return fila.filter((i) => i.modulo === modulo && i.estado !== 'enviado');
}
/** Itens a listar na tela de sync com o rótulo "não enviado — módulo desativado". */
export function itensParaMostrarNaTelaDeSync(fila, removidos) {
    return fila.filter((i) => removidos.includes(i.modulo) && i.estado !== 'enviado');
}
/** Antes de apagar: o app tenta enviar os itens pendentes/falhos de módulos removidos (a API vai rejeitar). */
export function itensParaTentarEnviar(fila, removidos) {
    return fila.filter((i) => removidos.includes(i.modulo) && (i.estado === 'pendente' || i.estado === 'falhou'));
}
/**
 * Os dados locais do módulo podem ser apagados? Sem itens não enviados, sim. Com itens, só depois da
 * confirmação do usuário (nada some em silêncio) e nunca enquanto ainda há item `pendente` por tentar.
 */
export function podeApagarDadosLocais(fila, modulo, usuarioConfirmou) {
    const abertos = naoEnviadosDoModulo(fila, modulo);
    if (abertos.length === 0)
        return true;
    if (abertos.some((i) => i.estado === 'pendente'))
        return false;
    return usuarioConfirmou;
}
