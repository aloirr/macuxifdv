import { describe, expect, it } from 'vitest';
import {
  EVENTOS_PESQUISA,
  FiltroResultado,
  ItemResposta,
  ParametrosPesquisaSchema,
  Pergunta,
  PublicoAlvo,
  QuestionarioVersao,
  RegraCondicional,
  RespostaEnvio,
  RespostaPesquisa,
  RespostaRegistradaV1,
  ResultadoPesquisa,
  Vigencia,
} from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';
const opcoes = [{ id: u(101), rotulo: 'A' }, { id: u(102), rotulo: 'B' }];

describe('contratos da Pesquisa: ids e datas', () => {
  const envio = { id: u(1), questionario_id: u(2), versao_id: u(3), respondida_em: T0, itens: [{ pergunta_id: u(4), tipo: 'sim_nao', valor: true }] };

  it('RF-PES-04: o id da resposta é UUID gerado no aparelho', () => {
    expect(RespostaEnvio.safeParse(envio).success).toBe(true);
    expect(RespostaEnvio.safeParse({ ...envio, id: '123' }).success).toBe(false);
  });

  it('RN-PES-04: a hora do aparelho é ISO UTC (com Z)', () => {
    expect(RespostaEnvio.safeParse({ ...envio, respondida_em: '31/10/2026 13:00' }).success).toBe(false);
    expect(RespostaEnvio.safeParse({ ...envio, respondida_em: '2026-10-31T13:00:00-04:00' }).success).toBe(false);
  });

  it('RN-PES-01: a resposta cita a versão (versao_id obrigatório)', () => {
    const { versao_id: _v, ...semVersao } = envio;
    expect(RespostaEnvio.safeParse(semVersao).success).toBe(false);
  });

  it('RF-PES-04: o envio do aparelho não carrega tenant nem usuário; a resposta gravada carrega e guarda a hora de recebimento', () => {
    expect(RespostaEnvio.safeParse({ ...envio, tenant_id: u(9) }).success).toBe(false);
    const gravada = { ...envio, tenant_id: u(9), usuario_id: u(8), equipe_id: null, recebida_em: '2026-10-31T14:00:00Z' };
    expect(RespostaPesquisa.safeParse(gravada).success).toBe(true);
    expect(RespostaPesquisa.safeParse({ ...gravada, recebida_em: undefined }).success).toBe(false);
  });

  it('RF-PES-04: resposta sem item nenhum é recusada', () => {
    expect(RespostaEnvio.safeParse({ ...envio, itens: [] }).success).toBe(false);
  });
});

describe('RF-PES-01: pergunta (união discriminada por tipo)', () => {
  const base = { id: u(1), enunciado: 'Tem ponto extra?' };

  it('RF-PES-01: aceita os nove tipos do construtor', () => {
    const exemplos = [
      { ...base, tipo: 'sim_nao' },
      { ...base, tipo: 'unica', opcoes },
      { ...base, tipo: 'multipla', opcoes, min_selecoes: 1, max_selecoes: 2 },
      { ...base, tipo: 'numero', minimo: 0, maximo: 10, inteiro: true },
      { ...base, tipo: 'texto', max_caracteres: 200 },
      { ...base, tipo: 'escala', minimo: 1, maximo: 10 },
      { ...base, tipo: 'data', minima: '2026-01-01' },
      { ...base, tipo: 'foto', min_fotos: 1, max_fotos: 3 },
      { ...base, tipo: 'codigo_barras' },
    ];
    for (const e of exemplos) expect(Pergunta.safeParse(e).success, e.tipo).toBe(true);
  });

  it('RF-PES-01: tipo desconhecido é recusado', () => {
    expect(Pergunta.safeParse({ ...base, tipo: 'audio' }).success).toBe(false);
  });

  it('RF-PES-01: padrões — opcional, escala 1 a 5, número não inteiro, foto de 1 a 5', () => {
    expect(Pergunta.parse({ ...base, tipo: 'sim_nao' })).toMatchObject({ obrigatoria: false });
    expect(Pergunta.parse({ ...base, tipo: 'escala' })).toMatchObject({ minimo: 1, maximo: 5 });
    expect(Pergunta.parse({ ...base, tipo: 'numero' })).toMatchObject({ inteiro: false });
    expect(Pergunta.parse({ ...base, tipo: 'foto' })).toMatchObject({ min_fotos: 1, max_fotos: 5 });
  });

  it('RF-PES-01: única/múltipla precisam de 2 opções ou mais, sem id repetido', () => {
    expect(Pergunta.safeParse({ ...base, tipo: 'unica', opcoes: [opcoes[0]] }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'unica', opcoes: [opcoes[0], opcoes[0]] }).success).toBe(false);
  });

  it('RF-PES-01: limites incoerentes são recusados (mínimo > máximo, escala invertida, seleções além das opções, data invertida)', () => {
    expect(Pergunta.safeParse({ ...base, tipo: 'numero', minimo: 5, maximo: 1 }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'escala', minimo: 5, maximo: 5 }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'multipla', opcoes, max_selecoes: 3 }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'multipla', opcoes, min_selecoes: 2, max_selecoes: 1 }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'data', minima: '2026-12-01', maxima: '2026-01-01' }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'foto', min_fotos: 3, max_fotos: 1 }).success).toBe(false);
  });

  it('RF-PES-01: enunciado vazio e campo desconhecido são recusados', () => {
    expect(Pergunta.safeParse({ ...base, enunciado: '  ', tipo: 'sim_nao' }).success).toBe(false);
    expect(Pergunta.safeParse({ ...base, tipo: 'sim_nao', extra: 1 }).success).toBe(false);
  });

  it('RF-PES-01: data mínima precisa existir no calendário', () => {
    expect(Pergunta.safeParse({ ...base, tipo: 'data', minima: '2026-02-30' }).success).toBe(false);
  });
});

