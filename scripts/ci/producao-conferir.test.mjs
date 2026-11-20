// Testes da conferência de produção (R-20261114-121700-alexandre). node --test scripts/ci/*.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conferir, conferirCommit, digestNoGhcr, erroDaRef, errosDaEntrada, tagExiste } from './producao-conferir.mjs';

const SHA = '839a082'.padEnd(40, '0');
const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('ref: publicar só roda em tag v*, por push ou disparo manual na tag', () => {
  assert.equal(erroDaRef({ evento: 'push', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.equal(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), null);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/main', tag: 'main' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_dispatch', ref: 'refs/heads/v1', tag: 'v1' }), /só tag v\*/);
  assert.match(erroDaRef({ evento: 'workflow_run', ref: 'refs/tags/v1.0.7', tag: 'v1.0.7' }), /não publica/);
  assert.match(erroDaRef({ evento: 'push', ref: 'refs/tags/v1 x', tag: 'v1 x' }), /tag inválida/);
});

test('entrada do liberar: vX.Y.Z, SHA de 40 hex e disparo pelo main', () => {
  assert.deepEqual(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/main' }), []);
  for (const versao of ['1.0.7', 'v1.0', 'v1.0.7-rc1', 'v01.0.7', 'v1.0.7 ', '', undefined])
    assert.equal(errosDaEntrada({ versao, sha: SHA, ref: 'refs/heads/main' }).length, 1, String(versao));
  for (const sha of ['839a082', SHA.toUpperCase().replace(/0/g, 'A'), `${SHA}0`, 'g'.repeat(40), ''])
    assert.equal(errosDaEntrada({ versao: 'v1.0.7', sha, ref: 'refs/heads/main' }).length, 1, sha);
  assert.match(errosDaEntrada({ versao: 'v1.0.7', sha: SHA, ref: 'refs/heads/nuvem/x' })[0], /pelo main/);
});

test('tag existente: só o nome exato conta (matching-refs devolve por prefixo)', () => {
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.7' }], 'v1.0.7'), true);
  assert.equal(tagExiste([{ ref: 'refs/tags/v1.0.70' }], 'v1.0.7'), false);
  assert.equal(tagExiste([], 'v1.0.7'), false);
  assert.equal(tagExiste(null, 'v1.0.7'), false);
});

/** exec falso: cada chave é o primeiro argumento relevante; valor = saída ou Error. */
function execFalso({ main = true, ancestral = true, ci = '1', digest = `sha256:${'a'.repeat(64)}` } = {}) {
  const chamadas = [];
  const exec = (cmd, args) => {
    chamadas.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'rev-parse') { if (!main) throw new Error('x'); return 'abc\n'; }
    if (cmd === 'git' && args[0] === 'merge-base') { if (!ancestral) throw new Error('x'); return ''; }
    if (cmd === 'gh') { if (ci instanceof Error) throw ci; return `${ci}\n`; }
    if (cmd === 'bash') { if (digest instanceof Error) throw digest; return `${digest}\n`; }
    throw new Error(`inesperado: ${cmd}`);
  };
  return { exec, chamadas };
}

/** Erro do execFileSync quando o docker diz que a tag não existe (a saída do comando vem no stdout do ghcr-tentar). */
const ausente = () => Object.assign(new Error('Command failed'), { stdout: 'ERROR: ghcr.io/aloirr/macuxi-api:x: not found\n' });

const ALVO = { sha: SHA, versao: 'v1.0.7', dono: 'AloirR', repositorio: 'aloirr/macuxifdv' };

test('conferir: no main, CI verde e imagem → api por digest e dono minúsculo', () => {
  const { exec, chamadas } = execFalso();
  const r = conferir(ALVO, exec);
  assert.equal(r.erro, undefined);
  assert.equal(r.dono, 'aloirr');
  assert.equal(r.api, `ghcr.io/aloirr/macuxi-api@sha256:${'a'.repeat(64)}`);
  const gh = chamadas.find((c) => c[0] === 'gh');
  for (const f of [`head_sha=${SHA}`, 'event=push', 'branch=main', 'status=success']) assert.ok(gh.includes(f), f);
  assert.ok(chamadas.find((c) => c[0] === 'bash').includes(`ghcr.io/aloirr/macuxi-api:${SHA}`));
});

