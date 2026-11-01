/**
 * Despachante da outbox × Postgres real (T-0022; ADR 0007; migração 0003; RN-CORE-05). Fixture dois-tenants:
 * A tem o Promotor licenciado, B não (os dois têm o Vendedor). Evento de teste próprio (`core.despacho_teste.ocorrido@1`),
 * que nenhum outro teste publica: o despachante só lê eventos com consumidor instalado, então o resultado não depende
 * dos outros arquivos de teste que gravam na mesma outbox.
 *  - entrega única a cada consumidor ativo; consumidor sem licença no tenant não recebe;
 *  - reentrega (evento reaberto, dois despachantes em paralelo) não repete o efeito;
 *  - falha do handler desfaz efeito + registro, retenta com espera crescente e não segura o evento do outro tenant;
 *  - tentativas esgotadas: o evento para;
 *  - handler roda como macuxi_app no tenant do envelope e não enxerga o outro tenant.
 * Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 */
import { randomUUID } from 'node:crypto';
import { DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { manifest as core } from '@macuxi/core/manifest';
import { defineModule, definirConsumidor, definirEvento, definirModuloApi, type ContextoConsumo, type ModuloId } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarBancoApp, type BancoApp } from '../src/banco';
import { criarDespachante, esperaPadrao, verificarPapelWorker } from '../src/despachante';
import { gravarEvento } from '../src/outbox';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const NOME = 'core.despacho_teste.ocorrido@1';
const EVENTO = definirEvento(NOME, z.object({ marca: z.string(), falhar: z.number().int().min(0).default(0) }));

interface Observacao {
  modulo: ModuloId;
  evento_id: string;
  tenant_envelope: string;
  papel: string;
  tenant_contexto: string;
  tenants_visiveis_outbox: string[];
  tenants_visiveis_efeito: string[];
}

