export const PERFIS_EM_NOME = ['supervisor', 'gerente'];
/** Só é "em nome" quando o dono informado é outra pessoa; igual ao autor (ou ausente) segue o fluxo comum. */
export function ehPedidoEmNome(autorId, vendedorId) {
    return Boolean(vendedorId) && vendedorId !== autorId;
}
/** `null` = pode. Ordem: promotor → perfil do autor → dono válido → escopo (D-187-01). */
export function verificarPedidoEmNome(e) {
    if (e.autor.perfil === 'promotor')
        return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
    if (!PERFIS_EM_NOME.includes(e.autor.perfil)) {
        return { codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não faz pedido em nome de vendedor.' };
    }
    if (e.vendedor?.perfil === 'promotor') {
        return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não faz pedido. Escolha um vendedor.' };
    }
    // D-187-01: o dono precisa existir (e ser vendedor) antes de se falar em equipe
    if (!e.vendedor || e.vendedor.perfil !== 'vendedor') {
        return { codigo: 'VENDEDOR_INVALIDO', http: 422, mensagem: 'Vendedor não encontrado ou inativo. Escolha outro vendedor da equipe.' };
    }
    if (e.visiveis !== 'tenant' && !e.visiveis.has(e.vendedor_id)) {
        // T-0187: texto único da tela e da API ("Vendedor fora da sua equipe"); o rascunho fica no aparelho para escolher outro
        const lugar = e.autor.perfil === 'gerente' ? 'da sua área' : 'da sua equipe';
        return { codigo: 'FORA_DA_EQUIPE', http: 403, mensagem: `Vendedor fora ${lugar}` };
    }
    return null;
}
/** RN-VEN-10: % de desconto que o autor aprova sozinho. Supervisor e gerente usam a própria alçada; o resto, a do vendedor. */
export function alcadaDoAutorPct(perfil, p) {
    if (perfil === 'supervisor')
        return p.supervisor_pct;
    if (perfil === 'gerente')
        return p.manager_pct;
    return p.seller_pct;
}
/**
 * RN-VEN-10: política para validar o pedido do gestor. A "alçada do vendedor" vira a do autor e as exceções individuais
 * saem (são do vendedor, não do gestor). Acima dela o pedido sobe ao nível seguinte, como em qualquer pedido.
 */
export function politicaDoAutor(policy, perfil) {
    return { ...policy, seller_pct: alcadaDoAutorPct(perfil, policy), exceptions: {} };
}
/** RN-VEN-35: rótulo do voltar do Novo pedido; em nome ele é aberto pela ficha do vendedor (Gestão). */
export function rotuloVoltarNovoPedido(vendedorId) {
    return vendedorId ? 'Ficha' : 'Pedidos';
}
/**
 * RN-VEN-35: quem aparece como vendedor no PDF. Em nome, é o dono (nunca o gestor) e o gestor sai em "feito por".
 * Sem o nome do dono no aparelho fica vazio até o pull trazer o pedido do servidor.
 */
export function vendedorDoPdf(e) {
    if (!e.em_nome)
        return { seller_name: e.autor_nome };
    return { seller_name: e.dono_nome, ...(e.autor_nome ? { made_by: e.autor_nome } : {}) };
}
/**
 * RN-VEN-35 e RN-CORE-04: o vendedor padrão do "Em nome de" é o ÚNICO vendedor ativo da equipe com o cliente na carteira.
 * Zero ou mais de um: `null` (o campo vem vazio, "Escolher"). Promotor nunca é dono de pedido (RN-PRO-01).
 */
export function vendedorPadraoEmNome(e) {
    const donos = new Set(e.carteira.filter((c) => c.cliente_id === e.clienteId).map((c) => c.usuario_id));
    const candidatos = e.equipe.filter((u) => u.perfil === 'vendedor' && u.ativo && donos.has(u.id));
    return candidatos.length === 1 ? candidatos[0].id : null;
}
/**
 * RN-PRO-01, RN-CORE-04 (T-0187 critérios 13 e 14): a equipe do "Em nome de" a partir das contribuições do slot `pedido.equipe_em_nome`,
 * que já trazem só o escopo de quem está logado. Ficam só os vendedores (promotor e demais perfis fora, RN-PRO-01) e nunca o próprio autor.
 * O inativo segue na lista (vira "Saiu da equipe"). Para o gerente, `grupo` é o nome da equipe; para o supervisor, `null`.
 * Sem contribuição (Campo ou Gestor desligado): lista vazia.
 */
export function equipeEmNomeDosMembros(e) {
    return e.membros
        .filter((m) => m.perfil === 'vendedor' && m.usuario_id !== e.autor.id)
        .map((m) => ({ id: m.usuario_id, nome: m.nome, ativo: m.ativo, perfil: 'vendedor', grupo: e.autor.perfil === 'gerente' ? m.equipe_nome : null }));
}
/** Lista vazia (cache da equipe ainda vazio): a linha única, com a ação. */
export const MSG_SEM_VENDEDORES_EM_NOME = 'Nenhum vendedor na lista. Sincronize e tente de novo.';
/**
 * RN-VEN-35 (P3 A): as opções do "Em nome de" a partir da equipe já filtrada por `equipeEmNomeDosMembros` (RN-CORE-04, RN-PRO-01),
 * em ordem alfabética (por equipe e depois por nome, para o gerente). Vendedor inativo aparece desligado, com "Saiu da equipe".
 * `da_carteira` marca "Carteira deste cliente".
 */
export function opcoesEmNome(e) {
    const donos = new Set(e.carteira.filter((c) => c.cliente_id === e.clienteId).map((c) => c.usuario_id));
    return e.usuarios
        .map((u) => ({ id: u.id, nome: u.nome, da_carteira: donos.has(u.id), desligado: !u.ativo, motivo: u.ativo ? null : 'Saiu da equipe', grupo: u.grupo ?? null }))
        .sort((a, b) => (a.grupo ?? '').localeCompare(b.grupo ?? '', 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'));
}
export const MSG_APROVACAO_DO_PROPRIO_PEDIDO = 'Você fez este pedido e não pode aprová-lo. Peça a decisão ao nível acima.';
/**
 * RN-VEN-10 e T-0187 P4 A: ninguém decide a aprovação do próprio pedido. O autor é `autor_id`; pedido sem ele
 * (feito pelo próprio vendedor) tem o dono (`vendedor_id`) como autor.
 */
export function decisorEhAutor(pedido, decisorId) {
    return (pedido.autor_id ?? pedido.vendedor_id) === decisorId;
}
