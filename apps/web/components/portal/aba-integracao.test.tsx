/**
 * Aba "Integração" do portal (spec portal-config-enxuto §10.2 e §10.5), renderizada com `react-dom/server` e a lista no cache:
 * - dois lados (Conector | API) em 2 colunas ≥ 768 px com a divisória de 1 px, passos 1 a 3 e a tabela "Conectores";
 * - sem a rota de credenciais de API (`ENCAIXE_API_HUB.credenciais = null`), o lado da API fica só com o "Guia" e o OpenAPI;
 * - com o encaixe, "Gerar a credencial" neutro, a tabela "Credenciais" e o botão do PDF;
 * - sai o que era do CSV (diálogo de passar as bases, Carga por arquivo, textos de CSV).
 */
import { ENTIDADES, type ConectorResumo } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ENCAIXE_API_HUB } from '@/lib/portal-rotas';

import { AbaIntegracao, LadoApi, ListaCredenciais } from './aba-integracao';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const conector = (n: number, conector_id: string, x: Partial<ConectorResumo> = {}): ConectorResumo => ({
  id: `5d1e2c0a-7b3f-4a51-8c2d-0000000000${String(n).padStart(2, '0')}`,
  conector_id,
  nome: conector_id,
  tipo: 'conector',
  ativo: true,
  recebe_pedidos: true,
  aceita_cancelamento: false,
  entidades: [...ENTIDADES],
  ips_permitidos: [],
  versao_conector: null,
  situacao_versao: 'sem_politica',
  ultimo_sinal_em: null,
  saude: 'nunca_conectou',
  chave: null,
  criado_em: '2026-11-14T12:00:00.000Z',
  ...x,
});

function renderizar(no: ReactNode, cache: [readonly unknown[], unknown][] = []): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [chave, dado] of cache) qc.setQueryData(chave, dado);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{no}</QueryClientProvider>);
}

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('AbaIntegracao', () => {
  const html = renderizar(<AbaIntegracao tenant={TENANT} />, [[['portal', TENANT, 'conectores'], [conector(1, 'erp'), conector(2, 'implantacao-csv', { tipo: 'arquivo', recebe_pedidos: false })]]]);
  const t = texto(html);

  it('dois lados com a mesma largura (2 colunas ≥ 768 px) e a divisória de 1 px; abaixo disso, Conector primeiro e a divisória 24 px antes da API', () => {
    expect(html).toContain('data-testid="integracao.aba" class="grid md:grid-cols-2"');
    expect(html).toMatch(/aria-labelledby="integracao-conector" class="[^"]*border-b border-line pb-6 md:border-r md:border-b-0 md:pr-6 md:pb-0/);
    expect(html).toMatch(/aria-labelledby="integracao-api" class="[^"]*pt-6 md:pt-0 md:pl-6/);
    expect(t.indexOf('Integração via Conector')).toBeLessThan(t.indexOf('Integração via API'));
  });

  it('Conector: passos 1 a 3 na ordem, com o botão do link no passo 1, e a tabela "Conectores" só com os do tipo conector', () => {
    const ordem = ['1 Baixar o Conector', 'Gerar o link do Conector', '2 Gerar a credencial', '3 Instalar e colar a credencial', 'Conectores'].map((x) => t.indexOf(x));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toMatch(/rounded-full bg-accent [^"]*text-white">1</);
    expect(t).toContain('Instale o Conector no servidor do ERP. Cole o identificador e a chave na configuração. Inicie o serviço.');
    expect(t).toContain('Identificador Nome');
    expect(t).toContain('Envia os pedidos aprovados ao ERP');
    expect(html).toMatch(/class="[^"]*bg-accent text-white[^"]*" data-testid="integracao\.gerar"/);
    expect(html).toContain('data-testid="integracao.conectores"');
    expect(t).toContain('Identificador Pedidos Situação erp Sim Ativo');
    expect(t).not.toContain('implantacao-csv');
  });

  it('API sem a rota de credenciais: só o "Guia", com o link do OpenAPI e sem o botão do PDF (§10.5)', () => {
    expect(ENCAIXE_API_HUB).toEqual({ credenciais: null, guiaPdf: null });
    expect(t).toMatch(/Integração via API Guia Documentação \(OpenAPI 3\.1\)\s*$/);
    expect(html).toContain('data-testid="integracao.openapi"');
    expect(html).not.toContain('integracao.api-');
    expect(html).not.toContain('integracao.guia');
  });

  it('sai o que era do CSV e do diálogo de passar as bases', () => {
    for (const velho of ['integracao.confirmar', 'integracao.ja-copiei', 'Carga por arquivo', 'CSV', 'Passar as bases', 'chega em breve', 'Gera a chave', 'Vai no arquivo de configuração', 'Credencial do Conector', 'Tipo', 'Bases'])
      expect(html, velho).not.toContain(velho);
  });
});

describe('LadoApi com o encaixe da S6', () => {
  const encaixe = { credenciais: '/integracao/credenciais-api', guiaPdf: '/api-proxy/_publico/integracao/v1/guia.pdf' };

  it('"Gerar a credencial" com os mesmos campos e o botão neutro; "Guia" com o PDF e o OpenAPI; "Credenciais" vazia', () => {
    const html = renderizar(<LadoApi tenant={TENANT} conectores={[]} encaixe={encaixe} />, [[['portal', TENANT, 'credenciais-api'], []]]);
    const t = texto(html);
    expect(t).toMatch(/^\s*Gerar a credencial Identificador Nome Envia os pedidos aprovados ao ERP Gerar credencial Guia Baixar o guia \(PDF\) Documentação \(OpenAPI 3\.1\) Credenciais Nenhuma credencial\.\s*$/);
    expect(html).toContain('placeholder="ex.: erp-api"');
    expect(html).toContain('placeholder="ex.: ERP do cliente"');
    expect(html).toMatch(/data-testid="integracao\.api-gerar"[^>]*disabled/);
    expect(html).not.toMatch(/bg-accent text-white[^"]*" data-testid="integracao\.api-gerar"/);
    expect(html).toContain('data-testid="integracao.guia"');
  });

  it('sem o PDF, o "Guia" fica só com o link do OpenAPI', () => {
    const html = renderizar(<LadoApi tenant={TENANT} conectores={[]} encaixe={{ ...encaixe, guiaPdf: null }} />, [[['portal', TENANT, 'credenciais-api'], []]]);
    expect(html).not.toContain('Baixar o guia (PDF)');
    expect(html).toContain('Documentação (OpenAPI 3.1)');
  });
});

describe('ListaCredenciais', () => {
  it('vazia: só o texto; com itens: Identificador · Pedidos · Situação', () => {
    expect(renderToStaticMarkup(<ListaCredenciais itens={[]} vazio="Nenhum Conector." testId="x" />)).toBe('<span class="text-[13px] text-ink-2">Nenhum Conector.</span>');
    const t = texto(renderToStaticMarkup(<ListaCredenciais itens={[conector(3, 'erp-api', { tipo: 'nuvem', recebe_pedidos: false, ativo: false })]} vazio="Nenhuma credencial." testId="x" />));
    expect(t).toContain('Identificador Pedidos Situação erp-api — Desativado');
  });
});
