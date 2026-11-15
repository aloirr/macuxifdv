/**
 * Regressão de "tabela dentro de tabela" no BKO (T-0081; sugestão do designer-ux na entrega R-20261105-072330).
 *
 * O `TableScroll` do kit (packages/ui/src/web/ui.tsx + tabela.ts) aceita o miolo (`<thead>`/`<tbody>`), que ele
 * embrulha no próprio `<table>`, ou um `<table>` pronto como ÚNICO filho, que ele reaproveita (cloneElement). Qualquer
 * outro jeito de passar uma tabela (fragmento, tabela ao lado de outro filho, componente que devolve `<table>`) volta a
 * gerar `<table><table>`: HTML inválido que quebra a hidratação do Next.
 *
 * Duas camadas, baratas e estáveis (sem navegador, sem banco; rodam no PC e no CI):
 * 1. Renderização (react-dom/server) do `TableScroll` REAL com os padrões das telas: o HTML nunca tem `table` dentro de
 *    `table`.
 * 2. Varredura do fonte de TODAS as páginas do BKO (modules/<m>/web, apps/web, packages/ui/src/web) pela AST do
 *    TypeScript: todo `<TableScroll>` recebe ou o miolo ou um `<table>` sozinho; nenhum `<table>` tem `<table>` dentro; e
 *    nenhum componente que devolve `<table>` é posto dentro de `<TableScroll>`. O verificador é testado antes com
 *    exemplos ruins (senão a varredura poderia passar no vazio).
 * A conferência no DOM de verdade (`table table` com dados da demo) fica no e2e D-B31 de tests/e2e/bko/demo-bko.spec.ts.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { TableScroll } from '../../packages/ui/src/web/ui';

const RAIZ = join(__dirname, '../..');

// ------------------------------------------------------------------------------------------------ verificador (AST)

interface Achado {
  arquivo: string;
  linha: number;
  motivo: string;
}

type NoJsx = ts.JsxElement | ts.JsxSelfClosingElement;

const nomeDaTag = (n: NoJsx): string => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText();
const ehJsx = (n: ts.Node): n is NoJsx => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);

/** Elementos JSX dentro de `n` (inclusive ele), descendo por expressões (map, condicionais, fragmentos). */
function elementosJsx(n: ts.Node): NoJsx[] {
  const r: NoJsx[] = [];
  const andar = (x: ts.Node) => {
    if (ehJsx(x)) r.push(x);
    ts.forEachChild(x, andar);
  };
  andar(n);
  return r;
}

/** Componentes (nome com maiúscula) cujo retorno é um `<table>`: postos no TableScroll, o kit não os reconhece. */
function componentesQueDevolvemTabela(fonte: ts.SourceFile): Set<string> {
  const nomes = new Set<string>();
  const devolveTabela = (corpo: ts.Node | undefined): boolean => {
    if (!corpo) return false;
    const ehTabela = (e: ts.Expression | undefined): boolean => {
      let x = e;
      while (x && ts.isParenthesizedExpression(x)) x = x.expression;
      return !!x && ehJsx(x) && nomeDaTag(x) === 'table';
    };
    if (!ts.isBlock(corpo)) return ehTabela(corpo as ts.Expression);
    let achou = false;
    const andar = (x: ts.Node) => {
      if (ts.isFunctionLike(x)) return; // funções internas não contam
      if (ts.isReturnStatement(x) && ehTabela(x.expression)) achou = true;
      ts.forEachChild(x, andar);
    };
    ts.forEachChild(corpo, andar);
    return achou;
  };
  const visitar = (x: ts.Node) => {
    if (ts.isFunctionDeclaration(x) && x.name && /^[A-Z]/.test(x.name.text) && devolveTabela(x.body)) nomes.add(x.name.text);
    if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && /^[A-Z]/.test(x.name.text) && x.initializer) {
      const f = x.initializer;
      if ((ts.isArrowFunction(f) || ts.isFunctionExpression(f)) && devolveTabela(f.body)) nomes.add(x.name.text);
    }
    ts.forEachChild(x, visitar);
  };
  visitar(fonte);
  return nomes;
}

