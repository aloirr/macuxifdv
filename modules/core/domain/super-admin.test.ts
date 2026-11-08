import { describe, expect, it } from 'vitest';
import { chaveBloqueada, decidirAcessoDoLogin, decidirFalhaSuperAdmin, expiracaoDoTokenPlataforma, type ContaConferida } from './super-admin';

const agora = new Date('2026-11-06T12:00:00Z');
const conta = (o: Partial<ContaConferida>): ContaConferida => ({ tipo: 'admin_cliente', conta_id: 'u1', tenant_id: 't1', tenant_codigo: 'a', tenant_nome: 'Empresa A', conferiu: true, ...o });

describe('RN-CORE-31/ADR 0031: bloqueio por 5 falhas e sessão', () => {
  it('RN-CORE-31: a 5ª falha bloqueia por 15 min; passado o bloqueio, recomeça', () => {
    let c = { falhas: 0, bloqueadoAte: null as Date | null };
    for (let i = 1; i <= 4; i++) {
      c = decidirFalhaSuperAdmin(c, agora);
      expect(c.bloqueadoAte).toBeNull();
    }
    c = decidirFalhaSuperAdmin(c, agora);
    expect(c.falhas).toBe(0);
    expect(c.bloqueadoAte?.toISOString()).toBe('2026-11-06T12:15:00.000Z');
    expect(chaveBloqueada(c.bloqueadoAte, agora)).toBe(true);
    const depois = new Date(agora.getTime() + 16 * 60_000);
    expect(chaveBloqueada(c.bloqueadoAte, depois)).toBe(false);
    expect(decidirFalhaSuperAdmin(c, depois).falhas).toBe(1);
  });

  it('RN-CORE-31: falha durante o bloqueio vivo não conta nem estende o bloqueio', () => {
    const bloqueado = { falhas: 0, bloqueadoAte: new Date(agora.getTime() + 15 * 60_000) };
    expect(decidirFalhaSuperAdmin(bloqueado, new Date(agora.getTime() + 60_000))).toEqual(bloqueado);
  });

  it('RN-CORE-31: token de 15 min limitado ao teto de 8 h da sessão', () => {
    const teto = new Date(agora.getTime() + 8 * 3600_000);
    expect(expiracaoDoTokenPlataforma(agora, teto).toISOString()).toBe('2026-11-06T12:15:00.000Z');
    const quase = new Date(teto.getTime() - 60_000);
    expect(expiracaoDoTokenPlataforma(quase, teto).toISOString()).toBe(teto.toISOString());
  });
});

describe('RN-CORE-34/ADR 0032 §8.1: portal ignora conta com senha a trocar', () => {
  it('RN-CORE-34: conta com trocar_senha não entra na lista; se só ela conferiu, o resultado é senha_a_trocar', () => {
    expect(decidirAcessoDoLogin([conta({ trocar_senha: true })])).toEqual({ tipo: 'senha_a_trocar' });
    const r = decidirAcessoDoLogin([conta({ conta_id: 'u1', tenant_id: 't1', trocar_senha: true }), conta({ conta_id: 'u2', tenant_id: 't2', sessao_versao: 3 })]);
    expect(r).toEqual({ tipo: 'admin_cliente', empresas: [{ tenant_id: 't2', usuario_id: 'u2', codigo: 'a', nome: 'Empresa A', sessao_versao: 3 }] });
  });
  it('RN-CORE-34: trocar_senha com senha errada continua sendo credencial inválida (não revela o estado)', () => {
    expect(decidirAcessoDoLogin([conta({ trocar_senha: true, conferiu: false })])).toBeNull();
  });
  it('RN-CORE-34: o super-admin não é afetado', () => {
    expect(decidirAcessoDoLogin([conta({ tipo: 'super_admin', conta_id: 's1', tenant_id: null, trocar_senha: false })])).toEqual({ tipo: 'super_admin', conta_id: 's1' });
  });
});

describe('RN-CORE-33/ADR 0031: quem entra depois de conferir a senha', () => {
  it('RN-CORE-33: nenhuma conta conferiu = ninguém entra', () => {
    expect(decidirAcessoDoLogin([])).toBeNull();
    expect(decidirAcessoDoLogin([conta({ conferiu: false }), conta({ tipo: 'super_admin', tenant_id: null, conferiu: false })])).toBeNull();
  });
  it('RN-CORE-33: super-admin com a senha certa tem precedência sobre as empresas', () => {
    const r = decidirAcessoDoLogin([conta({}), conta({ tipo: 'super_admin', conta_id: 's1', tenant_id: null, tenant_codigo: null, tenant_nome: null })]);
    expect(r).toEqual({ tipo: 'super_admin', conta_id: 's1' });
  });
  it('RN-CORE-33: super-admin com a senha errada não impede o admin do cliente que conferiu', () => {
    const r = decidirAcessoDoLogin([conta({ tipo: 'super_admin', conta_id: 's1', tenant_id: null, conferiu: false }), conta({})]);
    expect(r).toMatchObject({ tipo: 'admin_cliente' });
  });
  it('RN-CORE-33: admin com senhas diferentes em duas empresas só recebe a que conferiu', () => {
    const r = decidirAcessoDoLogin([conta({ conta_id: 'u1', tenant_id: 't1' }), conta({ conta_id: 'u2', tenant_id: 't2', tenant_nome: 'B', conferiu: false })]);
    expect(r).toEqual({ tipo: 'admin_cliente', empresas: [{ tenant_id: 't1', usuario_id: 'u1', codigo: 'a', nome: 'Empresa A', sessao_versao: 0 }] });
  });
  it('RN-CORE-33: mantém a ordem do banco e no máximo 20 empresas', () => {
    const muitas = Array.from({ length: 25 }, (_, i) => conta({ conta_id: `u${i}`, tenant_id: `t${i}` }));
    const r = decidirAcessoDoLogin(muitas);
    expect(r?.tipo === 'admin_cliente' && r.empresas.length).toBe(20);
    expect(r?.tipo === 'admin_cliente' && r.empresas[0]?.usuario_id).toBe('u0');
  });
});
