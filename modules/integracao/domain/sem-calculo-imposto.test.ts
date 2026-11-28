/**
 * ADR 0077 D8, prova 3 (decisão 63 A): o FDV não calcula imposto. Varre o código de produção de `domain/` e `api/` da Integração
 * (sem comentários) e falha se aparecer alíquota, MVA, base de cálculo ou conta com `v_icms_st_cents`/`v_ipi_cents`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const PROIBIDOS: { nome: string; re: RegExp }[] = [
  { nome: 'alíquota', re: /al[ií]quota/i },
  { nome: 'MVA', re: /\bmva\b|margem_valor_agregado|margemValorAgregado/i },
  { nome: 'base de cálculo', re: /base_?calculo|baseCalculo|base_de_calculo/i },
  { nome: 'conta com ST/IPI', re: /\b(v_icms_st_cents|v_ipi_cents)\b[\])!?\s]*(?:[-+*/%]|\*\*)|(?:[-+*/%]=?|\*\*)\s*\(?\s*(?:Number\()?[\w.?!\]]*\b(v_icms_st_cents|v_ipi_cents)\b/ },
  { nome: 'arredondamento de ST/IPI', re: /Math\.\w+\([^)]*\b(v_icms_st_cents|v_ipi_cents)\b/ },
];

const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const achados = (src: string) => PROIBIDOS.filter((x) => x.re.test(semComentarios(src))).map((x) => x.nome);

describe('ADR 0077 D8 (decisão 63 A): nenhum cálculo de imposto na Integração', () => {
  it('ADR 0077: o detector pega fórmula, alíquota e arredondamento (e não acusa a cópia do valor)', () => {
    expect(achados('const t = itens.reduce((s, i) => s + i.v_icms_st_cents, 0);')).toContain('conta com ST/IPI');
    expect(achados('const x = l.v_ipi_cents * 2;')).toContain('conta com ST/IPI');
    expect(achados('const aliquotaIpi = 0.1;')).toContain('alíquota');
    expect(achados('const mva = 40;')).toContain('MVA');
    expect(achados('const baseCalculo = 1;')).toContain('base de cálculo');
    expect(achados('const c = Math.round(v_ipi_cents);')).toContain('arredondamento de ST/IPI');
    expect(achados('const copia = { v_icms_st_cents: l.v_icms_st_cents, v_ipi_cents: l.v_ipi_cents ?? null };')).toEqual([]);
    expect(achados('// nada de alíquota nem MVA aqui\nconst a = 1;')).toEqual([]);
  });

  it('ADR 0077: domain/ e api/ não têm alíquota, MVA, base de cálculo nem conta com v_icms_st_cents/v_ipi_cents', () => {
    const lista = ['domain', 'api'].flatMap((d) => arquivos(join(RAIZ, d)));
    expect(lista.length).toBeGreaterThan(10);
    const violacoes = lista.flatMap((p) => achados(readFileSync(p, 'utf8')).map((nome) => `${relative(RAIZ, p)}: ${nome}`));
    expect(violacoes).toEqual([]);
  });
});
