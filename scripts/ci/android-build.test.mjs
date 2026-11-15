// Build Android no Actions (R-20261114-224500-alexandre). node --test scripts/ci/android-build.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { perfilDoEas, planoDoBuild, VERSION_CODE_MAX, versionCodeDe } from './android-build.mjs';

const ler = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const EAS = JSON.parse(ler('apps/mobile/eas.json'));

test('versionCode: derivado da versão (cresce com ela) ou o informado, sempre dentro do limite', () => {
  assert.equal(versionCodeDe('1.0.8', ''), 1_000_008);
  assert.equal(versionCodeDe('1.0.8', undefined), 1_000_008);
  assert.equal(versionCodeDe('2.13.0', ' '), 2_013_000);
  assert.ok(versionCodeDe('1.0.9', '') > versionCodeDe('1.0.8', ''));
  assert.ok(versionCodeDe('1.1.0', '') > versionCodeDe('1.0.999', ''));
  assert.equal(versionCodeDe('1.0.8', '57'), 57);
  assert.equal(versionCodeDe('1.0.8', String(VERSION_CODE_MAX)), VERSION_CODE_MAX);
  for (const ruim of ['0', '-1', '01', '1.5', 'abc', String(VERSION_CODE_MAX + 1)]) {
    assert.throws(() => versionCodeDe('1.0.8', ruim), /versionCode inválido/, ruim);
  }
  for (const ruim of ['1.0', 'v1.0.8', '1.0.8-beta', '01.0.8', '', '1.0.8\nX=1']) {
    assert.throws(() => versionCodeDe(ruim, ''), /versão inválida/, JSON.stringify(ruim));
  }
  assert.throws(() => versionCodeDe('1.1000.0', ''), /informe o versionCode/);
  assert.equal(versionCodeDe('1.1000.0', '42'), 42, 'fora da faixa, o informado resolve');
});

test('perfil: o env do eas.json de cada variante, com o Node herdado do base e só APK', () => {
  for (const variante of ['campo', 'gestao']) {
    const p = perfilDoEas(EAS, variante, 'producao');
    assert.equal(p.nome, `${variante}-producao`);
    assert.deepEqual(p.env, EAS.build[`${variante}-producao`].env);
    assert.equal(p.env.APP_VARIANT, variante);
    assert.equal(p.env.EXPO_PUBLIC_PERFIL_BUILD, 'producao');
    assert.equal(p.node, EAS.build.base.node);
  }
  assert.throws(() => perfilDoEas(EAS, 'promotor', 'producao'), /variante inválida/);
  assert.throws(() => perfilDoEas(EAS, 'campo', 'preview'), /perfil inválido/);
  const aab = { build: { 'campo-producao': { env: { APP_VARIANT: 'campo' }, android: { buildType: 'app-bundle' } } } };
  assert.throws(() => perfilDoEas(aab, 'campo', 'producao'), /só gera APK/);
  const trocada = { build: { 'campo-producao': { env: { APP_VARIANT: 'gestao' }, android: { buildType: 'apk' } } } };
  assert.throws(() => perfilDoEas(trocada, 'campo', 'producao'), /não é campo/);
  const injecao = { build: { 'campo-producao': { env: { APP_VARIANT: 'campo', X: 'a\nGITHUB_TOKEN=1' }, android: { buildType: 'apk' } } } };
  assert.throws(() => perfilDoEas(injecao, 'campo', 'producao'), /env X inválida/);
  const circular = { build: { 'campo-producao': { extends: 'a' }, a: { extends: 'campo-producao' } } };
  assert.throws(() => perfilDoEas(circular, 'campo', 'producao'), /circular/);
  assert.throws(() => perfilDoEas({ build: {} }, 'campo', 'producao'), /não existe/);
});

test('plano: nome do build igual ao do EAS (nome-build.ts) e env com NOME_BUILD e VERSION_CODE', () => {
  const p = planoDoBuild({ easJson: EAS, variante: 'gestao', versao: '1.0.8', perfil: 'producao', versionCode: '' });
  assert.equal(p.nome, 'Gestao-Oficial-v1.0.8');
  assert.equal(p.env.NOME_BUILD, 'Gestao-Oficial-v1.0.8');
  assert.equal(p.env.VERSION_CODE, '1000008');
  assert.equal(p.env.APP_VARIANT, 'gestao');
  assert.equal(planoDoBuild({ easJson: EAS, variante: 'campo', versao: '1.2.3', perfil: 'producao', versionCode: '9' }).nome, 'Campo-Oficial-v1.2.3');
});

