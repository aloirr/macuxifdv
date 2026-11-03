/**
 * Docker do banco local (dono: banco-dados): acha o executável (no Windows o Docker Desktop nem
 * sempre está no PATH do Git Bash/Node), diz se o motor está rodando e sobe o db/docker-compose.yml.
 * Usado pelo CLI (scripts/banco.ts) e pelo globalSetup dos testes de banco.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PASTA_DB, type ServicoCompose } from './config';

export const COMPOSE = join(PASTA_DB, 'docker-compose.yml');

/** Locais padrão do Docker Desktop no Windows (usados se `docker` não estiver no PATH). */
function candidatosWindows(): string[] {
  const bases = [process.env.ProgramFiles, process.env.ProgramW6432, 'C:\\Program Files'].filter((b): b is string => !!b);
  return [...new Set(bases)].map((b) => join(b, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe'));
}

let cache: string | null | undefined;

/** Caminho do executável do Docker, ou null se não houver Docker instalado. */
export function localizarDocker(): string | null {
  if (cache !== undefined) return cache;
  const noPath = spawnSync('docker', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  if (!noPath.error && noPath.status === 0) return (cache = 'docker');
  if (process.platform === 'win32') {
    const achado = candidatosWindows().find((c) => existsSync(c));
    if (achado) return (cache = achado);
  }
  return (cache = null);
}

function rodar(args: string[], herdar: boolean, timeout?: number): SpawnSyncReturns<string> {
  const exe = localizarDocker();
  if (!exe) throw new Error('Docker não encontrado (nem no PATH, nem em "C:\\Program Files\\Docker\\Docker\\resources\\bin").');
  return spawnSync(exe, args, { encoding: 'utf8', stdio: herdar ? 'inherit' : 'pipe', timeout });
}

export type EstadoDocker = { ok: true; versao: string } | { ok: false; motivo: string };

/** Motor do Docker respondendo? Nunca lança. */
export function dockerRodando(): EstadoDocker {
  if (!localizarDocker()) return { ok: false, motivo: 'Docker não instalado (executável não encontrado)' };
  const r = rodar(['info', '--format', '{{.ServerVersion}}'], false, 20_000);
  if (r.error) return { ok: false, motivo: r.error.message };
  if (r.status !== 0) return { ok: false, motivo: (r.stderr || r.stdout || `código ${r.status}`).trim().split('\n')[0] ?? '' };
  return { ok: true, versao: r.stdout.trim() };
}

/** `docker compose -f db/docker-compose.yml <args>`; lança com mensagem em português se falhar. */
export function compose(args: string[], opcoes: { herdarSaida?: boolean } = {}): string {
  const r = rodar(['compose', '-f', COMPOSE, ...args], opcoes.herdarSaida ?? true);
  if (r.error || r.status !== 0) {
    const detalhe = r.error ? `: ${r.error.message}` : ` (código ${r.status})${r.stderr ? `: ${r.stderr.trim()}` : ''}`;
    throw new Error(`docker compose ${args.join(' ')} falhou${detalhe}. O Docker Desktop está aberto? Ver docs/banco/README.md.`);
  }
  return r.stdout ?? '';
}

/**
 * Sobe UM serviço do compose e espera o healthcheck (idempotente: se já está de pé, não faz nada).
 * 'postgres' = demo/dev (5432, macuxi-postgres); 'postgres-testes' = testes (5434, macuxi-postgres-testes, tmpfs).
 */
export function subirPostgres(opcoes: { herdarSaida?: boolean; servico?: ServicoCompose } = {}): void {
  compose(['up', '-d', '--wait', opcoes.servico ?? 'postgres'], opcoes);
}
