/**
 * T-0184 (P-6, v1.0.15) — pedido em aprovação por motivo (crédito, inadimplência e desconto), entre módulos, com a API REAL
 * (createApp × Postgres como macuxi_app × fixture dois-tenants × despachante real da outbox).
 * Desenho: docs/desenho/T-0184.md (§2 modelo, §3 decisões, §4 parâmetros, §5 crédito e inadimplência); ADR 0062.
 * Regras: RN-VEN-10 (alçada), RN-VEN-12 (crédito), RN-VEN-13 (inadimplência, P1 A), RN-VEN-30 (pending_approval → cancelled),
 * RN-GES-08 (texto de quem devolve ou rejeita), RN-PRO-01 (promotor nunca decide), RN-CORE-05 (tenant). Decisões P1 a P8.
 * Matriz: docs/testes/T-0184.md.
 *
 * O ORÁCULO do crédito é escrito aqui pelo texto da RN-VEN-12 (desenho §5), sem chamar a função testada:
 *   disponível = (crédito disponível do ERP ?? limite − saldo em aberto) − Σ total dos pedidos do cliente em approved,
 *   sent_to_erp ou integrated (o integrated só quando o ERP não manda o disponível). A prazo, total > disponível = motivo
 *   `credito`; igual passa. Sem limite informado pelo ERP (limite 0 e sem disponível), a prazo = `credito` (P4 A).
 * Fixture: o A.c1 tem limite R$ 50.000,00, saldo R$ 10.000,00 e o título NF-1001 1/2 vencido há 10 dias (padrão
 * `titulo_vencido_dias` = 5). Os casos de crédito sobem o `titulo_vencido_dias` para 30 (sem inadimplência) e ajustam a linha
 * `core.cliente_financeiro` do A.c1 (como a Integração gravaria); o `afterAll` devolve tudo.
 *
 * Corpo das decisões: o do desenho §3/§7.1 (`aprovar` = `{ comentario?, motivo_aprovacao? }`; `rejeitar` e `recusar` =
 * `{ motivo: <texto do aprovador>, motivo_aprovacao? }`), o mesmo das rotas de sempre (demo-matriz D-G04, pedido-fatia 9).
 * O #493 implementou `{ texto, motivo?: <motivo da aprovação> }` (e o Gestor do #497 chama assim): defeito em recado ao
 * modulo-vendedor e ao modulo-gestor. O corpo está só em `corpoDa()`.
 * Convenção: `it` = critério do desenho (vermelho = defeito em recado ao dono); `it.todo` = parte que o código ainda não tem.
 */
import { comTenant, PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { FilaAprovacao } from '@macuxi/gestor/contracts';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, B, erroDe, licenca, poolComEncerramento, subirApi, type ApiDeTeste } from '../apoio/api';

