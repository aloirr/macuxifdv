import { describe, expect, it } from 'vitest';
import { corpoDoErro, ErroApiSchema, escopoDoPerfil, verificarAcesso, verificarCarteira, type UsuarioAcesso } from './acesso';

const vendedor: UsuarioAcesso = { id: 'u1', tenant_id: 't1', perfil: 'vendedor', modulos: ['core', 'vendedor'] };
const promotor: UsuarioAcesso = { id: 'u2', tenant_id: 't1', perfil: 'promotor', modulos: ['core', 'vendedor', 'promotor'] };
const criarPedido = { modulo: 'vendedor', perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] } as const;

describe('verificação de acesso em toda rota', () => {
  it('sem login → 401', () => {
    expect(verificarAcesso(null, criarPedido)).toMatchObject({ ok: false, status: 401, codigo: 'NAO_AUTENTICADO' });
  });

  it('RN-CORE-02: módulo fora dos efetivos → 403 MODULO_INATIVO com corpo { codigo, mensagem }', () => {
    const r = verificarAcesso({ ...vendedor, modulos: ['core'] }, criarPedido);
    expect(r).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
    if (r.ok) throw new Error('esperava negado');
    const corpo = corpoDoErro(r);
    expect(ErroApiSchema.parse(corpo)).toEqual({ codigo: 'MODULO_INATIVO', mensagem: 'O módulo vendedor não está ativo para você.' });
  });

  it('RN-PRO-01: promotor não cria pedido mesmo com Vendedor ativo → 403 PERFIL_SEM_ACESSO', () => {
    expect(verificarAcesso(promotor, criarPedido)).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    expect(verificarAcesso(vendedor, criarPedido)).toEqual({ ok: true });
  });

  it('RN-CORE-04: escopo por perfil e checagem de carteira', () => {
    expect(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'].map((p) => escopoDoPerfil(p as never))).toEqual([
      'carteira',
      'carteira',
      'equipe',
      'equipes_abaixo',
      'tenant',
      'tenant',
      'tenant',
    ]);
    expect(verificarCarteira('c1', new Set(['c1']))).toEqual({ ok: true });
    expect(verificarCarteira('c9', new Set(['c1']))).toMatchObject({ ok: false, status: 403, codigo: 'FORA_DA_CARTEIRA' });
    expect(verificarCarteira('c9', 'tenant')).toEqual({ ok: true });
  });
});
