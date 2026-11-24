/**
 * v1.0.34 — DEFEITO B(b) do teste de campo do APK v1.0.32 (R-20261124-094002): BKO › Parâmetros mostra código interno ao cliente
 * (ex.: o cadeado de "Perfil base" dizia "O perfil base não muda depois de criado (RN-CORE-35)."). Regra: nenhum texto VISÍVEL das telas
 * de Parâmetros traz RN-, RF-, RD-, T-nnnn ou ADR (comentário de código pode).
 * As constantes dos cadeados (`CADEADO`, packages/ui/src/web/perfis.ts) ficam no teste delas, packages/ui/src/web/perfis.test.ts.
 * 1. Cadeado que vem do SDK (`travaDaChave`, packages/platform-sdk/src/permissoes-perfil.ts): todo perfil base × toda chave do catálogo.
 * 2. Rótulo de cada permissão da página Perfis de acesso (`rotuloDaChave` sobre o catálogo REAL: plataforma + ações dos 8 manifestos).
 * 3. Varredura pela AST de toda a árvore de Parâmetros: apps/web/components/parametros-page.tsx + os componentes dos `paineisParametros`
 *    e as páginas `parametros/<secao>` de cada modules/<m>/web/index.ts, seguindo os imports da camada web e o que importam de
 *    @macuxi/ui/web. Conta literal de texto e de JSX; ignora comentários, comparação (`e.code === 'RN-…'`) e chaves técnicas
 *    (`regra`, `codigo`, `code`, `testID`, `acao`...).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { catalogoDePermissoes, PERFIS, travaDaChave } from '@macuxi/platform-sdk';

import { rotuloDaChave } from '../../modules/core/web/lib/perfis';

const RAIZ = join(__dirname, '../..');
/** Código interno que não pode aparecer ao cliente. */
const CODIGO_INTERNO = /\b(RN|RF|RD)-|\bT-\d{4}\b|\bADR\b/;
const MANIFESTOS = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];

describe('v1.0.34 B(b) — textos dos cadeados e das permissões de Parâmetros › Acesso sem código interno', () => {
  it('cadeado do SDK (`travaDaChave`): nenhuma mensagem com código, em nenhum perfil base × chave do catálogo', () => {
    const chaves = catalogoDePermissoes(MANIFESTOS).map((c) => c.chave);
    const ruins = new Set<string>();
    for (const base of PERFIS) for (const chave of chaves) {
      const t = travaDaChave(base, chave);
      if (t && CODIGO_INTERNO.test(t.mensagem)) ruins.add(t.mensagem);
    }
    expect([...ruins].sort()).toEqual([]);
  });

  it('rótulo de cada permissão na página Perfis de acesso (`rotuloDaChave` sobre o catálogo real) sem código', () => {
    const ruins = catalogoDePermissoes(MANIFESTOS)
      .map((c) => `${c.chave}: ${rotuloDaChave(c.chave, c.descricao)}`)
      .filter((t) => CODIGO_INTERNO.test(t.slice(t.indexOf(':') + 1)));
    expect(ruins).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ varredura pela AST

const sf = (f: string) => ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function resolver(de: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = resolve(dirname(de), spec);
  else if (spec.startsWith('@/')) base = join(RAIZ, 'apps/web', spec.slice(2));
  else return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}

/** Nome exportado → arquivo, em packages/ui/src/web e packages/ui/src/comum (o barril `@macuxi/ui/web` reexporta). */
function exportsDaUi(): Map<string, string> {
  const m = new Map<string, string>();
  const varrer = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { varrer(p); continue; }
      if (!/\.tsx?$/.test(f) || /\.test\./.test(f) || f === 'index.ts') continue;
      for (const st of sf(p).statements) {
        const exportado = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
        if (!exportado) continue;
        if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name) m.set(st.name.text, p);
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) m.set(d.name.text, p);
      }
    }
  };
  varrer(join(RAIZ, 'packages/ui/src/web'));
  varrer(join(RAIZ, 'packages/ui/src/comum'));
  return m;
}

/** Entradas: a página Parâmetros e, de cada modules/<m>/web/index.ts, os componentes de `paineisParametros` e das páginas `parametros/<secao>`. */
function entradasDeParametros(): string[] {
  const entradas = [join(RAIZ, 'apps/web/components/parametros-page.tsx')];
  for (const m of readdirSync(join(RAIZ, 'modules'))) {
    const idx = join(RAIZ, 'modules', m, 'web/index.ts');
    if (!existsSync(idx)) continue;
    const s = sf(idx);
    const imports = new Map<string, string>();
    for (const st of s.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const nb = st.importClause?.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imports.set(e.name.text, st.moduleSpecifier.text);
    }
    const componentes = new Set<string>();
    const visitar = (n: ts.Node, dentro: boolean): void => {
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === 'paineisParametros') { ts.forEachChild(n, (f) => visitar(f, true)); return; }
      if (ts.isObjectLiteralExpression(n)) {
        const prop = (k: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === k);
        const comp = prop('componente');
        const caminho = prop('caminho');
        const ehParametros = dentro || (caminho && ts.isStringLiteral(caminho.initializer) && caminho.initializer.text.startsWith('parametros/'));
        if (ehParametros && comp && ts.isIdentifier(comp.initializer)) componentes.add(comp.initializer.text);
      }
      ts.forEachChild(n, (f) => visitar(f, dentro));
    };
    visitar(s, false);
    for (const c of componentes) {
      const spec = imports.get(c);
      const arq = spec ? resolver(idx, spec) : null;
      if (arq) entradas.push(arq);
    }
  }
  return entradas;
}

