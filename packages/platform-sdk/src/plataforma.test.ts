/** Contratos do portal de implantação (T-0087; ADR 0029). */
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { definirModuloApi, problemasConexaoRotaPublica, type RotaModulo, type RotaPublica } from './api';
import { CriarEmpresaSchema, EmpresaResumoSchema, linhasDosParametrosIniciais, ParametrosIniciaisSchema } from './plataforma';

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

  it('código da licença (R-20261114-170600): sem `codigo`, vai o `tenant_id` do portal (idempotência) e a UF opcional', () => {
    const { codigo: _semCodigo, ...semCodigo } = base;
    const tenant_id = '0a000000-0000-4000-8000-0000000000c1';
    const e = CriarEmpresaSchema.parse({ ...semCodigo, tenant_id, uf: ' am ' });
    expect(e).toMatchObject({ tenant_id, uf: 'AM' });
    expect(e.codigo).toBeUndefined();
    expect(CriarEmpresaSchema.parse({ ...semCodigo, tenant_id }).uf).toBeUndefined();
    // sem código e sem tenant_id o contrato passa (o portal de antes compila), mas a API recusa: 400 VALIDACAO
    expect(CriarEmpresaSchema.safeParse(semCodigo).success).toBe(true);
    expect(CriarEmpresaSchema.safeParse({ ...semCodigo, tenant_id, uf: 'XX' }).success).toBe(false);
    expect(CriarEmpresaSchema.safeParse({ ...semCodigo, tenant_id: 'dist-a' }).success).toBe(false);
    // o código da licença (UF+4) é sorteado pelo banco: o portal não o escolhe
    expect(CriarEmpresaSchema.safeParse({ ...base, codigo: 'AM1234' }).success).toBe(false);
    // com código (legado e CLI), segue como antes
    expect(CriarEmpresaSchema.parse({ ...base, tenant_id }).codigo).toBe('distribuidora-x');
  });

  it('parâmetros iniciais viram as chaves que o Vendedor lê', () => {
    const linhas = linhasDosParametrosIniciais(ParametrosIniciaisSchema.parse({ alcada_vendedor_pct: 3 }));
    expect(linhas.map((l) => l.chave)).toEqual(['alcada.vendedor_pct', 'alcada.supervisor_pct', 'alcada.gerente_pct', 'validade_orcamento_dias', 'aplicacao_no_orcamento_padrao']);
    expect(linhas[0]).toEqual({ modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: 3 });
  });
});

describe('sem 2º fator nem primeiro acesso (ADR 0031 substitui a 0029 nesses pontos)', () => {
  it('o SDK não exporta mais os contratos de convite, desafio, TOTP e recuperação', async () => {
    const sdk: Record<string, unknown> = await import('./plataforma');
    for (const nome of ['PrimeiroAcessoSchema', 'EtapaLoginSchema', 'DesafioSchema', 'TotpInicioSchema', 'TotpConfirmarSchema', 'SegundoFatorSchema', 'CodigoRecuperacaoSchema', 'CodigosRecuperacaoSchema', 'TotpConfirmadoSchema', 'RegerarRecuperacaoSchema', 'SessaoPlataformaSchema', 'LoginPlataformaSchema', 'SENHA_SUPER_ADMIN_MIN']) {
      expect(sdk[nome], nome).toBeUndefined();
    }
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
    const publica = (caminho: string): RotaPublica => ({ metodo: 'POST' as const, caminho, conexao: 'portal', limite: { max: 5, janelaMs: 60_000 }, executar: ok });
    expect(definirModuloApi({ manifesto: core, rotasPublicas: [publica('plataforma/auth/login')] }).rotasPublicas).toHaveLength(1);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [publica('plataforma/empresas')] })).toThrow(/reservado/);
  });
});

describe('RotaPublica.conexao portal (T-0091; condição da ADR 0029)', () => {
  const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'] });
  const ok = async () => ({});
  const publica = (caminho: string, conexao?: 'portal'): RotaPublica => ({ metodo: 'POST', caminho, ...(conexao ? { conexao } : {}), limite: { max: 5, janelaMs: 60_000 }, executar: ok });

  it('plataforma/auth/* com conexao portal passa; sem ela, a sessão do super-admin cairia no macuxi_app e é recusada', () => {
    expect(problemasConexaoRotaPublica('core', publica('plataforma/auth/login', 'portal'))).toEqual([]);
    expect(problemasConexaoRotaPublica('core', publica('plataforma/auth/login'))).toEqual([expect.stringMatching(/exige conexao 'portal'/)]);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [publica('plataforma/auth/sair')] })).toThrow(/exige conexao 'portal'/);
  });

  it('conexao portal só no core e só em plataforma/...; rota de tenant segue sem o campo', () => {
    expect(problemasConexaoRotaPublica('core', publica('auth/login'))).toEqual([]);
    expect(problemasConexaoRotaPublica('core', publica('auth/login', 'portal'))).toEqual([expect.stringMatching(/só em caminho plataforma/)]);
    expect(problemasConexaoRotaPublica('vendedor', publica('plataforma/auth/login', 'portal'))).toEqual([expect.stringMatching(/só no manifesto core/)]);
    expect(problemasConexaoRotaPublica('core', { ...publica('plataforma/auth/login'), conexao: 'app' as never })).toEqual([expect.stringMatching(/só aceita 'portal'/)]);
    expect(() => definirModuloApi({ manifesto: core, rotasPublicas: [publica('auth/entrar', 'portal')] })).toThrow(/só em caminho plataforma/);
  });
});

describe('EmpresaResumoSchema: plano e teste na lista (R-20261114-170600)', () => {
  const item = { id: '0a000000-0000-4000-8000-0000000000c1', codigo: 'AM0042', razao_social: 'X Ltda', cnpj: null, fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-01T00:00:00Z', modulos: [] };

  it('sem plano: plano e teste_ate nulos, em_teste falso', () => {
    expect(EmpresaResumoSchema.parse(item)).toMatchObject({ plano: null, teste_ate: null, em_teste: false });
  });

  it('com plano em teste: nome do plano, fim do teste (AAAA-MM-DD) e em_teste', () => {
    expect(EmpresaResumoSchema.parse({ ...item, plano: 'PME', teste_ate: '2026-11-27', em_teste: true })).toMatchObject({ plano: 'PME', teste_ate: '2026-11-27', em_teste: true });
    expect(EmpresaResumoSchema.safeParse({ ...item, teste_ate: '27/11/2026' }).success).toBe(false);
  });
});
