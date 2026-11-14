// Prints (360x800, deviceScaleFactor 2) da folha "Adicionar ao orçamento" do Catálogo (R-20261114-151000).
// Renderiza a TELA REAL (modules/vendedor/app/screens/adicionar-ao-orcamento-screen.tsx) com os componentes do kit
// (packages/ui: Screen, EstadoVazio, AvisoRodape) em react-native-web e as fontes do app (Archivo e IBM Plex, @expo-google-fonts).
// Só `expo-router` e `useVendedor` são dublês (dubles.tsx). Uso, na raiz: node docs/modulos/vendedor/prints/gerar.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const req = createRequire(join(RAIZ, 'apps/mobile/package.json'));
const esbuild = req('esbuild');
const { chromium } = createRequire(import.meta.url)('playwright');

const DUBLES = join(AQUI, 'dubles.tsx');
const dubles = {
  name: 'dubles',
  setup(b) {
    b.onResolve({ filter: /^expo-router$/ }, () => ({ path: DUBLES }));
    b.onResolve({ filter: /\/state\/use-vendedor$/ }, () => ({ path: DUBLES }));
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: req.resolve('react-native-web') }));
  },
};
const { outputFiles } = await esbuild.build({
  entryPoints: [join(AQUI, 'tela.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  nodePaths: [join(RAIZ, 'node_modules')],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.json'],
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import', 'default'],
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis', 'process.env.EXPO_OS': '"web"' },
  plugins: [dubles],
  logLevel: 'error',
});
const js = outputFiles[0].text;

const FONTES = {
  Archivo_800ExtraBold: '@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf',
  Archivo_700Bold: '@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf',
  Archivo_600SemiBold: '@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf',
  IBMPlexSans_400Regular: '@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf',
  IBMPlexSans_500Medium: '@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf',
  IBMPlexSans_600SemiBold: '@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf',
  IBMPlexSans_700Bold: '@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf',
};
const css = Object.entries(FONTES)
  .map(([nome, arq]) => `@font-face{font-family:'${nome}';src:url(data:font/ttf;base64,${readFileSync(req.resolve(arq)).toString('base64')})}`)
  .join('');
const html = (cenario) =>
  `<!doctype html><meta charset="utf-8"><style>${css}html,body,#raiz{margin:0;width:360px;height:800px;display:flex}</style>` +
  `<div id="raiz"></div><script>window.CENARIO=${JSON.stringify(cenario)}</script><script>${js}</script>`;

const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
// reducedMotion: o kit mostra o aviso sem animação (no react-native-web o Animated sem driver nativo não monta o aviso a tempo)
const pagina = await navegador.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
pagina.on('pageerror', (e) => console.error('[prints]', e.message));
const abrir = async (cenario) => {
  await pagina.setContent(html(cenario), { waitUntil: 'load' });
  await pagina.evaluate(async () => {
    await Promise.all([...document.fonts].map((f) => f.load()));
    await document.fonts.ready;
  });
};
await abrir('lista');
await pagina.screenshot({ path: join(AQUI, 'folha-orcamentos.png') });
await pagina.getByTestId('orcamento-000042').click();
await pagina.getByTestId('aviso-pedido').waitFor();
await pagina.waitForTimeout(400);
await pagina.screenshot({ path: join(AQUI, 'folha-confirmacao.png') });
await abrir('vazio');
await pagina.screenshot({ path: join(AQUI, 'folha-vazio.png') });
await navegador.close();
