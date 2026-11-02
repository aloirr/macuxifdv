import { describe, expect, it } from 'vitest';
import { foto, item, publicada, regra, sim_nao, texto, u } from '../../domain/util-teste';
import { camposVisiveis, chaveDoRascunho, errosPorPergunta, fotosDoEnvio, novoRascunho, prepararEnvio, progresso, responder } from './formulario';

const AGORA = '2026-10-31T13:00:00Z';
// P1 "Tem ponto extra?"; P2 obrigatória, só aparece se P1 = sim; P3 foto opcional
const v = publicada({
  perguntas: [sim_nao(1, { obrigatoria: true }), texto(2, { obrigatoria: true }), foto(3)],
  regras: [regra(90, 2, 1, 'igual', true)],
});
const base = () => novoRascunho({ id: u(5000), versao: v, cliente_id: u(51), visita_id: u(61), agora: AGORA });

describe('RF-PES-04: rascunho no aparelho', () => {
  it('RF-PES-04: um rascunho por pesquisa e contexto (visita, cliente ou avulsa)', () => {
    expect(chaveDoRascunho('q', { visita_id: 'v', cliente_id: 'c' })).toBe('q:v');
    expect(chaveDoRascunho('q', { visita_id: null, cliente_id: 'c' })).toBe('q:c');
    expect(chaveDoRascunho('q', { visita_id: null, cliente_id: null })).toBe('q:avulsa');
  });

  it('RF-PES-04: responder troca a resposta da pergunta; resposta em branco apaga', () => {
    let r = responder(base(), item.simNao(1, false));
    r = responder(r, item.simNao(1, true));
    expect(r.itens).toEqual([item.simNao(1, true)]);
    r = responder(responder(r, item.texto(2, 'ok')), item.texto(2, '   '));
    expect(r.itens.map((i) => i.pergunta_id)).toEqual([u(1)]);
  });
});

describe('RF-PES-01 / RN-PES-05: perguntas visíveis pelas regras', () => {
  it('RF-PES-01: P2 só aparece com P1 = sim; a numeração segue as visíveis', () => {
    expect(camposVisiveis(v, base()).map((c) => [c.pergunta.id, c.ordem])).toEqual([
      [u(1), 1],
      [u(3), 2],
    ]);
    expect(camposVisiveis(v, responder(base(), item.simNao(1, true))).map((c) => c.pergunta.id)).toEqual([u(1), u(2), u(3)]);
  });

  it('RF-PES-01: progresso conta só as visíveis e as obrigatórias que faltam', () => {
    expect(progresso(v, base())).toEqual({ visiveis: 2, respondidas: 0, obrigatorias_faltando: 1 });
    expect(progresso(v, responder(base(), item.simNao(1, true)))).toEqual({ visiveis: 3, respondidas: 1, obrigatorias_faltando: 1 });
  });
});

describe('RF-PES-04 / RN-PES-04: envio para a fila', () => {
  it('RF-PES-01: obrigatória visível sem resposta impede o envio, com o erro na pergunta', () => {
    const p = prepararEnvio(v, responder(base(), item.simNao(1, true)), { agora: AGORA });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(errosPorPergunta(p.erros)).toEqual({ [u(2)]: expect.stringMatching(/Responda a pergunta obrigatória/) });
  });

  it('RF-PES-01: resposta de pergunta que ficou oculta é descartada antes de enviar', () => {
    let r = responder(base(), item.simNao(1, true));
    r = responder(r, item.texto(2, 'Descrição'));
    r = responder(r, item.simNao(1, false));
    const p = prepararEnvio(v, r, { agora: AGORA });
    expect(p.ok && p.envio.itens).toEqual([item.simNao(1, false)]);
  });

  it('RN-PES-04: o envio leva a hora do aparelho e o id do rascunho (idempotente)', () => {
    const p = prepararEnvio(v, responder(base(), item.simNao(1, false)), { agora: AGORA });
    expect(p.ok && p.envio).toEqual({ id: u(5000), questionario_id: v.questionario_id, versao_id: v.id, cliente_id: u(51), visita_id: u(61), respondida_em: AGORA, itens: [item.simNao(1, false)] });
  });

  it('ADR 0010: as fotos do envio vão para a fila de arquivos', () => {
    const p = prepararEnvio(v, responder(responder(base(), item.simNao(1, false)), item.foto(3, [10, 11])), { agora: AGORA });
    expect(p.ok && fotosDoEnvio(p.envio)).toEqual([u(10), u(11)]);
  });
});
