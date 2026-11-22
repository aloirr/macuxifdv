/**
 * T-0089 (desenho §4.2/§4.3): forma de pagamento, prazo e tabela escalonada no Hub v1; cliente com formas permitidas e prazo médio
 * máximo; ordem de carga; e o pedido novo saindo ao ERP com `pagamento`.
 */
import { describe, expect, it } from 'vitest';
import { CAMPO_SOMA_CONTROLE, ClientePayload, ENTIDADES, EVENTOS_ATUALIZADO, PedidoAprovadoParaFila, PagamentoErp, PedidoParaErp, VERSAO_CONTRATO } from '../contracts';
import { validarLinhas } from './idempotencia';
import { siglasDeMedidaDoRegistro, verificarMedidas } from './medidas';
import { DEPENDENCIAS, ordenarCarga, referenciasDoRegistro, verificarReferencias } from './ordem';
import { avisoPrazoMedioDivergente, prazoMedioCalculado } from './pagamento';
import { decidirEntradaNaFila, montarPedidoParaErp, montarSnapshotParaFila, selecionarPendentes } from './pedido-fila';
import { exigeConector } from './pedido-versao';

const T = '2026-11-06T12:00:00Z';
const base = { alterado_em: T };
const UUID = '55555555-5555-4555-8555-555555555555';

