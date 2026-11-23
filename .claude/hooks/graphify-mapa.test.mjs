// Testes do hook do mapa do código (graphify-mapa.mjs): `node --test .claude/hooks/graphify-mapa.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bashBuscaArquivo, nosMaisLigados, precisaLembrete, textoDeInicio, TEXTO_LEMBRETE } from './graphify-mapa.mjs';

const SCRIPT = fileURLToPath(new URL('./graphify-mapa.mjs', import.meta.url));
const GRAFO = {
  nodes: [
    { id: 'a', label: 'semBanco()', file_type: 'code', source_file: 'db/testes/estado.ts' },
    { id: 'b', label: 'Button()', file_type: 'code', source_file: 'packages/ui/src/botao.tsx' },
    { id: 'c', label: 'ModuloId', file_type: 'code', source_file: 'modules/core/contracts/modulos.ts' },
    { id: 'f', label: 'testes/estado.ts', file_type: 'code', source_file: 'db/testes/estado.ts' },
    { id: 'r', label: 'ref_vitest', file_type: 'concept', source_file: '' },
  ],
  links: [
    { source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'a' },
    { source: 'f', target: 'a' }, { source: 'f', target: 'r' }, { source: 'b', target: 'r' }, { source: 'c', target: 'r' },
  ],
};

const rodar = (modo, entrada, grafo) =>
  execFileSync('node', [SCRIPT, modo], { input: JSON.stringify(entrada), env: { ...process.env, MACUXI_GRAFO: grafo } }).toString();

test('nós mais ligados: só símbolos do código (sem arquivo nem dependência externa), pelo número de ligações', () => {
  assert.deepEqual(nosMaisLigados(GRAFO, 2), [
    { rotulo: 'semBanco()', arquivo: 'db/testes/estado.ts', ligacoes: 4 },
    { rotulo: 'Button()', arquivo: 'packages/ui/src/botao.tsx', ligacoes: 3 },
  ]);
});

test('início com mapa traz o comando de consulta e os nós; sem mapa só avisa como montar', () => {
  const com = textoDeInicio(GRAFO);
  assert.match(com, /graphify query "<pergunta>" --graph \.\.\/grafo-macuxifdv\/graphify-out\/graph\.json --budget 1500/);
  assert.match(com, /semBanco\(\) em db\/testes\/estado\.ts \(4\)/);
  assert.match(textoDeInicio(null), /não encontrado.*graphify extract \. --code-only --out \.\.\/grafo-macuxifdv/);
});

test('lembrete: Grep e Glob sempre; Bash só quando o comando busca arquivo', () => {
  assert.equal(precisaLembrete({ tool_name: 'Grep' }), true);
  assert.equal(precisaLembrete({ tool_name: 'Glob' }), true);
  assert.equal(precisaLembrete({ tool_name: 'Read' }), false);
  for (const c of ['grep -rn x modules', 'rg foo', 'find . -name "*.ts"', 'cd modules && git grep -n x', 'ls; rg x'])
    assert.equal(bashBuscaArquivo(c), true, c);
  for (const c of ['git log | grep fix', 'pnpm test', 'graphify query "x" --graph g | grep y', 'echo grep'])
    assert.equal(bashBuscaArquivo(c), false, c);
});

test('hook de ponta a ponta: devolve contexto sem bloquear; sem mapa o lembrete fica calado', () => {
  const dir = mkdtempSync(join(tmpdir(), 'grafo-'));
  const grafo = join(dir, 'graph.json');
  writeFileSync(grafo, JSON.stringify(GRAFO));
  const lembrete = JSON.parse(rodar('lembrete', { tool_name: 'Grep', tool_input: {} }, grafo));
  assert.deepEqual(lembrete, { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: TEXTO_LEMBRETE } });
  const inicio = JSON.parse(rodar('inicio', { hook_event_name: 'SessionStart' }, grafo));
  assert.equal(inicio.hookSpecificOutput.hookEventName, 'SessionStart');
  const ausente = join(dir, 'nao-existe.json');
  assert.equal(rodar('lembrete', { tool_name: 'Grep' }, ausente), '');
  assert.match(JSON.parse(rodar('inicio', {}, ausente)).hookSpecificOutput.additionalContext, /não encontrado/);
  writeFileSync(grafo, '{quebrado');
  assert.match(JSON.parse(rodar('inicio', {}, grafo)).hookSpecificOutput.additionalContext, /não encontrado/);
});
