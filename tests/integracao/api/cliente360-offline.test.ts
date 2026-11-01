/**
 * Validação da T-0017 (agente `testes`, Sprint 1) — critério 2 "modo avião" e desenho T-0016 §3.5 item 2, de ponta a
 * ponta: o MOTOR DE SYNC real do platform-sdk (o do app, com o armazenamento chave→JSON do AsyncStorage simulado em
 * memória, com a extensão `linhas` e com o adaptador SQLite do platform-sdk sobre node:sqlite em memória) registra
 * as entidades que o app Campo/Gestão declara
 * (modules/core/app/lib/entidades-cliente.ts), sincroniza com o `createApp` REAL (Postgres como macuxi_app) e, já
 * SEM REDE (transporte que falha e conta chamadas), monta a ficha com a mesma função da tela
 * (modules/core/app/lib/cliente360-local.ts). A ficha local tem de bater com o Cliente 360 online da API.
 * Cenários S1-020..S1-023 de tests/plano/sprint-1.md.
 */
import { Cliente360Schema, type Cliente360, type ClienteContatoSync, type ClienteFinanceiroSync, type ClienteSync, type HistoricoCompraSync, type TituloSync } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import {
  comLinhasEmChaveJson,
  criarArmazenamentoSqlite,
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  type ArmazenamentoSync,
  type ItemPush,
  type LinhaSync,
  type MotorSync,
  type PaginaSync,
  type ResultadoItemPush,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listarClientesLocais, montarCliente360Local, type LinhasCliente } from '../../../modules/core/app/lib/cliente360-local';
import { entidadesCliente } from '../../../modules/core/app/lib/entidades-cliente';
import { A, subirApi, type ApiDeTeste } from '../apoio/api';

