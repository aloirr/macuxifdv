import { describe, expect, it } from 'vitest';
import type { ContextoBase } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { tituloVencidoDias, validadeOrcamentoDias } from '../domain';
import { rotasParametrosPedidos } from './parametros-pedidos';

const [GET, PUT] = rotasParametrosPedidos as [(typeof rotasParametrosPedidos)[number], (typeof rotasParametrosPedidos)[number]];

function ctx(corpo: unknown, parametros: Record<string, unknown> = {}) {
  const gravado: Array<Record<string, unknown>> = [];
  const c = {
    corpo,
    parametros: () => ({ ...parametros, ...Object.assign({}, ...gravado) }),
    gravarParametros: async (v: Record<string, unknown>) => void gravado.push(v),
  } as unknown as ContextoBase;
  return { c, gravado };
}

describe('Parâmetros › Pedidos: validade do orçamento e dias de atraso', () => {
  it('RN-VEN-18: sem parâmetro gravado o GET devolve os padrões do domain (7 e 5)', async () => {
    expect(await GET.executar(ctx(undefined).c as never)).toEqual({ validade_orcamento_dias: 7, titulo_vencido_dias: 5 });
  });
  it('RN-VEN-18 e RN-VEN-13: o PUT grava as chaves que o domain lê e devolve os valores novos', async () => {
    const { c, gravado } = ctx({ validade_orcamento_dias: 15, titulo_vencido_dias: 0 });
    expect(await PUT.executar(c as never)).toEqual({ validade_orcamento_dias: 15, titulo_vencido_dias: 0 });
    expect(gravado).toEqual([{ 'orcamento.validade_dias': 15, titulo_vencido_dias: 0 }]);
    expect([validadeOrcamentoDias(gravado[0]!), tituloVencidoDias(gravado[0]!)]).toEqual([15, 0]);
  });
  it('RN-VEN-18: gravação parcial só grava a chave enviada', async () => {
    const { c, gravado } = ctx({ titulo_vencido_dias: 30 });
    await PUT.executar(c as never);
    expect(gravado).toEqual([{ titulo_vencido_dias: 30 }]);
  });
  it('RN-VEN-18: validade fora de 1 a 90 (0, 91, 1,5, -1) é recusada sem gravar', async () => {
    for (const v of [0, 91, 1.5, -1]) {
      const { c, gravado } = ctx({ validade_orcamento_dias: v });
      await expect(PUT.executar(c as never), String(v)).rejects.toMatchObject({ codigo: 'RN-VEN-18' });
      expect(gravado).toEqual([]);
    }
  });
  it('RN-VEN-13: atraso fora de 0 a 365 (-1, 366) é recusado; 0 e 365 passam', async () => {
    for (const v of [-1, 366]) await expect(PUT.executar(ctx({ titulo_vencido_dias: v }).c as never), String(v)).rejects.toMatchObject({ codigo: 'RN-VEN-13' });
    for (const v of [0, 365]) expect(await PUT.executar(ctx({ titulo_vencido_dias: v }).c as never)).toMatchObject({ titulo_vencido_dias: v });
  });
  it('RN-VEN-18: corpo vazio é recusado', async () => {
    await expect(PUT.executar(ctx({}).c as never)).rejects.toMatchObject({ codigo: 'RN-VEN-18' });
  });
  it('RN-PRO-01: só admin, analista e gerente, nas duas rotas; o promotor nunca', () => {
    expect(rotasParametrosPedidos.map((r) => [r.metodo, r.caminho, r.acao])).toEqual([
      ['GET', 'parametros/pedidos', 'parametro.pedidos'],
      ['PUT', 'parametros/pedidos', 'parametro.pedidos'],
    ]);
    expect(manifest.acoes['parametro.pedidos']!.perfis).toEqual(['admin', 'analista', 'gerente']);
  });
});
