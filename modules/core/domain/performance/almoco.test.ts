import { describe, expect, it } from 'vitest';
import { ALMOCO_PADRAO, almocoDoDia, intervalosDoDia } from './almoco';
import { em, fechadaNaVirada, FUSO, visita } from './fixtures-teste';

const D = '2026-11-10';

describe('RN-CORE-44: almoço do dia (§3.2)', () => {
  it('RN-CORE-44: caso normal: o intervalo que contém o corte de 12:00 (11:50 → 13:10 = 80 min)', () => {
    const dia = [
      visita('a', D, '08:00', '08:30'),
      visita('b', D, '09:00', '11:50'),
      visita('c', D, '13:10', '13:40'),
    ];
    expect(almocoDoDia(dia, FUSO)).toEqual({
      inicio_em: em(D, '11:50'),
      fim_em: em(D, '13:10'),
      minutos: 80,
    });
  });
  it('RN-CORE-44: a ordem é a do check-in, não a da lista', () => {
    const dia = [
      visita('c', D, '13:10', '13:40'),
      visita('a', D, '08:00', '08:30'),
      visita('b', D, '09:00', '11:50'),
    ];
    expect(almocoDoDia(dia, FUSO)?.minutos).toBe(80);
  });
  it('RN-CORE-44: visita que atravessa o corte (11:40 → 12:20): o maior intervalo que começa na janela 11:00–15:00', () => {
    const dia = [
      visita('a', D, '10:00', '10:30'),
      visita('b', D, '11:40', '12:20'),
      visita('c', D, '13:30', '13:50'),
      visita('d', D, '14:10', '14:30'),
      visita('e', D, '15:30', '16:00'), // 14:30 → 15:30 começa na janela, mas é menor (60) que 12:20 → 13:30 (70)
    ];
    expect(almocoDoDia(dia, FUSO)).toEqual({
      inicio_em: em(D, '12:20'),
      fim_em: em(D, '13:30'),
      minutos: 70,
    });
  });
  it('RN-CORE-44: nenhum intervalo na janela: sem almoço identificado', () => {
    const dia = [
      visita('a', D, '08:00', '10:00'),
      visita('b', D, '10:20', '16:00'),
      visita('c', D, '16:10', '17:00'),
    ];
    expect(almocoDoDia(dia, FUSO)).toBeNull();
  });
  it('RN-CORE-44: dia que termina antes do corte (meio expediente no sábado): sem almoço, mesmo com intervalo às 11:00', () => {
    const sab = '2026-11-14';
    expect(
      almocoDoDia([visita('a', sab, '08:00', '11:00'), visita('b', sab, '11:20', '11:50')], FUSO),
    ).toBeNull();
  });
  it('RN-CORE-44 (RN-CORE-11): fechamento automático não é check-out real e não abre intervalo', () => {
    const dia = [fechadaNaVirada('a', D, '08:00'), visita('b', D, '13:00', '13:30')];
    expect(intervalosDoDia(dia)).toEqual([]);
    expect(almocoDoDia(dia, FUSO)).toBeNull();
  });
  it('RN-CORE-44: visita aberta (check-in sem check-out) não abre intervalo', () => {
    expect(intervalosDoDia([visita('a', D, '11:00', null), visita('b', D, '13:00', '13:30')])).toEqual([]);
  });
  it('RN-CORE-44: visita removida fica fora', () => {
    const dia = [
      visita('a', D, '09:00', '11:50'),
      visita('x', D, '12:10', '12:20', { deleted_at: em(D, '18:00') }),
      visita('c', D, '13:10', '13:40'),
    ];
    expect(almocoDoDia(dia, FUSO)?.minutos).toBe(80);
  });
  it('RN-CORE-44: o corte e a janela vêm dos parâmetros do tenant', () => {
    const dia = [
      visita('a', D, '08:00', '12:30'),
      visita('b', D, '13:30', '14:00'),
      visita('c', D, '15:00', '15:10'),
    ];
    expect(almocoDoDia(dia, FUSO)?.minutos).toBe(60);
    expect(almocoDoDia(dia, FUSO, { ...ALMOCO_PADRAO, corte_min: 14 * 60 + 30 })?.minutos).toBe(60); // 14:00 → 15:00 contém 14:30
    expect(almocoDoDia(dia, FUSO, { ...ALMOCO_PADRAO, corte_min: 14 * 60 + 30 })?.inicio_em).toBe(
      em(D, '14:00'),
    );
  });
  it('RN-CORE-44: dia com uma visita só não tem almoço', () => {
    expect(almocoDoDia([visita('a', D, '08:00', '17:00')], FUSO)).toBeNull();
  });
});
