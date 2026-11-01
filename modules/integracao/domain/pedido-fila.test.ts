import { describe, expect, it } from 'vitest';
import type { PedidoAprovadoParaFila, RetornoErp } from '../contracts';
import { aplicarRetornoPedido, decidirEntradaNaFila, montarPedidoParaErp, selecionarPendentes, type Mapeamento, type PedidoNaFila } from './pedido-fila';

const t0 = '2026-11-01T10:00:00.000Z';
const min = (iso: string, m: number) => new Date(Date.parse(iso) + m * 60_000).toISOString();
const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

const snapshot = (extra: Partial<PedidoAprovadoParaFila> = {}): PedidoAprovadoParaFila => ({
  pedido_uuid: UUID,
  cliente_external_id: 'C1',
  vendedor_external_id: 'V1',
  condicao_pagamento_codigo: '30DD',
  criado_em: '2026-11-01T09:00:00.000Z',
  aprovado_em: '2026-11-01T09:30:00.000Z',
  itens: [
    { sequencia: 1, produto_external_id: 'SKU1', quantidade: 10, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 5000 },
    { sequencia: 2, produto_external_id: 'SKU2', quantidade: 4, preco_unitario_cents: 250, desconto_cents: 0, total_cents: 1000 },
  ],
  desconto_total_cents: 0,
  total_cents: 6000,
  ...extra,
});
const mapas: Mapeamento[] = [{ tipo: 'condicao_pagamento', codigo_erp: '007', codigo_macuxi: '30DD', ativo: true }];

const naFila = (extra: Partial<PedidoNaFila> = {}): PedidoNaFila => {
  const m = montarPedidoParaErp(snapshot(), mapas);
  if (!m.ok) throw new Error('esperado ok');
  return { pedido_uuid: UUID, estado: 'pendente', payload: m.pedido, enviado_em: null, tentativas: 0, numero_erp: null, motivo: null, notas_aplicadas: [], itens_faturados_acumulados: {}, removido_em: null, ...extra };
};

const retorno = (extra: Partial<RetornoErp> & Record<string, unknown>): RetornoErp =>
  ({ versao_contrato: 'v1', pedido_uuid: UUID, status: 'integrado', numero_erp: 'P-1', ocorrido_em: t0, ...extra }) as RetornoErp;
const nota = (numero: string, extra = {}) => ({ numero, serie: '1', emitida_em: t0, total_cents: 1000, ...extra });
const item = (sequencia: number, produto: string, quantidade: number, valor_cents = 100) => ({ sequencia, produto_external_id: produto, quantidade, valor_cents });