describe('RN-INT-09 / RN-VEN-24: entidades de pagamento e escalonada entram aditivas no v1', () => {
  it('as 3 entidades existem, têm evento atualizado@1 e soma de controle (nula, nula, preco_unidade_cents)', () => {
    for (const e of ['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'] as const) {
      expect(ENTIDADES).toContain(e);
      expect(EVENTOS_ATUALIZADO[e]).toBeDefined();
    }
    expect(CAMPO_SOMA_CONTROLE).toMatchObject({ forma_pagamento: null, prazo_pagamento: null, tabela_escalonada: 'preco_unidade_cents' });
  });

  it('RN-CORE-19 / 0037: medida da faixa escalonada é sigla de 1 a 4 letras (check tabela_escalonada_medida_formato); em branco = unidade base', () => {
    const l = { alterado_em: T, produto_external_id: 'P1', quantidade_minima: 10, preco_unidade_cents: 500, vigencia_inicio: '2026-11-01' };
    const r = validarLinhas('tabela_escalonada', [
      { ...l, external_id: 'E1', medida: ' cx ' },
      { ...l, external_id: 'E2', medida: 'caixa grande' },
      { ...l, external_id: 'E3', medida: '  ' },
    ]);
    expect(r.validas.map((v) => v.external_id)).toEqual(['E1', 'E3']);
    expect(r.erros.map((e) => e.external_id)).toEqual(['E2']);
  });

  it('RN-INT-03: forma exige código e nome; ordem padrão 0', () => {
    const r = validarLinhas('forma_pagamento', [
      { ...base, external_id: 'F1', codigo: 'BOLETO', nome: 'Boleto' },
      { ...base, external_id: 'F2', codigo: 'PIX' },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['F1']);
    expect((r.validas[0]?.registro as { ordem: number }).ordem).toBe(0);
    expect(r.erros[0]?.campo).toBe('nome');
  });

  it('RN-VEN-24: parcelas_dias não pode decrescer (30/60/90 vale; 60/30 vira erro de linha legível)', () => {
    const r = validarLinhas('prazo_pagamento', [
      { ...base, external_id: 'P1', forma_external_id: 'F1', codigo: '30-60-90', parcelas_dias: [30, 60, 90] },
      { ...base, external_id: 'P2', forma_external_id: 'F1', codigo: '60-30', parcelas_dias: [60, 30] },
      { ...base, external_id: 'P3', forma_external_id: 'F1', codigo: 'VAZIO', parcelas_dias: [] },
      { ...base, external_id: 'P4', forma_external_id: 'F1', codigo: 'LONGO', parcelas_dias: [366] },
      { ...base, external_id: 'P5', forma_external_id: 'F1', codigo: 'AVISTA', parcelas_dias: [0] },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['P1', 'P5']);
    expect(r.erros.map((e) => e.external_id)).toEqual(['P2', 'P3', 'P4']);
    expect(r.erros[0]?.mensagem).toContain('decrescer');
  });

  it('RN-VEN-24: o prazo médio é calculado pelo Macuxi (28/56 = 42; 30/45 = 38) e divergente do ERP vira aviso, nunca erro', () => {
    expect(prazoMedioCalculado([28, 56])).toBe(42);
    expect(prazoMedioCalculado([30, 45])).toBe(38);
    expect(prazoMedioCalculado([0])).toBe(0);
    const r = validarLinhas('prazo_pagamento', [
      { ...base, external_id: 'P1', forma_external_id: 'F1', codigo: '28-56', parcelas_dias: [28, 56], prazo_medio_dias: 40 },
      { ...base, external_id: 'P2', forma_external_id: 'F1', codigo: '30', parcelas_dias: [30], prazo_medio_dias: 30 },
      { ...base, external_id: 'P3', forma_external_id: 'F1', codigo: '28', parcelas_dias: [28] },
    ]);
    expect(r.validas).toHaveLength(3);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ indice: 0, external_id: 'P1', codigo: 'prazo_medio_divergente' });
    expect(r.avisos[0]?.mensagem).toContain('42');
    expect(avisoPrazoMedioDivergente({ external_id: 'X', parcelas_dias: [10], prazo_medio_dias: 10 })).toBeNull();
  });

  it('RN-VEN-23: tabela escalonada exige quantidade mínima > 0 e preço da unidade > 0; fim da vigência não antecede o início', () => {
    const ok = { ...base, produto_external_id: 'PR1', quantidade_minima: 10, preco_unidade_cents: 950, vigencia_inicio: '2026-11-01' };
    const r = validarLinhas('tabela_escalonada', [
      { ...ok, external_id: 'E1', medida: 'cx' },
      { ...ok, external_id: 'E2', quantidade_minima: 0 },
      { ...ok, external_id: 'E3', preco_unidade_cents: 0 },
      { ...ok, external_id: 'E4', vigencia_fim: '2026-10-01' },
      { ...ok, external_id: 'E5', tabela_external_id: 'TAB1', vigencia_fim: '2026-12-31' },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['E1', 'E5']);
    expect(r.erros.map((e) => e.campo)).toEqual(['quantidade_minima', 'preco_unidade_cents', 'vigencia_fim']);
  });

  it('RN-CORE-19: a medida da faixa é conferida com as medidas do tenant (sigla desconhecida = referencia_ausente)', () => {
    expect(siglasDeMedidaDoRegistro('tabela_escalonada', { medida: ' fd ' })).toEqual([{ campo: 'medida', sigla: 'FD' }]);
    expect(siglasDeMedidaDoRegistro('tabela_escalonada', {})).toEqual([]);
    const v = verificarMedidas('tabela_escalonada', [{ indice: 0, external_id: 'E1', registro: { medida: 'XX' } }], new Set(['UN', 'CX']));
    expect(v.aceitas).toHaveLength(0);
    expect(v.erros[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'medida' });
  });
});

describe('RN-INT-09: cliente com formas permitidas e prazo médio máximo (aditivo)', () => {
  const cli = { ...base, external_id: 'C1', razao_social: 'Mercado Boa Vista' };

  it('o contrato antigo (sem os 2 campos) continua válido e os campos ficam ausentes', () => {
    const r = ClientePayload.parse(cli);
    expect(r.prazo_medio_max_dias).toBeUndefined();
    expect(r.formas_pagamento).toBeUndefined();
  });

  it('aceita prazo_medio_max_dias de 0 a 365 e formas por código; null limpa', () => {
    expect(ClientePayload.parse({ ...cli, prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] })).toMatchObject({ prazo_medio_max_dias: 45, formas_pagamento: ['PIX', 'BOLETO'] });
    expect(ClientePayload.parse({ ...cli, prazo_medio_max_dias: null, formas_pagamento: null })).toMatchObject({ prazo_medio_max_dias: null, formas_pagamento: null });
    expect(ClientePayload.safeParse({ ...cli, prazo_medio_max_dias: 366 }).success).toBe(false);
    expect(ClientePayload.safeParse({ ...cli, prazo_medio_max_dias: 30.5 }).success).toBe(false);
  });
});

