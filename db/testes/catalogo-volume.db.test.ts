/**
 * T-0192 — a massa de volume do Catálogo entra no Postgres (banco efêmero próprio: as 160 mil linhas não aparecem nos
 * pulls dos outros testes), com as contagens exatas, RLS do tenant e carga idempotente. Uso: db/seeds/volume/LEIA-ME.md.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { carregarCatalogoVolume } from '../seeds/volume/carregar-catalogo-volume';
import { gerarCatalogoVolume } from '../seeds/volume/catalogo-volume';
import { semBanco } from './estado';
import { comoPapel } from './util';

const massa = gerarCatalogoVolume({ semente: 20261121 });
const T = massa.tenant.id;

describe.skipIf(semBanco())('massa de volume do Catálogo no Postgres (T-0192)', () => {
  let proprio: BancoDeTeste;
  let admin: pg.Client;
  beforeAll(async () => {
    proprio = await criarBancoDeTeste();
    admin = new pg.Client({ connectionString: proprio.urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await proprio?.apagar();
  });

  it('grava tudo, com as contagens exatas, e a segunda carga não muda nada', async () => {
    const r = await carregarCatalogoVolume(admin, massa);
    expect(r.tenantCriado).toBe(true);
    expect(r.inseridas).toEqual({
      'catalogo.catalogo_no': 230,
      'core.produto': 20_000,
      'catalogo.produto_no': 20_000,
      'catalogo.tabela_preco': 5,
      'catalogo.tabela_preco_item': 80_000,
      'catalogo.deposito': 3,
      'catalogo.estoque_saldo': 40_000,
    });
    const segunda = await carregarCatalogoVolume(admin, massa);
    expect(segunda.tenantCriado).toBe(false);
    expect(Object.values(segunda.inseridas).every((n) => n === 0)).toBe(true);
  });

  it('como macuxi_app no tenant: contagens por tabela de preço, por depósito e códigos de nó repetidos (RN-CAT-18)', async () => {
    await admin.query('begin'); // o comoPapel usa savepoint
    try {
      await conferirComoApp();
    } finally {
      await admin.query('rollback');
    }
  });

  async function conferirComoApp(): Promise<void> {
    const q = (sql: string) => comoPapel<{ chave: string; n: string }>(admin, 'macuxi_app', sql, [], T);
    const porTabela = await q(
      `select t.codigo as chave, count(*) as n from catalogo.tabela_preco_item i join catalogo.tabela_preco t on t.id = i.tabela_preco_id group by 1 order by 1`,
    );
    expect(Object.fromEntries(porTabela.rows.map((x) => [x.chave, Number(x.n)]))).toEqual(massa.contagens.precosPorTabela);
    const porDeposito = await q(`select d.codigo as chave, count(*) as n from catalogo.estoque_saldo s join catalogo.deposito d on d.id = s.deposito_id group by 1`);
    expect(Object.fromEntries(porDeposito.rows.map((x) => [x.chave, Number(x.n)]))).toEqual(massa.contagens.saldosPorDeposito);
    const produtos = await q(`select 'p' as chave, count(*) as n from core.produto`);
    expect(Number(produtos.rows[0]!.n)).toBe(20_000);
    const repetidos = await q(`select codigo as chave, count(distinct coalesce(pai_id::text, '-')) as n from catalogo.catalogo_no group by 1 having count(distinct coalesce(pai_id::text, '-')) > 1`);
    expect(repetidos.rows.map((x) => x.chave)).toEqual(expect.arrayContaining(['NAO_CLASSIFICADO', 'OUTROS', 'LEVE', 'DIANTEIRO']));
    // filial padrão semeada pelo gatilho do tenant = a filial da massa
    const filial = await q(`select 'f' as chave, count(*) as n from core.filial where id = '${massa.filialId}' and padrao`);
    expect(Number(filial.rows[0]!.n)).toBe(1);
  }
});
