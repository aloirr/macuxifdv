import { describe, expect, it } from 'vitest';
import type { EtapaSync } from '@macuxi/platform-sdk';

import { etapasCore } from './cargas';

function rodar(id: string, erro: unknown, usuario: { perfil?: string; fuso?: string } | null = null) {
  const etapa = etapasCore.find((e) => e.id === id) as EtapaSync;
  const gravados: unknown[] = [];
  const ctx = {
    http: { get: async () => { throw erro; } },
    usuario: () => usuario,
    agora: () => new Date('2026-10-15T12:00:00Z'),
    armazenamento: { ler: async () => null, gravar: async (_c: string, v: unknown) => { gravados.push(v); } },
  };
  return { p: etapa.executar(ctx as never), gravados };
}

describe('RN-CORE-15: cargas do Core só toleram rota inexistente', () => {
  it.each([
    ['404', { status: 404 }],
    ['501', { status: 501 }],
    ['SYNC_NAO_IMPLEMENTADO', { status: 400, code: 'SYNC_NAO_IMPLEMENTADO' }],
  ])('%s vira vazio', async (_n, erro) => {
    for (const id of ['metas', 'pedidos-da-visita']) {
      const { p, gravados } = rodar(id, erro);
      await p;
      expect(gravados).toHaveLength(1);
    }
  });
  it.each([
    ['401', { status: 401 }],
    ['403 MODULO_INATIVO', { status: 403, code: 'MODULO_INATIVO' }],
    ['403 PERFIL_SEM_ACESSO', { status: 403, code: 'PERFIL_SEM_ACESSO' }],
    ['423 DISPOSITIVO_BLOQUEADO', { status: 423, code: 'DISPOSITIVO_BLOQUEADO' }],
  ])('%s não é engolido', async (_n, erro) => {
    for (const id of ['metas', 'pedidos-da-visita']) {
      const { p, gravados } = rodar(id, erro);
      await expect(p).rejects.toBe(erro);
      expect(gravados).toHaveLength(0);
    }
  });
});

describe('D-5 na demonstração: metas só para quem tem meta', () => {
  const mock400 = { status: 400, code: 'validation_error' };
  it.each(['supervisor', 'gerente', 'promotor'])('%s: pula a carga de metas (o 400 do mock-api não derruba o Sincronizar)', async (perfil) => {
    const { p, gravados } = rodar('metas', mock400, { perfil });
    await p;
    expect(gravados).toEqual([null]);
  });
  it('vendedor: o 400 segue como erro (não é engolido)', async () => {
    const { p, gravados } = rodar('metas', mock400, { perfil: 'vendedor' });
    await expect(p).rejects.toBe(mock400);
    expect(gravados).toHaveLength(0);
  });
  it('fuso do pedido do mês vem do ambiente', async () => {
    const { p, gravados } = rodar('pedidos-da-visita', { status: 404 }, { fuso: 'America/Manaus' });
    await p;
    expect(gravados).toHaveLength(1);
  });
});

describe('RN-CORE-23 / RN-CORE-26: etapa core-inicio (cópia de core.inicio@1 no aparelho)', () => {
  const copia = { dia: '2026-10-15', periodo: '2026-10', calculado_em: '2026-10-15T12:00:00.000Z', escopo: 'proprio', usuarios: [], metas_do_dia: [] };
  function rodarInicio(resposta: () => Promise<unknown>) {
    const etapa = etapasCore.find((e) => e.id === 'core-inicio') as EtapaSync;
    const gravados: unknown[] = [];
    const chamadas: string[] = [];
    const ctx = {
      http: { get: async (c: string) => { chamadas.push(c); return resposta(); } },
      armazenamento: { ler: async () => null, gravar: async (c: string, v: unknown) => { gravados.push([c, v]); } },
    };
    return { p: etapa.executar(ctx as never), gravados, chamadas };
  }
  it('grava a resposta válida na chave inicio', async () => {
    const { p, gravados, chamadas } = rodarInicio(async () => copia);
    await p;
    expect(chamadas).toEqual(['/core/inicio']);
    expect(gravados).toEqual([['inicio', copia]]);
  });
  it.each([['403', { status: 403 }], ['404', { status: 404 }], ['sem sinal', new Error('sem conexão')]])('%s mantém a cópia e não derruba o sync', async (_n, erro) => {
    const { p, gravados } = rodarInicio(async () => { throw erro; });
    await expect(p).resolves.toBeUndefined();
    expect(gravados).toHaveLength(0);
  });
  it('T-0076 C1: campo novo (campo_futuro) é ignorado e a cópia é gravada sem ele', async () => {
    const { p, gravados } = rodarInicio(async () => ({ ...copia, campo_futuro: 'x' }));
    await p;
    expect(gravados).toEqual([['inicio', copia]]);
  });
  it('resposta fora do contrato não sobrescreve a cópia', async () => {
    const { p, gravados } = rodarInicio(async () => ({ dia: 'ontem' }));
    await p;
    expect(gravados).toHaveLength(0);
  });
  it.each([401, 423])('%s sobe como erro (RN-CORE-15)', async (status) => {
    const { p } = rodarInicio(async () => { throw { status }; });
    await expect(p).rejects.toEqual({ status });
  });
});
