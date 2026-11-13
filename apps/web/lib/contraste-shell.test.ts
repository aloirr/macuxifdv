/**
 * T-0094 — contraste do laranja no shell web (docs/design/componentes.md §1.1; R-20261108-103740): o `accent` (#C2540A) é
 * preenchimento e gráfico; texto laranja sobre claro é sempre `text-accent-ink` (6,70:1 no fundo) e texto sobre o laranja,
 * `text-on-accent`. Varredura estática do shell (app/ e components/), a mesma regra do teste do kit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

const fontes = ['app', 'components'].flatMap((d) => arquivos(join(RAIZ, d))).map((f) => ({ f: f.slice(RAIZ.length), texto: readFileSync(f, 'utf8') }));

describe('shell web sem laranja cru em texto', () => {
  it('nenhum text-accent / hover:text-accent sem -ink (nem hex cru)', () => {
    const achados = fontes.flatMap(({ f, texto }) =>
      texto
        .split('\n')
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /(^|[\s"'`:])text-accent(?![-\w])|accent-\[#|#c2540a/i.test(l))
        .map(({ i }) => `${f}:${i + 1}`),
    );
    expect(achados).toEqual([]);
  });

  it('marca v1 (T-0172): logo negativo na faixa Azul noite, sem o quadrado "M"; tokens da faixa no globals.css', () => {
    const css = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8').toLowerCase();
    expect(css).toMatch(/--color-on-accent:\s*#ffffff/);
    expect(css).toMatch(/--color-faixa:\s*#1e3350/);
    expect(css).toMatch(/--color-faixa-texto:\s*#c9ced5/);
    expect(fontes.filter(({ texto }) => /font-extrabold text-on-accent">M</.test(texto)).map(({ f }) => f)).toEqual([]);
    const de = (f: string) => fontes.find((x) => x.f.split(sep).join('/') === f)?.texto ?? '';
    expect(de('components/marca-faixa.tsx')).toContain('bg-faixa ');
    expect(de('components/marca-faixa.tsx')).toContain('text-faixa-texto');
    expect(de('components/login-screen.tsx')).toContain('<MarcaNaFaixa area="Backoffice" />');
    expect(de('components/portal/base.tsx')).toContain('<MarcaNaFaixa area="Portal de implantação" />');
  });

  it('as linhas do recado usam accent-ink', () => {
    const de = (f: string) => fontes.find((x) => x.f.split(sep).join('/') === f)?.texto ?? '';
    expect(de('components/later-page.tsx')).toMatch(/text-accent-ink uppercase">Em breve/);
    expect(de('components/login-screen.tsx')).toMatch(/text-accent-ink uppercase">\{rotuloDoPerfil/);
    expect(de('app/(bko)/page.tsx')).toMatch(/font-semibold text-accent-ink no-underline hover:underline/);
    expect(de('components/portal/baixar-conector.tsx')).toMatch(/font-semibold text-accent-ink no-underline hover:underline/);
    expect(de('components/portal/tela-empresas.tsx')).toMatch(/hover:text-accent-ink hover:underline/);
  });
});