describe.skipIf(semBanco())('despachante da outbox × Postgres (T-0022, ADR 0007)', () => {
  let poolWorker: pg.Pool;
  let poolApp: pg.Pool;
  let admin: pg.Client;
  let app: BancoApp;
  const chamadas = new Map<string, number>();
  const falhasFeitas = new Map<string, number>();
  const observado: Observacao[] = [];

  /** Handler de teste: grava o efeito no banco do tenant, observa o que enxerga e falha `falhar` vezes (só o Vendedor). */
  const handler = (modulo: ModuloId) => async (p: { marca: string; falhar: number }, ctx: ContextoConsumo) => {
    const k = `${modulo}:${ctx.envelope.evento_id}`;
    chamadas.set(k, (chamadas.get(k) ?? 0) + 1);
    const quem = (await ctx.db.query<{ papel: string; tenant: string }>('select current_user as papel, plataforma.tenant_atual()::text as tenant')).rows[0]!;
    const outbox = (await ctx.db.query<{ tenant_id: string }>('select distinct tenant_id from plataforma.evento')).rows.map((r) => r.tenant_id);
    const efeito = (await ctx.db.query<{ tenant_id: string }>('select distinct tenant_id from teste_despacho.efeito')).rows.map((r) => r.tenant_id);
    observado.push({
      modulo,
      evento_id: ctx.envelope.evento_id,
      tenant_envelope: ctx.envelope.tenant_id,
      papel: quem.papel,
      tenant_contexto: quem.tenant,
      tenants_visiveis_outbox: outbox,
      tenants_visiveis_efeito: efeito,
    });
    await ctx.db.query('insert into teste_despacho.efeito (tenant_id, consumidor, evento_id, marca) values ($1, $2, $3, $4)', [
      ctx.envelope.tenant_id,
      modulo,
      ctx.envelope.evento_id,
      p.marca,
    ]);
    if (modulo === 'vendedor' && (falhasFeitas.get(k) ?? 0) < p.falhar) {
      falhasFeitas.set(k, (falhasFeitas.get(k) ?? 0) + 1);
      throw new Error('falha simulada do consumidor');
    }
  };

  const consumidorApi = (id: 'vendedor' | 'promotor') =>
    definirModuloApi({
      manifesto: defineModule({ id, versao: '1.0.0', depende: ['core'], perfis: [id], consome: [NOME] }),
      consumidores: [definirConsumidor({ evento: EVENTO, executar: handler(id) })],
    });
  const modulos = [definirModuloApi({ manifesto: core }), consumidorApi('vendedor'), consumidorApi('promotor')];

  const novoDespachante = (relogio: { agora: Date }, extra: { maxTentativas?: number } = {}) =>
    criarDespachante({ worker: poolWorker, app, modulos, agora: () => relogio.agora, ...extra });

  const publicar = async (tenant: string, payload: { marca: string; falhar?: number }) => {
    const id = randomUUID();
    await app.comTenant(tenant, (db) =>
      gravarEvento(
        db,
        { evento_id: id, nome: NOME, origem: 'core', tenant_id: tenant, usuario_id: null, request_id: 'teste-despacho', ocorrido_em: new Date().toISOString(), payload },
        null,
      ),
    );
    return id;
  };

  /** Visão do administrador (fora do RLS) para conferir o resultado. */
  const evento = async (id: string) =>
    (await admin.query<{ publicado_em: Date | null; tentativas: number; ultimo_erro: string | null }>('select publicado_em, tentativas, ultimo_erro from plataforma.evento where id = $1', [id])).rows[0]!;
  const consumos = async (id: string) =>
    (await admin.query<{ consumidor: string; tenant_id: string }>('select consumidor, tenant_id from plataforma.evento_consumo where evento_id = $1 order by consumidor', [id])).rows;
  const efeitos = async (id: string) =>
    (await admin.query<{ consumidor: string; tenant_id: string }>('select consumidor, tenant_id from teste_despacho.efeito where evento_id = $1 order by consumidor', [id])).rows;
  const ate = async (d: ReturnType<typeof novoDespachante>) => {
    for (let i = 0; i < 10; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };

  beforeAll(async () => {
    const urlWorker = banco().urlWorker;
    if (!urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA)');
    poolWorker = new pg.Pool({ connectionString: urlWorker, max: 3 });
    poolApp = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    app = criarBancoApp(poolApp);
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    // tabela do efeito do handler de teste, com o mesmo RLS por tenant das tabelas de negócio
    await admin.query(`
      create schema if not exists teste_despacho;
      create table if not exists teste_despacho.efeito (
        tenant_id uuid not null, consumidor text not null, evento_id uuid not null, marca text not null,
        unique (tenant_id, consumidor, evento_id)
      );
      alter table teste_despacho.efeito enable row level security;
      alter table teste_despacho.efeito force row level security;
      drop policy if exists isolamento_tenant on teste_despacho.efeito;
      create policy isolamento_tenant on teste_despacho.efeito for all to macuxi_app
        using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());
      grant usage on schema teste_despacho to macuxi_app;
      grant select, insert on teste_despacho.efeito to macuxi_app;`);
  });
  afterAll(async () => {
    await admin?.query('drop schema if exists teste_despacho cascade').catch(() => undefined);
    await admin?.end();
    await poolWorker?.end();
    await poolApp?.end();
  });

  it('o despachante conecta como macuxi_worker sem BYPASSRLS; a conexão da API é recusada', async () => {
    await expect(verificarPapelWorker(poolWorker)).resolves.toBeUndefined();
    await expect(verificarPapelWorker(poolApp)).rejects.toThrow(/macuxi_worker/);
  });

  it('entrega uma vez a cada consumidor ativo; o Promotor sem licença em B não recebe; publicado_em marcado', async () => {
    const eA = await publicar(A, { marca: 'a1' });
    const eB = await publicar(B, { marca: 'b1' });
    const d = novoDespachante({ agora: new Date() });
    expect(d.eventos()).toEqual([NOME]);
    await ate(d);

    expect(await consumos(eA)).toEqual([
      { consumidor: 'promotor', tenant_id: A },
      { consumidor: 'vendedor', tenant_id: A },
    ]);
    expect(await efeitos(eA)).toEqual([
      { consumidor: 'promotor', tenant_id: A },
      { consumidor: 'vendedor', tenant_id: A },
    ]);
    // RN-CORE-02: B não tem o Promotor → só o Vendedor consome
    expect(await consumos(eB)).toEqual([{ consumidor: 'vendedor', tenant_id: B }]);
    expect(await efeitos(eB)).toEqual([{ consumidor: 'vendedor', tenant_id: B }]);
    expect(chamadas.get(`promotor:${eB}`)).toBeUndefined();
    for (const id of [eA, eB]) expect(await evento(id)).toMatchObject({ publicado_em: expect.any(Date), tentativas: 1, ultimo_erro: null });
  });

  it('handler roda como macuxi_app no tenant do envelope e não enxerga o outro tenant (RN-CORE-05)', async () => {
    const eA = await publicar(A, { marca: 'a-vaz' });
    const eB = await publicar(B, { marca: 'b-vaz' });
    await ate(novoDespachante({ agora: new Date() }));
    const deles = observado.filter((o) => o.evento_id === eA || o.evento_id === eB);
    expect(deles).toHaveLength(3); // A: vendedor + promotor; B: vendedor
    for (const o of deles) {
      expect(o.papel).toBe('macuxi_app');
      expect(o.tenant_contexto).toBe(o.tenant_envelope);
      expect(o.tenants_visiveis_outbox).toEqual([o.tenant_envelope]);
      expect(o.tenants_visiveis_efeito.every((t) => t === o.tenant_envelope)).toBe(true);
    }
    expect(deles.find((o) => o.evento_id === eB)?.tenant_envelope).toBe(B);
  });

  it('reentrega não repete o efeito: evento reaberto e dois despachantes em paralelo', async () => {
    const eA = await publicar(A, { marca: 'a-re' });
    await ate(novoDespachante({ agora: new Date() }));
    expect(chamadas.get(`vendedor:${eA}`)).toBe(1);

    // reabre (como se o worker caísse depois do handler e antes de marcar publicado_em)
    await poolWorker.query('update plataforma.evento set publicado_em = null where id = $1', [eA]);
    await ate(novoDespachante({ agora: new Date() }));
    expect(chamadas.get(`vendedor:${eA}`)).toBe(1);
    expect(chamadas.get(`promotor:${eA}`)).toBe(1);
    expect(await efeitos(eA)).toHaveLength(2);
    expect((await evento(eA)).publicado_em).not.toBeNull();

    // vários processos: skip locked + registro de consumo → cada evento uma vez por consumidor
    const ids = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => publicar(i % 2 ? A : B, { marca: `par-${i}` })));
    const relogio = { agora: new Date() };
    await Promise.all([ate(novoDespachante(relogio)), ate(novoDespachante(relogio))]);
    for (const id of ids) {
      expect(chamadas.get(`vendedor:${id}`)).toBe(1);
      expect((await evento(id)).publicado_em).not.toBeNull();
    }
  });

  it('falha do handler desfaz efeito e registro, retenta com espera crescente e não segura o outro tenant', async () => {
    const relogio = { agora: new Date('2026-10-31T12:00:00Z') };
    const d = novoDespachante(relogio);
    const eA = await publicar(A, { marca: 'a-falha', falhar: 2 });
    const eB = await publicar(B, { marca: 'b-ok' });

    await ate(d);
    // B segue: publicado mesmo com o evento de A falhando no mesmo lote
    expect((await evento(eB)).publicado_em).not.toBeNull();
    // A: o Promotor consumiu; o Vendedor falhou → o insert do efeito e o registro de consumo desfizeram
    expect(await consumos(eA)).toEqual([{ consumidor: 'promotor', tenant_id: A }]);
    expect(await efeitos(eA)).toEqual([{ consumidor: 'promotor', tenant_id: A }]);
    const e1 = await evento(eA);
    expect(e1).toMatchObject({ publicado_em: null, tentativas: 1 });
    expect(e1.ultimo_erro).toMatch(/^vendedor: Error: falha simulada do consumidor/);
    expect(d.emEspera().get(eA)).toBe(relogio.agora.getTime() + esperaPadrao(1));

    // antes da espera: não tenta de novo
    await d.ciclo();
    expect(chamadas.get(`vendedor:${eA}`)).toBe(1);

    // depois de 5 s: 2ª falha, espera dobra (10 s)
    relogio.agora = new Date(relogio.agora.getTime() + esperaPadrao(1));
    await ate(d);
    expect(chamadas.get(`vendedor:${eA}`)).toBe(2);
    expect(await evento(eA)).toMatchObject({ publicado_em: null, tentativas: 2 });
    expect(esperaPadrao(2)).toBe(2 * esperaPadrao(1));
    relogio.agora = new Date(relogio.agora.getTime() + esperaPadrao(2) - 1);
    await d.ciclo();
    expect(chamadas.get(`vendedor:${eA}`)).toBe(2);

    // passou a espera: consome; o Promotor (que já tinha consumido) não roda de novo
    relogio.agora = new Date(relogio.agora.getTime() + 1);
    await ate(d);
    expect(chamadas.get(`vendedor:${eA}`)).toBe(3);
    expect(chamadas.get(`promotor:${eA}`)).toBe(1);
    expect(await efeitos(eA)).toEqual([
      { consumidor: 'promotor', tenant_id: A },
      { consumidor: 'vendedor', tenant_id: A },
    ]);
    expect(await evento(eA)).toMatchObject({ publicado_em: expect.any(Date), tentativas: 3, ultimo_erro: null });
  });

  it('tentativas esgotadas: o evento para e fica pendente com o último erro', async () => {
    const relogio = { agora: new Date('2026-10-31T13:00:00Z') };
    const d = novoDespachante(relogio, { maxTentativas: 2 });
    const eA = await publicar(A, { marca: 'a-para', falhar: 99 });
    await ate(d);
    relogio.agora = new Date(relogio.agora.getTime() + esperaPadrao(1));
    await ate(d);
    expect(await evento(eA)).toMatchObject({ publicado_em: null, tentativas: 2, ultimo_erro: expect.stringMatching(/^vendedor:/) });
    expect(d.emEspera().has(eA)).toBe(false);
    relogio.agora = new Date(relogio.agora.getTime() + 60 * 60_000);
    await ate(d);
    expect(chamadas.get(`vendedor:${eA}`)).toBe(2);
    // não deixa o evento parado para os outros arquivos de teste (nenhum outro consome este nome)
    await poolWorker.query('update plataforma.evento set publicado_em = now() where id = $1', [eA]);
  });
});