test('workflow: só manual, permissões mínimas, secrets por variante sem eco e keystore apagada sempre', () => {
  const wf = ler('.github/workflows/android-build.yml');
  assert.match(wf, /^on:\n {2}workflow_dispatch:\n/m);
  assert.doesNotMatch(wf, /^ {2}(push|pull_request|schedule|workflow_run):/m);
  assert.match(wf, /^permissions:\n {2}contents: read\n\n/m);
  assert.match(wf, /runs-on: \$\{\{ vars\.ANDROID_RUNNER \|\| 'ubuntu-latest' \}\}/);
  assert.match(wf, /fail-fast: false/);
  assert.match(wf, /run: node scripts\/ci\/android-build\.mjs/);
  for (const s of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    assert.match(wf, new RegExp(`secrets\\[format\\('${s}_\\{0\\}', env\\.SUFIXO\\)\\]`), s);
  }
  // o conjunto de uma variante nunca cai no da outra (a || b com secret vazio cairia)
  assert.doesNotMatch(wf, /secrets\.ANDROID_[A-Z_]+ \|\|/);
  // valor de secret só por variável de ambiente, nunca interpolado no shell
  for (const linha of wf.split('\n').filter((l) => /\$\{\{[^}]*secrets/.test(l))) {
    assert.match(linha, /^\s+[A-Z][A-Z0-9_]*: \$\{\{/, `secret fora de env: ${linha.trim()}`);
  }
  assert.match(wf, /- name: apagar keystore\n\s+if: \$\{\{ always\(\) \}\}\n\s+run: rm -f "\$RUNNER_TEMP\/keystore\.jks"/);
  assert.match(wf, /apksigner" verify --print-certs/);
  assert.match(wf, /name: \$\{\{ steps\.plano\.outputs\.nome \}\}/);
  assert.doesNotMatch(wf, /persist-credentials: true/);
});

test('workflow: libera disco antes do checkout, preserva o NDK do react-native, só ABIs de aparelho e gradle sem daemon', () => {
  const wf = ler('.github/workflows/android-build.yml');
  const limpeza = wf.indexOf('- name: liberar disco');
  assert.ok(limpeza > 0 && limpeza < wf.indexOf('- uses: actions/checkout@v4'), 'limpeza antes do checkout');
  for (const d of ['/usr/share/dotnet', '/opt/ghc', '/usr/local/.ghcup', '/opt/hostedtoolcache/CodeQL']) assert.ok(wf.includes(d), d);
  assert.match(wf, /docker image prune -af/);
  assert.match(wf, /\[ "\$\(basename "\$d"\)" = "\$NDK_VERSAO" \] \|\| sudo rm -rf "\$d"/);
  const ndk = wf.match(/NDK_VERSAO: '([0-9.]+)'/)?.[1];
  assert.ok(ndk, 'NDK_VERSAO no env do job');
  let toml = null;
  try {
    toml = ler('node_modules/react-native/gradle/libs.versions.toml');
  } catch {
    // sem node_modules (checkout sem install): a igualdade fica para quando houver
  }
  if (toml) assert.equal(ndk, toml.match(/^ndkVersion = "([^"]+)"/m)?.[1], 'NDK_VERSAO = ndkVersion do react-native');
  const props = wf.indexOf('- name: gradle.properties (ABIs e memória)');
  assert.ok(props > wf.indexOf('- name: expo prebuild') && props < wf.indexOf('- name: gradlew assembleRelease'));
  assert.match(wf, /definir reactNativeArchitectures 'arm64-v8a,armeabi-v7a'/);
  assert.match(wf, /definir org\.gradle\.jvmargs '-Xmx4g -XX:MaxMetaspaceSize=1g/);
  assert.match(wf, /\.\/gradlew assembleRelease --build-cache --no-daemon/);
});
