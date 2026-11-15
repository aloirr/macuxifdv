/**
 * Encanamento comum do portal (RD-0405) e 429 das rotas públicas (RD-0404), sem banco. Dados fictícios.
 */
import type { AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErroHttp } from '../src/erros';
import { recusarPorLimite } from '../src/limitador';
import { marcaPortal } from '../src/plataforma';
import { conferirRetorno, exigirSuperAdmin, traduzirErroSa } from '../src/portal-comum';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: '0a000000-0000-4000-8000-000000000001', usuario_id: '0b000000-0000-4000-8000-000000000001' },
};
const req = () => ({}) as FastifyRequest;
const pg = (code: string, hint?: string) => Object.assign(new Error('pg'), { code, ...(hint ? { hint } : {}) });
const capturar = (f: () => unknown): ErroHttp => {
  try {
    f();
  } catch (e) {
    return e as ErroHttp;
  }
  throw new Error('não lançou');
};
const resumo = (e: ErroHttp) => [e.status, e.codigo, e.message];

describe('exigirSuperAdmin', () => {
  it('sem sessão = 401 sem marca; admin do cliente = 403 com a mensagem do chamador, marcado; super-admin passa', async () => {
    const r0 = req();
    await expect(exigirSuperAdmin({ autenticar: async () => null }, r0, null, 'Só a Macuxi.')).rejects.toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO', message: 'Entre no portal para continuar.' });
    expect(marcaPortal(r0)).toBeUndefined();
    const r1 = req();
    await expect(exigirSuperAdmin({ autenticar: async () => CLI }, r1, 't1', 'Só a Macuxi.')).rejects.toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO', message: 'Só a Macuxi.' });
    expect(marcaPortal(r1)).toEqual({ quem: CLI, tenantId: 't1' });
    const r2 = req();
    expect(await exigirSuperAdmin({ autenticar: async () => SA }, r2, null, 'x')).toBe(SA);
    expect(marcaPortal(r2)).toEqual({ quem: SA, tenantId: null });
  });
});

describe('traduzirErroSa', () => {
  it('comuns: 28000 = 401, 42501 = 403, 22023 = 400; sem caso relança o original', () => {
    expect(resumo(capturar(() => traduzirErroSa(pg('28000'))))).toEqual([401, 'NAO_AUTENTICADO', 'Sua sessão do portal expirou. Entre de novo.']);
    expect(resumo(capturar(() => traduzirErroSa(pg('42501'))))).toEqual([403, 'PERFIL_SEM_ACESSO', 'Seu acesso não permite esta ação.']);
    expect(resumo(capturar(() => traduzirErroSa(pg('22023'))))).toEqual([400, 'VALIDACAO', 'Dados inválidos.']);
    const outro = pg('40001');
    expect(capturar(() => traduzirErroSa(outro))).toBe(outro);
  });
  it('extras recebe code e hint, vem antes dos comuns e, sem lançar, cai neles', () => {
    const vistos: unknown[] = [];
    const extras = (c: string | null, h: string | null) => {
      vistos.push([c, h]);
      if (c === '22023' && h === 'RN-X') throw new ErroHttp(422, 'RN_X', 'Própria.');
    };
    expect(resumo(capturar(() => traduzirErroSa(pg('22023', 'RN-X'), extras)))).toEqual([422, 'RN_X', 'Própria.']);
    expect(resumo(capturar(() => traduzirErroSa(pg('28000'), extras)))[0]).toBe(401);
    expect(vistos).toEqual([['22023', 'RN-X'], ['28000', null]]);
  });
});

describe('conferirRetorno', () => {
  it('devolve o dado conferido; formato errado = Error com o nome da função', () => {
    const S = z.object({ a: z.number() });
    expect(conferirRetorno(S, { a: 1 }, 'sa_x')).toEqual({ a: 1 });
    expect(() => conferirRetorno(S, { a: '1' }, 'sa_x')).toThrow('sa_x devolveu formato diferente do combinado');
  });
});

describe('recusarPorLimite (RD-0404)', () => {
  it('Retry-After no cabeçalho e detalhes.retry_after_s no corpo do 429', () => {
    const cab: Record<string, string> = {};
    const reply = { header: (k: string, v: string) => void (cab[k] = v) } as unknown as FastifyReply;
    const e = capturar(() => recusarPorLimite(reply, 42));
    expect(cab).toEqual({ 'retry-after': '42' });
    expect([e.status, e.corpo()]).toEqual([429, { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas. Aguarde um pouco e tente de novo.', detalhes: { retry_after_s: 42 } }]);
  });
});
