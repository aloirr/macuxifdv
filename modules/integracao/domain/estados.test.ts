import { describe, expect, it } from 'vitest';
import { ESTADOS_LOTE_BKO, ESTADOS_PEDIDO_ERP, type EstadoLoteBko, type EstadoPedidoErp } from '../contracts';
import { aplicarTimeoutEnvio, chaveNotaRetorno, podeEntrarNaFila, transicionarLote, transicionarPedidoErp, transicionarRetornoPedidoErp } from './estados';

describe('RN-INT-08: máquina de estados do lote', () => {
  it('RN-INT-08: fluxo normal recebido → processando → concluído/com erros/falhou', () => {
    expect(transicionarLote('recebido', 'processando')).toMatchObject({ ok: true, estado: 'processando' });
    for (const fim of ['concluido', 'concluido_com_erros', 'falhou'] as const) expect(transicionarLote('processando', fim).ok).toBe(true);
    expect(transicionarLote('recebido', 'falhou').ok).toBe(true);
  });

  it('RN-INT-08/03: reprocessar volta de concluido_com_erros e falhou para processando; concluído é final', () => {
    expect(transicionarLote('concluido_com_erros', 'processando').ok).toBe(true);
    expect(transicionarLote('falhou', 'processando').ok).toBe(true);
    for (const para of ESTADOS_LOTE_BKO) expect(transicionarLote('concluido', para).ok).toBe(false);
  });

  it('RN-INT-08: transições inválidas são rejeitadas com mensagem em português', () => {
    const r = transicionarLote('recebido', 'concluido');
    expect(r).toMatchObject({ ok: false, codigo: 'transicao_invalida', de: 'recebido', para: 'concluido' });
    if (!r.ok) expect(r.mensagem).toMatch(/recebido.*concluido/);
    const invalidas: [EstadoLoteBko, EstadoLoteBko][] = [
      ['processando', 'recebido'],
      ['processando', 'processando'],
      ['concluido_com_erros', 'concluido'],
      ['falhou', 'concluido'],
    ];
    for (const [de, para] of invalidas) expect(transicionarLote(de, para).ok).toBe(false);
  });
});

describe('RN-INT-08: máquina de estados do retorno do pedido', () => {
  it('RN-INT-08: pendente → enviado → integrado | rejeitado_erp', () => {
    expect(transicionarPedidoErp('pendente', 'enviado')).toMatchObject({ ok: true, estado: 'enviado', repetida: false });
    expect(transicionarPedidoErp('enviado', 'integrado').ok).toBe(true);
    expect(transicionarPedidoErp('enviado', 'rejeitado_erp').ok).toBe(true);
  });

  it('RN-INT-08: integrado → faturado_parcial → faturado_total (e integrado → faturado_total direto)', () => {
    expect(transicionarPedidoErp('integrado', 'faturado_parcial').ok).toBe(true);
    expect(transicionarPedidoErp('faturado_parcial', 'faturado_total').ok).toBe(true);
    expect(transicionarPedidoErp('integrado', 'faturado_total').ok).toBe(true);
  });

  it('RN-INT-08: o ERP pode cancelar a partir de enviado, integrado, faturado_parcial e faturado_total', () => {
    for (const de of ['enviado', 'integrado', 'faturado_parcial', 'faturado_total'] as const) {
      expect(transicionarPedidoErp(de, 'cancelado'), de).toMatchObject({ ok: true, estado: 'cancelado', repetida: false });
    }
  });

  it('RN-INT-08: cancelado é final e repetir o cancelamento é idempotente', () => {
    expect(transicionarPedidoErp('cancelado', 'cancelado')).toMatchObject({ ok: true, estado: 'cancelado', repetida: true });
    for (const para of ESTADOS_PEDIDO_ERP.filter((e) => e !== 'cancelado')) expect(transicionarPedidoErp('cancelado', para).ok, para).toBe(false);
  });

  it('RN-INT-08: cancelamento recusado antes do envio e depois de rejeitado, com mensagem em português', () => {
    const r = transicionarPedidoErp('pendente', 'cancelado');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toMatch(/pendente.*cancelado/);
  });

  it('RN-INT-08: enviado sem confirmação pode voltar a pendente (timeout)', () => {
    expect(transicionarPedidoErp('enviado', 'pendente').ok).toBe(true);
  });

  it('RN-INT-08: transições inválidas são rejeitadas (pular etapa, voltar, sair de estado final)', () => {
    const invalidas: [EstadoPedidoErp, EstadoPedidoErp][] = [
      ['pendente', 'integrado'],
      ['pendente', 'faturado_total'],
      ['enviado', 'faturado_parcial'],
      ['integrado', 'enviado'],
      ['integrado', 'pendente'],
      ['faturado_total', 'faturado_parcial'],
      ['pendente', 'cancelado'],
      ['cancelado', 'integrado'],
      ['cancelado', 'faturado_total'],
      ['cancelado', 'pendente'],
      ['rejeitado_erp', 'cancelado'],
      ['faturado_total', 'pendente'],
      ['rejeitado_erp', 'integrado'],
      ['rejeitado_erp', 'pendente'],
      ['faturado_parcial', 'integrado'],
    ];
    for (const [de, para] of invalidas) {
      const r = transicionarPedidoErp(de, para);
      expect(r.ok, `${de} → ${para}`).toBe(false);
    }
  });

  it('RN-INT-08: repetir o mesmo estado é idempotente (retorno repetido do Conector não é erro)', () => {
    for (const e of ESTADOS_PEDIDO_ERP) expect(transicionarPedidoErp(e, e)).toMatchObject({ ok: true, estado: e, repetida: true });
  });
});

