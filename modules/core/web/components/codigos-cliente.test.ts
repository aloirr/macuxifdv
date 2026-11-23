import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as páginas do BKO importam Next/React: confere no fonte (padrão de listas-t0171.test.ts); a regra é a pura do kit (@macuxi/ui/web)
const ler = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('códigos do cliente no BKO (ADR 0069 item 10, v1.0.30)', () => {
  it('RN-CORE-78: um componente só, com a regra do kit (nada de modules/core/app); sigla 12/500 cinza e valor mono 13 px tabular', () => {
    const c = ler('codigos-cliente.tsx');
    expect(c).toContain("from '@macuxi/ui/web'");
    expect(c).not.toContain('@macuxi/ui/mobile');
    expect(c).toContain('partesDosCodigos(doKit(cliente))');
    expect(c).not.toMatch(/from '\.\.\/\.\.\/app\//);
    expect(c).toContain('<span className="text-[12px] font-medium text-ink-2">{c.sigla}</span>');
    expect(c).toContain('<span className="font-mono text-[13px] text-ink tabular-nums">{c.valor}</span>');
    expect(c).toContain('<span className="sr-only">Código </span>');
  });

  it('Carteira: coluna Código na 2ª posição (104 px, empilhada) e largura mínima 984', () => {
    const p = ler('carteira/carteira-page.tsx');
    expect(p).toMatch(/<th className=\{th\}>Cliente<\/th>\s*<th className=\{`\$\{th\} w-\[104px\]`\}>Código<\/th>\s*<th className=\{th\}>Cidade<\/th>/);
    expect(p).toContain('<CodigosDoCliente cliente={c} forma="empilhado" testId={`carteira.codigo.${c.id}`} />');
    expect(p).toContain('<TableScroll minWidth={984}>');
    expect(p).toContain('colSpan={7}');
  });

  it('Cliente 360: os códigos no início do subtítulo do cabeçalho', () => {
    const p = ler('cliente360/cliente360-page.tsx');
    expect(p).toContain('subtitle={<CodigosDoCliente cliente={cliente} forma="linha" depois={identificacao} testId="cliente360.codigos" />}');
  });

  it('Pré-cadastros recusados: coluna Código na 1ª posição, FDV no subtítulo da gaveta e do editar, busca com o rótulo único', () => {
    const p = ler('pre-cadastro/pre-cadastros-recusados.tsx');
    const colunas = p.slice(p.indexOf('const colunas'), p.indexOf('const vazio'));
    expect(colunas.indexOf("id: 'codigo'")).toBeGreaterThan(-1);
    expect(colunas.indexOf("id: 'codigo'")).toBeLessThan(colunas.indexOf("id: 'documento'"));
    expect(colunas).toContain("largura: '92px'");
    expect(p.match(/<CodigosDoCliente cliente=\{\{ codigo_fdv: item\.codigo_fdv \}\} forma="linha"/g)).toHaveLength(2);
    expect(p).toContain('texto: (l) => textoDosCodigosDoCliente(l)');
    expect(p).not.toContain('app/lib/codigos-cliente');
    expect(p).toContain('<CampoBusca rotulo={ROTULO_BUSCA_CLIENTE} ');
    expect(p).not.toContain('Razão social ou CPF/CNPJ');
  });
});
