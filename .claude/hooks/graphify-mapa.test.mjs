// Testes do hook do mapa do código (graphify-mapa.mjs): `node --test .claude/hooks/graphify-mapa.test.mjs`.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bashBuscaArquivo, lembrete, nosMaisLigados, textoDeInicio, TEXTO_LEMBRETE } from './graphify-mapa.mjs';

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
    { source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'a' }, { source: 'a', target: 'a' },
    { source: 'f', target: 'a' }, { source: 'f', target: 'r' }, { source: 'b', target: 'r' }, { source: 'c', target: 'r' },
  ],
};
const dir = mkdtempSync(join(tmpdir(), 'grafo-'));
const grafoOk = join(dir, 'graph.json');
writeFileSync(grafoOk, JSON.stringify(GRAFO));
const ausente = join(dir, 'nao-existe.json');
after(() => rmSync(dir, { recursive: true, force: true }));

const rodar = (stdin, grafo = grafoOk) => {
  const r = spawnSync('node', [SCRIPT], { input: stdin, env: { ...process.env, MACUXI_GRAFO: grafo, TMPDIR: dir } });
  return { status: r.status, saida: r.stdout.toString() };
};
const INICIO = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's' });
const busca = ({ sessao = `teste-${process.pid}-${Date.now()}`, agente, command = 'grep -rn x .' } = {}) =>
  JSON.stringify({ hook_event_name: 'PreToolUse', session_id: sessao, agent_id: agente, tool_name: 'Bash', tool_input: { command } });
const contexto = (r) => JSON.parse(r.saida).hookSpecificOutput;

test('símbolos mais ligados: sem nó de arquivo nem dependência externa; laço conta uma vez', () => {
  assert.deepEqual(nosMaisLigados(GRAFO, 2), [
    { rotulo: 'semBanco()', arquivo: 'db/testes/estado.ts', ligacoes: 5 },
    { rotulo: 'Button()', arquivo: 'packages/ui/src/botao.tsx', ligacoes: 3 },
  ]);
});

test('início: comando de consulta e símbolos; mapa ausente e ilegível avisam como montar', () => {
  assert.match(textoDeInicio(GRAFO), /graphify query "<pergunta>" --graph \.\.\/grafo-macuxifdv\/graphify-out\/graph\.json --budget 1500\nSímbolos mais ligados: semBanco\(\) \(db\/testes\/estado\.ts\);/);
  assert.match(textoDeInicio(null), /não encontrado.*graphify extract \. --code-only --out \.\.\/grafo-macuxifdv/);
  assert.match(textoDeInicio(undefined), /ilegível/);
});

test('Bash de busca: começo de comando conta; | grep que filtra saída não', () => {
  for (const c of ['grep -rn x modules', 'rg foo', 'find . -name "*.ts"', 'cd m && git grep -n x', 'ls; rg x', 'cd /x\ngrep -n y z',
    'git -C /home/user/macuxifdv grep -n x', '(grep x y)', 'echo $(rg -l x)', 'for f in a; do grep x $f; done', 'sudo find / -name x', 'FOO=1 rg x'])
    assert.equal(bashBuscaArquivo(c), true, c);
  for (const c of ['git log | grep fix', 'pnpm test', 'echo grep', undefined, 42]) assert.equal(bashBuscaArquivo(c), false, String(c));
});

test('lembrete: Grep, Glob e Bash de busca até o agente rodar o graphify na sessão; depois fica calado', () => {
  const marcador = join(dir, 'marcador');
  assert.equal(lembrete({ tool_name: 'Read' }, marcador), null);
  assert.equal(lembrete({ tool_name: 'Grep' }, marcador), TEXTO_LEMBRETE);
  assert.equal(lembrete({ tool_name: 'Bash', tool_input: { command: 'rg x' } }, marcador), TEXTO_LEMBRETE);
  for (const c of ['ls ../grafo-macuxifdv/graphify-out', 'grep -n graphify CLAUDE.md', 'node --test .claude/hooks/graphify-mapa.test.mjs'])
    assert.equal(lembrete({ tool_name: 'Bash', tool_input: { command: c } }, marcador), c.startsWith('grep') ? TEXTO_LEMBRETE : null, c);
  assert.equal(existsSync(marcador), false);
  assert.equal(lembrete({ tool_name: 'Bash', tool_input: { command: '"$(python3 -m site --user-base)/bin/graphify" query "x" --graph g | grep y' } }, marcador), null);
  assert.equal(existsSync(marcador), true);
  assert.equal(lembrete({ tool_name: 'Glob' }, marcador), null);
});

test('de ponta a ponta: o evento escolhe o modo; exit 0 sem bloquear; sem mapa, stdin ruim ou outro evento fica calado', () => {
  assert.deepEqual(contexto(rodar(busca())), { hookEventName: 'PreToolUse', additionalContext: TEXTO_LEMBRETE });
  assert.match(contexto(rodar(INICIO)).additionalContext, /Símbolos mais ligados/);
  for (const [stdin, grafo] of [['', grafoOk], ['{ruim', grafoOk], [busca(), ausente], [JSON.stringify({ hook_event_name: 'Stop' }), grafoOk]])
    assert.deepEqual(rodar(stdin, grafo), { status: 0, saida: '' }, stdin);
  assert.match(contexto(rodar(INICIO, ausente)).additionalContext, /não encontrado/);
  const quebrado = join(dir, 'quebrado.json');
  writeFileSync(quebrado, '{quebrado');
  assert.match(contexto(rodar(INICIO, quebrado)).additionalContext, /ilegível/);
});

test('marcador por agente: a consulta do agente principal não cala o lembrete do subagente', () => {
  const sessao = `teste-agente-${process.pid}-${Date.now()}`;
  assert.equal(rodar(busca({ sessao, command: 'graphify query "x" --graph g' })).saida, '');
  assert.equal(rodar(busca({ sessao, command: 'rg x' })).saida, '');
  assert.equal(contexto(rodar(busca({ sessao, agente: 'ag1', command: 'rg x' }))).additionalContext, TEXTO_LEMBRETE);
});
