/**
 * Limite silencioso do pull por usuário (R-20261115-125500-alexandre; ADR 0057 "Limite por usuário"): `x-macuxi-sync-modo`
 * `parcial` = 1 início a cada 30 s e `completa` = 1 a cada 5 min (`LIMITES_SYNC`), por tenant, usuário e entidade. Dentro da
 * janela: 200 "nada novo" (`limitado`). Continuação da passada passa; automática e push nunca são limitados.
 */
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { CABECALHO_MODO_SYNC, codificarCursor, definirEntidadeSync, definirModuloApi, LIMITES_SYNC, type LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { bancoFalso, cab, LICENCAS_PADRAO, opcoesDeTeste, usuarios, vendedorApi } from './apoio';

const T0 = new Date('2026-11-15T16:00:00.000Z').getTime();
const U = (n: number) => `0e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_centavos: z.number().int() }) });

function montar() {
  let agora = T0;
  let puxadas = 0;
  let recebidos = 0;
  // 1001 linhas: a primeira página tem próximo cursor (completa paginada)
  const linhas: LinhaSync[] = Array.from({ length: 1001 }, (_, i) => ({ id: U(i + 1), updated_at: new Date(T0 - 3_600_000 + i).toISOString(), deleted_at: null }));
  const api = definirModuloApi({
    ...vendedorApi,
    manifesto: vendedor,
    sync: [
      {
        entidade: pedido,
        puxar: async () => {
          puxadas++;
          return linhas;
        },
        receber: async (_ctx, itens) => itens.map((i) => (recebidos++, { id: i.id, status: 'aceito' as const })),
      },
    ],
  });
  const { banco } = bancoFalso(() => new Date(agora - 2000));
  const app = createApp({
    ...opcoesDeTeste(LICENCAS_PADRAO, { banco, relogio: () => new Date(agora) }),
    modulos: opcoesDeTeste().modulos!.map((m) => (m.manifesto.id === 'vendedor' ? api : m)),
  });
  const pull = (modo: string | null, cursor: string | null = null, quem: keyof typeof usuarios = 'vendedor') =>
    app.inject({
      method: 'GET',
      url: `/v1/sync/pull?entidade=pedido${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      headers: { ...cab(quem), ...(modo ? { [CABECALHO_MODO_SYNC]: modo } : {}) },
    });
  return { app, pull, avancar: (ms: number) => (agora += ms), puxadas: () => puxadas, recebidos: () => recebidos };
}

const NADA_NOVO = { itens: [], proximo_cursor: null, limitado: true };

describe('limite silencioso do pull por usuário (R-20261115-125500-alexandre)', () => {
  it('uma constante só: parcial 30 s, completa 5 min', () => {
    expect(LIMITES_SYNC).toEqual({ parcial: 30_000, completa: 300_000 });
  });

  it('parcial: dentro da janela = 200 "nada novo" sem ir ao provedor; fora dela, passa', async () => {
    const t = montar();
    const cursor = codificarCursor({ id: U(1000), updated_at: new Date(T0 - 3_600_000 + 999).toISOString() });
    const r1 = await t.pull('parcial', cursor);
    expect(r1.statusCode).toBe(200);
    expect(r1.json().itens).toHaveLength(1);
    t.avancar(LIMITES_SYNC.parcial - 1);
    const r2 = await t.pull('parcial', cursor);
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual(NADA_NOVO);
    expect(t.puxadas()).toBe(1);
    t.avancar(1);
    const r3 = await t.pull('parcial', cursor);
    expect(r3.json().itens).toHaveLength(1);
    expect(r3.json().limitado).toBeUndefined();
  });

  it('completa: segunda dentro de 5 min = "nada novo"; as páginas seguintes da mesma completa passam; depois de 5 min, passa', async () => {
    const t = montar();
    const p1 = await t.pull('completa');
    expect(p1.json().itens).toHaveLength(1000);
    const proximo = p1.json().proximo_cursor as string;
    expect(proximo).not.toBeNull();
    t.avancar(10_000);
    const p2 = await t.pull('completa', proximo);
    expect(p2.statusCode).toBe(200);
    expect(p2.json().itens).toHaveLength(1);
    expect(p2.json().limitado).toBeUndefined();
    const outra = await t.pull('completa');
    expect([outra.statusCode, outra.json()]).toEqual([200, NADA_NOVO]);
    t.avancar(LIMITES_SYNC.completa - 10_000);
    expect((await t.pull('completa')).json().itens).toHaveLength(1000);
  });

  it('parcial paginada: a página seguinte (cursor que o servidor acabou de dar) passa dentro da janela', async () => {
    const t = montar();
    const p1 = await t.pull('parcial');
    const proximo = p1.json().proximo_cursor as string;
    t.avancar(1000);
    expect((await t.pull('parcial', proximo)).json().itens).toHaveLength(1);
    expect((await t.pull('parcial')).json()).toEqual(NADA_NOVO);
  });

  it('automática (sem cabeçalho, `auto` ou valor desconhecido) nunca é limitada', async () => {
    const t = montar();
    for (const modo of [null, 'auto', 'xpto', null]) expect((await t.pull(modo)).json().limitado).toBeUndefined();
    // e a automática não gasta a janela da parcial
    expect((await t.pull('parcial')).json().limitado).toBeUndefined();
  });

  it('usuários diferentes são independentes; modos diferentes também', async () => {
    const t = montar();
    expect((await t.pull('parcial', null, 'vendedor')).json().limitado).toBeUndefined();
    expect((await t.pull('parcial', null, 'analista')).json().limitado).toBeUndefined();
    expect((await t.pull('completa', null, 'vendedor')).json().limitado).toBeUndefined();
    expect((await t.pull('parcial', null, 'vendedor')).json()).toEqual(NADA_NOVO);
  });

  it('o push nunca é limitado (mesmo com o cabeçalho e logo depois de um pull limitado)', async () => {
    const t = montar();
    await t.pull('parcial');
    await t.pull('parcial');
    for (let i = 1; i <= 3; i++) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/v1/sync/push',
        headers: { ...cab('vendedor'), [CABECALHO_MODO_SYNC]: 'parcial' },
        payload: { itens: [{ id: U(5000 + i), entidade: 'pedido', payload: { total_centavos: 100 } }] },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().resultados[0].status).toBe('aceito');
    }
    expect(t.recebidos()).toBe(3);
  });

  it('sem licença continua 403 (o limite não esconde a checagem de módulo)', async () => {
    const t = montar();
    const r = await t.app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=checklist_loja', headers: { ...cab('vendedor'), [CABECALHO_MODO_SYNC]: 'parcial' } });
    expect(r.statusCode).toBe(403);
  });
});
