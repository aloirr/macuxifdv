/**
 * Executor de migrações up/down (dono: banco-dados).
 *
 * Convenção: db/migrations/NNNN_nome.up.sql + NNNN_nome.down.sql (toda migração tem caminho de volta).
 * Controle em public.macuxi_migracao (versão, nome, checksum). Migração aplicada NÃO pode ser editada:
 * o checksum diferente aborta o `up` (crie uma nova migração).
 * Cada migração roda numa transação; um advisory lock impede dois executores ao mesmo tempo.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientBase } from 'pg';
import { PASTA_MIGRACOES } from './config';

export interface Migracao {
  versao: string;
  nome: string;
  up: string;
  down: string;
  checksum: string;
}

export interface MigracaoAplicada {
  versao: string;
  nome: string;
  checksum: string;
  aplicada_em: Date;
}

const PADRAO = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;
/** Chave do pg_advisory_lock do executor ("macuxi" em ASCII). */
const CHAVE_LOCK = 0x6d6163757869;

/** Normaliza fim de linha para o checksum não depender de CRLF/LF (Windows x CI). */
function normalizar(sql: string): string {
  return sql.replace(/\r\n/g, '\n');
}

export function checksum(sql: string): string {
  return createHash('sha256').update(normalizar(sql)).digest('hex');
}

/** Lê e valida a pasta de migrações: numeração contínua a partir de 0001, par up/down completo. */
export function lerMigracoes(pasta = PASTA_MIGRACOES): Migracao[] {
  const arquivos = readdirSync(pasta).filter((a) => a.endsWith('.sql'));
  const porVersao = new Map<string, { nome: string; up?: string; down?: string }>();
  for (const arquivo of arquivos) {
    const m = PADRAO.exec(arquivo);
    if (!m) throw new Error(`Arquivo de migração fora do padrão NNNN_nome.(up|down).sql: ${arquivo}`);
    const [, versao, nome, direcao] = m as unknown as [string, string, string, 'up' | 'down'];
    const item = porVersao.get(versao) ?? { nome };
    if (item.nome !== nome) throw new Error(`Versão ${versao} com nomes diferentes: ${item.nome} x ${nome}`);
    item[direcao] = normalizar(readFileSync(join(pasta, arquivo), 'utf8'));
    porVersao.set(versao, item);
  }
  const versoes = [...porVersao.keys()].sort();
  return versoes.map((versao, i) => {
    const esperado = String(i + 1).padStart(4, '0');
    if (versao !== esperado) throw new Error(`Numeração de migração com buraco: esperado ${esperado}, achei ${versao}`);
    const item = porVersao.get(versao)!;
    if (!item.up) throw new Error(`Migração ${versao}_${item.nome} sem .up.sql`);
    if (!item.down) throw new Error(`Migração ${versao}_${item.nome} sem .down.sql (toda migração precisa de caminho de volta)`);
    return { versao, nome: item.nome, up: item.up, down: item.down, checksum: checksum(item.up) };
  });
}

async function garantirControle(c: ClientBase): Promise<void> {
  await c.query(`
    create table if not exists public.macuxi_migracao (
      versao      text primary key,
      nome        text not null,
      checksum    text not null,
      aplicada_em timestamptz not null default now()
    )`);
  await c.query('revoke all on public.macuxi_migracao from public');
}

export async function listarAplicadas(c: ClientBase): Promise<MigracaoAplicada[]> {
  await garantirControle(c);
  const r = await c.query<MigracaoAplicada>('select versao, nome, checksum, aplicada_em from public.macuxi_migracao order by versao');
  return r.rows;
}

async function comLock<T>(c: ClientBase, fn: () => Promise<T>): Promise<T> {
  await c.query('select pg_advisory_lock($1)', [CHAVE_LOCK]);
  try {
    return await fn();
  } finally {
    await c.query('select pg_advisory_unlock($1)', [CHAVE_LOCK]);
  }
}

export interface ResultadoMigracao {
  aplicadas: string[];
}

/** Aplica as migrações pendentes (até `ate`, inclusive, se informado). */
export async function migrarUp(c: ClientBase, opcoes: { ate?: string; pasta?: string } = {}): Promise<ResultadoMigracao> {
  const todas = lerMigracoes(opcoes.pasta);
  return comLock(c, async () => {
    const aplicadas = new Map((await listarAplicadas(c)).map((a) => [a.versao, a]));
    for (const [versao, a] of aplicadas) {
      const arquivo = todas.find((m) => m.versao === versao);
      if (!arquivo) throw new Error(`Migração ${versao}_${a.nome} está aplicada mas o arquivo não existe mais`);
      if (arquivo.checksum !== a.checksum) {
        throw new Error(`Migração aplicada ${versao}_${a.nome} foi editada (checksum diferente). Nunca edite migração aplicada: crie uma nova.`);
      }
    }
    const feitas: string[] = [];
    for (const m of todas) {
      if (aplicadas.has(m.versao)) continue;
      if (opcoes.ate && m.versao > opcoes.ate) break;
      await c.query('begin');
      try {
        await c.query(m.up);
        await c.query('insert into public.macuxi_migracao (versao, nome, checksum) values ($1, $2, $3)', [m.versao, m.nome, m.checksum]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Falha ao aplicar ${m.versao}_${m.nome}.up.sql: ${(e as Error).message}`, { cause: e });
      }
      feitas.push(`${m.versao}_${m.nome}`);
    }
    return { aplicadas: feitas };
  });
}

/** Desfaz migrações na ordem inversa: `passos` (padrão 1) ou todas com `tudo: true`. */
export async function migrarDown(c: ClientBase, opcoes: { passos?: number; tudo?: boolean; pasta?: string } = {}): Promise<ResultadoMigracao> {
  const todas = new Map(lerMigracoes(opcoes.pasta).map((m) => [m.versao, m]));
  return comLock(c, async () => {
    const aplicadas = (await listarAplicadas(c)).reverse();
    const alvo = opcoes.tudo ? aplicadas : aplicadas.slice(0, opcoes.passos ?? 1);
    const feitas: string[] = [];
    for (const a of alvo) {
      const m = todas.get(a.versao);
      if (!m) throw new Error(`Não há arquivo para desfazer ${a.versao}_${a.nome}`);
      await c.query('begin');
      try {
        await c.query(m.down);
        await c.query('delete from public.macuxi_migracao where versao = $1', [a.versao]);
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Falha ao desfazer ${m.versao}_${m.nome}.down.sql: ${(e as Error).message}`, { cause: e });
      }
      feitas.push(`${m.versao}_${m.nome}`);
    }
    return { aplicadas: feitas };
  });
}