describe('RN-INT-04: ordem de carga das entidades de pagamento', () => {
  it('forma antes de prazo; produto antes da faixa; cliente depois das formas', () => {
    const r = ordenarCarga<string>(['cliente', 'tabela_escalonada', 'prazo_pagamento', 'produto', 'forma_pagamento', 'vendedor']);
    expect(r.ok).toBe(true);
    const o = r.ok ? r.ordem : [];
    expect(o.indexOf('forma_pagamento')).toBeLessThan(o.indexOf('prazo_pagamento'));
    expect(o.indexOf('produto')).toBeLessThan(o.indexOf('tabela_escalonada'));
    expect(o.indexOf('forma_pagamento')).toBeLessThan(o.indexOf('cliente'));
    expect(DEPENDENCIAS.prazo_pagamento).toEqual(['forma_pagamento']);
  });

  it('prazo sem forma e faixa sem produto = referencia_ausente reprocessável', () => {
    expect(referenciasDoRegistro('prazo_pagamento', { forma_external_id: 'F1' })).toEqual([{ entidade: 'forma_pagamento', campo: 'forma_external_id', external_id: 'F1' }]);
    const p = verificarReferencias('prazo_pagamento', [{ indice: 0, external_id: 'P1', registro: { forma_external_id: 'F9' } }], { forma_pagamento: new Set(['F1']) });
    expect(p.aceitas).toHaveLength(0);
    expect(p.erros[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'forma_external_id' });
    const e = verificarReferencias('tabela_escalonada', [{ indice: 0, external_id: 'E1', registro: { produto_external_id: 'PR9' } }], { produto: new Set(['PR1']) });
    expect(e.erros[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'produto_external_id' });
  });
});

describe('RN-INT-08 / RN-VEN-24: pedido novo ao ERP leva forma, prazo e prazo médio', () => {
  const pagamento = { forma_codigo: 'BOLETO', forma_external_id: 'FP-BOL', prazo_codigo: '28-56', prazo_external_id: 'PZ-2856', parcelas_dias: [28, 56], prazo_medio_dias: 42 };
  const item = { sequencia: 1, produto_external_id: 'P1', quantidade: 2, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 1000 };
  const origem = (extra: Record<string, unknown> = {}) =>
    PedidoAprovadoParaFila.parse({ pedido_uuid: UUID, cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T, itens: [item], total_cents: 1000, ...extra });

  it('a condição vem do prazo_external_id e o payload sai com pagamento, sem exigir Conector novo', () => {
    const m = montarPedidoParaErp(origem({ condicao_pagamento_codigo: '28-56', pagamento }), []);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.pedido.condicao_pagamento_erp).toBe('PZ-2856');
    expect(m.pedido.pagamento).toEqual(pagamento);
    expect(exigeConector(m.pedido)).toBeNull();
    expect(PedidoParaErp.parse(m.pedido).versao_contrato).toBe(VERSAO_CONTRATO);
  });

  it('sem prazo_external_id usa o de-para pelo código do prazo; sem de-para fica retido como hoje', () => {
    const semChave = { ...pagamento, prazo_external_id: null };
    const com = montarPedidoParaErp(origem({ condicao_pagamento_codigo: '28-56', pagamento: semChave }), [{ tipo: 'condicao_pagamento', codigo_erp: 'ERP28', codigo_macuxi: '28-56', ativo: true }]);
    expect(com.ok && com.pedido.condicao_pagamento_erp).toBe('ERP28');
    expect(com.ok && com.pedido.pagamento?.prazo_medio_dias).toBe(42);
    const sem = montarPedidoParaErp(origem({ condicao_pagamento_codigo: '28-56', pagamento: semChave }), []);
    expect(sem).toMatchObject({ ok: false, codigo: 'mapeamento_ausente' });
  });

  it('RN-INT-08: o pedido aprovado entra na fila (criar) com condicao_pagamento_erp e pagamento, e sai em /pedidos/pendentes com os dois', () => {
    const d = decidirEntradaNaFila({ existente: null, statusPedido: 'aprovado', snapshot: origem({ condicao_pagamento_codigo: '28-56', pagamento }), mapeamentos: [] });
    expect(d.acao).toBe('criar');
    if (d.acao !== 'criar') return;
    expect(d.pedido).toMatchObject({ condicao_pagamento_erp: 'PZ-2856', pagamento: { forma_codigo: 'BOLETO', parcelas_dias: [28, 56], prazo_medio_dias: 42 } });
    const fila = [{ pedido_uuid: UUID, estado: 'pendente' as const, tentativas: 0, enviado_em: null, removido_em: null, retencao_codigo: null, payload: d.pedido }];
    const s = selecionarPendentes(fila as unknown as Parameters<typeof selecionarPendentes>[0], T);
    expect(s.entregar).toHaveLength(1);
    expect(s.entregar[0]).toMatchObject({ condicao_pagamento_erp: 'PZ-2856', pagamento: { prazo_external_id: 'PZ-2856' } });
  });

  it('pedido antigo (sem pagamento) sai sem a chave e com o mesmo payload de antes', () => {
    const m = montarPedidoParaErp(origem(), []);
    expect(m.ok && 'pagamento' in m.pedido).toBe(false);
  });

  it('o snapshot do evento aprovado@1 do Vendedor preserva pagamento até a fila', () => {
    const r = montarSnapshotParaFila({
      pedido_uuid: UUID, cliente_external_id: 'C1', vendedor_external_id: 'V1', condicao_pagamento_codigo: '28-56', pagamento,
      criado_em: T, aprovado_em: T, observacao: null, itens: [item], desconto_total_cents: 0, total_cents: 1000,
    } as Parameters<typeof montarSnapshotParaFila>[0]);
    expect(r.ok && r.snapshot.pagamento).toEqual(pagamento);
  });

  it('pagamento fora do contrato (parcelas vazias) retém o pedido por cadastro, sem perdê-lo', () => {
    const r = montarSnapshotParaFila({
      pedido_uuid: UUID, cliente_external_id: 'C1', vendedor_external_id: 'V1', condicao_pagamento_codigo: null, pagamento: { ...pagamento, parcelas_dias: [] },
      criado_em: T, aprovado_em: T, observacao: null, itens: [item], desconto_total_cents: 0, total_cents: 1000,
    } as unknown as Parameters<typeof montarSnapshotParaFila>[0]);
    expect(r.ok).toBe(false);
  });
});

