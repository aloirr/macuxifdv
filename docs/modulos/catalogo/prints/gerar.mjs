// Prints (360x800, deviceScaleFactor 2) da tela REAL do Catálogo: componentes do app em react-native-web, fontes do app.
// Uso, na raiz: node docs/modulos/catalogo/prints/gerar.mjs  (saída nesta pasta). Nomes e números são fictícios.
// Só expo-router e @macuxi/platform-sdk/react são trocados por stubs (pasta stubs/) para entregar os dados da ficha.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '../../../..');
const req = createRequire(join(RAIZ, 'package.json'));
const esbuild = req('esbuild');
const { chromium } = req('playwright');
const FONTES = join(RAIZ, 'apps/web/app/fonts');
const pasta = mkdtempSync(join(tmpdir(), 'print-catalogo-'));

await esbuild.build({
  entryPoints: [join(AQUI, 'entrada.tsx')],
  bundle: true,
  outfile: join(pasta, 'app.js'),
  format: 'iife',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl', '.ttf': 'dataurl' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.json'],
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import'],
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  alias: {
    'react-native': join(AQUI, 'stubs/react-native.ts'),
    'expo-router': join(AQUI, 'stubs/expo-router.ts'),
    '@macuxi/platform-sdk/react': join(AQUI, 'stubs/platform-sdk-react.ts'),
  },
  nodePaths: [join(RAIZ, 'node_modules')],
  logLevel: 'warning',
});

const familias = ['Archivo_600SemiBold', 'Archivo_700Bold', 'Archivo_800ExtraBold', 'IBMPlexMono_500Medium', 'IBMPlexSans_400Regular', 'IBMPlexSans_500Medium', 'IBMPlexSans_600SemiBold', 'IBMPlexSans_700Bold'];
const css = familias.map((f) => `@font-face{font-family:${f};src:url(file://${FONTES}/${f}.ttf)}`).join('\n');
writeFileSync(join(pasta, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${css}
html,body,#raiz{margin:0;width:360px;height:800px;overflow:hidden}</style><div id="raiz"></div><script src="app.js"></script>`);

const navegador = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
const pagina = await navegador.newPage({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
pagina.on('pageerror', (e) => console.error('erro na página:', e.message));
for (const [nome, tela, alvo] of [['ficha-copiar-codigo', 'ficha', 'catalogo-copiar-codigo-AGU-1500'], ['cartao-grade', 'cartao', 'catalogo-item-AGU-1500']]) {
  await pagina.goto(`file://${join(pasta, 'index.html')}?tela=${tela}`);
  await pagina.waitForSelector(`[data-testid="${alvo}"]`);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForTimeout(300);
  // Conferência de corte: texto maior que a própria caixa, ou peça que passa da borda do cartão (ou da tela, na ficha).
  const cortados = await pagina.evaluate(() => {
    const fora = [];
    for (const el of document.querySelectorAll('div')) {
      if (el.childElementCount === 0 && el.textContent && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) fora.push(`texto: ${el.textContent}`);
    }
    const caixas = [...document.querySelectorAll('[data-testid^="catalogo-item-"]')];
    for (const caixa of caixas.length ? caixas : [document.body]) {
      const c = caixa.getBoundingClientRect();
      for (const el of caixa.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) fora.push(`fora da caixa: ${el.getAttribute("data-testid") ?? el.textContent?.slice(0, 40) ?? el.tagName} (${r.left.toFixed(1)}–${r.right.toFixed(1)} em ${c.left.toFixed(1)}–${c.right.toFixed(1)})`);
      }
    }
    return fora;
  });
  console.log(nome, cortados.length ? `cortados: ${JSON.stringify(cortados)}` : 'sem texto cortado');
  await pagina.screenshot({ path: join(AQUI, `${nome}.png`) });
}
await navegador.close();
