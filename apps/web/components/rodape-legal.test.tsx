/**
 * Rodapé legal das telas Entrar do BKO e do portal (docs/design/telas/rodape-legal.md §2 e §3.5), com `react-dom/server`:
 * landmark `<footer>`, linhas preenchidas e em branco, CNPJ sem quebra, link com nova aba e `aria-label`, versão ausente;
 * busca pela rota pública via proxy, com falha virando `null`; e as molduras que ligam o rodapé só no Entrar. Dados fictícios.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';

import { buscarDadosLegais, CAMINHO_DADOS_LEGAIS, esquecerDadosLegais } from '@/lib/dados-legais';
import { linhasDoRodapeLegal } from '@/lib/rodape-legal';
import { RodapeLegalVisual } from './rodape-legal';

const preenchido = { razao_social: 'Empresa Teste Ltda.', cnpj: '11444777000161', site: 'macuxifdv.com.br' };
const html = (dados: typeof preenchido | null, versao?: string) => renderToStaticMarkup(<RodapeLegalVisual dados={dados} versao={versao} ano={2026} />);

describe('RodapeLegalVisual', () => {
  it('preenchido: footer com empresa, direitos, versão e site em nova aba', () => {
    const m = html(preenchido, '1.0.9');
    expect(m).toMatch(/^<footer data-testid="rodape-legal"/);
    expect(m).toContain('aria-label="Empresa Teste Ltda., CNPJ 11.444.777/0001-61"');
    expect(m).toContain('<span class="whitespace-nowrap">CNPJ 11.444.777/0001-61</span>');
    expect(m).toContain('© 2026 · Todos os direitos reservados');
    expect(m).toContain('Versão 1.0.9 · ');
    expect(m).toContain('href="https://macuxifdv.com.br" target="_blank" rel="noopener noreferrer" aria-label="macuxifdv.com.br (abre em nova aba)"');
  });
  it('em branco e sem versão: só direitos e o site padrão', () => {
    const m = html(null);
    expect(m).not.toContain('rodape-legal.empresa');
    expect(m).not.toContain('Versão');
    expect(m).toContain('>macuxifdv.com.br</a>');
  });
  it('a montagem é a mesma do app (linhas puras)', () => {
    expect(linhasDoRodapeLegal({ dados: { ...preenchido, razao_social: null }, versao: null, ano: 2026 }).empresa?.leitor).toBe('CNPJ 11.444.777/0001-61');
  });
});

describe('busca dos dados legais no navegador', () => {
  beforeEach(() => esquecerDadosLegais());
  it('pela rota pública via proxy same-origin', async () => {
    expect(CAMINHO_DADOS_LEGAIS).toBe('/api-proxy/publico/dados-legais');
    let pedido = '';
    const buscar = (async (url: string) => {
      pedido = url;
      return new Response(JSON.stringify(preenchido), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await buscarDadosLegais(buscar, 0)).toEqual(preenchido);
    expect(pedido).toBe(CAMINHO_DADOS_LEGAIS);
  });
  it('503 ou formato errado: null', async () => {
    expect(await buscarDadosLegais((async () => new Response('{}', { status: 503 })) as unknown as typeof fetch, 0)).toBeNull();
    expect(await buscarDadosLegais((async () => new Response('{"cnpj":1}', { status: 200 })) as unknown as typeof fetch, 0)).toBeNull();
  });
});

describe('só o Entrar liga o rodapé', () => {
  const fonte = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it('BKO: a moldura do Entrar real liga; a linha "Vendedores e promotores usam…" fica', () => {
    const login = fonte('./login-screen.tsx');
    expect(login.match(/<Moldura rodapeLegal>/g)).toHaveLength(1);
    expect(login).toContain('Vendedores e promotores usam o app Macuxi Campo');
  });
  it('portal: só a tela Entrar passa rodapeLegal para a MolduraEstreita', () => {
    expect(fonte('./portal/tela-entrar.tsx')).toContain('<MolduraEstreita testId="entrar.tela" rodapeLegal>');
  });
});
