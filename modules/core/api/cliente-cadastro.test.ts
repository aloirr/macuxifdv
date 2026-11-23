import { criarPermissoes, PERFIS, verificarAcao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDeClienteCadastro } from './cliente-cadastro';
import { rotasDePreCadastroBko } from './cliente-pre-cadastro-bko';
import { rotasDeParametrosCamposObrigatorios } from './parametros-campos-obrigatorios';
import { provedoresSyncCore } from './sync';

const TENANT = '00000000-0000-4000-8000-000000000001';

describe('rotas do cliente novo para o ERP', () => {
  const permissoes = criarPermissoes([manifest]);
  const quem = (acao: string, modulos: Array<'core'> = ['core']) => PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, permissoes, acao).ok);

  it('RN-CORE-78: o pré-cadastro é de vendedor para cima, sem promotor, e ninguém aprova no BKO', () => {
    expect(manifest.acoes['cliente.aprovar_cadastro']).toBeUndefined();
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).not.toContain('promotor');
    expect(manifest.acoes['cliente.pre_cadastrar']!.perfis).toContain('vendedor');
  });
  it('RN-CORE-78: o POST do pré-cadastro segue único; o BKO lista, vê e corrige os recusados com as ações próprias', () => {
    expect(rotasDeClienteCadastro.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual(['POST clientes/pre-cadastro cliente.pre_cadastrar']);
    expect(rotasDePreCadastroBko.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.superficie}`)).toEqual([
      'GET clientes/pre-cadastro/recusados cliente.pre_cadastro_recusados bko',
      'GET clientes/:id/pre-cadastro cliente.pre_cadastro_recusados bko',
      'GET clientes/:id/pre-cadastro/historico cliente.pre_cadastro_recusados bko',
      'PUT clientes/:id/pre-cadastro cliente.pre_cadastro_corrigir bko',
    ]);
    expect(rotasDePreCadastroBko[0]!.carteira).toBe('filtrar_no_dominio');
    for (const r of rotasDePreCadastroBko.slice(1)) expect(typeof r.carteira).toBe('function');
  });
  it('RN-CORE-78: só analista e admin veem e corrigem os recusados; sem o Core licenciado, ninguém', () => {
    expect(quem('cliente.pre_cadastro_recusados')).toEqual(['analista', 'admin']);
    expect(quem('cliente.pre_cadastro_corrigir')).toEqual(['analista', 'admin']);
    expect(quem('cliente.pre_cadastro_recusados', [])).toEqual([]);
    expect(quem('cliente.pre_cadastro_corrigir', [])).toEqual([]);
  });
  it('RN-CORE-78: o manifest publica os eventos do pré-cadastro e oferece a consulta ao Hub', () => {
    expect(manifest.publica).toContain('core.cliente.pre_cadastrado@1');
    expect(manifest.publica).toContain('core.cliente.pre_cadastro_revisado@1');
    expect(manifest.publica).not.toContain('core.cliente.aprovado@1');
    expect(manifest.ofereceConsultas).toContain('core.clientes_pre_cadastro_sem_erp@1');
    expect(manifest.ofereceConsultas).not.toContain('core.clientes_aprovados_sem_erp@1');
  });
  it('RN-CORE-78 (ADR 0069 §3): o servidor recebe o push cliente_pre_cadastro (antes caía em SYNC_NAO_IMPLEMENTADO)', () => {
    const p = provedoresSyncCore.find((x) => x.entidade.nome === 'cliente_pre_cadastro');
    expect(p?.receber).toBeTypeOf('function');
    expect(p?.entidade.direcao).toBe('push');
    expect(manifest.sync).toContain('cliente_pre_cadastro');
  });
  it('RN-CORE-16 e RN-CORE-79: a lista única é lida por analista e admin e só o admin grava; a rota antiga sai', () => {
    expect(quem('parametro.campos_obrigatorios')).toEqual(['analista', 'admin']);
    expect(quem('parametro.campos_obrigatorios_editar')).toEqual(['admin']);
    expect(manifest.acoes['parametro.pre_cadastro']).toBeUndefined();
    expect(manifest.acoes['parametro.pre_cadastro_editar']).toBeUndefined();
    expect(rotasDeParametrosCamposObrigatorios.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual([
      'GET parametros/campos-obrigatorios parametro.campos_obrigatorios',
      'PUT parametros/campos-obrigatorios parametro.campos_obrigatorios_editar',
    ]);
  });
});
