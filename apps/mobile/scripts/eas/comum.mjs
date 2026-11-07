/**
 * Base dos scripts do EAS (T-0109): versão de `versao.json`, regras de nome importadas de `src/lib/nome-build.ts`
 * (o Node remove os tipos; Node >= 22.18, o do projeto é o 24) e o executor do `eas` (eas-cli global, `npm i -g eas-cli`).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// O Node avisa ao carregar .ts fora de pacote "type": "module" e ao remover tipos; os avisos não ajudam quem roda o build.
const AVISOS_SILENCIADOS = new Set(['MODULE_TYPELESS_PACKAGE_JSON']);
const avisosOriginais = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (aviso) => {
  if (AVISOS_SILENCIADOS.has(aviso.code) || /type stripping/i.test(aviso.message)) return;
  for (const l of avisosOriginais) l(aviso);
  if (avisosOriginais.length === 0) console.warn(`${aviso.name}: ${aviso.message}`);
});

export const nomes = await import('../../src/lib/nome-build.ts');

/** Pasta do app (`apps/mobile`): o `eas` roda dali, onde estão o eas.json e o app.config.ts. */
export const PASTA_APP = fileURLToPath(new URL('../../', import.meta.url));

/** Versão X.Y.Z de `scripts/eas/versao.json` (fonte única). */
export function versaoAtual() {
  return nomes.lerVersao(JSON.parse(readFileSync(new URL('./versao.json', import.meta.url), 'utf8')));
}

/**
 * Roda `eas <args>` na pasta do app, com a saída na tela (ou capturada, `capturar: true`). No Windows o eas-cli é
 * `eas.cmd`, que só abre pelo shell; os argumentos montados aqui não têm espaço nem aspas.
 */
export function rodarEas(args, { capturar = false } = {}) {
  const r = spawnSync('eas', args, {
    cwd: PASTA_APP,
    stdio: capturar ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.error) throw new Error(`não consegui rodar o eas (${r.error.message}). Instale com: npm i -g eas-cli`);
  return { codigo: r.status ?? 1, saida: r.stdout ?? '' };
}

/** `true` quando o arquivo é o script chamado na linha de comando (e não importado pelo teste). */
export function ehPrincipal(urlDoModulo) {
  return Boolean(process.argv[1]) && resolve(fileURLToPath(urlDoModulo)) === resolve(process.argv[1]);
}
