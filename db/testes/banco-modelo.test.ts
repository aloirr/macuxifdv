/**
 * T-0033 (desenho R-20261101-192853): banco modelo dos testes (db/src/banco-modelo.ts).
 * Estático: chave, nome e quando ligar. Com Postgres (CI): construção uma vez com 2 chamadas concorrentes, refazer a sobra
 * de uma construção interrompida, cópia igual ao banco migrado do zero (migrações, RLS, políticas, GRANTs, funções),
 * MACUXI_PG_MODELO=0 sem modelo, migrar: false vazio e limpeza dos modelos de outra chave.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  apagarModelo,
  apagarModelosAntigos,
  chaveModelo,
  CHAVE_LOCK_MODELO,
  ehNomeModelo,
  garantirModelo,
  listarModelos,
  modeloDoProcesso,
  nomeModelo,
  usarModelo,
} from '../src/banco-modelo';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerConfigTestes } from '../src/config';
import { lerMigracoes } from '../src/migrador';
import { ehBancoDeTeste } from '../scripts/limpar-bancos-teste.mjs';
import { semBanco } from './estado';

describe('banco modelo: chave, nome e quando ligar (estático)', () => {
  const migracoes = lerMigracoes();

  it('chave = 12 hex, estável, e muda com up, down, admin ou a lista de migrações', () => {
    const k = chaveModelo('postgres', migracoes);
    expect(k).toMatch(/^[0-9a-f]{12}$/);
    expect(chaveModelo('postgres', migracoes)).toBe(k);
    expect(chaveModelo('postgres')).toBe(k); // padrão = lerMigracoes() da pasta db/migrations
    const ultima = migracoes.at(-1)!;
    const comUp = [...migracoes.slice(0, -1), { ...ultima, checksum: 'x'.repeat(64) }];
    const comDown = [...migracoes.slice(0, -1), { ...ultima, checksumDown: 'y'.repeat(64) }];
    expect(chaveModelo('postgres', comUp)).not.toBe(k);
    expect(chaveModelo('postgres', comDown)).not.toBe(k);
    expect(chaveModelo('macuxi_admin_sem_super', migracoes)).not.toBe(k);
    expect(chaveModelo('postgres', migracoes.slice(0, -1))).not.toBe(k);
  });

  it('nome macuxi_modelo_<chave>; fora do padrão é recusado; o limpar-bancos-teste.mjs não o trata como banco de teste', () => {
    const nome = nomeModelo(chaveModelo('postgres', migracoes));
    expect(nome).toMatch(/^macuxi_modelo_[0-9a-f]{12}$/);
    expect(ehNomeModelo(nome)).toBe(true);
    for (const ruim of ['', 'XYZ', 'abc; drop database macuxi', '12']) expect(() => nomeModelo(ruim), ruim).toThrow(/inválida/);
    for (const n of ['macuxi', 'macuxi_teste_x', 'macuxi_modelo_', 'macuxi_modelo_zz12']) expect(ehNomeModelo(n), n).toBe(false);
    expect(ehBancoDeTeste(nome, ['postgres', 'macuxi'])).toBe(false);
    expect(CHAVE_LOCK_MODELO).not.toBe(0x6d6163757869); // migrador
    expect(CHAVE_LOCK_MODELO).not.toBe(0x6d6163757870); // papéis
  });

  it('liga por padrão só no Postgres local; MACUXI_PG_MODELO=0 desliga, =1 força; migrar: false nunca usa', () => {
    const local = { host: 'localhost' };
    const fora = { host: 'db.exemplo.com.br' };
    expect(usarModelo(local, undefined, {})).toBe(true);
    expect(usarModelo(local, true, {})).toBe(true);
    expect(usarModelo(local, false, {})).toBe(false);
    expect(usarModelo(local, undefined, { MACUXI_PG_MODELO: '0' })).toBe(false);
    expect(usarModelo(fora, undefined, {})).toBe(false);
    expect(usarModelo(fora, undefined, { MACUXI_PG_MODELO: '1' })).toBe(true);
    expect(usarModelo(fora, false, { MACUXI_PG_MODELO: '1' })).toBe(false);
    expect(usarModelo(local, undefined, { NODE_ENV: 'production' })).toBe(false);
  });
});

/** Retrato do catálogo que o TEMPLATE precisa copiar: relações (RLS, FORCE, ACL), políticas, funções e extensões. */
async function retratoCatalogo(url: string): Promise<string[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const fora = "('pg_catalog', 'information_schema', 'pg_toast')";
    const consultas = [
      `select 'rel ' || n.nspname || '.' || c.relname || ' ' || c.relkind || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
              || ' acl=' || coalesce(c.relacl::text, '') as l
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ${fora} and n.nspname not like 'pg_temp%'`,
      `select 'pol ' || schemaname || '.' || tablename || ' ' || policyname || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '')
              || ' ' || coalesce(with_check, '') as l from pg_policies`,
      `select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') definer=' || p.prosecdef
              || ' acl=' || coalesce(p.proacl::text, '') as l
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ${fora}`,
      `select 'ext ' || extname || ' ' || extversion as l from pg_extension`,
      `select 'mig ' || versao || ' ' || nome || ' ' || checksum || ' ' || coalesce(checksum_down, '') as l from public.macuxi_migracao`,
    ];
    const linhas: string[] = [];
    for (const q of consultas) linhas.push(...(await c.query<{ l: string }>(q)).rows.map((r) => r.l));
    return linhas.sort();
  } finally {
    await c.end();
  }
}