const id = (n: number) => `0f184000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PED = {
  sonda: id(1),
  creditoIgual: id(2),
  umCentavo: id(3),
  semLimite: id(4),
  semLimiteAVista: id(5),
  inadimplenteAVista: id(6),
  tresAprovados: id(7),
  tresRecusa: id(8),
  devolver: id(9),
  b: id(10),
  promotor: id(11),
  sondaB: id(12),
} as const;
const PA = PAGAMENTO_FIXTURE.A;
const PB = PAGAMENTO_FIXTURE.B;
/** A.c1 na fixture (db/seeds/fixtures/dois-tenants.ts): limite R$ 50.000,00, saldo R$ 10.000,00, sem disponível do ERP. */
const FIN_A_C1 = { limite_cents: 5_000_000, saldo_aberto_cents: 1_000_000, credito_disponivel_cents: null as number | null };
const FIN_B_C1 = { limite_cents: 3_000_000, saldo_aberto_cents: 300_000, credito_disponivel_cents: null as number | null };

type Linha = Record<string, unknown>;
type Decisao = 'aprovar' | 'rejeitar' | 'recusar';
interface ItemDaFila {
  pedido_id: string;
  aprovacoes?: { motivo: string; nivel: string; estado: string; pode_decidir: boolean }[];
  inadimplencia?: { maior_atraso_dias: number; vencidos_cents: number } | null;
}
interface AprovacaoLida {
  motivo: string;
  nivel: string;
  estado: string;
  ciclo: number;
  decidida_por: string | null;
  texto_decisao: string | null;
}

describe.skipIf(semBanco())('T-0184 — aprovação do pedido por motivo: crédito, inadimplência e desconto (createApp real × Postgres × despachante)', () => {
  let api: ApiDeTeste;
  let worker: ReturnType<typeof poolComEncerramento> | null = null;
  const tk = { vendedor: '', promotor: '', supervisor: '', gerente: '', analista: '', adminA: '', vendedorB: '', adminB: '' };
  let prodA = '';
  let prodB = '';
  /** Total do pedido da sonda (1 un do ALFA-001, a prazo 28/56): o mesmo payload dá o mesmo total (RN-VEN-02). */
  let totalAPrazo = 0;

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const item = (pid: string, payload: Linha) => ({ entidade: 'pedido', id: pid, operacao: 'upsert', payload: { id: pid, created_offline_at: new Date().toISOString(), ...payload } });
  /** Pedido do A.c1: a prazo (BOLETO 28/56) ou à vista (PIX), com o desconto do pedido (8% = acima do vendedor, nível supervisor). */
  const pedidoA = (pid: string, pagamento: 'prazo' | 'avista', desconto = 0) =>
    item(pid, {
      customer_id: A.clientes.c1,
      discount_pct: desconto,
      items: [{ product_id: prodA, quantity: 1 }],
      forma_pagamento_id: pagamento === 'prazo' ? PA.formas.boleto : PA.formas.pix,
      prazo_pagamento_id: pagamento === 'prazo' ? PA.prazos.bol2856 : PA.prazos.pixAvista,
    });
  const pedidoB = (pid: string) =>
    item(pid, { customer_id: B.clientes.c1, discount_pct: 0, items: [{ product_id: prodB, quantity: 1 }], forma_pagamento_id: PB.formas.dinheiro, prazo_pagamento_id: PB.prazos.dinAvista });
  const aceito = (r: ResultadoItemPush | undefined, pid: string) => expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'aceito' });
  const pedido = async (pid: string) => (await q<{ status: string; nivel_aprovacao: string | null; motivos_aprovacao: string[]; total_cents: string; aprovacao_ciclo: number }>('select status, nivel_aprovacao, motivos_aprovacao, total_cents, aprovacao_ciclo from vendedor.pedido where id = $1', [pid]))[0];
  const aprovacoes = (pid: string) =>
    q<AprovacaoLida & Linha>(
      "select motivo, nivel, estado, ciclo, decidida_por::text, texto_decisao from vendedor.pedido_aprovacao where pedido_id = $1 and deleted_at is null order by ciclo, array_position(array['desconto','credito','inadimplencia','estoque','preco_minimo'], motivo)",
      [pid],
    );
  const resumo = async (pid: string) => (await aprovacoes(pid)).map((a) => `${a.motivo}:${a.nivel}:${a.estado}`);
  const eventos = (pid: string, nome: string) => q<{ payload: Linha }>('select payload from plataforma.evento where agregado_id = $1 and nome = $2 order by ocorrido_em, created_at', [pid, nome]);

  /** Corpo das rotas de decisão do Vendedor pelo desenho §7.1 (ver o cabeçalho). */
  const corpoDa = (decisao: Decisao, texto: string | undefined, motivoAprovacao: string | undefined): Linha => ({
    ...(texto !== undefined ? (decisao === 'aprovar' ? { comentario: texto } : { motivo: texto }) : {}),
    ...(motivoAprovacao ? { motivo_aprovacao: motivoAprovacao } : {}),
  });
  const decidir = (token: string, pid: string, decisao: Decisao, texto?: string, motivoAprovacao?: string) =>
    api.chamar(token, { method: 'POST', url: `/v1/vendedor/pedidos/${pid}/${decisao}`, payload: corpoDa(decisao, texto, motivoAprovacao) });

  const definirFinanceiroA = (f: { limite_cents: number; saldo_aberto_cents: number; credito_disponivel_cents: number | null }) =>
    q('update core.cliente_financeiro set limite_cents = $2, saldo_aberto_cents = $3, credito_disponivel_cents = $4 where tenant_id = $5 and cliente_id = $1', [A.clientes.c1, f.limite_cents, f.saldo_aberto_cents, f.credito_disponivel_cents, A.tenantId]);
  const parametro = async (tenant: string, chave: string, valor: string | null) => {
    await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = $2", [tenant, chave]);
    if (valor !== null) await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', $2, $3::jsonb)", [tenant, chave, valor]);
  };
  /** RN-VEN-12 (oráculo): o que já pesa no crédito do cliente = pedidos approved, sent_to_erp e integrated (sem disponível do ERP). */
  const pesandoNoCredito = async (cliente: string) =>
    Number((await q<{ s: string }>("select coalesce(sum(total_cents), 0)::text as s from vendedor.pedido where cliente_id = $1 and deleted_at is null and status in ('approved','sent_to_erp','integrated')", [cliente]))[0]!.s);

  const despachar = async () => {
    if (!worker) return;
    const d = criarDespachante({ worker: worker.pool, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
  };
  /** Fila do Gestor validada pelo contrato; os campos do #497 (`aprovacoes`, `inadimplencia`) lidos sem depender do tipo do main. */
  const fila = async (token: string) => {
    const r = await api.chamar(token, { method: 'GET', url: '/v1/gestor/aprovacoes' });
    expect(r.statusCode, r.body).toBe(200);
    return FilaAprovacao.parse(r.json()) as unknown as { itens: ItemDaFila[] };
  };

  const limpar = async () => {
    const ids = Object.values(PED);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [ids]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]);
    await api.admin.query('delete from plataforma.evento where agregado_id = any($1::uuid[])', [ids]).catch(() => undefined);
    for (const t of [A.tenantId, B.tenantId]) for (const c of ['titulo_vencido_dias', 'aprovacao.credito_nivel', 'aprovacao.inadimplencia_nivel']) await parametro(t, c, null);
    await definirFinanceiroA(FIN_A_C1);
    await q('update core.cliente_financeiro set limite_cents = $2, saldo_aberto_cents = $3, credito_disponivel_cents = $4 where tenant_id = $5 and cliente_id = $1', [B.clientes.c1, FIN_B_C1.limite_cents, FIN_B_C1.saldo_aberto_cents, FIN_B_C1.credito_disponivel_cents, B.tenantId]);
  };

  beforeAll(async () => {
    api = await subirApi();
    if (api.banco.urlWorker) {
      worker = poolComEncerramento(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
    }
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.adminA = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    prodB = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'BETA-001'", [B.tenantId]))[0]!.id;
    await limpar();
    // o Gestor ligado no tenant A e nos perfis que decidem (a fixture não o tem): a projeção `aprovacoes` recebe os eventos
    expect((await licenca(api, tk.adminA, 'tenant', 'gestor', true)).statusCode).toBe(200);
    for (const perfil of ['supervisor', 'gerente', 'analista']) expect((await licenca(api, tk.adminA, 'perfil', 'gestor', true, perfil)).statusCode, perfil).toBe(200);
    await despachar(); // esvazia a outbox da fixture antes dos casos
    // sonda: o total do pedido a prazo, com crédito folgado e sem inadimplência; depois some (não pode pesar no crédito)
    await parametro(A.tenantId, 'titulo_vencido_dias', '30');
    aceito((await push(tk.vendedor, [pedidoA(PED.sonda, 'prazo')]))[0], PED.sonda);
    const sonda = (await pedido(PED.sonda))!;
    expect(sonda.status, 'sonda: crédito folgado e atraso (10) abaixo do parâmetro (30) = aprovado na hora').toBe('approved');
    totalAPrazo = Number(sonda.total_cents);
    expect(totalAPrazo).toBeGreaterThan(0);
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = $1', [PED.sonda]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = $1', [PED.sonda]);
    await api.admin.query('delete from integracao.pedido_fila_erp where pedido_uuid = $1', [PED.sonda]).catch(() => undefined);
    await api.admin.query('delete from vendedor.pedido where id = $1', [PED.sonda]);
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await limpar().catch(() => undefined);
    await worker?.encerrar();
    await api.fechar();
  });

  // ------------------------------------------------------------------------------------------------ RN-VEN-12 (crédito)
  describe('C. Crédito (RN-VEN-12, P4 A): só a prazo; igual ao total passa, um centavo a menos vai para aprovação', () => {
    it('C1. disponível IGUAL ao total (limite − saldo − aprovados = total): aprovado na hora, sem aprovação aberta', async () => {
      const pesando = await pesandoNoCredito(A.clientes.c1);
      await definirFinanceiroA({ limite_cents: FIN_A_C1.saldo_aberto_cents + pesando + totalAPrazo, saldo_aberto_cents: FIN_A_C1.saldo_aberto_cents, credito_disponivel_cents: null });
      aceito((await push(tk.vendedor, [pedidoA(PED.creditoIgual, 'prazo')]))[0], PED.creditoIgual);
      const p = (await pedido(PED.creditoIgual))!;
      expect(Number(p.total_cents), 'o mesmo payload da sonda dá o mesmo total').toBe(totalAPrazo);
      expect(p.status).toBe('approved');
      expect(await aprovacoes(PED.creditoIgual)).toEqual([]);
      expect(await eventos(PED.creditoIgual, 'vendedor.pedido.aprovacao_solicitada@2')).toEqual([]);
    });

    it('C2. disponível UM CENTAVO abaixo do total: pending_approval com uma aprovação `credito` (nível gerente, padrão P5 B); o @2 leva o crédito do oráculo', async () => {
      const pesando = await pesandoNoCredito(A.clientes.c1); // inclui o C1, agora aprovado
      const limite = FIN_A_C1.saldo_aberto_cents + pesando + totalAPrazo - 1;
      await definirFinanceiroA({ limite_cents: limite, saldo_aberto_cents: FIN_A_C1.saldo_aberto_cents, credito_disponivel_cents: null });
      aceito((await push(tk.vendedor, [pedidoA(PED.umCentavo, 'prazo')]))[0], PED.umCentavo);
      expect(await pedido(PED.umCentavo)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', motivos_aprovacao: ['credito'], aprovacao_ciclo: 1 });
      expect(await resumo(PED.umCentavo)).toEqual(['credito:gerente:pendente']);
      const [ev] = await eventos(PED.umCentavo, 'vendedor.pedido.aprovacao_solicitada@2');
      expect(ev, 'aprovacao_solicitada@2 publicado').toBeDefined();
      const disponivel = limite - FIN_A_C1.saldo_aberto_cents - pesando; // oráculo RN-VEN-12 = total − 1
      expect(disponivel).toBe(totalAPrazo - 1);
      expect(ev!.payload).toMatchObject({ nivel: 'gerente', motivos: ['credito'], aprovacoes: [{ motivo: 'credito', nivel: 'gerente' }], total_cents: totalAPrazo, inadimplencia: null });
      expect(ev!.payload.credito, 'valor × regra: o crédito do evento é o do oráculo').toMatchObject({ limite_cents: limite, saldo_aberto_cents: FIN_A_C1.saldo_aberto_cents, disponivel_cents: disponivel });
      // o detalhe do pedido traz as aprovações do ciclo atual (desenho §7.1)
      const d = await api.chamar(tk.vendedor, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.umCentavo}` });
      expect(d.statusCode, d.body).toBe(200);
      expect((d.json() as { aprovacoes?: Linha[] }).aprovacoes).toEqual([expect.objectContaining({ motivo: 'credito', nivel: 'gerente', estado: 'pendente', decidida_por_id: null, decidida_em: null })]);
      // o @1 não sai mais (ADR 0062)
      expect(await eventos(PED.umCentavo, 'vendedor.pedido.aprovacao_solicitada@1')).toEqual([]);
    });

    it('C3. cliente SEM limite informado pelo ERP (limite 0, sem disponível), a prazo: vai para aprovação `credito` (P4 A)', async () => {
      await definirFinanceiroA({ limite_cents: 0, saldo_aberto_cents: 0, credito_disponivel_cents: null });
      aceito((await push(tk.vendedor, [pedidoA(PED.semLimite, 'prazo')]))[0], PED.semLimite);
      expect(await pedido(PED.semLimite)).toMatchObject({ status: 'pending_approval', motivos_aprovacao: ['credito'] });
      expect(await resumo(PED.semLimite)).toEqual(['credito:gerente:pendente']);
    });

    it('C4. cliente sem limite, À VISTA: o crédito não pesa (aprovado na hora, sem aprovação)', async () => {
      await definirFinanceiroA({ limite_cents: 0, saldo_aberto_cents: 0, credito_disponivel_cents: null });
      aceito((await push(tk.vendedor, [pedidoA(PED.semLimiteAVista, 'avista')]))[0], PED.semLimiteAVista);
      expect((await pedido(PED.semLimiteAVista))!.status).toBe('approved');
      expect(await aprovacoes(PED.semLimiteAVista)).toEqual([]);
      await definirFinanceiroA(FIN_A_C1);
    });
  });

  // ------------------------------------------------------------------------------------------------ RN-VEN-13 (inadimplência)
  describe('I. Inadimplência (RN-VEN-13, P1 A): vai para aprovação com qualquer forma de pagamento', () => {
    it('I1. inadimplente (atraso 10 > 5) À VISTA, crédito folgado: pending_approval só com `inadimplencia`; o @2 leva o atraso e o vencido', async () => {
      await parametro(A.tenantId, 'titulo_vencido_dias', null); // padrão 5
      aceito((await push(tk.vendedor, [pedidoA(PED.inadimplenteAVista, 'avista')]))[0], PED.inadimplenteAVista);
      expect(await pedido(PED.inadimplenteAVista)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', motivos_aprovacao: ['inadimplencia'] });
      expect(await resumo(PED.inadimplenteAVista)).toEqual(['inadimplencia:gerente:pendente']);
      const [ev] = await eventos(PED.inadimplenteAVista, 'vendedor.pedido.aprovacao_solicitada@2');
      // fixture: NF-1001 1/2 de R$ 5.000,00 vencida há 10 dias (a 2/2 ainda não venceu)
      expect(ev?.payload.inadimplencia).toEqual({ maior_atraso_dias: 10, vencidos_cents: 500_000 });
      await parametro(A.tenantId, 'titulo_vencido_dias', '30');
    });
  });

  // ------------------------------------------------------------------------------------------------ P2 B, P3 B, P7 A, P8 A, P6 A
  describe('M. Três motivos em paralelo, um aprovador por motivo (P2 B, P3 B, P7 A) e a rejeição que encerra (P8 A, P6 A)', () => {
    /** Desconto 8% (supervisor), crédito estourado a prazo (gerente) e inadimplência (analista, pelo parâmetro). */
    const pedidoComTresMotivos = async (pid: string) => {
      await parametro(A.tenantId, 'titulo_vencido_dias', null);
      await definirFinanceiroA({ limite_cents: 0, saldo_aberto_cents: 0, credito_disponivel_cents: null });
      aceito((await push(tk.vendedor, [pedidoA(pid, 'prazo', 8)]))[0], pid);
      await definirFinanceiroA(FIN_A_C1);
      await parametro(A.tenantId, 'titulo_vencido_dias', '30');
    };

    it('M0. Parâmetros › Pedidos: o analista grava quem aprova inadimplência = analista; GET alcadas devolve os dois níveis (crédito no padrão gerente)', async () => {
      const g = await api.chamar(tk.analista, { method: 'PUT', url: '/v1/vendedor/alcadas/aprovadores', payload: { aprovador_credito: 'gerente', aprovador_inadimplencia: 'analista' } });
      expect(g.statusCode, g.body).toBe(200);
      const r = await api.chamar(tk.vendedor, { method: 'GET', url: '/v1/vendedor/alcadas' });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ aprovador_credito: 'gerente', aprovador_inadimplencia: 'analista' });
    });

    it('M1. três aprovações pendentes no ciclo 1; o pedido leva o MAIOR nível (analista); o @2 traz uma entrada por motivo', async () => {
      await pedidoComTresMotivos(PED.tresAprovados);
      expect(await pedido(PED.tresAprovados)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'analista', aprovacao_ciclo: 1 });
      expect([...(await pedido(PED.tresAprovados))!.motivos_aprovacao].sort()).toEqual(['credito', 'desconto', 'inadimplencia']);
      expect(await resumo(PED.tresAprovados)).toEqual(['desconto:supervisor:pendente', 'credito:gerente:pendente', 'inadimplencia:analista:pendente']);
      const [ev] = await eventos(PED.tresAprovados, 'vendedor.pedido.aprovacao_solicitada@2');
      const aps = (ev?.payload.aprovacoes as { motivo: string; nivel: string }[] | undefined) ?? [];
      expect(aps.map((a) => `${a.motivo}:${a.nivel}`).sort()).toEqual(['credito:gerente', 'desconto:supervisor', 'inadimplencia:analista']);
      expect(ev!.payload.nivel, 'raiz = maior nível entre as pendentes').toBe('analista');
    });

    it('M2. Gestor: cada aprovador vê na fila só os motivos que decide (P3 B): supervisor = desconto; gerente = desconto e crédito', async () => {
      if (!worker) return expect.soft(worker, 'sem MACUXI_PG_WORKER_SENHA: sem despachante').not.toBeNull();
      await despachar();
      const doSupervisor = (await fila(tk.supervisor)).itens.find((i) => i.pedido_id === PED.tresAprovados);
      expect(doSupervisor?.aprovacoes?.map((a) => a.motivo)).toEqual(['desconto']);
      const doGerente = (await fila(tk.gerente)).itens.find((i) => i.pedido_id === PED.tresAprovados);
      expect(doGerente?.aprovacoes?.map((a) => a.motivo).sort()).toEqual(['credito', 'desconto']);
      expect(doGerente?.inadimplencia).toEqual({ maior_atraso_dias: 10, vencidos_cents: 500_000 });
    });

    it('M3. em paralelo, em qualquer ordem: o analista aprova a inadimplência e o supervisor o desconto (segue pendente, nível = o que sobra); o gerente aprova o crédito e o pedido sai aprovado', async () => {
      const r1 = await decidir(tk.analista, PED.tresAprovados, 'aprovar', undefined, 'inadimplencia');
      expect(r1.statusCode, r1.body).toBe(200);
      expect(r1.json()).toMatchObject({ status: 'pending_approval' });
      const r2 = await decidir(tk.supervisor, PED.tresAprovados, 'aprovar', undefined, 'desconto');
      expect(r2.statusCode, r2.body).toBe(200);
      expect(await pedido(PED.tresAprovados)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente' });
      expect(await resumo(PED.tresAprovados)).toEqual(['desconto:supervisor:aprovada', 'credito:gerente:pendente', 'inadimplencia:analista:aprovada']);
      // o supervisor não decide o crédito (nível gerente): 422 e nada muda
      const r3 = await decidir(tk.supervisor, PED.tresAprovados, 'aprovar', undefined, 'credito');
      expect([r3.statusCode, erroDe(r3).codigo], r3.body).toEqual([422, 'RN-VEN-10']);
      const r4 = await decidir(tk.gerente, PED.tresAprovados, 'aprovar', undefined, 'credito');
      expect(r4.statusCode, r4.body).toBe(200);
      expect(r4.json()).toMatchObject({ status: 'approved' });
      expect((await pedido(PED.tresAprovados))!.status).toBe('approved');
      expect(await resumo(PED.tresAprovados)).toEqual(['desconto:supervisor:aprovada', 'credito:gerente:aprovada', 'inadimplencia:analista:aprovada']);
      // um aprovado@1 só, no fim (o Hub manda ao ERP quando TODAS estão aprovadas)
      expect(await eventos(PED.tresAprovados, 'vendedor.pedido.aprovado@1')).toHaveLength(1);
      const decididas = (await eventos(PED.tresAprovados, 'vendedor.pedido.aprovacao_decidida@1')).map((e) => `${String(e.payload.motivo)}:${String(e.payload.decisao)}`);
      expect(decididas.sort()).toEqual(['credito:aprovada', 'desconto:aprovada', 'inadimplencia:aprovada']);
    });

    it('M4. recusar (Rejeitar) um motivo leva o pedido a `cancelled` e ENCERRA as outras pendentes, com o autor de quem rejeitou; repetir não tem efeito; aprovar depois = 422', async () => {
      await pedidoComTresMotivos(PED.tresRecusa);
      const s = await decidir(tk.supervisor, PED.tresRecusa, 'aprovar', undefined, 'desconto');
      expect(s.statusCode, s.body).toBe(200);
      const r = await decidir(tk.gerente, PED.tresRecusa, 'recusar', 'Cliente sem crédito na praça', 'credito');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'cancelled' });
      expect((await pedido(PED.tresRecusa))!.status).toBe('cancelled');
      const lidas = await aprovacoes(PED.tresRecusa);
      expect(lidas.map((a) => `${a.motivo}:${a.estado}`)).toEqual(['desconto:aprovada', 'credito:rejeitada', 'inadimplencia:encerrada']);
      expect(lidas.find((a) => a.motivo === 'credito')).toMatchObject({ decidida_por: A.usuarios.gerente, texto_decisao: 'Cliente sem crédito na praça' });
      expect(lidas.find((a) => a.motivo === 'inadimplencia'), 'encerrada guarda quem rejeitou, sem o texto').toMatchObject({ decidida_por: A.usuarios.gerente, texto_decisao: null });
      const dec = (await eventos(PED.tresRecusa, 'vendedor.pedido.aprovacao_decidida@1')).map((e) => e.payload);
      expect(dec.find((e) => e.motivo === 'inadimplencia')).toMatchObject({ decisao: 'encerrada', autor_id: A.usuarios.gerente, texto: null, ciclo: 1 });
      expect(await eventos(PED.tresRecusa, 'vendedor.pedido.aprovado@1')).toEqual([]);
      // idempotente: a mesma decisão de novo devolve o estado, sem evento novo
      const antes = (await eventos(PED.tresRecusa, 'vendedor.pedido.aprovacao_decidida@1')).length;
      const de2 = await decidir(tk.gerente, PED.tresRecusa, 'recusar', 'Cliente sem crédito na praça', 'credito');
      expect(de2.statusCode, de2.body).toBe(200);
      expect(de2.json()).toMatchObject({ status: 'cancelled' });
      expect(await eventos(PED.tresRecusa, 'vendedor.pedido.aprovacao_decidida@1')).toHaveLength(antes);
      // cancelado é final (RN-VEN-30)
      const ap = await decidir(tk.analista, PED.tresRecusa, 'aprovar', undefined, 'inadimplencia');
      expect([ap.statusCode, erroDe(ap).codigo], ap.body).toEqual([422, 'RN-VEN-30']);
    });

    it('M5. Gestor: depois da rejeição o pedido sai da fila de todos (despachante real)', async () => {
      if (!worker) return expect.soft(worker, 'sem MACUXI_PG_WORKER_SENHA: sem despachante').not.toBeNull();
      await despachar();
      for (const t of [tk.supervisor, tk.gerente, tk.analista]) {
        const ids = (await fila(t)).itens.map((i) => i.pedido_id);
        expect(ids).not.toContain(PED.tresRecusa);
        expect(ids).not.toContain(PED.tresAprovados);
      }
    });

    it('M6. RN-GES-08: recusar e devolver sem texto (ou com menos de 3 letras) são recusados e nada muda', async () => {
      await pedidoComTresMotivos(PED.devolver);
      for (const decisao of ['recusar', 'rejeitar'] as const) {
        for (const texto of ['', '  ', 'ab']) {
          const r = await decidir(tk.gerente, PED.devolver, decisao, texto, 'credito');
          expect([r.statusCode, erroDe(r).codigo], `${decisao} com ${JSON.stringify(texto)}: ${r.body}`).toEqual([422, 'RN-GES-08']);
        }
      }
      expect((await pedido(PED.devolver))!.status).toBe('pending_approval');
      expect((await aprovacoes(PED.devolver)).every((a) => a.estado === 'pendente')).toBe(true);
    });

    it('M7. Devolver ao vendedor (rota `rejeitar`) leva o pedido a `rejected`, devolve o motivo e encerra as outras pendentes', async () => {
      const r = await decidir(tk.supervisor, PED.devolver, 'rejeitar', 'Ajuste o desconto para 5%', 'desconto');
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ status: 'rejected' });
      expect((await pedido(PED.devolver))!.status).toBe('rejected');
      expect(await resumo(PED.devolver)).toEqual(['desconto:supervisor:devolvida', 'credito:gerente:encerrada', 'inadimplencia:analista:encerrada']);
      const dec = (await eventos(PED.devolver, 'vendedor.pedido.aprovacao_decidida@1')).map((e) => `${String(e.payload.motivo)}:${String(e.payload.decisao)}`);
      expect(dec.sort()).toEqual(['credito:encerrada', 'desconto:devolvida', 'inadimplencia:encerrada']);
      const st = (await eventos(PED.devolver, 'vendedor.pedido.status_alterado@1')).map((e) => e.payload);
      expect(st.at(-1)).toMatchObject({ de: 'em_aprovacao', para: 'rejeitado', motivo: 'Ajuste o desconto para 5%' });
    });

    // desenho §2: "O reenvio pelo vendedor abre um ciclo novo e o servidor recalcula todos os motivos". O `receber.ts` do
    // modulo-vendedor grava sempre o ciclo 1 e o mesmo id com outro conteúdo cai em `conflito` (RN-VEN-33): o reenvio não existe.
    it.todo('M8. reenviar o pedido devolvido abre o ciclo 2 (aprovacao_ciclo = 2), recalcula os motivos e o detalhe mostra só as aprovações do ciclo 2');
  });

  // ------------------------------------------------------------------------------------------------ Core: aviso ao aprovador
  describe('N. Notificação ao aprovador (Core, consumidor do aprovacao_solicitada@2; desenho §1 e §6 item 3)', () => {
    // Defeito: o Vendedor publica só o @2 (ADR 0062) e o Core ainda consome só o @1 (modules/core/manifest.ts, consome;
    // modules/core/api/consumidores-pedido.ts:59). O `notificacoesDeAprovacaoPorNivel` (domínio) existe, mas sem o consumidor
    // nenhum aprovador recebe "Pedido N para aprovar". Recado ao modulo-core.
    it('N1. pedido em aprovação → despachante → o gerente recebe a notificação "para aprovar" com o link do pedido', async () => {
      if (!worker) throw new Error('sem MACUXI_PG_WORKER_SENHA: sem despachante');
      await despachar();
      const n = await q<{ usuario_id: string; titulo: string }>('select usuario_id::text, titulo from core.notificacao where tenant_id = $1 and link = $2', [A.tenantId, `/m/pedido?id=${PED.umCentavo}`]);
      expect(n.map((x) => x.usuario_id)).toContain(A.usuarios.gerente);
      expect(n.find((x) => x.usuario_id === A.usuarios.gerente)?.titulo).toMatch(/para aprovar$/);
    });
  });

  // ------------------------------------------------------------------------------------------------ RN-CORE-05 (tenant)
  describe('T. Multi-tenant (RN-CORE-05)', () => {
    it('T1. os parâmetros de quem aprova são por tenant: o B (sem parâmetro) usa o padrão gerente para a inadimplência, mesmo com o A em analista', async () => {
      await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '1'::jsonb)", [B.tenantId]); // B.c1: atraso 3 > 1
      aceito((await push(tk.vendedorB, [pedidoB(PED.b)]))[0], PED.b);
      expect(await pedido(PED.b)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', motivos_aprovacao: ['inadimplencia'] });
      expect(await resumo(PED.b)).toEqual(['inadimplencia:gerente:pendente']);
      const r = await api.chamar(tk.vendedorB, { method: 'GET', url: '/v1/vendedor/alcadas' });
      expect(r.json()).toMatchObject({ aprovador_credito: 'gerente', aprovador_inadimplencia: 'gerente' });
    });

    it('T2. o gerente e o analista do A não leem nem decidem o pedido do B (404) e o B não lê o do A; nada muda', async () => {
      for (const [t, d] of [[tk.gerente, 'recusar'], [tk.analista, 'aprovar'], [tk.gerente, 'rejeitar']] as const) {
        const r = await decidir(t, PED.b, d, 'Texto de quem não é do tenant', 'inadimplencia');
        expect(r.statusCode, `${d}: ${r.body}`).toBe(404);
      }
      expect((await api.chamar(tk.analista, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.b}` })).statusCode).toBe(404);
      expect((await api.chamar(tk.vendedorB, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.umCentavo}` })).statusCode).toBe(404);
      expect(await resumo(PED.b)).toEqual(['inadimplencia:gerente:pendente']);
    });

    it('T3. RLS da vendedor.pedido_aprovacao: no contexto do B, o macuxi_app não vê nem altera as aprovações do A', async () => {
      const vistas = await comTenant(api.pool, B.tenantId, async (c) => (await c.query<{ pedido_id: string }>('select pedido_id::text from vendedor.pedido_aprovacao')).rows.map((r) => r.pedido_id));
      expect(vistas).toContain(PED.b);
      expect(vistas).not.toContain(PED.umCentavo);
      const alteradas = await comTenant(api.pool, B.tenantId, async (c) => (await c.query("update vendedor.pedido_aprovacao set estado = 'aprovada', decidida_em = now() where pedido_id = $1", [PED.umCentavo])).rowCount);
      expect(alteradas).toBe(0);
      expect(await resumo(PED.umCentavo)).toEqual(['credito:gerente:pendente']);
    });
  });

  // ------------------------------------------------------------------------------------------------ RN-PRO-01 (promotor)
  describe('P. Promotor recusado (RN-PRO-01): nunca decide nem muda quem aprova', () => {
    it('P1. sem o Vendedor no perfil (fixture): aprovar, devolver, recusar e gravar os aprovadores = 403; nada muda', async () => {
      for (const d of ['aprovar', 'rejeitar', 'recusar'] as const) {
        const r = await decidir(tk.promotor, PED.umCentavo, d, 'Texto do promotor', 'credito');
        expect(r.statusCode, `${d}: ${r.body}`).toBe(403);
      }
      const g = await api.chamar(tk.promotor, { method: 'PUT', url: '/v1/vendedor/alcadas/aprovadores', payload: { aprovador_credito: 'supervisor', aprovador_inadimplencia: 'supervisor' } });
      expect(g.statusCode, g.body).toBe(403);
      expect(await resumo(PED.umCentavo)).toEqual(['credito:gerente:pendente']);
    });

    it('P2. COM o Vendedor no perfil do promotor (pior caso): as três decisões e os aprovadores = 403 PERFIL_SEM_ACESSO; o push de pedido = rejeitado RN-PRO-01', async () => {
      // o Vendedor depende do Catálogo (RN-CORE-03): os dois no perfil, como no promotor-pedido.test.ts
      expect((await licenca(api, tk.adminA, 'perfil', 'catalogo', true, 'promotor')).statusCode).toBe(200);
      expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'promotor')).statusCode).toBe(200);
      try {
        for (const d of ['aprovar', 'rejeitar', 'recusar'] as const) {
          const r = await decidir(tk.promotor, PED.umCentavo, d, 'Texto do promotor', 'credito');
          expect([r.statusCode, erroDe(r).codigo], `${d}: ${r.body}`).toEqual([403, 'PERFIL_SEM_ACESSO']);
        }
        const g = await api.chamar(tk.promotor, { method: 'PUT', url: '/v1/vendedor/alcadas/aprovadores', payload: { aprovador_credito: 'supervisor', aprovador_inadimplencia: 'supervisor' } });
        expect([g.statusCode, erroDe(g).codigo], g.body).toEqual([403, 'PERFIL_SEM_ACESSO']);
        const [p] = await push(tk.promotor, [pedidoA(PED.promotor, 'prazo')]);
        expect(p, JSON.stringify(p)).toMatchObject({ id: PED.promotor, status: 'rejeitado', codigo: 'RN-PRO-01' });
        expect(await pedido(PED.promotor)).toBeUndefined();
      } finally {
        await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'promotor');
        await licenca(api, tk.adminA, 'perfil', 'catalogo', false, 'promotor');
      }
      expect(await resumo(PED.umCentavo)).toEqual(['credito:gerente:pendente']);
      const r = await api.chamar(tk.vendedor, { method: 'GET', url: '/v1/vendedor/alcadas' });
      expect(r.json(), 'os aprovadores seguem os do M0').toMatchObject({ aprovador_credito: 'gerente', aprovador_inadimplencia: 'analista' });
    });
  });

  // ------------------------------------------------------------------------------------------------ licença (RN-CORE-02)
  describe('L. Módulo desativado', () => {
    it('L1. sem o Vendedor no perfil do gerente: a rota nova `recusar` = 403 MODULO_INATIVO e nada muda', async () => {
      expect((await licenca(api, tk.adminA, 'perfil', 'vendedor', false, 'gerente')).statusCode).toBe(200);
      try {
        const r = await decidir(tk.gerente, PED.umCentavo, 'recusar', 'Cliente sem crédito', 'credito');
        expect([r.statusCode, erroDe(r).codigo], r.body).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        await licenca(api, tk.adminA, 'perfil', 'vendedor', true, 'gerente');
      }
      expect(await resumo(PED.umCentavo)).toEqual(['credito:gerente:pendente']);
    });
  });
});
