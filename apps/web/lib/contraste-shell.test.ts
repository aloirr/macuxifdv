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

/** Contraste WCAG 2.x entre duas cores #rrggbb. */
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
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
    // área de proteção do logo (MC-0022, portal-config-enxuto.md §0): 104 px e 14 px de folga, também na faixa solta
    expect(de('components/marca-faixa.tsx')).toContain('rounded-xl bg-faixa p-3.5');
    expect(de('components/marca-faixa.tsx')).toContain('gap-3.5');
    expect(de('components/marca-faixa.tsx')).not.toMatch(/w-\[130px\]|\b130\b/);
    expect(de('components/login-screen.tsx')).toContain('<MarcaNaFaixa area="Backoffice" />');
    expect(de('components/portal/base.tsx')).toContain('<MarcaNaFaixa area="Portal de implantação" />');
  });

  it('cabeçalho do portal na faixa Azul noite (MC-0023, portal-config-enxuto.md §0): só tokens da faixa, texto e foco claros', () => {
    const base = fontes.find((x) => x.f.split(sep).join('/') === 'components/portal/base.tsx')?.texto ?? '';
    const cabecalho = base.slice(base.indexOf('<header'), base.indexOf('</header>'));
    expect(cabecalho).toContain('<header className="bg-faixa">');
    expect(cabecalho).toContain('<Marca naBarra />');
    // na faixa: branco (12,77:1) e faixa-texto (8,07:1); nada dos tons de texto pensados para o fundo claro
    expect(cabecalho).toContain('text-faixa-texto');
    expect(cabecalho).toContain('border-white text-white');
    expect(cabecalho).not.toMatch(/text-ink|bg-surface|outline-accent|<Button /);
    expect(base).toMatch(/border-faixa-texto bg-transparent[^"]*text-white[^"]*outline-white/);
    expect(base).toContain('<MarcaNaFaixa area="Portal de implantação" naBarra />');
  });

  it('menu do BKO (R-20261114-184400, MC-0054/MC-0056): token nav-grupo próprio, sem accent-light; logo A no grafite', () => {
    const css = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8').toLowerCase();
    expect(css).toMatch(/--color-nav-grupo:\s*#f59a52/);
    expect(css).toMatch(/--color-nav-active:\s*#2b3743/);
    const shell = fontes.find((x) => x.f.split(sep).join('/') === 'components/app-shell.tsx')?.texto ?? '';
    expect(shell).toContain('text-nav-grupo');
    expect(shell).toContain('before:bg-nav-grupo');
    expect(shell).not.toMatch(/accent-light/);
    expect(shell).toContain('SRC_LOGO_NEGATIVO_GRAFITE');
    expect(shell).not.toContain('Macuxi FDV');
  });

  it('borda dos campos (v1.0.25, "1 A"): --color-field #7A8593, contraste >= 3:1 no branco e no Pérola', () => {
    const css = readFileSync(join(RAIZ, 'app/globals.css'), 'utf8').toLowerCase();
    const field = /--color-field:\s*(#[0-9a-f]{6})/.exec(css)?.[1] ?? '';
    expect(field).toBe('#7a8593');
    expect(contraste(field, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contraste(field, '#f8f6f1')).toBeGreaterThanOrEqual(3);
  });

  it('as linhas do recado usam accent-ink', () => {
    const de = (f: string) => fontes.find((x) => x.f.split(sep).join('/') === f)?.texto ?? '';
    expect(de('components/later-page.tsx')).toMatch(/text-accent-ink uppercase">Em breve/);
    expect(de('components/login-screen.tsx')).toMatch(/text-accent-ink uppercase">\{rotuloDoPerfil/);
    expect(de('components/portal/baixar-conector.tsx')).toMatch(/font-semibold text-accent-ink no-underline hover:underline/);
    expect(de('components/portal/tela-empresas.tsx')).toMatch(/hover:text-accent-ink hover:underline/);
  });
});
