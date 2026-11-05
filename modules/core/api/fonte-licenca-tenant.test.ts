import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { fontePorConsulta } from './metas';

const Q = { usuario_ids: ['0b000000-0000-4000-8000-000000000001'], periodo: '2026-10' };
const RESPOSTA = {
  pedidos: [],
  faturamentos: [{ usuario_id: Q.usuario_ids[0], faturado_cents: 90_000 }],
};

/** Tx falso: só responde quando a chamada pede a licença do tenant; o Vendedor está na licença do tenant, mas não em quem consulta. */
const txSoPeloTenant = (chamadas: unknown[]) => ({
  consultar: async (_def: unknown, _q: unknown, opcoes?: { licenca?: string }) => {
    chamadas.push(opcoes);
    if (opcoes?.licenca !== 'tenant') throw new ConsultaIndisponivel('vendedor.pedidos_da_meta@1', 'vendedor');
    return RESPOSTA;
  },
});

describe('RN-CORE-27: leitura agregada pela licença do tenant (ADR 0025)', () => {
  it('RN-CORE-27: pede a consulta do Vendedor com { licenca: "tenant" }, sem depender dos módulos de quem consulta', async () => {
    const chamadas: unknown[] = [];
    const r = await fontePorConsulta(txSoPeloTenant(chamadas) as never)(Q);
    expect(chamadas).toEqual([{ licenca: 'tenant' }]);
    expect(r).toBe(RESPOSTA);
  });
  it('RN-CORE-29: a meta de faturamento continua vindo da consulta do Vendedor (faturamentos) mesmo sem o módulo em quem consulta', async () => {
    const r = await fontePorConsulta(txSoPeloTenant([]) as never)(Q);
    expect(r?.faturamentos).toEqual(RESPOSTA.faturamentos);
  });
  it('RN-CORE-27: Vendedor desligado no tenant (ConsultaIndisponivel) cai no read-model, devolvendo null', async () => {
    const tx = { consultar: async () => { throw new ConsultaIndisponivel('vendedor.pedidos_da_meta@1', 'vendedor'); } };
    expect(await fontePorConsulta(tx as never)(Q)).toBeNull();
  });
});
