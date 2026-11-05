/**
 * ADR 0021 (T-0079): `geracao_base` do tenant da sessão em toda página do pull e nas novidades; banco sem a coluna = sem o
 * campo (app antigo e servidor antes da 0022 seguem iguais). Cada tenant recebe só a própria geração.
 */
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { definirEntidadeSync, definirModuloApi, NovidadesRespostaSchema, type LinhaSync, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import { bancoFalso, opcoesDeTeste, TENANT, usuarios, vendedorApi } from './apoio';

const OUTRO_TENANT = '0a000000-0000-4000-8000-000000000002';
const G_A = '11111111-1111-4111-8111-111111111111';
const G_B = '22222222-2222-4222-8222-222222222222';
const AGORA = new Date('2026-11-04T12:00:00.000Z');
const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({}).passthrough() });
const linha: LinhaSync = { id: '0e000000-0000-4000-8000-000000000001', updated_at: new Date(AGORA.getTime() - 10_000).toISOString(), deleted_at: null };

const todos: Record<string, UsuarioAutenticado> = {
  ...usuarios,
  vendedor_b: { id: '0b000000-0000-4000-8000-0000000000b1', tenant_id: OUTRO_TENANT, perfil: 'vendedor' },
};

function montar(geracoes: Record<string, string> | null) {
  const { banco: base } = bancoFalso(() => new Date(AGORA.getTime() - 2_000));
  const lidos: string[] = [];
  const banco: BancoApp = geracoes
    ? {
        ...base,
        geracaoBase: async (t) => {
          lidos.push(t);
          return geracoes[t];
        },
      }
    : base;
  const api = definirModuloApi({ ...vendedorApi, manifesto: vendedor, sync: [{ entidade: pedido, puxar: async () => [linha] }] });
  const opcoes = opcoesDeTeste(undefined, { banco, relogio: () => AGORA });
  const app = createApp({
    ...opcoes,
    autenticar: async (h) => todos[h['x-teste-usuario'] ?? ''] ?? null,
    modulos: opcoes.modulos!.map((m) => (m.manifesto.id === 'vendedor' ? api : m)),
  });
  const get = (url: string, quem: string) => app.inject({ method: 'GET', url, headers: { 'x-teste-usuario': quem } });
  return { app, get, lidos };
}

describe('geracao_base no sync (ADR 0021)', () => {
  it('a página do pull leva a geração do tenant da sessão', async () => {
    const t = montar({ [TENANT]: G_A, [OUTRO_TENANT]: G_B });
    const r = await t.get('/v1/sync/pull?entidade=pedido', 'vendedor');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ geracao_base: G_A, itens: [{ id: linha.id }] });
    expect(t.lidos).toEqual([TENANT]);
  });

  it('dois tenants isolados: cada sessão recebe só a própria geração', async () => {
    const t = montar({ [TENANT]: G_A, [OUTRO_TENANT]: G_B });
    expect((await t.get('/v1/sync/pull?entidade=pedido', 'vendedor_b')).json().geracao_base).toBe(G_B);
    expect((await t.get('/v1/sync/pull?entidade=pedido', 'vendedor')).json().geracao_base).toBe(G_A);
    expect(t.lidos).toEqual([OUTRO_TENANT, TENANT]);
  });

  it('as novidades levam a mesma geração e continuam válidas no contrato do aparelho', async () => {
    const t = montar({ [TENANT]: G_A });
    const r = await t.get('/v1/sync/novidades', 'vendedor');
    expect(r.statusCode).toBe(200);
    expect(NovidadesRespostaSchema.parse(r.json()).geracao_base).toBe(G_A);
  });

  it('banco sem a coluna (antes da 0022) ou sem a leitura: nenhum campo novo, o resto igual', async () => {
    for (const geracoes of [null, {}]) {
      const t = montar(geracoes);
      const pull = await t.get('/v1/sync/pull?entidade=pedido', 'vendedor');
      expect(pull.statusCode).toBe(200);
      expect(pull.json()).not.toHaveProperty('geracao_base');
      const nov = await t.get('/v1/sync/novidades', 'vendedor');
      expect(nov.json()).not.toHaveProperty('geracao_base');
    }
  });
});