describe('RN-INT-08: montagem do pedido para a fila (de-para)', () => {
  it('RN-INT-08: traduz a condição de pagamento pelo mapeamento e zera a tentativa (entra na fila como 1ª entrega)', () => {
    const r = montarPedidoParaErp(snapshot(), mapas);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pedido).toMatchObject({ versao_contrato: 'v1', pedido_uuid: UUID, condicao_pagamento_erp: '007', cliente_external_id: 'C1', total_cents: 6000, tentativa: 1 });
      expect(r.pedido.itens).toHaveLength(2);
    }
  });

  it('RN-INT-08: condição sem de-para ativo fica retida com mensagem que diz o que cadastrar (sem perder o pedido)', () => {
    const r = montarPedidoParaErp(snapshot({ condicao_pagamento_codigo: '60DD' }), mapas);
    expect(r).toMatchObject({ ok: false, codigo: 'mapeamento_ausente' });
    if (!r.ok) expect(r.mensagem).toMatch(/60DD.*Mapeamento|Mapeamento.*60DD/s);
    expect(montarPedidoParaErp(snapshot({ condicao_pagamento_codigo: '30DD' }), [{ ...mapas[0]!, ativo: false }])).toMatchObject({ ok: false, codigo: 'mapeamento_ausente' });
  });

  it('RN-INT-08: dois correspondentes ativos para a mesma condição do Macuxi é ambiguidade — fica retido até sobrar um', () => {
    const duplo: Mapeamento[] = [...mapas, { tipo: 'condicao_pagamento', codigo_erp: '008', codigo_macuxi: '30DD', ativo: true }];
    expect(montarPedidoParaErp(snapshot(), duplo)).toMatchObject({ ok: false, codigo: 'mapeamento_ambiguo' });
    expect(montarPedidoParaErp(snapshot(), [...duplo.slice(0, 1), { ...duplo[1]!, ativo: false }]).ok).toBe(true);
  });

  it('RN-INT-08: o de-para de outro tipo (depósito, status) não serve para condição de pagamento', () => {
    expect(montarPedidoParaErp(snapshot(), [{ tipo: 'deposito', codigo_erp: '007', codigo_macuxi: '30DD', ativo: true }])).toMatchObject({ ok: false, codigo: 'mapeamento_ausente' });
  });

  it('RN-INT-08: pedido sem condição segue sem condicao_pagamento_erp (o ERP usa a do cliente)', () => {
    const r = montarPedidoParaErp(snapshot({ condicao_pagamento_codigo: null }), []);
    expect(r.ok && r.pedido.condicao_pagamento_erp).toBeFalsy();
  });

  it('RN-INT-08: sequências repetidas nos itens são recusadas (a sequência identifica a linha no retorno do faturamento)', () => {
    const s = snapshot();
    const r = montarPedidoParaErp({ ...s, itens: [s.itens[0]!, { ...s.itens[1]!, sequencia: 1 }] }, mapas);
    expect(r).toMatchObject({ ok: false, codigo: 'sequencia_repetida' });
  });
});

describe('RN-INT-08: entrada na fila é idempotente pelo UUID', () => {
  it('RN-INT-08: só pedido aprovado entra; outro status não cria item', () => {
    expect(decidirEntradaNaFila({ existente: null, statusPedido: 'em_aprovacao', snapshot: snapshot(), mapeamentos: mapas })).toMatchObject({ acao: 'ignorar', motivo: 'status_nao_aprovado' });
  });

  it('RN-INT-08: aprovado sem item na fila → criar', () => {
    const r = decidirEntradaNaFila({ existente: null, statusPedido: 'aprovado', snapshot: snapshot(), mapeamentos: mapas });
    expect(r).toMatchObject({ acao: 'criar' });
  });

  it('RN-INT-08: o mesmo evento de novo (mesmo conteúdo) não duplica', () => {
    const r = decidirEntradaNaFila({ existente: naFila(), statusPedido: 'aprovado', snapshot: snapshot(), mapeamentos: mapas });
    expect(r).toMatchObject({ acao: 'ignorar', motivo: 'ja_na_fila' });
  });

  it('RN-INT-08: pedido editado e reaprovado ANTES de ser entregue ao Conector substitui o conteúdo (RN-VEN-31)', () => {
    const r = decidirEntradaNaFila({ existente: naFila(), statusPedido: 'aprovado', snapshot: snapshot({ total_cents: 7000 }), mapeamentos: mapas });
    expect(r).toMatchObject({ acao: 'atualizar_payload' });
    if (r.acao === 'atualizar_payload') expect(r.pedido.total_cents).toBe(7000);
  });

  it('RN-INT-08: edição depois do envio ao ERP não altera o que o ERP já recebeu — vira aviso', () => {
    const r = decidirEntradaNaFila({ existente: naFila({ estado: 'enviado', enviado_em: t0, tentativas: 1 }), statusPedido: 'aprovado', snapshot: snapshot({ total_cents: 7000 }), mapeamentos: mapas });
    expect(r).toMatchObject({ acao: 'ignorar', motivo: 'alterado_apos_envio' });
  });

  it('RN-INT-08: aprovado sem de-para → reter (acao reter) com a mensagem do mapeamento', () => {
    const r = decidirEntradaNaFila({ existente: null, statusPedido: 'aprovado', snapshot: snapshot({ condicao_pagamento_codigo: '99' }), mapeamentos: mapas });
    expect(r).toMatchObject({ acao: 'reter', codigo: 'mapeamento_ausente' });
  });

  it('RN-INT-08: pedido cancelado/devolvido à aprovação antes da entrega sai da fila; depois da entrega o ERP é quem avisa (o Macuxi não escreve cancelamento)', () => {
    expect(decidirEntradaNaFila({ existente: naFila(), statusPedido: 'cancelado', snapshot: null, mapeamentos: mapas })).toMatchObject({ acao: 'remover_da_fila' });
    expect(decidirEntradaNaFila({ existente: naFila(), statusPedido: 'em_aprovacao', snapshot: null, mapeamentos: mapas })).toMatchObject({ acao: 'remover_da_fila' });
    expect(decidirEntradaNaFila({ existente: naFila({ estado: 'enviado', enviado_em: t0, tentativas: 1 }), statusPedido: 'cancelado', snapshot: null, mapeamentos: mapas })).toMatchObject({ acao: 'ignorar', motivo: 'ja_enviado_ao_erp' });
    expect(decidirEntradaNaFila({ existente: null, statusPedido: 'cancelado', snapshot: null, mapeamentos: mapas })).toMatchObject({ acao: 'ignorar' });
  });
});

