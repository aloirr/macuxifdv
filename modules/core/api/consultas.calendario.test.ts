import type { ContextoConsulta } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CONSULTA_CALENDARIO_METAS } from '../contracts';
import { consultaCalendarioMetas } from './consultas';

const executar = (parametros: Record<string, unknown>) =>
  consultaCalendarioMetas.executar(CONSULTA_CALENDARIO_METAS.entrada.parse({}), { parametros: () => parametros } as unknown as ContextoConsulta);
const PADRAO = { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] };

describe('RN-CORE-26: consulta core.calendario_metas@1', () => {
  it('RN-CORE-26: devolve a semana de dias úteis do parâmetro metas.dias_uteis_semana e feriados vazios', async () => {
    expect(await executar({ 'metas.dias_uteis_semana': [1, 2, 3, 4, 5] })).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [] });
  });
  it('RN-CORE-26: sem parâmetro ou com valor inválido vale segunda a sábado', async () => {
    expect(await executar({})).toEqual(PADRAO);
    expect(await executar({ 'metas.dias_uteis_semana': [9] })).toEqual(PADRAO);
  });
  it('ADR 0025 §4.1: é configuração do tenant e o contrato tem o nome certo', () => {
    expect(CONSULTA_CALENDARIO_METAS.configuracaoDoTenant).toBe(true);
    expect(CONSULTA_CALENDARIO_METAS.nome).toBe('core.calendario_metas@1');
  });
});
