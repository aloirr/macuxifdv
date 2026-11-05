/**
 * T-0082 (agente testes) — Plano de RV e RV pela API REAL: `createApp` × Postgres como `macuxi_app` (RLS), banco efêmero
 * próprio do arquivo com a fixture dois-tenants, login de verdade (JWT), licenças lidas do banco a cada requisição.
 * PRECISA DE BANCO: pula sem Postgres (local, sem Docker no PC); no CI (`MACUXI_PG_EXIGIR=1`) roda.
 * Regras: RN-CORE-29 (cálculo), RN-CORE-30 (plano e vigência), RN-CORE-04 (escopo), RN-CORE-05 (tenant), RN-CORE-01/03
 * (licença), RN-CORE-21 (fechamento), RN-AUD-01 (auditoria).
 *
 * O que o modulo-core já cobre e NÃO se repete aqui: a regra pura (`modules/core/domain/plano-rv.test.ts`, `incentive.test.ts`),
 * a rota em memória (`modules/core/api/plano-rv.test.ts`) e o `executar` das rotas × Postgres (`modules/core/api/plano-rv.db.test.ts`:
 * RLS do GET, auditoria antes/depois, PUT 2x, mesmo mês de início, plano de mês fechado recusado, exclusão, RV da equipe e
 * realizado igual ao `metas/painel`). Aqui: o caminho HTTP inteiro (token → licença → ação do perfil → contrato → escopo do
 * `app.ts`), a versão nova a partir do mês aberto, a vigência sobre mês fechado, a projeção do gatilho na rota e o id de outro
 * tenant.
 *
 * Relógio: as rotas usam `subirApi({ relogio })`. O login segue o relógio real (JWT). Nos casos R-05..R-08 o relógio fica em
 * 15/06/2030 12h de Manaus: o plano da fixture (início no mês real do CI) já valeu para meses fechados; 2030-05 está fechado
 * (2º dia útil de junho passou) e 2030-06 aberto, com 12 dos 25 dias úteis encerrados (calendário padrão seg-sáb, RN-CORE-26).
 *
 * Matriz: docs/testes/T-0082.md (R-01..R-08). Defeitos fechados: D-T0082a (R-08a, era `it.fails`: realizado pela licença de
 * quem consulta; corrigido com `{ licenca: 'tenant' }`, ADR 0025, R-20261105-110403) e D-T0082b (R-03b: PUT com id de plano
 * de outro tenant responde 404).
 */
