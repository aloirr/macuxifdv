import { describe, expect, it } from 'vitest';
import { aplicarCancelamentoRecusado, decidirCancelamento, erpAceitaCancelamento, selecionarCancelamentos, type PedidoParaCancelar } from './cancelamento';

const t0 = '2026-11-07T10:00:00.000Z';
const min = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

const fila = (extra: Partial<PedidoParaCancelar> = {}): PedidoParaCancelar => ({
  pedido_uuid: UUID,
  estado: 'integrado',
  tentativas: 1,
  numero_erp: 'PV-9',
  removido_em: null,
  cancelamento_estado: null,
  cancelamento_motivo: null,
  cancelamento_solicitado_em: null,
  cancelamento_enviado_em: null,
  cancelamento_tentativas: 0,
  ...extra,
});

describe('decidirCancelamento (T-0114, RN-INT-08 exceção)', () => {
  it('RN-INT-08: pedido que o Hub nunca entregou ao Conector sai da fila, com ou sem aceite', () => {
    for (const aceita of [true, false]) {
      expect(decidirCancelamento({ existente: fila({ estado: 'pendente', tentativas: 0, numero_erp: null }), aceitaCancelamento: aceita, motivo: 'x' })).toEqual({ acao: 'remover_da_fila' });
    }
  });

  it('RN-INT-08: conector que NÃO aceita cancelamento: depois da entrega nada muda (opção b)', () => {
    for (const estado of ['enviado', 'integrado', 'faturado_parcial'] as const) {
      expect(decidirCancelamento({ existente: fila({ estado }), aceitaCancelamento: false, motivo: 'x' })).toEqual({ acao: 'ignorar', motivo: 'conector_nao_aceita' });
    }
  });

  it('RN-INT-08: conector que aceita: pedido entregue, integrado ou faturado em parte vira cancelamento pendente, com o motivo', () => {
    for (const estado of ['enviado', 'integrado', 'faturado_parcial'] as const) {
      expect(decidirCancelamento({ existente: fila({ estado }), aceitaCancelamento: true, motivo: 'Cliente desistiu' })).toEqual({ acao: 'solicitar_ao_erp', motivo: 'Cliente desistiu' });
    }
  });

  it('RN-INT-08: pedido reenviado por timeout (voltou a pendente mas já foi entregue) também recebe o cancelamento', () => {
    expect(decidirCancelamento({ existente: fila({ estado: 'pendente', tentativas: 1, numero_erp: null }), aceitaCancelamento: true, motivo: null })).toEqual({ acao: 'solicitar_ao_erp', motivo: null });
  });

  it('RN-INT-08: o mesmo evento de cancelamento repetido é idempotente pelo pedido', () => {
    const d = decidirCancelamento({ existente: fila({ cancelamento_estado: 'pendente', cancelamento_solicitado_em: t0 }), aceitaCancelamento: true, motivo: 'x' });
    expect(d).toEqual({ acao: 'ignorar', motivo: 'ja_solicitado' });
  });

  it('RN-INT-08: pedido já cancelado, rejeitado, faturado por inteiro ou removido: ignora', () => {
    for (const estado of ['cancelado', 'rejeitado_erp', 'faturado_total'] as const) {
      expect(decidirCancelamento({ existente: fila({ estado }), aceitaCancelamento: true, motivo: 'x' }).acao).toBe('ignorar');
    }
    expect(decidirCancelamento({ existente: fila({ removido_em: t0 }), aceitaCancelamento: true, motivo: 'x' })).toEqual({ acao: 'ignorar', motivo: 'fora_da_fila' });
    expect(decidirCancelamento({ existente: null, aceitaCancelamento: true, motivo: 'x' })).toEqual({ acao: 'ignorar', motivo: 'fora_da_fila' });
  });

  it('RN-INT-08: o motivo do cancelamento é cortado em 500 caracteres', () => {
    const d = decidirCancelamento({ existente: fila(), aceitaCancelamento: true, motivo: 'a'.repeat(600) });
    expect(d.acao === 'solicitar_ao_erp' && d.motivo?.length).toBe(500);
  });
});

describe('selecionarCancelamentos (entrega ao Conector)', () => {
  it('RN-INT-08: entrega o pendente por ordem de solicitação, conta a tentativa e marca enviado', () => {
    const b = fila({ pedido_uuid: 'b', cancelamento_estado: 'pendente', cancelamento_solicitado_em: min(t0, 2) });
    const a = fila({ pedido_uuid: 'a', cancelamento_estado: 'pendente', cancelamento_solicitado_em: t0, cancelamento_motivo: 'x' });
    const r = selecionarCancelamentos([b, a], min(t0, 5), { limite: 10 });
    expect(r.entregar.map((c) => c.pedido_uuid)).toEqual(['a', 'b']);
    expect(r.entregar[0]).toMatchObject({ pedido_uuid: 'a', numero_erp: 'PV-9', motivo: 'x', cancelado_em: t0, tentativa: 1 });
    expect(r.atualizacoes[0]).toEqual({ pedido_uuid: 'a', cancelamento_enviado_em: min(t0, 5), cancelamento_tentativas: 1 });
  });

  it('RN-INT-08: enviado sem confirmação em 10 min é reentregue; antes disso não', () => {
    const e = fila({ cancelamento_estado: 'enviado', cancelamento_solicitado_em: t0, cancelamento_enviado_em: t0, cancelamento_tentativas: 1 });
    expect(selecionarCancelamentos([e], min(t0, 9), { timeoutMin: 10 }).entregar).toHaveLength(0);
    const r = selecionarCancelamentos([e], min(t0, 10), { timeoutMin: 10 });
    expect(r.entregar[0]?.tentativa).toBe(2);
  });

  it('RN-INT-08: cancelamento já confirmado, pedido cancelado/removido ou sem solicitação nunca é entregue', () => {
    const ja = [
      fila({ cancelamento_estado: 'confirmado', cancelamento_solicitado_em: t0 }),
      fila({ estado: 'cancelado', cancelamento_estado: 'pendente', cancelamento_solicitado_em: t0 }),
      fila({ removido_em: t0, cancelamento_estado: 'pendente', cancelamento_solicitado_em: t0 }),
      fila(),
    ];
    expect(selecionarCancelamentos(ja, min(t0, 60)).entregar).toHaveLength(0);
  });

  it('RN-INT-08: respeita o limite da consulta', () => {
    const muitos = ['a', 'b', 'c'].map((u, i) => fila({ pedido_uuid: u, cancelamento_estado: 'pendente', cancelamento_solicitado_em: min(t0, i) }));
    expect(selecionarCancelamentos(muitos, min(t0, 5), { limite: 2 }).entregar).toHaveLength(2);
  });
});

