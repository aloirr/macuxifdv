import { describe, expect, it } from 'vitest';
import { validarResposta, validarVigenciaDaResposta } from './resposta';
import { PARAMETROS_PADRAO } from './parametros';
import { codigo, data, envio, escala, foto, item, multipla, numero, publicada, regra, sim_nao, texto, u, unica, versao } from './util-teste';

const codigos = (r: { erros: { codigo: string }[] }) => r.erros.map((e) => e.codigo);

describe('RF-PES-01: validação da resposta contra a versão', () => {
  const v = publicada({
    perguntas: [sim_nao(1, { obrigatoria: true }), texto(2), numero(3, { minimo: 0, obrigatoria: true })],
  });

  it('RF-PES-01: resposta completa e válida passa', () => {
    const r = validarResposta(v, envio([item.simNao(1, true), item.numero(3, 5)]));
    expect(r).toEqual({ valida: true, erros: [] });
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
    expect(r).toEqual({ valida: true, erros: [] });
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

describe('RN-PES-04: vigência pela hora do aparelho, com tolerância', () => {
  const vig = { inicio: '2026-10-01T04:00:00Z', fim: '2026-10-31T03:59:59Z' };
  const tol = PARAMETROS_PADRAO.tolerancia_vigencia_h;

  it('RN-PES-04: resposta feita no aparelho dentro da vigência é aceita, mesmo recebida depois', () => {
    const r = validarVigenciaDaResposta(vig, { respondida_em: '2026-10-30T20:00:00Z', recebida_em: '2026-11-05T10:00:00Z' }, tol);
    expect(r.valida).toBe(true);
  });

  it('RN-PES-04: até 24 h depois do fim ainda vale (tolerância); passou disso, APOS_A_VIGENCIA', () => {
    expect(validarVigenciaDaResposta(vig, { respondida_em: '2026-11-01T03:59:59Z', recebida_em: '2026-11-01T04:00:00Z' }, tol).valida).toBe(true);
    const r = validarVigenciaDaResposta(vig, { respondida_em: '2026-11-01T04:00:00Z', recebida_em: '2026-11-01T05:00:00Z' }, tol);
    expect(r).toMatchObject({ valida: false, codigo: 'APOS_A_VIGENCIA' });
    expect(r.mensagem).toMatch(/vigência/);
  });

  it('RN-PES-04: antes do início vale a mesma tolerância (relógio atrasado)', () => {
    expect(validarVigenciaDaResposta(vig, { respondida_em: '2026-09-30T04:00:00Z', recebida_em: '2026-10-02T00:00:00Z' }, tol).valida).toBe(true);
    expect(validarVigenciaDaResposta(vig, { respondida_em: '2026-09-30T03:59:59Z', recebida_em: '2026-10-02T00:00:00Z' }, tol)).toMatchObject({ valida: false, codigo: 'ANTES_DA_VIGENCIA' });
  });

  it('RN-PES-04: vigência sem fim nunca expira', () => {
    expect(validarVigenciaDaResposta({ inicio: vig.inicio, fim: null }, { respondida_em: '2030-01-01T00:00:00Z', recebida_em: '2030-01-01T00:00:01Z' }, tol).valida).toBe(true);
  });

  it('RN-PES-04: relógio do aparelho adiantado além da tolerância em relação ao servidor é recusado (RELOGIO_ADIANTADO)', () => {
    const r = validarVigenciaDaResposta({ inicio: vig.inicio, fim: null }, { respondida_em: '2026-10-20T12:00:00Z', recebida_em: '2026-10-18T11:59:59Z' }, tol);
    expect(r).toMatchObject({ valida: false, codigo: 'RELOGIO_ADIANTADO' });
    expect(validarVigenciaDaResposta({ inicio: vig.inicio, fim: null }, { respondida_em: '2026-10-19T12:00:00Z', recebida_em: '2026-10-18T12:00:00Z' }, tol).valida).toBe(true);
  });

  it('RN-PES-04: tolerância 0 vale exatamente o fim da vigência', () => {
    expect(validarVigenciaDaResposta(vig, { respondida_em: '2026-10-31T04:00:00Z', recebida_em: '2026-10-31T05:00:00Z' }, 0).valida).toBe(false);
    expect(validarVigenciaDaResposta(vig, { respondida_em: '2026-10-31T03:59:59Z', recebida_em: '2026-10-31T05:00:00Z' }, 0).valida).toBe(true);
  });
});