test('conferir: cada falha vira erro e para antes do passo seguinte', () => {
  assert.match(conferir(ALVO, execFalso({ main: false }).exec).erro, /origin\/main ausente/);
  assert.match(conferir(ALVO, execFalso({ ancestral: false }).exec).erro, /não está no main/);
  assert.match(conferir(ALVO, execFalso({ ci: '0' }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ ci: new Error('rede') }).exec).erro, /CI verde/);
  assert.match(conferir(ALVO, execFalso({ digest: '' }).exec).erro, /digest inválido/);
  assert.match(conferir(ALVO, execFalso({ digest: ausente() }).exec).erro, /não está no GHCR.*liberar versão/);
  assert.match(conferir(ALVO, execFalso({ digest: new Error('rede') }).exec).erro, /não consegui consultar/);
  assert.match(conferir({ ...ALVO, sha: 'abc' }, execFalso().exec).erro, /SHA inválido/);
});

test('commit: no main e CI verde, sem consultar o GHCR (o liberar confere antes de montar a imagem)', () => {
  const { exec, chamadas } = execFalso({ digest: new Error('não deveria consultar') });
  assert.deepEqual(conferirCommit(ALVO, exec), { ci: 1 });
  assert.ok(!chamadas.some((c) => c[0] === 'bash'));
  assert.match(conferirCommit(ALVO, execFalso({ ancestral: false }).exec).erro, /não está no main/);
  assert.match(conferirCommit(ALVO, execFalso({ ci: '0' }).exec).erro, /CI verde/);
  assert.match(conferirCommit({ ...ALVO, sha: 'abc' }, execFalso().exec).erro, /SHA inválido/);
});

test('imagem no GHCR: só "não existe" do registro libera o build; falha de consulta nunca remonta a tag', () => {
  const img = `ghcr.io/aloirr/macuxi-api:${SHA}`;
  assert.deepEqual(digestNoGhcr(img, execFalso().exec), { digest: `sha256:${'a'.repeat(64)}` });
  assert.deepEqual(digestNoGhcr(img, execFalso({ digest: ausente() }).exec), { ausente: true });
  for (const stdout of ['manifest unknown', 'MANIFEST_UNKNOWN: manifest unknown'])
    assert.deepEqual(digestNoGhcr(img, execFalso({ digest: Object.assign(new Error('x'), { stdout }) }).exec), { ausente: true });
  assert.match(digestNoGhcr(img, execFalso({ digest: Object.assign(new Error('x'), { stdout: '403 Forbidden' }) }).exec).erro, /não consegui/);
  assert.match(digestNoGhcr(img, execFalso({ digest: 'lixo' }).exec).erro, /digest inválido/);
});

test('workflows: liberar, aprovar e publicar usam a mesma conferência; só o aprovar cria a tag e dispara o publicar', () => {
  const pub = ler('.github/workflows/producao-publicar.yml');
  const lib = ler('.github/workflows/producao-liberar.yml');
  const apr = ler('.github/workflows/producao-aprovar.yml');
  assert.match(pub, /^ {2}workflow_dispatch:/m);
  assert.match(pub, /producao-conferir\.mjs ref/);
  assert.match(pub, /producao-conferir\.mjs conferir/);
  assert.match(pub, /name: PRODUCAO/);
  for (const wf of [lib, apr]) {
    assert.match(wf, /producao-conferir\.mjs entrada/);
    assert.match(wf, /producao-conferir\.mjs conferir/);
    assert.doesNotMatch(wf, /environment:/, 'liberar e aprovar não usam o PRODUCAO: os segredos ficam só no publicar');
  }
  for (const wf of [pub, lib, apr]) assert.doesNotMatch(wf, /actions\/workflows\/ci\.yml\/runs/, 'conferência duplicada fora do script');
  assert.match(apr, /gh workflow run producao-publicar\.yml -R "\$GITHUB_REPOSITORY" --ref "\$VERSAO"/);
  assert.doesNotMatch(lib, /gh workflow run|git\/refs|contents: write|actions: write/, 'o liberar para na issue: sem tag e sem disparo');
});

