/**
 * Quantidade fracionária do pedido × Postgres real (ADR 0076, RN-VEN-02 v3): total 1999 × 1,250 = 2499, `criado@2` com decimal e
 * `criado@1` só sem fração, trava fechada = 422 `quantidade_fracionaria_bloqueada`, fração fora de KG/M = `..._invalida`, pull
 * filtrado por versão do app. O cadastro e o preço do Core/Catálogo são simulados (sem SQL em schema de outro módulo).
 * Precisa da migração 0107 (numeric(14,4)). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { comTenant, dadosDoisTenants, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { criarPortaVersaoAppMemoria, valorCabecalhoApp, type ClienteBanco, type ContextoBase, type DefinicaoEvento, type ItemPush, type PortaVersaoApp, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PedidoItemSyncSchema } from '../contracts';
import { entidadePedido } from '../contracts/entidades';
import { responderFiliais } from './filial-simulada';
import { rotaVerPedido } from './pedidos';
import { provedoresSyncVendedor } from './sync';

const A = DOIS_TENANTS.A;
const id = (n: number) => `0f2a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = Array.from({ length: 12 }, (_, i) => id(i + 1));
const CADASTRO = (() => {
  const d = dadosDoisTenants('hash-de-teste');
  return { cliente: d['core.cliente']!, produto: d['core.produto']!, usuario: d['core.usuario']! };
})();
const vendedor1: UsuarioAutenticado = { id: A.usuarios.vendedor1, tenant_id: A.tenantId, perfil: 'vendedor' };
let AGORA!: Date;

/** Campo e Gestão 1.0.36 publicados há 25 h: a trava está aberta. */
const ABERTA = (agora: Date) => {
  const em = new Date(agora.getTime() - 25 * 3_600_000).toISOString();
  return { campo: { versao: '1.0.36', publicada_em: em }, gestao: { versao: '1.0.36', publicada_em: em } };
};
/** Publicados há 1 h: a trava segue fechada (24 h de convivência). */
const FECHADA = (agora: Date) => {
  const em = new Date(agora.getTime() - 3_600_000).toISOString();
  return { campo: { versao: '1.0.36', publicada_em: em }, gestao: { versao: '1.0.36', publicada_em: em } };
};

