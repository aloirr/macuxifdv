import { describe, expect, it } from 'vitest';
import { ACAO_CHECKIN_FORA_DE_ROTA, ACAO_VISITA_REGISTRAR_GESTAO } from '../contracts';
import { checkinPermitido, visitaDeGestaoPermitida } from './checkin-rota';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('RN-CORE-52: check-in no cliente fora da rota do dia depende da ação do perfil', () => {
  it('RN-CORE-52: a ação do catálogo se chama visita.checkin_fora_de_rota', () => {
    expect(ACAO_CHECKIN_FORA_DE_ROTA).toBe('visita.checkin_fora_de_rota');
  });
  it('RN-CORE-52: cliente na rota do dia é sempre permitido, com ou sem a ação', () => {
    expect(checkinPermitido({ clienteId: A, clientesDaRota: [A, B], podeForaDeRota: false })).toBe(true);
    expect(checkinPermitido({ clienteId: A, clientesDaRota: new Set([A]), podeForaDeRota: true })).toBe(true);
  });
  it('RN-CORE-52: cliente fora da rota só com a ação no perfil', () => {
    expect(checkinPermitido({ clienteId: B, clientesDaRota: [A], podeForaDeRota: true })).toBe(true);
    expect(checkinPermitido({ clienteId: B, clientesDaRota: [A], podeForaDeRota: false })).toBe(false);
  });
  it('RN-CORE-52: sem rota no dia, todo cliente é fora de rota', () => {
    expect(checkinPermitido({ clienteId: A, clientesDaRota: [], podeForaDeRota: false })).toBe(false);
  });
});

describe('RN-CORE-13: visita de supervisor e gerente no Gestão depende da ação visita.registrar_gestao', () => {
  it('RN-CORE-13: a ação do catálogo se chama visita.registrar_gestao', () => {
    expect(ACAO_VISITA_REGISTRAR_GESTAO).toBe('visita.registrar_gestao');
  });
  it('RN-CORE-13: supervisor e gerente só registram visita com a ação no perfil', () => {
    for (const perfil of ['supervisor', 'gerente']) {
      expect(visitaDeGestaoPermitida({ perfil, podeRegistrarGestao: true })).toBe(true);
      expect(visitaDeGestaoPermitida({ perfil, podeRegistrarGestao: false })).toBe(false);
    }
  });
  it('RN-CORE-13: vendedor e promotor (Campo) não dependem da ação', () => {
    for (const perfil of ['vendedor', 'promotor']) expect(visitaDeGestaoPermitida({ perfil, podeRegistrarGestao: false })).toBe(true);
  });
});
