import { pode, type ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { podeAcessarBko, podeUsarApp } from '../domain';
import { perfisDoUsuarioNoLogin, resolverLinhasDePerfil } from './perfis-do-usuario';

const dbCom = (rows: unknown[]): ClienteBanco => ({ query: async () => ({ rows: rows as never[], rowCount: rows.length }) });
const linha = (codigo: string, base: string, sobreposicoes: unknown = []) => ({ codigo, base, fabrica: codigo === base, sobreposicoes });

describe('RN-CORE-35: o login lê o perfil real do usuário (personalizado, com sobreposições) e não só a base', () => {

  it('RN-CORE-33: perfil personalizado de base supervisor com BKO "concedido" no banco continua sem BKO', async () => {
    const sobre = [{ chave: 'acesso.bko', concedida: true, nivel: null, alvos: null }];
    const perfis = await perfisDoUsuarioNoLogin(dbCom([linha('chefe', 'supervisor', sobre)]), 'u1', 'supervisor');
    expect(podeAcessarBko(perfis)).toBe(false);
  });

  it('a empresa que tirou o app Campo do perfil fecha o Campo no login', async () => {
    const sobre = [{ chave: 'acesso.campo', concedida: false, nivel: null, alvos: null }];
    const perfis = await perfisDoUsuarioNoLogin(dbCom([linha('vendedor', 'vendedor', sobre)]), 'u1', 'vendedor');
    expect(podeUsarApp(perfis, 'campo')).toBe(false);
  });

  it('sem nenhuma linha (usuário antigo), cai no perfil de fábrica do principal', async () => {
    const perfis = await perfisDoUsuarioNoLogin(dbCom([]), 'u1', 'gerente');
    expect(podeAcessarBko(perfis)).toBe(true);
    expect(podeUsarApp(perfis, 'gestao')).toBe(true);
  });

  it('RN-CORE-39: sem nenhuma linha, a fábrica do principal leva as ações do Core (admin mantém usuario.filial_editar), no login e sem a matriz da API', async () => {
    expect(pode(await perfisDoUsuarioNoLogin(dbCom([]), 'u1', 'admin'), 'usuario.filial_editar')).toBe(true);
    expect(pode(resolverLinhasDePerfil([], 'admin'), 'usuario.filial_editar')).toBe(true);
  });
});
