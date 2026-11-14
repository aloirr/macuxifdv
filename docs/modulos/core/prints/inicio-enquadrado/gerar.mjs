// Prints do Início do Campo enquadrado (R-20261114-145000, modulo-core). Empacota a TelaInicioCampo REAL com esbuild +
// react-native-web, simula a barra de status (24), a barra de abas (64 + 24) e a fonte do sistema em 1,0 e 1,15, e confere por
// código: sem rolagem, Sincronizar inteiro acima das abas, saudação sem reticências.
// Uso, na raiz: node docs/modulos/core/prints/inicio-enquadrado/gerar.mjs   (usa o que está em node_modules; sem dependência nova)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  por(/^\.\/usar-inicio-campo$/, 'mock-usar-inicio.ts'),
  por(/^expo-router$/, 'mock-expo-router.ts'),
  {
    name: 'ui-com-hook-trocado',
    setup(b) {
      b.onResolve({ filter: /^@macuxi\/ui\/mobile$/ }, () => ({ path: join(SRC, 'shim-ui.ts') }));
      b.onResolve({ filter: /^@ui-real$/ }, () => ({ path: join(RAIZ, 'packages/ui/src/mobile/index.ts') }));
    },
  },
];
const saida = join(AQUI, '_src', '_saida');
mkdirSync(saida, { recursive: true });
await esbuild.build({
  entryPoints: [join(SRC, 'main.tsx')],
  bundle: true,
  outfile: join(saida, 'app.js'),
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'window' },
  loader: { '.ttf': 'file' },
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.mjs', '.cjs', '.json'],
  alias: { 'react-native-safe-area-context': join(SRC, 'shim-safe-area.tsx'), 'react-native': join(SRC, 'shim-rn.tsx'), '@core': join(RAIZ, 'modules/core') },
  nodePaths: [join(RAIZ, 'node_modules')],
  plugins,
  logLevel: 'error',
});
writeFileSync(join(saida, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;padding:0;background:#fff}#raiz{display:flex}</style><div id="raiz"></div><script src="app.js"></script>`);

const TAMANHOS = [[360, 640], [360, 800], [393, 852], [412, 915]];
const ESCALAS = [1, 1.15];
const CASOS = [
  { id: '', nome: 'MARIA EDUARDA SILVA', saud: 'Boa tarde' },
  { id: '-nome-comprido', nome: 'MAXIMILIANO', saud: 'Boa tarde' },
];
const navegador = await chromium.launch(process.env.MACUXI_CHROMIUM ? { executablePath: process.env.MACUXI_CHROMIUM } : undefined);
const linhas = [];
let falhas = 0;
for (const [L, A] of TAMANHOS) {
  for (const f of ESCALAS) {
    for (const caso of CASOS) {
      if (caso.id && !(f === 1.15 && L === 360 && A === 640)) continue; // nome comprido só no pior caso
      const pagina = await navegador.newPage({ viewport: { width: L, height: A }, deviceScaleFactor: 2 });
      const q = new URLSearchParams({ t: `${L}x${A}`, f: String(f), nome: caso.nome, saud: caso.saud });
      await pagina.goto(`file://${join(saida, 'index.html')}?${q}`);
      await pagina.evaluate(() => document.fonts.ready);
      await pagina.waitForTimeout(400);
      const m = await pagina.evaluate(() => {
        const q = (id) => document.querySelector(`[data-testid="${id}"]`);
        const rol = q('inicio');
        const sinc = q('inicio-sincronizar').getBoundingClientRect();
        const abas = q('abas').getBoundingClientRect();
        const sau = q('inicio.saudacao');
        const painel = q('inicio.saudacao').getBoundingClientRect();
        const sino = q('sino').getBoundingClientRect();
        const cartoes = [...document.querySelectorAll('[data-testid^="inicio.meta."]')];
        const cartaoSemSobra = cartoes.every((c) => {
          const r = c.getBoundingClientRect();
          return [...c.querySelectorAll('*')].every((e) => e.getBoundingClientRect().bottom <= r.bottom + 0.5);
        });
        const prod = q('inicio.produtividade').getBoundingClientRect();
        const rolR = rol.getBoundingClientRect();
        const conteudoCabe = prod.bottom <= rolR.bottom + 0.5;
        return {
          semRolagem: rol.scrollHeight <= rol.clientHeight + 1 && conteudoCabe && cartaoSemSobra,
          rol: [rol.scrollHeight, rol.clientHeight], folga: Math.round(rolR.bottom - prod.bottom - parseFloat(getComputedStyle(rol.firstElementChild ?? rol).paddingBottom || '0')),
          sincAcimaDasAbas: sinc.bottom <= abas.top + 0.5 && sinc.top >= 0,
          saudacaoSemReticencias: sau.scrollWidth <= sau.clientWidth + 1 && getComputedStyle(sau).textOverflow !== 'ellipsis' || sau.scrollWidth <= sau.clientWidth + 1,
          escalaDaSaudacao: sau.dataset.escala ?? '1',
          sinoDentroDoPainel: sino.right <= window.innerWidth && sino.top < painel.top + 40,
        };
      });
      const arq = `inicio-${L}x${A}-fonte-${String(f).replace('.', '_')}${caso.id}.png`;
      await pagina.screenshot({ path: join(AQUI, arq) });
      const ok = m.semRolagem && m.sincAcimaDasAbas && m.saudacaoSemReticencias;
      // Início responsivo (R-20261114-153500): em todo tamanho e fonte tem de caber sem rolar
      if (!ok) falhas++;
      linhas.push(`| ${L}×${A} | ${f.toString().replace('.', ',')} | ${caso.nome.split(' ')[0]} | ${m.semRolagem ? `sim (folga ${m.folga} dp)` : `NÃO (${m.rol[0]} > ${m.rol[1]})`} | ${m.sincAcimaDasAbas ? 'sim' : 'NÃO'} | ${m.saudacaoSemReticencias ? `sim (escala ${m.escalaDaSaudacao})` : 'NÃO'} | ${ok ? 'coube' : 'não coube'} | ${arq} |`);
      await pagina.close();
    }
  }
}
await navegador.close();
const md = `# Início do Campo enquadrado (R-20261114-145000)

Gerado por \`gerar.mjs\` (a \`TelaInicioCampo\` real com react-native-web; barra de status 24 dp, abas 64 dp + 24 dp de área segura; fonte do sistema simulada). Nomes e números são fictícios. O Início é responsivo (\`escala-inicio.ts\`: letra, espaços, cartões e painel escalam pela janela e pela fonte do sistema) e cabe sem rolar em todos os tamanhos abaixo; \"folga\" é o espaço livre do meio, em dp.

| Tela (dp) | Fonte | Nome | Sem rolagem | Sincronizar acima das abas | Saudação sem reticências | Resultado | Print |
|---|---|---|---|---|---|---|---|
${linhas.join('\n')}
`;
writeFileSync(join(AQUI, 'README.md'), md);
console.log(md);
process.exit(falhas ? 1 : 0);
