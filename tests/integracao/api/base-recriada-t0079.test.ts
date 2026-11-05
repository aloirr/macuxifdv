/**
 * T-0079 (ADR 0021) — base do tenant recriada, ponta a ponta com a API REAL e o Postgres (matriz D-7..D-10 de
 * docs/testes/T-0079.md; pedido R-20261104-232253 do engenheiro-software). A parte sem banco (motor, etapas e repositório
 * do Vendedor, app antigo) está em tests/modulos/base-recriada-t0079.test.ts.
 *
 * Aparelho = `aparelhoCampo` (motor de sync REAL do platform-sdk, entidades do Core e do Vendedor, transporte por
 * `inject` no createApp real, papel macuxi_app com RLS). O "--recriar" é feito como o seed: apaga o pedido que só o
 * aparelho ainda lembra, volta o contador de números do tenant (o próximo pedido ganha o MESMO número, o caso do
 * "pedido fantasma 000011") e roda `plataforma.girar_geracao_base(tenant)` (0022).
 * Só roda com Postgres (CI, MACUXI_PG_EXIGIR=1); sem banco pula com aviso (sem Docker no PC, R-20261105-053835).
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import { NovidadesRespostaSchema, type EtapaSync, type LinhaSync } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, subirApi, type ApiDeTeste } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, type AparelhoCampo } from '../apoio/campo';

const CHAVE_GERACAO = 'sync:geracao_base';

interface LinhaPedido extends LinhaSync {
  numero?: string | null;
  cliente_id: string;
}

/** Etapa espiã: conta as trocas de geração que o motor avisou (o `aoTrocarGeracao` das etapas reais). */
function etapaEspia(): { etapa: EtapaSync; trocas: { n: number } } {
  const trocas = { n: 0 };
  return {
    trocas,
    etapa: {
      id: 'espia-t0079',
      rotulo: 'Espiã da T-0079',
      modulo: 'vendedor',
      executar: async () => undefined,
      aoTrocarGeracao: async () => {
        trocas.n += 1;
      },
    },
  };
}

