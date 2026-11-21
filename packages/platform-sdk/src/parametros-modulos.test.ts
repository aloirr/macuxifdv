/**
 * D-PAR-04 (v1.0.19): um lugar só para "sem parâmetros", para a leitura dos parâmetros de um módulo e para a conversão da
 * resposta de `GET /v1/me/modulos` no mapa por módulo (T-0029 E3; RN-CORE-02: módulo inativo não lê parâmetro).
 */
import { describe, expect, it } from 'vitest';
import { completarAmbiente, leitorDeParametros, SEM_PARAMETROS } from './consultas';
import { ambienteIndisponivel } from './ambiente';
import { ModulosNovidadesSchema, parametrosDosModulos } from './novidades';

describe('SEM_PARAMETROS', () => {
  it('é vazio e congelado', () => {
    expect(SEM_PARAMETROS).toEqual({});
    expect(Object.isFrozen(SEM_PARAMETROS)).toBe(true);
  });

  it('é o que o ambiente sem motor devolve (BKO)', () => {
    expect(completarAmbiente(ambienteIndisponivel()).parametros('core')).toBe(SEM_PARAMETROS);
  });
});

describe('leitorDeParametros', () => {
  it('devolve os parâmetros do módulo e SEM_PARAMETROS para o módulo sem entrada', () => {
    const ler = leitorDeParametros({ core: { 'sync.auto_min': 15 } });
    expect(ler('core')).toEqual({ 'sync.auto_min': 15 });
    expect(ler('vendedor')).toBe(SEM_PARAMETROS);
  });

  it('sem mapa, devolve SEM_PARAMETROS', () => {
    expect(leitorDeParametros()('core')).toBe(SEM_PARAMETROS);
  });
});

describe('parametrosDosModulos', () => {
  it('transforma a resposta validada no mapa de parâmetros por módulo', () => {
    const r = ModulosNovidadesSchema.parse({
      modulos: [{ id: 'core', parametros: { 'sync.auto_min': 15 } }, { id: 'vendedor' }],
      versao_licencas: 'v1',
    });
    const p = parametrosDosModulos(r);
    expect(p).toEqual({ core: { 'sync.auto_min': 15 }, vendedor: {} });
  });

  it('aceita a forma de `MeusModulosResposta` (campos a mais e `parametros` opcional)', () => {
    const resposta = {
      modulos: [
        { id: 'core' as const, versao: '1.0.0', parametros: { x: true } },
        { id: 'promotor' as const, versao: '1.0.0' },
      ],
      versao_licencas: 'v1',
    };
    const p = parametrosDosModulos(resposta);
    expect(p).toEqual({ core: { x: true }, promotor: {} });
    expect(leitorDeParametros(p)('core')).toEqual({ x: true });
  });
});
