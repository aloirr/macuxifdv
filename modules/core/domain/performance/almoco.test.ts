import { describe, expect, it } from 'vitest';
import { almocoDoDia, intervalosDoDia } from './almoco';
import { em, fechadaNaVirada, FUSO, visita } from './fixtures-teste';

const D = '2026-11-10';

describe('RN-CORE-44: almoço do dia (§3.2)', () => {
  it('RN-CORE-44: caso normal: o intervalo que contém o horário padrão 12:00 às 13:00 (11:50 → 13:10 = 80 min)', () => {
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
  it('RN-CORE-44: visita que atravessa o início do horário (11:40 → 12:20): vale o intervalo que mais se sobrepõe ao horário', () => {
    const dia = [
      visita('a', D, '10:00', '10:30'),
      visita('b', D, '11:40', '12:20'),
      visita('c', D, '13:30', '13:50'),
      visita('d', D, '14:10', '14:30'),
      visita('e', D, '15:30', '16:00'), // 14:30 → 15:30 não toca o horário 12:00 às 13:00
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
  it('RN-CORE-44: dia que termina antes do horário (meio expediente no sábado): sem almoço, mesmo com intervalo às 11:00', () => {
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
  it('RN-CORE-44: o horário informado (o do usuário ou o padrão da empresa) escolhe o intervalo', () => {
    const dia = [
      visita('a', D, '08:00', '12:30'),
      visita('b', D, '13:30', '14:00'),
      visita('c', D, '15:00', '15:10'),
    ];
    expect(almocoDoDia(dia, FUSO)?.inicio_em).toBe(em(D, '12:30'));
    expect(almocoDoDia(dia, FUSO, { inicio_min: 14 * 60, fim_min: 15 * 60 })?.inicio_em).toBe(em(D, '14:00'));
  });
  it('RN-CORE-44: dia com uma visita só não tem almoço', () => {
    expect(almocoDoDia([visita('a', D, '08:00', '17:00')], FUSO)).toBeNull();
  });
  it('RN-CORE-44 (D5): com o horário cadastrado, o almoço é o intervalo que mais se sobrepõe a ele (padrão 12:00 às 13:00)', () => {
    const h = { inicio_min: 720, fim_min: 780 };
    const dia = [visita('a', D, '08:00', '10:00'), visita('b', D, '10:20', '11:50'), visita('c', D, '13:10', '13:40')];
    expect(almocoDoDia(dia, FUSO, h)?.minutos).toBe(80);
    // intervalos às 09:00 e 10:00 não tocam o horário cadastrado: sem almoço
    const fora = [visita('a', D, '08:00', '09:00'), visita('b', D, '09:30', '10:00'), visita('c', D, '10:30', '15:00')];
    expect(almocoDoDia(fora, FUSO, h)).toBeNull();
  });
  it('RN-CORE-44 (D5): horário próprio do usuário (11:00 às 12:00) troca o intervalo escolhido', () => {
    const dia = [visita('a', D, '08:00', '11:05'), visita('b', D, '11:55', '12:10'), visita('c', D, '13:00', '13:30')];
    expect(almocoDoDia(dia, FUSO, { inicio_min: 660, fim_min: 720 })?.minutos).toBe(50);
    expect(almocoDoDia(dia, FUSO, { inicio_min: 720, fim_min: 780 })?.minutos).toBe(50);
  });
  it('RN-CORE-44 (D5): meio expediente que acaba antes do horário cadastrado não tem almoço', () => {
    const sab = '2026-11-14';
    const h = { inicio_min: 720, fim_min: 780 };
    expect(almocoDoDia([visita('a', sab, '08:00', '11:00'), visita('b', sab, '11:20', '11:50')], FUSO, h)).toBeNull();
  });
  it('RN-CORE-44 (D5): duas visitas com sobreposição igual: vale a de intervalo mais longo', () => {
    const h = { inicio_min: 720, fim_min: 780 };
    const dia = [visita('a', D, '08:00', '12:00'), visita('b', D, '12:30', '12:45'), visita('c', D, '13:00', '13:30')];
    // intervalos 12:00→12:30 (30 min) e 12:45→13:00 (15 min): vence a maior sobreposição
    expect(almocoDoDia(dia, FUSO, h)?.minutos).toBe(30);
  });
});