describe('RN-INT-15: percentual de ajuste do prazo ("% Acres.Fin." do ERP), aditivo no v1', () => {
  const prazo = { external_id: 'PRZ-1', alterado_em: T, forma_external_id: 'FPG-1', codigo: 'AVISTA', parcelas_dias: [0] };

  it('RN-INT-15: ausente vale 0 e a linha continua válida (RN-INT-09)', () => {
    const r = validarLinhas('prazo_pagamento', [prazo, { ...prazo, external_id: 'PRZ-2', percentual_ajuste: null }]);
    expect(r.erros).toEqual([]);
    expect(r.validas).toHaveLength(2);
  });

  it('RN-INT-15: aceita -1,71 (à vista), 0 e os limites -99,99 e +99,99', () => {
    const r = validarLinhas('prazo_pagamento', [-1.71, 0, -99.99, 99.99].map((p, i) => ({ ...prazo, external_id: `P${i}`, percentual_ajuste: p })));
    expect(r.erros).toEqual([]);
  });

  it('RN-INT-15: fora da faixa ou com mais de 2 casas é erro de linha', () => {
    const r = validarLinhas('prazo_pagamento', [100, -100, 1.234, 99.995].map((p, i) => ({ ...prazo, external_id: `P${i}`, percentual_ajuste: p })));
    expect(r.validas).toEqual([]);
    expect(r.erros).toHaveLength(4);
  });

  it('RN-INT-15: o pagamento do pedido ao ERP leva percentual_ajuste só como informação (opcional, mesma faixa)', () => {
    const pag = { forma_codigo: 'PIX', prazo_codigo: 'AVISTA', parcelas_dias: [0], prazo_medio_dias: 0 };
    expect(PagamentoErp.safeParse(pag).success).toBe(true);
    expect(PagamentoErp.safeParse({ ...pag, percentual_ajuste: -1.71 }).success).toBe(true);
    expect(PagamentoErp.safeParse({ ...pag, percentual_ajuste: 100 }).success).toBe(false);
    expect(PagamentoErp.safeParse({ ...pag, percentual_ajuste: 1.005 }).success).toBe(false);
  });
});
