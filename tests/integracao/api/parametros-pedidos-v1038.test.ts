/**
 * v1.0.38 — Parâmetros › Pedidos pela API REAL: `GET|PUT /v1/vendedor/parametros/pedidos` com `titulo_vencido_dias`
 * (RN-VEN-13, 0..365, padrão 5) e `validade_orcamento_dias` (RN-VEN-18, 1..90, padrão 7; a chave antiga
 * `orcamento.validade_dias` segue valendo na leitura). Ação `alcada.gerenciar` (admin, analista, gerente), licença do Vendedor
 * (RN-CORE-01), tenant (RN-CORE-05), idempotência e auditoria (RN-AUD-01, só o que mudou).
 * `createApp` + os 8 módulos + Postgres efêmero (dois-tenants).
 *
 * Valor × regra (R-20261108-135639): o ORÁCULO é escrito aqui pelo texto da regra, sem chamar a função testada:
 *   RN-VEN-13: atraso do título > N dias = aprovação por `inadimplencia`, mesmo à vista; igual a N passa.
 *     Fixture: o A.c1 tem o título NF-1001 1/2 vencido há 10 dias (tests/integracao/api/aprovacao-motivo-t0184.test.ts).
 *   RN-VEN-18: o preço congelado vale até o fim do dia D+N (N dias corridos depois do dia do salvamento), no fuso do tenant
 *     (salvo em 09/11 com 7 dias → vale até 16/11): `orcamento_validade` = dia civil do salvamento em America/Manaus + N.
 * Convenção: `it` = critério da tarefa (vermelho = defeito em recado ao dono).
 */
import { PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { linhasDosParametrosIniciais, ParametrosIniciaisSchema, type ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const URL = '/v1/vendedor/parametros/pedidos';
const CHAVES = ['titulo_vencido_dias', 'validade_orcamento_dias', 'orcamento.validade_dias'] as const;
/** v1.0.39: a resposta ganhou as três chaves novas; sem linha gravada valem os padrões (parametros-pedidos-v1039.test.ts). */
const V1039 = { pedido_minimo_cents: 0, credito_excedido_acao: 'aprovacao', estoque_insuficiente_acao: 'orcamento' } as const;
/** Fuso do tenant A na fixture (db/seeds/fixtures/dois-tenants.ts). */
const FUSO_A = 'America/Manaus';
const id = (n: number) => `0f103800-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DOC = { noLimite: id(1), acima: id(2), orc20: id(3), orcEmpresa: id(4), orcAntiga: id(5), orcPadrao: id(6) } as const;
const PA = PAGAMENTO_FIXTURE.A;

/** Oráculo RN-VEN-18: dia civil de `instante` no fuso + `dias` (AAAA-MM-DD). */
function diaCivilMais(instante: string, fuso: string, dias: number): string {
  const [a, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante)).split('-').map(Number);
  return new Date(Date.UTC(a!, m! - 1, d! + dias)).toISOString().slice(0, 10);
}

/** Instante de 2 dias atrás às 03:30Z = 23:30 do dia anterior em Manaus (o dia em UTC e no fuso divergem). */
function instanteNaVirada(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  d.setUTCHours(3, 30, 0, 0);
  return d.toISOString();
}

describe.skipIf(semBanco())('v1.0.38 Parâmetros › Pedidos pela API (RN-VEN-13, RN-VEN-18, RN-CORE-01, RN-CORE-05)', () => {
  let api: ApiDeTeste;
  const tk = { admin: '', analista: '', gerente: '', vendedor: '', promotor: '', adminB: '' };
  let prodA = '';

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const chamar = async (t: string, method: 'GET' | 'PUT', payload?: object) => {
    const r = await api.chamar(t, { method, url: URL, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, corpo: r.json() as Record<string, unknown>, r };
  };
  const auditorias = async (tenant: string) =>
    Number((await q<{ n: string }>("select count(*) as n from plataforma.auditoria where tenant_id = $1 and acao = 'alcada.gerenciar' and entidade = 'parametro'", [tenant]))[0]!.n);
  const noBanco = async (tenant: string) =>
    Object.fromEntries((await q<{ chave: string; valor: unknown }>("select chave, valor from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = any($2::text[]) and deleted_at is null", [tenant, [...CHAVES]])).map((l) => [l.chave, l.valor]));
  const limparParametros = async () => {
    for (const t of [A.tenantId, B.tenantId]) await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = any($2::text[])", [t, [...CHAVES]]);
  };
  const limparDocs = async () => {
    const ids = Object.values(DOC);
    await q('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await q('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await q('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await q('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await q('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
    await q('delete from plataforma.evento where agregado_id = any($1::uuid[])', [ids]).catch(() => undefined);
  };
  const push = async (itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(tk.vendedor, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  /** Pedido do A.c1 à vista (PIX): só a inadimplência pode mandá-lo para aprovação (RN-VEN-13, mesmo à vista). */
  const pedidoAVista = (pid: string) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, created_offline_at: new Date().toISOString(), customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prodA, quantity: 1 }], forma_pagamento_id: PA.formas.pix, prazo_pagamento_id: PA.prazos.pixAvista },
  });
  const orcamento = (pid: string, criado: string) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, tipo: 'orcamento', customer_id: A.clientes.c1, discount_pct: 0, payment_terms: '28 dias', created_offline_at: criado, items: [{ product_id: prodA, quantity: 1 }] },
  });
  const aceito = (r: ResultadoItemPush | undefined, pid: string) => expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'aceito' });
  const doc = async (pid: string) =>
    (await q<{ status: string; tipo: string; motivos_aprovacao: string[] | null; orcamento_validade: string | null }>('select status, tipo, motivos_aprovacao, orcamento_validade::text as orcamento_validade from vendedor.pedido where id = $1', [pid]))[0];

  beforeAll(async () => {
    api = await subirApi();
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    await limparParametros();
    await limparDocs();
    // Na fixture o admin de A não tem o Vendedor (nem o Catálogo, de que ele depende) no perfil, e o admin de B tem o Vendedor
    // removido no usuário. Os dois provam o bloqueio pela licença (RN-CORE-01) e depois são ligados; o afterAll devolve.
    for (const t of [tk.admin, tk.adminB]) {
      const semLicenca = await chamar(t, 'GET');
      expect([semLicenca.status, erroDe(semLicenca.r).codigo], 'admin sem o Vendedor').toEqual([403, 'MODULO_INATIVO']);
    }
    for (const m of ['catalogo', 'vendedor']) expect((await licenca(api, tk.admin, 'perfil', m, true, 'admin')).statusCode, m).toBe(200);
    expect((await licenca(api, tk.adminB, 'usuario', 'vendedor', true, B.usuarios.admin)).statusCode).toBe(200);
  }, 180_000);
  afterAll(async () => {
    if (!api) return;
    for (const m of ['vendedor', 'catalogo']) await licenca(api, tk.admin, 'perfil', m, false, 'admin').catch(() => undefined);
    await licenca(api, tk.adminB, 'usuario', 'vendedor', false, B.usuarios.admin).catch(() => undefined);
    await limparParametros().catch(() => undefined);
    await limparDocs().catch(() => undefined);
    await api.fechar();
  });

  describe('Leitura, gravação, faixa e auditoria', () => {
    it('sem linha gravada o GET devolve os padrões 5 e 7 (RN-VEN-13, RN-VEN-18)', async () => {
      for (const t of [tk.admin, tk.analista, tk.gerente]) expect((await chamar(t, 'GET')).corpo).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...V1039 });
    });

    it('admin, analista e gerente gravam; o banco guarda o número na chave que o domain lê', async () => {
      const r1 = await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 12, validade_orcamento_dias: 30 });
      expect([r1.status, r1.corpo], JSON.stringify(r1.corpo)).toEqual([200, { titulo_vencido_dias: 12, validade_orcamento_dias: 30, ...V1039 }]);
      expect((await chamar(tk.analista, 'PUT', { titulo_vencido_dias: 13 })).status).toBe(200);
      expect((await chamar(tk.gerente, 'PUT', { validade_orcamento_dias: 31 })).status).toBe(200);
      expect(await noBanco(A.tenantId)).toEqual({ titulo_vencido_dias: 13, validade_orcamento_dias: 31 });
      expect((await chamar(tk.gerente, 'GET')).corpo).toEqual({ titulo_vencido_dias: 13, validade_orcamento_dias: 31, ...V1039 });
    });

    it('PUT parcial mantém a outra chave; reenviar o mesmo valor responde 200 e não audita de novo; mudar audita uma vez com antes e depois', async () => {
      const antes = await auditorias(A.tenantId);
      const r = await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 13 });
      expect([r.status, r.corpo]).toEqual([200, { titulo_vencido_dias: 13, validade_orcamento_dias: 31, ...V1039 }]);
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 13, validade_orcamento_dias: 31 })).status).toBe(200);
      expect(await auditorias(A.tenantId), 'mesmo valor não audita').toBe(antes);
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 14, validade_orcamento_dias: 31 })).status).toBe(200);
      expect(await auditorias(A.tenantId), 'só o que mudou').toBe(antes + 1);
      const [ult] = await q<{ antes: unknown; depois: unknown }>("select antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'alcada.gerenciar' and entidade = 'parametro' order by created_at desc limit 1", [A.tenantId]);
      expect(ult).toEqual({ antes: { titulo_vencido_dias: 13 }, depois: { titulo_vencido_dias: 14 } });
      expect(await noBanco(A.tenantId)).toEqual({ titulo_vencido_dias: 14, validade_orcamento_dias: 31 });
    });

    it('limites aceitos (0, 365, 1, 90); fora da faixa, fração, texto e corpo vazio = 422 com a RN e nada muda; campo estranho = 400', async () => {
      for (const corpo of [{ titulo_vencido_dias: 0 }, { titulo_vencido_dias: 365 }, { validade_orcamento_dias: 1 }, { validade_orcamento_dias: 90 }]) {
        const r = await chamar(tk.admin, 'PUT', corpo);
        expect(r.status, JSON.stringify(corpo)).toBe(200);
      }
      const estado = await noBanco(A.tenantId);
      expect(estado).toEqual({ titulo_vencido_dias: 365, validade_orcamento_dias: 90 });
      for (const [corpo, codigo] of [
        [{ titulo_vencido_dias: -1 }, 'RN-VEN-13'],
        [{ titulo_vencido_dias: 366 }, 'RN-VEN-13'],
        [{ titulo_vencido_dias: 2.5 }, 'RN-VEN-13'],
        [{ titulo_vencido_dias: '5' }, 'RN-VEN-13'],
        [{ validade_orcamento_dias: 0 }, 'RN-VEN-18'],
        [{ validade_orcamento_dias: 91 }, 'RN-VEN-18'],
        [{ titulo_vencido_dias: 10, validade_orcamento_dias: 91 }, 'RN-VEN-18'],
        [{}, 'RN-VEN-13'],
      ] as const) {
        const r = await chamar(tk.admin, 'PUT', corpo);
        expect([r.status, erroDe(r.r).codigo], JSON.stringify(corpo)).toEqual([422, codigo]);
      }
      expect(await noBanco(A.tenantId), 'o 422 não grava nem a chave válida do mesmo corpo').toEqual(estado);
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 5, outra: 1 })).status).toBe(400);
    });
  });

  describe('Permissões e licença (RN-CORE-01, RN-PRO-01)', () => {
    it('vendedor e promotor = 403 em GET e PUT, e nada é gravado', async () => {
      const estado = await noBanco(A.tenantId);
      for (const [quem, t] of [['vendedor', tk.vendedor], ['promotor', tk.promotor]] as const) {
        expect((await chamar(t, 'GET')).status, `${quem} GET`).toBe(403);
        expect((await chamar(t, 'PUT', { titulo_vencido_dias: 1 })).status, `${quem} PUT`).toBe(403);
      }
      expect(await noBanco(A.tenantId)).toEqual(estado);
    });

    it('Vendedor desligado no tenant: GET e PUT = 403 MODULO_INATIVO; religado, 200', async () => {
      expect((await licenca(api, tk.admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        for (const r of [await chamar(tk.admin, 'GET'), await chamar(tk.gerente, 'PUT', { titulo_vencido_dias: 3 })]) expect([r.status, erroDe(r.r).codigo]).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        expect((await licenca(api, tk.admin, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect((await chamar(tk.gerente, 'GET')).status).toBe(200);
      expect((await noBanco(A.tenantId)).titulo_vencido_dias).toBe(365);
    });
  });

  describe('Multi-tenant (RN-CORE-05)', () => {
    it('tenant B lê os próprios padrões, não vê o de A; o PUT de B grava só em B', async () => {
      expect((await chamar(tk.adminB, 'GET')).corpo).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...V1039 });
      const deA = await noBanco(A.tenantId);
      expect((await chamar(tk.adminB, 'PUT', { titulo_vencido_dias: 1, validade_orcamento_dias: 2 })).status).toBe(200);
      expect(await noBanco(B.tenantId)).toEqual({ titulo_vencido_dias: 1, validade_orcamento_dias: 2 });
      expect(await noBanco(A.tenantId)).toEqual(deA);
      expect((await chamar(tk.admin, 'GET')).corpo).toEqual({ ...deA, ...V1039 });
    });
  });

  describe('Valor × regra: o valor gravado é o que o servidor usa', () => {
    it('RN-VEN-13: atraso 10 com N = 10 gravado pela rota passa (aprovado); com N = 9, o pedido à vista vai para aprovação por inadimplência', async () => {
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 10 })).status).toBe(200);
      aceito((await push([pedidoAVista(DOC.noLimite)]))[0], DOC.noLimite);
      const p1 = (await doc(DOC.noLimite))!;
      expect(p1.motivos_aprovacao ?? [], 'atraso 10 = N 10: não é "há mais de N dias"').not.toContain('inadimplencia');
      expect(p1.status).toBe('approved');
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 9 })).status).toBe(200);
      aceito((await push([pedidoAVista(DOC.acima)]))[0], DOC.acima);
      const p2 = (await doc(DOC.acima))!;
      expect(p2.status).toBe('pending_approval');
      expect(p2.motivos_aprovacao).toContain('inadimplencia');
    });

    it('RN-VEN-18: orçamento salvo com N = 20 gravado pela rota congela o preço até o dia do salvamento + 20, no fuso do tenant (23:30 de Manaus, já outro dia em UTC)', async () => {
      expect((await chamar(tk.gerente, 'PUT', { validade_orcamento_dias: 20 })).status).toBe(200);
      const criado = instanteNaVirada();
      aceito((await push([orcamento(DOC.orc20, criado)]))[0], DOC.orc20);
      const o = (await doc(DOC.orc20))!;
      expect(o.tipo).toBe('orcamento');
      expect(o.orcamento_validade, `criado ${criado}`).toBe(diaCivilMais(criado, FUSO_A, 20));
      expect(o.orcamento_validade).not.toBe(diaCivilMais(criado, 'UTC', 20));
    });

    it('RN-VEN-18: o valor gravado pelo passo Empresa (linhasDosParametrosIniciais, `validade_orcamento_dias`) chega ao GET e ao orçamento', async () => {
      await limparParametros();
      const linha = linhasDosParametrosIniciais(ParametrosIniciaisSchema.parse({ validade_orcamento_dias: 12 })).find((l) => l.chave === 'validade_orcamento_dias')!;
      await q('insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, $2, $3, $4::jsonb)', [A.tenantId, linha.modulo, linha.chave, JSON.stringify(linha.valor)]);
      expect((await chamar(tk.admin, 'GET')).corpo).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 12, ...V1039 });
      const criado = new Date().toISOString();
      aceito((await push([orcamento(DOC.orcEmpresa, criado)]))[0], DOC.orcEmpresa);
      expect((await doc(DOC.orcEmpresa))!.orcamento_validade).toBe(diaCivilMais(criado, FUSO_A, 12));
    });

    it('RN-VEN-18: só a chave antiga `orcamento.validade_dias` = 15 ainda vale (GET e orçamento); a nova gravada pela rota tem precedência', async () => {
      await limparParametros();
      await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'orcamento.validade_dias', '15'::jsonb)", [A.tenantId]);
      expect((await chamar(tk.admin, 'GET')).corpo).toEqual({ titulo_vencido_dias: 5, validade_orcamento_dias: 15, ...V1039 });
      const criado = new Date().toISOString();
      aceito((await push([orcamento(DOC.orcAntiga, criado)]))[0], DOC.orcAntiga);
      expect((await doc(DOC.orcAntiga))!.orcamento_validade).toBe(diaCivilMais(criado, FUSO_A, 15));
      // PUT só do título mantém a validade lida da chave antiga
      expect((await chamar(tk.admin, 'PUT', { titulo_vencido_dias: 30 })).corpo).toEqual({ titulo_vencido_dias: 30, validade_orcamento_dias: 15, ...V1039 });
      expect((await chamar(tk.admin, 'PUT', { validade_orcamento_dias: 3 })).corpo).toEqual({ titulo_vencido_dias: 30, validade_orcamento_dias: 3, ...V1039 });
      expect((await chamar(tk.admin, 'GET')).corpo).toEqual({ titulo_vencido_dias: 30, validade_orcamento_dias: 3, ...V1039 });
    });

    it('RN-VEN-18: sem nenhuma chave, o orçamento usa o padrão 7', async () => {
      await limparParametros();
      const criado = new Date().toISOString();
      aceito((await push([orcamento(DOC.orcPadrao, criado)]))[0], DOC.orcPadrao);
      expect((await doc(DOC.orcPadrao))!.orcamento_validade).toBe(diaCivilMais(criado, FUSO_A, 7));
    });
  });
});
