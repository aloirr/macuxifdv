import { describe, expect, it } from 'vitest';
import type { Vigencia } from '../contracts';
import { avaliarRecebimentoDaResposta, validarResposta } from './resposta';
import { PARAMETROS_PADRAO } from './parametros';
import { codigo, data, envio, escala, foto, item, multipla, numero, publicada, regra, sim_nao, texto, u, unica, versao } from './util-teste';

const codigos = (r: { erros: { codigo: string }[] }) => r.erros.map((e) => e.codigo);

describe('RF-PES-01: validação da resposta contra a versão', () => {
  const v = publicada({
    perguntas: [sim_nao(1, { obrigatoria: true }), texto(2), numero(3, { minimo: 0, obrigatoria: true })],
  });

  it('RF-PES-01: resposta completa e válida passa', () => {
    const r = validarResposta(v, envio([item.simNao(1, true), item.numero(3, 5)]));
    expect(r).toEqual({ valida: true, erros: [], avisos: [] });
  });

  it('RF-PES-01: obrigatória sem resposta é recusada, apontando a pergunta', () => {
    const r = validarResposta(v, envio([item.simNao(1, true)]));
    expect(codigos(r)).toEqual(['OBRIGATORIA']);
    expect(r.erros[0]!.pergunta_id).toBe(u(3));
    expect(r.erros[0]!.mensagem).toMatch(/Responda/);
  });

  it('RF-PES-01: obrigatória com texto em branco conta como não respondida', () => {
    const w = publicada({ perguntas: [texto(1, { obrigatoria: true })] });
    expect(codigos(validarResposta(w, envio([item.texto(1, '   ')])))).toEqual(expect.arrayContaining(['OBRIGATORIA']));
  });

  it('RF-PES-01: pergunta opcional pode ficar sem resposta', () => {
    expect(validarResposta(v, envio([item.simNao(1, false), item.numero(3, 0)])).valida).toBe(true);
  });

  it('RF-PES-01: cada item é validado por tipo (número abaixo do mínimo é recusado)', () => {
    const r = validarResposta(v, envio([item.simNao(1, true), item.numero(3, -1)]));
    expect(codigos(r)).toEqual(['VALOR_FORA_DO_LIMITE']);
  });

  it('RF-PES-01: resposta a pergunta que não existe na versão ou repetida é recusada', () => {
    expect(codigos(validarResposta(v, envio([item.simNao(1, true), item.numero(3, 1), item.simNao(99, true)])))).toEqual(['PERGUNTA_DESCONHECIDA']);
    expect(codigos(validarResposta(v, envio([item.simNao(1, true), item.simNao(1, false), item.numero(3, 1)])))).toEqual(['PERGUNTA_REPETIDA']);
  });

  it('RF-PES-01: resposta sem nenhuma pergunta respondida é recusada (SEM_RESPOSTAS)', () => {
    const w = publicada({ perguntas: [texto(1)] });
    expect(codigos(validarResposta(w, envio([item.texto(1, ' ')])))).toEqual(['SEM_RESPOSTAS']);
  });

  it('RF-PES-01: todos os nove tipos de pergunta numa mesma resposta', () => {
    const w = publicada({
      perguntas: [sim_nao(1), unica(2), multipla(3), numero(4), texto(5), escala(6), data(7), foto(8), codigo(9)],
    });
    const r = validarResposta(
      w,
      envio([item.simNao(1, true), item.unica(2, 101), item.multipla(3, [201, 202]), item.numero(4, 3), item.texto(5, 'ok'), item.escala(6, 4), item.data(7, '2026-10-31'), item.foto(8, [10]), item.codigo(9, '4006381333931')]),
    );
    expect(r).toEqual({ valida: true, erros: [], avisos: [] });
  });
});

describe('RF-PES-01: obrigatória oculta não é exigida', () => {
  const v = publicada({
    perguntas: [sim_nao(1), texto(2, { obrigatoria: true })],
    regras: [regra(10, 2, 1, 'igual', true)],
  });

  it('RF-PES-01: "se X = sim, mostrar Y (obrigatória)": com X = não, Y oculta não é exigida', () => {
    expect(validarResposta(v, envio([item.simNao(1, false)])).valida).toBe(true);
  });

  it('RF-PES-01: com X = sim, Y aparece e passa a ser exigida', () => {
    const r = validarResposta(v, envio([item.simNao(1, true)]));
    expect(codigos(r)).toEqual(['OBRIGATORIA']);
    expect(validarResposta(v, envio([item.simNao(1, true), item.texto(2, 'detalhe')])).valida).toBe(true);
  });

  it('RF-PES-01: resposta guardada para pergunta que está oculta é recusada (PERGUNTA_OCULTA)', () => {
    const r = validarResposta(v, envio([item.simNao(1, false), item.texto(2, 'sobrou')]));
    expect(codigos(r)).toEqual(['PERGUNTA_OCULTA']);
  });
});

describe('RF-PES-04: rascunho salvo automaticamente', () => {
  it('RF-PES-04: em rascunho a obrigatoriedade não é exigida, mas o que foi preenchido é validado', () => {
    const v = publicada({ perguntas: [sim_nao(1, { obrigatoria: true }), numero(2, { minimo: 0 })] });
    expect(validarResposta(v, envio([item.numero(2, 1)]), { modo: 'rascunho' }).valida).toBe(true);
    expect(codigos(validarResposta(v, envio([item.numero(2, -1)]), { modo: 'rascunho' }))).toEqual(['VALOR_FORA_DO_LIMITE']);
  });
});

