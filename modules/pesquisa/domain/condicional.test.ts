import { describe, expect, it } from 'vitest';
import { avaliarCondicao, calcularVisiveis, descartarRespostasOcultas, perguntasVisiveis, validarRegras } from './condicional';
import { codigo, data, escala, foto, item, multipla, numero, regra, sim_nao, texto, u, unica } from './util-teste';

const cods = (ps: { codigo: string }[]) => ps.map((p) => p.codigo);

describe('RF-PES-01: regras condicionais — referência só para pergunta anterior', () => {
  const perguntas = [sim_nao(1), sim_nao(2), sim_nao(3)];

  it('RF-PES-01: regra que olha uma pergunta anterior é aceita', () => {
    const r = validarRegras(perguntas, [regra(10, 3, 1, 'igual', true)]);
    expect(r.erros).toEqual([]);
  });

  it('RF-PES-01: regra que olha uma pergunta POSTERIOR é recusada (REGRA_ORIGEM_NAO_ANTERIOR)', () => {
    const r = validarRegras(perguntas, [regra(10, 1, 3, 'igual', true)]);
    expect(cods(r.erros)).toContain('REGRA_ORIGEM_NAO_ANTERIOR');
    expect(r.erros[0]!.mensagem).toMatch(/anterior/);
  });

  it('RF-PES-01: pergunta que depende de si mesma é ciclo', () => {
    const r = validarRegras(perguntas, [regra(10, 2, 2, 'igual', true)]);
    expect(cods(r.erros)).toContain('REGRA_CICLO');
  });

  it('RF-PES-01: origem ou alvo inexistente é recusado', () => {
    expect(cods(validarRegras(perguntas, [regra(10, 3, 99, 'igual', true)]).erros)).toEqual(['REGRA_ORIGEM_INEXISTENTE']);
    expect(cods(validarRegras(perguntas, [regra(10, 99, 1, 'igual', true)]).erros)).toEqual(['REGRA_ALVO_INEXISTENTE']);
  });
});

describe('RF-PES-01: detecção de ciclo', () => {
  it('RF-PES-01: A depende de B e B depende de A é ciclo, e a mensagem mostra o caminho', () => {
    const ps = [sim_nao(1), sim_nao(2)];
    const r = validarRegras(ps, [regra(10, 1, 2, 'igual', true), regra(11, 2, 1, 'igual', true)]);
    const ciclo = r.erros.filter((e) => e.codigo === 'REGRA_CICLO');
    expect(ciclo).toHaveLength(1);
    expect(ciclo[0]!.mensagem).toMatch(/Pergunta 1.*Pergunta 2.*Pergunta 1|Pergunta 2.*Pergunta 1.*Pergunta 2/);
  });

  it('RF-PES-01: ciclo de três perguntas é achado uma vez só', () => {
    const ps = [sim_nao(1), sim_nao(2), sim_nao(3)];
    const r = validarRegras(ps, [regra(10, 1, 2, 'igual', true), regra(11, 2, 3, 'igual', true), regra(12, 3, 1, 'igual', true)]);
    expect(r.erros.filter((e) => e.codigo === 'REGRA_CICLO')).toHaveLength(1);
  });

  it('RF-PES-01: cadeia sem volta (3 depende de 2, que depende de 1) não é ciclo', () => {
    const ps = [sim_nao(1), sim_nao(2), sim_nao(3)];
    const r = validarRegras(ps, [regra(10, 2, 1, 'igual', true), regra(11, 3, 2, 'igual', true)]);
    expect(r.erros).toEqual([]);
  });
});