describe('RN-INT-08: entrega dos pendentes ao Conector', () => {
  const doze = (n: number, extra: Partial<PedidoNaFila> = {}) => {
    const uuid = `3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a${String(n).padStart(2, '0')}`;
    const base = naFila();
    return naFila({ pedido_uuid: uuid, payload: { ...base.payload, pedido_uuid: uuid }, ...extra });
  };

  it('RN-INT-08: entrega os pendentes por ordem de aprovação, marca enviado e conta a tentativa', () => {
    const a = doze(1);
    const b0 = doze(2);
    const b = { ...b0, payload: { ...b0.payload, aprovado_em: '2026-11-01T09:00:00.000Z' } };
    const r = selecionarPendentes([a, b], t0);
    expect(r.entregar.map((p) => p.pedido_uuid)).toEqual([b.pedido_uuid, a.pedido_uuid]);
    expect(r.entregar[0]?.tentativa).toBe(1);
    expect(r.atualizacoes).toEqual([
      { pedido_uuid: b.pedido_uuid, estado: 'enviado', enviado_em: t0, tentativas: 1 },
      { pedido_uuid: a.pedido_uuid, estado: 'enviado', enviado_em: t0, tentativas: 1 },
    ]);
  });

  it('RN-INT-08: enviado há menos de 10 min não é reentregue; a partir de 10 min volta a pendente e sai como tentativa + 1', () => {
    const enviado = doze(1, { estado: 'enviado', enviado_em: t0, tentativas: 1 });
    expect(selecionarPendentes([enviado], min(t0, 9)).entregar).toEqual([]);
    const r = selecionarPendentes([enviado], min(t0, 10));
    expect(r.entregar).toHaveLength(1);
    expect(r.entregar[0]?.tentativa).toBe(2);
    expect(r.reenviados).toEqual([enviado.pedido_uuid]);
    expect(r.atualizacoes[0]).toMatchObject({ estado: 'enviado', tentativas: 2, enviado_em: min(t0, 10) });
  });

  it('RN-INT-08: respeita o limite por consulta (padrão 50) e não entrega removidos, retidos nem estados finais', () => {
    const muitos = Array.from({ length: 60 }, (_, i) => doze(i + 1));
    expect(selecionarPendentes(muitos, t0).entregar).toHaveLength(50);
    expect(selecionarPendentes(muitos, t0, { limite: 5 }).entregar).toHaveLength(5);
    const outros = [doze(1, { removido_em: t0 }), doze(2, { estado: 'integrado', numero_erp: 'P' }), doze(3, { estado: 'cancelado' }), doze(4, { estado: 'rejeitado_erp' })];
    expect(selecionarPendentes(outros, t0).entregar).toEqual([]);
  });
});