describe.skipIf(semBanco())('banco modelo no Postgres (T-0033)', () => {
  const cfg = lerConfigTestes();
  const chaveTeste = () => `ffff${randomBytes(4).toString('hex')}`;
  const criados: string[] = [];
  const bancos: BancoDeTeste[] = [];

  afterAll(async () => {
    for (const b of bancos) await b.apagar().catch(() => undefined);
    await comAdmin('postgres', async (c) => {
      for (const n of criados) await apagarModelo(c, n).catch(() => undefined);
    }, cfg);
  });

  async function estadoDoBanco(nome: string): Promise<{ datistemplate: boolean; datallowconn: boolean } | undefined> {
    return comAdmin('postgres', async (c) => {
      const r = await c.query<{ datistemplate: boolean; datallowconn: boolean }>(
        'select datistemplate, datallowconn from pg_database where datname = $1',
        [nome],
      );
      return r.rows[0];
    }, cfg);
  }

  it('2 chamadas concorrentes constroem o modelo UMA vez; fica IS_TEMPLATE e sem conexões', async () => {
    const chave = chaveTeste();
    const [a, b] = await Promise.all([garantirModelo(cfg, { chave }), garantirModelo(cfg, { chave })]);
    criados.push(a.nome);
    expect(a.nome).toBe(nomeModelo(chave));
    expect(b.nome).toBe(a.nome);
    expect([a.criado, b.criado].sort()).toEqual([false, true]);
    expect(await estadoDoBanco(a.nome)).toEqual({ datistemplate: true, datallowconn: false });
    // 3ª chamada: já pronto
    expect(await garantirModelo(cfg, { chave })).toEqual({ nome: a.nome, criado: false });
  });

  it('sobra de construção interrompida (banco sem a marca IS_TEMPLATE) é apagada e refeita', async () => {
    const chave = chaveTeste();
    const nome = nomeModelo(chave);
    criados.push(nome);
    await comAdmin('postgres', (c) => c.query(`create database ${nome}`), cfg);
    expect(await estadoDoBanco(nome)).toEqual({ datistemplate: false, datallowconn: true });
    expect(await garantirModelo(cfg, { chave })).toEqual({ nome, criado: true });
    expect(await estadoDoBanco(nome)).toEqual({ datistemplate: true, datallowconn: false });
  });

  // com MACUXI_PG_MODELO=0 no ambiente (ou fora do local) o padrão não copia: estes dois casos não se aplicam
  const ligado = usarModelo(cfg, true);

  it.skipIf(!ligado)('a cópia do modelo = o banco migrado do zero (migrações, RLS/FORCE, políticas, GRANTs, funções); MACUXI_PG_MODELO=0 não copia', async () => {
    const modelo = await modeloDoProcesso(cfg);
    expect(modelo).toBe(nomeModelo(chaveModelo(cfg.adminUsuario)));
    const antes = await comAdmin('postgres', async (c) => (await c.query<{ t: Date }>('select clock_timestamp() as t')).rows[0]!.t, cfg);

    const copia = await criarBancoDeTeste({ cfg });
    bancos.push(copia);
    const anterior = process.env.MACUXI_PG_MODELO;
    process.env.MACUXI_PG_MODELO = '0';
    let doZero: BancoDeTeste;
    try {
      doZero = await criarBancoDeTeste({ cfg });
    } finally {
      if (anterior === undefined) delete process.env.MACUXI_PG_MODELO;
      else process.env.MACUXI_PG_MODELO = anterior;
    }
    bancos.push(doZero);

    // a cópia traz as migrações aplicadas ANTES (no modelo); o do zero, agora
    const aplicadas = async (b: BancoDeTeste) =>
      comAdmin(b.nome, async (c) => (await c.query<{ n: number; max: Date; min: Date }>('select count(*)::int as n, max(aplicada_em) as max, min(aplicada_em) as min from public.macuxi_migracao')).rows[0]!, cfg);
    const [ac, az] = [await aplicadas(copia), await aplicadas(doZero)];
    expect(ac.n).toBe(lerMigracoes().length);
    expect(az.n).toBe(lerMigracoes().length);
    expect(ac.max.getTime()).toBeLessThan(antes.getTime());
    expect(az.min.getTime()).toBeGreaterThanOrEqual(antes.getTime());

    const [rc, rz] = [await retratoCatalogo(copia.urlAdmin), await retratoCatalogo(doZero.urlAdmin)];
    expect(rc.filter((l) => l.startsWith('rel ') && l.includes('rls=true force=true')).length).toBeGreaterThan(50);
    expect(rc).toEqual(rz);
    // a cópia nasce banco comum (aceita conexão, não é template)
    expect(await estadoDoBanco(copia.nome)).toEqual({ datistemplate: false, datallowconn: true });
  });

  it('migrar: false segue criando banco vazio, sem o modelo', async () => {
    const vazio = await criarBancoDeTeste({ cfg, migrar: false });
    bancos.push(vazio);
    const r = await comAdmin(vazio.nome, (c) => c.query<{ r: string | null }>("select to_regclass('public.macuxi_migracao')::text as r"), cfg);
    expect(r.rows[0]!.r).toBeNull();
  });

  it.skipIf(!ligado)('apagarModelosAntigos tira os modelos de outra chave e deixa o da chave atual', async () => {
    const atual = await modeloDoProcesso(cfg);
    const antigo = (await garantirModelo(cfg, { chave: chaveTeste() })).nome;
    criados.push(antigo);
    expect(await listarModelos(cfg)).toContain(antigo);
    const apagados = await apagarModelosAntigos(cfg);
    expect(apagados).toContain(antigo);
    expect(apagados).not.toContain(atual);
    const sobram = await listarModelos(cfg);
    expect(sobram).not.toContain(antigo);
    expect(sobram).toContain(atual);
    await expect(comAdmin('postgres', (c) => apagarModelo(c, 'macuxi_teste_abc_1_a1b2c3'), cfg)).rejects.toThrow(/não é banco modelo/);
  });
});
