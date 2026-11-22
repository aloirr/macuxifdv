/**
 * Spec docs/design/telas/portal-config-enxuto.md §11.2 (ADR 0048; decidido em 14/11: só o CNPJ ativo cria empresa): estados do
 * campo CNPJ, textos e preenchimento pela consulta, contra o `ConsultaCnpjRespostaSchema` do SDK.
 */
import { describe, expect, it } from 'vitest';
import { ConsultaCnpjRespostaSchema, type ConsultaCnpjResposta } from '@macuxi/platform-sdk';

import { ErroPortal } from './portal-api';
import {
  camposDaConsulta,
  CAMPOS_VAZIOS,
  cnaeDaConsulta,
  cnpjLiberaCriar,
  ESTADOS_CNPJ,
  estadoDaConsulta,
  estadoDoErroCnpj,
  estadoLocalDoCnpj,
  preencherCampos,
  textoDoEstadoCnpj,
} from './portal-cnpj';

const consulta: ConsultaCnpjResposta = ConsultaCnpjRespostaSchema.parse({
  cnpj: '11222333000181',
  razao_social: 'Distribuidora Uma Ltda',
  nome_fantasia: 'Uma Distribuidora',
  endereco: { logradouro: 'Avenida Djalma Batista', numero: '1000', complemento: 'Sala 2', bairro: 'Chapada' },
  municipio: 'Manaus',
  uf: 'AM',
  cep: '69050010',
  situacao_cadastral: 'ativa',
  cnae_principal: { codigo: '4639701', descricao: 'Comércio atacadista de produtos alimentícios em geral' },
  telefone: '9232321000',
  email: 'contato@uma.com.br',
  fonte: 'brasilapi',
});

describe('campo CNPJ (§11.2)', () => {
  it('antes da Receita: vazio, inválido (dígito ou tamanho) ou pronto', () => {
    expect(estadoLocalDoCnpj('')).toBe('vazio');
    expect(estadoLocalDoCnpj('11.222.333/0001-8')).toBe('invalido');
    expect(estadoLocalDoCnpj('11.222.333/0001-82')).toBe('invalido');
    expect(estadoLocalDoCnpj('11.222.333/0001-81')).toBe('pronto');
  });
  it('textos dos estados, uma frase só; vazio e encontrado sem texto', () => {
    expect(ESTADOS_CNPJ.map((e) => textoDoEstadoCnpj(e, 'baixada'))).toEqual([
      null,
      'Buscando na Receita…',
      null,
      'CNPJ inválido. Confira os 14 dígitos.',
      'CNPJ não encontrado na Receita.',
      'A Receita não respondeu.',
      'CNPJ baixado na Receita. Use um CNPJ ativo.',
    ]);
    expect((['suspensa', 'inapta', 'nula'] as const).map((s) => textoDoEstadoCnpj('nao-ativa', s))).toEqual([
      'CNPJ suspenso na Receita. Use um CNPJ ativo.',
      'CNPJ inapto na Receita. Use um CNPJ ativo.',
      'CNPJ nulo na Receita. Use um CNPJ ativo.',
    ]);
  });
  it('só o CNPJ ativo libera o "Criar empresa"', () => {
    expect(estadoDaConsulta(consulta)).toBe('encontrado');
    expect(estadoDaConsulta({ situacao_cadastral: 'baixada' })).toBe('nao-ativa');
    expect(ESTADOS_CNPJ.filter(cnpjLiberaCriar)).toEqual(['encontrado']);
  });
  it('erros da API: inválido, não encontrado, inativo; fonte fora, limite e rota ausente = Receita fora', () => {
    expect(estadoDoErroCnpj(new ErroPortal(400, 'CNPJ_INVALIDO', 'x'))).toBe('invalido');
    expect(estadoDoErroCnpj(new ErroPortal(404, 'CNPJ_NAO_ENCONTRADO', 'x'))).toBe('nao-encontrado');
    expect(estadoDoErroCnpj(new ErroPortal(422, 'CNPJ_INATIVO', 'x'))).toBe('nao-ativa');
    expect(estadoDoErroCnpj(new ErroPortal(503, 'CNPJ_FONTE_FORA', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(429, 'CNPJ_LIMITE', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(404, 'NAO_ENCONTRADO', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(422, 'RN-CORE-34', 'x'))).toBeNull();
    expect(estadoDoErroCnpj(new Error('x'))).toBeNull();
  });
});

describe('campos preenchidos pela Receita (§11.2)', () => {
  it('endereço numa linha, telefone e CNAE formatados', () => {
    expect(camposDaConsulta(consulta)).toEqual({
      razao_social: 'Distribuidora Uma Ltda',
      nome_fantasia: 'Uma Distribuidora',
      endereco: 'Avenida Djalma Batista, 1000 Sala 2 · Chapada · 69050-010',
      municipio: 'Manaus',
      uf: 'AM',
      telefone: '(92) 3232-1000',
      email: 'contato@uma.com.br',
    });
    expect(cnaeDaConsulta(consulta)).toBe('4639-7/01 · Comércio atacadista de produtos alimentícios em geral');
    expect(cnaeDaConsulta({ cnae_principal: null })).toBe('');
  });
  it('o que a pessoa editou à mão não é sobrescrito; campo editado e apagado volta a receber', () => {
    const atuais = { ...CAMPOS_VAZIOS, nome_fantasia: 'Uma', municipio: '' };
    const r = preencherCampos(atuais, camposDaConsulta(consulta), new Set(['nome_fantasia', 'municipio']));
    expect(r.nome_fantasia).toBe('Uma');
    expect(r.municipio).toBe('Manaus');
    expect(r.razao_social).toBe('Distribuidora Uma Ltda');
  });
});
