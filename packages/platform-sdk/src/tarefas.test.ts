/** ADR 0022: tarefa periódica do módulo — nome, período múltiplo de 15 min (RN-CORE-23) e unicidade no módulo. */
import { describe, expect, it } from 'vitest';
import { definirModuloApi, definirTarefa, INTERVALO_MINIMO_TAREFA_MIN, problemasTarefa } from './api';
import { defineModule } from './manifesto';

const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], acoes: {} });
const executar = async () => undefined;

describe('tarefas periódicas (ADR 0022)', () => {
  it('RN-CORE-23: aceita período múltiplo de 15 min', () => {
    expect(INTERVALO_MINIMO_TAREFA_MIN).toBe(15);
    for (const cadaMin of [15, 30, 60, 1440]) expect(problemasTarefa({ nome: 'alerta_x', cadaMin })).toEqual([]);
    expect(definirTarefa({ nome: 'alerta_x', cadaMin: 60, executar }).cadaMin).toBe(60);
  });

  it('RN-CORE-23: recusa período abaixo de 15 min, quebrado ou fora do múltiplo', () => {
    for (const cadaMin of [0, 1, 5, 14, 20, 15.5, Number.NaN])
      expect(() => definirTarefa({ nome: 'alerta_x', cadaMin, executar })).toThrow(/múltiplo de 15 min/);
  });

  it('recusa nome inválido e tarefa repetida no módulo', () => {
    expect(() => definirTarefa({ nome: 'Alerta-X', cadaMin: 15, executar })).toThrow(/nome inválido/);
    const t = { nome: 'alerta_x', cadaMin: 15, executar };
    expect(() => definirModuloApi({ manifesto: core, tarefas: [t, t] })).toThrow(/tarefa alerta_x: repetida/);
    expect(() => definirModuloApi({ manifesto: core, tarefas: [{ ...t, cadaMin: 5 }] })).toThrow(/RN-CORE-23/);
    expect(definirModuloApi({ manifesto: core, tarefas: [t] }).tarefas).toHaveLength(1);
  });
});

interface ResultadoDoModulo {
  alertadas: number;
  baixadas: number;
}

describe('tarefas periódicas: tipo do resultado', () => {
  it('aceita a interface de resultado do módulo sem cópia (só os números vão ao log)', async () => {
    const r: ResultadoDoModulo = { alertadas: 1, baixadas: 0 };
    const t = definirTarefa({ nome: 'alerta_y', cadaMin: 60, executar: async () => r });
    expect(await t.executar({} as never)).toEqual(r);
  });
});