describe('RN-INT-08: confirmação (retorno) idempotente', () => {
  const enviado = (extra: Partial<PedidoNaFila> = {}) => naFila({ estado: 'enviado', enviado_em: t0, tentativas: 1, ...extra });

  it('RN-INT-08: enviado → integrado grava o número do ERP e publica; repetir devolve repetido sem publicar', () => {
    const r = aplicarRetornoPedido(enviado(), retorno({}));
    expect(r).toMatchObject({ ok: true, repetido: false, publicar: true, atualizacao: { estado: 'integrado', numero_erp: 'P-1' } });
    if (r.ok) {
      expect(r.evento).toMatchObject({ pedido_uuid: UUID, status: 'integrado', numero_erp: 'P-1', motivo: null, nota: null });
      const de = enviado({ estado: 'integrado', numero_erp: 'P-1' });
      expect(aplicarRetornoPedido(de, retorno({}))).toMatchObject({ ok: true, repetido: true, publicar: false });
    }
  });

  it('RN-INT-08: número do ERP diferente do já gravado é recusado (o mesmo pedido não tem dois números)', () => {
    const r = aplicarRetornoPedido(enviado({ estado: 'integrado', numero_erp: 'P-1' }), retorno({ numero_erp: 'P-2' }));
    expect(r).toMatchObject({ ok: false, status: 422, codigo: 'numero_erp_divergente' });
  });

  it('RN-INT-08: confirmação que chega depois do timeout (pedido voltou a pendente mas já foi entregue) vale; pedido nunca entregue não', () => {
    expect(aplicarRetornoPedido(naFila({ estado: 'pendente', tentativas: 1 }), retorno({}))).toMatchObject({ ok: true, atualizacao: { estado: 'integrado' } });
    expect(aplicarRetornoPedido(naFila({ estado: 'pendente', tentativas: 0 }), retorno({}))).toMatchObject({ ok: false, codigo: 'pedido_nao_entregue' });
  });

  it('RN-INT-08: pedido desconhecido é 422 pedido_desconhecido (definitivo para o Conector)', () => {
    expect(aplicarRetornoPedido(null, retorno({}))).toMatchObject({ ok: false, status: 422, codigo: 'pedido_desconhecido' });
  });

  it('RN-INT-08: rejeitado_erp é final; depois dele só se aceita o mesmo retorno (idempotente); outro estado é transicao_invalida em português', () => {
    const rej = aplicarRetornoPedido(enviado(), retorno({ status: 'rejeitado_erp', numero_erp: undefined, motivo: 'cliente bloqueado' }));
    expect(rej).toMatchObject({ ok: true, atualizacao: { estado: 'rejeitado_erp', motivo: 'cliente bloqueado' } });
    const de = enviado({ estado: 'rejeitado_erp', motivo: 'cliente bloqueado' });
    expect(aplicarRetornoPedido(de, retorno({ status: 'rejeitado_erp', numero_erp: undefined, motivo: 'cliente bloqueado' }))).toMatchObject({ ok: true, repetido: true });
    const inv = aplicarRetornoPedido(de, retorno({}));
    expect(inv).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
    if (!inv.ok) expect(inv.mensagem).toMatch(/rejeitado_erp/);
  });

  it('RN-INT-08: cancelado vindo do ERP vale a partir de enviado, integrado e faturado_*, guarda o motivo (opcional), é final e idempotente; publica', () => {
    for (const estado of ['enviado', 'integrado', 'faturado_parcial', 'faturado_total'] as const) {
      const r = aplicarRetornoPedido(enviado({ estado, numero_erp: 'P-1' }), retorno({ status: 'cancelado', numero_erp: undefined, motivo: 'cancelado no ERP' }));
      expect(r, estado).toMatchObject({ ok: true, repetido: false, publicar: true, atualizacao: { estado: 'cancelado', motivo: 'cancelado no ERP' } });
    }
    expect(aplicarRetornoPedido(enviado({ estado: 'integrado', numero_erp: 'P-1' }), retorno({ status: 'cancelado', numero_erp: undefined }))).toMatchObject({ ok: true, atualizacao: { estado: 'cancelado', motivo: null } });
    const jaCancelado = enviado({ estado: 'cancelado', numero_erp: 'P-1', motivo: 'x' });
    expect(aplicarRetornoPedido(jaCancelado, retorno({ status: 'cancelado', numero_erp: undefined }))).toMatchObject({ ok: true, repetido: true, publicar: false });
    expect(aplicarRetornoPedido(jaCancelado, retorno({ status: 'faturado_total', nota: nota('9') }))).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
  });

  it('RN-INT-08: cancelado de pedido rejeitado pelo ERP é recusado', () => {
    expect(aplicarRetornoPedido(enviado({ estado: 'rejeitado_erp' }), retorno({ status: 'cancelado', numero_erp: undefined }))).toMatchObject({ ok: false, codigo: 'transicao_invalida' });
  });

  it('RN-INT-08: o evento publicado leva a nota, o motivo e os itens faturados', () => {
    const r = aplicarRetornoPedido(
      enviado({ estado: 'integrado', numero_erp: 'P-1' }),
      retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(1, 'SKU1', 4)] }),
    );
    expect(r.ok && r.evento).toMatchObject({ status: 'faturado_parcial', nota: { numero: '100', serie: '1' }, itens_faturados: [{ sequencia: 1, produto_external_id: 'SKU1', quantidade: 4, valor_cents: 100 }] });
  });
});

