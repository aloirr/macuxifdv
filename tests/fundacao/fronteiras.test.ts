/**
 * T-0001 critério 3 — S0-010, S0-011, S0-012, S0-013 (plano tests/plano/sprint-0.md).
 * "dependency-cruiser falha se um módulo importar código interno de outro."
 *
 * Complementa packages/config/fronteiras.test.ts (do engenheiro) com as variantes do plano:
 * caminho relativo, api/app/web/db/manifest, import() dinâmico, require, export *, import type,
 * alias de pacote (exportado e não exportado, resolvido por link do workspace como no repo real).
 * Roda o MESMO CLI e a MESMA config do `pnpm fronteiras` (packages/config/dependency-cruiser.cjs).
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '..', '..');
const config = join(raiz, 'packages', 'config', 'dependency-cruiser.cjs');
const bin = join(raiz, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
const fixtures = join(raiz, 'tests', 'fixtures', 'fronteira');

interface Violacao {
  from: string;
  to: string;
  rule: { name: string; severity: string };
}
interface Resultado {
  status: number | null;
  violacoes: Violacao[];
  pares: string[];
}

/** node_modules/@macuxi/b → modules/b (junção no Windows, link no resto), como o pnpm faz no repo. */
function ligarPacoteB(cenario: string): void {
  const dir = join(fixtures, cenario, 'node_modules', '@macuxi');
  rmSync(join(fixtures, cenario, 'node_modules'), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  symlinkSync(join(fixtures, cenario, 'modules', 'b'), join(dir, 'b'), 'junction');
}

interface Saida {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Assíncrono de propósito: spawnSync de ~30 s trava o worker do Vitest (timeout de RPC). */
function cruzar(cwd: string, alvos: string[], extra: string[] = []): Promise<Saida> {
  return new Promise((ok) => {
    execFile(
      process.execPath,
      [bin, ...alvos, '--config', config, ...extra],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      (erro, stdout, stderr) => ok({ status: erro ? (typeof erro.code === 'number' ? erro.code : null) : 0, stdout, stderr }),
    );
  });
}

async function cruzarFixture(cenario: string): Promise<Resultado> {
  const cwd = join(fixtures, cenario);
  const alvos = ['modules', 'packages', 'apps'].filter((p) => existsSync(join(cwd, p)));
  const [ci, json] = await Promise.all([cruzar(cwd, alvos), cruzar(cwd, alvos, ['--output-type', 'json'])]);
  const saida = JSON.parse(json.stdout) as { summary: { violations: Violacao[] } };
  const violacoes = saida.summary.violations;
  return { status: ci.status, violacoes, pares: violacoes.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`) };
}

let violacao: Resultado;
let ok: Resultado;

beforeAll(async () => {
  ligarPacoteB('violacao');
  ligarPacoteB('ok');
  [violacao, ok] = await Promise.all([cruzarFixture('violacao'), cruzarFixture('ok')]);
}, 180_000);

afterAll(() => {
  for (const c of ['violacao', 'ok']) rmSync(join(fixtures, c, 'node_modules'), { recursive: true, force: true });
});

const A = 'modules/a';
const proibido = 'modulo-importa-interno-de-outro';

describe('S0-010 — repositório real passa nas fronteiras', () => {
  it('`pnpm fronteiras` (depcruise apps packages modules) termina com 0 violações de erro', async () => {
    const alvos = ['apps', 'packages', 'modules'].filter((p) => existsSync(join(raiz, p)));
    const r = await cruzar(raiz, alvos, ['--output-type', 'json']);
    const saida = JSON.parse(r.stdout) as { summary: { error: number; violations: Violacao[] } };
    expect(saida.summary.violations.filter((v) => v.rule.severity === 'error')).toEqual([]);
    expect(r.status).toBe(0);
  }, 120_000);
});

describe('S0-011 — fixture de violação FALHA, uma aresta por variante', () => {
  it('código de saída = nº de violações de erro (18) e nenhuma variante escapa', () => {
    expect(violacao.pares.length, violacao.pares.join('\n')).toBe(18);
    expect(violacao.status).toBe(18);
  });

  it.each([
    ['caminho relativo para domain', `${A}/domain/v01-relativo-domain.ts → modules/b/domain/regra.ts`],
    ['api de outro módulo', `${A}/api/v02-api.ts → modules/b/api/index.ts`],
    ['app de outro módulo', `${A}/app/v03-app.ts → modules/b/app/index.ts`],
    ['web de outro módulo', `${A}/web/v04-web.ts → modules/b/web/index.ts`],
    ['db de outro módulo', `${A}/api/v05-db.ts → modules/b/db/schema.ts`],
    ['manifest.ts de outro módulo', `${A}/api/v06-manifest.ts → modules/b/manifest.ts`],
    ['import() dinâmico', `${A}/api/v07-dinamico.ts → modules/b/domain/regra.ts`],
    ['require()', `${A}/api/v08-require.ts → modules/b/domain/regra.ts`],
    ['export * from', `${A}/api/v09-reexporta.ts → modules/b/domain/regra.ts`],
    ['import type', `${A}/api/v10-import-type.ts → modules/b/domain/regra.ts`],
    ['alias exportado @macuxi/b/web', `${A}/web/v12-alias-web.ts → modules/b/web/index.ts`],
    ['alias da raiz @macuxi/b (manifest)', `${A}/api/v13-alias-raiz.ts → modules/b/manifest.ts`],
    ['contracts importando domain de outro módulo', `${A}/contracts/index.ts → modules/b/domain/regra.ts`],
  ])('%s → %s é bloqueado', (_variante, aresta) => {
    expect(violacao.pares).toContain(`${proibido}: ${aresta}`);
  });

  it('alias para subcaminho fora do "exports" (@macuxi/b/domain) é bloqueado', () => {
    expect(violacao.pares).toContain(
      `modulo-importa-caminho-nao-exportado: ${A}/api/v11-alias-nao-exportado.ts → @macuxi/b/domain`,
    );
  });

  it('a mensagem do CI (reporter padrão) cita a regra violada', async () => {
    const cwd = join(fixtures, 'violacao');
    const r = await cruzar(cwd, ['modules', 'packages', 'apps']);
    const texto = `${r.stdout}${r.stderr}`;
    expect(texto).toContain(proibido);
    expect(texto).toContain('modulo-importa-caminho-nao-exportado');
  }, 120_000);
});

describe('S0-013 — plataforma e contracts não dependem de camadas internas', () => {
  it('contracts não importa a própria api', () => {
    expect(violacao.pares).toContain(
      'contracts-importa-camada-interna: modules/b/contracts/v15-contracts-api.ts → modules/b/api/index.ts',
    );
  });
  it('packages/* não importa modules/*', () => {
    expect(violacao.pares).toContain(
      'pacote-importa-modulo-ou-app: packages/comum/v16-pacote-modulo.ts → modules/b/contracts/index.ts',
    );
  });
  it('shell não lê db de módulo; módulo não importa shell', () => {
    expect(violacao.pares).toContain('app-importa-interno-de-modulo: apps/web/v17-shell-db.ts → modules/b/db/schema.ts');
    expect(violacao.pares).toContain('modulo-importa-app: modules/a/web/v18-modulo-shell.ts → apps/web/v17-shell-db.ts');
  });
});

describe('S0-012 — importações permitidas passam', () => {
  it('packages/*, core/contracts, contracts de outro (relativo e alias), interno próprio, contracts→domain próprio, shell→web/manifest e mock-api legado', () => {
    expect(ok.pares).toEqual([]);
    expect(ok.status).toBe(0);
  });
});
