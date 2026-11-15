/** RD-0405: encanamento comum das rotas do portal (exigir, traduzir SQLSTATE das `sa_*`, conferir retorno). */
import type { AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { marcaPortal } from '../src/plataforma';
import { conferirRetorno, exigirPortal, exigirSuperAdmin, traduzirErroSa } from '../src/portal-comum';

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI = { tipo: 'admin_cliente', sessao_id: '5e000000-0000-4000-8000-000000000002' } as unknown as AcessoPortalAutenticado;
const T = '0a000000-0000-4000-8000-000000000001';
const req = () => ({}) as FastifyRequest;
const erro = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as { status?: number; codigo?: string; message: string };
  }
  throw new Error('não lançou');
};

describe('portal-comum', () => {
  it('sem token = 401; com token marca a requisição para a auditoria', async () => {
    await expect(exigirPortal(async () => null, req(), T)).rejects.toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' });
    const r = req();
    expect(await exigirPortal(async () => CLI, r, T)).toBe(CLI);
    expect(marcaPortal(r)).toEqual({ quem: CLI, tenantId: T });
  });

  it('exigirSuperAdmin: admin do cliente = 403 com a frase da rota (marcado mesmo assim)', async () => {
    const r = req();
    await expect(exigirSuperAdmin(async () => CLI, r, T, 'Só o time da Macuxi.')).rejects.toMatchObject({
      status: 403,
      codigo: 'PERFIL_SEM_ACESSO',
      message: 'Só o time da Macuxi.',
    });
    expect(marcaPortal(r)?.quem).toBe(CLI);
    expect(await exigirSuperAdmin(async () => SA, req(), null, 'x')).toBe(SA);
  });

  it('traduzirErroSa: 28000 = 401, 42501 = 403, extras antes dos comuns, o resto relança', () => {
    expect(erro(() => traduzirErroSa({ code: '28000' }))).toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' });
    expect(erro(() => traduzirErroSa({ code: '42501' }))).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    const proprio = new Error('próprio');
    const extras = (code: string, hint: string) => {
      if (code === '28000' && hint === 'X') throw proprio;
    };
    expect(erro(() => traduzirErroSa({ code: '28000', hint: 'X' }, extras))).toBe(proprio);
    expect(erro(() => traduzirErroSa({ code: '28000', hint: 'Y' }, extras))).toMatchObject({ status: 401 });
    const outro = { code: '57014' };
    expect(erro(() => traduzirErroSa(outro))).toBe(outro);
  });

  it('conferirRetorno devolve o dado do contrato ou lança com o nome da função', () => {
    expect(conferirRetorno(z.object({ a: z.number() }), { a: 1 }, 'sa_x')).toEqual({ a: 1 });
    expect(erro(() => conferirRetorno(z.object({ a: z.number() }), { a: '1' }, 'sa_x')).message).toBe('sa_x devolveu formato diferente do combinado');
  });
});