describe('RF-PES-01: operador e valor combinam com o tipo da pergunta de origem', () => {
  it('RF-PES-01: "contém" só vale para múltipla escolha; "maior que" só para número, escala e data', () => {
    const ps = [sim_nao(1), multipla(2), unica(3), foto(4), texto(5), sim_nao(9)];
    expect(cods(validarRegras(ps, [regra(10, 9, 1, 'contem', 'x')]).erros)).toEqual(['REGRA_OPERADOR_INVALIDO']);
    expect(cods(validarRegras(ps, [regra(10, 9, 3, 'maior_que', 1)]).erros)).toEqual(['REGRA_OPERADOR_INVALIDO']);
    expect(cods(validarRegras(ps, [regra(10, 9, 4, 'igual', 'x')]).erros)).toEqual(['REGRA_OPERADOR_INVALIDO']);
    expect(validarRegras(ps, [regra(10, 9, 2, 'contem', u(201))]).erros).toEqual([]);
    expect(validarRegras(ps, [regra(11, 9, 4, 'respondida')]).erros).toEqual([]);
  });

  it('RF-PES-01: o valor precisa ser do tipo certo; opção precisa existir na pergunta de origem', () => {
    const ps = [sim_nao(1), unica(2, [101, 102]), escala(3), data(4), sim_nao(9)];
    expect(cods(validarRegras(ps, [regra(10, 9, 1, 'igual', 'sim')]).erros)).toEqual(['REGRA_VALOR_INVALIDO']);
    expect(cods(validarRegras(ps, [regra(10, 9, 2, 'igual', u(555))]).erros)).toEqual(['REGRA_VALOR_INVALIDO']);
    expect(validarRegras(ps, [regra(10, 9, 2, 'igual', u(102))]).erros).toEqual([]);
    expect(cods(validarRegras(ps, [regra(10, 9, 3, 'menor_que', 'dois')]).erros)).toEqual(['REGRA_VALOR_INVALIDO']);
    expect(cods(validarRegras(ps, [regra(10, 9, 4, 'igual', '2026-02-30')]).erros)).toEqual(['REGRA_VALOR_INVALIDO']);
  });
});

