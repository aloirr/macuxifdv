/**
 * Novo pedido de distribuidora × Postgres real (T-0061): UN/CX, desconto e acréscimo por item e por pedido, desconto
 * efetivo e alçada, frete CIF/FOB, transportadora cadastrada ou digitada, endereço de entrega, detalhe, evento ao ERP, pull,
 * cadastro de transportadoras (BKO, multi-tenant) e padrão do frete. As consultas do Core e do Catálogo são simuladas (como em
 * `pedido.db.test.ts`). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { type ClienteBanco, type ContextoBase, type DefinicaoEvento, type ItemPush, type ResultadoItemPush, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entidadePedido } from '../contracts/entidades';
import { OrderDetail, TransportadoraSyncSchema } from '../contracts';
import { responderFiliais } from './filial-simulada';
import { rotaVerPedido } from './pedidos';
import { provedoresSyncVendedor } from './sync';
import {
  rotaAtualizarTransportadora,
  rotaCriarTransportadora,
  rotaLerFreteParametros,
  rotaListarTransportadoras,
  rotaTransportadorasDigitadas,
} from './transportadoras';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
let AGORA!: Date;
const id = (n: number) => `0f610000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = Array.from({ length: 40 }, (_, i) => id(i + 1));
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();

const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
const promotor: UsuarioAutenticado = { id: A.usuarios.promotor, tenant_id: A.tenantId, perfil: 'promotor' };
const gerente: UsuarioAutenticado = { id: A.usuarios.gerente, tenant_id: A.tenantId, perfil: 'gerente' };
const gerenteB: UsuarioAutenticado = { id: B.usuarios.admin, tenant_id: B.tenantId, perfil: 'admin' };

const CNPJ_OK = '11222333000181';
const END_PRINCIPAL = id(31);
const END_ENTREGA = id(32);
const END_DE_OUTRO = id(33);

interface Registro {
  eventos: Array<{ nome: string; payload: Record<string, unknown> }>;
  auditoria: Array<{ acao: string; entidade_id: string | null; antes: unknown; depois: unknown }>;
}

describe.skipIf(semBanco())('Vendedor × Postgres: novo pedido de distribuidora (T-0061)', () => {
  let pool: pg.Pool;
  let prod1 = '';
  let prod2 = '';
  let transpA = '';
  let transpInativa = '';

  const PRECOS = (): Record<string, number> => ({ [prod1]: 1_000, [prod2]: 5_000 });

  function contexto(u: UsuarioAutenticado, o: { carteira?: ReadonlySet<string> | 'tenant'; parametros?: Record<string, unknown>; registro?: Registro } = {}) {
    const registro: Registro = o.registro ?? { eventos: [], auditoria: [] };
    const base = {
      usuario: { ...u, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      carteira: async () => o.carteira ?? 'tenant',
      usuariosVisiveis: async () => new Set([u.id]),
      parametros: () => o.parametros ?? {},
      log: { info() {}, warn() {}, error() {} },
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, u.tenant_id, (c) => {
          const tx = {
            async consultar(def: { nome: string }, entrada: Record<string, unknown>) {
              if (def.nome === CONSULTA_FILIAIS.nome) return responderFiliais(entrada);
              if (def.nome === CONSULTA_CADASTRO_RESUMO.nome) {
                const ent = CONSULTA_CADASTRO_RESUMO.entrada.parse(entrada);
                const pegar = (tabela: 'cliente' | 'produto' | 'usuario', ids: string[], campos: string[]) =>
                  CADASTRO[tabela].filter((l) => ids.includes(l.id as string)).map((l) => Object.fromEntries(campos.map((k) => [k, l[k] ?? null])));
                const produtos = pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']).map((p) => ({
                  ...p,
                  unidades:
                    p.id === prod1
                      ? [
                          { unidade: String(p.unidade), fator: 1, padrao: true, ativo: true, external_id: null },
                          { unidade: 'CX', fator: 12, padrao: false, ativo: true, external_id: null },
                          { unidade: 'FD', fator: 6, padrao: false, ativo: false, external_id: null },
                        ]
                      : undefined,
                }));
                const clienteId = ent.cliente_ids[0];
                const enderecos = clienteId
                  ? [
                      { id: END_PRINCIPAL, cliente_id: clienteId, tipo: 'principal', logradouro: 'Rua Principal', numero: '10', complemento: null, bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69000000', principal: true, ativo: true, external_id: 'END-1' },
                      { id: END_ENTREGA, cliente_id: clienteId, tipo: 'entrega', logradouro: 'Av. do Depósito', numero: '500', complemento: 'Galpão 2', bairro: 'Distrito', cidade: 'Manaus', uf: 'AM', cep: '69100000', principal: false, ativo: true, external_id: 'END-2' },
                    ].filter((e) => e.principal || ent.endereco_ids.includes(e.id))
                  : [];
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos,
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                  enderecos,
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                return { tabela_preco_id: id(39), itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: PRECOS()[p] ?? null, motivo_sem_preco: null })) };
              }
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              registro.eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> });
              return {};
            },
            async auditar(r: { acao: string; entidade_id: string | null; antes?: unknown; depois?: unknown }) {
              registro.auditoria.push({ acao: r.acao, entidade_id: r.entidade_id, antes: r.antes, depois: r.depois });
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    };
    return { ctx: base as unknown as ContextoBase, registro };
  }

  const push = (idPedido: string, payload: Record<string, unknown>): ItemPush =>
    ({ entidade: 'pedido', id: idPedido, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: idPedido, customer_id: A.clientes.c1, discount_pct: 0, ...payload }) }) as unknown as ItemPush;
  const receber = (c: ContextoBase, ...itens: ItemPush[]): Promise<ResultadoItemPush[]> => provedoresSyncVendedor[0]!.receber!(c, itens);
  const chamar = (rota: { executar: (c: never) => Promise<unknown> }, c: ContextoBase, extra: { params?: object; corpo?: object; query?: object } = {}) =>
    rota.executar({ ...(c as object), params: extra.params ?? {}, corpo: extra.corpo ?? {}, query: extra.query ?? {} } as never);

  async function lerPedido(pedidoId: string) {
    return comTenant(pool, A.tenantId, async (c) => {
      const p = (await c.query('select * from vendedor.pedido where id = $1', [pedidoId])).rows[0];
      const it = (await c.query('select * from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pedidoId])).rows;
      return { p, it };
    });
  }
  async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = new pg.Client({ connectionString: banco().urlAdmin });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
  async function limpar() {
    await admin(async (c) => {
      await c.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [IDS]);
      await c.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [IDS]);
      await c.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
      await c.query("delete from vendedor.transportadora where nome like 'T0061 %'");
    });
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    AGORA = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: linha do tempo única do arquivo
    await limpar();
    prod1 = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
    prod2 = CADASTRO.produto.find((x) => x.sku === 'ALFA-002' && x.tenant_id === A.tenantId)!.id as string;
    await admin(async (c) => {
      transpA = (await c.query("insert into vendedor.transportadora (tenant_id, nome, documento, telefone) values ($1, 'T0061 Rápido Norte', $2, '92 3000-0000') returning id", [A.tenantId, CNPJ_OK])).rows[0].id;
      transpInativa = (await c.query("insert into vendedor.transportadora (tenant_id, nome, documento, ativo) values ($1, 'T0061 Parada', '12345678000195', false) returning id", [A.tenantId])).rows[0].id;
    });
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  const comCarteira = () => contexto(vendedor1, { carteira: new Set([A.clientes.c1]) });

  describe('preço, medida e alçada (RN-VEN-02/03/10/15)', () => {
    it('RN-VEN-15: a CX cobra UN × fator, grava fator e quantidade em unidades base e o evento ao ERP leva a quantidade na unidade base', async () => {
      const { ctx, registro } = comCarteira();
      const [r] = await receber(ctx, push(id(1), { items: [{ product_id: prod1, quantity: 2, unidade: 'CX' }] }));
      expect(r).toMatchObject({ status: 'aceito' });
      const { p, it } = await lerPedido(id(1));
      expect(it[0]).toMatchObject({ unidade: 'CX', fator: 12, quantidade: 2, quantidade_base: 24 });
      expect(Number(it[0].preco_tabela_cents)).toBe(12_000);
      expect(Number(p.total_cents)).toBe(24_000);
      const aprovado = registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { itens: Array<Record<string, unknown>>; total_cents: number };
      expect(aprovado.itens[0]).toMatchObject({ quantidade: 24, unidade: 'CX', fator: 12, quantidade_venda: 2, preco_tabela_cents: 12_000, preco_unitario_cents: 1_000, total_cents: 24_000 });
      expect(aprovado.total_cents).toBe(24_000);
    });

    it('RN-VEN-15: unidade que não é do produto (ou inativa) é recusada: unidade_invalida', async () => {
      const { ctx } = comCarteira();
      const [r1] = await receber(ctx, push(id(2), { items: [{ product_id: prod1, quantity: 1, unidade: 'PCT' }] }));
      const [r2] = await receber(ctx, push(id(3), { items: [{ product_id: prod1, quantity: 1, unidade: 'FD' }] }));
      const [r3] = await receber(ctx, push(id(4), { items: [{ product_id: prod2, quantity: 1, unidade: 'CX' }] }));
      for (const r of [r1, r2, r3]) expect(r).toMatchObject({ status: 'rejeitado', codigo: 'unidade_invalida' });
      expect((await lerPedido(id(2))).p).toBeUndefined();
    });

    it('RN-VEN-10: 30% no item que resulta em 5% efetivo no pedido fica dentro da alçada, sem aprovação; o efetivo é gravado', async () => {
      const { ctx } = comCarteira();
      // prod1 1 UN a 1000 com 30% = 700 ; prod2 1 UN a 5000 sem ajuste → tabela 6000, final 5700 → 5%
      const [r] = await receber(ctx, push(id(5), { items: [{ product_id: prod1, quantity: 1, desconto_pct: 30 }, { product_id: prod2, quantity: 1 }] }));
      expect(r).toMatchObject({ status: 'aceito' });
      const { p, it } = await lerPedido(id(5));
      expect(p).toMatchObject({ status: 'approved', nivel_aprovacao: null });
      expect(Number(p.desconto_efetivo_pct)).toBe(5);
      expect(Number(p.total_cents)).toBe(5_700);
      expect(Number(p.desconto_pct)).toBe(0);
      expect(Number(it[0].desconto_pct)).toBe(30);
    });

    it('RN-VEN-10: desconto efetivo acima da alçada vai para o supervisor mesmo vindo de itens', async () => {
      const { ctx } = comCarteira();
      const [r] = await receber(ctx, push(id(6), { items: [{ product_id: prod1, quantity: 1, desconto_pct: 20 }, { product_id: prod2, quantity: 1, desconto_pct: 5 }] }));
      expect(r).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(6))).p).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'supervisor' });
    });

    it('RN-VEN-02/10: acréscimo no item e no pedido soma ao total e nunca vai para aprovação', async () => {
      const { ctx, registro } = comCarteira();
      const [r] = await receber(ctx, push(id(7), { acrescimo_pct: 10, items: [{ product_id: prod1, quantity: 1, acrescimo_pct: 10 }, { product_id: prod2, quantity: 1 }] }));
      expect(r).toMatchObject({ status: 'aceito' });
      const { p, it } = await lerPedido(id(7));
      // item 1: 1000 × 1,10 = 1100 ; pedido ×1,10: 1210 e 5500 → 6710 ; tabela 6000
      expect(p).toMatchObject({ status: 'approved' });
      expect(Number(p.total_cents)).toBe(6_710);
      expect(Number(p.acrescimo_pct)).toBe(10);
      expect(Number(p.desconto_efetivo_pct)).toBeCloseTo(-11.83, 2);
      expect(Number(it[0].acrescimo_pct)).toBe(10);
      const ev = registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as Record<string, unknown>;
      expect(ev).toMatchObject({ acrescimo_pct: 10, acrescimo_total_cents: 710 });
    });

    it('RN-VEN-02: desconto e acréscimo juntos (no pedido ou no item) são recusados: desconto_e_acrescimo', async () => {
      const { ctx } = comCarteira();
      const [r1] = await receber(ctx, push(id(8), { discount_pct: 3, acrescimo_pct: 3, items: [{ product_id: prod1, quantity: 1 }] }));
      const [r2] = await receber(ctx, push(id(9), { items: [{ product_id: prod1, quantity: 1, desconto_pct: 3, acrescimo_pct: 3 }] }));
      for (const r of [r1, r2]) expect(r).toMatchObject({ status: 'rejeitado', codigo: 'desconto_e_acrescimo' });
    });
  });

  describe('frete CIF/FOB (RN-VEN-16) e endereço de entrega (RN-VEN-17)', () => {
    it('RN-VEN-16: sem frete no push vale o padrão do tenant (CIF) e o pedido não leva transportadora', async () => {
      const { ctx, registro } = comCarteira();
      await receber(ctx, push(id(10), { items: [{ product_id: prod1, quantity: 1 }] }));
      expect((await lerPedido(id(10))).p).toMatchObject({ frete_modalidade: 'CIF', transportadora_id: null, transportadora_digitada: false });
      expect((registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { frete: unknown }).frete).toEqual({ modalidade: 'CIF' });
    });

    it('RN-VEN-16: padrão FOB do tenant sem transportadora é recusado: transportadora_obrigatoria', async () => {
      const { ctx } = contexto(vendedor1, { carteira: new Set([A.clientes.c1]), parametros: { 'frete.modalidade_padrao': 'FOB' } });
      const [r] = await receber(ctx, push(id(11), { items: [{ product_id: prod1, quantity: 1 }] }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'transportadora_obrigatoria' });
    });

    it('RN-VEN-16: FOB com transportadora da lista grava o retrato e o evento leva a cadastrada', async () => {
      const { ctx, registro } = comCarteira();
      const [r] = await receber(ctx, push(id(12), { frete: { modalidade: 'FOB', transportadora_id: transpA }, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(r).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(12))).p).toMatchObject({ frete_modalidade: 'FOB', transportadora_id: transpA, transportadora_digitada: false, transportadora_nome: 'T0061 Rápido Norte', transportadora_documento: CNPJ_OK });
      const frete = (registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { frete: Record<string, unknown> }).frete;
      expect(frete).toMatchObject({ modalidade: 'FOB', transportadora: { tipo: 'cadastrada', id: transpA, nome: 'T0061 Rápido Norte', cnpj: CNPJ_OK } });
    });

    it('RN-VEN-16: FOB com transportadora digitada exige nome e CNPJ válido; a digitada fica só no pedido', async () => {
      const { ctx } = comCarteira();
      const digitada = { nome: 'T0061 Fluvial', cnpj: '55566677000183', telefone: '92 99999-1111' };
      const [ok] = await receber(ctx, push(id(13), { frete: { modalidade: 'FOB', transportadora_digitada: digitada }, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(ok).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(13))).p).toMatchObject({ transportadora_id: null, transportadora_digitada: true, transportadora_nome: 'T0061 Fluvial', transportadora_documento: '55566677000183', transportadora_telefone: '92 99999-1111' });
      const [ruim] = await receber(ctx, push(id(14), { frete: { modalidade: 'FOB', transportadora_digitada: { ...digitada, cnpj: '55566677000184' } }, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'transportadora_invalida' });
    });

    it('RN-VEN-16: transportadora inativa ou de outro tenant é recusada: transportadora_invalida', async () => {
      const { ctx } = comCarteira();
      const [r] = await receber(ctx, push(id(15), { frete: { modalidade: 'FOB', transportadora_id: transpInativa }, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'transportadora_invalida' });
    });

    it('RN-VEN-16: o frete não altera o total nem o desconto efetivo', async () => {
      const { ctx } = comCarteira();
      await receber(ctx, push(id(16), { items: [{ product_id: prod2, quantity: 2 }] }));
      await receber(ctx, push(id(17), { frete: { modalidade: 'FOB', transportadora_id: transpA }, items: [{ product_id: prod2, quantity: 2 }] }));
      const [cif, fob] = [(await lerPedido(id(16))).p, (await lerPedido(id(17))).p];
      expect(Number(fob.total_cents)).toBe(Number(cif.total_cents));
      expect(Number(fob.desconto_efetivo_pct)).toBe(Number(cif.desconto_efetivo_pct));
    });

    it('RN-VEN-17: sem escolha vale o endereço principal; o evento leva principal = true (não exige Conector novo)', async () => {
      const { ctx, registro } = comCarteira();
      await receber(ctx, push(id(18), { items: [{ product_id: prod1, quantity: 1 }] }));
      const { p } = await lerPedido(id(18));
      expect(p.endereco_entrega_id).toBe(END_PRINCIPAL);
      expect(p.endereco_entrega).toMatchObject({ logradouro: 'Rua Principal', cidade: 'Manaus', uf: 'AM', principal: true });
      expect((registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { endereco_entrega: unknown }).endereco_entrega).toMatchObject({ external_id: 'END-1', principal: true });
    });

    it('RN-VEN-17: o vendedor escolhe um endereço de entrega do cliente; endereço que não é do cliente é recusado', async () => {
      const { ctx, registro } = comCarteira();
      const [ok] = await receber(ctx, push(id(19), { endereco_entrega_id: END_ENTREGA, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(ok).toMatchObject({ status: 'aceito' });
      expect((await lerPedido(id(19))).p.endereco_entrega).toMatchObject({ logradouro: 'Av. do Depósito', complemento: 'Galpão 2', principal: false });
      expect((registro.eventos.find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { endereco_entrega: unknown }).endereco_entrega).toMatchObject({ principal: false });
      const [ruim] = await receber(ctx, push(id(20), { endereco_entrega_id: END_DE_OUTRO, items: [{ product_id: prod1, quantity: 1 }] }));
      expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'endereco_invalido' });
    });
  });

  describe('detalhe, pull e idempotência', () => {
    it('detalhe do pedido leva medida, desconto/acréscimo, frete, transportadora e endereço (OrderDetail)', async () => {
      const { ctx } = comCarteira();
      await receber(ctx, push(id(21), { endereco_entrega_id: END_ENTREGA, frete: { modalidade: 'FOB', transportadora_id: transpA }, items: [{ product_id: prod1, quantity: 2, unidade: 'CX', desconto_pct: 10 }] }));
      const d = OrderDetail.parse(await chamar(rotaVerPedido, ctx, { params: { id: id(21) } }));
      expect(d.items[0]).toMatchObject({ unit: 'CX', factor: 12, unit_label: 'CX c/ 12', quantity: 2, quantity_base: 24, base_quantity: 24, discount_pct: 10, unit_price_cents: 12_000, total_cents: 21_600 });
      expect(d.freight).toEqual({ modality: 'FOB', carrier_name: 'T0061 Rápido Norte', carrier_document: CNPJ_OK, carrier_phone: '92 3000-0000', carrier_typed: false });
      expect(d.delivery_address).toMatchObject({ logradouro: 'Av. do Depósito', cidade: 'Manaus', principal: false });
      expect(d.effective_discount_pct).toBe(10);
    });

    it('RN-VEN-33: reenvio do mesmo pedido novo é aceito sem duplicar; outro frete é conflito', async () => {
      const { ctx } = comCarteira();
      const item = push(id(22), { frete: { modalidade: 'FOB', transportadora_id: transpA }, items: [{ product_id: prod1, quantity: 1 }] });
      expect((await receber(ctx, item))[0]!.status).toBe('aceito');
      expect((await receber(ctx, item))[0]!.status).toBe('aceito');
      expect((await lerPedido(id(22))).it).toHaveLength(1);
      const [conf] = await receber(ctx, push(id(22), { items: [{ product_id: prod1, quantity: 1 }] }));
      expect(conf).toMatchObject({ status: 'conflito' });
    });

    it('o pull do pedido e do item leva as colunas novas e passa no schema da linha', async () => {
      const { ctx } = comCarteira();
      const [pedidos, itens] = [provedoresSyncVendedor[0]!, provedoresSyncVendedor[1]!];
      const desde = { ate: new Date(AGORA.getTime() + 60_000).toISOString(), desde: null, limite: 500 } as never;
      const lp = (await pedidos.puxar!(contexto(vendedor1, { carteira: 'tenant' }).ctx, desde)) as unknown as Array<Record<string, unknown>>;
      const linha = lp.find((l) => l.id === id(21))!;
      expect(entidadePedido.schemaLinha!.parse(linha)).toMatchObject({ frete_modalidade: 'FOB', transportadora_nome: 'T0061 Rápido Norte' });
      const li = (await itens.puxar!(ctx, desde)) as unknown as Array<Record<string, unknown>>;
      const item = li.find((l) => l.pedido_id === id(21))!;
      expect(item).toMatchObject({ fator: 12, quantidade_base: 24, unidade: 'CX' });
    });
  });

  describe('promotor nunca cria pedido (regra 7) e transportadoras (BKO, multi-tenant)', () => {
    it('RN-PRO-01: o push de pedido do promotor é recusado (403) mesmo com os campos novos', async () => {
      const { ctx } = contexto(promotor, { carteira: new Set([A.clientes.c1]) });
      const [r] = await receber(ctx, push(id(23), { frete: { modalidade: 'CIF' }, items: [{ product_id: prod1, quantity: 1, unidade: 'CX' }] }));
      expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RN-PRO-01' });
      expect((await lerPedido(id(23))).p).toBeUndefined();
    });

    it('CRUD: gerente cadastra, edita, inativa e lista; CNPJ inválido e duplicado são recusados; tudo auditado', async () => {
      const { ctx, registro } = contexto(gerente);
      const nova = (await chamar(rotaCriarTransportadora, ctx, { corpo: { nome: 'T0061 Nova Rota', documento: '98765432000198', telefone: '92 3111-2222' } })) as { id: string; nome: string; ativo: boolean };
      expect(nova).toMatchObject({ nome: 'T0061 Nova Rota', ativo: true });
      await expect(chamar(rotaCriarTransportadora, ctx, { corpo: { nome: 'T0061 Outra', documento: '98765432000198' } })).rejects.toMatchObject({ codigo: 'TRANSPORTADORA_DUPLICADA' });
      await expect(chamar(rotaCriarTransportadora, ctx, { corpo: { nome: 'T0061 Ruim', documento: '98765432000199' } })).rejects.toMatchObject({ codigo: 'CNPJ_INVALIDO' });
      const edit = (await chamar(rotaAtualizarTransportadora, ctx, { params: { id: nova.id }, corpo: { telefone: '92 3999-0000', ativo: false } })) as { telefone: string; ativo: boolean };
      expect(edit).toMatchObject({ telefone: '92 3999-0000', ativo: false });
      const ativas = (await chamar(rotaListarTransportadoras, ctx, { query: { ativas: '1' } })) as { itens: Array<{ id: string }> };
      expect(ativas.itens.map((t) => t.id)).not.toContain(nova.id);
      expect(ativas.itens.map((t) => t.id)).toContain(transpA);
      const busca = (await chamar(rotaListarTransportadoras, ctx, { query: { q: 'Nova Rota' } })) as { itens: Array<{ id: string }> };
      expect(busca.itens.map((t) => t.id)).toEqual([nova.id]);
      expect(registro.auditoria.map((a) => a.acao)).toEqual(['transportadora.criar', 'transportadora.inativar']);
    });

    it('multi-tenant: o gerente do outro tenant não vê nem edita a transportadora (RLS) e o sync só leva a do tenant', async () => {
      const { ctx } = contexto(gerenteB);
      const lista = (await chamar(rotaListarTransportadoras, ctx, { query: {} })) as { itens: Array<{ id: string }> };
      expect(lista.itens.map((t) => t.id)).not.toContain(transpA);
      await expect(chamar(rotaAtualizarTransportadora, ctx, { params: { id: transpA }, corpo: { ativo: false } })).rejects.toMatchObject({ status: 404 });
      const sync = provedoresSyncVendedor.find((s) => s.entidade.nome === 'transportadora')!;
      const linhasA = (await sync.puxar!(contexto(vendedor1).ctx, { ate: new Date(AGORA.getTime() + 60_000).toISOString(), desde: null, limite: 500 } as never)) as unknown as Array<Record<string, unknown>>;
      expect(linhasA.map((l) => l.id)).toContain(transpA);
      for (const l of linhasA) TransportadoraSyncSchema.parse(l);
      const linhasB = (await sync.puxar!(ctx, { ate: new Date(AGORA.getTime() + 60_000).toISOString(), desde: null, limite: 500 } as never)) as unknown as Array<Record<string, unknown>>;
      expect(linhasB.map((l) => l.id)).not.toContain(transpA);
    });

    it('as digitadas nos pedidos aparecem para o BKO cadastrar; a cadastrada some da lista', async () => {
      const { ctx } = contexto(gerente);
      const r = (await chamar(rotaTransportadorasDigitadas, ctx)) as { itens: Array<{ documento: string; nome: string }> };
      expect(r.itens.map((i) => i.documento)).toContain('55566677000183');
      expect(r.itens.map((i) => i.documento)).not.toContain(CNPJ_OK);
    });

    it('RN-VEN-16: padrão do frete do tenant: lê CIF por omissão e FOB quando o parâmetro do tenant manda', async () => {
      expect(await chamar(rotaLerFreteParametros, contexto(gerente).ctx)).toEqual({ modalidade_padrao: 'CIF' });
      expect(await chamar(rotaLerFreteParametros, contexto(gerente, { parametros: { 'frete.modalidade_padrao': 'FOB' } }).ctx)).toEqual({ modalidade_padrao: 'FOB' });
      expect(await chamar(rotaLerFreteParametros, contexto(gerente, { parametros: { 'frete.modalidade_padrao': 'qualquer' } }).ctx)).toEqual({ modalidade_padrao: 'CIF' });
    });
  });
});
