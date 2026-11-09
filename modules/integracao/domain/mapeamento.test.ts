import { describe, expect, it } from 'vitest';
import type { PedidoAprovadoEvento } from '../../vendedor/contracts';
import { condicoesSemCorrespondente, liberarRetidosPorMapeamento, validarMapeamento, type MapeamentoGravado } from './mapeamento';

const ex = (o: Partial<MapeamentoGravado> = {}): MapeamentoGravado => ({ id: 'm1', tipo: 'condicao_pagamento', codigo_erp: '007', codigo_macuxi: '30DD', ativo: true, ...o });
const nova = { tipo: 'condicao_pagamento' as const, codigo_erp: '008', codigo_macuxi: '45DD', descricao: null, ativo: true };

const origem = (cond: string | null, extra: Record<string, unknown> = {}) =>
  ({
    pedido_uuid: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b',
    cliente_external_id: 'C1',
    vendedor_external_id: 'V1',
    condicao_pagamento_codigo: cond,
    criado_em: '2026-11-01T09:00:00.000Z',
    aprovado_em: '2026-11-01T09:30:00.000Z',
    itens: [{ sequencia: 1, produto_external_id: 'SKU1', quantidade: 1, preco_unitario_cents: 500, desconto_cents: 0, total_cents: 500 }],
    desconto_total_cents: 0,
    observacao: null,
    total_cents: 500,
    ...extra,
  }) as unknown as PedidoAprovadoEvento;

describe('T-0120: de-para da condição de pagamento', () => {
  it('RN-INT-08: aceita um correspondente novo para a condição do Macuxi', () => {
    expect(validarMapeamento(nova, [ex()])).toEqual({ ok: true, acao: 'criar' });
  });

  it('RN-INT-08: o mesmo código do ERP no mesmo tipo atualiza o existente em vez de duplicar', () => {
    expect(validarMapeamento({ ...nova, codigo_erp: '007', codigo_macuxi: '30DD' }, [ex()])).toEqual({ ok: true, acao: 'atualizar', id: 'm1' });
  });

  it('RN-INT-08: condição do Macuxi com outro correspondente ATIVO é recusada com a ação seguinte (inativar o outro)', () => {
    const r = validarMapeamento({ ...nova, codigo_macuxi: '30DD' }, [ex()]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensagem).toBe('A condição "30DD" já tem o código 007 do ERP ativo. Inative o de-para 007 antes de ativar outro, ou edite o existente.');
  });

  it('RN-INT-08: o outro correspondente inativo não impede; gravar inativo também passa', () => {
    expect(validarMapeamento({ ...nova, codigo_macuxi: '30DD' }, [ex({ ativo: false })]).ok).toBe(true);
    expect(validarMapeamento({ ...nova, codigo_macuxi: '30DD', ativo: false }, [ex()]).ok).toBe(true);
  });

  it('a unicidade por condição só vale para condicao_pagamento (depósito e status podem repetir o código do Macuxi)', () => {
    expect(validarMapeamento({ tipo: 'deposito', codigo_erp: 'D2', codigo_macuxi: 'CD', ativo: true }, [ex({ tipo: 'deposito', codigo_erp: 'D1', codigo_macuxi: 'CD' })]).ok).toBe(true);
  });

  it('RN-INT-08: o pedido retido sem de-para é liberado quando o correspondente é cadastrado (e só ele)', () => {
    const retidos = [
      { pedido_uuid: 'a', origem: origem('30DD') },
      { pedido_uuid: 'b', origem: origem('60DD') },
    ];
    const r = liberarRetidosPorMapeamento(retidos, [ex()]);
    expect(r.liberados.map((x) => x.pedido_uuid)).toEqual(['a']);
    expect(r.liberados[0]?.pedido.condicao_pagamento_erp).toBe('007');
    expect(r.continuamRetidos).toEqual([{ pedido_uuid: 'b', codigo: 'mapeamento_ausente', mensagem: expect.stringContaining('60DD') }]);
  });

  it('o monitor lista as condições do Macuxi sem correspondente ativo, sem repetir, em ordem', () => {
    const retidos = [
      { pedido_uuid: 'a', origem: origem('60DD') },
      { pedido_uuid: 'b', origem: origem('60DD') },
      { pedido_uuid: 'c', origem: origem('45DD') },
      { pedido_uuid: 'd', origem: origem('30DD') },
    ];
    expect(condicoesSemCorrespondente(retidos, [ex()])).toEqual([
      { codigo_macuxi: '45DD', pedidos: 1 },
      { codigo_macuxi: '60DD', pedidos: 2 },
    ]);
  });
});
