/**
 * Renderização dos painéis do monitor (T-0051) no servidor (`renderToStaticMarkup`, sem navegador): a UI reflete P-3 e RN-INT-06
 * (botões de decisão só para admin/analista e só na validade) e o sinal de vida contra o relógio injetado. A proteção real é na API.
 */
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { AlertaMonitor, ConectorResumo, MonitorResumo, PendenciaInativacao } from '../../contracts';
import { ConectoresPanel } from './conectores-panel';
import { AlertasPanel } from './alertas-panel';
import { InativacoesPanel } from './inativacoes-panel';
import { PedidosPanel } from './pedidos-panel';

// O vitest do módulo transforma .tsx com o JSX clássico (`React.createElement`) e o kit de UI não tem tsconfig próprio: o React
// global supre isso só neste teste (pedido de `esbuild.jsx: 'automatic'` no vitest do módulo ao engenheiro-software).
(globalThis as { React?: typeof React }).React = React;

const relogio = criarRelogio();
const html = (el: ReactElement) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el));

const PENDENCIA: PendenciaInativacao = {
  id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a01',
  sessao_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a02',
  entidade: 'cliente',
  conector_id: 'erp-matriz',
  lote_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a03',
  estado: 'aguardando',
  candidatos: 420,
  total_ativos: 1000,
  percentual: 42,
  limite_pct: 30,
  amostra: ['C-1', 'C-2'],
  criada_em: relogio.relativo({ horas: -1 }).toISOString(),
  expira_em: relogio.relativo({ dias: 6 }).toISOString(),
  decidida_em: null,
};

const painel = (perfil: 'admin' | 'analista' | 'supervisor', p = PENDENCIA) =>
  html(createElement(InativacoesPanel, { pendencias: [p], perfil, agora: relogio.agora(), tz: relogio.fuso }));

describe('InativacoesPanel (RN-INT-06, P-3)', () => {
  it('P-3: admin e analista veem Confirmar e Recusar', () => {
    for (const perfil of ['admin', 'analista'] as const) {
      const h = painel(perfil);
      expect(h, perfil).toContain(`integracao.inativacao.confirmar.${PENDENCIA.id}`);
      expect(h, perfil).toContain(`integracao.inativacao.recusar.${PENDENCIA.id}`);
    }
  });

  it('P-3: outro perfil não vê os botões, vê o motivo', () => {
    const h = painel('supervisor');
    expect(h).not.toContain('integracao.inativacao.confirmar.');
    expect(h).toContain(`integracao.inativacao.bloqueada.${PENDENCIA.id}`);
    expect(h).toContain('administrador ou analista');
  });

  it('RN-INT-06: vencida a validade, ninguém decide e a tela pede nova carga completa', () => {
    const h = painel('admin', { ...PENDENCIA, expira_em: relogio.relativo({ minutos: -5 }).toISOString() });
    expect(h).not.toContain('integracao.inativacao.confirmar.');
    expect(h).toContain('nova carga completa');
  });

  it('mostra quantidade, percentual, limite e a amostra de códigos do ERP', () => {
    const h = painel('admin');
    expect(h).toContain('420 de 1000');
    expect(h).toContain('42%');
    expect(h).toContain('limite 30%');
    expect(h).toContain('C-1, C-2');
  });
});

describe('ConectoresPanel (sinal de vida e versão)', () => {
  const conector = (p: Partial<ConectorResumo>): ConectorResumo => ({
    id: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    conector_id: 'erp-matriz',
    nome: 'ERP da matriz',
    tipo: 'conector',
    ativo: true,
    recebe_pedidos: true,
    aceita_cancelamento: false,
    entidades: ['cliente', 'produto'],
    ips_permitidos: [],
    versao_conector: '1.2.1',
    situacao_versao: 'em_dia',
    ultimo_sinal_em: relogio.relativo({ minutos: -16 }).toISOString(),
    saude: 'sem_sinal',
    chave: { prefixo: 'mx_ab12', criada_em: relogio.relativo({ dias: -30 }).toISOString(), anterior_prefixo: null, anterior_valida_ate: null, expira_em: null },
    criado_em: relogio.relativo({ dias: -30 }).toISOString(),
    ...p,
  });

  it('saúde da API, tempo desde o último sinal pelo relógio e versão contra a política; só o prefixo da chave', () => {
    const h = html(createElement(ConectoresPanel, { conectores: [conector({})], agora: relogio.agora(), tz: relogio.fuso }));
    expect(h).toContain('Sem sinal');
    expect(h).toContain('há 16 min');
    expect(h).toContain('1.2.1');
    expect(h).toContain('Em dia');
    expect(h).toContain('mx_ab12…');
    expect(h).toContain('Clientes, Produtos');
  });

  it('sem Conector: orienta o próximo passo', () => {
    const h = html(createElement(ConectoresPanel, { conectores: [], agora: relogio.agora(), tz: relogio.fuso }));
    expect(h).toContain('Nenhum Conector cadastrado');
  });
});

describe('Monitor: cancelamento recusado pelo ERP (T-0114, exceção da RN-INT-08)', () => {
  const alerta: AlertaMonitor = {
    codigo: 'cancelamento_recusado',
    severidade: 'atencao',
    conector_id: null,
    entidade: null,
    mensagem: 'O ERP recusou o cancelamento de 1 pedido (PV-9 (3f2b8c1e): Pedido já faturado no ERP). O pedido segue ativo no ERP.',
  };
  const pedidos: MonitorResumo['pedidos'] = { por_estado: {}, presos: 0, retidos: 0 } as MonitorResumo['pedidos'];

  it('o painel de alertas mostra o alerta com o pedido e o motivo', () => {
    const h = html(createElement(AlertasPanel, { alertas: [alerta] }));
    expect(h).toContain('integracao.alerta.cancelamento_recusado');
    expect(h).toContain('PV-9');
    expect(h).toContain('Pedido já faturado no ERP');
  });

  it('o painel de pedidos lista o alerta em "Erros de retorno" com o rótulo próprio; sem alerta, a mensagem de vazio', () => {
    const com = html(createElement(PedidosPanel, { pedidos, alertas: [alerta] }));
    expect(com).toContain('integracao.retorno.cancelamento_recusado');
    expect(com).toContain('Cancelamento recusado');
    expect(com).toContain('Pedido já faturado no ERP');
    expect(html(createElement(PedidosPanel, { pedidos, alertas: [] }))).toContain('integracao.retornos.vazio');
  });
});
