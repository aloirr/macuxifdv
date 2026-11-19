/**
 * Esquema SQLite do APARELHO do Core (T-0156, rastreamento; dono: banco-dados). Especificação: docs/banco/aparelho-sqlite.md,
 * "Core: rastreamento". Roda no `node:sqlite` (driver do SDK), sem Postgres.
 * - objetos só com o prefixo `core__` (`verificarDonoDasMigracoes`), versões crescentes;
 * - colunas do desenho §3.1 e nada mais; CHECKs de faixa;
 * - a fila de envio (não enviados, do mais antigo) e a poda por capturado_em usam índice (EXPLAIN QUERY PLAN).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { aplicarMigracoes, MIGRACOES_PLATAFORMA, PRAGMAS_ABERTURA, verificarDonoDasMigracoes, type DriverSqlite } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { migracoesAparelho } from '../../modules/core/db/aparelho';

const abertos: DriverSqlite[] = [];
async function novo(): Promise<DriverSqlite> {
  const d = criarDriverNode();
  abertos.push(d);
  return d;
}
afterAll(async () => {
  for (const d of abertos) await d.fechar();
});

async function migrado(): Promise<DriverSqlite> {
  const d = await novo();
  await d.executar(PRAGMAS_ABERTURA);
  for (const m of MIGRACOES_PLATAFORMA) await d.executar(m.sql);
  await aplicarMigracoes(d, 'core', migracoesAparelho, () => new Date(0));
  return d;
}

describe('SQLite do aparelho — Core (rastreamento, T-0156)', () => {
  it('versões inteiras e crescentes; só objetos core__; SQL sem gatilho', async () => {
    const versoes = migracoesAparelho.map((m) => m.versao);
    expect(versoes).toEqual([...versoes].sort((a, b) => a - b));
    expect(versoes[0]).toBe(1);
    expect(await verificarDonoDasMigracoes(await novo(), 'core', migracoesAparelho, [])).toEqual([]);
    for (const m of migracoesAparelho) expect(m.sql).not.toMatch(/create\s+trigger/i);
  });

  it('colunas do desenho §3.1 (sem endereço, altitude, rumo, rede ou bateria) e a fila de envio', async () => {
    const d = await migrado();
    const cols = async (t: string) => (await d.todas<{ name: string }>(`select name from pragma_table_info('${t}')`)).map((c) => c.name);
    expect(await cols('core__ponto_trajeto')).toEqual(['id', 'capturado_em', 'latitude', 'longitude', 'precisao_m', 'velocidade_ms', 'enviado_em']);
    expect(await cols('core__pausa_trajeto')).toEqual(['id', 'inicio', 'fim', 'enviado_em']);
  });

  it('CHECKs: coordenada fora da faixa, precisão ou velocidade negativas e pausa com fim antes do início são recusadas', async () => {
    const d = await migrado();
    const ins = 'insert into core__ponto_trajeto (id, capturado_em, latitude, longitude, precisao_m, velocidade_ms) values (?, ?, ?, ?, ?, ?)';
    const quando = '2026-11-19T12:00:00.000Z'; // hora-fixa-ok: só texto gravado e comparado; sem relógio no arquivo
    await d.rodar(ins, ['a', quando, -3.1, -60.0, 10, 0]);
    for (const [i, vals] of [[90.1, 0, null, null], [0, 181, null, null], [0, 0, -1, null], [0, 0, null, -0.5]].entries()) {
      await expect(d.rodar(ins, [`x${i}`, quando, ...vals]), String(vals)).rejects.toThrow(/CHECK/i);
    }
    await expect(d.rodar('insert into core__pausa_trajeto (id, inicio, fim) values (?, ?, ?)', ['p', quando, quando])).rejects.toThrow(/CHECK/i);
  });

  it('fila (não enviados do mais antigo) e poda por capturado_em usam índice', async () => {
    const d = await migrado();
    const plano = async (sql: string) => (await d.todas<{ detail: string }>(`explain query plan ${sql}`)).map((l) => l.detail).join(' | ');
    expect(await plano("select id from core__ponto_trajeto where enviado_em is null order by capturado_em limit 500")).toMatch(/core__ponto_trajeto_capturado/);
    expect(await plano("delete from core__ponto_trajeto where capturado_em < '2026-08-21'")).toMatch(/core__ponto_trajeto_capturado/); // hora-fixa-ok: só o plano
  });
});