describe('T-0114: aceite do cancelamento pelo ERP (consulta integracao.cancelamento_erp@1)', () => {
  const ok = { ativo: true, recebe_pedidos: true, aceita_cancelamento: true };
  it('RN-INT-08: o ERP aceita só com Conector ativo, que recebe pedidos e com aceita_cancelamento ligado', () => {
    expect(erpAceitaCancelamento([ok])).toBe(true);
    expect(erpAceitaCancelamento([{ ...ok, aceita_cancelamento: false }])).toBe(false);
    expect(erpAceitaCancelamento([{ ...ok, ativo: false }])).toBe(false);
    expect(erpAceitaCancelamento([{ ...ok, recebe_pedidos: false }])).toBe(false);
  });
  it('RN-INT-08: sem Conector cadastrado o ERP não aceita (nada muda)', () => {
    expect(erpAceitaCancelamento([])).toBe(false);
  });
});

describe('aplicarCancelamentoRecusado (T-0114: o ERP recusou o cancelamento; exceção da RN-INT-08)', () => {
  const recusa = { motivo: '  Pedido já faturado no ERP ', ocorrido_em: t0 };

  it('RN-INT-08 (T-0114): cancelamento enviado e recusado vira recusado, com o motivo aparado, e gera o evento; o estado do pedido não entra', () => {
    const r = aplicarCancelamentoRecusado(fila({ cancelamento_estado: 'enviado' }), recusa);
    expect(r).toEqual({
      ok: true,
      repetido: false,
      atualizacao: { cancelamento_estado: 'recusado', cancelamento_recusa_motivo: 'Pedido já faturado no ERP', cancelamento_recusado_em: t0 },
      evento: { pedido_uuid: UUID, numero_erp: 'PV-9', motivo: 'Pedido já faturado no ERP', recusado_em: t0 },
    });
  });

  it('RN-INT-08 (T-0114): motivo cortado em 300 caracteres; sem motivo, texto padrão (nunca vazio)', () => {
    const longo = aplicarCancelamentoRecusado(fila({ cancelamento_estado: 'enviado' }), { motivo: 'x'.repeat(400), ocorrido_em: t0 });
    expect(longo.ok && longo.evento.motivo.length).toBe(300);
    const vazio = aplicarCancelamentoRecusado(fila({ cancelamento_estado: 'enviado' }), { motivo: '   ', ocorrido_em: t0 });
    expect(vazio.ok && vazio.evento.motivo).toMatch(/não informou/);
  });

  it('RN-INT-08 (T-0114): a recusa repetida é idempotente (repetido, mantém o motivo já gravado)', () => {
    const r = aplicarCancelamentoRecusado({ ...fila({ cancelamento_estado: 'recusado' }), cancelamento_recusa_motivo: 'primeiro motivo' }, recusa);
    expect(r).toMatchObject({ ok: true, repetido: true, atualizacao: { cancelamento_recusa_motivo: 'primeiro motivo' } });
  });

  it('RN-INT-08 (T-0114): recusa sem cancelamento pedido, antes da entrega ou depois da confirmação é recusada com a ação seguinte', () => {
    const codigo = (e: PedidoParaCancelar['cancelamento_estado']) => {
      const r = aplicarCancelamentoRecusado(fila({ cancelamento_estado: e }), recusa);
      return r.ok ? 'ok' : r.codigo;
    };
    expect(codigo(null)).toBe('cancelamento_nao_solicitado');
    expect(codigo('pendente')).toBe('cancelamento_nao_entregue');
    expect(codigo('confirmado')).toBe('cancelamento_ja_confirmado');
  });

  it('RN-INT-08 (T-0114): pedido desconhecido ou removido da fila é recusado', () => {
    expect(aplicarCancelamentoRecusado(null, recusa)).toMatchObject({ ok: false, codigo: 'pedido_desconhecido' });
    expect(aplicarCancelamentoRecusado(fila({ cancelamento_estado: 'enviado', removido_em: t0 }), recusa)).toMatchObject({ ok: false, codigo: 'pedido_desconhecido' });
  });

  it('RN-INT-08 (T-0114): a recusa não faz o cancelamento voltar a ser entregue ao Conector', () => {
    const f = fila({ cancelamento_estado: 'recusado', cancelamento_solicitado_em: t0 });
    expect(selecionarCancelamentos([f], min(t0, 600)).entregar).toEqual([]);
  });
});
