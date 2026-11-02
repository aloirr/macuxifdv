import { describe, expect, it } from 'vitest';
import { criarRelogio } from '@macuxi/comum/relogio';
import { INTERVALO_PADRAO_MIN, intervaloAutomaticoMs, podeSincronizarAgora, PROTECAO_PUXAR_MS } from './sincronizacao';

describe('RN-CORE-23: ritmo da atualização automática e proteção do puxar para baixo', () => {
  it('RN-CORE-23: sync_auto_min padrão 30 min; mínimo 15; valor inválido volta ao padrão', () => {
    expect(INTERVALO_PADRAO_MIN).toBe(30);
    expect(intervaloAutomaticoMs(undefined)).toBe(30 * 60_000);
    expect(intervaloAutomaticoMs(45)).toBe(45 * 60_000);
    expect(intervaloAutomaticoMs(5)).toBe(15 * 60_000); // nenhum timer abaixo de 15 min
    expect(intervaloAutomaticoMs('x')).toBe(30 * 60_000);
    expect(intervaloAutomaticoMs(-1)).toBe(30 * 60_000);
  });

  it('RN-CORE-23 item 5: puxar para baixo de novo em menos de 30 s não dispara outra sincronização', () => {
    const r = criarRelogio({ agora: '2026-11-03T15:00:00Z' });
    const ultimo = r.ms();
    expect(PROTECAO_PUXAR_MS).toBe(30_000);
    expect(podeSincronizarAgora(null, r.ms())).toBe(true);
    r.avancar({ segundos: 29 });
    expect(podeSincronizarAgora(ultimo, r.ms())).toBe(false);
    r.avancar({ segundos: 1 });
    expect(podeSincronizarAgora(ultimo, r.ms())).toBe(true);
  });
});
