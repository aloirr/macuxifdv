/**
 * Prova que as regras de fronteira (dependency-cruiser.cjs) FALHAM quando um módulo importa
 * código interno de outro (critério 3 da T-0001) e passam nos imports permitidos.
 * Roda o mesmo CLI do CI (`depcruise`) dentro de cada pasta de fixture.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const aqui = dirname(fileURLToPath(import.meta.url));
const config = join(aqui, 'dependency-cruiser.cjs');

/** bin do depcruise no node_modules mais próximo (o pacote não exporta package.json nem bin). */
function acharBin(dir: string): string {
  const alvo = join(dir, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
  if (existsSync(alvo)) return alvo;
  const pai = dirname(dir);
  if (pai === dir) throw new Error('dependency-cruiser não instalado (rode pnpm install)');
  return acharBin(pai);
}
const binDepcruise = acharBin(aqui);

interface Violacao {
  from: string;
  to: string;
  rule: { name: string; severity: string };
}

function cruzar(fixture: string): { status: number | null; violacoes: Violacao[] } {
  const cwd = join(aqui, '__fixtures__', fixture);
  const alvos = ['modules', 'packages', 'apps'].filter((p) => existsSync(join(cwd, p)));
  const rodar = (extra: string[]) =>
    spawnSync(process.execPath, [binDepcruise, ...alvos, '--config', config, ...extra], { cwd, encoding: 'utf8' });
  // 1) igual ao CI (`pnpm fronteiras`, reporter padrão "err"): o código de saída = nº de erros
  const ci = rodar([]);
  // 2) JSON só para saber QUAIS regras dispararam
  const json = rodar(['--output-type', 'json']);
  if (!json.stdout) throw new Error(`depcruise não gerou saída: ${json.stderr}`);
  const saida = JSON.parse(json.stdout) as { summary: { violations: Violacao[] } };
  return { status: ci.status, violacoes: saida.summary.violations };
}

describe('regras de fronteira (dependency-cruiser)', () => {
  // roda o CLI na coleta (fora do timeout de cada it): ~3 s por execução
  const violacao = cruzar('violacao');
  const ok = cruzar('ok');
  const ciclo = cruzar('ciclo');
  const pares = violacao.violacoes.map((v) => `${v.rule.name}: ${v.from} → ${v.to}`);
  const regrasCiclo = ciclo.violacoes.map((v) => `${v.rule.severity} ${v.rule.name}: ${v.from} → ${v.to}`);

  it('fixture de violação faz o depcruise FALHAR (exit = nº de erros, 8)', () => {
    expect(violacao.status).toBe(8);
    expect(violacao.violacoes).toHaveLength(8);
  });

  it('módulo importando domain de outro módulo é bloqueado', () => {
    expect(pares).toContain(
      'modulo-importa-interno-de-outro: modules/vendedor/domain/pedido.ts → modules/catalogo/domain/preco.ts',
    );
  });

  it('`import type` de outro módulo também é bloqueado', () => {
    expect(pares).toContain(
      'modulo-importa-interno-de-outro: modules/vendedor/domain/tipo.ts → modules/catalogo/domain/preco.ts',
    );
  });

  it('módulo importando db (tabela) de outro módulo é bloqueado', () => {
    expect(pares).toContain(
      'modulo-importa-interno-de-outro: modules/vendedor/domain/tabela.ts → modules/catalogo/db/schema.ts',
    );
  });

  it('módulo não importa shell; pacote base não importa módulo', () => {
    expect(pares).toContain('modulo-importa-app: modules/vendedor/web/pagina.ts → apps/web/shell.ts');
    expect(pares).toContain(
      'pacote-importa-modulo-ou-app: packages/ui/botao.ts → modules/catalogo/contracts/index.ts',
    );
  });

  it('shell não importa domain de módulo (só o mock-api legado pode)', () => {
    expect(pares).toContain('app-importa-interno-de-modulo: apps/web/auditoria.ts → modules/vendedor/domain/pedido.ts');
  });

  it('contracts não puxa camada interna; domain não usa módulo do Node', () => {
    expect(pares).toContain(
      'contracts-importa-camada-interna: modules/vendedor/contracts/index.ts → modules/vendedor/web/pagina.ts',
    );
    expect(pares.some((p) => p.startsWith('domain-usa-modulo-do-node: modules/vendedor/domain/tabela.ts'))).toBe(true);
  });

  it('core/contracts importando o contracts de outro módulo é erro (ciclo do PR #636)', () => {
    expect(regrasCiclo).toContain(
      'error core-contracts-importa-outro-modulo: modules/core/contracts/index.ts → modules/integracao/contracts/index.ts',
    );
    expect(regrasCiclo).toContain(
      'error ciclo-entre-modulos: modules/core/contracts/index.ts → modules/integracao/contracts/index.ts',
    );
  });

  it('ciclo indireto entre módulos (core/contracts → core/domain → vendedor/contracts) é erro, não aviso', () => {
    expect(regrasCiclo).toContain(
      'error ciclo-entre-modulos: modules/core/contracts/index.ts → modules/core/domain/regra.ts',
    );
    expect(ciclo.violacoes.some((v) => v.rule.name === 'ciclo-entre-arquivos')).toBe(false);
    expect(ciclo.status).toBe(3);
  });

  it('imports permitidos (packages, core/contracts, contracts de outro, interno do próprio) passam', () => {
    expect(ok.violacoes).toEqual([]);
    expect(ok.status).toBe(0);
  });
});