import { randomUUID } from 'node:crypto';
import { PlanosRvSchema, PlanoRvSchema, RvPainelSchema, type PlanoRvDto, type PlanoRvPut, type RvPainel } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calcularRvDaPessoa, calendarioDoTenant, diasUteisDoMes, type IndicadorRv, type PlanoRv } from '../../../modules/core/domain';
import { A, B, erroDe, ids, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

type Quem = 'admin' | 'analista' | 'assistente' | 'gerente' | 'supervisor' | 'vendedor' | 'promotor' | 'adminB';
const EMAIL: Record<Quem, [string, typeof A | typeof B]> = {
  admin: ['admin@exemplo.com.br', A],
  analista: ['analista@exemplo.com.br', A],
  assistente: ['assistente@exemplo.com.br', A],
  gerente: ['gerente@exemplo.com.br', A],
  supervisor: ['supervisor@exemplo.com.br', A],
  vendedor: ['vendedor@exemplo.com.br', A],
  promotor: ['promotor@exemplo.com.br', A],
  adminB: ['admin.b@exemplo.com.br', B],
};
/** RN-CORE-30 e manifesto do Core: `plano_rv.ver` e `rv.ver` (supervisor, gerente, analista, admin); `plano_rv.editar` (analista, admin). */
const VEEM: Quem[] = ['supervisor', 'gerente', 'analista', 'admin'];
const NAO_VEEM: Quem[] = ['assistente', 'vendedor', 'promotor'];
const EDITAM: Quem[] = ['analista', 'admin'];
const NAO_EDITAM: Quem[] = ['supervisor', 'gerente', 'assistente', 'vendedor', 'promotor'];

/** 15/06/2030 12h em Manaus (sábado): 2030-06 aberto, 2030-05 fechado. */
// hora-fixa-ok: instante das rotas no relógio controlado (R-06..R-08); dados e metas são de 2030, nunca comparados ao relógio real
const JUNHO_2030 = new Date('2030-06-15T16:00:00Z');
// hora-fixa-ok: o "hoje" no fuso de A do JUNHO_2030, entrada do oráculo (diasUteisDoMes)
const HOJE_2030 = '2030-06-15';

const FAIXAS = [
  { de_pct: 0, modo: 'zero', pagamento_pct: 0 },
  { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
  { de_pct: 100, modo: 'fixo', pagamento_pct: 100 },
] as const;
const corpo = (extra: Partial<PlanoRvPut> = {}): PlanoRvPut => ({
  nome: 'Plano do agente testes',
  vigencia_inicio: '2099-01',
  perfis: ['vendedor'],
  valor_maximo_cents: 180_000,
  regras: [
    { indicador: 'venda_cents', peso_pct: 60, gatilho: false, faixas: [...FAIXAS] },
    { indicador: 'visitas', peso_pct: 40, gatilho: false, faixas: [...FAIXAS] },
  ],
  ...extra,
});
/** Versão de 2030-06 usada no RN-CORE-29: venda é GATILHO (projetável); positivação paga 100% de 0% (sem depender de fonte). */
const corpoJunho = (): PlanoRvPut => ({
  nome: 'Versão de junho/2030',
  vigencia_inicio: '2030-06',
  perfis: ['vendedor'],
  valor_maximo_cents: 200_000,
  regras: [
    { indicador: 'venda_cents', peso_pct: 0, gatilho: true, faixas: [] },
    { indicador: 'positivacao', peso_pct: 100, gatilho: false, faixas: [{ de_pct: 0, modo: 'fixo', pagamento_pct: 100 }] },
  ],
});
const semExtras = (p: PlanoRvDto): PlanoRv => ({ id: p.id, nome: p.nome, vigencia_inicio: p.vigencia_inicio, perfis: p.perfis, valor_maximo_cents: p.valor_maximo_cents, regras: p.regras });

describe.skipIf(semBanco())('T-0082 — Plano de RV e RV pela API real (createApp × Postgres; RN-CORE-29, RN-CORE-30, RN-CORE-04, RN-CORE-05)', () => {
  let api: ApiDeTeste;
  let congelado: Date | null = null;
  const token = {} as Record<Quem, string>;
  /** id do plano vivo da fixture em cada tenant (lido do banco). */
  const planoFixture = { A: '', B: '' };
  const PLANO_JUNHO = randomUUID();

  const get = (q: Quem, url: string) => api.chamar(token[q], { method: 'GET', url });
  const put = (q: Quem, id: string, payload: unknown) => api.chamar(token[q], { method: 'PUT', url: `/v1/core/plano-rv/${id}`, payload: payload as object });
  const del = (q: Quem, id: string) => api.chamar(token[q], { method: 'DELETE', url: `/v1/core/plano-rv/${id}` });
  const planos = async (q: Quem) => {
    const r = await get(q, '/v1/core/plano-rv');
    expect(r.statusCode, `${q} GET plano-rv: ${r.body}`).toBe(200);
    return PlanosRvSchema.parse(r.json());
  };
  const rv = async (q: Quem, query = ''): Promise<RvPainel> => {
    const r = await get(q, `/v1/core/rv${query}`);
    expect(r.statusCode, `${q} GET rv${query}: ${r.body}`).toBe(200);
    return RvPainelSchema.parse(r.json());
  };
  const negado = (r: LightMyRequestResponse, quem: string) => {
    expect(r.statusCode, `${quem}: ${r.body}`).toBe(403);
    expect(erroDe(r).codigo, quem).toBe('PERFIL_SEM_ACESSO');
  };
  const auditorias = async (entidadeId: string) =>
    Number((await api.admin.query<{ n: string }>("select count(*) as n from plataforma.auditoria where acao like 'plano_rv.%' and entidade_id = $1", [entidadeId])).rows[0]!.n);
  const linhaPlano = async (id: string) =>
    (await api.admin.query<{ tenant_id: string; valor_maximo_cents: string; updated_at: Date; deleted_at: Date | null }>('select tenant_id, valor_maximo_cents, updated_at, deleted_at from core.plano_rv where id = $1', [id])).rows[0];

  beforeAll(async () => {
    // hora-fixa-ok: fora dos casos congelados as rotas seguem o relógio real (o JWT é verificado no real, como no T-0080)
    api = await subirApi({ relogio: () => (congelado ? new Date(congelado.getTime()) : new Date()) });
    for (const q of Object.keys(EMAIL) as Quem[]) token[q] = (await api.sessao(EMAIL[q][0], EMAIL[q][1])).access_token;
    for (const [k, t] of [['A', A.tenantId], ['B', B.tenantId]] as const) {
      const r = await api.admin.query<{ id: string }>('select id from core.plano_rv where tenant_id = $1 and deleted_at is null order by vigencia_inicio limit 1', [t]);
      planoFixture[k] = r.rows[0]!.id;
    }
  }, 240_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('R-01 RN-CORE-30: perfis — GET plano-rv e GET rv: supervisor, gerente, analista e admin 200; assistente, vendedor e promotor 403; PUT/DELETE só analista e admin (403 não grava)', async () => {
    for (const q of VEEM) {
      expect((await planos(q)).vigente, q).not.toBeNull();
      await rv(q);
    }
    for (const q of NAO_VEEM) {
      negado(await get(q, '/v1/core/plano-rv'), `${q} GET plano-rv`);
      negado(await get(q, '/v1/core/rv'), `${q} GET rv`);
    }
    const anonimo = await api.chamar(null, { method: 'GET', url: '/v1/core/rv' });
    expect(anonimo.statusCode).toBe(401);

    const criados: string[] = [];
    for (const [i, q] of EDITAM.entries()) {
      const id = randomUUID();
      const r = await put(q, id, corpo({ vigencia_inicio: `2099-0${i + 1}` }));
      expect(r.statusCode, `${q} PUT: ${r.body}`).toBe(200);
      expect(PlanoRvSchema.parse(r.json())).toMatchObject({ id, editavel: true });
      criados.push(id);
    }
    for (const q of NAO_EDITAM) {
      const id = randomUUID();
      negado(await put(q, id, corpo({ vigencia_inicio: '2099-09' })), `${q} PUT`);
      expect(await linhaPlano(id), `${q}: o 403 não gravou`).toBeUndefined();
      negado(await del(q, criados[0]!), `${q} DELETE`);
    }
    expect((await linhaPlano(criados[0]!))?.deleted_at).toBeNull();
    for (const [i, q] of EDITAM.entries()) {
      const r = await del(q, criados[i]!);
      expect(r.statusCode, r.body).toBe(200);
      expect((await linhaPlano(criados[i]!))?.deleted_at).not.toBeNull();
    }
  });

  it('R-02 RN-CORE-04: escopo pelo app real — supervisor só a equipe 1; vendedor fora do escopo 404 USUARIO_NAO_ENCONTRADO; equipe fora do escopo 200 vazia; gerente a regional', async () => {
    const sup = await rv('supervisor');
    const doSup = sup.pessoas.map((p) => p.usuario_id);
    expect(doSup).toContain(A.usuarios.vendedor1);
    expect(doSup).not.toContain(A.usuarios.vendedor2);
    for (const id of doSup) expect([A.usuarios.vendedor1, A.usuarios.promotor], `fora da equipe 1: ${id}`).toContain(id);

    const fora = await get('supervisor', `/v1/core/rv?usuario_id=${A.usuarios.vendedor2}`);
    expect(fora.statusCode, fora.body).toBe(404);
    expect(erroDe(fora).codigo).toBe('USUARIO_NAO_ENCONTRADO');
    expect((await rv('supervisor', `?equipe_id=${A.equipes.equipe2}`)).pessoas).toEqual([]);
    expect((await rv('supervisor', `?usuario_id=${A.usuarios.vendedor1}`)).pessoas.map((p) => p.usuario_id)).toEqual([A.usuarios.vendedor1]);

    const ger = (await rv('gerente')).pessoas.map((p) => p.usuario_id);
    expect(ger).toEqual(expect.arrayContaining([A.usuarios.vendedor1, A.usuarios.vendedor2]));
  });

  it('R-03 RN-CORE-05: A e B não se veem em /v1/core/plano-rv e /v1/core/rv (lista, RV, usuário do outro tenant 404, PUT/DELETE com id do outro tenant não toca o B)', async () => {
    const pa = await planos('admin');
    const pb = await planos('adminB');
    expect(pa.planos.map((p) => p.id)).toContain(planoFixture.A);
    expect(pa.planos.map((p) => p.id)).not.toContain(planoFixture.B);
    expect(pb.planos.map((p) => p.id)).toEqual([planoFixture.B]);

    const idsB = new Set<string>(Object.values(B.usuarios));
    const idsA = new Set<string>(Object.values(A.usuarios));
    const rb = await rv('adminB');
    expect(rb.pessoas.length, 'controle positivo: B tem vendedor no plano').toBeGreaterThan(0);
    expect(rb.pessoas.every((p) => idsB.has(p.usuario_id))).toBe(true);
    expect(rb.plano_id).toBe(planoFixture.B);
    expect((await rv('admin')).pessoas.every((p) => idsA.has(p.usuario_id))).toBe(true);
    for (const [q, alvo] of [['adminB', A.usuarios.vendedor1], ['analista', B.usuarios.vendedor]] as const) {
      const r = await get(q, `/v1/core/rv?usuario_id=${alvo}`);
      expect(r.statusCode, `${q} → ${alvo}: ${r.body}`).toBe(404);
    }
    expect((await rv('adminB', `?equipe_id=${A.equipes.equipe1}`)).pessoas).toEqual([]);

    // escrita com o id do plano de B, a partir de A: nunca 2xx e B intacto
    const antesB = await linhaPlano(planoFixture.B);
    const tentativaPut = await put('admin', planoFixture.B, corpo({ vigencia_inicio: '2099-05', valor_maximo_cents: 1 }));
    expect(tentativaPut.statusCode, tentativaPut.body).toBeGreaterThanOrEqual(400);
    await del('admin', planoFixture.B);
    expect(await linhaPlano(planoFixture.B)).toEqual(antesB);
    expect((await planos('adminB')).planos.map((p) => p.id)).toEqual([planoFixture.B]);
    expect((await planos('admin')).planos.map((p) => p.id)).not.toContain(planoFixture.B);
  });

  // D-T0082b (corrigido pelo modulo-core, R-20261105-100148): a rota tratava o id invisível (RLS) como plano novo e o INSERT
  // colidia na chave primária global de `core.plano_rv.id` (23505 → 500 ERRO_INTERNO). Agora o INSERT usa
  // `on conflict (id) do nothing` e, sem linha gravada, responde 404 PLANO_RV_NAO_ENCONTRADO (`modules/core/api/plano-rv.ts`).
  it('R-03b D-T0082b: PUT com o id do plano de B, a partir de A, responde 404 PLANO_RV_NAO_ENCONTRADO, sem gravar nem auditar em A e sem tocar o B', async () => {
    const antesB = await linhaPlano(planoFixture.B);
    const auditoriasAntes = await auditorias(planoFixture.B);
    const r = await put('admin', planoFixture.B, corpo({ vigencia_inicio: '2099-06' }));
    expect(r.statusCode, r.body).toBe(404);
    expect(erroDe(r).codigo).toBe('PLANO_RV_NAO_ENCONTRADO');
    expect(await linhaPlano(planoFixture.B)).toEqual(antesB);
    expect((await planos('admin')).planos.map((p) => p.id)).not.toContain(planoFixture.B);
    expect(await auditorias(planoFixture.B), 'o 404 não audita').toBe(auditoriasAntes);
  });

  it('R-04 RN-CORE-01/03: plano e RV são do Core (sempre ativo) — não há MODULO_INATIVO: o core não desliga (422) e desligar Vendedor e Promotor no tenant não derruba as rotas', async () => {
    for (const r of [
      await licenca(api, token.admin, 'tenant', 'core', false),
      await licenca(api, token.admin, 'perfil', 'core', false, 'analista'),
      await licenca(api, token.admin, 'usuario', 'core', false, A.usuarios.supervisor),
    ]) {
      expect(r.statusCode, r.body).toBe(422);
    }
    try {
      for (const m of ['vendedor', 'promotor']) expect((await licenca(api, token.admin, 'tenant', m, false)).statusCode).toBe(200);
      expect(ids(await api.meusModulos(token.supervisor))).not.toContain('vendedor');
      expect((await planos('supervisor')).vigente?.id).toBe(planoFixture.A);
      expect((await rv('supervisor')).pessoas.map((p) => p.usuario_id)).toContain(A.usuarios.vendedor1);
    } finally {
      for (const m of ['vendedor', 'promotor']) await licenca(api, token.admin, 'tenant', m, true);
    }
  });

  it('R-05 RN-AUD-01 / RN-CORE-30: PUT repetido (também com faixas em outra ordem) não grava nem audita de novo; mudança real audita uma vez', async () => {
    const id = randomUUID();
    const base = corpo({ vigencia_inicio: '2098-03' });
    const r1 = await put('analista', id, base);
    expect(r1.statusCode, r1.body).toBe(200);
    const gravado1 = await linhaPlano(id);
    const embaralhado: PlanoRvPut = { ...base, regras: base.regras.map((r) => ({ faixas: [...r.faixas].reverse(), gatilho: r.gatilho, peso_pct: r.peso_pct, indicador: r.indicador })) };
    for (const c of [base, embaralhado]) {
      const r = await put('analista', id, c);
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(await auditorias(id)).toBe(1);
    expect((await linhaPlano(id))?.updated_at).toEqual(gravado1?.updated_at);

    const r2 = await put('admin', id, { ...base, valor_maximo_cents: 190_000 });
    expect(r2.statusCode, r2.body).toBe(200);
    expect(PlanoRvSchema.parse(r2.json())).toMatchObject({ valor_maximo_cents: 190_000, atualizado_por_nome: 'Admin Alfa' });
    expect(await auditorias(id)).toBe(2);
    expect((await del('analista', id)).statusCode).toBe(200);
  });

  describe('com o relógio em 15/06/2030 (2030-05 fechado, 2030-06 aberto)', () => {
    beforeAll(() => {
      congelado = JUNHO_2030;
    });
    afterAll(() => {
      congelado = null;
    });

    it('R-06 RN-CORE-30: plano que já valeu para mês fechado não muda nem sai (422 RN-CORE-30, nada gravado); vigência em mês fechado recusada; a mudança vira versão nova a partir do mês aberto', async () => {
      const antes = await planos('analista');
      const fixture = antes.planos.find((p) => p.id === planoFixture.A)!;
      expect(fixture.editavel).toBe(false);
      const linhaAntes = await linhaPlano(planoFixture.A);
      const audAntes = await auditorias(planoFixture.A);

      const { id: _i, updated_at: _u, atualizado_por_nome: _n, editavel: _e, ...resto } = fixture;
      const mudar = await put('analista', planoFixture.A, { ...resto, valor_maximo_cents: resto.valor_maximo_cents + 100 });
      expect(mudar.statusCode, mudar.body).toBe(422);
      expect(erroDe(mudar).codigo).toBe('RN-CORE-30');
      const apagar = await del('admin', planoFixture.A);
      expect(apagar.statusCode, apagar.body).toBe(422);
      expect(erroDe(apagar).codigo).toBe('RN-CORE-30');
      // o mesmo corpo do plano fechado (sem mudança) é aceito e não audita: idempotência vale também para o imutável
      const igual = await put('analista', planoFixture.A, resto);
      expect(igual.statusCode, igual.body).toBe(200);
      expect(await linhaPlano(planoFixture.A)).toEqual(linhaAntes);
      expect(await auditorias(planoFixture.A)).toBe(audAntes);

      // versão nova começando num mês FECHADO reescreveria o que já valeu: recusada
      const idMaio = randomUUID();
      const maio = await put('analista', idMaio, { ...corpoJunho(), vigencia_inicio: '2030-05' });
      expect(maio.statusCode, maio.body).toBe(422);
      expect(erroDe(maio).codigo).toBe('RN-CORE-30');
      expect(await linhaPlano(idMaio)).toBeUndefined();

      // versão nova a partir do mês aberto: aceita, vira a vigente; a antiga segue igual e imutável no histórico
      const junho = await put('analista', PLANO_JUNHO, corpoJunho());
      expect(junho.statusCode, junho.body).toBe(200);
      expect(PlanoRvSchema.parse(junho.json())).toMatchObject({ id: PLANO_JUNHO, vigencia_inicio: '2030-06', editavel: true });
      const depois = await planos('supervisor');
      expect(depois.vigente?.id).toBe(PLANO_JUNHO);
      expect(depois.planos[0]?.id, 'mais recente primeiro').toBe(PLANO_JUNHO);
      const velha = depois.planos.find((p) => p.id === planoFixture.A)!;
      expect(velha).toMatchObject({ editavel: false, valor_maximo_cents: fixture.valor_maximo_cents, regras: fixture.regras });
      expect(await auditorias(PLANO_JUNHO)).toBe(1);
    });

    it('R-07 RN-CORE-29: a rota reflete o domain — mês aberto: gatilho de venda pela PROJEÇÃO (60% realizado → 125% projetado libera; 40% → 83% zera); mês fechado: pelo realizado, com o plano que valia', async () => {
      // Pré-condição: o R-06 criou o PLANO_JUNHO (o R-07 depende dele; com `--sequence.shuffle` ou `.only` falharia por outro motivo).
      expect((await planos('analista')).planos.map((p) => p.id), 'pré-condição: R-06 criou a versão de junho').toContain(PLANO_JUNHO);
      // Vendedor desligado no tenant: o realizado vem do read-model `core.indicador_diario` para qualquer perfil (sem depender
      // da consulta do Vendedor, ver D-T0082a), e o caso fica igual antes e depois da correção do defeito.
      expect((await licenca(api, token.admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        await api.admin.query(
          `insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor, tipo) values
             ($1, $2, '2030-06', 'venda_cents', 100000, 'pedido'), ($1, $2, '2030-06', 'positivacao', 10, 'pedido'),
             ($1, $3, '2030-06', 'venda_cents', 100000, 'pedido'), ($1, $3, '2030-06', 'positivacao', 10, 'pedido'),
             ($1, $2, '2030-05', 'venda_cents', 100000, 'pedido')`,
          [A.tenantId, A.usuarios.vendedor1, A.usuarios.vendedor2],
        );
        await api.admin.query(
          `insert into core.indicador_diario (id, tenant_id, usuario_id, data, pedidos, vendido_cents, cancelado_cents) values
             ($4, $1, $2, '2030-06-03', 2, 60000, 0), ($5, $1, $3, '2030-06-04', 1, 40000, 0), ($6, $1, $2, '2030-05-10', 3, 90000, 0)`,
          [A.tenantId, A.usuarios.vendedor1, A.usuarios.vendedor2, randomUUID(), randomUUID(), randomUUID()],
        );
        const parametros = (await api.admin.query<{ modulo: string; chave: string; valor: unknown }>("select modulo, chave, valor from plataforma.parametro where tenant_id = $1 and modulo = 'core' and deleted_at is null", [A.tenantId])).rows;
        const cal = calendarioDoTenant(parametros).dias_uteis_semana;
        const lista = await planos('analista');
        const plano = (id: string) => semExtras(lista.planos.find((p) => p.id === id)!);

        /** Oráculo: o domain com a meta e o realizado que a própria rota devolveu (confere a ligação rota → domain). */
        const conferir = (painel: RvPainel, usuario: string, p: PlanoRv) => {
          const pessoa = painel.pessoas.find((x) => x.usuario_id === usuario)!;
          expect(pessoa, `pessoa ${usuario} em ${painel.periodo}`).toBeDefined();
          const metas: Partial<Record<IndicadorRv, number>> = {};
          const realizados: Partial<Record<IndicadorRv, number>> = {};
          for (const l of pessoa.indicadores) {
            if (l.meta !== null) metas[l.indicador] = l.meta;
            realizados[l.indicador] = l.realizado;
          }
          const esperado = calcularRvDaPessoa(p, metas, realizados, diasUteisDoMes(painel.periodo, HOJE_2030, cal), painel.situacao);
          expect(pessoa.rv_cents).toBe(esperado.rv_cents);
          expect(pessoa.rv_bruta_cents).toBe(esperado.rv_bruta_cents);
          expect(pessoa.bloqueada_por).toEqual(esperado.bloqueada_por);
          expect(pessoa.indicadores.map((l) => [l.indicador, l.gatilho_ok, l.pagamento_pct, l.valor_cents])).toEqual(
            esperado.indicadores.map((l) => [l.indicador, l.gatilho_ok, l.pagamento_pct, l.valor_cents]),
          );
          return pessoa;
        };

        const junho = await rv('analista', '?periodo=2030-06');
        expect(junho).toMatchObject({ periodo: '2030-06', situacao: 'parcial', plano_id: PLANO_JUNHO });
        const v1 = conferir(junho, A.usuarios.vendedor1, plano(PLANO_JUNHO));
        const vendaV1 = v1.indicadores.find((l) => l.indicador === 'venda_cents')!;
        expect(vendaV1).toMatchObject({ meta: 100_000, realizado: 60_000, gatilho: true, gatilho_ok: true });
        expect(vendaV1.projetado_pbp).toBeGreaterThanOrEqual(10_000);
        expect(v1.bloqueada_por).toEqual([]);
        expect(v1.rv_cents).toBe(200_000);
        // contraprova: pelo realizado (mês fechado) o mesmo vendedor estaria bloqueado — a rota usou a projeção
        expect(calcularRvDaPessoa(plano(PLANO_JUNHO), { venda_cents: 100_000, positivacao: 10 }, { venda_cents: 60_000, positivacao: 0 }, diasUteisDoMes('2030-06', HOJE_2030, cal), 'fechado').bloqueada_por).toEqual(['venda_cents']);

        const v2 = conferir(junho, A.usuarios.vendedor2, plano(PLANO_JUNHO));
        expect(v2.indicadores.find((l) => l.indicador === 'venda_cents')).toMatchObject({ realizado: 40_000, gatilho_ok: false });
        expect(v2).toMatchObject({ rv_cents: 0, bloqueada_por: ['venda_cents'] });
        expect(v2.rv_bruta_cents).toBe(200_000);

        const maio = await rv('analista', '?periodo=2030-05');
        expect(maio).toMatchObject({ periodo: '2030-05', situacao: 'fechado', plano_id: planoFixture.A });
        const m1 = conferir(maio, A.usuarios.vendedor1, plano(planoFixture.A));
        expect(m1.indicadores.find((l) => l.indicador === 'venda_cents')).toMatchObject({ meta: 100_000, realizado: 90_000, atingimento_pbp: 9_000 });
        expect(m1.rv_cents).toBeGreaterThan(0);
      } finally {
        await licenca(api, token.admin, 'tenant', 'vendedor', true);
      }
      // pré-condição do R-08a: Vendedor de volta no tenant; analista com ele, admin sem
      expect(ids(await api.meusModulos(token.analista))).toContain('vendedor');
      expect(ids(await api.meusModulos(token.admin))).not.toContain('vendedor');
    });

    // D-T0082a (fechado): `GET /v1/core/rv` lê o realizado por `calcularIndicadores(..., fontePorConsulta(tx))`, que chama
    // `tx.consultar(vendedor.pedidos_da_meta@1, q, { licenca: 'tenant' })` (ADR 0025, RN-CORE-27): o Vendedor vale se estiver
    // ativo NO TENANT, não nos módulos de quem consulta. O analista (perfil com Vendedor) e o admin (perfil só com core na
    // fixture) leem a mesma fonte (os pedidos; antes o admin caía no read-model `core.indicador_diario`, 60.000 em 2030-06,
    // e o analista via 0), e a consulta devolve os mesmos `usuario_ids` a perfis que não são vendedor/promotor: a RV da MESMA
    // pessoa no MESMO mês não muda com quem olha (RN-CORE-21/29).
    it('R-08a D-T0082a: admin e analista veem o mesmo realizado e a mesma RV do vendedor-1 em 2030-06 (Vendedor ativo no tenant)', async () => {
      const [doAdmin, doAnalista] = [await rv('admin', '?periodo=2030-06'), await rv('analista', '?periodo=2030-06')];
      const v1 = (p: RvPainel) => p.pessoas.find((x) => x.usuario_id === A.usuarios.vendedor1)!;
      const venda = (p: RvPainel) => v1(p).indicadores.find((l) => l.indicador === 'venda_cents')?.realizado;
      expect(venda(doAnalista)).toBeTypeOf('number');
      expect(venda(doAdmin)).toBe(venda(doAnalista));
      expect(v1(doAdmin).rv_cents).toBe(v1(doAnalista).rv_cents);
    });

    it('R-08 RN-CORE-30: B não enxerga a versão nova de A nem A a de B, mesmo com o relógio no futuro', async () => {
      expect((await planos('adminB')).planos.map((p) => p.id)).toEqual([planoFixture.B]);
      expect((await rv('adminB', '?periodo=2030-06')).plano_id).toBe(planoFixture.B);
      expect((await planos('admin')).planos.map((p) => p.id)).not.toContain(planoFixture.B);
    });
  });
});
