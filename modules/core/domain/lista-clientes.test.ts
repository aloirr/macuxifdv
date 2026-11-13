import { describe, expect, it } from 'vitest';
import { situacaoDoCliente, textoUltimaVisita, ultimaVisitaEntre } from './lista-clientes';

const base = { bloqueado: false, vencidos_qtd: 0, external_id: 'C-1' };

describe('RN-CORE-47: tag única da lista de Clientes', () => {
  it('RN-CORE-47: prioridade Bloqueado > Devendo > Pré-Cadastro > Em dia', () => {
    expect(situacaoDoCliente({ bloqueado: true, vencidos_qtd: 2, external_id: null })).toBe('bloqueado');
    expect(situacaoDoCliente({ ...base, vencidos_qtd: 2, external_id: null })).toBe('devendo');
    expect(situacaoDoCliente({ ...base, external_id: null })).toBe('pre_cadastro');
    expect(situacaoDoCliente({ ...base, external_id: '  ' })).toBe('pre_cadastro');
    expect(situacaoDoCliente(base)).toBe('em_dia');
  });
});

describe('RN-CORE-47: última visita pelo último check-in', () => {
  const hoje = '2026-11-12';
  it('RN-CORE-47: hoje, ontem, há N dias e nunca', () => {
    expect(textoUltimaVisita('2026-11-12', hoje)).toBe('Visitado hoje');
    expect(textoUltimaVisita('2026-11-11', hoje)).toBe('Visitado ontem');
    expect(textoUltimaVisita('2026-11-10', hoje)).toBe('Visitado há 2 dias');
    expect(textoUltimaVisita('2026-04-26', hoje)).toBe('Visitado há 200 dias');
    expect(textoUltimaVisita(null, hoje)).toBe('Nunca visitado');
  });
  it('RN-CORE-47: dias de calendário atravessam a virada de mês e de horário de verão sem erro', () => {
    expect(textoUltimaVisita('2026-10-31', '2026-11-01')).toBe('Visitado ontem');
    expect(textoUltimaVisita('2026-02-28', '2026-03-02')).toBe('Visitado há 2 dias');
  });
  it('RN-CORE-47: um check-in feito agora no aparelho vale mesmo antes do sync', () => {
    expect(ultimaVisitaEntre('2026-09-01', '2026-11-12', null)).toBe('2026-11-12');
    expect(ultimaVisitaEntre(null, undefined)).toBeNull();
  });
});