const C = A.clientes;
const U = A.usuarios;
const hojeEm = (fuso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Horizonte seguro do pull (updated_at < now() − 2 s, ADR 0006). */
const HORIZONTE = 2_500;

const ARMAZENAMENTOS: ReadonlyArray<readonly [string, () => ArmazenamentoSync]> = [
  ['chave→JSON (AsyncStorage do app)', () => criarArmazenamentoEmMemoria()],
  ['linhas sobre chave→JSON', () => comLinhasEmChaveJson(criarArmazenamentoEmMemoria())],
  ['SQLite em memória (node:sqlite, adaptador do platform-sdk)', () => criarArmazenamentoSqlite(criarDriverNode(':memory:'))],
];

interface Aparelho {
  motor: MotorSync;
  online: { valor: boolean };
  chamadas: { valor: number };
  ficha(clienteId: string): Promise<ReturnType<typeof montarCliente360Local> | null>;
}

describe.skipIf(semBanco())('T-0017 critério 2 — modo avião: ficha do cliente com financeiro e histórico já sincronizados (motor real × API real)', () => {
  let api: ApiDeTeste;
  const hoje = hojeEm(A.fuso);

  async function aparelho(email: string, fabrica: () => ArmazenamentoSync): Promise<Aparelho> {
    const s = await api.sessao(email);
    const online = { valor: true };
    const chamadas = { valor: 0 };
    const semRede = () => {
      throw new Error('Sem sinal (modo avião)');
    };
    const transporte: TransporteSync = {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        chamadas.valor += 1;
        if (!online.valor) semRede();
        const r = await api.chamar(s.access_token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
        return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
      },
      async pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>> {
        chamadas.valor += 1;
        if (!online.valor) semRede();
        const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
        const r = await api.chamar(s.access_token, { method: 'GET', url: `/v1/sync/pull?${q}` });
        if (r.statusCode !== 200) throw new Error(`pull ${entidade}: ${r.statusCode} ${r.body}`);
        return r.json() as PaginaSync<LinhaSync>;
      },
    };
    const registro = criarRegistroSync([manifestoCore]);
    for (const e of entidadesCliente) registro.registrar(e);
    const motor = criarMotorSync({ registro, armazenamento: fabrica(), transporte, online: () => online.valor });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core']);
    const ficha = async (clienteId: string) => {
      const [cliente] = await motor.linhasPorIds<ClienteSync & LinhaSync>('cliente', [clienteId]);
      if (!cliente) return null;
      const doCliente = async <L extends LinhaSync & { cliente_id: string }>(entidade: string) =>
        (await motor.linhas<L>(entidade)).filter((l) => l.cliente_id === clienteId && !l.deleted_at);
      const linhas: LinhasCliente = {
        cliente,
        contatos: await doCliente<ClienteContatoSync & LinhaSync>('cliente_contato'),
        financeiro: (await doCliente<ClienteFinanceiroSync & LinhaSync>('cliente_financeiro'))[0] ?? null,
        titulos: await doCliente<TituloSync & LinhaSync>('titulo'),
        historico: await doCliente<HistoricoCompraSync & LinhaSync>('historico_compra'),
      };
      return montarCliente360Local(linhas, hoje);
    };
    return { motor, online, chamadas, ficha };
  }

  const fichaOnline = async (email: string, id: string): Promise<Cliente360> => {
    const s = await api.sessao(email);
    const r = await api.chamar(s.access_token, { method: 'GET', url: `/v1/core/clientes/${id}` });
    expect(r.statusCode, r.body).toBe(200);
    return Cliente360Schema.parse(r.json());
  };

  beforeAll(async () => {
    api = await subirApi();
    await esperar(HORIZONTE);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  describe.each(ARMAZENAMENTOS)('armazenamento %s', (_nome, fabrica) => {
    it('S1-020: depois de um sync, sem rede, a ficha de c1 abre com contatos, financeiro, títulos e histórico iguais aos do Cliente 360 online', async () => {
      const online = await fichaOnline('vendedor@exemplo.com.br', C.c1);
      const ap = await aparelho('vendedor@exemplo.com.br', fabrica);
      expect(await ap.motor.sincronizar()).toBe(true);
      expect(ap.motor.estado().erro).toBeNull();

      // modo avião: o sync falha sem perder nada e a ficha sai SÓ das linhas locais (nenhuma chamada de rede)
      ap.online.valor = false;
      expect(await ap.motor.sincronizar()).toBe(false);
      const antes = ap.chamadas.valor;
      const f = await ap.ficha(C.c1);
      expect(ap.chamadas.valor).toBe(antes);
      expect(f).not.toBeNull();

      expect(f!.cliente.id).toBe(C.c1);
      expect(f!.contatos.map((c) => c.id)).toEqual(online.contatos.map((c) => c.id));
      expect(f!.financeiro).toEqual(online.financeiro);
      expect(f!.titulos.map((t) => t.id)).toEqual(online.titulos.map((t) => t.id));
      expect([...f!.historico.map((h) => h.id)].sort()).toEqual([...online.historico.map((h) => h.id)].sort());
      // mesmas contas da API (as funções puras do domain): resumo de compras e financeiro
      expect(f!.resumo_compras).toEqual(online.resumo_compras);
      expect(f!.resumo_financeiro).toEqual(online.resumo_financeiro);
      expect(f!.resumo_financeiro).toMatchObject({ limite_cents: 5_000_000, saldo_aberto_cents: 1_000_000, credito_disponivel_cents: 4_000_000, vencidos_qtd: 1 });
      expect(f!.historico).toHaveLength(12);
      expect(f!.resumo_compras.total_12m_cents).toBeGreaterThan(0);
      // ligar e WhatsApp em 1 toque (contato principal, DDI 55, só dígitos)
      expect(f!.ligar).toBe('tel:+559232220001');
      expect(f!.whatsapp).toMatch(/^https:\/\/wa\.me\/5592999990001/);
    });

    it('S1-021: sem rede, a lista de Clientes do aparelho mostra só a carteira (c1, c3) com os filtros "vencidos" e "bloqueados"; c2 nem existe no aparelho', async () => {
      const ap = await aparelho('vendedor@exemplo.com.br', fabrica);
      expect(await ap.motor.sincronizar()).toBe(true);
      ap.online.valor = false;
      const base = {
        clientes: await ap.motor.linhas<ClienteSync & LinhaSync>('cliente'),
        financeiros: await ap.motor.linhas<ClienteFinanceiroSync & LinhaSync>('cliente_financeiro'),
        titulos: await ap.motor.linhas<TituloSync & LinhaSync>('titulo'),
        historico: await ap.motor.linhas<HistoricoCompraSync & LinhaSync>('historico_compra'),
      };
      expect(listarClientesLocais(base, hoje).map((c) => c.id).sort()).toEqual([C.c1, C.c3].sort());
      // c3 vence HOJE no fuso do tenant: não conta como vencido; c1 tem um vencido
      expect(listarClientesLocais(base, hoje, { comVencidos: true }).map((c) => c.id)).toEqual([C.c1]);
      expect(listarClientesLocais(base, hoje, { bloqueado: true })).toEqual([]);
      expect(await ap.ficha(C.c2)).toBeNull();
      // c3: sem histórico (borda), crédito do ERP
      const f3 = await ap.ficha(C.c3);
      expect(f3!.historico).toEqual([]);
      expect(f3!.resumo_compras.dias_sem_compra).toBeNull();
      expect(f3!.resumo_financeiro).toMatchObject({ credito_disponivel_cents: 700_000, vencidos_qtd: 0, a_vencer_qtd: 1 });
    });
  });

  it('S1-022 (ADR 0009 §4): cliente entra na carteira → o próximo sync traz ficha completa offline; sai → some do aparelho', async () => {
    const analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    const ap = await aparelho('vendedor2@exemplo.com.br', () => criarArmazenamentoEmMemoria());
    expect(await ap.motor.sincronizar()).toBe(true);
    expect((await ap.motor.linhas('cliente')).map((l) => l.id)).toEqual([C.c2]);
    expect(await ap.ficha(C.c3)).toBeNull();

    const put = await api.chamar(analista, { method: 'PUT', url: '/v1/core/carteira', payload: { cliente_id: C.c3, usuario_id: U.vendedor2, papel: 'vendedor' } });
    expect(put.statusCode, put.body).toBe(200);
    const vinculo = (put.json() as { id: string }).id;
    try {
      await esperar(HORIZONTE);
      expect(await ap.motor.sincronizar()).toBe(true);
      ap.online.valor = false;
      const f3 = await ap.ficha(C.c3);
      expect(f3, 'c3 entrou na carteira e chegou ao aparelho').not.toBeNull();
      expect(f3!.contatos.map((c) => c.nome)).toEqual(['Pedro Dono']);
      expect(f3!.financeiro).toMatchObject({ limite_cents: 1_000_000 });
      expect(f3!.titulos.map((t) => t.documento)).toEqual(['NF-1020']); // título antigo (aberto antes do vínculo) veio junto
      ap.online.valor = true;
    } finally {
      const d = await api.chamar(analista, { method: 'DELETE', url: `/v1/core/carteira/${vinculo}` });
      expect(d.statusCode, d.body).toBe(204);
    }
    await esperar(HORIZONTE);
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await ap.ficha(C.c3)).toBeNull();
    for (const e of ['cliente_contato', 'cliente_financeiro', 'titulo', 'historico_compra'] as const) {
      const linhas = await ap.motor.linhas<LinhaSync & { cliente_id: string }>(e);
      expect(linhas.filter((l) => l.cliente_id === C.c3), `${e}: linhas de c3 saem do aparelho`).toEqual([]);
      expect(linhas.every((l) => l.cliente_id === C.c2), e).toBe(true);
    }
    // a ficha de c2 continua offline
    ap.online.valor = false;
    expect((await ap.ficha(C.c2))!.financeiro).toMatchObject({ bloqueado: true });
  });

  it('S1-023: o sync seguinte é incremental — nada novo, nada duplicado; a ficha continua igual', async () => {
    const ap = await aparelho('supervisor@exemplo.com.br', () => criarArmazenamentoEmMemoria());
    expect(await ap.motor.sincronizar()).toBe(true);
    const antes = await ap.ficha(C.c1);
    const qtd = (await ap.motor.linhas('titulo')).length;
    expect(await ap.motor.sincronizar()).toBe(true);
    expect(await ap.motor.linhas('titulo')).toHaveLength(qtd);
    expect(await ap.ficha(C.c1)).toEqual(antes);
  });
});