describe('RF-PES-01: aviso de pergunta inalcançável', () => {
  it('RF-PES-01: "mostrar se escala = 7" numa escala de 1 a 5 nunca acontece — aviso', () => {
    const ps = [escala(1), sim_nao(2)];
    const r = validarRegras(ps, [regra(10, 2, 1, 'igual', 7)]);
    expect(r.erros).toEqual([]);
    expect(cods(r.avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
    expect(r.avisos[0]!.pergunta_id).toBe(u(2));
  });

  it('RF-PES-01: limites de comparação — "maior que 5" na escala 1..5 nunca; "maior ou igual a 5" pode', () => {
    const ps = [escala(1), sim_nao(2), sim_nao(3)];
    expect(cods(validarRegras(ps, [regra(10, 2, 1, 'maior_que', 5)]).avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
    expect(validarRegras(ps, [regra(10, 3, 1, 'maior_ou_igual', 5)]).avisos).toEqual([]);
    expect(cods(validarRegras(ps, [regra(10, 2, 1, 'menor_que', 1)]).avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
  });

  it('RF-PES-01: número com faixa 0..100 — "igual a 150" é inalcançável; sem faixa, qualquer valor serve', () => {
    const ps = [numero(1, { minimo: 0, maximo: 100 }), numero(2), sim_nao(3), sim_nao(4)];
    expect(cods(validarRegras(ps, [regra(10, 3, 1, 'igual', 150)]).avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
    expect(validarRegras(ps, [regra(10, 4, 2, 'igual', 150)]).avisos).toEqual([]);
  });

  it('RF-PES-01: "mostrar se não respondida" sobre pergunta obrigatória sempre visível nunca acontece', () => {
    const ps = [sim_nao(1, { obrigatoria: true }), sim_nao(2)];
    expect(cods(validarRegras(ps, [regra(10, 2, 1, 'nao_respondida')]).avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
  });

  it('RF-PES-01: a inalcançabilidade se propaga — quem depende de pergunta inalcançável também é', () => {
    const ps = [escala(1), sim_nao(2), sim_nao(3)];
    const r = validarRegras(ps, [regra(10, 2, 1, 'igual', 7), regra(11, 3, 2, 'igual', true)]);
    expect(r.avisos.map((a) => a.pergunta_id)).toEqual([u(2), u(3)]);
  });

  it('RF-PES-01: "ocultar se respondida" sobre obrigatória sempre visível deixa a pergunta sempre oculta', () => {
    const ps = [sim_nao(1, { obrigatoria: true }), sim_nao(2)];
    const r = validarRegras(ps, [regra(10, 2, 1, 'respondida', undefined, 'ocultar')]);
    expect(cods(r.avisos)).toEqual(['PERGUNTA_INALCANCAVEL']);
  });

  it('RF-PES-01: com duas regras "mostrar" basta uma ser possível', () => {
    const ps = [escala(1), sim_nao(2), sim_nao(3)];
    const r = validarRegras(ps, [regra(10, 3, 1, 'igual', 7), regra(11, 3, 2, 'igual', true)]);
    expect(r.avisos).toEqual([]);
  });
});

describe('RF-PES-01: perguntas visíveis dado um conjunto de respostas', () => {
  const ps = [sim_nao(1), texto(2), sim_nao(3), unica(4), numero(5)];

  it('RF-PES-01: sem regra, toda pergunta é visível', () => {
    expect(perguntasVisiveis(ps, [], []).map((p) => p.id)).toEqual(ps.map((p) => p.id));
  });

  it('RF-PES-01: "se X = sim, mostrar Y" — Y só aparece com X = sim', () => {
    const rs = [regra(10, 2, 1, 'igual', true)];
    expect(perguntasVisiveis(ps, rs, []).map((p) => p.id)).not.toContain(u(2));
    expect(perguntasVisiveis(ps, rs, [item.simNao(1, false)]).map((p) => p.id)).not.toContain(u(2));
    expect(perguntasVisiveis(ps, rs, [item.simNao(1, true)]).map((p) => p.id)).toContain(u(2));
  });

  it('RF-PES-01: "se X = não, pular Y" (ocultar) — Y some com X = não e volta se X mudar', () => {
    const rs = [regra(10, 3, 1, 'igual', false, 'ocultar')];
    expect(perguntasVisiveis(ps, rs, [item.simNao(1, false)]).map((p) => p.id)).not.toContain(u(3));
    expect(perguntasVisiveis(ps, rs, [item.simNao(1, true)]).map((p) => p.id)).toContain(u(3));
    expect(perguntasVisiveis(ps, rs, []).map((p) => p.id)).toContain(u(3));
  });

  it('RF-PES-01: vários "mostrar" na mesma pergunta valem com OU; "ocultar" vence o "mostrar"', () => {
    const rs = [regra(10, 5, 1, 'igual', true), regra(11, 5, 3, 'igual', true)];
    expect(perguntasVisiveis(ps, rs, [item.simNao(3, true)]).map((p) => p.id)).toContain(u(5));
    const rs2 = [...rs, regra(12, 5, 2, 'respondida', undefined, 'ocultar')];
    expect(perguntasVisiveis(ps, rs2, [item.simNao(1, true), item.texto(2, 'x')]).map((p) => p.id)).not.toContain(u(5));
  });

  it('RF-PES-01: pergunta oculta não alimenta regras de outras (cascata)', () => {
    const rs = [regra(10, 2, 1, 'igual', true), regra(11, 3, 2, 'respondida')];
    // Y (2) respondida, mas X (1) = não deixa Y oculta; então Z (3) também fica oculta
    const v = calcularVisiveis(ps, rs, [item.simNao(1, false), item.texto(2, 'resto')]);
    expect(v.find((x) => x.pergunta_id === u(2))!.visivel).toBe(false);
    expect(v.find((x) => x.pergunta_id === u(3))!.visivel).toBe(false);
  });

  it('RF-PES-01: descartarRespostasOcultas remove a resposta de pergunta que ficou oculta', () => {
    const rs = [regra(10, 2, 1, 'igual', true)];
    const itens = [item.simNao(1, false), item.texto(2, 'sobrou')];
    expect(descartarRespostasOcultas(ps, rs, itens)).toEqual([item.simNao(1, false)]);
  });
});

describe('RF-PES-01: avaliação de cada operador', () => {
  it('RF-PES-01: sim/não e única (igual, diferente)', () => {
    expect(avaliarCondicao(sim_nao(1), item.simNao(1, true), regra(1, 2, 1, 'igual', true))).toBe(true);
    expect(avaliarCondicao(sim_nao(1), item.simNao(1, true), regra(1, 2, 1, 'diferente', true))).toBe(false);
    expect(avaliarCondicao(unica(1), item.unica(1, 102), regra(1, 2, 1, 'igual', u(102)))).toBe(true);
    expect(avaliarCondicao(unica(1), item.unica(1, 102), regra(1, 2, 1, 'diferente', u(101)))).toBe(true);
  });

  it('RF-PES-01: múltipla (contém, não contém)', () => {
    const p = multipla(1);
    expect(avaliarCondicao(p, item.multipla(1, [201, 202]), regra(1, 2, 1, 'contem', u(202)))).toBe(true);
    expect(avaliarCondicao(p, item.multipla(1, [201]), regra(1, 2, 1, 'contem', u(202)))).toBe(false);
    expect(avaliarCondicao(p, item.multipla(1, [201]), regra(1, 2, 1, 'nao_contem', u(202)))).toBe(true);
  });

  it('RF-PES-01: número e escala (comparações inclusivas e exclusivas)', () => {
    const p = numero(1);
    const it = item.numero(1, 10);
    expect(avaliarCondicao(p, it, regra(1, 2, 1, 'maior_que', 10))).toBe(false);
    expect(avaliarCondicao(p, it, regra(1, 2, 1, 'maior_ou_igual', 10))).toBe(true);
    expect(avaliarCondicao(p, it, regra(1, 2, 1, 'menor_que', 11))).toBe(true);
    expect(avaliarCondicao(p, it, regra(1, 2, 1, 'menor_ou_igual', 9))).toBe(false);
    expect(avaliarCondicao(escala(1), item.escala(1, 2), regra(1, 2, 1, 'menor_ou_igual', 2))).toBe(true);
  });

  it('RF-PES-01: data compara como texto ISO; texto e código comparam sem maiúsculas/espaços nas pontas', () => {
    expect(avaliarCondicao(data(1), item.data(1, '2026-10-31'), regra(1, 2, 1, 'maior_que', '2026-10-30'))).toBe(true);
    expect(avaliarCondicao(texto(1), item.texto(1, '  Sim '), regra(1, 2, 1, 'igual', 'sim'))).toBe(true);
    expect(avaliarCondicao(codigo(1), item.codigo(1, 'ABC123'), regra(1, 2, 1, 'igual', 'abc123'))).toBe(true);
  });

  it('RF-PES-01: sem resposta, só "não respondida" é verdadeira (comparações são falsas)', () => {
    expect(avaliarCondicao(sim_nao(1), undefined, regra(1, 2, 1, 'nao_respondida'))).toBe(true);
    expect(avaliarCondicao(sim_nao(1), undefined, regra(1, 2, 1, 'respondida'))).toBe(false);
    expect(avaliarCondicao(sim_nao(1), undefined, regra(1, 2, 1, 'diferente', true))).toBe(false);
    expect(avaliarCondicao(multipla(1), undefined, regra(1, 2, 1, 'nao_contem', u(201)))).toBe(false);
  });

  it('RF-PES-04: item em branco conta como sem resposta', () => {
    expect(avaliarCondicao(texto(1), item.texto(1, '  '), regra(1, 2, 1, 'respondida'))).toBe(false);
  });
});
