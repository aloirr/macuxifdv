// Prints do check-in na ficha do cliente (T-0174, modulo-core). Empacota a TelaCliente REAL com esbuild + react-native-web, com dublês
// só de rota e de dados (_src/mock-*), as fontes do app (Archivo e IBM Plex Sans), 360 dp a 2x, hora fixa (14/11/2026 09:47 em Boa Vista),
// e confere por código que nenhum texto do rodapé, da faixa ou da folha sai cortado.
// Uso, na raiz: MACUXI_CHROMIUM=/opt/pw-browsers/chromium node docs/modulos/core/prints/checkin/gerar.mjs   (sem dependência nova)
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.cwd();
const SRC = join(AQUI, '_src');
const require = createRequire(join(RAIZ, 'package.json'));
const esbuild = require('esbuild');
const { chromium } = require('playwright');

const fonteTtf = (pacote, peso, arq) => join(RAIZ, 'node_modules/@expo-google-fonts', pacote, peso, arq);
const FONTES = [
  ['Archivo_800ExtraBold', fonteTtf('archivo', '800ExtraBold', 'Archivo_800ExtraBold.ttf')],
  ['Archivo_700Bold', fonteTtf('archivo', '700Bold', 'Archivo_700Bold.ttf')],
  ['Archivo_600SemiBold', fonteTtf('archivo', '600SemiBold', 'Archivo_600SemiBold.ttf')],
  ['IBMPlexSans_400Regular', fonteTtf('ibm-plex-sans', '400Regular', 'IBMPlexSans_400Regular.ttf')],
  ['IBMPlexSans_500Medium', fonteTtf('ibm-plex-sans', '500Medium', 'IBMPlexSans_500Medium.ttf')],
  ['IBMPlexSans_600SemiBold', fonteTtf('ibm-plex-sans', '600SemiBold', 'IBMPlexSans_600SemiBold.ttf')],
  ['IBMPlexSans_700Bold', fonteTtf('ibm-plex-sans', '700Bold', 'IBMPlexSans_700Bold.ttf')],
];
const css = FONTES.map(([n, f]) => `@font-face{font-family:'${n}';src:url(file://${f})}`).join('\n');

