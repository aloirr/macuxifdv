function canonicoDoItem(i) {
    switch (i.tipo) {
        case 'multipla':
            return { ...i, opcao_ids: [...i.opcao_ids].sort() };
        case 'foto':
            return { ...i, fotos: [...i.fotos].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
        default:
            return i;
    }
}
/** Mesma hora, mesma grafia: o banco devolve milissegundos (`.000Z`) e o aparelho pode ter enviado sem eles. */
function instanteCanonico(iso) {
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? iso : new Date(ms).toISOString();
}
function ordenarChaves(v) {
    if (Array.isArray(v))
        return v.map(ordenarChaves);
    if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, ordenarChaves(x)]));
    }
    return v;
}
/** Texto canônico do conteúdo: ignora a ordem dos itens, das opções e das fotos, e campos do servidor. */
export function impressaoDaResposta(r) {
    const itens = [...r.itens].sort((a, b) => (a.pergunta_id < b.pergunta_id ? -1 : a.pergunta_id > b.pergunta_id ? 1 : 0)).map(canonicoDoItem);
    return JSON.stringify(ordenarChaves({
        id: r.id,
        questionario_id: r.questionario_id,
        versao_id: r.versao_id,
        cliente_id: r.cliente_id ?? null,
        visita_id: r.visita_id ?? null,
        respondida_em: instanteCanonico(r.respondida_em),
        itens,
    }));
}
/** RF-PES-04: o que fazer ao receber `nova` quando já existe (ou não) uma resposta com o mesmo id. */
export function decidirInsercao(existente, nova) {
    if (!existente)
        return { resultado: 'inserir' };
    if (impressaoDaResposta(existente) === impressaoDaResposta(nova))
        return { resultado: 'duplicada' };
    return {
        resultado: 'conflito',
        codigo: 'CONFLITO_DE_CONTEUDO',
        mensagem: 'Uma resposta com este código já foi recebida com conteúdo diferente. Respostas não podem ser alteradas: refaça a pesquisa para gerar uma nova.',
    };
}
/** RF-PES-04: processa um lote da outbox na ordem recebida; o mesmo id repetido no lote vale uma vez só. */
export function processarLote(existentes, lote) {
    const gravadas = new Map();
    for (const e of existentes)
        gravadas.set(e.id, e);
    return lote.map((nova) => {
        const d = decidirInsercao(gravadas.get(nova.id), nova);
        if (d.resultado === 'inserir')
            gravadas.set(nova.id, nova);
        return { id: nova.id, ...d };
    });
}