describe('RN-PES-01: resposta é validada contra a versão que ela cita', () => {
  const v1 = publicada({ numero: 1, perguntas: [sim_nao(1, { obrigatoria: true })] });
  const v2 = publicada({ id: u(701), numero: 2, perguntas: [sim_nao(1, { obrigatoria: true }), texto(2, { obrigatoria: true })] });

  it('RN-PES-01: resposta da v1 continua válida depois que a v2 foi publicada (a v2 exige mais, a v1 não)', () => {
    expect(validarResposta(v1, envio([item.simNao(1, true)])).valida).toBe(true);
    expect(codigos(validarResposta(v2, envio([item.simNao(1, true)], { versao_id: u(701) })))).toEqual(['OBRIGATORIA']);
  });

  it('RN-PES-01: resposta que cita a v1 não pode ser conferida contra a v2', () => {
    expect(codigos(validarResposta(v2, envio([item.simNao(1, true)])))).toEqual(['VERSAO_INEXISTENTE']);
  });

  it('RN-PES-01: resposta a rascunho é recusada', () => {
    expect(codigos(validarResposta(versao(), envio([item.simNao(1, true)])))).toEqual(['VERSAO_NAO_PUBLICADA']);
  });

  it('RN-PES-01: pergunta que existia só na v1 é aceita na resposta da v1', () => {
    const antiga = publicada({ numero: 1, perguntas: [sim_nao(1), texto(5)] });
    expect(validarResposta(antiga, envio([item.simNao(1, true), item.texto(5, 'x')])).valida).toBe(true);
  });
});

describe('RN-PES-04: hora do aparelho x vigência — aceita e sinaliza, nunca recusa', () => {
  const vig: Vigencia = { inicio: '2026-10-01T04:00:00Z', fim: '2026-10-31T03:59:59Z' };
  const tol = PARAMETROS_PADRAO.tolerancia_vigencia_h;
  const av = (respondida_em: string, recebida_em: string, v = vig, t = tol) => avaliarRecebimentoDaResposta(v, { respondida_em, recebida_em }, t);

  it('RN-PES-04: resposta feita no aparelho dentro da vigência, mesmo recebida depois, não é suspeita', () => {
    expect(av('2026-10-30T20:00:00Z', '2026-11-05T10:00:00Z')).toEqual({ aceita: true, suspeita: false, motivos: [], mensagem: null });
  });

  it('RN-PES-04: até 24 h depois do fim ainda vale (tolerância); passou disso é ACEITA com suspeita APOS_A_VIGENCIA', () => {
    expect(av('2026-11-01T03:59:59Z', '2026-11-01T04:00:00Z').suspeita).toBe(false);
    const r = av('2026-11-01T04:00:00Z', '2026-11-01T05:00:00Z');
    expect(r).toMatchObject({ aceita: true, suspeita: true, motivos: ['APOS_A_VIGENCIA'] });
    expect(r.mensagem).toMatch(/vigência/);
  });

  it('RN-PES-04: antes do início vale a mesma tolerância; além dela é aceita com suspeita ANTES_DA_VIGENCIA', () => {
    expect(av('2026-09-30T04:00:00Z', '2026-10-02T00:00:00Z').suspeita).toBe(false);
    expect(av('2026-09-30T03:59:59Z', '2026-10-02T00:00:00Z')).toMatchObject({ aceita: true, suspeita: true, motivos: ['ANTES_DA_VIGENCIA'] });
  });

  it('RN-PES-04: vigência sem fim nunca expira', () => {
    expect(av('2030-01-01T00:00:00Z', '2030-01-01T00:00:01Z', { inicio: vig.inicio, fim: null }).suspeita).toBe(false);
  });

  it('RN-PES-04: relógio adiantado mais de 24 h em relação ao servidor é ACEITO com suspeita RELOGIO_ADIANTADO (nunca recusado)', () => {
    const sem = { inicio: vig.inicio, fim: null };
    expect(av('2026-10-20T12:00:00Z', '2026-10-18T11:59:59Z', sem)).toMatchObject({ aceita: true, suspeita: true, motivos: ['RELOGIO_ADIANTADO'] });
    expect(av('2026-10-19T12:00:00Z', '2026-10-18T12:00:00Z', sem).suspeita).toBe(false);
  });

  it('RN-PES-04: relógio adiantado e fora da vigência ao mesmo tempo acumulam os dois motivos', () => {
    const r = av('2026-12-20T12:00:00Z', '2026-10-18T12:00:00Z');
    expect(r.aceita).toBe(true);
    expect(r.motivos).toEqual(['RELOGIO_ADIANTADO', 'APOS_A_VIGENCIA']);
  });

  it('RN-PES-04: a tolerância é parâmetro do tenant (0 = exatamente o fim da vigência)', () => {
    expect(av('2026-10-31T04:00:00Z', '2026-10-31T05:00:00Z', vig, 0).suspeita).toBe(true);
    expect(av('2026-10-31T03:59:59Z', '2026-10-31T05:00:00Z', vig, 0).suspeita).toBe(false);
  });
});

describe('RN-PES-06: validarResposta devolve aviso (não erro) para GS1 inválido', () => {
  it('RN-PES-06: resposta com código de dígito errado continua válida e traz o aviso', () => {
    const v = publicada({ perguntas: [codigo(1)] });
    const r = validarResposta(v, envio([item.codigo(1, '4006381333932')]));
    expect(r.valida).toBe(true);
    expect(r.avisos.map((a) => a.codigo)).toEqual(['CODIGO_GS1_INVALIDO']);
  });
});
