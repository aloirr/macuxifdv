#!/usr/bin/env node
/**
 * Plano do build Android no GitHub Actions (.github/workflows/android-build.yml; R-20261114-224500-alexandre). Sem
 * dependência: node:fs e as regras de nome de apps/mobile/src/lib/nome-build.ts (importadas com remoção de tipos do
 * Node, como apps/mobile/scripts/eas/comum.mjs), para o nome do APK nunca divergir do build do EAS.
 *
 * Reproduz o perfil do eas.json (`<variante>-<perfil>`): o `env` do perfil (APP_VARIANT, EXPO_PUBLIC_*), o Node do
 * perfil e o tipo do build (só APK). Versão do input (X.Y.Z) e versionCode:
 *   - informado: inteiro de 1 a 2100000000 (limite do Google Play);
 *   - vazio: derivado da versão, MAIOR*1000000 + MENOR*1000 + CORRECAO (1.0.8 → 1000008). Cresce com a versão, não
 *     depende do run e fica muito acima do contador remoto do EAS (appVersionSource remote), então o APK do Actions
 *     instala por cima do APK do EAS. O contrário (EAS por cima do Actions) exige subir o contador do EAS antes
 *     (`eas build:version:set`).
 *
 * Uso no workflow:  VARIANTE=campo VERSAO=1.0.8 PERFIL=producao VERSION_CODE_INFORMADO= node scripts/ci/android-build.mjs
 * Escreve em $GITHUB_ENV (env do perfil, NOME_BUILD, VERSION_CODE) e em $GITHUB_OUTPUT (node, nome, version_code).
 * Saída: 0 = ok; 2 = entrada inválida (::error:: com o motivo).
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const nomes = await import('../../apps/mobile/src/lib/nome-build.ts');

export const VARIANTES = ['campo', 'gestao'];
/** Perfis do eas.json que o workflow aceita (o sufixo de `<variante>-<perfil>`), com o canal do nome do build. */
export const PERFIS = { producao: 'producao' };
export const VERSION_CODE_MAX = 2_100_000_000;
const NOME_VAR = /^[A-Z_][A-Z0-9_]*$/;

/** versionCode do input ou derivado da versão (função pura). Lança Error com o motivo. */
export function versionCodeDe(versao, informado) {
  if (!nomes.versaoValida(versao)) throw new Error(`versão inválida: ${JSON.stringify(versao)} (use X.Y.Z, por exemplo 1.0.8)`);
  const texto = String(informado ?? '').trim();
  if (texto) {
    if (!/^[1-9]\d{0,9}$/.test(texto) || Number(texto) > VERSION_CODE_MAX) {
      throw new Error(`versionCode inválido: ${JSON.stringify(texto)} (inteiro de 1 a ${VERSION_CODE_MAX})`);
    }
    return Number(texto);
  }
  const [maior, menor, correcao] = versao.split('.').map(Number);
  if (menor > 999 || correcao > 999 || maior > 2099) {
    throw new Error(`versão ${versao} fora da faixa do versionCode derivado (MENOR e CORRECAO até 999, MAIOR até 2099): informe o versionCode`);
  }
  return maior * 1_000_000 + menor * 1_000 + correcao;
}

/** Perfil do eas.json da variante: env, Node e conferência do APK (função pura). Lança Error com o motivo. */
export function perfilDoEas(easJson, variante, perfil) {
  if (!VARIANTES.includes(variante)) throw new Error(`variante inválida: ${JSON.stringify(variante)} (campo ou gestao)`);
  if (!Object.hasOwn(PERFIS, perfil)) throw new Error(`perfil inválido: ${JSON.stringify(perfil)} (${Object.keys(PERFIS).join(', ')})`);
  const builds = easJson?.build ?? {};
  const nome = `${variante}-${perfil}`;
  const cadeia = [];
  for (let atual = nome; atual; atual = builds[atual]?.extends) {
    if (!builds[atual]) throw new Error(`perfil ${atual} não existe em apps/mobile/eas.json`);
    if (cadeia.includes(atual)) throw new Error(`extends circular em apps/mobile/eas.json: ${[...cadeia, atual].join(' → ')}`);
    cadeia.push(atual);
  }
  // do mais básico ao perfil: o perfil sobrescreve o que herdou (mesma regra do EAS)
  const p = cadeia.reverse().reduce((acc, n) => {
    const b = builds[n];
    return { ...acc, ...b, env: { ...acc.env, ...b.env }, android: { ...acc.android, ...b.android } };
  }, { env: {}, android: {} });
  if (p.android.buildType !== 'apk') throw new Error(`perfil ${nome}: android.buildType "${p.android.buildType ?? '(vazio)'}"; o workflow só gera APK`);
  if (p.env.APP_VARIANT !== variante) throw new Error(`perfil ${nome}: env.APP_VARIANT "${p.env.APP_VARIANT ?? '(vazio)'}" não é ${variante}`);
  for (const [k, v] of Object.entries(p.env)) {
    if (!NOME_VAR.test(k) || typeof v !== 'string' || /[\r\n]/.test(v)) throw new Error(`perfil ${nome}: env ${k} inválida (nome em MAIÚSCULAS e valor de uma linha)`);
  }
  return { nome, env: p.env, node: p.node ?? '' };
}

/** Plano completo de uma variante (função pura). */
export function planoDoBuild({ easJson, variante, versao, perfil, versionCode }) {
  const p = perfilDoEas(easJson, variante, perfil);
  const code = versionCodeDe(versao, versionCode);
  const nome = nomes.nomeDoBuild(variante, PERFIS[perfil], versao);
  return { perfilEas: p.nome, node: p.node, env: { ...p.env, NOME_BUILD: nome, VERSION_CODE: String(code) }, nome, versionCode: code };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raiz = fileURLToPath(new URL('../../', import.meta.url));
  try {
    const easJson = JSON.parse(readFileSync(resolve(raiz, 'apps/mobile/eas.json'), 'utf8'));
    const e = process.env;
    const plano = planoDoBuild({ easJson, variante: e.VARIANTE, versao: e.VERSAO, perfil: e.PERFIL, versionCode: e.VERSION_CODE_INFORMADO });
    const linhas = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}\n`).join('');
    if (e.GITHUB_ENV) appendFileSync(e.GITHUB_ENV, linhas(plano.env));
    if (e.GITHUB_OUTPUT) appendFileSync(e.GITHUB_OUTPUT, linhas({ node: plano.node, nome: plano.nome, version_code: plano.versionCode }));
    console.log(`[android-build] ${plano.nome}: perfil ${plano.perfilEas}, versionCode ${plano.versionCode}, Node ${plano.node || '(do .nvmrc)'}`);
    console.log(`[android-build] env do perfil: ${Object.keys(plano.env).join(', ')}`);
  } catch (err) {
    console.log(`::error title=android build::${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
