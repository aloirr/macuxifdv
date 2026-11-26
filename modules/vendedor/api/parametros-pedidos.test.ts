import { describe, expect, it } from 'vitest';
import { ErroHttpModulo, type ContextoBase } from '@macuxi/platform-sdk';
import { ParametrosPedidosSchema } from '../contracts';
import manifest from '../manifest';
import { rotaGravarParametrosPedidos, rotaLerParametrosPedidos } from './parametros-pedidos';

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
    expect(await rotaLerParametrosPedidos.executar(ctx(undefined).c as never)).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 7 });
    expect(await rotaLerParametrosPedidos.executar(ctx(undefined, { titulo_vencido_dias: 12, validade_orcamento_dias: 30 }).c as never)).toEqual({ titulo_vencido_dias: 12, validade_orcamento_dias: 30 });
  });
  it('RN-VEN-13 e RN-VEN-18: o PUT aceita as duas chaves, grava com a ação de auditoria e devolve o estado', async () => {
    const { c, gravado } = ctx({ titulo_vencido_dias: 0, validade_orcamento_dias: 90 });
    expect(await rotaGravarParametrosPedidos.executar(c as never)).toEqual({ titulo_vencido_dias: 0, validade_orcamento_dias: 90 });
    expect(gravado).toEqual([{ v: { titulo_vencido_dias: 0, validade_orcamento_dias: 90 }, o: { acao: 'alcada.gerenciar' } }]);
  });
  it('RN-VEN-13 e RN-VEN-18: o PUT parcial grava só a chave enviada e mantém a outra na resposta', async () => {
    const a = ctx({ titulo_vencido_dias: 12 }, { validade_orcamento_dias: 30 });
    expect(await rotaGravarParametrosPedidos.executar(a.c as never)).toEqual({ titulo_vencido_dias: 12, validade_orcamento_dias: 30 });
    expect(a.gravado).toEqual([{ v: { titulo_vencido_dias: 12 }, o: { acao: 'alcada.gerenciar' } }]);
    const b = ctx({ validade_orcamento_dias: 45 });
    expect(await rotaGravarParametrosPedidos.executar(b.c as never)).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 45 });
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
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7 }).success).toBe(true);
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, outra: 1 }).success).toBe(false);
    expect(ParametrosPedidosSchema.safeParse({ titulo_vencido_dias: 5, validade_orcamento_dias: 7.5 }).success).toBe(false);
  });
});
