import { describe, expect, it } from 'vitest';
import { ACAO_CHECKIN_FORA_DE_ROTA, botoesDoRodapeCliente, checkinPermitido } from './index';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('RN-CORE-52: check-in no cliente fora da rota do dia depende da ação do perfil', () => {
  it('RN-CORE-52: a ação do catálogo se chama visita.checkin_fora_de_rota', () => {
    expect(ACAO_CHECKIN_FORA_DE_ROTA).toBe('visita.checkin_fora_de_rota');
  });
  it('RN-CORE-52: cliente na rota do dia é sempre permitido, com ou sem a ação', () => {
    expect(checkinPermitido({ clienteId: A, clientesDaRota: [A, B], podeForaDeRota: false })).toEqual({ permitido: true, foraDeRota: false });
    expect(checkinPermitido({ clienteId: A, clientesDaRota: new Set([A]), podeForaDeRota: true })).toEqual({ permitido: true, foraDeRota: false });
  });
  it('RN-CORE-52: cliente fora da rota só com a ação no perfil', () => {
    expect(checkinPermitido({ clienteId: B, clientesDaRota: [A], podeForaDeRota: true })).toEqual({ permitido: true, foraDeRota: true });
    expect(checkinPermitido({ clienteId: B, clientesDaRota: [A], podeForaDeRota: false })).toEqual({ permitido: false, foraDeRota: true });
  });
  it('RN-CORE-52: sem rota no dia, todo cliente é fora de rota', () => {
    expect(checkinPermitido({ clienteId: A, clientesDaRota: [], podeForaDeRota: false })).toEqual({ permitido: false, foraDeRota: true });
  });
});

describe('RN-CORE-51: rodapé da ficha do cliente', () => {
  const base = { temPesquisa: true, atendimentoAqui: false, checkinPermitido: true };
  it('RN-CORE-51: sem atendimento aberto neste cliente e com permissão, mostra Check-in (e Pesquisa se houver)', () => {
    expect(botoesDoRodapeCliente(base)).toEqual({ checkin: true, checkout: false, pesquisa: true });
    expect(botoesDoRodapeCliente({ ...base, temPesquisa: false })).toEqual({ checkin: true, checkout: false, pesquisa: false });
  });
  it('RN-CORE-51: com atendimento aberto neste cliente mostra Checkout no lugar do Check-in', () => {
    expect(botoesDoRodapeCliente({ ...base, atendimentoAqui: true })).toEqual({ checkin: false, checkout: true, pesquisa: true });
  });
  it('RN-CORE-52: sem permissão (cliente fora de rota) o Check-in some', () => {
    expect(botoesDoRodapeCliente({ ...base, checkinPermitido: false })).toEqual({ checkin: false, checkout: false, pesquisa: true });
  });
});
