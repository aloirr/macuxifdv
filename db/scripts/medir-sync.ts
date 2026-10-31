/**
 * Mede as consultas principais do sync pull com volume (dono: banco-dados; T-0002 item 6).
 * Cria um banco efêmero com a fixture dois-tenants, acrescenta volume (por tenant: N clientes,
 * M produtos; carteira dividida entre vendedor-1/vendedor-2 + promotor) e tenants de "ruído" com o
 * mesmo volume, roda ANALYZE e mede cada consulta COMO macuxi_app (RLS ligado) no contexto do tenant A.
 * Imprime Markdown (tabela p50/p95 + planos) para docs/banco/desempenho-sync.md. Apaga o banco no fim.
 *
 * Uso (raiz): pnpm --filter @macuxi/db exec tsx scripts/medir-sync.ts [--clientes 500] [--produtos 20000] [--ruido 8] [--rodadas 30]
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { criarBancoDeTeste, postgresDisponivel } from '../src/banco-teste';
import { lerConfig } from '../src/config';
import { carregarDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';

const { values } = parseArgs({
  options: {
    clientes: { type: 'string', default: '500' },
    produtos: { type: 'string', default: '20000' },
    ruido: { type: 'string', default: '8' },
    rodadas: { type: 'string', default: '30' },
  },
});
const N_CLIENTES = Number(values.clientes);
const N_PRODUTOS = Number(values.produtos);
const N_RUIDO = Number(values.ruido);
const RODADAS = Number(values.rodadas);

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const ZERO = '00000000-0000-0000-0000-000000000000';
const EPOCA = '1970-01-01T00:00:00Z';

async function gerarVolume(admin: pg.Client): Promise<void> {
  const ruido: string[] = [];
  for (let i = 1; i <= N_RUIDO; i++) {
    const r = await admin.query<{ id: string }>(
      "insert into plataforma.tenant (codigo, nome) values ($1, $2) returning id",
      [`ruido-${String(i).padStart(2, '0')}`, `Tenant ruído ${i}`],
    );
    ruido.push(r.rows[0]!.id);
  }
  for (const tenant of [A.tenantId, B.tenantId, ...ruido]) {
    // updated_at espalhado nos últimos 180 dias (cursor do sync)
    await admin.query(
      `insert into core.produto (tenant_id, sku, nome, marca, categoria, updated_at)
       select $1, 'VOL-' || g, 'Produto de volume ' || g, 'Marca ' || (g % 40), 'Categoria ' || (g % 25),
              now() - random() * interval '180 days'
         from generate_series(1, $2::int) g`,
      [tenant, N_PRODUTOS],
    );
    await admin.query(
      `insert into core.cliente (tenant_id, razao_social, nome_fantasia, cidade, uf, updated_at)
       select $1, 'Cliente de volume ' || g || ' LTDA', 'Cliente ' || g, 'Manaus', 'AM', now() - random() * interval '180 days'
         from generate_series(1, $2::int) g`,
      [tenant, N_CLIENTES],
    );
  }
  // Carteira de A: metade dos clientes de volume para cada vendedor, todos para o promotor. B: tudo no vendedor-B.
  await admin.query(
    `insert into core.carteira (tenant_id, cliente_id, usuario_id, papel, updated_at)
     select c.tenant_id, c.id, case when row_number() over (order by c.id) % 2 = 0 then $2::uuid else $3::uuid end, 'vendedor', c.updated_at
       from core.cliente c where c.tenant_id = $1 and c.razao_social like 'Cliente de volume%'`,
    [A.tenantId, A.usuarios.vendedor1, A.usuarios.vendedor2],
  );
  await admin.query(
    `insert into core.carteira (tenant_id, cliente_id, usuario_id, papel, updated_at)
     select c.tenant_id, c.id, $2::uuid, 'promotor', c.updated_at
       from core.cliente c where c.tenant_id = $1 and c.razao_social like 'Cliente de volume%'`,
    [A.tenantId, A.usuarios.promotor],
  );
  await admin.query(
    `insert into core.carteira (tenant_id, cliente_id, usuario_id, papel, updated_at)
     select c.tenant_id, c.id, $2::uuid, 'vendedor', c.updated_at
       from core.cliente c where c.tenant_id = $1 and c.razao_social like 'Cliente de volume%'`,
    [B.tenantId, B.usuarios.vendedor],
  );
  await admin.query('analyze');
}

interface Consulta {
  id: string;
  descricao: string;
  sql: string;
  params: (c: pg.Client) => Promise<unknown[]>;
}

/** Cursor (updated_at, id) da k-ésima linha do tenant A (como o app guardaria após k linhas recebidas). */
async function cursorNa(c: pg.Client, tabela: string, k: number): Promise<[string, string]> {
  const r = await c.query<{ u: Date; id: string }>(`select updated_at as u, id from ${tabela} order by updated_at, id offset $1 limit 1`, [k]);
  const l = r.rows[0]!;
  return [l.u.toISOString(), l.id];
}

const PULL_PRODUTO = `select * from core.produto
  where (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500`;

