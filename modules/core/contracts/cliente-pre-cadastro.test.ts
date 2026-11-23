import { describe, expect, it } from 'vitest';
import {
  CAMPOS_PRE_CADASTRO_CONFIGURAVEIS,
  CAMPOS_PRE_CADASTRO_SEMPRE,
  CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP,
  ClientePreCadastradoSchema,
  EVENTO_CLIENTE_PRE_CADASTRADO,
  ObrigatoriosPreCadastroSchema,
  PARAMETRO_PRE_CADASTRO_OBRIGATORIOS,
  ParametroPreCadastroSchema,
  PreCadastroClienteSchema,
  ROTULOS_CAMPOS_PRE_CADASTRO,
  obrigatoriosPreCadastroDasLinhas,
} from './cliente-pre-cadastro';

const id = '11111111-1111-4111-8111-111111111111';

describe('core.cliente.pre_cadastrado@1', () => {
  it('RN-CORE-78: evento só com ids e carimbo', () => {
    expect(EVENTO_CLIENTE_PRE_CADASTRADO.nome).toBe('core.cliente.pre_cadastrado@1');
    expect(ClientePreCadastradoSchema.safeParse({ cliente_id: id, recebido_em: '2026-11-23T12:00:00.000Z' }).success).toBe(true);
    expect(ClientePreCadastradoSchema.safeParse({ cliente_id: id, recebido_em: 'x' }).success).toBe(false);
  });
  it('RN-INT-22: consulta limita o lote a 500', () => {
    expect(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP.nome).toBe('core.clientes_pre_cadastro_sem_erp@1');
    expect(CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP.entrada.safeParse({ limite: 501 }).success).toBe(false);
  });
});

describe('pré-cadastro', () => {
  it('RN-CORE-79: documento é sempre obrigatório e é normalizado', () => {
    const ok = PreCadastroClienteSchema.parse({ id, origem: 'campo', razao_social: ' Mercado X ', documento: '12.345.678/0001-95', uf: 'am' });
    expect(ok).toMatchObject({ razao_social: 'Mercado X', documento: '12345678000195', uf: 'AM' });
    expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', razao_social: 'X' }).success).toBe(false);
    expect(PreCadastroClienteSchema.safeParse({ id, origem: 'campo', razao_social: 'X', documento: '123' }).success).toBe(false);
    expect(PreCadastroClienteSchema.safeParse({ id, origem: 'erp', razao_social: 'X', documento: '12345678901' }).success).toBe(false);
  });
  it('RN-CORE-79: todo campo tem rótulo e o parâmetro recusa repetição e chave desconhecida', () => {
    for (const c of [...CAMPOS_PRE_CADASTRO_SEMPRE, ...CAMPOS_PRE_CADASTRO_CONFIGURAVEIS]) expect(ROTULOS_CAMPOS_PRE_CADASTRO[c]).toBeTruthy();
    expect(ObrigatoriosPreCadastroSchema.safeParse(['email', 'endereco']).success).toBe(true);
    expect(ObrigatoriosPreCadastroSchema.safeParse(['email', 'email']).success).toBe(false);
    expect(ObrigatoriosPreCadastroSchema.safeParse(['razao_social']).success).toBe(false);
    expect(ParametroPreCadastroSchema.safeParse({ obrigatorios: ['telefone'], x: 1 }).success).toBe(false);
  });
  it('RN-CORE-79: obrigatoriosPreCadastroDasLinhas usa o padrão (nenhum) sem linha viva ou com valor inválido', () => {
    const k = PARAMETRO_PRE_CADASTRO_OBRIGATORIOS;
    expect(obrigatoriosPreCadastroDasLinhas([])).toEqual([]);
    expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email', 'endereco'] }])).toEqual(['email', 'endereco']);
    expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email'], deleted_at: '2026-11-23T00:00:00Z' }])).toEqual([]);
    expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'outro', chave: k, valor: ['email'] }])).toEqual([]);
    expect(obrigatoriosPreCadastroDasLinhas([{ modulo: 'core', chave: k, valor: ['email', 'email'] }])).toEqual([]);
  });
});
