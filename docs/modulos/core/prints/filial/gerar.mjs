// Prints das telas de filial em Usuários do BKO (T-0176): a UsuariosConteudo real, com dublês só de rota, de dados e de sessão em _src/.
// Uso, na raiz: MACUXI_CHROMIUM=/opt/pw-browsers/chromium node docs/modulos/core/prints/filial/gerar.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.cwd();
const SRC = join(AQUI, '_src');
const require = createRequire(join(RAIZ, 'package.json'));
const esbuild = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { chromium } = require('playwright');

const ttf = (pacote, peso, arq) => join(RAIZ, 'node_modules/@expo-google-fonts', pacote, peso, arq);
const FONTES = [
  ['Archivo', 800, ttf('archivo', '800ExtraBold', 'Archivo_800ExtraBold.ttf')],
  ['Archivo', 700, ttf('archivo', '700Bold', 'Archivo_700Bold.ttf')],
  ['IBM Plex Sans', 400, ttf('ibm-plex-sans', '400Regular', 'IBMPlexSans_400Regular.ttf')],
  ['IBM Plex Sans', 500, ttf('ibm-plex-sans', '500Medium', 'IBMPlexSans_500Medium.ttf')],
  ['IBM Plex Sans', 600, ttf('ibm-plex-sans', '600SemiBold', 'IBMPlexSans_600SemiBold.ttf')],
  ['IBM Plex Sans', 700, ttf('ibm-plex-sans', '700Bold', 'IBMPlexSans_700Bold.ttf')],
];
const fontes = FONTES.map(([f, p, a]) => `@font-face{font-family:'${f}';font-weight:${p};src:url(file://${a})}`).join('\n');

const saida = join(SRC, '_saida');
mkdirSync(saida, { recursive: true });
const por = (re, destino) => ({ name: `por-${destino}`, setup: (b) => b.onResolve({ filter: re }, () => ({ path: join(SRC, destino) })) });
await esbuild.build({
  entryPoints: [join(SRC, 'main.tsx')],
  bundle: true,
  outfile: join(saida, 'app.js'),
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@core': join(RAIZ, 'modules/core') },
  nodePaths: [join(RAIZ, 'node_modules')],
  plugins: [por(/^next\/navigation$/, 'mock-navegacao.ts'), por(/^@macuxi\/platform-sdk\/web$/, 'mock-sdk-web.ts'), por(/^@macuxi\/platform-sdk\/react$/, 'mock-sdk-react.ts'), por(/lib\/queries$/, 'mock-queries.ts')],
  logLevel: 'error',
});

// CSS do BKO: os tokens de apps/web/app/globals.css, com as classes das páginas do Core e do kit de UI
const globais = readFileSync(join(RAIZ, 'apps/web/app/globals.css'), 'utf8')
  .split('/* ---------- mapa de rotas')[0]
  .replace(/@source '\.\.\/\.\.\/\.\.\/packages[^\n]*\n/, `@source '${join(RAIZ, 'packages/ui/src/web')}/**/*.tsx';\n`)
  .replace(/@source '\.\.\/\.\.\/\.\.\/modules[^\n]*\n/, `@source '${join(RAIZ, 'modules/core/web/components/usuarios')}/*.tsx';\n`);
const css = (await postcss([tailwind({ base: RAIZ })]).process(globais, { from: join(RAIZ, 'apps/web/app/globals.css') })).css;
writeFileSync(join(saida, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${fontes}\n${css}\n:root{--font-plex-sans:'IBM Plex Sans';--font-archivo:'Archivo'}</style><div id="raiz"></div><script src="app.js"></script>`);

// [arquivo, query da tela, passo, textos que precisam aparecer, textos que não podem aparecer]
const PRINTS = [
  ['usuarios-lista.png', '', null, ['Filial', 'Código FDV', '00001', 'Provisório', 'Sem filial', 'Boa Vista', '2 usuários sem filial de cadastro não entram no app.', 'Ver os 2'], []],
  ['usuarios-sem-filial.png', '?filial=sem', null, ['Filial de cadastro', 'Diego Matos', 'Paulo Brito'], ['Ver os 2', 'Carla Souza', 'Rita Alves']],
  ['usuario-editar-filiais.png', '', 'gaveta', ['Editar usuário', 'Filial de cadastro', 'Filiais de venda', 'filial de cadastro', 'Belém', 'Santarém'], []],
  ['usuario-editar-codigo-fdv.png', '', 'gaveta-fim', ['Código FDV', '00001', 'Código no ERP', 'Vincular vendedor do ERP'], ['Desvincular']],
  ['vincular-escolher.png', '', 'vincular', ['Escolha o vendedor provisório que é Carla Souza.', 'V-0142', 'V-0177', 'Continuar'], []],
  ['vincular-confirmar.png', '', 'vincular-confirmar', ['Vincular o provisório V-0142 a Carla Souza?', 'Voltar'], []],
];
const navegador = await chromium.launch(process.env.MACUXI_CHROMIUM ? { executablePath: process.env.MACUXI_CHROMIUM } : undefined);
let falhas = 0;
for (const [arq, query, passo, deve, nao] of PRINTS) {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const erros = [];
  pagina.on('pageerror', (e) => erros.push(e.message));
  await pagina.goto(`file://${join(saida, 'index.html')}${query}`);
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.getByText('Rita Alves').first().waitFor({ timeout: 10000 }).catch(() => undefined);
  if (passo?.startsWith('gaveta') || passo?.startsWith('vincular')) {
    await pagina.locator('[data-testid="usuarios.menu.a0000000-0000-4000-8000-000000000001"]').click();
    await pagina.getByText('Editar', { exact: true }).click();
    // a filial de cadastro da Carla (Boa Vista) já vem escolhida; Manaus e Porto Velho marcadas
    await pagina.waitForTimeout(600);
    if (passo !== 'gaveta') {
      await pagina.locator('[data-testid="usuarios.vincular"]').scrollIntoViewIfNeeded();
      if (passo.startsWith('vincular')) {
        await pagina.locator('[data-testid="usuarios.vincular"]').click();
        await pagina.locator('input[name="provisorio"]').first().check();
        if (passo === 'vincular-confirmar') await pagina.locator('[data-testid="usuarios.vincular-continuar"]').click();
      }
    }
  }
  await pagina.waitForTimeout(500);
  const texto = await pagina.evaluate(() => document.body.innerText);
  for (const t of deve) if (!texto.includes(t)) (falhas++, console.error(`${arq}: falta "${t}"`));
  for (const t of nao) if (texto.includes(t)) (falhas++, console.error(`${arq}: sobrou "${t}"`));
  for (const e of erros) (falhas++, console.error(`${arq}: erro de página: ${e}`));
  await pagina.screenshot({ path: join(AQUI, arq) });
  await pagina.close();
}
await navegador.close();
if (falhas) process.exit(1);
console.log('prints gerados');
