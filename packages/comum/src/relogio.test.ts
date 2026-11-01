import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  criarRelogio,
  diaCivil,
  duracaoEmMs,
  instanteNoFuso,
  meioDiaNoFuso,
  relativo,
  relogioDoBanco,
  relogioReal,
  somarDiasCivis,
  VAR_AGORA,
} from './relogio';

// Este arquivo testa o próprio relógio: instantes fixos de propósito (nenhum é comparado com o relógio real, salvo
// onde marcado com hora-fixa-ok).
const VIRADA_MANAUS = '2026-11-04T03:59:00.000Z'; // 23:59 de 03/11 em Manaus

describe('criarRelogio (T-0043)', () => {
  afterEach(() => vi.useRealTimers());

  it('congela o instante dado e só anda com avancar/definir', () => {
    const r = criarRelogio({ agora: VIRADA_MANAUS });
    expect(r.iso()).toBe(VIRADA_MANAUS);
    expect(r.ms()).toBe(Date.parse(VIRADA_MANAUS));
    expect(r.agora()).not.toBe(r.agora()); // cópia: quem recebe não altera o relógio
    expect(r.avancar({ minutos: 2 }).toISOString()).toBe('2026-11-04T04:01:00.000Z');
    expect(r.avancar(-60_000).toISOString()).toBe('2026-11-04T04:00:00.000Z');
    expect(r.definir('2026-12-31T12:00:00Z').toISOString()).toBe('2026-12-31T12:00:00.000Z');
    expect(r.iso()).toBe('2026-12-31T12:00:00.000Z');
  });

  it('hoje/dia/instante seguem o fuso do tenant (Manaus por padrão), não o UTC', () => {
    const r = criarRelogio({ agora: VIRADA_MANAUS });
    expect(r.fuso).toBe('America/Manaus');
    expect(r.hoje()).toBe('2026-11-03'); // em UTC já seria 04/11
    expect(r.dia(-1)).toBe('2026-11-02');
    expect(r.dia(1)).toBe('2026-11-04');
    expect(r.instante().toISOString()).toBe('2026-11-03T16:00:00.000Z'); // 12:00 de Manaus
    expect(r.instante({ dias: -1, hora: '23:59' }).toISOString()).toBe('2026-11-03T03:59:00.000Z');
    r.avancar({ minutos: 1 });
    expect(r.hoje()).toBe('2026-11-04');
    const sp = criarRelogio({ agora: VIRADA_MANAUS, fuso: 'America/Sao_Paulo' });
    expect(sp.hoje()).toBe('2026-11-04'); // 00:59 em São Paulo
  });

  it('relativo não mexe no relógio', () => {
    const r = criarRelogio({ agora: VIRADA_MANAUS });
    expect(r.relativo({ horas: 1, segundos: 30 }).toISOString()).toBe('2026-11-04T04:59:30.000Z');
    expect(r.iso()).toBe(VIRADA_MANAUS);
  });

  it('sem instante: usa MACUXI_AGORA; inválido é erro', () => {
    expect(criarRelogio({ env: { [VAR_AGORA]: '2031-01-01T03:30:00Z' } }).hoje()).toBe('2030-12-31');
    expect(() => criarRelogio({ env: { [VAR_AGORA]: 'ontem' } })).toThrow(/MACUXI_AGORA/);
    expect(() => criarRelogio({ agora: 'amanhã' })).toThrow(/instante inválido/);
  });

  it('sem instante nem MACUXI_AGORA: lê o relógio real UMA vez e congela', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-10T15:00:00Z')); // hora-fixa-ok: relógio do Node fixado pelo próprio teste
    const r = criarRelogio({ env: {} });
    vi.setSystemTime(new Date('2027-03-11T15:00:00Z')); // hora-fixa-ok: idem
    expect(r.iso()).toBe('2027-03-10T15:00:00.000Z');
    expect(relogioReal().agora().toISOString()).toBe('2027-03-11T15:00:00.000Z');
  });
});

describe('datas relativas no fuso', () => {
  it('instanteNoFuso converte hora civil do tenant em UTC', () => {
    expect(instanteNoFuso('2026-11-03', '23:59').toISOString()).toBe(VIRADA_MANAUS);
    expect(instanteNoFuso('2026-11-03', '00:00', 'America/Sao_Paulo').toISOString()).toBe('2026-11-03T03:00:00.000Z');
    expect(instanteNoFuso('2026-11-03', '01:30', 'America/Rio_Branco').toISOString()).toBe('2026-11-03T06:30:00.000Z');
    // fuso com horário de verão: Nova York em julho (UTC-4) e em janeiro (UTC-5)
    expect(instanteNoFuso('2026-07-01', '12:00', 'America/New_York').toISOString()).toBe('2026-07-01T16:00:00.000Z');
    expect(instanteNoFuso('2026-01-15', '12:00', 'America/New_York').toISOString()).toBe('2026-01-15T17:00:00.000Z');
    expect(() => instanteNoFuso('03/11/2026')).toThrow(/data inválida/);
    expect(() => instanteNoFuso('2026-11-03', '24:00')).toThrow(/hora inválida/);
  });

  it('meioDiaNoFuso e diaCivil usam o dia do fuso', () => {
    expect(meioDiaNoFuso(VIRADA_MANAUS).toISOString()).toBe('2026-11-03T16:00:00.000Z');
    expect(diaCivil('2026-12-01T02:00:00Z')).toBe('2026-11-30'); // fim de mês
    expect(diaCivil('2027-01-01T03:59:00Z', 0)).toBe('2026-12-31'); // virada do ano
    expect(diaCivil('2027-01-01T03:59:00Z', 1)).toBe('2027-01-01');
  });

  it('somarDiasCivis, relativo e duracaoEmMs', () => {
    expect(somarDiasCivis('2028-02-28', 1)).toBe('2028-02-29');
    expect(somarDiasCivis('2026-01-01', -1)).toBe('2025-12-31');
    expect(() => somarDiasCivis('2026-1-1', 1)).toThrow(/data inválida/);
    expect(relativo(VIRADA_MANAUS, { dias: 1 }).toISOString()).toBe('2026-11-05T03:59:00.000Z');
    expect(duracaoEmMs({ dias: 1, horas: 1, minutos: 1, segundos: 1, ms: 1 })).toBe(90_061_001);
    expect(duracaoEmMs(5)).toBe(5);
  });
});

describe('relogioDoBanco', () => {
  it('usa o now() do banco como "agora" (Date do pg ou texto)', async () => {
    const pedidos: string[] = [];
    const cliente = (agora: unknown) => ({
      query: async (sql: string) => {
        pedidos.push(sql);
        return { rows: [{ agora }] };
      },
    });
    const r = await relogioDoBanco(cliente(new Date(VIRADA_MANAUS)));
    expect(pedidos[0]).toMatch(/select now\(\)/i); // hora-fixa-ok: é o SQL que o utilitário manda
    expect(r.iso()).toBe(VIRADA_MANAUS);
    expect((await relogioDoBanco(cliente('2026-11-04 03:59:00+00'), { fuso: 'America/Sao_Paulo' })).hoje()).toBe('2026-11-04');
    await expect(relogioDoBanco(cliente(null))).rejects.toThrow(/now\(\)/);
  });
});