/** Resultados possíveis de uma expressão JSX `{...}` filha única: ramos de `?:`, `&&`, `||`, `??` e parênteses. */
function ramos(e: ts.Expression): ts.Expression[] {
  if (ts.isParenthesizedExpression(e)) return ramos(e.expression);
  if (ts.isConditionalExpression(e)) return [...ramos(e.whenTrue), ...ramos(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return ramos(e.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return [...ramos(e.left), ...ramos(e.right)];
  }
  return [e];
}

/**
 * Confere um arquivo .tsx. `componentesTabela` = nomes (de todo o BKO) de componentes que devolvem `<table>`.
 * Devolve os achados e quantos `<TableScroll>` havia (para o teste não passar no vazio).
 */
function verificarFonte(arquivo: string, texto: string, componentesTabela: ReadonlySet<string>): { achados: Achado[]; usos: number } {
  const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const achados: Achado[] = [];
  let usos = 0;
  const marcar = (n: ts.Node, motivo: string) => achados.push({ arquivo, linha: fonte.getLineAndCharacterOfPosition(n.getStart()).line + 1, motivo });
  const produzTabela = (n: ts.Node): NoJsx | undefined =>
    elementosJsx(n).find((x) => nomeDaTag(x) === 'table' || componentesTabela.has(nomeDaTag(x)));

  const visitar = (n: ts.Node) => {
    // regra geral: <table> com <table> dentro, no mesmo JSX
    if (ehJsx(n) && nomeDaTag(n) === 'table' && ts.isJsxElement(n)) {
      for (const filho of n.children) {
        const t = produzTabela(filho);
        if (t) marcar(t, '<table> dentro de <table>');
      }
    }
    if (ts.isJsxElement(n) && nomeDaTag(n) === 'TableScroll') {
      usos += 1;
      const filhos = n.children.filter(
        (c) => !(ts.isJsxText(c) && c.containsOnlyTriviaWhiteSpaces) && !(ts.isJsxExpression(c) && !c.expression),
      );
      const [unico] = filhos;
      if (filhos.length === 1 && unico && ehJsx(unico) && nomeDaTag(unico) === 'table') {
        // <table> pronto e sozinho: o kit reaproveita. Só confere o que vai dentro dele (regra geral acima).
      } else if (filhos.length === 1 && unico && ts.isJsxExpression(unico) && unico.expression) {
        for (const r of ramos(unico.expression)) {
          if (ehJsx(r) && nomeDaTag(r) === 'table') continue; // ramo que devolve o <table> sozinho
          const t = produzTabela(r);
          if (t) marcar(t, `<TableScroll> com tabela que o kit não reaproveita (${nomeDaTag(t)} dentro de expressão/fragmento)`);
        }
      } else {
        for (const f of filhos) {
          const t = produzTabela(f);
          if (t)
            marcar(
              t,
              componentesTabela.has(nomeDaTag(t))
                ? `<TableScroll> com o componente ${nomeDaTag(t)}, que devolve <table>: o kit embrulha em outro <table>`
                : '<TableScroll> com <table> que não é o único filho (fragmento ou ao lado de outro filho): vira tabela dentro de tabela',
            );
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fonte);
  return { achados, usos };
}

// ------------------------------------------------------------------------------------------------ fontes do BKO

function arquivosTsx(dir: string, saida: string[] = []): string[] {
  let nomes: string[];
  try {
    nomes = readdirSync(dir);
  } catch {
    return saida;
  }
  for (const n of nomes) {
    if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivosTsx(p, saida);
    else if (n.endsWith('.tsx') && !/\.test\.tsx$/.test(n)) saida.push(p);
  }
  return saida;
}

const MODULOS = readdirSync(join(RAIZ, 'modules')).filter((m) => statSync(join(RAIZ, 'modules', m)).isDirectory());
const FONTES = [
  ...MODULOS.flatMap((m) => arquivosTsx(join(RAIZ, 'modules', m, 'web'))),
  ...arquivosTsx(join(RAIZ, 'apps/web/app')),
  ...arquivosTsx(join(RAIZ, 'apps/web/components')),
  ...arquivosTsx(join(RAIZ, 'apps/web/lib')),
  ...arquivosTsx(join(RAIZ, 'packages/ui/src/web')),
].map((p) => ({ arquivo: relative(RAIZ, p).replace(/\\/g, '/'), texto: readFileSync(p, 'utf8') }));

const COMPONENTES_TABELA = new Set(
  FONTES.flatMap(({ arquivo, texto }) => [...componentesQueDevolvemTabela(ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))]),
);

// ------------------------------------------------------------------------------------------------ casos

/** `<table` dentro de outro `<table` ainda aberto, no HTML renderizado. */
function tabelaAninhada(html: string): boolean {
  let abertas = 0;
  for (const m of html.matchAll(/<(\/?)table\b/g)) {
    if (m[1]) abertas -= 1;
    else {
      if (abertas > 0) return true;
      abertas += 1;
    }
  }
  return false;
}

const miolo = (): ReactNode[] => [
  createElement('thead', { key: 'h' }, createElement('tr', null, createElement('th', null, 'Cliente'))),
  createElement('tbody', { key: 'b' }, createElement('tr', null, createElement('td', null, 'Mercado Bom Preço'))),
];

describe('BKO sem tabela dentro de tabela (T-0081; R-20261105-072330)', () => {
  describe('TableScroll real renderizado (react-dom/server)', () => {
    it.each([
      ['<table> pronto como único filho', () => createElement('table', { 'data-testid': 'x.tabela', className: 'w-full' }, ...miolo())],
      ['<table> pronto ao lado de nulos (condicional falsa)', () => [null, false, createElement('table', { key: 't' }, ...miolo())]],
      ['miolo (<thead>/<tbody>)', () => miolo()],
    ] as const)('%s: um <table> só, sem aninhar', (_nome, filhos) => {
      const html = renderToStaticMarkup(createElement(TableScroll, { minWidth: 640, children: filhos() }));
      expect(tabelaAninhada(html), html).toBe(false);
      expect(html.match(/<table\b/g)).toHaveLength(1);
      expect(html).toMatch(/min-width:\s*640px/);
    });

    it('a tela que passa <table> pronto mantém o data-testid e as classes dela', () => {
      const html = renderToStaticMarkup(createElement(TableScroll, { minWidth: 500, children: createElement('table', { 'data-testid': 'farol.tabela', className: 'w-full x' }, ...miolo()) }));
      expect(html).toContain('data-testid="farol.tabela"');
      expect(html).toContain('class="w-full x"');
    });

    it('controle: <table> dentro de fragmento ainda aninha (é o padrão que a varredura do fonte recusa)', () => {
      const html = renderToStaticMarkup(createElement(TableScroll, { minWidth: 500, children: createElement(Fragment, null, createElement('table', null, ...miolo())) }));
      expect(tabelaAninhada(html)).toBe(true);
    });
  });

  describe('verificador do fonte (exemplos ruins precisam ser pegos)', () => {
    const tabela = new Set(['TabelaPronta']);
    const verificar = (jsx: string) => verificarFonte('exemplo.tsx', `export const X = () => (${jsx});`, tabela).achados.map((a) => a.motivo);

    it.each([
      ['<table> sozinho', '<TableScroll minWidth={500}><table data-testid="t"><tbody /></table></TableScroll>'],
      ['miolo', '<TableScroll minWidth={500}><thead><tr><th>a</th></tr></thead><tbody>{linhas.map((l) => <tr key={l} />)}</tbody></TableScroll>'],
      ['condicional que devolve o <table> sozinho', '<TableScroll minWidth={500}>{ok ? <table><tbody /></table> : null}</TableScroll>'],
      ['&& que devolve o <table> sozinho', '<TableScroll minWidth={500}>{ok && <table><tbody /></table>}</TableScroll>'],
    ])('aceita: %s', (_n, jsx) => {
      expect(verificar(jsx)).toEqual([]);
    });

    it.each([
      ['<table> em fragmento', '<TableScroll minWidth={500}><><table><tbody /></table></></TableScroll>'],
      ['<table> ao lado de outro filho', '<TableScroll minWidth={500}><caption>x</caption><table><tbody /></table></TableScroll>'],
      ['<table> dentro de <div>', '<TableScroll minWidth={500}><div><table><tbody /></table></div></TableScroll>'],
      ['componente que devolve <table>', '<TableScroll minWidth={500}><TabelaPronta /></TableScroll>'],
      ['condicional com fragmento', '<TableScroll minWidth={500}>{ok ? <><table /></> : null}</TableScroll>'],
      ['<table> dentro de <table>', '<table><tbody><tr><td><table /></td></tr></tbody></table>'],
    ])('recusa: %s', (_n, jsx) => {
      expect(verificar(jsx).length).toBeGreaterThan(0);
    });

    it('acha componente que devolve <table> (função e arrow)', () => {
      const f = ts.createSourceFile(
        'c.tsx',
        'function TabelaA() { if (x) return null; return (<table />); }\nconst TabelaB = () => <table><tbody /></table>;\nconst Outro = () => <div />;',
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      expect([...componentesQueDevolvemTabela(f)].sort()).toEqual(['TabelaA', 'TabelaB']);
    });
  });

  describe('varredura de todas as páginas do BKO', () => {
    // A guarda confere a regra, não um número: a revisão do BKO (T-0173) troca `TableScroll` + `<table>` à mão pela
    // `TabelaDados` do kit, e os usos do `TableScroll` caem de propósito a cada módulo revisado (32 → 28 no #298).
    // "Não passar no vazio" = a varredura lê todas as raízes do BKO, enxerga as tabelas das telas e conta cada
    // `<TableScroll>` que o fonte tem (a AST não deixa escapar nenhum).
    it('acha as páginas e as tabelas do BKO, e conta todo TableScroll do fonte (a varredura não passa no vazio)', () => {
      expect(FONTES.length).toBeGreaterThan(50);
      for (const raiz of ['modules/core/web/', 'apps/web/', 'packages/ui/src/web/'])
        expect(FONTES.some((f) => f.arquivo.startsWith(raiz)), raiz).toBe(true);
      // o próprio kit está na varredura (é onde o `<table>` do TableScroll e o da TabelaDados nascem)
      expect(FONTES.map((f) => f.arquivo)).toContain('packages/ui/src/web/ui.tsx');

      // piso baixo e estável: telas com tabela (TableScroll, TabelaDados ou <table>), qualquer que seja o jeito
      const TAGS_DE_TABELA = new Set(['table', 'TableScroll', 'TabelaDados']);
      const paginasComTabela = FONTES.filter((f) =>
        elementosJsx(ts.createSourceFile(f.arquivo, f.texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)).some((x) => TAGS_DE_TABELA.has(nomeDaTag(x))),
      );
      expect(paginasComTabela.length).toBeGreaterThanOrEqual(20);

      // a AST conta todo `<TableScroll>` com filhos que o texto do fonte tem (nenhum uso escapa da conferência)
      const usosNaAst = FONTES.reduce((n, f) => n + verificarFonte(f.arquivo, f.texto, COMPONENTES_TABELA).usos, 0);
      const usosNoTexto = FONTES.reduce((n, f) => n + (f.texto.match(/<TableScroll\b[^>]*[^/]>/g)?.length ?? 0), 0);
      expect(usosNaAst).toBe(usosNoTexto);
    });

    it('nenhuma página do BKO monta tabela dentro de tabela (TableScroll, componente de tabela ou <table> aninhado)', () => {
      const achados = FONTES.flatMap((f) => verificarFonte(f.arquivo, f.texto, COMPONENTES_TABELA).achados).map((a) => `${a.arquivo}:${a.linha} ${a.motivo}`);
      expect(achados).toEqual([]);
    });
  });
});