const CONSULTAS: Consulta[] = [
  { id: 'Q1', descricao: 'produto: 1ª página do pull (cursor zero, 500 linhas)', sql: PULL_PRODUTO, params: async () => [EPOCA, ZERO] },
  { id: 'Q2', descricao: 'produto: página do meio (cursor na linha 10.000)', sql: PULL_PRODUTO, params: async (c) => cursorNa(c, 'core.produto', Math.floor(N_PRODUTOS / 2)) },
  { id: 'Q3', descricao: 'produto: incremental (cursor nas ~50 últimas alterações)', sql: PULL_PRODUTO, params: async (c) => cursorNa(c, 'core.produto', N_PRODUTOS - 50) },
  {
    id: 'Q4',
    descricao: 'produto: quantas alterações desde o cursor (contagem do meio)',
    sql: 'select count(*) from core.produto where (updated_at, id) > ($1::timestamptz, $2::uuid)',
    params: async (c) => cursorNa(c, 'core.produto', Math.floor(N_PRODUTOS / 2)),
  },
  {
    id: 'Q5',
    descricao: 'cliente: pull no escopo da carteira do vendedor-1 (cursor zero)',
    sql: `select c.* from core.cliente c
  where (c.updated_at, c.id) > ($1::timestamptz, $2::uuid)
    and exists (select 1 from core.carteira k
                 where k.tenant_id = c.tenant_id and k.cliente_id = c.id
                   and k.usuario_id = $3 and k.deleted_at is null)
  order by c.updated_at, c.id limit 500`,
    params: async () => [EPOCA, ZERO, A.usuarios.vendedor1],
  },
  {
    id: 'Q6',
    descricao: 'carteira: pull das linhas do vendedor-1, inclusive excluídas (cursor zero)',
    sql: `select * from core.carteira
  where usuario_id = $3 and (updated_at, id) > ($1::timestamptz, $2::uuid)
  order by updated_at, id limit 500`,
    params: async () => [EPOCA, ZERO, A.usuarios.vendedor1],
  },
  {
    id: 'Q7',
    descricao: 'usuario: pull completo do tenant (cursor zero)',
    sql: `select id, nome, email, perfil, equipe_id, ativo, updated_at, deleted_at from core.usuario
  where (updated_at, id) > ($1::timestamptz, $2::uuid) order by updated_at, id limit 500`,
    params: async () => [EPOCA, ZERO],
  },
];

function percentil(ms: number[], p: number): number {
  const o = [...ms].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)]!;
}

async function main(): Promise<void> {
  const cfg = lerConfig();
  const d = await postgresDisponivel(cfg);
  if (!d.ok) throw new Error(`Postgres indisponível (${d.motivo}). Rode "pnpm --filter @macuxi/db banco subir".`);
  const t0 = Date.now();
  const banco = await criarBancoDeTeste({ cfg, preparar: async (c) => { await carregarDoisTenants(c); await gerarVolume(c); } });
  const preparo = ((Date.now() - t0) / 1000).toFixed(1);
  const app = new pg.Client({ connectionString: banco.urlApp });
  await app.connect();
  try {
    const linhas: string[] = [];
    const planos: string[] = [];
    const totais = new pg.Client({ connectionString: banco.urlAdmin });
    await totais.connect();
    const vol = await totais.query<{ t: string; n: number }>(
      `select 'tenants' t, count(*)::int n from plataforma.tenant union all
       select 'produtos', count(*)::int from core.produto union all
       select 'clientes', count(*)::int from core.cliente union all
       select 'carteira', count(*)::int from core.carteira`,
    );
    await totais.end();
    for (const q of CONSULTAS) {
      await app.query('begin');
      await app.query("select set_config('app.tenant_id', $1, true)", [A.tenantId]);
      const params = await q.params(app);
      const usados = params.slice(0, (q.sql.match(/\$\d/g) ?? []).reduce((m, x) => Math.max(m, Number(x.slice(1))), 0));
      for (let i = 0; i < 3; i++) await app.query(q.sql, usados); // aquecimento
      const tempos: number[] = [];
      let linhasRet = 0;
      for (let i = 0; i < RODADAS; i++) {
        const ini = process.hrtime.bigint();
        const r = await app.query(q.sql, usados);
        tempos.push(Number(process.hrtime.bigint() - ini) / 1e6);
        linhasRet = r.rowCount ?? 0;
      }
      const plano = await app.query<{ 'QUERY PLAN': string }>(`explain (analyze, buffers, costs off, summary on) ${q.sql}`, usados);
      await app.query('rollback');
      const texto = plano.rows.map((r) => r['QUERY PLAN']).join('\n');
      const exec = /Execution Time: ([\d.]+) ms/.exec(texto)?.[1] ?? '?';
      const indices = [...texto.matchAll(/(?:Index (?:Only )?Scan(?: Backward)? using|Bitmap Index Scan on) (\w+)/g)].map((m) => m[1]);
      const indice = [...new Set(indices)].join(' + ') || (texto.includes('Seq Scan') ? 'Seq Scan' : '?');
      linhas.push(`| ${q.id} | ${q.descricao} | ${linhasRet} | ${indice} | ${exec} | ${percentil(tempos, 50).toFixed(2)} | ${percentil(tempos, 95).toFixed(2)} |`);
      planos.push(`### ${q.id} — ${q.descricao}\n\n\`\`\`sql\n${q.sql}\n\`\`\`\n\n\`\`\`text\n${texto}\n\`\`\``);
    }
    console.log(`Postgres ${d.versao} (Docker local) · preparo do volume: ${preparo} s · ${RODADAS} rodadas por consulta (após 3 de aquecimento)`);
    console.log(`Volume: ${vol.rows.map((r) => `${r.t} ${r.n}`).join(' · ')} (por tenant: ${N_CLIENTES} clientes, ${N_PRODUTOS} produtos; ${N_RUIDO} tenants de ruído)\n`);
    console.log('| # | Consulta (papel macuxi_app, contexto tenant A) | Linhas | Índice | EXPLAIN exec (ms) | p50 (ms) | p95 (ms) |');
    console.log('|---|---|---|---|---|---|---|');
    console.log(linhas.join('\n'));
    console.log(`\n${planos.join('\n\n')}`);
  } finally {
    await app.end();
    await banco.apagar();
  }
}

main().catch((e: unknown) => {
  console.error(`[medir-sync] erro: ${(e as Error).message}`);
  process.exitCode = 1;
});
