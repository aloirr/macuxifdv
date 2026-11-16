/** Contratos do acesso ao portal só com e-mail e senha (T-0093; ADR 0031; RN-CORE-32/33/34). */
import { describe, expect, it } from 'vitest';
import { CriarEmpresaRespostaSchema, CriarEmpresaSchema, EscolherEmpresaPortalSchema, LoginPortalSchema, MAX_EMPRESAS_LOGIN_PORTAL, SessaoPortalSchema, } from './plataforma';
const A = { id: '11111111-1111-4111-8111-111111111111', codigo: 'dist-a', nome: 'Distribuidora A' };
const B = { id: '22222222-2222-4222-8222-222222222222', codigo: 'dist-b', nome: 'Distribuidora B' };
const tempo = { token: 'x'.repeat(40), expira_em: '2026-11-07T18:15:00.000Z', sessao_expira_em: '2026-11-08T02:00:00.000Z' };
describe('LoginPortalSchema', () => {
    it('só e-mail e senha; senha antiga curta ainda entra (RN-CORE-32 vale na criação e na troca)', () => {
        expect(LoginPortalSchema.parse({ email: ' Ana@X.com ', senha: 'abc' })).toEqual({ email: 'ana@x.com', senha: 'abc' });
        expect(LoginPortalSchema.safeParse({ email: 'ana@x.com', senha: 'abc', convite: 'y'.repeat(32) }).success).toBe(false);
        expect(LoginPortalSchema.safeParse({ email: 'ana@x.com', senha: '' }).success).toBe(false);
    });
});
describe('SessaoPortalSchema', () => {
    it('super-admin: sem empresa na sessão (a lista de todas vem de /v1/plataforma/empresas)', () => {
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'super_admin', empresa: null, empresas: [] }).success).toBe(true);
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'super_admin', empresa: A, empresas: [A] }).success).toBe(false);
    });
    it('admin do cliente com uma empresa: já vem escolhida', () => {
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: A, empresas: [A] }).success).toBe(true);
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: null, empresas: [A] }).success).toBe(false);
    });
    it('admin do cliente com mais de uma: escolha pendente ou escolhida dentro da lista conferida', () => {
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: null, empresas: [A, B] }).success).toBe(true);
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: B, empresas: [A, B] }).success).toBe(true);
        const fora = { ...B, id: '33333333-3333-4333-8333-333333333333' };
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: fora, empresas: [A, B] }).success).toBe(false);
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: null, empresas: [] }).success).toBe(false);
    });
    it(`no máximo ${MAX_EMPRESAS_LOGIN_PORTAL} empresas`, () => {
        const muitas = Array.from({ length: MAX_EMPRESAS_LOGIN_PORTAL + 1 }, (_, i) => ({ ...A, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
        expect(SessaoPortalSchema.safeParse({ ...tempo, tipo: 'admin_cliente', empresa: null, empresas: muitas }).success).toBe(false);
    });
});
describe('escolha de empresa e admin inicial (RN-CORE-34)', () => {
    it('escolher pede só o tenant', () => {
        expect(EscolherEmpresaPortalSchema.parse({ tenant_id: A.id })).toEqual({ tenant_id: A.id });
        expect(EscolherEmpresaPortalSchema.safeParse({ tenant_id: 'dist-a' }).success).toBe(false);
    });
    it('passo Empresa aceita o admin inicial (opcional no contrato; a API exige na criação)', () => {
        const base = { codigo: 'dist-a', razao_social: 'Distribuidora A Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'vendedor' }] };
        expect(CriarEmpresaSchema.parse(base).admin).toBeUndefined();
        const e = CriarEmpresaSchema.parse({ ...base, admin: { email: 'Admin@A.com', nome: 'Admin A', senha: 'Abc12345!' } });
        expect(e.admin).toEqual({ email: 'admin@a.com', nome: 'Admin A', senha: 'Abc12345!' });
        expect(CriarEmpresaSchema.safeParse({ ...base, admin: { email: 'admin@a.com', nome: 'Admin A', senha: 'x', perfil: 'admin' } }).success).toBe(false);
    });
    it('resposta diz se o admin foi criado; ausente = null', () => {
        const r = { tenant_id: A.id, codigo: 'dist-a', resultado: 'criado', modulos_adicionados: [], parametros_gravados: [], avisos: [], simulado: false };
        expect(CriarEmpresaRespostaSchema.parse(r).admin).toBeNull();
        expect(CriarEmpresaRespostaSchema.parse({ ...r, admin: 'criado' }).admin).toBe('criado');
    });
});
