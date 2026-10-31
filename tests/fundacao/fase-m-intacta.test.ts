/**
 * T-0001 critério 2 — S0-006, S0-007, S0-009. "A pasta da Fase M não foi alterada."
 * Só LEITURA da Fase M: hashes dos arquivos e `git --no-optional-locks status` (não grava .git/index).
 * Linha de base de 2026-10-30: tests/plano/fase-m-baseline.sha256 e tests/plano/fase-m-git-status.txt.
 * Fora da máquina do Alexandre (CI/nuvem) a pasta não existe: S0-006/007 são pulados com aviso.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '..', '..');
const FASE_M = process.env.MACUXI_FASE_M ?? 'C:/Users/domon/dev/forca-vendas';
const temFaseM = existsSync(join(FASE_M, 'package.json'));
const IGNORAR = new Set(['node_modules', '.git', '.next', '.expo', '.turbo']);

function listar(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listar(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function linhas(arquivo: string): string[] {
  return readFileSync(join(raiz, 'tests', 'plano', arquivo), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'));
}

describe.skipIf(!temFaseM)('S0-006/S0-007 — Fase M intacta (somente leitura)', () => {
  it('S0-006: mesmos 226 arquivos e mesmos sha256 da linha de base', () => {
    const base = new Map(
      linhas('fase-m-baseline.sha256').map((l) => {
        const [hash, caminho] = l.split(' *');
        return [caminho!.replace(/^\.\//, ''), hash!];
      }),
    );
    const agora = new Map(
      listar(FASE_M).map((p) => [relative(FASE_M, p).split('\\').join('/'), createHash('sha256').update(readFileSync(p)).digest('hex')]),
    );
    expect([...agora.keys()].sort()).toEqual([...base.keys()].sort());
    const diferentes = [...base].filter(([c, h]) => agora.get(c) !== h).map(([c]) => c);
    expect(diferentes).toEqual([]);
    expect(base.size).toBe(226);
  });

  it('S0-007: HEAD 41283b7 e `git status --porcelain --untracked-files=all` igual à linha de base', () => {
    const git = (...a: string[]) =>
      spawnSync('git', ['--no-optional-locks', '-C', FASE_M, ...a], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
    expect(git('rev-parse', 'HEAD')[0]).toBe('41283b77e3fca0e86da0d007846920896862865d');
    expect(git('status', '--porcelain', '--untracked-files=all')).toEqual(linhas('fase-m-git-status.txt'));
  });
});

describe('S0-009 — nada no macuxifdv escreve na Fase M', () => {
  it('nenhum script/config/pacote/código aponta para forca-vendas (fora de docs/, tests/, .coord/, CLAUDE.md)', () => {
    const r = spawnSync(
      'git',
      ['--no-optional-locks', 'grep', '-l', '-i', 'forca-vendas', '--', '.', ':!docs', ':!tests', ':!.coord', ':!CLAUDE.md', ':!*.md'],
      { cwd: raiz, encoding: 'utf8' },
    );
    const arquivos = r.stdout.split(/\r?\n/).filter(Boolean);
    // permitidos, conferidos um a um em 2026-10-31 (qualquer arquivo novo falha e precisa ser revisto):
    const PERMITIDOS = new Set([
      'scripts/contar-testes.mjs', // só LÊ a Fase M (contagem estática); cita a pasta no comentário de uso
      'db/seeds/fase-m/fase-m.ts', // só comentário de origem do seed copiado
      '.claude/settings.json', // additionalDirectories (acesso de leitura); o guardião bloqueia escrita lá
      '_instalar/claude/settings.json', // idem, modelo de instalação
    ]);
    expect(arquivos.filter((a) => !PERMITIDOS.has(a))).toEqual([]);
  });
});