describe.skipIf(semBanco())('Vendedor × Postgres: quantidade fracionária (ADR 0076)', () => {
  let pool: pg.Pool;
  let prod = '';
  const eventos: Array<{ nome: string; payload: Record<string, unknown> }> = [];

  function contexto(o: { unidade: string; versao: PortaVersaoApp | undefined }) {
    const base = {
      usuario: { ...vendedor1, modulos: ['core', 'catalogo', 'vendedor'] },
      requestId: 'r-teste',
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      carteira: async () => new Set([A.clientes.c1]),
      usuariosVisiveis: async () => new Set([vendedor1.id]),
      parametros: () => ({}),
      log: { info() {}, warn() {}, error() {} },
      ...(o.versao ? { versaoApp: o.versao } : {}),
      comTenant: <T>(fn: (db: ClienteBanco, tx: unknown) => Promise<T>) =>
        comTenant(pool, A.tenantId, (c) => {
          const tx = {
            async consultar(def: { nome: string }, entrada: Record<string, unknown>) {
              if (def.nome === CONSULTA_FILIAIS.nome) return responderFiliais(entrada);
              if (def.nome === CONSULTA_CADASTRO_RESUMO.nome) {
                const ent = CONSULTA_CADASTRO_RESUMO.entrada.parse(entrada);
                const pegar = (tabela: 'cliente' | 'produto' | 'usuario', ids: string[], campos: string[]) =>
                  CADASTRO[tabela].filter((l) => ids.includes(l.id as string)).map((l) => Object.fromEntries(campos.map((k) => [k, k === 'unidade' ? o.unidade : (l[k] ?? null)])));
                return CONSULTA_CADASTRO_RESUMO.saida.parse({
                  clientes: pegar('cliente', ent.cliente_ids, ['id', 'razao_social', 'nome_fantasia', 'documento', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'ativo', 'external_id']),
                  produtos: pegar('produto', ent.produto_ids, ['id', 'sku', 'nome', 'unidade', 'ativo', 'external_id']),
                  usuarios: pegar('usuario', ent.usuario_ids, ['id', 'nome', 'perfil', 'external_id']),
                });
              }
              if (def.nome === CONSULTA_PRECOS_CLIENTE.nome) {
                const ent = CONSULTA_PRECOS_CLIENTE.entrada.parse(entrada);
                return { tabela_preco_id: id(11), itens: ent.produto_ids.map((p) => ({ produto_id: p, preco_cents: 1999, motivo_sem_preco: null })) };
              }
              if (def.nome === 'integracao.cancelamento_erp@1') return { aceita: false };
              if (def.nome === 'catalogo.estoque_filial@1') return { itens: [] };
              if (def.nome === 'core.financeiro_cliente@1') return { financeiro: null };
              throw new Error(`consulta não simulada: ${def.nome}`);
            },
            async publicar(def: DefinicaoEvento, payload: unknown) {
              eventos.push({ nome: def.nome, payload: def.schema.parse(payload) as Record<string, unknown> }); // o contrato do evento vale aqui
              return {};
            },
            async auditar() {},
            async registrarArquivo() {
              throw new Error('não usado');
            },
          };
          return fn(c as unknown as ClienteBanco, tx);
        }),
    };
    return base as unknown as ContextoBase;
  }

  const receber = (c: ContextoBase, ...itens: ItemPush[]) => provedoresSyncVendedor[0]!.receber!(c, itens);
  const push = (idPedido: string, quantity: number): ItemPush =>
    ({ entidade: 'pedido', id: idPedido, operacao: 'upsert', payload: entidadePedido.schema.parse({ id: idPedido, customer_id: A.clientes.c1, discount_pct: 0, items: [{ product_id: prod, quantity }] }) }) as unknown as ItemPush;
  const lerItem = (pedidoId: string) =>
    comTenant(pool, A.tenantId, async (c) => (await c.query('select quantidade, quantidade_base, fator, total_cents from vendedor.pedido_item where pedido_id = $1', [pedidoId])).rows[0]);
  const pedidoPull = () => ({ desde: null, ate: new Date(AGORA.getTime() + 3_600_000).toISOString(), limite: 1000 });

  async function limpar() {
    const admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
    try {
      await admin.query('delete from vendedor.pedido_aprovacao where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [IDS]);
      await admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [IDS]);
    } finally {
      await admin.end();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    AGORA = new Date((await pool.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora); // hora-fixa-ok: linha do tempo única do arquivo
    await limpar();
    prod = CADASTRO.produto.find((x) => x.sku === 'ALFA-001' && x.tenant_id === A.tenantId)!.id as string;
  });
  afterAll(async () => {
    await limpar();
    await pool?.end();
  });

  it('RN-VEN-02 v3: trava fechada recusa a fração com 422 quantidade_fracionaria_bloqueada e não grava nada', async () => {
    for (const versao of [undefined, criarPortaVersaoAppMemoria(FECHADA(AGORA))]) {
      const [r] = await receber(contexto({ unidade: 'KG', versao }), push(id(1), 1.25));
      expect(r).toMatchObject({ id: id(1), status: 'rejeitado', codigo: 'quantidade_fracionaria_bloqueada' });
    }
    expect(await lerItem(id(1))).toBeUndefined();
  });

  it('RN-VEN-02 v3: trava fechada ainda aceita a quantidade inteira, em KG também', async () => {
    const [r] = await receber(contexto({ unidade: 'KG', versao: criarPortaVersaoAppMemoria(FECHADA(AGORA)) }), push(id(2), 2));
    expect(r).toMatchObject({ id: id(2), status: 'aceito' });
    expect(Number((await lerItem(id(2)))!.quantidade)).toBe(2);
  });

  it('RN-VEN-02 v3: trava aberta, 1999 × 1,250 kg = 2499; criado@2 leva a quantidade decimal e o criado@1 não sai', async () => {
    eventos.length = 0;
    const [r] = await receber(contexto({ unidade: 'KG', versao: criarPortaVersaoAppMemoria(ABERTA(AGORA)) }), push(id(3), 1.25));
    expect(r).toMatchObject({ id: id(3), status: 'aceito' });
    const item = (await lerItem(id(3)))!;
    expect(Number(item.quantidade)).toBe(1.25);
    expect(Number(item.quantidade_base)).toBe(1.25);
    expect(Number(item.total_cents)).toBe(2499);
    const nomes = eventos.map((e) => e.nome);
    expect(nomes).toContain('vendedor.pedido.criado@2');
    expect(nomes).not.toContain('vendedor.pedido.criado@1');
    expect(eventos.find((e) => e.nome === 'vendedor.pedido.criado@2')!.payload).toMatchObject({ itens: [{ produto_id: prod, quantidade: 1.25, total_cents: 2499 }] });
  });

  it('RN-VEN-02 v3: pedido inteiro publica o criado@2 e o criado@1 em paralelo', async () => {
    eventos.length = 0;
    await receber(contexto({ unidade: 'KG', versao: criarPortaVersaoAppMemoria(ABERTA(AGORA)) }), push(id(4), 3));
    expect(eventos.map((e) => e.nome).filter((n) => n.startsWith('vendedor.pedido.criado'))).toEqual(['vendedor.pedido.criado@2', 'vendedor.pedido.criado@1']);
  });

  it('RN-VEN-02 v3: fração fora de KG e M é quantidade_fracionaria_invalida, mesmo com a trava aberta', async () => {
    const [r] = await receber(contexto({ unidade: 'PC', versao: criarPortaVersaoAppMemoria(ABERTA(AGORA)) }), push(id(5), 1.5));
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'quantidade_fracionaria_invalida' });
    expect(await lerItem(id(5))).toBeUndefined();
  });

  it('ADR 0076 D6: o pull não entrega o pedido fracionário a app sem cabeçalho ou abaixo da 1.0.36; a 1.0.36 recebe, com número', async () => {
    const pull = (nome: string, doCliente: { variante: 'campo' | 'gestao'; versao: string } | null) =>
      provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!.puxar!(contexto({ unidade: 'KG', versao: criarPortaVersaoAppMemoria({}, doCliente) }), pedidoPull());
    const doPedido = (linhas: Array<{ id: string }>, pid: string) => linhas.filter((l) => (l as unknown as { pedido_id?: string }).pedido_id === pid || l.id === pid);
    for (const cliente of [null, { variante: 'campo' as const, versao: '1.0.35' }]) {
      expect(doPedido(await pull('pedido', cliente), id(3))).toHaveLength(0);
      expect(doPedido(await pull('pedido_item', cliente), id(3))).toHaveLength(0);
      expect(doPedido(await pull('pedido', cliente), id(4))).toHaveLength(1); // o inteiro segue chegando
    }
    const novo = { variante: 'campo' as const, versao: '1.0.36' };
    expect(valorCabecalhoApp(novo.variante, novo.versao)).toBeTruthy();
    expect(doPedido(await pull('pedido', novo), id(3))).toHaveLength(1);
    const itens = doPedido(await pull('pedido_item', novo), id(3));
    expect(itens).toHaveLength(1);
    expect(PedidoItemSyncSchema.parse(itens[0])).toMatchObject({ quantidade: 1.25, quantidade_base: 1.25, fator: 1, quantidade_faturada: 0 });
  });

  it('RN-VEN-02 v3: o detalhe lê a quantidade como número (quantidadeDoBanco), não como texto', async () => {
    const d = (await rotaVerPedido.executar({ ...(contexto({ unidade: 'KG', versao: criarPortaVersaoAppMemoria(ABERTA(AGORA)) }) as object), params: { id: id(3) }, corpo: {}, query: {} } as never)) as {
      items: Array<{ quantity: number; quantity_base?: number; total_cents: number }>;
      units: number;
    };
    expect(d.items[0]).toMatchObject({ quantity: 1.25, total_cents: 2499 });
    expect(d.units).toBe(1.25);
  });
});
