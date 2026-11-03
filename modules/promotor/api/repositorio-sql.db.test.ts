/**
 * `criarRepositorioSql()` × Postgres real (schema `promotor`, migração 0015; papel macuxi_app, RLS; fixture dois-tenants).
 * Pula sem Postgres/Docker (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 * Cobre: RLS (B não lê nem grava nada de A), idempotência pelo recebimento (igual = repetida, diferente = conflito), checkout
 * que troca o payload só com a visita aberta, FK composta (coleta em visita de outro promotor = recusa) e os limites do dia
 * local em `visitasDoPeriodo`. Datas sempre derivadas do relógio da fixture (nunca dia fixo).
 */
import { criarRelogio, type RelogioDeTeste } from '@macuxi/comum/relogio';
import { agoraDaFixture, comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroHttpModulo, type ItemPush } from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VisitaLojaGuardada } from '../domain';
import { criarCtx, fabrica } from './apoio-teste';
import { criarModuloApiPromotor, criarRepositorioSql } from './index';
import type { ColetaGuardada, SessaoTenant } from './repositorio';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const repo = criarRepositorioSql();

describe.skipIf(semBanco())('Promotor: repositório SQL × Postgres (RLS, idempotência, checkout, FK, fuso)', () => {
  let pool: pg.Pool;
  let relogio: RelogioDeTeste;
  let f: ReturnType<typeof fabrica>;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    relogio = criarRelogio({ agora: agoraDaFixture(), fuso: A.fuso });
    f = fabrica(relogio);
  });
  afterAll(async () => {
    await pool?.end();
  });

  /** Uma transação do tenant (como `ctx.comTenant`): sessão do repositório = o `ClienteBanco` da transação + o tenant. */
  const sessao = <T>(tenant: string, fn: (s: SessaoTenant) => Promise<T>): Promise<T> => comTenant(pool, tenant, (c) => fn({ db: c, tenant_id: tenant }));
  const emA = <T>(fn: (s: SessaoTenant) => Promise<T>) => sessao(A.tenantId, fn);
  const emB = <T>(fn: (s: SessaoTenant) => Promise<T>) => sessao(B.tenantId, fn);

  const PROMOTOR = A.usuarios.promotor;
  const guardada = (id: string, loja: string, extra: Partial<VisitaLojaGuardada> = {}, promotor = PROMOTOR): VisitaLojaGuardada => ({ ...f.visita(id, { cliente_id: loja }), promotor_id: promotor, ...extra });
  const coletaDe = (entidade: ColetaGuardada['entidade'], payload: { id: string; visita_loja_id: string } & Record<string, unknown>, loja: string, promotor = PROMOTOR): ColetaGuardada => ({
    entidade, id: payload.id, visita_loja_id: payload.visita_loja_id, promotor_id: promotor, cliente_id: loja, payload, recebido_em: relogio.agora().toISOString(),
  });
  const codigoPg = async (p: Promise<unknown>): Promise<string | undefined> => p.then(() => undefined, (e: { code?: string }) => e.code);

  it('visita: grava, lê com FOR UPDATE no formato do domain ({...payload, promotor_id}) e o gatilho deriva as colunas', async () => {
    const loja = randomUUID();
    const v = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, v));
    expect(await emA((s) => repo.visita(s, v.id))).toEqual(v);
    const linha = await emA((s) => s.db.query<{ cliente_id: string; checkin_em: Date; checkout_em: Date | null; promotor_id: string; payload: Record<string, unknown> }>('select cliente_id, checkin_em, checkout_em, promotor_id, payload from promotor.visita_loja where id = $1', [v.id]));
    expect(linha.rows[0]).toMatchObject({ cliente_id: loja, promotor_id: PROMOTOR, checkout_em: null });
    expect(linha.rows[0]!.checkin_em.toISOString()).toBe(new Date(v.checkin_em).toISOString());
    expect(linha.rows[0]!.payload).not.toHaveProperty('promotor_id');
    expect(await emA((s) => repo.visita(s, randomUUID()))).toBeNull();
  });

  it('RN-CORE-05: tenant B não lê nada de A e não grava em nome de A (RLS falha fechada)', async () => {
    const loja = randomUUID();
    const v = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, v));
    const foto = f.foto(v.id);
    await emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', foto, loja)));
    // leitura: B não vê a visita, a coleta nem a categoria de A
    expect(await emB((s) => repo.visita(s, v.id))).toBeNull();
    expect(await emB((s) => repo.coleta(s, 'foto_coleta', foto.id))).toBeNull();
    expect(await emB((s) => repo.coletasDasVisitas(s, 'foto_coleta', [v.id]))).toEqual([]);
    const dia = relogio.dia();
    expect((await emB((s) => repo.visitasDoPeriodo(s, { de: dia, ate: dia, fuso: B.fuso }))).map((x) => x.id)).not.toContain(v.id);
    const catA = (await emA((s) => s.db.query<{ id: string }>('select id from promotor.categoria_gondola limit 1'))).rows[0]!.id;
    expect((await emB((s) => repo.nomesDasCategorias(s, [catA]))).size).toBe(0);
    // sessão incoerente (transação de B, tenant_id de A): leitura vazia e escrita recusada pelo WITH CHECK (42501)
    const incoerente = (fn: (s: SessaoTenant) => Promise<unknown>) => comTenant(pool, B.tenantId, (c) => fn({ db: c, tenant_id: A.tenantId }));
    expect(await incoerente((s) => repo.visita(s, v.id))).toBeNull();
    expect(await codigoPg(incoerente((s) => repo.gravarVisita(s, guardada(randomUUID(), loja))))).toBe('42501');
    expect(await codigoPg(incoerente((s) => repo.gravarColeta(s, coletaDe('foto_coleta', f.foto(v.id), loja))))).toBe('42501');
    // B grava a própria visita normalmente e A não a vê
    const vb = guardada(randomUUID(), B.clientes.c1, {}, B.usuarios.vendedor);
    await emB((s) => repo.gravarVisita(s, vb));
    expect(await emA((s) => repo.visita(s, vb.id))).toBeNull();
  });

  it('checkout troca o payload só com a visita aberta; fechada não muda mais e não vira outra visita', async () => {
    const loja = randomUUID();
    const aberta = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, aberta));
    const fechada: VisitaLojaGuardada = { ...aberta, checkout_em: relogio.relativo({ minutos: 30 }).toISOString(), permanencia_min: 30, desfecho: 'realizada' };
    await emA((s) => repo.gravarVisita(s, fechada));
    expect(await emA((s) => repo.visita(s, aberta.id))).toEqual(fechada);
    const d = await emA((s) => s.db.query<{ checkout_em: Date; desfecho: string; permanencia_min: string }>('select checkout_em, desfecho, permanencia_min from promotor.visita_loja where id = $1', [aberta.id]));
    expect([d.rows[0]!.checkout_em.toISOString(), d.rows[0]!.desfecho, Number(d.rows[0]!.permanencia_min)]).toEqual([fechada.checkout_em, 'realizada', 30]);
    // fechada: gravar outra coisa não altera (e o repositório avisa em vez de fingir que gravou)
    const tentativa = emA((s) => repo.gravarVisita(s, { ...fechada, observacao: 'mudou depois' }));
    await expect(tentativa).rejects.toBeInstanceOf(ErroHttpModulo);
    await expect(tentativa).rejects.toMatchObject({ codigo: 'VISITA_LOJA_FECHADA' });
    expect(await emA((s) => repo.visita(s, aberta.id))).toEqual(fechada);
    // aberta de outro promotor: o mesmo id não é tomado (o on conflict exige o mesmo promotor)
    const alheia = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, alheia));
    await expect(emA((s) => repo.gravarVisita(s, { ...alheia, promotor_id: A.usuarios.vendedor1, observacao: 'roubada' }))).rejects.toMatchObject({ codigo: 'VISITA_LOJA_FECHADA' });
    expect((await emA((s) => repo.visita(s, alheia.id)))!.promotor_id).toBe(PROMOTOR);
  });

  it('coleta: grava e lê (recebido_em em ISO UTC com Z); por visita, ordenada, sem vazar de outra visita', async () => {
    const loja = randomUUID();
    const v1 = guardada(randomUUID(), loja);
    const v2 = guardada(randomUUID(), loja);
    await emA(async (s) => {
      await repo.gravarVisita(s, v1);
      await repo.gravarVisita(s, v2);
    });
    const f1 = f.foto(v1.id);
    const f2 = f.foto(v1.id, 6);
    const f3 = f.foto(v2.id);
    for (const x of [f1, f2, f3]) await emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', x, loja)));
    const lida = await emA((s) => repo.coleta(s, 'foto_coleta', f1.id));
    expect(lida).toEqual({ entidade: 'foto_coleta', id: f1.id, visita_loja_id: v1.id, promotor_id: PROMOTOR, cliente_id: loja, payload: f1, recebido_em: relogio.agora().toISOString() });
    expect(lida!.recebido_em).toMatch(/Z$/);
    expect((await emA((s) => repo.coletasDasVisitas(s, 'foto_coleta', [v1.id]))).map((c) => c.id).sort()).toEqual([f1.id, f2.id].sort());
    expect((await emA((s) => repo.coletasDasVisitas(s, 'foto_coleta', [v1.id, v2.id]))).map((c) => c.id).sort()).toEqual([f1.id, f2.id, f3.id].sort());
    expect(await emA((s) => repo.coletasDasVisitas(s, 'foto_coleta', []))).toEqual([]);
    expect(await emA((s) => repo.coletasDasVisitas(s, 'ruptura_item', [v1.id]))).toEqual([]);
    // as outras tabelas pelo mapa fixo
    const ruptura = f.ruptura(v1.id, 'ruptura_gondola');
    await emA((s) => repo.gravarColeta(s, coletaDe('ruptura_item', ruptura, loja)));
    expect((await emA((s) => repo.coletasDasVisitas(s, 'ruptura_item', [v1.id]))).map((c) => c.payload)).toEqual([ruptura]);
    await expect(emA((s) => repo.coleta(s, 'pedido' as never, ruptura.id))).rejects.toThrow(/desconhecida/);
  });

  it('RN-PRO-02 / RN-CORE-04: FK composta — coleta em visita de outro promotor, outra loja ou outro tenant é recusada (23503)', async () => {
    const loja = randomUUID();
    const v = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, v));
    const foto = f.foto(v.id);
    expect(await codigoPg(emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', foto, loja, A.usuarios.vendedor1))))).toBe('23503'); // outro promotor
    expect(await codigoPg(emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', f.foto(v.id), randomUUID()))))).toBe('23503'); // outra loja
    expect(await codigoPg(emB((s) => repo.gravarColeta(s, coletaDe('foto_coleta', f.foto(v.id), loja))))).toBe('23503'); // visita de A vista por B
    expect(await emA((s) => repo.coleta(s, 'foto_coleta', foto.id))).toBeNull();
  });

  it('corrida: INSERT duplicado da mesma coleta vira erro retentável (503 COLETA_EM_CORRIDA), nunca sobrescreve', async () => {
    const loja = randomUUID();
    const v = guardada(randomUUID(), loja);
    await emA((s) => repo.gravarVisita(s, v));
    const foto = f.foto(v.id);
    await emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', foto, loja)));
    const duplicada = emA((s) => repo.gravarColeta(s, coletaDe('foto_coleta', { ...foto, tipo: 'gondola_depois' }, loja)));
    await expect(duplicada).rejects.toMatchObject({ status: 503, codigo: 'COLETA_EM_CORRIDA' });
    expect((await emA((s) => repo.coleta(s, 'foto_coleta', foto.id)))!.payload).toEqual(foto);
  });

  describe('pelo recebimento (push do sync) sobre o SQL', () => {
    const api = criarModuloApiPromotor({ repositorio: repo });
    const prov = (nome: string) => api.sync!.find((p) => p.entidade.nome === nome)!;

    /** Contexto do promotor de A com a transação REAL do tenant (a publicação de eventos é do apoio de teste). */
    function ctxPromotor(loja: string) {
      const base = criarCtx(relogio, { tenant: A.tenantId, usuario: PROMOTOR, carteira: new Set([loja]) });
      const ctx = { ...base.ctx, comTenant: async <T,>(fn: (db: pg.PoolClient, tx: never) => Promise<T>) => comTenant(pool, A.tenantId, async (c) => fn(c, (await base.ctx.comTenant((_db, tx) => Promise.resolve(tx))) as never)) };
      return { ctx: ctx as unknown as typeof base.ctx, eventos: base.eventos };
    }
    async function enviar(c: ReturnType<typeof ctxPromotor>, entidade: string, payload: { id: string } & Record<string, unknown>) {
      const p = prov(entidade);
      const item: ItemPush = { entidade, id: payload.id, operacao: 'upsert', payload: p.entidade.schema.parse(payload) };
      return (await p.receber!(c.ctx, [item]))[0]!;
    }

    it('RN-PRO-02: check-in, foto, ruptura e checkout gravam; reenvio igual = aceito sem duplicar; diferente = conflito', async () => {
      const loja = randomUUID();
      const c = ctxPromotor(loja);
      const v = f.visita(randomUUID(), { cliente_id: loja });
      expect(await enviar(c, 'visita_loja', v)).toEqual({ id: v.id, status: 'aceito' });
      const foto = f.foto(v.id);
      expect(await enviar(c, 'foto_coleta', foto)).toEqual({ id: foto.id, status: 'aceito' });
      expect(await enviar(c, 'foto_coleta', foto)).toEqual({ id: foto.id, status: 'aceito' }); // repetida
      expect(await enviar(c, 'foto_coleta', { ...foto, sem_gps: true, latitude: null, longitude: null })).toMatchObject({ status: 'conflito' });
      const ruptura = f.ruptura(v.id, 'ruptura_total');
      expect(await enviar(c, 'ruptura_item', ruptura)).toMatchObject({ status: 'aceito' });
      expect(c.eventos.map((e) => e.nome)).toEqual(['promotor.ruptura.registrada@1']);
      const fechada = f.fechar(v, 40);
      expect(await enviar(c, 'visita_loja', fechada)).toEqual({ id: v.id, status: 'aceito' });
      expect(await enviar(c, 'visita_loja', fechada)).toEqual({ id: v.id, status: 'aceito' }); // repetida
      expect(await enviar(c, 'visita_loja', f.fechar(v, 41))).toMatchObject({ status: 'conflito' });
      expect(c.eventos.map((e) => e.nome)).toEqual(['promotor.ruptura.registrada@1', 'promotor.visita_loja.concluida@1']);
      const gravada = await emA((s) => repo.visita(s, v.id));
      expect(gravada).toMatchObject({ checkout_em: fechada.checkout_em, desfecho: 'realizada', promotor_id: PROMOTOR });
      // coleta depois do checkout (fora da janela) é recusada pelo domain e nada é gravado
      const tarde = f.foto(v.id, 120);
      expect(await enviar(c, 'foto_coleta', tarde)).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-02' });
      expect(await emA((s) => repo.coleta(s, 'foto_coleta', tarde.id))).toBeNull();
    });

    it('RN-CORE-04: o id de visita de outro promotor não é tomado nem coletado por quem não é o dono', async () => {
      const loja = randomUUID();
      const dono = ctxPromotor(loja);
      const v = f.visita(randomUUID(), { cliente_id: loja });
      await enviar(dono, 'visita_loja', v);
      const outro = criarCtx(relogio, { tenant: A.tenantId, usuario: A.usuarios.vendedor2, perfil: 'promotor', carteira: new Set([loja]) });
      const ctxOutro = { ctx: { ...outro.ctx, comTenant: async <T,>(fn: (db: pg.PoolClient, tx: never) => Promise<T>) => comTenant(pool, A.tenantId, async (c) => fn(c, (await outro.ctx.comTenant((_d, tx) => Promise.resolve(tx))) as never)) } as unknown as typeof outro.ctx, eventos: outro.eventos };
      expect(await enviar(ctxOutro, 'visita_loja', v)).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
      expect(await enviar(ctxOutro, 'foto_coleta', f.foto(v.id))).toMatchObject({ status: 'rejeitado' });
      expect((await emA((s) => repo.coletasDasVisitas(s, 'foto_coleta', [v.id]))).length).toBe(0);
    });
  });

  describe('visitasDoPeriodo: limites do dia LOCAL no fuso do tenant', () => {
    const DIAS_ATRAS = -200; // longe das visitas da fixture e dos outros testes; sempre relativo ao relógio
    const ids = (vs: VisitaLojaGuardada[]) => vs.map((v) => v.id);

    async function visitasNosLimites(fuso: string, tenant: string, promotor: string) {
      const r = criarRelogio({ agora: agoraDaFixture(), fuso });
      const loja = randomUUID();
      const dia = r.dia(DIAS_ATRAS);
      const nasceu = (hora: string, dias: number) => {
        const id = randomUUID();
        return { id, v: guardada(id, loja, { checkin_em: r.instante({ dias, hora }).toISOString() }, promotor) };
      };
      const antes = nasceu('23:59', DIAS_ATRAS - 1); // 23:59 do dia anterior: fora
      const abre = nasceu('00:00', DIAS_ATRAS); // 00:00 do dia: dentro
      const fecha = nasceu('23:59', DIAS_ATRAS); // 23:59 do dia: dentro
      const depois = nasceu('00:00', DIAS_ATRAS + 1); // 00:00 do dia seguinte: fora
      await sessao(tenant, async (s) => {
        for (const x of [antes, abre, fecha, depois]) await repo.gravarVisita(s, x.v);
      });
      return { dia, loja, antes: antes.id, abre: abre.id, fecha: fecha.id, depois: depois.id };
    }

    it('RN-CORE-11: Manaus (UTC−4) — 23:59 local entra, 00:00 do dia seguinte fica de fora, ordenado por check-in', async () => {
      const x = await visitasNosLimites(A.fuso, A.tenantId, PROMOTOR);
      const r = await emA((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: A.fuso }));
      expect(ids(r)).toEqual([x.abre, x.fecha]); // exatamente as duas; o dia anterior e o seguinte ficam fora
      const tres = await emA((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: A.fuso, cliente_id: x.loja }));
      expect(ids(tres)).toEqual([x.abre, x.fecha]);
      expect(await emA((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: A.fuso, cliente_id: randomUUID() }))).toEqual([]);
      // período de vários dias (inclusivo nos dois extremos): do dia anterior ao seguinte pega as quatro
      const dias = criarRelogio({ agora: agoraDaFixture(), fuso: A.fuso });
      const larga = await emA((s) => repo.visitasDoPeriodo(s, { de: dias.dia(DIAS_ATRAS - 1), ate: dias.dia(DIAS_ATRAS + 1), fuso: A.fuso, cliente_id: x.loja }));
      expect(ids(larga)).toEqual([x.antes, x.abre, x.fecha, x.depois]);
    });

    it('RN-CORE-11: o mesmo corte vale para o fuso do outro tenant (São Paulo, UTC−3) e visita de A não aparece em B', async () => {
      const x = await visitasNosLimites(B.fuso, B.tenantId, B.usuarios.vendedor);
      const r = await emB((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: B.fuso, cliente_id: x.loja }));
      expect(ids(r)).toEqual([x.abre, x.fecha]);
      expect(await emA((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: B.fuso, cliente_id: x.loja }))).toEqual([]);
    });

    it('o fuso do filtro decide o corte: 00:00 de Manaus (04:00Z) cai no dia anterior se o tenant fosse UTC', async () => {
      const x = await visitasNosLimites(A.fuso, A.tenantId, PROMOTOR);
      const emUtc = await emA((s) => repo.visitasDoPeriodo(s, { de: x.dia, ate: x.dia, fuso: 'UTC', cliente_id: x.loja }));
      expect(ids(emUtc)).not.toEqual([x.abre, x.fecha]);
    });
  });
});
