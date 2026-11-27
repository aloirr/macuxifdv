import { describe, expect, it } from 'vitest';
import { ErroHttpModulo, type ContextoBase } from '@macuxi/platform-sdk';
import { ParametrosPedidosSchema } from '../contracts';
import manifest from '../manifest';
import { rotaGravarParametrosPedidos, rotaLerParametrosPedidos } from './parametros-pedidos';

const PADRAO = { pedido_minimo_cents: 0, credito_excedido_acao: 'aprovacao', estoque_insuficiente_acao: 'orcamento' } as const;

function ctx(corpo: unknown, parametros: Record<string, unknown> = {}) {
  const gravado: Array<{ v: Record<string, unknown>; o: unknown }> = [];
  const c = { corpo, parametros: () => parametros, gravarParametros: async (v: Record<string, unknown>, o: unknown) => void gravado.push({ v, o }) } as unknown as ContextoBase;
  return { c, gravado };
}

describe('RN-VEN-13 e RN-VEN-18: Parâmetros › Pedidos (títulos e orçamentos)', () => {
  it('RN-PRO-01: GET e PUT /parametros/pedidos exigem alcada.gerenciar, só admin, analista e gerente; o promotor nunca', () => {
    expect(rotaLerParametrosPedidos).toMatchObject({ metodo: 'GET', caminho: 'parametros/pedidos', acao: 'alcada.gerenciar' });
    expect(rotaGravarParametrosPedidos).toMatchObject({ metodo: 'PUT', caminho: 'parametros/pedidos', acao: 'alcada.gerenciar' });
    expect(manifest.acoes['alcada.gerenciar']!.perfis).toEqual(['admin', 'analista', 'gerente']);
  });
  it('RN-VEN-13: o GET devolve o padrão sem parâmetros e o valor do tenant com eles', async () => {
    expect(await rotaLerParametrosPedidos.executar(ctx(undefined).c as never)).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...PADRAO });
    expect(await rotaLerParametrosPedidos.executar(ctx(undefined, { titulo_vencido_dias: 12, validade_orcamento_dias: 30 }).c as never)).toEqual({ titulo_vencido_dias: 12, validade_orcamento_dias: 30, ...PADRAO });
  });
  it('RN-VEN-13 e RN-VEN-18: o PUT aceita as duas chaves, grava com a ação de auditoria e devolve o estado', async () => {
    const { c, gravado } = ctx({ titulo_vencido_dias: 0, validade_orcamento_dias: 90 });
    expect(await rotaGravarParametrosPedidos.executar(c as never)).toEqual({ titulo_vencido_dias: 0, validade_orcamento_dias: 90, ...PADRAO });
    expect(gravado).toEqual([{ v: { titulo_vencido_dias: 0, validade_orcamento_dias: 90 }, o: { acao: 'alcada.gerenciar' } }]);
  });
  it('RN-VEN-13 e RN-VEN-18: o PUT parcial grava só a chave enviada e mantém a outra na resposta', async () => {
    const a = ctx({ titulo_vencido_dias: 12 }, { validade_orcamento_dias: 30 });
    expect(await rotaGravarParametrosPedidos.executar(a.c as never)).toEqual({ titulo_vencido_dias: 12, validade_orcamento_dias: 30, ...PADRAO });
    expect(a.gravado).toEqual([{ v: { titulo_vencido_dias: 12 }, o: { acao: 'alcada.gerenciar' } }]);
    const b = ctx({ validade_orcamento_dias: 45 });
    expect(await rotaGravarParametrosPedidos.executar(b.c as never)).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 45, ...PADRAO });
    expect(b.gravado).toEqual([{ v: { validade_orcamento_dias: 45 }, o: { acao: 'alcada.gerenciar' } }]);
  });
  it('RN-VEN-13 e RN-VEN-18: corpo vazio ou fora da faixa responde 422 com a regra e não grava', async () => {
    for (const [corpo, codigo] of [
      [{ titulo_vencido_dias: 366 }, 'RN-VEN-13'],
      [{ validade_orcamento_dias: 91 }, 'RN-VEN-18'],
      [{}, 'RN-VEN-13'],
    ] as const) {
      const { c, gravado } = ctx(corpo);
      const e = await Promise.resolve(rotaGravarParametrosPedidos.executar(c as never)).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(ErroHttpModulo);
      expect(e).toMatchObject({ status: 422, codigo });
      expect(gravado).toEqual([]);
    }
  });
  it('RN-VEN-13 e RN-VEN-18: o contrato de resposta é estrito', () => {
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...PADRAO }).success).toBe(true);
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...PADRAO, outra: 1 }).success).toBe(false);
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7.5, ...PADRAO }).success).toBe(false);
  });
  it('RN-VEN-22, RN-VEN-12 e RN-VEN-20: o GET devolve o valor gravado das três chaves novas', async () => {
    const p = { pedido_minimo_cents: 150000, credito_excedido_acao: 'orcamento', estoque_insuficiente_acao: 'aprovacao' };
    expect(await rotaLerParametrosPedidos.executar(ctx(undefined, p).c as never)).toMatchObject(p);
  });
  it('RN-VEN-22, RN-VEN-12 e RN-VEN-20: o PUT grava as três chaves, cada uma sozinha ou juntas, e mantém as outras na resposta', async () => {
    const a = ctx({ pedido_minimo_cents: 150000 });
    expect(await rotaGravarParametrosPedidos.executar(a.c as never)).toMatchObject({ pedido_minimo_cents: 150000, credito_excedido_acao: 'aprovacao' });
    expect(a.gravado).toEqual([{ v: { pedido_minimo_cents: 150000 }, o: { acao: 'alcada.gerenciar' } }]);
    const b = ctx({ credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'aprovacao' }, { pedido_minimo_cents: 5000 });
    expect(await rotaGravarParametrosPedidos.executar(b.c as never)).toMatchObject({ pedido_minimo_cents: 5000, credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'aprovacao' });
    expect(b.gravado).toEqual([{ v: { credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'aprovacao' }, o: { acao: 'alcada.gerenciar' } }]);
  });
  it('RN-VEN-22: voltar para "Sem pedido mínimo" grava 0', async () => {
    const a = ctx({ pedido_minimo_cents: 0 }, { pedido_minimo_cents: 150000 });
    expect(await rotaGravarParametrosPedidos.executar(a.c as never)).toMatchObject({ pedido_minimo_cents: 0 });
    expect(a.gravado[0]!.v).toEqual({ pedido_minimo_cents: 0 });
  });
  it('RN-VEN-22, RN-VEN-12 e RN-VEN-20: valor fora da faixa ou ação desconhecida responde 422 com a regra e não grava', async () => {
    for (const [corpo, codigo] of [
      [{ pedido_minimo_cents: 10_000_001 }, 'RN-VEN-22'],
      [{ pedido_minimo_cents: -1 }, 'RN-VEN-22'],
      [{ pedido_minimo_cents: 15.5 }, 'RN-VEN-22'],
      [{ credito_excedido_acao: 'cortar' }, 'RN-VEN-12'],
      [{ estoque_insuficiente_acao: 'cortar' }, 'RN-VEN-20'],
      [{ titulo_vencido_dias: 5, estoque_insuficiente_acao: 'x' }, 'RN-VEN-20'],
    ] as const) {
      const { c, gravado } = ctx(corpo);
      const e = await Promise.resolve(rotaGravarParametrosPedidos.executar(c as never)).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 422, codigo });
      expect(gravado).toEqual([]);
    }
  });
});
