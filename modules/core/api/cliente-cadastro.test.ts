import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDeClienteCadastro } from './cliente-cadastro';

describe('rotas do cliente novo para o ERP', () => {
  it('RN-CORE-78: aprovar é só do analista e do admin; o pré-cadastro, de vendedor para cima, sem promotor', () => {
    expect(manifest.acoes['cliente.aprovar_cadastro']!.perfis).toEqual(['analista', 'admin']);
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).not.toContain('promotor');
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).toContain('vendedor');
  });
  it('RN-CORE-78: as duas rotas existem e usam essas ações', () => {
    expect(rotasDeClienteCadastro.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual([
      'POST clientes/pre-cadastro cliente.pre_cadastrar',
      'POST clientes/:id/cadastro cliente.aprovar_cadastro',
    ]);
  });
  it('RN-CORE-78: o manifest publica o evento e oferece as duas consultas ao Hub', () => {
    expect(manifest.publica).toContain('core.cliente.aprovado@1');
    expect(manifest.ofereceConsultas).toEqual(expect.arrayContaining(['core.clientes_aprovados_sem_erp@1', 'core.cliente_vincular_erp@1']));
  });
});
