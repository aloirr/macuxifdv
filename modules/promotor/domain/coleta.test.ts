import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import {
  avaliarColeta,
  checkoutRespeitaChecklist,
  coletaNaJanelaDaVisita,
  fotosReferenciadas,
  mesmoConteudo,
  podeColetar,
  transicaoVisitaLoja,
  type VisitaLojaGuardada,
} from './coleta';

const relogio = criarRelogio({ agora: '2026-11-03T14:00:00Z' });
const ins = (min: number) => relogio.relativo({ minutos: min }).toISOString();

const EU = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const VISITA_LOJA = '33333333-3333-4333-8333-333333333333';
const VISITA_CORE = '44444444-4444-4444-8444-444444444444';
const LOJA = '55555555-5555-4555-8555-555555555555';
const FOTO = '66666666-6666-4666-8666-666666666666';

const aberta = (extra: Partial<VisitaLojaGuardada> = {}): VisitaLojaGuardada => ({
  id: VISITA_LOJA,
  visita_id: VISITA_CORE,
  cliente_id: LOJA,
  promotor_id: EU,
  checklist_modelo_id: null,
  checkin_em: ins(0),
  checkout_em: null,
  permanencia_min: null,
  desfecho: null,
  foto_fachada_id: null,
  observacao: null,
  ...extra,
});

