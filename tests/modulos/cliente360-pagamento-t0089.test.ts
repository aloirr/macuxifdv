/**
 * T-0089 (critério 6; pendência do engenheiro-software): edição das formas e do prazo médio no Cliente 360 do BKO, sem
 * navegador e sem banco (roda no PC e no CI). O componente REAL `PagamentoCliente` (modules/core/web/components/
 * cliente360/pagamento-cliente.tsx) é renderizado com react-dom/server dentro do `ShellProvider` (permissões por ação,
 * ADR 0004) e do `QueryClientProvider`:
 *  - com `cliente.pagamento_editar` (analista/admin): prazo e caixas habilitados, botão "Salvar pagamento";
 *  - sem a ação (vendedor, supervisor, gerente, promotor): tudo desabilitado e sem botão (a API devolve 403; ver
 *    tests/integracao/api/pagamento-t0089.test.ts C1);
 *  - Vendedor desligado (`formas: null` em GET /v1/core/formas-pagamento): as formas ficam só leitura ("todas" ou os
 *    códigos) e o prazo médio segue editável;
 *  - a página liga o componente à rota nova e ao cadastro do cliente (varredura do fonte, para a ligação não sumir).
 * O clique em "Salvar" e o PUT pelo navegador ficam no roteiro manual de docs/testes/T-0089.md (BKO contra a demo).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShellProvider } from '@macuxi/platform-sdk/react';
import type { VisaoShell } from '@macuxi/platform-sdk';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PagamentoCliente } from '../../modules/core/web/components/cliente360/pagamento-cliente';
import { prazoMedioDoCampo } from '../../modules/core/web/lib/pagamento-cliente';

const RAIZ = join(__dirname, '../..');
const CLIENTE = '0f890000-0000-4000-8000-000000000a01';
const FORMAS = [
  { codigo: 'AVISTA', nome: 'À vista' },
  { codigo: 'PIX', nome: 'Pix' },
  { codigo: 'BOLETO', nome: 'Boleto' },
];

const visao = (acoes: readonly string[]): VisaoShell<unknown> => ({ pode: (a: string) => acoes.includes(a), extensoes: () => [] }) as unknown as VisaoShell<unknown>;

function render(p: { acoes: readonly string[]; prazo: number | null; formas: readonly string[]; disponiveis: typeof FORMAS | null }): string {
  const qc = new QueryClient();
  return renderToStaticMarkup(
    createElement(ShellProvider, {
      visao: visao(p.acoes),
      children: createElement(QueryClientProvider, {
        client: qc,
        children: createElement(PagamentoCliente, { clienteId: CLIENTE, prazoMedioMaxDias: p.prazo, formas: p.formas, formasDisponiveis: p.disponiveis }),
      }),
    }),
  );
}

/** A tag de abertura do elemento com o data-testid (ou de cada checkbox da lista). */
const tag = (html: string, testid: string): string => html.match(new RegExp(`<[^>]*data-testid="${testid.replace(/\./g, '\\.')}"[^>]*>`))?.[0] ?? '';
const checkboxes = (html: string): string[] => html.match(/<input type="checkbox"[^>]*>/g) ?? [];

