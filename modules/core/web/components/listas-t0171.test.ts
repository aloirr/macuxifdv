import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as páginas do BKO importam Next/React: confere no fonte (mesmo padrão de app/lib/ficha-sem-repeticao.test.ts)
const ler = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('T-0171: listas do BKO com uma informação por linha', () => {
  it('RD-0216 (RF-CORE-02, RN-CORE-17): Carteira com a coluna Situação (uma tag, Cadastro incompleto antes de Sem coordenada) e Ações só com o botão', () => {
    const p = ler('carteira/carteira-page.tsx');
    expect(p).toMatch(/<th className=\{th\}>Situação<\/th>\s*<th className=\{th\}>Ações<\/th>/);
    const situacao = p.slice(p.indexOf('carteira.situacao.'), p.indexOf('carteira.desvincular.'));
    expect(situacao).toMatch(/c\.cadastro_incompleto \? <EtiquetaCadastroIncompleto \/> : c\.lat === null \? <Badge tone="warning">Sem coordenada<\/Badge> : null/);
    const acoes = situacao.slice(situacao.lastIndexOf('<td'));
    expect(acoes).not.toContain('Badge');
    expect(acoes).not.toContain('EtiquetaCadastroIncompleto');
  });

  it('RD-0218 (RF-CORE-05): Rotas mostram o bairro na linha do cliente, sem o código, e a lista sem repetir o KPI (RD-2525) nem explicar a tela', () => {
    const editor = ler('routes/route-editor.tsx');
    expect(editor).not.toContain('cód.');
    expect(editor.match(/<span className="truncate text-\[12px\] text-ink-2">\{c\.district\}<\/span>/g)).toHaveLength(2);
    const pagina = ler('routes/routes-page.tsx');
    expect(pagina).not.toContain('com visitas</span>');
    expect(pagina).not.toContain('clique para ver e configurar');
  });
});