describe('RN-PRO-02: coleta só com check-in aberto (offline)', () => {
  it('RN-PRO-02: instante entre o check-in e o checkout (inclusive) está na janela', () => {
    expect(coletaNaJanelaDaVisita({ checkin_em: ins(0), checkout_em: null }, ins(5))).toBe(true);
    expect(coletaNaJanelaDaVisita({ checkin_em: ins(0), checkout_em: ins(30) }, ins(30))).toBe(true);
    expect(coletaNaJanelaDaVisita({ checkin_em: ins(0), checkout_em: ins(30) }, ins(0))).toBe(true);
  });

  it('RN-PRO-02: antes do check-in ou depois do checkout fica fora', () => {
    expect(coletaNaJanelaDaVisita({ checkin_em: ins(0), checkout_em: null }, ins(-1))).toBe(false);
    expect(coletaNaJanelaDaVisita({ checkin_em: ins(0), checkout_em: ins(30) }, ins(31))).toBe(false);
  });

  it('RN-PRO-02: coleta feita offline com a visita aberta e enviada depois do checkout é aceita', () => {
    const fechada = aberta({ checkout_em: ins(40), permanencia_min: 40, desfecho: 'realizada' });
    expect(avaliarColeta({ perfil: 'promotor', usuario_id: EU, visita: fechada, instante: ins(20) })).toBeNull();
  });

  it('RN-PRO-02: sem visita de loja (sem check-in) a coleta é recusada com a ação seguinte', () => {
    const r = avaliarColeta({ perfil: 'promotor', usuario_id: EU, visita: null, instante: ins(5) });
    expect(r).toMatchObject({ http: 404, codigo: 'VISITA_LOJA_NAO_ENCONTRADA' });
    expect(r?.mensagem).toMatch(/check-in/);
  });

  it('RN-PRO-02: coleta fora da janela da visita é recusada (422)', () => {
    const r = avaliarColeta({ perfil: 'promotor', usuario_id: EU, visita: aberta({ checkout_em: ins(30), permanencia_min: 30, desfecho: 'realizada' }), instante: ins(45) });
    expect(r).toMatchObject({ http: 422, codigo: 'RN-PRO-02' });
  });

  it('RN-CORE-04: visita de outro promotor é tratada como inexistente (não revela)', () => {
    expect(avaliarColeta({ perfil: 'promotor', usuario_id: OUTRO, visita: aberta(), instante: ins(5) })).toMatchObject({ http: 404, codigo: 'VISITA_LOJA_NAO_ENCONTRADA' });
  });

  it('doc 03 §2: só o promotor coleta (supervisor, gerente, analista e admin só leem)', () => {
    expect(podeColetar('promotor')).toBe(true);
    for (const p of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']) {
      expect(podeColetar(p), p).toBe(false);
      expect(avaliarColeta({ perfil: p, usuario_id: EU, visita: aberta(), instante: ins(5) })).toMatchObject({ http: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });
});

describe('visita de loja: check-in, checkout e reenvio idempotente', () => {
  const nova = (extra: Partial<VisitaLojaGuardada> = {}) => {
    const { promotor_id: _p, ...v } = aberta(extra);
    return v;
  };

  it('primeiro envio = check-in; já pode chegar fechada (aparelho ficou offline a visita inteira)', () => {
    expect(transicaoVisitaLoja(null, nova(), EU)).toEqual({ tipo: 'nova', concluida: false });
    expect(transicaoVisitaLoja(null, nova({ checkout_em: ins(20), permanencia_min: 20, desfecho: 'realizada' }), EU)).toEqual({ tipo: 'nova', concluida: true });
  });

  it('reenvio com o mesmo conteúdo é repetido (idempotente)', () => {
    expect(transicaoVisitaLoja(aberta(), nova(), EU)).toEqual({ tipo: 'repetida' });
  });

  it('aberta → fechada com os mesmos dados do check-in = checkout', () => {
    expect(transicaoVisitaLoja(aberta(), nova({ checkout_em: ins(25), permanencia_min: 25, desfecho: 'realizada' }), EU)).toEqual({ tipo: 'checkout' });
  });

  it('mudar loja, visita do Core ou horário do check-in é conflito', () => {
    expect(transicaoVisitaLoja(aberta(), nova({ cliente_id: OUTRO }), EU)).toMatchObject({ tipo: 'conflito' });
    expect(transicaoVisitaLoja(aberta(), nova({ checkin_em: ins(1), checkout_em: ins(9), permanencia_min: 8, desfecho: 'realizada' }), EU)).toMatchObject({ tipo: 'conflito' });
  });

  it('visita já fechada não reabre nem muda o checkout', () => {
    const fechada = aberta({ checkout_em: ins(25), permanencia_min: 25, desfecho: 'realizada' });
    expect(transicaoVisitaLoja(fechada, nova(), EU)).toMatchObject({ tipo: 'conflito' });
    expect(transicaoVisitaLoja(fechada, nova({ checkout_em: ins(26), permanencia_min: 26, desfecho: 'realizada' }), EU)).toMatchObject({ tipo: 'conflito' });
  });

  it('id de visita de outro promotor = ID_EM_USO', () => {
    expect(transicaoVisitaLoja(aberta({ promotor_id: OUTRO }), nova(), EU)).toMatchObject({ tipo: 'recusa', codigo: 'ID_EM_USO' });
  });

  it('mesmoConteudo ignora a ordem das chaves', () => {
    expect(mesmoConteudo({ a: 1, b: { c: 2, d: [1, 2] } }, { b: { d: [1, 2], c: 2 }, a: 1 })).toBe(true);
    expect(mesmoConteudo({ a: 1 }, { a: 2 })).toBe(false);
    expect(mesmoConteudo({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe('RN-PRO-06: checkout com as etapas obrigatórias do checklist', () => {
  const r = (obrigatoria: boolean, concluida: boolean, n: number) => ({ checklist_item_id: `item-${n}`, obrigatoria, concluida });

  it('RN-PRO-06: visita realizada com etapa obrigatória pendente bloqueia o checkout', () => {
    const m = checkoutRespeitaChecklist('realizada', [r(true, true, 1), r(true, false, 2), r(false, false, 3)]);
    expect(m).toMatch(/obrigat/);
  });

  it('RN-PRO-06: tudo obrigatório concluído libera', () => {
    expect(checkoutRespeitaChecklist('realizada', [r(true, true, 1), r(false, false, 2)])).toBeNull();
  });

  it('RN-PRO-06: loja fechada ou acesso negado dispensam o checklist', () => {
    expect(checkoutRespeitaChecklist('loja_fechada', [r(true, false, 1)])).toBeNull();
    expect(checkoutRespeitaChecklist('acesso_negado', [r(true, false, 1)])).toBeNull();
  });

  it('RN-PRO-06: a última resposta do item vale (refez a etapa depois)', () => {
    expect(checkoutRespeitaChecklist('realizada', [r(true, false, 1), r(true, true, 1)])).toBeNull();
  });
});

describe('RN-PRO-02: fotos referenciadas pela coleta', () => {
  it('junta as fotos de todos os campos de foto da coleta, sem repetir e sem nulos', () => {
    expect(fotosReferenciadas({ foto_antes_id: FOTO, foto_depois_id: OUTRO, foto_id: null, foto_ids: [FOTO, EU], foto_fachada_id: null })).toEqual([FOTO, OUTRO, EU]);
    expect(fotosReferenciadas({ quantidade: 3 })).toEqual([]);
  });
});