test('liberar monta a imagem da API (ADR 0051): CI verde antes do build, só se a tag não existe, do código do commit', () => {
  const lib = ler('.github/workflows/producao-liberar.yml');
  const iCommit = lib.indexOf('producao-conferir.mjs commit');
  const iImagem = lib.indexOf('producao-conferir.mjs imagem');
  const iBuild = lib.indexOf('docker/build-push-action');
  assert.ok(iCommit > 0 && iCommit < iImagem && iImagem < iBuild, 'commit → imagem existe? → build');
  assert.ok(iBuild < lib.lastIndexOf('producao-conferir.mjs conferir'), 'o digest é fixado depois do envio');
  // todo passo de build/envio depende de a tag não existir
  const passos = lib.slice(iImagem).split(/\n {6}- /).slice(1);
  for (const p of passos.filter((x) => /setup-buildx|build-push|docker push|ref: \$\{\{ inputs\.sha \}\}/.test(x)))
    assert.match(p, /if: steps\.existe\.outputs\.existe == '0'/, p.split('\n')[0]);
  assert.match(lib, /context: alvo\n\s+file: alvo\/apps\/api\/Dockerfile/);
  assert.doesNotMatch(lib, /macuxi-api:main|--force|push: true/);
  assert.match(lib, /needs: imagem/);
});

test('suíte completa uma vez por versão (R-20261120-073449-alexandre): o liberar roda o ci.yml no SHA antes da imagem', () => {
  const lib = ler('.github/workflows/producao-liberar.yml');
  const ci = ler('.github/workflows/ci.yml');
  const suite = lib.slice(lib.indexOf('\n  suite:\n'), lib.indexOf('\n  imagem:\n'));
  assert.match(suite, /needs: conferir\n/);
  assert.match(suite, /uses: \.\/\.github\/workflows\/ci\.yml\n/);
  assert.match(suite, /sha: \$\{\{ inputs\.sha \}\}/);
  assert.doesNotMatch(suite, /secrets|if:/, 'a suíte sempre roda e sem segredo');
  // a imagem (e a issue, que depende dela) só sai com a suíte verde: sem if que a deixe passar com a suíte falha
  const imagem = lib.slice(lib.indexOf('\n  imagem:\n'), lib.indexOf('\n    steps:', lib.indexOf('\n  imagem:\n')));
  assert.match(imagem, /needs: \[conferir, suite\]/);
  assert.doesNotMatch(imagem, /\bif:/);
  assert.match(lib, /\n  abrir:\n[^]*?needs: imagem\n/);
  // o ci.yml aceita a chamada com o SHA, e todo checkout usa esse SHA
  assert.match(ci, /^ {2}workflow_call:\n {4}inputs:\n {6}sha:\n[^]*?required: true/m);
  assert.doesNotMatch(ci, /^ {2}schedule:/m, 'sem o semanal: a suíte do main só no manual e no liberar');
  const checkouts = ci.split('uses: actions/checkout@v4').slice(1);
  assert.ok(checkouts.length >= 5);
  for (const c of checkouts) assert.match(c.slice(0, 200), /ref: \$\{\{ inputs\.sha \}\}/);
});

test('demo desligada: nenhum workflow publica nem entra na VM da demo', () => {
  for (const wf of ['demo-publicar', 'demo-recriar-base', 'dbaas-teste'])
    assert.throws(() => ler(`.github/workflows/${wf}.yml`), /ENOENT/, wf);
  for (const wf of ['producao-liberar', 'producao-aprovar', 'producao-publicar', 'conector-publicar'])
    assert.doesNotMatch(ler(`.github/workflows/${wf}.yml`), /DEMO_|scope=macuxi-bko\b(?!-)|macuxi-demo-arquivos'/, wf);
});