describe('RF-PES-01: item de resposta por tipo', () => {
  it('RF-PES-01: cada tipo tem o seu formato de valor', () => {
    const itens = [
      { pergunta_id: u(1), tipo: 'sim_nao', valor: false },
      { pergunta_id: u(1), tipo: 'unica', opcao_id: u(101) },
      { pergunta_id: u(1), tipo: 'multipla', opcao_ids: [u(101)] },
      { pergunta_id: u(1), tipo: 'numero', numero: 12.5 },
      { pergunta_id: u(1), tipo: 'texto', texto: 'ok' },
      { pergunta_id: u(1), tipo: 'escala', valor: 4 },
      { pergunta_id: u(1), tipo: 'data', data: '2026-10-31' },
      { pergunta_id: u(1), tipo: 'foto', fotos: [{ id: u(10), referencia: 'fotos/10.jpg', capturada_em: T0 }] },
      { pergunta_id: u(1), tipo: 'codigo_barras', codigo: '4006381333931' },
    ];
    for (const i of itens) expect(ItemResposta.safeParse(i).success, i.tipo).toBe(true);
  });

  it('RF-PES-01: tipos errados são recusados (número como texto, escala fracionada, data inexistente, NaN)', () => {
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'numero', numero: '10' }).success).toBe(false);
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'escala', valor: 3.5 }).success).toBe(false);
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'data', data: '2026-02-30' }).success).toBe(false);
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'numero', numero: Number.NaN }).success).toBe(false);
  });

  it('RF-PES-01: foto precisa de referência não vazia e hora UTC', () => {
    const f = { id: u(10), referencia: '', capturada_em: T0 };
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'foto', fotos: [f] }).success).toBe(false);
    expect(ItemResposta.safeParse({ pergunta_id: u(1), tipo: 'foto', fotos: [{ ...f, referencia: 'x', capturada_em: '31/10' }] }).success).toBe(false);
  });
});

describe('RF-PES-01: regra condicional', () => {
  const r = { id: u(1), pergunta_id: u(3), acao: 'mostrar', origem_id: u(2), operador: 'igual', valor: true };

  it('RF-PES-01: "se X, mostrar Y" válida', () => {
    expect(RegraCondicional.safeParse(r).success).toBe(true);
  });
  it('RF-PES-01: operador sem valor (respondida) não aceita valor; os demais exigem valor', () => {
    expect(RegraCondicional.safeParse({ ...r, operador: 'respondida' }).success).toBe(false);
    expect(RegraCondicional.safeParse({ ...r, operador: 'respondida', valor: undefined }).success).toBe(true);
    expect(RegraCondicional.safeParse({ ...r, valor: undefined }).success).toBe(false);
  });
  it('RF-PES-01: ação só pode ser mostrar ou ocultar', () => {
    expect(RegraCondicional.safeParse({ ...r, acao: 'pular' }).success).toBe(false);
  });
});

