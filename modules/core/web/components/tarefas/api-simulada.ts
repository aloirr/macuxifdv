/**
 * Só para os testes das páginas da T-0170 (tarefas, frases do dia, metas de produtividade e calendário): a API simulada
 * no lugar do `api` do platform-sdk e a renderização no servidor (`react-dom/server`, sem navegador) dentro do
 * `ShellProvider` com as ações do perfil e do React Query com o cache já preenchido pela própria API simulada.
 */
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VisaoShell } from '@macuxi/platform-sdk';
import { ShellProvider } from '@macuxi/platform-sdk/react';
import { ApiRequestError, type api, type RequestOptions } from '@macuxi/platform-sdk/web';

// O vitest do módulo transforma .tsx com o JSX clássico (`React.createElement`): o React global supre isso nos testes
// (mesmo recurso de `modules/integracao/web/components/paineis.render.test.ts`).
(globalThis as { React?: typeof React }).React = React;

export interface ChamadaSimulada {
  metodo: string;
  caminho: string;
  query?: RequestOptions['query'];
  corpo?: unknown;
}

/** Resposta de uma rota: o corpo, um erro (lançado) ou uma função da chamada. */
export type RespostaSimulada = unknown;

/** Rotas por `"<MÉTODO> <caminho>"`. Rota que não está no mapa responde 404, como a API. */
export function criarApiSimulada(rotas: Record<string, RespostaSimulada>) {
  const chamadas: ChamadaSimulada[] = [];
  const chamar = async (caminho: string, opcoes: RequestOptions = {}) => {
    const c: ChamadaSimulada = { metodo: opcoes.method ?? 'GET', caminho, query: opcoes.query, corpo: opcoes.body };
    chamadas.push(c);
    const chave = `${c.metodo} ${caminho}`;
    if (!(chave in rotas)) throw new ApiRequestError(404, 'NAO_ENCONTRADO', 'Não encontrado.');
    const r = rotas[chave];
    const v = typeof r === 'function' ? (r as (c: ChamadaSimulada) => unknown)(c) : r;
    if (v instanceof Error) throw v;
    return structuredClone(v);
  };
  return { chamar: chamar as typeof api, chamadas, rotas };
}

/** Erro 422 no formato da API (`codigo`, `mensagem`, `detalhes`). */
export const erro422 = (codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => new ApiRequestError(422, codigo, mensagem, detalhes);

function visaoCom(acoes: readonly string[]): VisaoShell<unknown> {
  return {
    app: 'web',
    perfil: 'admin',
    modulosAtivos: ['core'],
    navegacao: [],
    pagina: () => null,
    pode: (a: string) => acoes.includes(a),
    extensoes: () => [],
  } as unknown as VisaoShell<unknown>;
}

export const novoQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

/** HTML da tela com as ações dadas e o cache do React Query `qc`. */
export function renderizar(el: ReactElement, acoes: readonly string[], qc: QueryClient = novoQueryClient()): string {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(ShellProvider, { visao: visaoCom(acoes), children: el })));
}

/** Trecho do HTML do elemento com o `data-testid` até o fim da linha da tabela (ou o próximo testid de linha). */
export function trecho(html: string, testid: string, fim = '</tr>'): string {
  const i = html.indexOf(`data-testid="${testid}"`);
  if (i < 0) throw new Error(`sem o elemento ${testid}`);
  return html.slice(i, html.indexOf(fim, i));
}
