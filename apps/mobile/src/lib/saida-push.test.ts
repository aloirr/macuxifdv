/** RF-CORE-09 / RN-CORE-15 (R-20261102-174535 🟡 1): logout apaga o token do push no servidor; sem sinal, a saída fica na fila. */
import { describe, expect, it } from 'vitest';

import { filaDeSaidas, MAX_PENDENCIAS_SAIDA, reenviarSaidas, sairNoServidor, VALIDADE_PENDENCIA_SAIDA_MS, type PendenciaSaida, type ResultadoChamada } from './saida-push';

const AGORA = Date.parse('2026-11-02T20:00:00Z');
const p = (refresh: string, msAtras = 0): PendenciaSaida => ({ refresh, dispositivo_id: '00000000-0000-4000-8000-000000000001', em: new Date(AGORA - msAtras).toISOString() });

describe('sairNoServidor', () => {
  it('apaga o push ANTES de revogar e conclui com os dois ok', async () => {
    const ordem: string[] = [];
    const r = await sairNoServidor({
      apagarPush: async () => (ordem.push('push'), 'ok'),
      revogar: async () => (ordem.push('revogar'), 'ok'),
    });
    expect(r).toBe('feito');
    expect(ordem).toEqual(['push', 'revogar']);
  });
  it('rota do push ausente ou recusada (404/401) não impede a revogação', async () => {
    let revogou = false;
    const r = await sairNoServidor({ apagarPush: async () => 'recusado', revogar: async () => ((revogou = true), 'ok') });
    expect(r).toBe('feito');
    expect(revogou).toBe(true);
  });
  it('sem sinal: a saída fica pendente (vai para a fila)', async () => {
    expect(await sairNoServidor({ apagarPush: async () => 'sem_sinal', revogar: async () => 'ok' })).toBe('pendente');
    expect(await sairNoServidor({ apagarPush: async () => 'ok', revogar: async () => 'sem_sinal' })).toBe('pendente');
    expect(await sairNoServidor({ apagarPush: () => Promise.reject(new Error('x')), revogar: async () => 'ok' })).toBe('pendente');
  });
  it('revogação recusada (refresh já inválido) não volta para a fila', async () => {
    expect(await sairNoServidor({ apagarPush: async () => 'ok', revogar: async () => 'recusado' })).toBe('feito');
  });
});

describe('filaDeSaidas', () => {
  it('acrescenta, tira repetida (mesmo refresh) e vencidas, e limita o tamanho', () => {
    expect(filaDeSaidas([p('a')], AGORA, p('a'))).toHaveLength(1);
    expect(filaDeSaidas([p('velha', VALIDADE_PENDENCIA_SAIDA_MS + 1)], AGORA, p('b')).map((x) => x.refresh)).toEqual(['b']);
    const muitas = Array.from({ length: 8 }, (_, i) => p(`r${i}`, 1000 * (8 - i)));
    const fila = filaDeSaidas(muitas, AGORA);
    expect(fila).toHaveLength(MAX_PENDENCIAS_SAIDA);
    expect(fila.at(-1)?.refresh).toBe('r7');
  });
  it('lixo no armazenamento vira fila vazia', () => {
    expect(filaDeSaidas(null, AGORA)).toEqual([]);
    expect(filaDeSaidas({} as unknown as PendenciaSaida[], AGORA)).toEqual([]);
    expect(filaDeSaidas([{ refresh: '', dispositivo_id: 'x', em: 'ontem' }], AGORA)).toEqual([]);
  });
});

describe('reenviarSaidas', () => {
  it('fica só o que continua sem sinal; recusadas e ok saem da fila', async () => {
    const resp: Record<string, ResultadoChamada> = { a: 'ok', b: 'sem_sinal', c: 'recusado' };
    const restam = await reenviarSaidas([p('a'), p('b'), p('c')], async (x) => resp[x.refresh] ?? 'ok');
    expect(restam.map((x) => x.refresh)).toEqual(['b']);
  });
});