describe('RF-PES-02: público-alvo e vigência', () => {
  it('RF-PES-02: público vazio vira "todos" (listas vazias)', () => {
    expect(PublicoAlvo.parse({})).toEqual({ perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] });
  });
  it('RN-PES-05: "canais" faz parte do público-alvo (T-0115)', () => {
    expect(PublicoAlvo.parse({ canais: ['Tradicional'] }).canais).toEqual(['Tradicional']);
  });
  it('doc 03 §2: só perfis que respondem pesquisa entram no público (analista, assistente e admin não)', () => {
    expect(PublicoAlvo.safeParse({ perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'] }).success).toBe(true);
    expect(PublicoAlvo.safeParse({ perfis: ['analista'] }).success).toBe(false);
  });
  it('RF-PES-02: vigência em UTC; fim não pode ser anterior ao início; fim nulo = sem prazo', () => {
    expect(Vigencia.parse({ inicio: T0 })).toEqual({ inicio: T0, fim: null });
    expect(Vigencia.safeParse({ inicio: T0, fim: '2026-10-30T00:00:00Z' }).success).toBe(false);
    expect(Vigencia.safeParse({ inicio: '2026-10-31', fim: null }).success).toBe(false);
  });
});

describe('RN-PES-01: versão do questionário', () => {
  const v = {
    id: u(1),
    questionario_id: u(2),
    tenant_id: u(3),
    numero: 1,
    status: 'rascunho',
    titulo: 'Gôndola',
    vigencia: { inicio: T0 },
    perguntas: [{ id: u(10), tipo: 'sim_nao', enunciado: 'Tem?' }],
    criada_em: T0,
  };

  it('RN-PES-01: rascunho válido, com padrões (avulsa, a cada visita, sem regras, público aberto)', () => {
    expect(QuestionarioVersao.parse(v)).toMatchObject({ modo: 'avulsa', frequencia: 'a_cada_visita', regras: [], publicada_em: null, publico_alvo: { perfis: [] } });
  });
  it('RN-PES-01: versão publicada precisa de data e autor; rascunho não pode ter', () => {
    expect(QuestionarioVersao.safeParse({ ...v, status: 'publicada' }).success).toBe(false);
    expect(QuestionarioVersao.safeParse({ ...v, status: 'publicada', publicada_em: T0, publicada_por: u(5) }).success).toBe(true);
    expect(QuestionarioVersao.safeParse({ ...v, publicada_em: T0, publicada_por: u(5) }).success).toBe(false);
  });
  it('RN-PES-01: número da versão começa em 1', () => {
    expect(QuestionarioVersao.safeParse({ ...v, numero: 0 }).success).toBe(false);
  });
  it('RF-PES-01: perguntas ou regras com id repetido são recusadas', () => {
    const p = v.perguntas[0];
    expect(QuestionarioVersao.safeParse({ ...v, perguntas: [p, p] }).success).toBe(false);
  });
  it('RF-PES-03: modo só avulsa ou checkout_obrigatoria; RN-PES-02: frequência só as quatro do doc', () => {
    expect(QuestionarioVersao.safeParse({ ...v, modo: 'checkout_obrigatoria', frequencia: 'mensal' }).success).toBe(true);
    expect(QuestionarioVersao.safeParse({ ...v, modo: 'obrigatoria' }).success).toBe(false);
    expect(QuestionarioVersao.safeParse({ ...v, frequencia: 'diaria' }).success).toBe(false);
  });
});

describe('RF-PES-06: resultado e filtro', () => {
  it('RF-PES-06: filtro com período invertido é recusado; datas são civis', () => {
    expect(FiltroResultado.safeParse({ de: '2026-10-31', ate: '2026-10-01' }).success).toBe(false);
    expect(FiltroResultado.safeParse({ de: '2026-10-01', ate: '2026-10-31', equipe_ids: [u(1)] }).success).toBe(true);
    expect(FiltroResultado.safeParse({ de: '01/10/2026' }).success).toBe(false);
  });
  it('RF-PES-06: resultado com percentual fora de 0–100 é recusado', () => {
    const r = { questionario_id: u(1), versao_id: u(2), filtro: {}, total_respostas: 0, ignoradas_outra_versao: 0, base: 'usuario', respondentes_distintos: 0, publico_total: null, taxa_resposta_pct: null, por_pergunta: [] };
    expect(ResultadoPesquisa.safeParse(r).success).toBe(true);
    expect(ResultadoPesquisa.safeParse({ ...r, taxa_resposta_pct: 101 }).success).toBe(false);
  });
});

describe('RN-PES-04: parâmetros do tenant', () => {
  it('RN-PES-04: padrões do doc 03 (tolerância 24 h, fuso America/Manaus)', () => {
    expect(ParametrosPesquisaSchema.parse({})).toMatchObject({ tolerancia_vigencia_h: 24, fuso: 'America/Manaus' });
  });
  it('fuso inexistente e tolerância negativa são recusados', () => {
    expect(ParametrosPesquisaSchema.safeParse({ fuso: 'Marte/Olympus' }).success).toBe(false);
    expect(ParametrosPesquisaSchema.safeParse({ tolerancia_vigencia_h: -1 }).success).toBe(false);
  });
});

describe('doc 02: evento pesquisa.resposta.registrada@1', () => {
  const ev = {
    resposta_id: u(1),
    tenant_id: u(2),
    questionario_id: u(3),
    versao_id: u(4),
    usuario_id: u(5),
    equipe_id: null,
    cliente_id: u(6),
    visita_id: u(7),
    modo: 'checkout_obrigatoria',
    respondida_em: T0,
    recebida_em: '2026-10-31T14:00:00Z',
    total_itens: 3,
  };

  it('payload válido, registrado pelo nome versionado', () => {
    expect(RespostaRegistradaV1.safeParse(ev).success).toBe(true);
    expect(Object.keys(EVENTOS_PESQUISA)).toEqual(['pesquisa.resposta.registrada@1']);
  });
  it('RN-PES-01 / RN-PES-04: o evento traz a versão respondida e as duas horas; sem elas é recusado', () => {
    const { versao_id: _v, ...semVersao } = ev;
    expect(RespostaRegistradaV1.safeParse(semVersao).success).toBe(false);
    expect(RespostaRegistradaV1.safeParse({ ...ev, recebida_em: '31/10' }).success).toBe(false);
  });
  it('LGPD: o payload não carrega o conteúdo das respostas (campo extra recusado)', () => {
    expect(RespostaRegistradaV1.safeParse({ ...ev, itens: [] }).success).toBe(false);
  });
});
