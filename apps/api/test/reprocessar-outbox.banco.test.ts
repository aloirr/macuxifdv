/**
 * `Despachante.reprocessarParados` × Postgres real (workflow producao-reprocessar-outbox.yml; desenho
 * docs/desenho/outbox-parada-v1014.md, §7). Evento de teste próprio, com dois consumidores (Vendedor e Promotor):
 *  - só leitura (`confirmar: false`): lista os parados da empresa e não muda nada;
 *  - só os parados (tentativas = máximo) da empresa pedida: o da outra empresa e o que ainda está em nova tentativa ficam;
 *  - uma tentativa só: o que volta a falhar fica com tentativas > máximo, com a classe nova, e a rodada seguinte não o pega;
 *  - o consumidor que já tinha consumido não repete (mesma `evento_consumo` do despachante);
 *  - acima do teto: recusa e nada muda no banco.
 * Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 falha.
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
import { criarDespachante } from '../src/despachante';
import { ErroTetoReprocesso } from '../src/reprocessar-outbox';
import { gravarEvento } from '../src/outbox';

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const NOME = 'core.reprocesso_teste.ocorrido@1';
const EVENTO = definirEvento(NOME, z.object({ marca: z.string() }));
const MAX = 3;

class ReferenciaAusenteErp extends Error {
  constructor() {
    super('referencia_ausente: 1 registro(s) de catalogo_no ainda não chegaram');
    this.name = 'ReferenciaAusenteErp';
  }
}

describe.skipIf(semBanco())('reprocesso único dos eventos parados × Postgres', () => {
  let poolWorker: pg.Pool;
  let poolApp: pg.Pool;
  let admin: pg.Client;
  let app: BancoApp;
  const chamadas = new Map<string, number>();
  /** marca → o Vendedor falha enquanto estiver aqui. */
  const falhando = new Set<string>();

  const handler = (modulo: ModuloId) => async (p: { marca: string }, ctx: ContextoConsumo) => {
    const k = `${modulo}:${ctx.envelope.evento_id}`;
    chamadas.set(k, (chamadas.get(k) ?? 0) + 1);
    if (modulo === 'vendedor' && falhando.has(p.marca)) throw new ReferenciaAusenteErp();
  };
  const consumidorApi = (id: 'vendedor' | 'promotor') =>
    definirModuloApi({
      manifesto: defineModule({ id, versao: '1.0.0', depende: ['core'], perfis: [id], consome: [NOME] }),
      consumidores: [definirConsumidor({ evento: EVENTO, executar: handler(id) })],
    });
  const modulos = [definirModuloApi({ manifesto: core }), consumidorApi('vendedor'), consumidorApi('promotor')];
  const novo = () => criarDespachante({ worker: poolWorker, app, modulos, maxTentativas: MAX, espera: () => 0 });

  const publicar = async (tenant: string, marca: string) => {
    const id = randomUUID();
    await app.comTenant(tenant, (db) =>
      gravarEvento(db, { evento_id: id, nome: NOME, origem: 'core', tenant_id: tenant, usuario_id: null, request_id: 'teste-reprocesso', ocorrido_em: new Date().toISOString(), payload: { marca } }, null),
    );
    return id;
  };
  const evento = async (id: string) =>
    (await admin.query<{ publicado_em: Date | null; tentativas: number; ultimo_erro: string | null }>('select publicado_em, tentativas, ultimo_erro from plataforma.evento where id = $1', [id])).rows[0]!;
  /** Para o evento como o despachante faria: MAX ciclos com falha (sem espera). */
  const pararAte = async (d: ReturnType<typeof novo>) => {
    for (let i = 0; i < MAX + 2; i += 1) await d.ciclo();
  };

  beforeAll(async () => {
    const urlWorker = banco().urlWorker;
    if (!urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA)');
    poolWorker = new pg.Pool({ connectionString: urlWorker, max: 3 });
    poolApp = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    app = criarBancoApp(poolApp);
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await poolWorker?.end();
    await poolApp?.end();
  });

  it('só leitura, só os parados da empresa; com confirmar, uma tentativa só e nada se repete', async () => {
    const d = novo();
    const voltaOk = `ok-${randomUUID()}`;
    const voltaFalha = `falha-${randomUUID()}`;
    const deB = `b-${randomUUID()}`;
    for (const m of [voltaOk, voltaFalha, deB]) falhando.add(m);
    const eOk = await publicar(A, voltaOk);
    const eFalha = await publicar(A, voltaFalha);
    const eB = await publicar(B, deB);
    await pararAte(d);
    for (const id of [eOk, eFalha, eB]) expect(await evento(id)).toMatchObject({ publicado_em: null, tentativas: MAX });
    // o Promotor consumiu na 1ª tentativa; só o Vendedor falha
    expect(chamadas.get(`promotor:${eOk}`)).toBe(1);

    // em nova tentativa (abaixo do máximo): é do despachante, não do reprocesso
    const emCurso = await publicar(A, `curso-${randomUUID()}`);

    const leitura = await d.reprocessarParados({ tenantId: A, confirmar: false });
    expect(leitura.modo).toBe('leitura');
    const meus = (l: { evento_id: string }[]) => l.map((x) => x.evento_id).filter((id) => ([eOk, eFalha, eB, emCurso] as string[]).includes(id));
    expect(meus(leitura.selecionados)).toEqual([eOk, eFalha]);
    expect(leitura.selecionados.find((s) => s.evento_id === eOk)?.classe).toBe('vendedor: ReferenciaAusenteErp');
    expect(leitura.itens).toEqual([]);
    expect(await evento(eOk)).toMatchObject({ publicado_em: null, tentativas: MAX });

    // a causa sai de um deles; o outro continua falhando
    falhando.delete(voltaOk);
    const r = await d.reprocessarParados({ tenantId: A, confirmar: true });
    expect(r.modo).toBe('reprocessado');
    const itens = r.itens.filter((i) => ([eOk, eFalha] as string[]).includes(i.evento_id));
    expect(itens).toEqual([
      { evento_id: eOk, nome: NOME, resultado: 'publicado', classe_depois: null },
      { evento_id: eFalha, nome: NOME, resultado: 'parado_de_novo', classe_depois: 'vendedor: ReferenciaAusenteErp' },
    ]);
    expect(await evento(eOk)).toMatchObject({ publicado_em: expect.any(Date), tentativas: MAX + 1, ultimo_erro: null });
    expect(await evento(eFalha)).toMatchObject({ publicado_em: null, tentativas: MAX + 1 });
    // a outra empresa e o evento em nova tentativa não foram tocados; o Promotor não repetiu
    expect(await evento(eB)).toMatchObject({ publicado_em: null, tentativas: MAX });
    expect((await evento(emCurso)).tentativas).toBeLessThan(MAX);
    expect(chamadas.get(`promotor:${eOk}`)).toBe(1);
    expect(chamadas.get(`vendedor:${eFalha}`)).toBe(MAX + 1);

    // rodar de novo: o que parou de novo não é tentado outra vez, e o ciclo normal também não o pega
    const r2 = await d.reprocessarParados({ tenantId: A, confirmar: true });
    expect(r2.itens.map((i) => i.evento_id)).not.toContain(eFalha);
    expect(r2.ja_tentados).toBeGreaterThanOrEqual(1);
    await d.ciclo();
    expect(chamadas.get(`vendedor:${eFalha}`)).toBe(MAX + 1);
    expect(await evento(eFalha)).toMatchObject({ tentativas: MAX + 1 });
  });

  it('acima do teto: recusa (mesmo com confirmar) e nada muda no banco', async () => {
    const d = novo();
    const marcas = [`teto1-${randomUUID()}`, `teto2-${randomUUID()}`];
    for (const m of marcas) falhando.add(m);
    const ids = [await publicar(A, marcas[0]!), await publicar(A, marcas[1]!)];
    await pararAte(d);
    const antes = await Promise.all(ids.map(evento));
    for (const e of antes) expect(e).toMatchObject({ publicado_em: null, tentativas: MAX });
    const chamadasAntes = ids.map((id) => chamadas.get(`vendedor:${id}`));

    // teto = parados do tenant − 1 (pode haver parados de outras rodadas do teste no mesmo tenant)
    const parados = (await d.reprocessarParados({ tenantId: A, confirmar: false })).selecionados.length;
    expect(parados).toBeGreaterThanOrEqual(2);
    const recusa = d.reprocessarParados({ tenantId: A, confirmar: true, teto: parados - 1 });
    await expect(recusa).rejects.toBeInstanceOf(ErroTetoReprocesso);
    await expect(recusa).rejects.toMatchObject({ selecionados: parados, teto: parados - 1 });
    expect(await Promise.all(ids.map(evento))).toEqual(antes);
    expect(ids.map((id) => chamadas.get(`vendedor:${id}`))).toEqual(chamadasAntes);

    // limpeza: sem a falha, o reprocesso dentro do teto publica os dois
    for (const m of marcas) falhando.delete(m);
    await d.reprocessarParados({ tenantId: A, confirmar: true });
    for (const id of ids) expect(await evento(id)).toMatchObject({ publicado_em: expect.any(Date), tentativas: MAX + 1 });
  });
});