describe('RN-INT-08: retorno faturado — repetição é por (pedido, status, nota), não só pelo status', () => {
  const nota1 = { numero: '100', serie: '1' };
  const nota2 = { numero: '101', serie: '1' };

  it('RN-INT-08: a chave da nota é número + série (série ausente equivale a vazia, sem diferenciar espaços)', () => {
    expect(chaveNotaRetorno({ numero: '100', serie: '1' })).toBe('100|1');
    expect(chaveNotaRetorno({ numero: ' 100 ', serie: null })).toBe('100|');
    expect(chaveNotaRetorno({ numero: '100' })).toBe(chaveNotaRetorno({ numero: '100', serie: '' }));
  });

  it('RN-INT-08: o primeiro faturado_parcial (vindo de integrado) é fato novo', () => {
    expect(transicionarRetornoPedidoErp('integrado', { status: 'faturado_parcial', nota: nota1 }, [])).toMatchObject({ ok: true, estado: 'faturado_parcial', repetida: false });
  });

  it('RN-INT-08: faturado_parcial repetido com nota DIFERENTE não é repetição (2ª nota parcial é fato novo)', () => {
    const r = transicionarRetornoPedidoErp('faturado_parcial', { status: 'faturado_parcial', nota: nota2 }, [nota1]);
    expect(r).toMatchObject({ ok: true, estado: 'faturado_parcial', repetida: false });
  });

  it('RN-INT-08: faturado_parcial repetido com a MESMA nota (mesma série) continua idempotente', () => {
    const r = transicionarRetornoPedidoErp('faturado_parcial', { status: 'faturado_parcial', nota: { numero: '100', serie: '1' } }, [nota1]);
    expect(r).toMatchObject({ ok: true, estado: 'faturado_parcial', repetida: true });
  });

  it('RN-INT-08: mesma numeração em série diferente é nota diferente', () => {
    const r = transicionarRetornoPedidoErp('faturado_parcial', { status: 'faturado_parcial', nota: { numero: '100', serie: '2' } }, [nota1]);
    expect(r).toMatchObject({ ok: true, repetida: false });
  });

  it('RN-INT-08: o parcial pode ser seguido de faturado_total (nota nova) e de cancelamento', () => {
    expect(transicionarRetornoPedidoErp('faturado_parcial', { status: 'faturado_total', nota: nota2 }, [nota1])).toMatchObject({ ok: true, estado: 'faturado_total', repetida: false });
    expect(transicionarRetornoPedidoErp('faturado_parcial', { status: 'cancelado' }, [nota1])).toMatchObject({ ok: true, estado: 'cancelado', repetida: false });
  });

  it('RN-INT-08: faturado_parcial sem nota informada segue a regra do estado (repetição idempotente); demais estados repetem pelo estado', () => {
    expect(transicionarRetornoPedidoErp('faturado_parcial', { status: 'faturado_parcial' }, [nota1])).toMatchObject({ ok: true, repetida: true });
    expect(transicionarRetornoPedidoErp('integrado', { status: 'integrado' }, [])).toMatchObject({ ok: true, repetida: true });
    expect(transicionarRetornoPedidoErp('cancelado', { status: 'cancelado' }, [])).toMatchObject({ ok: true, repetida: true });
  });

  it('RN-INT-08: transições inválidas continuam inválidas (faturado_total não volta a parcial, mesmo com nota nova)', () => {
    const r = transicionarRetornoPedidoErp('faturado_total', { status: 'faturado_parcial', nota: nota2 }, [nota1]);
    expect(r).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
    expect(transicionarRetornoPedidoErp('enviado', { status: 'faturado_parcial', nota: nota1 }, []).ok).toBe(false);
  });
});

describe('RN-INT-08: fila de pendentes e timeout de reenvio', () => {
  it('RN-INT-08: só pedido aprovado entra na fila de pendentes', () => {
    expect(podeEntrarNaFila('aprovado')).toBe(true);
    for (const s of ['rascunho', 'pendente', 'em_aprovacao', 'reprovado', 'cancelado', 'faturado']) expect(podeEntrarNaFila(s)).toBe(false);
  });

  const enviado = { estado: 'enviado' as const, enviado_em: '2026-10-31T10:00:00Z', tentativas: 1 };

  it('RN-INT-08: enviado sem confirmação em 10 min volta a pendente e conta a tentativa', () => {
    expect(aplicarTimeoutEnvio(enviado, '2026-10-31T10:09:59Z')).toEqual({ ...enviado, reenviado: false });
    const r = aplicarTimeoutEnvio(enviado, '2026-10-31T10:10:00Z');
    expect(r).toEqual({ estado: 'pendente', enviado_em: null, tentativas: 1, reenviado: true });
  });

  it('RN-INT-08: o prazo é parâmetro; só estado enviado é afetado', () => {
    expect(aplicarTimeoutEnvio(enviado, '2026-10-31T10:05:00Z', { timeoutMin: 5 }).estado).toBe('pendente');
    for (const estado of ['pendente', 'integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado'] as const) {
      const item = { estado, enviado_em: null, tentativas: 1 };
      expect(aplicarTimeoutEnvio(item, '2030-01-01T00:00:00Z')).toEqual({ ...item, reenviado: false });
    }
  });

  it('RN-INT-08: o timeout não mexe em tentativas (quem conta é a retirada pelo Conector)', () => {
    const r = aplicarTimeoutEnvio({ ...enviado, tentativas: 3 }, '2026-10-31T11:00:00Z');
    expect(r).toMatchObject({ estado: 'pendente', tentativas: 3, reenviado: true });
  });
});