const por = (re, destino) => ({ name: `por-${destino}`, setup: (b) => b.onResolve({ filter: re }, () => ({ path: join(SRC, destino) })) });
const plugins = [
  por(/lib\/usar-core$/, 'mock-usar-core.ts'),
  por(/lib\/usar-clientes-locais$/, 'mock-usar-clientes-locais.ts'),
  por(/lib\/acoes-visita$/, 'mock-acoes-visita.ts'),
  por(/components\/visit-sheets$|^\.\/visit-sheets$/, 'mock-visit-sheets.ts'),
  por(/^@macuxi\/platform-sdk\/react$/, 'mock-platform-sdk-react.ts'),
  por(/^expo-router$/, 'mock-expo-router.ts'),
  {
    name: 'ui-com-hook-trocado',
    setup(b) {
      b.onResolve({ filter: /^@macuxi\/ui\/mobile$/ }, () => ({ path: join(SRC, 'shim-ui.ts') }));
      b.onResolve({ filter: /^@ui-real$/ }, () => ({ path: join(RAIZ, 'packages/ui/src/mobile/index.ts') }));
    },
  },
];
const saida = join(SRC, '_saida');
mkdirSync(saida, { recursive: true });
await esbuild.build({
  entryPoints: [join(SRC, 'main.tsx')],
  bundle: true,
  outfile: join(saida, 'app.js'),
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'window' },
  loader: { '.ttf': 'file', '.png': 'file' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.mjs', '.cjs', '.json'],
  alias: { 'react-native-safe-area-context': join(SRC, 'shim-safe-area.tsx'), 'react-native': join(SRC, 'shim-rn.tsx'), '@core': join(RAIZ, 'modules/core') },
  nodePaths: [join(RAIZ, 'node_modules')],
  plugins,
  logLevel: 'error',
});
writeFileSync(join(saida, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;padding:0;background:#fff}#raiz{display:flex}</style><div id="raiz"></div><script src="app.js"></script>`);

// [arquivo, cenário, passo antes do print, textos que precisam aparecer]
const PRINTS = [
  ['ficha-checkin-pesquisa-pedido.png', 'checkin', null, ['Check-in', 'Pesquisa', 'Novo pedido']],
  ['ficha-checkout-pesquisa-pedido.png', 'checkout', null, ['Em atendimento · desde 09:12', 'Checkout', 'Pesquisa', 'Novo pedido']],
  ['ficha-checkin-bloqueado.png', 'bloqueado', null, ['EM ATENDIMENTO', 'desde 09:12', 'Supermercado Pérola', 'há 35 min', 'Check-in', 'Pesquisa', 'Novo pedido']],
  ['folha-checkin-gps.png', 'folha-gps', 'customer-checkin', ['Check-in às 09:12', 'Continuar']],
  ['folha-checkin-sem-gps.png', 'folha-sem-gps', 'customer-checkin', ['Check-in às 09:12', 'Sem GPS neste check-in', 'Continuar']],
  ['aba-performance.png', 'checkin', 'Performance', ['Visitas', '37', 'Última visita', '12/11/2026', 'Ana Souza']],
  ['gestao-ficha-checkin-pesquisa.png', 'gestao', null, ['Check-in', 'Pesquisa']],
];
const L = 360;
const A = 640;
const navegador = await chromium.launch(process.env.MACUXI_CHROMIUM ? { executablePath: process.env.MACUXI_CHROMIUM } : undefined);
let falhas = 0;
for (const [arq, c, passo, textos] of PRINTS) {
  const pagina = await navegador.newPage({ viewport: { width: L, height: A }, deviceScaleFactor: 2 });
  // relógio adiantado para 14/11/2026 09:47 em Boa Vista, mas andando (o Animated mede o tempo pelo Date.now; parado, a folha não sobe)
  await pagina.addInitScript(() => {
    const D = Date;
    const desvio = D.parse('2026-11-14T13:47:00.000Z') - D.now();
    globalThis.Date = class extends D {
      constructor(...a) {
        super(...(a.length ? a : [D.now() + desvio]));
      }
      static now() {
        return D.now() + desvio;
      }
    };
  });
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  await pagina.goto(`file://${join(saida, 'index.html')}?${new URLSearchParams({ t: `${L}x${A}`, c })}`);
  await pagina.evaluate(() => document.fonts.ready);
  if (passo === 'Performance') await pagina.getByText('Performance', { exact: true }).click();
  else if (passo) await pagina.locator(`[data-testid="${passo}"]`).click();
  await pagina.waitForTimeout(1500);
  const r = await pagina.evaluate((textos) => {
    // só conta o texto visível dentro da tela (a folha precisa ter subido)
    const visivel = [...document.querySelectorAll('div, span')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return e.childElementCount === 0 && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight + 0.5 && getComputedStyle(e).visibility !== 'hidden';
      })
      .map((e) => e.textContent)
      .join('\n');
    const faltando = textos.filter((t) => !visivel.includes(t));
    // texto cortado: elemento de texto mais largo que a própria caixa ou passando da borda da tela (as abas rolam de propósito)
    const abas = document.querySelector('[data-testid="abas-cliente"]');
    const cortados = [...document.querySelectorAll('div[dir="auto"], span')]
      .filter((e) => e.childElementCount === 0 && e.textContent.trim() && !(abas && abas.contains(e)))
      .filter((e) => {
        const b = e.getBoundingClientRect();
        if (b.width === 0) return false;
        const cs = getComputedStyle(e);
        return e.scrollWidth > e.clientWidth + 1 && cs.textOverflow === 'ellipsis' ? !/cliente desde/.test(e.textContent) : b.right > innerWidth + 0.5 || b.left < -0.5;
      })
      .map((e) => e.textContent.trim());
    return { faltando, cortados };
  }, textos);
  await pagina.screenshot({ path: join(AQUI, arq) });
  const ok = !erros.length && !r.faltando.length && !r.cortados.length;
  if (!ok) falhas++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${arq}${erros.length ? ` erros: ${erros.join(' | ')}` : ''}${r.faltando.length ? ` faltando: ${r.faltando.join(', ')}` : ''}${r.cortados.length ? ` cortados: ${r.cortados.join(', ')}` : ''}`);
  await pagina.close();
}
await navegador.close();
process.exit(falhas ? 1 : 0);
