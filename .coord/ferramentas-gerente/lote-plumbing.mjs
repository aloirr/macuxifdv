// Monta o lote por dono só com plumbing do git (sem tocar em nenhum worktree): parte de origin/main e reproduz a árvore
// do retrato, um commit por dono. Uso: node lote-plumbing.mjs <sha-retrato> <msgs.json>
// Imprime o SHA final; não faz push.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'C:/macuxifdv';
const S = 'C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad';
const [, , retrato, arqMsgs] = process.argv;
const { carregarDonos, donoDe } = await import(pathToFileURL(`${REPO}/scripts/coord-lib.mjs`).href);
const regras = carregarDonos(REPO);
const msgs = JSON.parse(readFileSync(arqMsgs, 'utf8'));
const git = (args, env = {}) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...env } });

const base = git(['rev-parse', 'refs/remotes/origin/main']).trim();
const linhas = git(['diff', '--name-status', '--no-renames', `${base}..${retrato}`]).trim().split('\n').filter(Boolean);
const grupos = new Map();
for (const l of linhas) {
  const [st, p] = l.split('\t');
  const mDiario = /^\.coord\/diario\/([a-z-]+)\.md$/.exec(p);
  const dono = mDiario ? mDiario[1] : donoDe(p, regras);
  if (!dono) { console.error(`SEM DONO: ${p}`); process.exit(2); }
  if (dono === 'alexandre') { console.error(`CAMINHO DO ALEXANDRE NO RETRATO (não vai sem rito): ${p}`); process.exit(3); }
  if (!grupos.has(dono)) grupos.set(dono, []);
  grupos.get(dono).push({ st, p });
}
let pai = base;
const idx = `${S}/idx-plumbing`;
for (const [dono, arqs] of grupos) {
  rmSync(idx, { force: true });
  const env = { GIT_INDEX_FILE: idx };
  git(['read-tree', `${pai}^{tree}`], env);
  for (const { st, p } of arqs) {
    if (st === 'D') { git(['update-index', '--force-remove', '--', p], env); continue; }
    const ls = git(['ls-tree', retrato, '--', p]).trim(); // "<mode> blob <sha>\t<path>"
    const [meta] = ls.split('\t');
    const [mode, , sha] = meta.split(' ');
    git(['update-index', '--add', '--cacheinfo', `${mode},${sha},${p}`], env);
  }
  const tree = git(['write-tree'], env).trim();
  const arq = `${S}/msg-plumb-${dono}.txt`;
  writeFileSync(arq, `${msgs[dono] ?? `lote: alterações de ${dono}`}\n\nAgente: ${dono}\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`);
  pai = git(['commit-tree', tree, '-p', pai, '-F', arq]).trim();
  console.log(`ok ${dono}: ${arqs.length} arquivo(s) -> ${pai.slice(0, 8)}`);
}
rmSync(idx, { force: true });
console.log('arvore lote:    ' + git(['rev-parse', `${pai}^{tree}`]).trim());
console.log('arvore retrato: ' + git(['rev-parse', `${retrato}^{tree}`]).trim());
console.log('FINAL ' + pai);
