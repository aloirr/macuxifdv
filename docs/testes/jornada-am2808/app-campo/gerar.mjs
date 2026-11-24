// Jornada AM2808: monta o bundle das telas do Campo (esbuild + react-native-web) e tira os prints 360x800 (deviceScaleFactor 2).
// Uso (na raiz do repositório, API local no ar): node docs/testes/jornada-am2808/app-campo/gerar.mjs <tela> <nome-do-print> [json-do-cenario]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const req = createRequire(join(RAIZ, 'apps/mobile/package.json'));
const esbuild = req('esbuild');
const { chromium } = createRequire(import.meta.url)(process.env.MACUXI_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright');
const API_LOCAL = process.env.MACUXI_API ?? 'http://127.0.0.1:8100';
const SENHAS = JSON.parse(readFileSync(process.env.MACUXI_SENHAS ?? '/home/user/jornada/senhas.json', 'utf8'));
const SAIDA = '/home/user/jornada/campo-bundle';
mkdirSync(SAIDA, { recursive: true });

const NATIVOS = /^(expo-[a-z-]+|@expo\/vector-icons.*|react-native-(maps|reanimated|gesture-handler|screens|svg|webview|view-shot|worklets)|@react-native-community\/.*|@react-native-async-storage\/.*|react-native-pager-view)(\/.*)?$/;
async function montar() {
  const bundle = join(SAIDA, 'app.js');
  if (existsSync(bundle) && !process.env.REFAZER) return;
  await esbuild.build({
    entryPoints: [join(AQUI, 'main.tsx')],
    bundle: true,
    outfile: bundle,
    format: 'iife',
    platform: 'browser',
    nodePaths: [join(RAIZ, 'node_modules'), join(RAIZ, 'apps/mobile/node_modules')],
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.mjs', '.cjs', '.json'],
    mainFields: ['browser', 'module', 'main'],
    conditions: ['browser', 'import', 'default'],
    loader: { '.js': 'jsx', '.png': 'dataurl', '.jpg': 'dataurl', '.ttf': 'dataurl', '.wasm': 'empty' },
    jsx: 'automatic',
    alias: { '@': join(RAIZ, 'apps/mobile/src') },
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis', 'process.env.EXPO_OS': '"web"', 'process.env.EXPO_PUBLIC_API_MODO': '"v1"' },
    plugins: [{
      name: 'dubles',
      setup(b) {
        b.onResolve({ filter: /^expo-router$/ }, () => ({ path: join(AQUI, 'expo-router.tsx') }));
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: req.resolve('react-native-web') }));
        b.onResolve({ filter: NATIVOS }, () => ({ path: join(AQUI, 'stub.cjs') }));
      },
    }],
    logLevel: 'error',
  });
}
await montar();
const FONTES = {
  Archivo_800ExtraBold: '@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf',
  Archivo_700Bold: '@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf',
  Archivo_600SemiBold: '@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf',
  IBMPlexSans_400Regular: '@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf',
  IBMPlexSans_500Medium: '@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf',
  IBMPlexSans_600SemiBold: '@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf',
  IBMPlexSans_700Bold: '@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf',
};
// As fontes do app (@expo-google-fonts) não estão instaladas nesta sessão: sem elas, a Inter do sistema faz as vezes (aviso no PDF).
const fonteDe = (a) => { try { return `url(data:font/ttf;base64,${readFileSync(req.resolve(a)).toString('base64')})`; } catch { return null; } };
const PESO = (n) => (n.match(/(\d00)/) ?? [])[1] ?? '400';
const css = Object.entries(FONTES).map(([n, a]) => `@font-face{font-family:'${n}';src:${fonteDe(a) ?? `local('Inter ${n.startsWith('Archivo') ? 'Display ' : ''}${{ '400': 'Regular', '500': 'Medium', '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold' }[PESO(n)]}'), local('Inter')`}}`).join('');

export async function tela(nomeTela, nomePrint, extra = {}, op = {}) {
  const cenario = { tela: nomeTela, codigo_empresa: 'AM2808', email: 'vendedor@thathyany-teste.com.br', senha: SENHAS.vendedor, ...extra };
  const html = `<!doctype html><meta charset="utf-8"><style>${css}html,body{margin:0;width:360px;min-height:800px}#raiz{width:360px;min-height:800px;display:flex;flex-direction:column}</style><div id="raiz"></div><script>window.CENARIO=${JSON.stringify(cenario)}</script><script src="http://localhost:47999/app.js"></script>`;
  const nav = await chromium.launch();
  const ctx = await nav.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, timezoneId: 'America/Manaus', locale: 'pt-BR', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('console', (m) => { const t = m.text(); if (t.includes('[campo]') || m.type() === 'error') console.log('  >', t.slice(0, 400)); });
  p.on('pageerror', (e) => console.log('  ! pageerror', e.message.slice(0, 400)));
  await p.route('http://localhost:47999/**', (r) => r.request().url().endsWith('/app.js') ? r.fulfill({ body: readFileSync(join(SAIDA, 'app.js')), contentType: 'text/javascript' }) : r.fulfill({ body: html, contentType: 'text/html' }));
  await p.route('http://localhost:47998/**', async (r) => {
    const url = r.request().url().replace('http://localhost:47998', API_LOCAL);
    const resp = await r.fetch({ url });
    if (resp.status() >= 400) console.log('  api', resp.status(), r.request().method(), url.replace(API_LOCAL, ''));
    await r.fulfill({ response: resp, headers: { ...resp.headers(), 'access-control-allow-origin': '*' } });
  });
  await p.goto('http://localhost:47999/');
  await p.waitForFunction(() => window.__pronto || window.__erro, null, { timeout: 120000 });
  const erro = await p.evaluate(() => window.__erro);
  if (erro) { await nav.close(); throw new Error(erro); }
  await p.evaluate(async () => { await document.fonts.ready; });
  await p.waitForTimeout(op.espera ?? 2500);
  if (op.antes) await op.antes(p);
  const info = await p.evaluate(() => ({ pedido: window.__pedido ?? null, nav: window.__nav, sessao: window.__sessao }));
  await p.screenshot({ path: join(AQUI, '..', 'telas', `${nomePrint}.png`), fullPage: true });
  console.log('print', nomePrint);
  await nav.close();
  return info;
}

if (process.argv[2]) {
  const r = await tela(process.argv[2], process.argv[3], process.argv[4] ? JSON.parse(process.argv[4]) : {});
  console.log(JSON.stringify(r, null, 1).slice(0, 1500));
}
