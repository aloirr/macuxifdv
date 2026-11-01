/**
 * T-0030 D-B29 — `GET /v1/auditoria` no createApp, sem Postgres (banco que registra o SQL): perfil, validação, licença
 * do módulo pedido e escopo do gerente (RN-AUD-01, RN-CORE-01/04). A prova com RLS e nomes do Core fica em
 * `auditoria.banco.test.ts`.
 */
import type { BancoApp } from '../src/banco';
import type { ClienteBanco, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { opcoesDeTeste, TENANT } from './apoio';

const quem: Record<string, UsuarioAutenticado> = {
  analista: { id: '0b000000-0000-4000-8000-000000000004', tenant_id: TENANT, perfil: 'analista' },
  gerente: { id: '0b000000-0000-4000-8000-000000000005', tenant_id: TENANT, perfil: 'gerente' },
  supervisor: { id: '0b000000-0000-4000-8000-000000000003', tenant_id: TENANT, perfil: 'supervisor' },
  vendedor: { id: '0b000000-0000-4000-8000-000000000001', tenant_id: TENANT, perfil: 'vendedor' },
};
const EQUIPE = '0b000000-0000-4000-8000-000000000009';
const LINHA = {
  id: '0e000000-0000-4000-8000-000000000001',
  modulo: 'core',
  acao: 'rota.editar',
  entidade: 'rota',
  entidade_id: null,
  usuario_id: quem.analista!.id,
  antes: null,
  depois: { paradas: 3 },
  ocorrido_em: new Date('2026-11-01T12:00:00.000Z'),
};

function montar(linhas: unknown[] = [LINHA]) {
  const sql: { texto: string; valores: readonly unknown[] }[] = [];
  const cliente: ClienteBanco = {
    query: async (texto: string, valores: readonly unknown[] = []) => {
      sql.push({ texto, valores });
      return { rows: texto.includes('plataforma.auditoria') ? (linhas as never[]) : [], rowCount: 0 };
    },
  };
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (_t, fn) => fn(cliente),
    semTenant: async (fn) => fn(cliente),
    horizonteSync: async () => new Date(),
    instanteSync: async () => new Date(),
  };
  const base = opcoesDeTeste();
  const app = createApp({
    ...base,
    banco,
    autenticar: async (h) => quem[h['x-teste-usuario'] ?? ''] ?? null,
    licencas: async (u) => ({
      ativosNoTenant: ['core', 'catalogo', 'vendedor'],
      doPerfil: u.perfil === 'gerente' ? ['core'] : ['core', 'catalogo', 'vendedor'],
      removidosDoUsuario: [],
      parametros: {},
    }),
    usuariosVisiveis: async (u) => (u.perfil === 'gerente' ? new Set([u.id, EQUIPE]) : 'tenant'),
  });
  const get = (u: string, qs = '') => app.inject({ method: 'GET', url: `/v1/auditoria${qs}`, headers: { 'x-teste-usuario': u } });
  return { app, sql, get };
}

describe('GET /v1/auditoria (RN-AUD-01)', () => {
  it('sem sessão → 401; vendedor e supervisor → 403 PERFIL_SEM_ACESSO', async () => {
    const { get } = montar();
    expect((await get('ninguem')).statusCode).toBe(401);
    for (const u of ['vendedor', 'supervisor']) {
      const r = await get(u);
      expect(r.statusCode).toBe(403);
      expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    }
  });

  it('analista (escopo tenant): módulos efetivos, sem filtro de autor; resposta no contrato', async () => {
    const { get, sql } = montar();
    const r = await get('analista', '?entidade=rota&limite=50');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      itens: [{ ...LINHA, usuario_nome: null, ocorrido_em: '2026-11-01T12:00:00.000Z' }],
      proximo_cursor: null,
    });
    const q = sql.find((s) => s.texto.includes('plataforma.auditoria'))!;
    expect(q.valores[0]).toEqual(['core', 'catalogo', 'vendedor']);
    expect(q.texto).not.toContain('usuario_id = any');
    expect(q.valores).toContain('rota');
    expect(q.valores.at(-1)).toBe(51);
  });

  it('RN-CORE-04: gerente vê só os autores visíveis a ele', async () => {
    const { get, sql } = montar([]);
    expect((await get('gerente')).statusCode).toBe(200);
    const q = sql.find((s) => s.texto.includes('plataforma.auditoria'))!;
    expect(q.texto).toContain('usuario_id = any($2::uuid[])');
    expect(q.valores[1]).toEqual([quem.gerente!.id, EQUIPE].sort());
    expect(q.valores[0]).toEqual(['core']);
  });

  it('RN-CORE-01/02: filtrar por módulo inativo para o usuário → 403 MODULO_INATIVO, sem tocar o banco', async () => {
    const { get, sql } = montar();
    const r = await get('gerente', '?modulo=vendedor');
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'vendedor' } });
    expect(sql.some((s) => s.texto.includes('plataforma.auditoria'))).toBe(false);
  });

  it('filtro inválido ou cursor malformado → 400 VALIDACAO', async () => {
    const { get } = montar();
    for (const qs of ['?limite=0', '?limite=301', '?modulo=x', '?entity=sales_order', '?cursor=abc']) {
      const r = await get('analista', qs);
      expect(r.statusCode, qs).toBe(400);
      expect(r.json().codigo).toBe('VALIDACAO');
    }
  });

  it('página cheia devolve proximo_cursor da última linha', async () => {
    const segunda = { ...LINHA, id: '0e000000-0000-4000-8000-000000000002', ocorrido_em: new Date('2026-11-01T11:00:00.000Z') };
    const { get } = montar([LINHA, segunda]);
    const r = await get('analista', '?limite=1');
    expect(r.json().itens).toHaveLength(1);
    expect(r.json().proximo_cursor).toBe(`2026-11-01T12:00:00.000Z_${LINHA.id}`);
  });
});
