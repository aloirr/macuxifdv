import { describe, expect, it } from 'vitest';
import { defineModule, ErroManifesto, validarConjunto } from './manifesto';
import { criarPermissoes, verificarAcao } from './permissoes';
import { criarRegistroExtensoes } from './extensoes';

const core = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], ofereceExtensoes: ['cliente.acoes'] });

/** Matriz do doc 03 §2 para pedido (sem escopo, que fica no domain). */
const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'analista', 'assistente'],
  acoes: {
    'pedido.criar': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] },
    'pedido.cancelar': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] },
    'pedido.aprovar': { perfis: ['supervisor', 'gerente', 'analista'] },
  },
});

const perms = criarPermissoes([core, vendedor]);
const ctx = (perfil: Parameters<typeof perms.pode>[1]['perfil'], modulosAtivos: ('core' | 'vendedor')[] = ['core', 'vendedor']) => ({ perfil, modulosAtivos });

describe('permissão por ação (ADR 0004)', () => {
  it('perfil autorizado com módulo efetivo pode; ação desconhecida ou módulo inativo, não', () => {
    expect(perms.pode('pedido.criar', ctx('vendedor'))).toBe(true);
    expect(perms.pode('pedido.aprovar', ctx('vendedor'))).toBe(false);
    expect(perms.pode('pedido.criar', ctx('vendedor', ['core']))).toBe(false);
    expect(perms.pode('pedido.inexistente', ctx('admin'))).toBe(false);
    expect(perms.pode('pedido.criar', ctx(null))).toBe(false);
    expect(perms.acoesPermitidas(ctx('assistente'))).toEqual(['pedido.cancelar', 'pedido.criar']);
  });

  it('RN-PRO-01: manifesto que dá ação de pedido ao promotor é recusado', () => {
    expect(() =>
      defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], acoes: { 'pedido.criar': { perfis: ['vendedor', 'promotor'] } } }),
    ).toThrow(ErroManifesto);
  });

  it('RN-PRO-01 vale pelo perfil: promotor com o Vendedor ativo continua sem nenhuma ação de pedido', () => {
    expect(perms.acoesPermitidas(ctx('promotor'))).toEqual([]);
    expect(perms.regraDaAcao('pedido.criar').perfis).not.toContain('promotor');
  });

  it('O-3 (doc 03 §2 "Ver pedidos"): a leitura pedido.ver vem do manifesto — concedida ao promotor, ele lê; escrita continua negada', () => {
    const comVer = defineModule({
      id: 'vendedor',
      versao: '1.0.0',
      depende: ['core'],
      perfis: ['vendedor'],
      acoes: { 'pedido.ver': { perfis: ['vendedor', 'promotor'] }, 'pedido.criar': { perfis: ['vendedor'] } },
    });
    const p = criarPermissoes([core, comVer]);
    expect(p.acoesPermitidas(ctx('promotor'))).toEqual(['pedido.ver']);
    expect(p.pode('pedido.ver', ctx('promotor', ['core']))).toBe(false);
    expect(p.regraDaAcao('pedido.ver').perfis).toContain('promotor');
    const promotor = { id: 'u', tenant_id: 't', perfil: 'promotor' as const, modulos: ['core', 'vendedor'] as const };
    expect(verificarAcao(promotor, p, 'pedido.ver')).toEqual({ ok: true });
    expect(verificarAcao(promotor, p, 'pedido.criar')).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    // sem a concessão no manifesto, nada de leitura (falha fechada)
    expect(perms.pode('pedido.ver', ctx('promotor'))).toBe(false);
  });

  it('RN-PRO-01: manifesto que dá ao promotor qualquer ação de ESCRITA de pedido é recusado (inclui pedido_item.*)', () => {
    for (const acao of ['pedido.editar', 'pedido.duplicar', 'pedido_item.ver_e_editar', 'pedido_item.criar']) {
      expect(() => defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], acoes: { [acao]: { perfis: ['promotor'] } } }), acao).toThrow(
        /RN-PRO-01/,
      );
    }
  });

  it('API: verificarAcao devolve 401, 403 MODULO_INATIVO e 403 PERFIL_SEM_ACESSO', () => {
    const u = (perfil: 'vendedor' | 'promotor', modulos: ('core' | 'vendedor')[]) => ({ id: 'u', tenant_id: 't', perfil, modulos });
    expect(verificarAcao(null, perms, 'pedido.criar')).toMatchObject({ status: 401 });
    expect(verificarAcao(u('vendedor', ['core']), perms, 'pedido.criar')).toMatchObject({ status: 403, codigo: 'MODULO_INATIVO' });
    expect(verificarAcao(u('promotor', ['core', 'vendedor']), perms, 'pedido.criar')).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    expect(verificarAcao(u('vendedor', ['core', 'vendedor']), perms, 'pedido.criar')).toEqual({ ok: true });
  });

  it('extensão com ação só aparece para quem pode; sem `pode` no filtro, fica escondida', () => {
    const r = criarRegistroExtensoes<{ 'cliente.acoes': { rotulo: string } }>();
    r.declararSlot('cliente.acoes', 'core');
    r.registrar('cliente.acoes', { modulo: 'vendedor', id: 'novo-pedido', acao: 'pedido.criar', payload: { rotulo: 'Novo pedido' } });
    r.registrar('cliente.acoes', { modulo: 'core', id: 'ligar', payload: { rotulo: 'Ligar' } });
    const listar = (perfil: 'vendedor' | 'promotor', comPode = true) =>
      r.listar('cliente.acoes', { modulosAtivos: ['core', 'vendedor'], perfil, pode: comPode ? (a) => perms.pode(a, ctx(perfil)) : undefined }).map((i) => i.id);
    expect(listar('vendedor')).toEqual(['ligar', 'novo-pedido']);
    expect(listar('promotor')).toEqual(['ligar']);
    expect(listar('vendedor', false)).toEqual(['ligar']);
  });

  it('a mesma ação declarada por dois módulos é inconsistência do conjunto', () => {
    const outro = defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core'], perfis: ['gerente'], acoes: { 'pedido.criar': { perfis: ['gerente'] } } });
    expect(validarConjunto([core, vendedor, outro])).toContain('ação pedido.criar declarada por vendedor e por gestor');
    expect(() => criarPermissoes([core, vendedor, outro])).toThrow(/declarada por vendedor e por gestor/);
  });
});
