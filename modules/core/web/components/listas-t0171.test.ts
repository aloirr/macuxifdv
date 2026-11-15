import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as páginas do BKO importam Next/React: confere no fonte (mesmo padrão de app/lib/ficha-sem-repeticao.test.ts)
const ler = (rel: string) => readFileSync(join(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');

describe('T-0171: listas do BKO com uma informação por linha', () => {
  it('RD-0216 (RF-CORE-02, RN-CORE-17): Carteira com a coluna Situação (uma tag, Cadastro incompleto antes de Sem coordenada) e Ações só com o botão', () => {
    const p = ler('carteira/carteira-page.tsx');
    // revisão do BKO (T-0173): coluna Situação com um selo só (Cadastro incompleto antes de Sem coordenada); "Desvincular" no "⋯" da linha
    expect(p).toContain("titulo: 'Situação'");
    const situacao = p.slice(p.indexOf('carteira.situacao.'), p.indexOf('const acoes'));
    expect(situacao).toMatch(/c\.cadastro_incompleto \? <EtiquetaCadastroIncompleto \/> : <SeloSituacao selos=\{\[c\.lat === null \? \{ tom: 'warning', texto: 'Sem coordenada' \} : null\]\} \/>/);
    const acoes = p.slice(p.indexOf('const acoes'), p.indexOf('const botaoVincular'));
    expect(acoes).toContain("rotulo: 'Desvincular'");
    expect(acoes).not.toContain('EtiquetaCadastroIncompleto');
  });

  it('RD-0218 (RF-CORE-05): Rotas mostram o bairro na linha do cliente, sem o código, e o resumo sem explicar a tela', () => {
    const editor = ler('routes/route-editor.tsx');
    expect(editor).not.toContain('cód.');
    expect(editor.match(/<span className="truncate text-\[12px\] text-ink-2">\{c\.district\}<\/span>/g)).toHaveLength(2);
    const pagina = ler('routes/routes-page.tsx');
    // revisão do BKO (T-0173): a contagem fica só no h1 (rotuloComContagem); o quadro da lista não repete "N com visitas"
    expect(pagina).toContain("rotuloComContagem('Rotas', kpis.routes)");
    expect(pagina).not.toContain('com visitas');
    expect(pagina).not.toContain('clique para ver e configurar');
  });
});