describe.skipIf(semBanco())('T-0079 — base recriada × API real e Postgres (ADR 0021)', () => {
  let api: ApiDeTeste;
  let prod1 = '';

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const geracaoNoBanco = async (tenant: string) => (await q<{ g: string }>('select geracao_base::text as g from plataforma.tenant where id = $1', [tenant]))[0]!.g;
  const pedidoPush = (pid: string) => ({
    id: pid,
    entidade: 'pedido',
    payload: { id: pid, customer_id: A.clientes.c1, discount_pct: 0, payment_terms: '28 dias', created_offline_at: new Date().toISOString(), items: [{ product_id: prod1, quantity: 1 }] },
    rotulo: 'Pedido',
  });
  /** O que o `seed demo --recriar` faz com o pedido: some da base e o número volta para a fila do contador. */
  const recriarSemOPedido = async (pid: string) => {
    await q('delete from vendedor.pedido_evento where pedido_id = $1', [pid]);
    await q('delete from vendedor.pedido_item where pedido_id = $1', [pid]);
    await q('delete from integracao.pedido_fila_erp where pedido_uuid = $1', [pid]).catch(() => undefined);
    await q('delete from vendedor.pedido where id = $1', [pid]);
    await q('update vendedor.numeracao_pedido set ultimo = ultimo - 1 where tenant_id = $1', [A.tenantId]);
    const girados = await q<{ n: number }>('select plataforma.girar_geracao_base($1) as n', [A.tenantId]);
    expect(girados[0]!.n).toBe(1);
  };
  const pedidosLocais = (ap: AparelhoCampo) => ap.motor.linhas<LinhaPedido>('pedido');
  const sincronizarOk = async (ap: AparelhoCampo) => {
    await ap.sincronizar();
    expect(ap.motor.estado().erro ?? null, 'erro do motor').toBeNull();
  };

  beforeAll(async () => {
    api = await subirApi();
    prod1 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    await esperarHorizonte();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('D-8 geração igual: pull e novidades trazem a geração do banco; a 2ª sincronização é incremental e não troca nada', async () => {
    const g = await geracaoNoBanco(A.tenantId);
    const tk = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    for (const entidade of ['cliente', 'pedido', 'motivo']) {
      const r = await api.chamar(tk, { method: 'GET', url: `/v1/sync/pull?entidade=${entidade}` });
      expect(r.statusCode, r.body).toBe(200);
      expect((r.json() as { geracao_base?: string }).geracao_base, entidade).toBe(g);
    }
    const nov = await api.chamar(tk, { method: 'GET', url: '/v1/sync/novidades' });
    expect(nov.statusCode, nov.body).toBe(200);
    expect((nov.json() as { geracao_base?: string }).geracao_base).toBe(g);

    const { etapa, trocas } = etapaEspia();
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { etapas: [etapa] });
    await sincronizarOk(ap);
    expect(await ap.armazenamento.ler<string>(CHAVE_GERACAO)).toBe(g);
    const antes = (await pedidosLocais(ap)).map((p) => p.id).sort();
    await sincronizarOk(ap);
    expect(trocas.n, 'a primeira geração é adotada; a igual não troca').toBe(0);
    expect((await pedidosLocais(ap)).map((p) => p.id).sort()).toEqual(antes);
    expect(await geracaoNoBanco(A.tenantId)).toBe(g);
  });

  it('D-7 base recriada: o pedido que só o aparelho lembra some, a fila feita sem sinal chega ao servidor e nenhum número se repete', async () => {
    const { etapa, trocas } = etapaEspia();
    const ap = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { etapas: [etapa] });
    await sincronizarOk(ap);
    const gAntes = await geracaoNoBanco(A.tenantId);

    // P: pedido feito e sincronizado; fica no aparelho com número do servidor
    const P = randomUUID();
    await ap.motor.enfileirar(pedidoPush(P));
    await sincronizarOk(ap);
    await esperarHorizonte();
    await sincronizarOk(ap);
    const pLocal = (await pedidosLocais(ap)).find((p) => p.id === P);
    expect(pLocal?.numero, 'P voltou pelo pull com número').toMatch(/^\d{6}$/);
    const numeroP = pLocal!.numero!;

    // sem sinal: Q entra na fila; enquanto isso a base é recriada sem P (o contador volta: Q terá o número de P)
    ap.online.valor = false;
    const Q = randomUUID();
    await ap.motor.enfileirar(pedidoPush(Q));
    await recriarSemOPedido(P);
    const gDepois = await geracaoNoBanco(A.tenantId);
    expect(gDepois).not.toBe(gAntes);

    // volta o sinal
    ap.online.valor = true;
    await sincronizarOk(ap);
    await esperarHorizonte();
    await sincronizarOk(ap);

    expect(trocas.n, 'aoTrocarGeracao uma vez por troca').toBe(1);
    expect(await ap.armazenamento.ler<string>(CHAVE_GERACAO)).toBe(gDepois);
    const servidorQ = await q<{ numero: string | null }>('select numero from vendedor.pedido where id = $1', [Q]);
    expect(servidorQ, 'Q chegou ao servidor').toHaveLength(1);
    expect(servidorQ[0]!.numero, 'Q ganhou o número que era de P (o caso do fantasma)').toBe(numeroP);
    expect(ap.motor.pendentes('pedido'), 'fila vazia').toEqual([]);

    const locais = await pedidosLocais(ap);
    expect(locais.map((p) => p.id), 'P (fantasma) sumiu do aparelho').not.toContain(P);
    expect(locais.map((p) => p.id)).toContain(Q);
    const numeros = locais.map((p) => p.numero).filter((n): n is string => !!n);
    expect(numeros.length, 'números na lista local').toBeGreaterThan(0);
    expect(numeros.filter((n, i) => numeros.indexOf(n) !== i), 'número repetido na lista local').toEqual([]);
    // a cópia local bate com o que o vendedor vê no servidor (nada a mais)
    const doServidor = await q<{ id: string }>('select id::text as id from vendedor.pedido where tenant_id = $1 and deleted_at is null', [A.tenantId]);
    const ids = new Set(doServidor.map((x) => x.id));
    expect(locais.filter((p) => !ids.has(p.id)).map((p) => p.id), 'pedido local que não existe no servidor').toEqual([]);
  });

  it('D-9 dois tenants: girar a geração de A não muda a que o aparelho do B recebe, nem dispara a troca no B', async () => {
    const { etapa, trocas } = etapaEspia();
    const apB = await aparelhoCampo(api, 'vendedor@exemplo.com.br', { tenant: B, etapas: [etapa] });
    await sincronizarOk(apB);
    const gB = await geracaoNoBanco(B.tenantId);
    expect(await apB.armazenamento.ler<string>(CHAVE_GERACAO)).toBe(gB);
    const pedidosB = (await pedidosLocais(apB)).map((p) => p.id).sort();

    await q('select plataforma.girar_geracao_base($1)', [A.tenantId]);
    await sincronizarOk(apB);
    expect(trocas.n).toBe(0);
    expect(await geracaoNoBanco(B.tenantId)).toBe(gB);
    expect(await apB.armazenamento.ler<string>(CHAVE_GERACAO)).toBe(gB);
    expect((await pedidosLocais(apB)).map((p) => p.id).sort()).toEqual(pedidosB);

    const tkB = apB.token.valor;
    const r = await api.chamar(tkB, { method: 'GET', url: '/v1/sync/pull?entidade=pedido' });
    expect((r.json() as { geracao_base?: string }).geracao_base).toBe(gB);
    expect(r.body).not.toContain(await geracaoNoBanco(A.tenantId));
  });

  it('D-10 app antigo: login e /v1/me/modulos sem geracao_base; pull e novidades com o campo seguem aceitos pelos contratos', async () => {
    const login = await api.entrar('vendedor@exemplo.com.br');
    expect(login.statusCode, login.body).toBe(200);
    expect(login.body).not.toContain('geracao_base');
    const tk = (login.json() as { access_token: string }).access_token;
    const mods = await api.chamar(tk, { method: 'GET', url: '/v1/me/modulos' });
    expect(mods.statusCode).toBe(200);
    expect(mods.body).not.toContain('geracao_base');

    const pull = await api.chamar(tk, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' });
    const pagina = pull.json() as Record<string, unknown>;
    expect(pagina.geracao_base).toBeTruthy();
    // leitor antigo (PaginaSync sem o campo): itens e cursor de sempre; o campo é aditivo e o resto do envelope não mudou
    expect(Array.isArray(pagina.itens)).toBe(true);
    expect(pagina.proximo_cursor === null || typeof pagina.proximo_cursor === 'string').toBe(true);
    expect(Object.keys(pagina).filter((k) => !['itens', 'proximo_cursor', 'versao_escopo', 'horizonte', 'geracao_base'].includes(k)), 'campo fora do envelope PaginaSync').toEqual([]);

    const nov = await api.chamar(tk, { method: 'GET', url: '/v1/sync/novidades' });
    const corpo = nov.json() as Record<string, unknown>;
    expect(corpo.geracao_base).toBeTruthy();
    expect(NovidadesRespostaSchema.safeParse(corpo).success).toBe(true);
    const { geracao_base: _n, ...novSemCampo } = corpo;
    expect(NovidadesRespostaSchema.safeParse(novSemCampo).success).toBe(true);
  });
});