describe('RN-INT-08: faturamento por nota e itens_faturados', () => {
  const integrado = (extra: Partial<PedidoNaFila> = {}) => naFila({ estado: 'integrado', enviado_em: t0, tentativas: 1, numero_erp: 'P-1', ...extra });

  it('RN-INT-08: duas notas parciais diferentes são dois fatos; a mesma nota repetida é idempotente e não publica de novo', () => {
    const n1 = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(1, 'SKU1', 4)] }));
    expect(n1).toMatchObject({ ok: true, repetido: false, publicar: true });
    if (!n1.ok) return;
    const apos1 = integrado({ estado: 'faturado_parcial', notas_aplicadas: n1.atualizacao.notas_aplicadas, itens_faturados_acumulados: n1.atualizacao.itens_faturados_acumulados });
    expect(n1.atualizacao.notas_aplicadas).toEqual([{ numero: '100', serie: '1' }]);

    const repetida = aplicarRetornoPedido(apos1, retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(1, 'SKU1', 4)] }));
    expect(repetida).toMatchObject({ ok: true, repetido: true, publicar: false });
    if (repetida.ok) expect(repetida.atualizacao.itens_faturados_acumulados).toEqual(apos1.itens_faturados_acumulados);

    const n2 = aplicarRetornoPedido(apos1, retorno({ status: 'faturado_parcial', nota: nota('101'), itens_faturados: [item(1, 'SKU1', 3), item(2, 'SKU2', 4)] }));
    expect(n2).toMatchObject({ ok: true, repetido: false, publicar: true });
    if (n2.ok) {
      expect(n2.atualizacao.notas_aplicadas).toHaveLength(2);
      expect(n2.atualizacao.itens_faturados_acumulados).toEqual({ 1: { quantidade: 7, valor_cents: 200 }, 2: { quantidade: 4, valor_cents: 100 } });
    }
  });

  it('RN-INT-08: a mesma nota com série diferente é outra nota', () => {
    const base = integrado({ estado: 'faturado_parcial', notas_aplicadas: [{ numero: '100', serie: '1' }] });
    expect(aplicarRetornoPedido(base, retorno({ status: 'faturado_parcial', nota: nota('100', { serie: '2' }) }))).toMatchObject({ ok: true, repetido: false });
  });

  it('RN-INT-08: faturado_total fecha o pedido (inclusive direto de integrado) e repetir é idempotente', () => {
    const t = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_total', nota: nota('100') }));
    expect(t).toMatchObject({ ok: true, atualizacao: { estado: 'faturado_total' }, publicar: true });
    const de = integrado({ estado: 'faturado_total' });
    expect(aplicarRetornoPedido(de, retorno({ status: 'faturado_total', nota: nota('100') }))).toMatchObject({ ok: true, repetido: true, publicar: false });
  });

  it('RN-INT-08: itens_faturados com sequência que não existe no pedido enviado → 422 itens_faturados_invalidos', () => {
    const r = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(9, 'SKU1', 1)] }));
    expect(r).toMatchObject({ ok: false, status: 422, codigo: 'itens_faturados_invalidos' });
    if (!r.ok) expect(r.erros[0]).toMatchObject({ codigo: 'sequencia_inexistente', campo: 'itens_faturados[0].sequencia' });
  });

  it('RN-INT-08: produto do item diferente do produto enviado naquela sequência → 422 (confere pelo external_id)', () => {
    const r = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(1, 'OUTRO', 1)] }));
    expect(r).toMatchObject({ ok: false, codigo: 'itens_faturados_invalidos' });
    if (!r.ok) expect(r.erros[0]).toMatchObject({ codigo: 'produto_divergente', campo: 'itens_faturados[0].produto_external_id' });
  });

  it('RN-INT-08: soma faturada (retornos anteriores + este) acima da quantidade enviada → 422 quantidade_acima_do_saldo, com o saldo na mensagem', () => {
    const base = integrado({ estado: 'faturado_parcial', notas_aplicadas: [{ numero: '100', serie: '1' }], itens_faturados_acumulados: { 1: { quantidade: 8, valor_cents: 800 } } });
    const r = aplicarRetornoPedido(base, retorno({ status: 'faturado_parcial', nota: nota('101'), itens_faturados: [item(1, 'SKU1', 3)] }));
    expect(r).toMatchObject({ ok: false, codigo: 'itens_faturados_invalidos' });
    if (!r.ok) {
      expect(r.erros[0]?.codigo).toBe('quantidade_acima_do_saldo');
      expect(r.erros[0]?.mensagem).toMatch(/saldo.*2/);
    }
    // exatamente o saldo passa
    expect(aplicarRetornoPedido(base, retorno({ status: 'faturado_parcial', nota: nota('101'), itens_faturados: [item(1, 'SKU1', 2)] }))).toMatchObject({ ok: true });
  });

  it('RN-INT-08: todos os problemas dos itens voltam juntos', () => {
    const r = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(9, 'SKU1', 1), item(2, 'X', 1), item(1, 'SKU1', 999)] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.map((e) => e.codigo)).toEqual(['sequencia_inexistente', 'produto_divergente', 'quantidade_acima_do_saldo']);
  });

  it('RN-INT-08: faturado sem itens_faturados continua aceito (o campo é opcional); só não alimenta o acumulado', () => {
    const r = aplicarRetornoPedido(integrado(), retorno({ status: 'faturado_parcial', nota: nota('100') }));
    expect(r).toMatchObject({ ok: true, publicar: true });
    if (r.ok) expect(r.atualizacao.itens_faturados_acumulados).toEqual({});
  });

  it('RN-INT-08: retorno repetido não revalida os itens (o fato já foi aplicado)', () => {
    const base = integrado({ estado: 'faturado_parcial', notas_aplicadas: [{ numero: '100', serie: '1' }], itens_faturados_acumulados: { 1: { quantidade: 10, valor_cents: 800 } } });
    expect(aplicarRetornoPedido(base, retorno({ status: 'faturado_parcial', nota: nota('100'), itens_faturados: [item(1, 'SKU1', 10)] }))).toMatchObject({ ok: true, repetido: true });
  });
});