const CHAVES_TECNICAS = new Set(['regra', 'codigo', 'code', 'testID', 'testId', 'data-testid', 'acao', 'id', 'key', 'chave', 'grupo', 'secao', 'caminho']);

/** O literal é texto que pode chegar à tela? (não é comparação, chave técnica nem import) */
function ehTextoVisivel(n: ts.Node): boolean {
  const p = n.parent;
  if (!p) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return false;
  if (ts.isCaseClause(p)) return false;
  if (ts.isPropertyAssignment(p) && p.initializer === n && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && CHAVES_TECNICAS.has(p.name.text)) return false;
  if (ts.isJsxAttribute(p) && CHAVES_TECNICAS.has(p.name.getText())) return false;
  if (ts.isLiteralTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p)) return false;
  if (ts.isElementAccessExpression(p) || ts.isPropertyName(n) && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n) return false;
  return true;
}

/** Literais de texto e de JSX com código interno que podem chegar à tela, como `arquivo:linha texto`. */
function achadosNoFonte(s: ts.SourceFile, rotulo: string): string[] {
  const achados: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    let texto: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) texto = n.text;
    else if (ts.isJsxText(n)) texto = n.text;
    const alvo = ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) ? (n.parent.parent ?? n) : n;
    if (texto && CODIGO_INTERNO.test(texto) && ehTextoVisivel(alvo)) achados.push(`${rotulo}:${s.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${texto.trim().slice(0, 100)}`);
    ts.forEachChild(n, visitar);
  };
  visitar(s);
  return achados;
}

function varrerParametros(): { arquivos: number; achados: string[] } {
  const ui = exportsDaUi();
  const vistos = new Set<string>();
  const fila = entradasDeParametros();
  const achados: string[] = [];
  while (fila.length > 0) {
    const f = fila.shift()!;
    if (vistos.has(f) || /\.test\./.test(f)) continue;
    vistos.add(f);
    const s = sf(f);
    for (const st of s.statements) {
      if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const spec = st.moduleSpecifier.text;
      const r = resolver(f, spec);
      // a camada web (e o que a UI do BKO usa); o domain e os contracts entram pelo teste das mensagens, não por esta varredura
      if (r) { if (/[\\/]web[\\/]/.test(r) || r.startsWith(join(RAIZ, 'packages/ui'))) fila.push(r); continue; }
      if (spec === '@macuxi/ui/web' && ts.isImportDeclaration(st)) {
        const nb = st.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) { const p = ui.get((e.propertyName ?? e.name).text); if (p) fila.push(p); }
      }
    }
    achados.push(...achadosNoFonte(s, relative(RAIZ, f)));
  }
  return { arquivos: vistos.size, achados };
}

describe('v1.0.34 B(b) — varredura (AST) de BKO › Parâmetros: nenhum texto visível com RN-, RF-, RD-, T-nnnn ou ADR', () => {
  const r = varrerParametros();

  it('a varredura alcança a página, os painéis dos módulos e a UI que eles usam (não passa no vazio)', () => {
    expect(r.arquivos).toBeGreaterThan(50);
  });

  it('o verificador pega o caso do campo (texto do cadeado e JSX) e deixa passar comentário, comparação e chave técnica', () => {
    const fonte = [
      '// RN-CORE-35 em comentário pode',
      "export const C = { baseImutavel: 'O perfil base não muda depois de criado (RN-CORE-35).', regra: 'RN-CORE-35' };",
      'export const f = (base: string) => `Acima do perfil base ${base} (RN-CORE-04).`;',
      "export const g = (e: { code: string }) => e.code === 'RN-CORE-41';",
      'export const J = () => <p data-testid="T-0186">Veja a ADR 0060</p>;',
    ].join('\n');
    const achados = achadosNoFonte(ts.createSourceFile('amostra.tsx', fonte, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), 'amostra.tsx');
    expect(achados.map((a) => a.split(' ')[0])).toEqual(['amostra.tsx:2', 'amostra.tsx:3', 'amostra.tsx:5']);
  });

  it('nenhum achado', () => {
    expect(r.achados).toEqual([]);
  });
});
