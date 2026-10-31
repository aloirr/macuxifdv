/**
 * Integração com PostgreSQL real: um "ERP de exemplo" (banco efêmero criado e dropado pelo próprio teste) lido pelo Conector
 * até um Hub falso. Conexão: MACUXI_PG_HOST/MACUXI_PG_PORTA/MACUXI_PG_ADMIN_USUARIO/MACUXI_PG_ADMIN_SENHA
 * (padrões localhost/5432/postgres/postgres). Sem Postgres o teste PULA com aviso; com MACUXI_PG_EXIGIR=1 (CI) FALHA.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Armazenamento } from '../src/armazenamento/armazenamento';
import { executarCli } from '../src/comandos';
import { ConfigConector } from '../src/config/esquema';
import type { Contexto } from '../src/contexto';
import { criarConexaoPostgres } from '../src/erp/postgres';
import { ClienteHub } from '../src/hub/cliente';
import { criarLogger } from '../src/log/logger';
import { cicloPedidos } from '../src/pedidos';
import { reconciliarEntidade } from '../src/reconciliacao';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { relogioReal } from '../src/util/relogio';
import { HubFalso } from './suporte/hub-falso';

const cfgPg = {
  host: process.env.MACUXI_PG_HOST ?? 'localhost',
  port: Number(process.env.MACUXI_PG_PORTA ?? 5432),
  user: process.env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  password: process.env.MACUXI_PG_ADMIN_SENHA ?? 'postgres',
};

async function postgresDisponivel(): Promise<string | null> {
  const c = new pg.Client({ ...cfgPg, database: 'postgres', connectionTimeoutMillis: 2000 });
  try {
    await c.connect();
    return null;
  } catch (e) {
    const err = e instanceof AggregateError ? (e.errors[0] as Error) : (e as Error);
    return err.message || String(e);
  } finally {
    await c.end().catch(() => undefined);
  }
}

const motivoSemPg = await postgresDisponivel();
const exigir = process.env.MACUXI_PG_EXIGIR === '1';
if (motivoSemPg) {
  console.warn(`\n[conector] PostgreSQL indisponível (${motivoSemPg}): testes de integração com o ERP de exemplo pulados. Defina MACUXI_PG_EXIGIR=1 para falhar.\n`);
}

if (motivoSemPg && exigir) {
  describe('integração com PostgreSQL (exigida)', () => {
    it('MACUXI_PG_EXIGIR=1: o PostgreSQL precisa estar acessível', () => {
      throw new Error(`PostgreSQL indisponível (${motivoSemPg}) e MACUXI_PG_EXIGIR=1`);
    });
  });
}

const SCHEMA_ERP = `
CREATE TABLE erp_vendedor(codigo text PRIMARY KEY, nome text NOT NULL, alterado_em timestamp NOT NULL DEFAULT (now() at time zone 'utc'), ativo boolean NOT NULL DEFAULT true);
CREATE TABLE erp_cliente(codigo text PRIMARY KEY, razao text, bloqueado boolean NOT NULL DEFAULT false, limite numeric(12,2), uf text, vendedor text,
  alterado_em timestamp NOT NULL DEFAULT (now() at time zone 'utc'), ativo boolean NOT NULL DEFAULT true);
CREATE TABLE erp_produto(codigo text PRIMARY KEY, sku text NOT NULL, nome text NOT NULL, unidade text NOT NULL, alterado_em timestamptz NOT NULL DEFAULT now(), ativo boolean NOT NULL DEFAULT true);
CREATE TABLE erp_preco(chave text PRIMARY KEY, tabela text NOT NULL, produto text NOT NULL, vigencia_inicio date NOT NULL, preco numeric(12,2) NOT NULL,
  alterado_em timestamptz NOT NULL DEFAULT now(), ativo boolean NOT NULL DEFAULT true);
CREATE TABLE erp_estoque(chave text PRIMARY KEY, deposito text NOT NULL, produto text NOT NULL, saldo numeric(14,3) NOT NULL, alterado_em timestamptz NOT NULL DEFAULT now(), ativo boolean NOT NULL DEFAULT true);
CREATE TABLE erp_pedido_entrada(numero serial PRIMARY KEY, pedido_uuid uuid UNIQUE NOT NULL, cliente text, total_cents bigint, status char(1) NOT NULL DEFAULT 'I', motivo text, atualizado_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE erp_pedido_item(pedido_uuid uuid NOT NULL, sequencia int NOT NULL, produto text NOT NULL, quantidade numeric NOT NULL, PRIMARY KEY (pedido_uuid, sequencia));
CREATE TABLE erp_nota(numero text PRIMARY KEY, serie text, pedido_uuid uuid NOT NULL, emitida_em timestamptz NOT NULL, total_cents bigint NOT NULL);
CREATE TABLE erp_nota_item(nota text NOT NULL, sequencia int NOT NULL, quantidade numeric NOT NULL, produto text NOT NULL, valor_cents bigint NOT NULL);
`;

const paginar = (cols: string, tabela: string, id: string) =>
  `SELECT ${cols} FROM ${tabela} WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND ${id} > :cursor_external_id) ORDER BY alterado_em, ${id} LIMIT :limite`;

describe.skipIf(motivoSemPg !== null)('Conector × ERP PostgreSQL de exemplo × Hub falso', () => {
  const nomeBanco = `macuxi_conector_teste_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
  let erp: ReturnType<typeof criarConexaoPostgres>;
  let admin: pg.Client;
  let hub: HubFalso;
  let dir: string;
  let ctx: Contexto;
  let cfg: ConfigConector;

  beforeAll(async () => {
    const root = new pg.Client({ ...cfgPg, database: 'postgres' });
    await root.connect();
    await root.query(`CREATE DATABASE ${nomeBanco}`);
    await root.end();
    admin = new pg.Client({ ...cfgPg, database: nomeBanco });
    await admin.connect();
    await admin.query(SCHEMA_ERP);

    hub = await HubFalso.iniciar();
    hub.conectorIdEsperado = 'cnx-pg-teste'; // chave por Conector (T-0023): o Hub confere o identificador
    dir = mkdtempSync(join(tmpdir(), 'conector-pg-'));
    erp = criarConexaoPostgres({ host: cfgPg.host, porta: cfgPg.port, banco: nomeBanco, usuario: cfgPg.user, senha: cfgPg.password, ssl: false });
    cfg = ConfigConector.parse({
      dadosDir: dir,
      hub: { url: hub.url, conectorId: 'cnx-pg-teste', retry: { tentativas: 2, baseMs: 1, maxMs: 2 } },
      erp: { tipo: 'postgres', host: cfgPg.host, porta: cfgPg.port, banco: nomeBanco, usuario: cfgPg.user, criptografar: false },
      lote: { maxLinhas: 5 },
      fila: { backoffBaseSegundos: 1, backoffMaxSegundos: 2, consultaResultadoSegundos: 1 },
      margemDeltaSegundos: 0,
      entidades: {
        vendedor: {
          consulta: paginar('codigo AS external_id, alterado_em, ativo, nome', 'erp_vendedor', 'codigo'),
          campos: { external_id: 'external_id', alterado_em: 'alterado_em', ativo: 'ativo', nome: 'nome' },
        },
        produto: {
          consulta: paginar('codigo AS external_id, alterado_em, ativo, sku, nome, unidade', 'erp_produto', 'codigo'),
          campos: { external_id: 'external_id', alterado_em: 'alterado_em', ativo: 'ativo', sku: 'sku', nome: 'nome', unidade: 'unidade' },
          reconciliacao: { consulta: 'SELECT COUNT(*) AS contagem, NULL AS soma FROM erp_produto WHERE ativo' },
        },
        cliente: {
          consulta: paginar('codigo AS external_id, alterado_em, ativo, razao, bloqueado, limite, uf, vendedor', 'erp_cliente', 'codigo'),
          campos: {
            external_id: 'external_id', alterado_em: 'alterado_em', ativo: 'ativo', razao_social: 'razao', bloqueado: 'bloqueado',
            limite_credito_cents: { coluna: 'limite', transformar: 'centavos_de_decimal' }, 'endereco.uf': 'uf', vendedor_external_id: 'vendedor',
          },
        },
        preco: {
          consulta: paginar('chave AS external_id, alterado_em, ativo, tabela, produto, vigencia_inicio, preco', 'erp_preco', 'chave'),
          campos: {
            external_id: 'external_id', alterado_em: 'alterado_em', ativo: 'ativo', tabela_external_id: 'tabela', tabela_nome: 'tabela',
            vigencia_inicio: { coluna: 'vigencia_inicio', transformar: 'data_civil' }, produto_external_id: 'produto', preco_cents: { coluna: 'preco', transformar: 'centavos_de_decimal' },
          },
          reconciliacao: { consulta: 'SELECT COUNT(*) AS contagem, SUM(ROUND(preco * 100)) AS soma FROM erp_preco WHERE ativo' },
        },
        estoque: {
          consulta: paginar('chave AS external_id, alterado_em, ativo, deposito, produto, saldo', 'erp_estoque', 'chave'),
          campos: { external_id: 'external_id', alterado_em: 'alterado_em', ativo: 'ativo', deposito_external_id: 'deposito', produto_external_id: 'produto', saldo: { coluna: 'saldo', transformar: 'numero' } },
        },
      },
      pedidos: {
        gravacao: {
          cabecalho: 'INSERT INTO erp_pedido_entrada(pedido_uuid, cliente, total_cents) VALUES (:pedido_uuid::uuid, :cliente_external_id, :total_cents) ON CONFLICT (pedido_uuid) DO NOTHING',
          itens: 'INSERT INTO erp_pedido_item(pedido_uuid, sequencia, produto, quantidade) VALUES (:pedido_uuid::uuid, :sequencia, :produto_external_id, :quantidade) ON CONFLICT DO NOTHING',
          numeroErp: 'SELECT numero AS numero_erp FROM erp_pedido_entrada WHERE pedido_uuid = :pedido_uuid::uuid',
        },
        status: {
          consulta: `SELECT p.status, p.numero AS numero_erp, p.motivo, n.numero AS nota_numero, n.serie AS nota_serie, n.emitida_em AS nota_emitida_em,
                     n.total_cents AS nota_total_cents, COALESCE(n.emitida_em, p.atualizado_em) AS ocorrido_em
                     FROM erp_pedido_entrada p LEFT JOIN erp_nota n ON n.pedido_uuid = p.pedido_uuid WHERE p.pedido_uuid = :pedido_uuid::uuid ORDER BY n.emitida_em`,
          consultaItensNota: 'SELECT sequencia, quantidade, valor_cents, produto AS produto_external_id FROM erp_nota_item WHERE nota = :nota_numero ORDER BY sequencia',
          mapaStatus: { I: 'integrado', P: 'faturado_parcial', F: 'faturado_total', C: 'cancelado' },
        },
      },
    });
    ctx = {
      config: cfg,
      erp,
      hub: new ClienteHub({ url: hub.url, token: async () => hub.token, conectorId: cfg.hub.conectorId, retry: { tentativas: 2, baseMs: 1, maxMs: 2 } }),
      store: Armazenamento.abrir(join(dir, 'fila.sqlite')),
      log: criarLogger({ nivel: 'debug', escrever: () => undefined }),
      relogio: relogioReal,
      uuid: () => crypto.randomUUID(),
      aleatorio: Math.random,
    };
  });

  afterAll(async () => {
    ctx?.store.fechar();
    await erp?.fechar();
    await hub?.parar();
    await admin?.end().catch(() => undefined);
    const root = new pg.Client({ ...cfgPg, database: 'postgres' });
    await root.connect();
    await root.query(`DROP DATABASE IF EXISTS ${nomeBanco} WITH (FORCE)`);
    await root.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const rodar = async (e: 'vendedor' | 'produto' | 'cliente' | 'preco' | 'estoque') => {
    await sincronizarEntidade(ctx, e);
    for (let i = 0; i < 6; i++) {
      await processarFila(ctx);
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  it('carga inicial completa (em partes) lê o ERP, converte tipos e entrega ao Hub na ordem de dependência', async () => {
    await admin.query(`INSERT INTO erp_vendedor(codigo, nome, alterado_em) VALUES ('V1', 'Vendedora Um', '2026-03-01 10:00:00'), ('V2', 'Vendedor Dois', '2026-03-01 10:00:01')`);
    for (let i = 1; i <= 12; i++) {
      await admin.query(
        `INSERT INTO erp_cliente(codigo, razao, limite, uf, vendedor, alterado_em) VALUES ($1, $2, $3, 'RR', 'V1', $4)`,
        [`C${String(i).padStart(2, '0')}`, `Mercadinho ${i}`, i * 1000.5, `2026-03-01 10:00:${String(i).padStart(2, '0')}.${i}00`],
      );
    }
    await admin.query(`INSERT INTO erp_produto(codigo, sku, nome, unidade, alterado_em) VALUES ('P1', 'SKU1', 'Arroz 5kg', 'UN', '2026-03-01T10:00:00Z'), ('P2', 'SKU2', 'Feijão 1kg', 'UN', '2026-03-01T10:00:01Z')`);
    await admin.query(`INSERT INTO erp_preco(chave, tabela, produto, vigencia_inicio, preco, alterado_em) VALUES ('T1:P1', 'T1', 'P1', '2026-01-01', 25.90, '2026-03-01T10:00:00Z'), ('T1:P2', 'T1', 'P2', '2026-01-01', 8.5, '2026-03-01T10:00:01Z')`);
    await admin.query(`INSERT INTO erp_estoque(chave, deposito, produto, saldo, alterado_em) VALUES ('D1:P1', 'D1', 'P1', 120.5, '2026-03-01T10:00:00Z')`);

    for (const e of ['vendedor', 'produto', 'cliente', 'preco', 'estoque'] as const) await rodar(e);

    const clientes = hub.envelopes.filter((e) => e.entidade === 'cliente');
    expect(clientes.map((e) => [e.modo, e.sessao?.parte, e.sessao?.ultimo, e.registros.length])).toEqual([
      ['completo', 1, false, 5], ['completo', 2, false, 5], ['completo', 3, true, 2],
    ]);
    expect(hub.linhasDe('cliente')).toHaveLength(12);
    expect(hub.envelopes.every((e) => e.conector_id === 'cnx-pg-teste' && typeof e.versao_conector === 'string' && e.versao_conector.length > 0)).toBe(true);
    expect(hub.chamadas.every((c) => c.conectorId === 'cnx-pg-teste')).toBe(true);
    const c3 = hub.registros.get('cliente')?.get('C03');
    expect(c3).toMatchObject({ razao_social: 'Mercadinho 3', limite_credito_cents: 300150, bloqueado: false, endereco: { uf: 'RR' }, vendedor_external_id: 'V1', ativo: true });
    expect(c3?.alterado_em).toBe('2026-03-01T10:00:03.300Z'); // timestamp sem fuso lido como UTC, em milissegundos
    expect(hub.registros.get('preco')?.get('T1:P1')).toMatchObject({ preco_cents: 2590, vigencia_inicio: '2026-01-01', produto_external_id: 'P1' });
    expect(hub.registros.get('estoque')?.get('D1:P1')).toMatchObject({ saldo: 120.5 });
    expect(hub.linhasDe('produto')).toHaveLength(2);
    // ordem de dependência respeitada pelo teste; o Hub falso não recusou nada
    expect(ctx.store.errosRecentes(null)).toEqual([]);
    expect(ctx.store.estado('cliente')?.fase).toBe('delta');
  });

  it('delta: só o que mudou no ERP (alterado, novo e desativado) é enviado', async () => {
    hub.envelopes.length = 0;
    await admin.query(`UPDATE erp_cliente SET razao = 'Mercadinho Renomeado', alterado_em = now() at time zone 'utc' WHERE codigo = 'C05'`);
    await admin.query(`INSERT INTO erp_cliente(codigo, razao, uf, vendedor) VALUES ('C99', 'Novo Cliente', 'RR', 'V2')`);
    await admin.query(`UPDATE erp_cliente SET ativo = false, alterado_em = now() at time zone 'utc' + interval '1 second' WHERE codigo = 'C01'`);
    await rodar('cliente');
    expect(hub.envelopes).toHaveLength(1);
    const env = hub.envelopes[0];
    expect(env?.modo).toBe('delta');
    expect((env?.registros as { external_id: string }[]).map((r) => r.external_id).sort()).toEqual(['C01', 'C05', 'C99']);
    expect(hub.registros.get('cliente')?.get('C01')).toMatchObject({ ativo: false });
    expect(hub.registros.get('cliente')?.get('C05')).toMatchObject({ razao_social: 'Mercadinho Renomeado' });

    // sem mudança nenhuma: nada novo
    hub.envelopes.length = 0;
    await rodar('cliente');
    expect(hub.envelopes).toHaveLength(0);
  });

  it('empate de alterado_em entre muitas linhas não perde nem repete linhas (cursor composto com external_id)', async () => {
    hub.envelopes.length = 0;
    await admin.query(`INSERT INTO erp_estoque(chave, deposito, produto, saldo, alterado_em) SELECT 'D2:P' || g, 'D2', 'P1', g, '2026-04-01T00:00:00Z' FROM generate_series(1, 12) g`);
    await rodar('estoque');
    const ids = hub.envelopes.flatMap((e) => (e.registros as { external_id: string }[]).map((r) => r.external_id));
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    expect(hub.envelopes.map((e) => e.registros.length)).toEqual([5, 5, 2]);
  });

  it('retorno de pedidos: grava no ERP por SQL, confirma o número, acompanha as notas e o cancelamento', async () => {
    const uuid = '0b0f1a52-7d71-4c0b-9c1e-3a6f4e5d6c7b';
    hub.pedidosParaEntregar = [
      PedidoParaErp.parse({
        versao_contrato: 'v1', pedido_uuid: uuid, cliente_external_id: 'C02', vendedor_external_id: 'V1', criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 3000,
        itens: [
          { sequencia: 1, produto_external_id: 'P1', quantidade: 2, preco_unitario_cents: 1000, total_cents: 2000 },
          { sequencia: 2, produto_external_id: 'P2', quantidade: 1, preco_unitario_cents: 1000, total_cents: 1000 },
        ],
      }),
    ];
    let r = await cicloPedidos(ctx);
    expect(r).toMatchObject({ recebidos: 1, gravados: 1, retornosEnviados: 1 });
    const linha = (await admin.query('SELECT numero, cliente, total_cents FROM erp_pedido_entrada WHERE pedido_uuid = $1', [uuid])).rows[0];
    expect(linha).toMatchObject({ cliente: 'C02', total_cents: '3000' });
    expect((await admin.query('SELECT count(*)::int AS n FROM erp_pedido_item WHERE pedido_uuid = $1', [uuid])).rows[0].n).toBe(2);
    expect(hub.retornos[0]).toMatchObject({ pedido_uuid: uuid, status: 'integrado', numero_erp: String(linha.numero) });

    // reentrega pelo Hub (timeout): não grava de novo
    hub.pedidosParaEntregar = [PedidoParaErp.parse({ ...(hub.pedidosParaEntregar[0] as object), tentativa: 2 })];
    await cicloPedidos(ctx);
    expect((await admin.query('SELECT count(*)::int AS n FROM erp_pedido_entrada WHERE pedido_uuid = $1', [uuid])).rows[0].n).toBe(1);
    expect(hub.retornos).toHaveLength(1);

    // faturamento parcial (nota 1) e depois total (nota 2)
    await admin.query(`UPDATE erp_pedido_entrada SET status = 'P' WHERE pedido_uuid = $1`, [uuid]);
    await admin.query(`INSERT INTO erp_nota VALUES ('NF501', '1', $1, '2026-03-11T10:00:00Z', 2000)`, [uuid]);
    await admin.query(`INSERT INTO erp_nota_item VALUES ('NF501', 1, 2, 'P1', 2000)`);
    await cicloPedidos(ctx);
    await admin.query(`UPDATE erp_pedido_entrada SET status = 'F' WHERE pedido_uuid = $1`, [uuid]);
    await admin.query(`INSERT INTO erp_nota VALUES ('NF502', '1', $1, '2026-03-12T10:00:00Z', 1000)`, [uuid]);
    await admin.query(`INSERT INTO erp_nota_item VALUES ('NF502', 2, 1, 'P2', 1000)`);
    await cicloPedidos(ctx);
    r = await cicloPedidos(ctx);
    expect(r.retornosEnfileirados).toBe(0);
    const sequencia = hub.retornos.map((x) => x as { status: string; nota?: { numero: string }; itens_faturados?: unknown });
    expect(sequencia.map((x) => [x.status, x.nota?.numero])).toEqual([['integrado', undefined], ['faturado_parcial', 'NF501'], ['faturado_total', 'NF502']]);
    expect(sequencia[1]?.itens_faturados).toEqual([{ sequencia: 1, produto_external_id: 'P1', quantidade: 2, valor_cents: 2000 }]);
    expect(sequencia[2]?.itens_faturados).toEqual([{ sequencia: 2, produto_external_id: 'P2', quantidade: 1, valor_cents: 1000 }]);
  });

  it('pedido que o ERP recusa (violação de restrição) volta como rejeitado_erp depois das tentativas', async () => {
    await admin.query('ALTER TABLE erp_pedido_entrada ADD CONSTRAINT cliente_valido CHECK (cliente <> \'INEXISTENTE\')');
    const uuid = '7c0f1a52-7d71-4c0b-9c1e-3a6f4e5d6c7c';
    hub.pedidosParaEntregar = [
      PedidoParaErp.parse({ versao_contrato: 'v1', pedido_uuid: uuid, cliente_external_id: 'INEXISTENTE', vendedor_external_id: 'V1', criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 100,
        itens: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 1, preco_unitario_cents: 100, total_cents: 100 }] }),
    ];
    const antes = hub.retornos.length;
    for (let i = 0; i < 3; i++) {
      await cicloPedidos(ctx);
      ctx.store.atualizarPedido(uuid, { proximaMs: 0 }, Date.now());
    }
    const novo = hub.retornos.slice(antes).map((x) => x as { status: string; motivo?: string });
    expect(novo).toHaveLength(1);
    expect(novo[0]?.status).toBe('rejeitado_erp');
    expect(novo[0]?.motivo).toMatch(/cliente_valido/);
    expect((await admin.query('SELECT count(*)::int AS n FROM erp_pedido_entrada WHERE pedido_uuid = $1', [uuid])).rows[0].n).toBe(0); // transação desfeita
  });

  it('reconciliação: contagem de ativos e soma de controle vêm do ERP', async () => {
    const envio = await reconciliarEntidade(ctx, 'preco', '2026-03-10');
    expect(envio).toMatchObject({ entidade: 'preco', contagem: 2, soma: 3440 });
    expect(hub.reconciliacoes).toHaveLength(1);
    const produto = await reconciliarEntidade(ctx, 'produto', '2026-03-10');
    expect(produto).toMatchObject({ contagem: 2, soma: null });
  });

  it('CLI: testar-conexao confere segredos, ERP (consulta e mapeamento) e Hub, sem imprimir segredo nem dado', async () => {
    const arquivo = join(dir, 'conector.json');
    writeFileSync(arquivo, JSON.stringify({ ...JSON.parse(JSON.stringify(cfg)), dadosDir: dir }));
    const saida: string[] = [];
    const erro: string[] = [];
    const codigo = await executarCli(['testar-conexao', '--config', arquivo], {
      saida: (t) => void saida.push(t), erro: (t) => void erro.push(t), lerEntrada: async () => '',
      env: { MACUXI_CONECTOR_ERP_SENHA: cfgPg.password, MACUXI_CONECTOR_HUB_CHAVE: hub.token },
    });
    const tudo = [...saida, ...erro].join('\n');
    expect(codigo, tudo).toBe(0);
    expect(tudo).toMatch(/\[ok\]\s+Banco do ERP \(postgres\) respondeu/);
    expect(tudo).toMatch(/cliente: consulta ok, 5 linha\(s\) de amostra/);
    expect(tudo).toMatch(/Hub .* respondeu e aceitou a credencial/);
    expect(tudo).not.toContain(hub.token);
    expect(tudo).not.toContain(cfgPg.password === 'postgres' ? 'MACUXI_CONECTOR_ERP_SENHA=' : cfgPg.password);
    expect(tudo).not.toMatch(/Mercadinho/);
  });
});
