export const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const T0 = '2026-10-31T13:00:00Z';
export const TENANT = u(900);
export const QUEST = u(800);
export const sim_nao = (n, extra = {}) => ({ id: u(n), tipo: 'sim_nao', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra });
export const unica = (n, opcoes = [101, 102, 103], extra = {}) => ({ id: u(n), tipo: 'unica', enunciado: `Pergunta ${n}`, obrigatoria: false, opcoes: opcoes.map((o) => ({ id: u(o), rotulo: `Opção ${o}` })), ...extra });
export const multipla = (n, opcoes = [201, 202, 203], extra = {}) => ({ id: u(n), tipo: 'multipla', enunciado: `Pergunta ${n}`, obrigatoria: false, opcoes: opcoes.map((o) => ({ id: u(o), rotulo: `Opção ${o}` })), ...extra });
export const numero = (n, extra = {}) => ({ id: u(n), tipo: 'numero', enunciado: `Pergunta ${n}`, obrigatoria: false, inteiro: false, ...extra });
export const texto = (n, extra = {}) => ({ id: u(n), tipo: 'texto', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra });
export const escala = (n, extra = {}) => ({ id: u(n), tipo: 'escala', enunciado: `Pergunta ${n}`, obrigatoria: false, minimo: 1, maximo: 5, ...extra });
export const data = (n, extra = {}) => ({ id: u(n), tipo: 'data', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra });
export const foto = (n, extra = {}) => ({ id: u(n), tipo: 'foto', enunciado: `Pergunta ${n}`, obrigatoria: false, min_fotos: 1, max_fotos: 3, ...extra });
export const codigo = (n, extra = {}) => ({ id: u(n), tipo: 'codigo_barras', enunciado: `Pergunta ${n}`, obrigatoria: false, ...extra });
export const regra = (n, alvo, origem, operador, valor, acao = 'mostrar') => {
    const r = { id: u(n), pergunta_id: u(alvo), acao, origem_id: u(origem), operador };
    if (valor !== undefined)
        r.valor = valor;
    return r;
};
export const versao = (extra = {}) => ({
    id: u(700),
    questionario_id: QUEST,
    tenant_id: TENANT,
    numero: 1,
    status: 'rascunho',
    titulo: 'Pesquisa de gôndola',
    modo: 'avulsa',
    frequencia: 'a_cada_visita',
    publico_alvo: { perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] },
    vigencia: { inicio: '2026-10-01T00:00:00Z', fim: null },
    perguntas: [sim_nao(1)],
    regras: [],
    criada_em: '2026-10-01T00:00:00Z',
    publicada_em: null,
    publicada_por: null,
    ...extra,
});
export const publicada = (extra = {}) => versao({ status: 'publicada', publicada_em: '2026-10-02T12:00:00Z', publicada_por: u(1000), ...extra });
export const item = {
    simNao: (n, valor) => ({ pergunta_id: u(n), tipo: 'sim_nao', valor }),
    unica: (n, opcao) => ({ pergunta_id: u(n), tipo: 'unica', opcao_id: u(opcao) }),
    multipla: (n, opcoes) => ({ pergunta_id: u(n), tipo: 'multipla', opcao_ids: opcoes.map(u) }),
    numero: (n, v) => ({ pergunta_id: u(n), tipo: 'numero', numero: v }),
    texto: (n, t) => ({ pergunta_id: u(n), tipo: 'texto', texto: t }),
    escala: (n, v) => ({ pergunta_id: u(n), tipo: 'escala', valor: v }),
    data: (n, d) => ({ pergunta_id: u(n), tipo: 'data', data: d }),
    foto: (n, ids) => ({ pergunta_id: u(n), tipo: 'foto', fotos: ids.map((i) => ({ id: u(i), referencia: `fotos/${i}.jpg`, capturada_em: T0 })) }),
    codigo: (n, c) => ({ pergunta_id: u(n), tipo: 'codigo_barras', codigo: c }),
};
export const envio = (itens, extra = {}) => ({
    id: u(5000),
    questionario_id: QUEST,
    versao_id: u(700),
    cliente_id: null,
    visita_id: null,
    respondida_em: T0,
    itens,
    ...extra,
});