describe('T-0089 — Cliente 360 do BKO: pagamento permitido ao cliente (RN-VEN-25)', () => {
  it('B1. com cliente.pagamento_editar: prazo 45 editável, uma caixa por forma ativa (PIX e BOLETO marcadas), botão Salvar', () => {
    const html = render({ acoes: ['cliente.pagamento_editar'], prazo: 45, formas: ['PIX', 'BOLETO'], disponiveis: FORMAS });
    const prazo = tag(html, 'cliente360.pagamento.prazo');
    expect(prazo).toContain('value="45"');
    expect(prazo).not.toContain('disabled');
    expect(prazo).toContain('min="0"');
    expect(prazo).toContain('max="365"');
    expect(tag(html, 'cliente360.pagamento.formas')).not.toBe('');
    const caixas = checkboxes(html);
    expect(caixas).toHaveLength(3);
    expect(caixas.map((c) => c.includes('checked'))).toEqual([false, true, true]);
    expect(caixas.every((c) => !c.includes('disabled'))).toBe(true);
    for (const f of FORMAS) expect(html).toContain(f.nome);
    expect(html).toContain('nenhuma marcada = todas');
    expect(tag(html, 'cliente360.pagamento.salvar')).not.toBe('');
    expect(html).toContain('Salvar pagamento');
  });

  it('B2. sem a ação (vendedor, supervisor, gerente, promotor): prazo e caixas desabilitados e sem o botão Salvar', () => {
    const html = render({ acoes: ['cliente.ver'], prazo: 45, formas: ['PIX'], disponiveis: FORMAS });
    expect(tag(html, 'cliente360.pagamento.prazo')).toContain('disabled');
    const caixas = checkboxes(html);
    expect(caixas).toHaveLength(3);
    expect(caixas.every((c) => c.includes('disabled'))).toBe(true);
    expect(tag(html, 'cliente360.pagamento.salvar')).toBe('');
    expect(html).not.toContain('Salvar pagamento');
  });

  it('B3. sem prazo médio (null = sem teto): campo vazio com "Sem teto"; nenhuma forma marcada', () => {
    const html = render({ acoes: ['cliente.pagamento_editar'], prazo: null, formas: [], disponiveis: FORMAS });
    const prazo = tag(html, 'cliente360.pagamento.prazo');
    expect(prazo).toContain('value=""');
    expect(prazo).toContain('placeholder="Sem teto"');
    expect(checkboxes(html).some((c) => c.includes('checked'))).toBe(false);
  });

  it('B4. Vendedor desligado (formas: null): formas só leitura com os códigos do cliente; o prazo segue editável e o botão continua', () => {
    const html = render({ acoes: ['cliente.pagamento_editar'], prazo: 30, formas: ['PIX', 'BOLETO'], disponiveis: null });
    expect(tag(html, 'cliente360.pagamento.formas')).toBe('');
    expect(checkboxes(html)).toEqual([]);
    const leitura = html.slice(html.indexOf('data-testid="cliente360.pagamento.formas-leitura"'));
    expect(leitura).toContain('PIX');
    expect(leitura).toContain('BOLETO');
    expect(tag(html, 'cliente360.pagamento.prazo')).not.toContain('disabled');
    expect(tag(html, 'cliente360.pagamento.salvar')).not.toBe('');
  });

  it('B5. Vendedor desligado e cliente sem lista: as formas aparecem como "todas"', () => {
    const html = render({ acoes: ['cliente.pagamento_editar'], prazo: null, formas: [], disponiveis: null });
    const leitura = html.slice(html.indexOf('data-testid="cliente360.pagamento.formas-leitura"'));
    expect(leitura).toMatch(/Formas permitidas: <\/span>todas/);
  });

  it('B6. campo do prazo médio (o que o Salvar manda): vazio = null; 0 e 365 aceitos (limites); 366, -1, 4,5 e texto recusados', () => {
    expect(prazoMedioDoCampo('')).toEqual({ ok: true, valor: null });
    expect(prazoMedioDoCampo('  ')).toEqual({ ok: true, valor: null });
    expect(prazoMedioDoCampo('0')).toEqual({ ok: true, valor: 0 });
    expect(prazoMedioDoCampo('365')).toEqual({ ok: true, valor: 365 });
    for (const ruim of ['366', '-1', '4,5', '4.5', 'abc']) expect(prazoMedioDoCampo(ruim).ok, ruim).toBe(false);
  });

  it('B7. a página do Cliente 360 busca GET /core/formas-pagamento e passa o cadastro do cliente ao componente (formas null quando a consulta não vem)', () => {
    const pagina = readFileSync(join(RAIZ, 'modules/core/web/components/cliente360/cliente360-page.tsx'), 'utf8');
    expect(pagina).toContain("api<unknown>('/core/formas-pagamento')");
    expect(pagina).toContain('<PagamentoCliente');
    expect(pagina).toContain('prazoMedioMaxDias={cliente.prazo_medio_max_dias ?? null}');
    expect(pagina).toContain('formas={cliente.formas_pagamento ?? []}');
    expect(pagina).toContain('formasDisponiveis={formasQ.data?.formas ?? null}');
    const comp = readFileSync(join(RAIZ, 'modules/core/web/components/cliente360/pagamento-cliente.tsx'), 'utf8');
    expect(comp).toContain("usePode('cliente.pagamento_editar')");
    expect(comp).toContain('/core/clientes/${clienteId}/pagamento');
    expect(comp).toContain("method: 'PUT'");
  });
});
