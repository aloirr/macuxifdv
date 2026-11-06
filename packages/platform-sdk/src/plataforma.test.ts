/** Contratos do portal de implantação (T-0087; ADR 0029). */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { definirModuloApi, type RotaModulo } from './api';
import {
  CodigoRecuperacaoSchema,
  CriarEmpresaSchema,
  linhasDosParametrosIniciais,
  ParametrosIniciaisSchema,
  SegundoFatorSchema,
} from './plataforma';

describe('CriarEmpresaSchema (passo Empresa; RN-CORE-31)', () => {
  const base = { codigo: 'Distribuidora-X', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'vendedor' }] };

  it('aplica os padrões do doc 03 e normaliza código e CNPJ', () => {
    const e = CriarEmpresaSchema.parse(base);
    expect(e).toMatchObject({ codigo: 'distribuidora-x', cnpj: '11222333000181', fuso: 'America/Manaus', simular: false });
    expect(e.modulos).toEqual([{ modulo: 'vendedor', licencas: null }]);
    expect(e.parametros).toEqual({ alcada_vendedor_pct: 5, alcada_supervisor_pct: 10, alcada_gerente_pct: 15, validade_orcamento_dias: 7, aplicacao_no_orcamento_padrao: true });
  });

  it('recusa código fora do check da 0001, CNPJ curto, módulo repetido e alçadas fora de ordem', () => {
    expect(CriarEmpresaSchema.safeParse({ ...base, codigo: 'x' }).success).toBe(false);
    expect(CriarEmpresaSchema.safeParse({ ...base, cnpj: '123' }).success).toBe(false);
    expect(CriarEmpresaSchema.safeParse({ ...base, modulos: [{ modulo: 'vendedor' }, { modulo: 'vendedor' }] }).success).toBe(false);
    expect(ParametrosIniciaisSchema.safeParse({ alcada_vendedor_pct: 20 }).success).toBe(false);
  });

  it('parâmetros iniciais viram as chaves que o Vendedor lê', () => {
    const linhas = linhasDosParametrosIniciais(ParametrosIniciaisSchema.parse({ alcada_vendedor_pct: 3 }));
    expect(linhas.map((l) => l.chave)).toEqual(['alcada.vendedor_pct', 'alcada.supervisor_pct', 'alcada.gerente_pct', 'validade_orcamento_dias', 'aplicacao_no_orcamento_padrao']);
    expect(linhas[0]).toEqual({ modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: 3 });
  });
});

describe('2º fator (ADR 0029 §3)', () => {
  const desafio = 'd'.repeat(40);
  it('aceita código TOTP ou de recuperação, nunca os dois', () => {
    expect(SegundoFatorSchema.safeParse({ desafio, codigo: '123456' }).success).toBe(true);
    expect(SegundoFatorSchema.safeParse({ desafio, codigo_recuperacao: 'abcde-fghij' }).success).toBe(true);
    expect(SegundoFatorSchema.safeParse({ desafio, codigo: '123456', codigo_recuperacao: 'ABCDEFGHIJ' }).success).toBe(false);
    expect(SegundoFatorSchema.safeParse({ desafio, codigo: '12345' }).success).toBe(false);
  });
  it('código de recuperação: maiúsculas, sem hífen nem espaço; recusa 0, 1, 8 e 9', () => {
    expect(CodigoRecuperacaoSchema.parse(' abcde-fgh23 ')).toBe('ABCDEFGH23');
    expect(CodigoRecuperacaoSchema.safeParse('ABCDE-FGH01').success).toBe(false);
  });
});

describe('RotaModulo.superAdmin e prefixo plataforma (ADR 0029 §5)', () => {
  const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'] });
  const ok = async () => ({});
  const rota = (r: Partial<RotaModulo>): RotaModulo => ({ metodo: 'GET', caminho: 'x', carteira: 'nao_se_aplica', executar: ok, ...r });
  it('aceita aceita/exige e recusa outro valor', () => {
    expect(definirModuloApi({ manifesto: core, rotas: [rota({ superAdmin: 'aceita' }), rota({ caminho: 'y', superAdmin: 'exige' })] }).rotas).toHaveLength(2);
    expect(() => definirModuloApi({ manifesto: core, rotas: [rota({ superAdmin: 'sempre' as never })] })).toThrow(/superAdmin/);
  });
  it('rota pública do Core só em plataforma/auth/*; o resto de plataforma/* é da API', () => {
    const publica = (caminho: string) => ({ metodo: 'POST' as const, caminho, limite: { max: 5, janelaMs: 60_000 }, executar: ok });
    expect(definirModuloApi({ manifesto: core, rotasPublicas: [publica('plataforma/auth/login')] }).rotasPublicas).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [publica('plataforma/empresas')] })).toThrow(/reservado/);
  });
});
