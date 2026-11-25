/**
 * Dados da empresa no portal (ADR 0075; R-20261124-090942 item 04): o cartão em branco no que não está preenchido (o endereço numa linha), a
 * Receita preenchendo SÓ os campos vazios, a conferência com o schema do SDK antes de enviar e o 422 por campo. O modo falso
 * responde como a API (403 fora da empresa, 422 com `detalhes.problemas`, idempotente).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConsultaCnpjResposta, type DadosCadastraisEmpresa } from '@macuxi/platform-sdk';

import { ErroPortal, lerErroDaApi } from './portal-api';
import {
  cadastroIndisponivel,
  CAMPOS_CADASTRO,
  corpoDoCadastro,
  errosDaApi,
  formularioDoCadastro,
  formularioMudou,
  linhaDoEndereco,
  linhasDaLeitura,
  linhasDoCadastro,
  preencherVazios,
  TEXTOS_CADASTRO,
} from './portal-cadastro';
import { responderFalso, zerarModoFalso } from './portal-falso';
import { ROTAS_PORTAL } from './portal-rotas';
import type { SessaoPortal } from './portal-sessao';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

const dados = (x: Partial<DadosCadastraisEmpresa> = {}): DadosCadastraisEmpresa => ({
  tenant_id: TENANT,
  cnpj: '11222333000181',
  razao_social: 'Distribuidora Uma Ltda',
  nome_fantasia: 'Uma',
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  municipio: null,
  uf: null,
  cep: null,
  telefone: '9236330000',
  email: null,
  inscricao_estadual: null,
  atualizado_em: '2026-11-01T12:00:00.000Z',
  ...x,
});

const receita: ConsultaCnpjResposta = {
  cnpj: '11222333000181',
  razao_social: 'DISTRIBUIDORA UMA LTDA',
  nome_fantasia: 'UMA',
  endereco: { logradouro: 'Av. Djalma Batista', numero: '1200', complemento: null, bairro: 'Chapada' },
  municipio: 'Manaus',
  uf: 'AM',
  cep: '69050010',
  situacao_cadastral: 'ativa',
  cnae_principal: null,
  telefone: '9232320000',
  email: 'contato@uma.com.br',
  fonte: 'brasilapi',
};

describe('cartão (só leitura)', () => {
  it('as 13 linhas na ordem da tela; o que não está preenchido fica em branco; CNPJ, CEP e telefone com máscara', () => {
    const l = linhasDoCadastro(dados({ cep: '69050010' }));
    expect(l.map((x) => x.rotulo)).toEqual(['CNPJ', 'Inscrição estadual', 'Razão social', 'Nome fantasia', 'Logradouro', 'Número', 'Complemento', 'Bairro', 'Município', 'UF', 'CEP', 'Telefone', 'E-mail']);
    const v = Object.fromEntries(l.map((x) => [x.campo, x.valor]));
    expect(v).toMatchObject({ cnpj: '11.222.333/0001-81', cep: '69050-010', telefone: '(92) 3633-0000', logradouro: '', email: '', inscricao_estadual: '' });
  });
  it('empresa antiga sem CNPJ: a linha fica em branco', () => {
    expect(linhasDoCadastro(dados({ cnpj: null }))[0]).toEqual({ campo: 'cnpj', rotulo: 'CNPJ', valor: '' });
  });
  it('no cartão, o endereço numa linha só, no lugar do logradouro; os 7 campos saem', () => {
    expect(linhasDaLeitura(dados()).map((x) => x.rotulo)).toEqual(['CNPJ', 'Inscrição estadual', 'Razão social', 'Nome fantasia', 'Endereço', 'Telefone', 'E-mail']);
  });
  it('linhaDoEndereco: "Rua, nº · complemento · bairro · município/UF · CEP"; o que falta sai; tudo vazio = em branco', () => {
    const cheio = { logradouro: 'Rua X', numero: '100', complemento: 'Sala 2', bairro: 'Chapada', municipio: 'Manaus', uf: 'AM' as const, cep: '69000000' };
    expect(linhaDoEndereco(dados(cheio))).toBe('Rua X, 100 · Sala 2 · Chapada · Manaus/AM · 69000-000');
    expect(linhaDoEndereco(dados({ ...cheio, numero: null, complemento: '  ', municipio: null }))).toBe('Rua X · Chapada · AM · 69000-000');
    expect(linhaDoEndereco(dados())).toBe('');
  });
});

describe('preencherVazios (Receita Federal, ADR 0075 §5)', () => {
  it('preenche só os vazios (ou só com espaços); o que já está digitado fica; a inscrição estadual não vem da Receita', () => {
    const atual = { ...formularioDoCadastro(dados()), numero: '  ', bairro: 'Centro', email: 'eu@uma.com.br' };
    const r = preencherVazios(atual, receita);
    expect(r.formulario).toEqual({
      razao_social: 'Distribuidora Uma Ltda',
      logradouro: 'Av. Djalma Batista',
      numero: '1200',
      complemento: '',
      bairro: 'Centro',
      municipio: 'Manaus',
      uf: 'AM',
      cep: '69050-010',
      telefone: '(92) 3633-0000',
      email: 'eu@uma.com.br',
      inscricao_estadual: '',
    });
    expect(r.preenchidos).toEqual(['logradouro', 'numero', 'municipio', 'uf', 'cep']);
    expect(atual.logradouro).toBe('');
  });
  it('nada vazio que a Receita tenha: nenhum campo muda', () => {
    const cheio = preencherVazios(formularioDoCadastro(dados()), receita).formulario;
    expect(preencherVazios(cheio, receita)).toEqual({ formulario: cheio, preenchidos: [] });
    expect(TEXTOS_CADASTRO.preenchidos(1)).toBe('1 campo preenchido com os dados da Receita. Confira e salve.');
    expect(TEXTOS_CADASTRO.preenchidos(5)).toBe('5 campos preenchidos com os dados da Receita. Confira e salve.');
  });
});

describe('gravar', () => {
  it('corpo do PUT: exatamente as 11 chaves, normalizadas (vazio = null, só dígitos, UF maiúscula)', () => {
    const f = { ...formularioDoCadastro(dados()), cep: '69050-010', uf: 'am', email: ' Contato@Uma.com.br ', inscricao_estadual: '04.123.456-7' };
    const c = corpoDoCadastro(f);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(Object.keys(c.corpo).sort()).toEqual([...CAMPOS_CADASTRO].sort());
    expect(c.corpo).toMatchObject({ cep: '69050010', uf: 'AM', telefone: '9236330000', email: 'contato@uma.com.br', inscricao_estadual: '041234567', logradouro: null });
  });
  it('formato inválido: a frase embaixo de cada campo, antes de enviar', () => {
    const c = corpoDoCadastro({ ...formularioDoCadastro(dados()), razao_social: '', cep: '123', email: 'sem-arroba' });
    expect(c.ok).toBe(false);
    if (c.ok) return;
    expect(c.erros).toEqual({ razao_social: 'Informe a razão social.', cep: 'CEP inválido: use os 8 números.', email: 'E-mail inválido.' });
  });
  it('mudou: ignora espaços nas pontas', () => {
    const lido = formularioDoCadastro(dados());
    expect(formularioMudou({ ...lido, razao_social: ' Distribuidora Uma Ltda ' }, lido)).toBe(false);
    expect(formularioMudou({ ...lido, bairro: 'Centro' }, lido)).toBe(true);
  });
  it('422 CADASTRO_EMPRESA_INVALIDO → erro por campo; outro erro → null; 503 sem a 0102 e rota ausente = indisponível', () => {
    const e = new ErroPortal(422, 'CADASTRO_EMPRESA_INVALIDO', 'Confira.', { problemas: [{ caminho: 'corpo.uf', mensagem: 'UF inválida: use a sigla, ex.: AM.' }, { caminho: 'corpo.xyz', mensagem: 'x' }] });
    expect(errosDaApi(e)).toEqual({ uf: 'UF inválida: use a sigla, ex.: AM.' });
    expect(errosDaApi(new ErroPortal(403, 'PERFIL_SEM_ACESSO', 'x'))).toBeNull();
    expect(cadastroIndisponivel(new ErroPortal(503, 'CADASTRO_EMPRESA_INDISPONIVEL', 'x'))).toBe(true);
    expect(cadastroIndisponivel(new ErroPortal(404, 'NAO_ENCONTRADO', 'x'))).toBe(true);
    expect(cadastroIndisponivel(new ErroPortal(404, 'TENANT_NAO_ENCONTRADO', 'x'))).toBe(false);
  });
});

class Memoria implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('modo falso (como a API)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => vi.unstubAllGlobals());

  const entrar = async (email: string) => (await (await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'Senha#Forte2026' }, {})).json()) as SessaoPortal;
  const pedir = (s: SessaoPortal, metodo: string, tenant: string, corpo?: unknown) => responderFalso(metodo, ROTAS_PORTAL.cadastroDaEmpresa(tenant), corpo, { Authorization: `Bearer ${s.token}` });

  it('admin do cliente lê e grava a própria empresa; outra = 403; 422 por campo; regravar igual não muda', async () => {
    const s = await entrar('admin@uma.com.br');
    const lido = (await (await pedir(s, 'GET', TENANT)).json()) as DadosCadastraisEmpresa;
    expect(lido).toMatchObject({ cnpj: '11222333000181', razao_social: 'Distribuidora Uma Ltda', logradouro: null, telefone: '9236330000' });
    expect((await pedir(s, 'GET', '0b6f1a52-5c1e-4c4e-9a43-000000000002')).status).toBe(403);

    const corpo = { ...formularioDoCadastro(lido), cep: '1' };
    const r = await pedir(s, 'PUT', TENANT, corpo);
    expect(r.status).toBe(422);
    expect(errosDaApi(lerErroDaApi(422, await r.json()))).toEqual({ cep: 'CEP inválido: use os 8 números.' });

    const ok = corpoDoCadastro({ ...formularioDoCadastro(lido), bairro: 'Chapada' });
    if (!ok.ok) throw new Error('corpo');
    const gravado = (await (await pedir(s, 'PUT', TENANT, ok.corpo)).json()) as DadosCadastraisEmpresa;
    expect(gravado.bairro).toBe('Chapada');
    const de_novo = (await (await pedir(s, 'PUT', TENANT, ok.corpo)).json()) as DadosCadastraisEmpresa;
    expect(de_novo.atualizado_em).toBe(gravado.atualizado_em);
    // CNPJ e nome fantasia não entram no PUT
    expect((await pedir(s, 'PUT', TENANT, { ...ok.corpo, cnpj: '11222333000181' })).status).toBe(422);
  });

  it('time da Macuxi grava qualquer empresa; a razão social nova vai à lista de empresas', async () => {
    const s = await entrar('time@macuxi.com.br');
    const lido = (await (await pedir(s, 'GET', TENANT)).json()) as DadosCadastraisEmpresa;
    const ok = corpoDoCadastro({ ...formularioDoCadastro(lido), razao_social: 'Distribuidora Uma S.A.' });
    if (!ok.ok) throw new Error('corpo');
    expect((await pedir(s, 'PUT', TENANT, ok.corpo)).status).toBe(200);
    const lista = (await (await responderFalso('GET', ROTAS_PORTAL.empresas, undefined, { Authorization: `Bearer ${s.token}` })).json()) as { itens: { id: string; razao_social: string }[] };
    expect(lista.itens.find((x) => x.id === TENANT)?.razao_social).toBe('Distribuidora Uma S.A.');
  });
});
