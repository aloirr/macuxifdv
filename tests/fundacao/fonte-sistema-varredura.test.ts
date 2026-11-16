/**
 * Fonte do sistema v1.0.13 (R-20261115-110600; manual da marca §5.1) fora do kit.
 * A guarda do kit (packages/ui/src/mobile/fonte-sistema.test.ts) só olha packages/ui; esta varre o resto
 * do código de produção: telas dos módulos (app e web), shells (apps/*), PDFs (domain) e e-mails (api, comum).
 *
 * Critérios: nenhuma fonte carregada (Archivo, IBM Plex), nenhum `fontFamily: fonts.x` (o kit usa `...fonte.x`),
 * nenhum apelido da transição (`fonte.display`, `fonte.displayBold`, `title16`, `smallStrong`), nenhuma Roboto
 * Black (`sans-serif-black`, peso 800/900, `font-extrabold`/`font-black`) e nenhum texto abaixo de 12.
 * Sem exceções: defeito novo vira recado ao dono.
 * Entrada antecipada (v1.0.13): a guarda só vale depois da limpeza do kit (o `theme.ts` deixa de exportar `fonts`);
 * antes disso os PRs dos módulos ainda estão entrando e o `describe` fica pulado.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = resolve(__dirname, '..', '..');
const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', 'build', '.next', '.expo', '.turbo', 'android', 'ios', 'test', 'testes', '__tests__']);
const EXTENSOES = /\.(tsx?|mjs|css|html)$/;
const DE_TESTE = /\.(test|spec)\.(tsx?|mjs)$/;

function arquivos(pasta: string): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(pasta, { withFileTypes: true })) {
    const caminho = join(pasta, e.name);
    if (e.isDirectory()) {
      if (!PASTAS_IGNORADAS.has(e.name)) saida.push(...arquivos(caminho));
    } else if (EXTENSOES.test(e.name) && !DE_TESTE.test(e.name)) saida.push(caminho);
  }
  return saida;
}

const modulos = readdirSync(join(raiz, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(raiz, 'modules', d.name));
const RAIZES = [...modulos, join(raiz, 'apps'), join(raiz, 'packages', 'comum', 'src')];
const FONTES = RAIZES.flatMap(arquivos).map((a) => ({ arq: relative(raiz, a), linhas: readFileSync(a, 'utf8').split('\n') }));

interface Achado {
  arq: string;
  linha: number;
  trecho: string;
}

function procurar(teste: (linha: string) => string | null): Achado[] {
  const achados: Achado[] = [];
  for (const { arq, linhas } of FONTES) {
    linhas.forEach((l, i) => {
      const t = teste(l);
      if (t) achados.push({ arq, linha: i + 1, trecho: t });
    });
  }
  return achados;
}

const FONTE_PROIBIDA = [
  /Archivo/,
  /IBM Plex|Plex (Sans|Mono)/,
  /fontFamily: ?fonts\./,
  /\bfonte\.display(Bold)?\b/,
  /\btitle16\b/,
  /\bsmallStrong\b/,
  /sans-serif-black/,
  /fontWeight: ?['"]?(800|900)\b/,
  /font-weight: ?(800|900)\b/,
  /\bfont-(extrabold|black)\b/,
];

/** Tamanhos em px; rem/em a 16 px e pt a 4/3 px. Só literais: o que vem de token já passa pela guarda do kit. */
function tamanhosAbaixoDe12(linha: string): string | null {
  const ruins: string[] = [];
  const px = (n: string, u = 'px') => Number(n) * (u === 'rem' || u === 'em' ? 16 : u === 'pt' ? 4 / 3 : 1);
  for (const m of linha.matchAll(/fontSize: ?(?:[\w.]+ \? )?['"]?(\d+(?:\.\d+)?)(?:px)?['"]?(?: : ['"]?(\d+(?:\.\d+)?))?/g)) {
    for (const v of [m[1], m[2]].filter((x): x is string => Boolean(x))) if (px(v) < 12) ruins.push(m[0]);
  }
  for (const m of linha.matchAll(/text-\[(\d*\.?\d+)(px|rem|em)\]/g)) if (px(m[1]!, m[2]) < 12) ruins.push(m[0]);
  for (const m of linha.matchAll(/font-size: ?(\d*\.?\d+)(px|rem|em|pt)/g)) if (px(m[1]!, m[2]) < 12) ruins.push(m[0]);
  return ruins.length ? ruins.join(' · ') : null;
}

/** Limpeza do kit aplicada: `packages/ui/src/mobile/theme.ts` não exporta mais `fonts`. */
const LIMPEZA_APLICADA = !/export const fonts\b/.test(readFileSync(join(raiz, 'packages', 'ui', 'src', 'mobile', 'theme.ts'), 'utf8'));

const fmt = (as: Achado[]) => as.map((a) => `${a.arq}:${a.linha} — ${a.trecho}`);

const fontesProibidas = procurar((l) => FONTE_PROIBIDA.map((r) => l.match(r)?.[0]).filter(Boolean).join(' · ') || null);
const tamanhos = procurar(tamanhosAbaixoDe12);

describe.skipIf(!LIMPEZA_APLICADA)('fonte do sistema fora do kit: telas, shells, PDFs e e-mails (R-20261115-110600)', () => {
  it('a varredura enxerga o código de produção (módulos, apps e comum)', () => {
    const arqs = FONTES.map((f) => f.arq);
    for (const p of ['modules/vendedor/domain/pdf-pedido.ts', 'modules/core/web/', 'modules/vendedor/app/', 'apps/web/', 'apps/mobile/src/', 'packages/comum/src/']) {
      expect(arqs.some((a) => a.startsWith(p)), p).toBe(true);
    }
  });

  it('nenhum Archivo, IBM Plex, `fontFamily: fonts.x`, apelido da transição, Roboto Black ou peso 800/900', () => {
    expect(fmt(fontesProibidas)).toEqual([]);
  });

  it('nenhum tamanho de texto literal abaixo de 12 (dp no app, px na web, PDF e e-mail)', () => {
    expect(fmt(tamanhos)).toEqual([]);
  });

  it('a guarda pega o que deve pegar (casos de controle)', () => {
    expect(tamanhosAbaixoDe12('<p style={{ fontSize: 11 }}>')).not.toBeNull();
    expect(tamanhosAbaixoDe12("fontSize: compacto ? 12 : 10.5")).not.toBeNull();
    expect(tamanhosAbaixoDe12('className="text-[11px]"')).not.toBeNull();
    expect(tamanhosAbaixoDe12('th { font-size: 10.5px; }')).not.toBeNull();
    expect(tamanhosAbaixoDe12('.n { font-size: 8pt; }')).not.toBeNull();
    expect(tamanhosAbaixoDe12('fontSize: 12, x: text-[13px], font-size: 0.75rem')).toBeNull();
    for (const l of ['font-family: "IBM Plex Sans"', "fontFamily: fonts.display", "fontWeight: '800'", 'font-weight: 900', 'className="font-black"', '...fonte.display,', '...fonte.displayBold }', 'style={type.title16}', '...type.smallStrong']) {
      expect(FONTE_PROIBIDA.some((r) => r.test(l)), l).toBe(true);
    }
    expect(FONTE_PROIBIDA.some((r) => r.test('...fonte.titulo, fontWeight: "700", font-bold'))).toBe(false);
  });
});
