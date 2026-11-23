/**
 * Evento apagado da outbox × Postgres real (v1.0.30): a limpeza de cadastros da produção
 * (scripts/producao/limpar-cadastros-rotina.sql) marca `deleted_at` em eventos não publicados. O despachante não os
 * despacha no ciclo, o `reprocessarParados` não os lista nem os reprocessa e o resumo da outbox não os conta; o evento
 * vivo segue normal. Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { manifest as core } from '@macuxi/core/manifest';
import { defineModule, definirConsumidor, definirEvento, definirModuloApi, type ContextoConsumo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarBancoApp, type BancoApp } from '../src/banco';
import { criarDespachante } from '../src/despachante';
import { SQL_RESUMO_OUTBOX } from '../src/observabilidade';
import { gravarEvento } from '../src/outbox';

const A = DOIS_TENANTS.A.tenantId;
const NOME = 'core.apagado_teste.ocorrido@1';
const EVENTO = definirEvento(NOME, z.object({ marca: z.string() }));
const MAX = 2;

describe.skipIf(semBanco())('evento apagado da outbox × Postgres (v1.0.30)', () => {
  let poolWorker: pg.Pool;
  let poolApp: pg.Pool;
  let admin: pg.Client;
  let app: BancoApp;
  const chamadas = new Map<string, number>();
  const falhando = new Set<string>();

  const executar = async (p: { marca: string }, ctx: ContextoConsumo) => {
    chamadas.set(ctx.envelope.evento_id, (chamadas.get(ctx.envelope.evento_id) ?? 0) + 1);
    if (falhando.has(p.marca)) throw new Error('falha simulada do consumidor');
  };
  const modulos = [
    definirModuloApi({ manifesto: core }),
    definirModuloApi({
      manifesto: defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], consome: [NOME] }),
      consumidores: [definirConsumidor({ evento: EVENTO, executar })],
    }),
  ];
  const novo = () => criarDespachante({ worker: poolWorker, app, modulos, maxTentativas: MAX, espera: () => 0 });

  const publicar = async (marca: string) => {
    const id = randomUUID();
    await app.comTenant(A, (db) =>
      gravarEvento(db, { evento_id: id, nome: NOME, origem: 'core', tenant_id: A, usuario_id: null, request_id: 'teste-apagado', ocorrido_em: new Date().toISOString(), payload: { marca } }, null),
    );
    return id;
  };
  /** Como a limpeza da produção: `deleted_at` no evento não publicado. */
  const apagar = (id: string) => admin.query('update plataforma.evento set deleted_at = now() where id = $1', [id]);
  const evento = async (id: string) =>
    (await admin.query<{ publicado_em: Date | null; tentativas: number }>('select publicado_em, tentativas from plataforma.evento where id = $1', [id])).rows[0]!;
  const resumo = async () => (await poolWorker.query<{ pendentes: number; parados: number }>(SQL_RESUMO_OUTBOX, [[NOME], MAX])).rows[0]!;
  const ate = async (d: ReturnType<typeof novo>) => {
    for (let i = 0; i < MAX + 2; i += 1) await d.ciclo();
  };

  beforeAll(async () => {
    const urlWorker = banco().urlWorker;
    if (!urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA)');
    poolWorker = new pg.Pool({ connectionString: urlWorker, max: 3 });
    poolApp = new pg.Pool({ connectionString: banco().urlApp, max: 3 });
    app = criarBancoApp(poolApp);
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    // não deixa evento deste nome pendente para outros arquivos
    await admin?.query('update plataforma.evento set publicado_em = coalesce(publicado_em, now()) where nome = $1', [NOME]).catch(() => undefined);
    await admin?.end();
    await poolWorker?.end();
    await poolApp?.end();
  });

  it('o ciclo não despacha o evento apagado; o vivo é publicado; o resumo não conta o apagado', async () => {
    const d = novo();
    const vivo = await publicar(`vivo-${randomUUID()}`);
    const apagado = await publicar(`apagado-${randomUUID()}`);
    await apagar(apagado);
    expect((await resumo()).pendentes).toBe(1);

    await ate(d);
    expect(chamadas.get(vivo)).toBe(1);
    expect(await evento(vivo)).toMatchObject({ publicado_em: expect.any(Date), tentativas: 1 });
    expect(chamadas.has(apagado)).toBe(false);
    expect(await evento(apagado)).toMatchObject({ publicado_em: null, tentativas: 0 });
    expect(await resumo()).toMatchObject({ pendentes: 0, parados: 0 });
  });

  it('o reprocesso não lista nem reprocessa o parado apagado; o parado vivo é reprocessado', async () => {
    const d = novo();
    const mVivo = `parado-vivo-${randomUUID()}`;
    const mApagado = `parado-apagado-${randomUUID()}`;
    falhando.add(mVivo);
    falhando.add(mApagado);
    const vivo = await publicar(mVivo);
    const apagado = await publicar(mApagado);
    await ate(d);
    for (const id of [vivo, apagado]) expect(await evento(id)).toMatchObject({ publicado_em: null, tentativas: MAX });
    await apagar(apagado);
    expect((await resumo()).parados).toBe(1);

    falhando.delete(mVivo);
    falhando.delete(mApagado);
    const leitura = await d.reprocessarParados({ tenantId: A, confirmar: false });
    const ids = leitura.selecionados.map((s) => s.evento_id);
    expect(ids).toContain(vivo);
    expect(ids).not.toContain(apagado);

    const r = await d.reprocessarParados({ tenantId: A, confirmar: true });
    expect(r.itens.find((i) => i.evento_id === vivo)).toMatchObject({ resultado: 'publicado' });
    expect(r.itens.map((i) => i.evento_id)).not.toContain(apagado);
    expect(chamadas.get(apagado)).toBe(MAX);
    expect(await evento(apagado)).toMatchObject({ publicado_em: null, tentativas: MAX });
    expect(await evento(vivo)).toMatchObject({ publicado_em: expect.any(Date), tentativas: MAX + 1 });
  });
});
