import { describe, expect, it } from 'vitest';
import { cargaDeHoje, cargaDiariaDevida, marcaCargaDiaria } from './carga-diaria';

const MANAUS = 'America/Manaus'; // UTC−4
const SP = 'America/Sao_Paulo'; // UTC−3 (sem horário de verão desde 2019)
const d = (iso: string) => new Date(iso);

describe('RN-CORE-61: carga diária do estoque', () => {
  const ontem0600 = '2026-11-14T10:00:00.000Z'; // 06:00 de 14/11 em Manaus

  it('RN-CORE-61: 05:59 em Manaus ainda vale o marco de ontem (carga de ontem 06:00 não está devida)', () => {
    const p = { ultima: ontem0600, agora: d('2026-11-15T09:59:00Z'), fuso: MANAUS, hora: '06:00' };
    expect(cargaDiariaDevida(p)).toBe(false);
    expect(cargaDeHoje(p)).toBe(true);
    expect(marcaCargaDiaria(p)).toBe(ontem0600);
  });

  it('RN-CORE-61: 06:00 em Manaus o marco de hoje já passou e a carga de ontem fica devida', () => {
    const p = { ultima: ontem0600, agora: d('2026-11-15T10:00:00Z'), fuso: MANAUS, hora: '06:00' };
    expect(cargaDiariaDevida(p)).toBe(true);
    expect(cargaDeHoje(p)).toBe(false);
  });

  it('RN-CORE-61: 06:01 em Manaus segue devida', () => {
    expect(
      cargaDiariaDevida({ ultima: ontem0600, agora: d('2026-11-15T10:01:00Z'), fuso: MANAUS, hora: '06:00' }),
    ).toBe(true);
  });

  it('RN-CORE-61: ultima às 06:00 de hoje não está devida, a qualquer hora depois', () => {
    const ultima = '2026-11-15T10:00:00.000Z';
    for (const agora of ['2026-11-15T10:00:00Z', '2026-11-15T10:01:00Z', '2026-11-15T20:00:00Z']) {
      expect(cargaDiariaDevida({ ultima, agora: d(agora), fuso: MANAUS, hora: '06:00' })).toBe(false);
    }
  });

  it('RN-CORE-61: ultima nula é sempre devida', () => {
    expect(
      cargaDiariaDevida({ ultima: null, agora: d('2026-11-15T09:00:00Z'), fuso: MANAUS, hora: '06:00' }),
    ).toBe(true);
  });

  it('RN-CORE-61: fuso UTC−3 desloca o marco (06:00 em São Paulo = 09:00 UTC)', () => {
    const ultima = '2026-11-14T09:00:00.000Z';
    expect(cargaDiariaDevida({ ultima, agora: d('2026-11-15T08:59:00Z'), fuso: SP, hora: '06:00' })).toBe(
      false,
    );
    expect(cargaDiariaDevida({ ultima, agora: d('2026-11-15T09:00:00Z'), fuso: SP, hora: '06:00' })).toBe(
      true,
    );
    expect(marcaCargaDiaria({ agora: d('2026-11-15T12:00:00Z'), fuso: SP, hora: '06:00' })).toBe(
      '2026-11-15T09:00:00.000Z',
    );
  });

  it('RN-CORE-61: virada de dia às 23h50 em Manaus mantém o marco das 06:00 do mesmo dia local', () => {
    const agora = d('2026-11-16T03:50:00Z'); // 23:50 de 15/11 em Manaus (já é 16/11 em UTC)
    expect(marcaCargaDiaria({ agora, fuso: MANAUS, hora: '06:00' })).toBe('2026-11-15T10:00:00.000Z');
    expect(
      cargaDiariaDevida({ ultima: '2026-11-15T10:30:00.000Z', agora, fuso: MANAUS, hora: '06:00' }),
    ).toBe(false);
    expect(cargaDiariaDevida({ ultima: ontem0600, agora, fuso: MANAUS, hora: '06:00' })).toBe(true);
  });

  it('RN-CORE-61: hora configurada diferente (18:30) e hora inválida cai em 06:00', () => {
    expect(marcaCargaDiaria({ agora: d('2026-11-15T23:00:00Z'), fuso: MANAUS, hora: '18:30' })).toBe(
      '2026-11-15T22:30:00.000Z',
    );
    expect(marcaCargaDiaria({ agora: d('2026-11-15T12:00:00Z'), fuso: MANAUS, hora: '25:99' })).toBe(
      '2026-11-15T10:00:00.000Z',
    );
    expect(marcaCargaDiaria({ agora: d('2026-11-15T12:00:00Z'), fuso: MANAUS, hora: '' })).toBe(
      '2026-11-15T10:00:00.000Z',
    );
  });

  it('RN-CORE-61: fuso inválido cai em America/Manaus', () => {
    expect(marcaCargaDiaria({ agora: d('2026-11-15T12:00:00Z'), fuso: 'Lugar/Nenhum', hora: '06:00' })).toBe(
      '2026-11-15T10:00:00.000Z',
    );
  });

  it('RN-CORE-61: ultima inválida é devida', () => {
    expect(
      cargaDiariaDevida({ ultima: 'ontem', agora: d('2026-11-15T12:00:00Z'), fuso: MANAUS, hora: '06:00' }),
    ).toBe(true);
  });
});
