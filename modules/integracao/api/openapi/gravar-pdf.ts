/**
 * Gera `docs/guia-api-hub.pdf` (Guia da API em PDF) a partir do OpenAPI dos contratos e dos textos do guia.
 * Uso: `pnpm --filter @macuxi/integracao guia-pdf`. Regerar depois de mudar `ROTAS_HUB`, um contrato do Hub, um exemplo ou um texto
 * de `guia-pdf-textos.ts`; o teste de deriva (`guia-pdf.test.ts`) cobra isso pelo `docs/guia-api-hub.pdf.sha256`.
 * Chromium: usa `playwright` (ou o módulo indicado em `MACUXI_PLAYWRIGHT`, caminho do pacote); `MACUXI_CHROMIUM` aponta o executável quando a versão instalada difere da do pacote. Impressão por `page.pdf()` com @page de A4.
 * Os números do sumário saem dos destinos internos da própria impressão (`paginasDosDestinos`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gerarOpenApiHub } from './gerar';
import { entradasDoSumario, hashDoGuia, montarHtml, secoesDoGuia, type RecursosGuia } from './guia-pdf';

const aqui = (relativo: string) => fileURLToPath(new URL(relativo, import.meta.url));

const base64 = (arquivo: string) => readFileSync(arquivo).toString('base64');

function recursos(): RecursosGuia {
  // cópia do logo negativo aprovado (docs/marca/ativos/2026-11-12-v1): o pacote não lê fora de si (grafo do turbo, R2); atualizar junto com a marca
  const logo = `data:image/svg+xml;base64,${base64(aqui('./ativos/macuxi-logo-negativo-azul-noite.svg'))}`;
  return { logo };
}

/**
 * Página (de 1 em diante) onde começa cada destino interno (`id` das seções e dos grupos). Lê os destinos nomeados (`/Dests`) e a
 * árvore de páginas do PDF do Chromium: assim o sumário usa a paginação real da impressão final.
 */
export function paginasDosDestinos(pdf: Buffer): Record<string, number> {
  const texto = pdf.toString('latin1');
  const objetos = new Map<string, string>();
  for (const m of texto.matchAll(/(?:^|\n)(\d+) 0 obj\s*([\s\S]*?)\bendobj/g)) objetos.set(m[1] as string, m[2] as string);
  const folhas: string[] = [];
  const percorrer = (num: string): void => {
    const corpo = objetos.get(num) ?? '';
    if (/\/Type\s*\/Pages\b/.test(corpo)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(corpo)?.[1] ?? '';
      for (const k of kids.matchAll(/(\d+) 0 R/g)) percorrer(k[1] as string);
    } else if (/\/Type\s*\/Page\b/.test(corpo)) folhas.push(num);
  };
  const raiz = [...objetos].find(([, c]) => /\/Type\s*\/Pages\b/.test(c) && !/\/Parent\b/.test(c));
  if (!raiz) throw new Error('guia-pdf: árvore de páginas não encontrada no PDF');
  percorrer(raiz[0]);
  const destinos = /\/Dests\s+(\d+) 0 R/.exec(texto)?.[1];
  if (!destinos) throw new Error('guia-pdf: o PDF não tem destinos internos');
  const paginas: Record<string, number> = {};
  for (const m of (objetos.get(destinos) ?? '').matchAll(/\/([^\s/[]+)\s*\[(\d+) 0 R/g)) paginas[m[1] as string] = folhas.indexOf(m[2] as string) + 1;
  return paginas;
}

async function abrirChromium() {
  const caminho = process.env['MACUXI_PLAYWRIGHT'];
  const pw = (caminho ? createRequire(import.meta.url)(caminho) : await import('playwright')) as { chromium: { launch: (o?: { executablePath?: string }) => Promise<any> } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const executablePath = process.env['MACUXI_CHROMIUM'];
  return pw.chromium.launch(executablePath ? { executablePath } : undefined);
}

async function main() {
  const secoes = secoesDoGuia(gerarOpenApiHub());
  const rec = recursos();
  const browser = await abrirChromium();
  const pagina = await browser.newPage();
  const imprimir = async (html: string): Promise<Buffer> => {
    await pagina.setContent(html, { waitUntil: 'load' });
    await pagina.evaluate('document.fonts.ready');
    return pagina.pdf({ preferCSSPageSize: true, printBackground: true, outline: true, tagged: false });
  };
  try {
    const ids = entradasDoSumario(secoes);
    // 1ª impressão com números provisórios (mesma largura): a paginação real dá a página de cada entrada; a 2ª imprime com eles
    const provisorio = await imprimir(montarHtml(secoes, rec, { paginas: Object.fromEntries(ids.map((i) => [i, 99])) }));
    const paginas = paginasDosDestinos(provisorio);
    for (const id of ids) if (!paginas[id]) throw new Error(`guia-pdf: destino "${id}" não encontrado no PDF`);
    const pdf = await imprimir(montarHtml(secoes, rec, { paginas: Object.fromEntries(ids.map((i) => [i, paginas[i] as number])) }));
    const finais = paginasDosDestinos(pdf);
    for (const id of ids) if (finais[id] !== paginas[id]) throw new Error(`guia-pdf: o sumário previu a página ${paginas[id]} para "${id}" e o PDF a tem na ${finais[id]}`);
    writeFileSync(aqui('../../docs/guia-api-hub.pdf'), pdf);
    writeFileSync(aqui('../../docs/guia-api-hub.pdf.sha256'), `${hashDoGuia()}\n`, 'utf8');
    console.log(`guia-api-hub.pdf: ${(pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length} páginas`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
