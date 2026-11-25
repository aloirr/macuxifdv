import { ERROS_TAREFA, TAREFA_DESTINATARIOS_MAX } from '../../contracts/tarefa';
/**
 * RN-PRO-01: se o tipo envolve pedido. Nenhum tipo de hoje envolve; o `Record` obriga quem criar um tipo novo a decidir.
 * Vale pelo PERFIL, não pelo módulo (doc 03 §1).
 */
export const TIPO_ENVOLVE_PEDIDO = Object.freeze({ simples: false, foto: false, pesquisa: false });
export function tipoPermitidoParaPerfil(tipo, perfil, envolvePedido = TIPO_ENVOLVE_PEDIDO) {
    return !(perfil === 'promotor' && envolvePedido[tipo]);
}
const ehConsultor = (c) => c.perfil === 'vendedor' || c.perfil === 'promotor';
const ordenar = (ids) => [...new Set(ids)].sort();
const recusa = (status, codigo, ids) => ({
    ok: false,
    status,
    codigo,
    usuario_ids: ordenar(ids),
});
/**
 * Lista final de destinatários. Pessoas escolhidas uma a uma: cada problema recusa a criação com quem o causou. Equipe e
 * Todos: entram os consultores ativos (da equipe) que podem receber o tipo e que têm o cliente, quando houver; a pesquisa
 * continua exigindo que todos possam responder (RN-CORE-TAR-03).
 */
export function expandirDestinatarios(e, envolvePedido = TIPO_ENVOLVE_PEDIDO) {
    const porId = new Map(e.visiveis.map((c) => [c.id, c]));
    const podeTipo = (c) => tipoPermitidoParaPerfil(e.tipo, c.perfil, envolvePedido);
    const temCliente = (c) => e.com_cliente_na_carteira === null || e.com_cliente_na_carteira.has(c.id);
    let escolhidos;
    if (e.destino.alvo === 'usuarios') {
        const ids = ordenar(e.destino.usuario_ids);
        const fora = ids.filter((id) => !porId.has(id));
        if (fora.length)
            return recusa(403, ERROS_TAREFA.foraDoEscopo, fora);
        escolhidos = ids.map((id) => porId.get(id));
        const checagens = [
            [422, ERROS_TAREFA.inativo, (c) => c.ativo],
            [422, ERROS_TAREFA.destinatarios, ehConsultor],
            [403, ERROS_TAREFA.promotor, podeTipo],
            [422, ERROS_TAREFA.cliente, temCliente],
        ];
        for (const [status, codigo, passa] of checagens) {
            const falham = escolhidos.filter((c) => !passa(c));
            if (falham.length)
                return recusa(status, codigo, falham.map((c) => c.id));
        }
    }
    else {
        const destino = e.destino;
        const daEquipe = (c) => destino.alvo === 'todos' || c.equipe_id === destino.equipe_id;
        escolhidos = e.visiveis.filter((c) => daEquipe(c) && c.ativo && ehConsultor(c) && podeTipo(c) && temCliente(c));
    }
    if (e.tipo === 'pesquisa') {
        const naoPodem = escolhidos.filter((c) => !e.podem_responder_pesquisa?.has(c.id));
        if (naoPodem.length)
            return recusa(422, ERROS_TAREFA.pesquisa, naoPodem.map((c) => c.id));
    }
    if (escolhidos.length === 0)
        return recusa(422, ERROS_TAREFA.destinatarioVazio, []);
    if (escolhidos.length > TAREFA_DESTINATARIOS_MAX)
        return recusa(422, ERROS_TAREFA.destinatarios, []);
    return { ok: true, usuario_ids: ordenar(escolhidos.map((c) => c.id)) };
}
