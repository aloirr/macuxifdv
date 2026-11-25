/**
 * Dados cadastrais da empresa no portal (ADR 0075) sem banco real: acesso (super-admin em qualquer empresa, admin do cliente só
 * na da sessão), 422 de formato com os campos e sem os valores, CNPJ e nome fantasia fora do PUT, tradução dos SQLSTATE e o
 * retorno conferido pelo contrato. As funções `sa_*` de verdade são testadas pelo banco-dados. Dados fictícios.
 */
import { CODIGOS_CADASTRO_EMPRESA, rotaCadastroEmpresa, type AcessoPortalAutenticado, type GravarDadosCadastraisEmpresa } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { FonteCadastroEmpresa } from '../src/empresa-cadastro';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste, TENANT } from './apoio';

const OUTRO = '0a000000-0000-4000-8000-000000000002';
const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: TENANT, usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const sa = { 'x-quem': 'sa' };
const cli = { 'x-quem': 'cli' };

const CORPO = {
  razao_social: 'Distribuidora Exemplo Ltda',
  logradouro: 'Av. Exemplo',
  numero: '100',
  complemento: '',
  bairro: 'Centro',
  municipio: 'Manaus',
  uf: 'am',
  cep: '69000-000',
  telefone: '(92) 3333-4444',
  email: 'contato@exemplo.com',
  inscricao_estadual: 'ISENTO',
};

/** As `sa_*` em memória: sessão, acesso e a gravação das 11 chaves (o CNPJ e o nome fantasia nunca mudam aqui). */
function montar(op: { erro?: string; retornoErrado?: boolean } = {}) {
  const erro = (code: string) => Object.assign(new Error('pg'), { code });
  const linha = (t: string) => ({
    tenant_id: t,
    cnpj: '11222333000181',
    razao_social: 'Distribuidora Exemplo Ltda',
    nome_fantasia: 'Exemplo',
    logradouro: null,
    numero: null,
    complemento: null,
    bairro: null,
    municipio: null,
    uf: null,
    cep: null,
    telefone: null,
    email: null,
    inscricao_estadual: null,
    atualizado_em: '2026-11-24T22:00:00.000Z',
  });
  const tenants = new Map([
    [TENANT, linha(TENANT)],
    [OUTRO, linha(OUTRO)],
  ]);
  const gravados: GravarDadosCadastraisEmpresa[] = [];
  const conferir = (sid: string, t: string) => {
    if (op.erro) throw erro(op.erro);
    if (sid !== SA.sessao_id && sid !== CLI.sessao_id) throw erro('28000');
    if (sid === CLI.sessao_id && t !== TENANT) throw erro('42501');
    const e = tenants.get(t);
    if (!e) throw erro('P0002');
    return e;
  };
  const fonte: FonteCadastroEmpresa = {
    ler: async (sid, t) => (op.retornoErrado ? { ...conferir(sid, t), cnpj: '123' } : conferir(sid, t)),
    gravar: async (sid, t, dados) => {
      const e = conferir(sid, t);
      gravados.push(dados);
      Object.assign(e, dados);
      return e;
    },
  };
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      fonteCadastro: fonte,
    }),
  );
  return { app, gravados, tenants };
}

const ler = (app: ReturnType<typeof createApp>, h: Record<string, string>, t = TENANT) => app.inject({ method: 'GET', url: rotaCadastroEmpresa(t), headers: h });
const gravar = (app: ReturnType<typeof createApp>, corpo: unknown, h: Record<string, string> = sa, t = TENANT) =>
  app.inject({ method: 'PUT', url: rotaCadastroEmpresa(t), headers: h, payload: corpo as object });

describe('GET /v1/plataforma/empresas/:tenant_id/cadastro', () => {
  it('super-admin lê qualquer empresa; admin do cliente só a da sessão; sem sessão = 401', async () => {
    const { app } = montar();
    const r = await ler(app, sa, OUTRO);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ tenant_id: OUTRO, cnpj: '11222333000181', nome_fantasia: 'Exemplo' });
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect((await ler(app, cli)).statusCode).toBe(200);
    const fora = await ler(app, cli, OUTRO);
    expect(fora.statusCode).toBe(403);
    expect(fora.json().codigo).toBe('PERFIL_SEM_ACESSO');
    expect((await ler(app, {})).statusCode).toBe(401);
  });

  it('retorno fora do contrato = 500, nunca dado fora do combinado', async () => {
    expect((await ler(montar({ retornoErrado: true }).app, sa)).statusCode).toBe(500);
  });
});

describe('PUT /v1/plataforma/empresas/:tenant_id/cadastro', () => {
  it('admin do cliente grava a própria empresa: as 11 chaves normalizadas vão à sa_*; CNPJ e nome fantasia não mudam', async () => {
    const { app, gravados } = montar();
    const r = await gravar(app, CORPO, cli);
    expect(r.statusCode, r.body).toBe(200);
    expect(gravados).toEqual([
      { ...CORPO, complemento: null, uf: 'AM', cep: '69000000', telefone: '9233334444' },
    ]);
    expect(Object.keys(gravados[0]!)).toHaveLength(11);
    expect(r.json()).toMatchObject({ cnpj: '11222333000181', nome_fantasia: 'Exemplo', uf: 'AM', cep: '69000000' });
  });

  it('formato inválido = 422 CADASTRO_EMPRESA_INVALIDO com os campos, sem o valor digitado, e sem chamar o banco', async () => {
    const { app, gravados } = montar();
    const r = await gravar(app, { ...CORPO, uf: 'ZZ', email: 'segredo@' });
    expect(r.statusCode).toBe(422);
    const b = r.json();
    expect(b.codigo).toBe(CODIGOS_CADASTRO_EMPRESA.invalido);
    expect(b.detalhes.problemas.map((p: { caminho: string }) => p.caminho).sort()).toEqual(['corpo.email', 'corpo.uf']);
    expect(r.body).not.toContain('segredo');
    expect(gravados).toEqual([]);
  });

  it.each([
    ['CNPJ (imutável)', { cnpj: '11222333000181' }],
    ['nome fantasia (grava pela marca, T-0182)', { nome_fantasia: 'Outro' }],
  ])('corpo com %s = 422', async (_caso, extra) => {
    const { app, gravados } = montar();
    expect((await gravar(app, { ...CORPO, ...extra })).statusCode).toBe(422);
    expect(gravados).toEqual([]);
  });

  it('admin do cliente em outra empresa = 403 antes do banco', async () => {
    const { app, gravados } = montar();
    expect((await gravar(app, CORPO, cli, OUTRO)).statusCode).toBe(403);
    expect(gravados).toEqual([]);
  });

  it.each([
    ['28000', 401, 'NAO_AUTENTICADO'],
    ['42501', 403, 'PERFIL_SEM_ACESSO'],
    ['P0002', 404, 'TENANT_NAO_ENCONTRADO'],
    ['23514', 422, CODIGOS_CADASTRO_EMPRESA.invalido],
    ['42883', 503, CODIGOS_CADASTRO_EMPRESA.indisponivel],
  ])('SQLSTATE %s da sa_* = %i %s', async (code, status, codigo) => {
    const r = await gravar(montar({ erro: code }).app, CORPO);
    expect(r.statusCode).toBe(status);
    expect(r.json().codigo).toBe(codigo);
  });
});
