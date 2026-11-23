import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDeClienteCadastro } from './cliente-cadastro';
import { rotasDeParametrosPreCadastro } from './parametros-pre-cadastro';

describe('rotas do cliente novo para o ERP', () => {
  it('RN-CORE-78: o pré-cadastro é de vendedor para cima, sem promotor, e ninguém aprova no BKO', () => {
    expect(manifest.acoes['cliente.aprovar_cadastro']).toBeUndefined();
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).not.toContain('promotor');
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).toContain('vendedor');
  });
  it('RN-CORE-78: só a rota do pré-cadastro existe (sem decisão no BKO)', () => {
    expect(rotasDeClienteCadastro.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual(['POST clientes/pre-cadastro cliente.pre_cadastrar']);
  });
  it('RN-CORE-78: o manifest publica o evento novo e oferece a consulta nova ao Hub', () => {
    expect(manifest.publica).toContain('core.cliente.pre_cadastrado@1');
    expect(manifest.publica).not.toContain('core.cliente.aprovado@1');
    expect(manifest.ofereceConsultas).toContain('core.clientes_pre_cadastro_sem_erp@1');
    expect(manifest.ofereceConsultas).not.toContain('core.clientes_aprovados_sem_erp@1');
  });
  it('RN-CORE-79: o parâmetro dos obrigatórios é lido por admin e analista e só o admin grava', () => {
    expect(manifest.acoes['parametro.pre_cadastro']!.perfis).toEqual(['analista', 'admin']);
    expect(manifest.acoes['parametro.pre_cadastro_editar']!.perfis).toEqual(['admin']);
    expect(rotasDeParametrosPreCadastro.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual([
      'GET parametros/pre-cadastro parametro.pre_cadastro',
      'PUT parametros/pre-cadastro parametro.pre_cadastro_editar',
    ]);
  });
});
