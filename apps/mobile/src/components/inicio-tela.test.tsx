/**
 * T-0076 — teste de componente do Início (referência aprovada), renderizado com `react-dom/server`, com `react-native`,
 * o roteador, o estado da plataforma e o `useInicio()` do Core simulados. Os cards saem do `criarShell` REAL com os
 * manifestos instalados reais (`MANIFESTOS_INSTALADOS`): o filtro por módulo efetivo, perfil e ação é o da plataforma.
 * - ordem da referência: boas-vindas → Recados de hoje → Meta de hoje → cards → (Gestão: Equipe agora) → Sincronizar;
 * - sem "Seus módulos", sem selo de hora duplicado e sem "Começar a rota";
 * - com o Vendedor: Orçamentos e A faturar lado a lado; sem o Vendedor (licença desligada): os cards somem, sem erro;
 * - promotor: nenhum card de pedido (RN-PRO-01); Gestão: Pedidos para aprovar só com o Gestor ativo.
 */
import type { VisaoInicio } from '@macuxi/core/contracts';
import { criarShell, type ItemExtensaoShell, type ModuloId, type Perfil } from '@macuxi/platform-sdk';
import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MANIFESTOS_INSTALADOS } from '@/lib/instalados';

// ---------- simulações ----------
type Props = { children?: ReactNode; testID?: string; onPress?: () => void };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, testID ? { 'data-testid': testID } : {}, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  Pressable: host('button'),
  ScrollView: host('main'),
  StyleSheet: { create: <T,>(s: T) => s },
  Platform: { OS: 'android' },
}));
vi.mock('expo-router', () => ({ router: { navigate: () => undefined, push: () => undefined } }));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'f' }),
  type: new Proxy({}, { get: () => ({}) }),
  firstName: (n: string) => n.split(' ')[0],
  initials: (n: string) => n.slice(0, 2),
  Banner: host('p'),
  Card: host('section'),
  Cartao: host('section'),
  Icon: () => null,
  SectionHeader: ({ title }: { title: string }) => createElement('h2', null, title),
  Loading: () => createElement('p', { 'data-testid': 'carregando' }),
  ProgressBar: ({ pct }: { pct: number }) => createElement('progress', { value: pct, max: 100 }),
  Screen: host('main'),
  BotaoSincronizar: ({ testID }: { testID: string }) => createElement('button', { 'data-testid': testID }, 'Sincronizar · Última sincronização 16:25 · 0 na fila'),
  useAtualizacaoAutomatica: () => ({ puxando: false, puxar: () => undefined }),
}));

const sim = vi.hoisted(() => ({
  inicio: null as unknown,
  visao: null as unknown as { perfil: string; pagina: (id: string) => unknown; extensoes: (slot: string) => unknown[] },
}));
vi.mock('@macuxi/core/app', () => ({ useInicio: () => sim.inicio, useNotificacoes: () => ({ marcarLida: async () => undefined }) }));
vi.mock('@macuxi/platform-sdk/react', () => ({
  useVisaoShell: () => sim.visao,
  useExtensoes: (slot: string) => sim.visao.extensoes(slot),
  useMotorSync: () => ({ estado: { fila: [], limpezaPendente: [], sincronizado_em: '2026-11-04T20:25:00Z' } }),
}));
vi.mock('@/state/plataforma', () => ({
  usePlataforma: () => ({ sessao: { user: { name: 'Lucas Prado', team_name: 'Equipe Manaus' }, tenant: { fuso: 'America/Manaus' } }, me: null, offline: false }),
}));

const { default: Inicio } = await import('../app/(tabs)/index');

// ---------- módulos e cards ----------
const Card = (rotulo: string): ComponentType => () => createElement('span', null, rotulo);
/**
 * O que o modulo-vendedor registra no `inicio.cards` (R-20261104-175646): um item `pedidos-resumo`, ordem 20, só no Campo
 * e só para quem cria pedido; o componente desenha Orçamentos e A faturar lado a lado.
 */
const CardsPedidos: ComponentType = () =>
  createElement('div', { 'data-testid': 'linha-pedidos' }, createElement('div', { 'data-testid': 'inicio.card-orcamentos' }, 'Orçamentos'), createElement('div', { 'data-testid': 'inicio.card-a-faturar' }, 'A faturar'));
const extensoesVendedor: ItemExtensaoShell[] = [
  { slot: 'inicio.cards', id: 'pedidos-resumo', acao: 'pedido.criar', apps: ['campo'], payload: { testID: 'inicio.cards-vendedor', componente: CardsPedidos, ordem: 20 } },
];
const extensoesGestor: ItemExtensaoShell[] = [
  { slot: 'inicio.cards', id: 'aprovacoes', acao: 'fila_aprovacao.ver', apps: ['gestao'], payload: { testID: 'inicio.card-aprovacoes', componente: Card('Pedidos para aprovar'), ordem: 10 } },
];

function montar(app: 'campo' | 'gestao', perfil: Perfil, modulosAtivos: ModuloId[]) {
  // todos os manifestos instalados no shell (dependências inteiras); só Vendedor e Gestor registram cards aqui
  const extensoes: Partial<Record<string, ItemExtensaoShell[]>> = { vendedor: extensoesVendedor, gestor: extensoesGestor };
  const shell = criarShell<ComponentType>(
    app,
    MANIFESTOS_INSTALADOS.map((manifesto) => ({ manifesto, paginas: [], extensoes: extensoes[manifesto.id] ?? [] })),
  );
  const v = shell.montar({ perfil, modulosAtivos });
  sim.visao = { perfil, pagina: () => null, extensoes: (slot) => v.extensoes(slot) };
}

const UUID = '11111111-1111-4111-8111-111111111111';
const visaoInicio = (escopo: 'proprio' | 'equipe', metas: VisaoInicio['metas'] = [VENDAS]): VisaoInicio => ({
  escopo,
  hoje: '2026-11-04',
  dia_util: true,
  dias_uteis_restantes: 19,
  recado: { origem: 'recado', texto: 'Supervisor: priorize o Atacadinho hoje', titulo: null, autor_nome: 'Marcos', autor_perfil: 'supervisor', notificacao_id: null },
  metas,
  notificacoes: { nao_lidas: 3, ultimas: [{ id: UUID, titulo: 'Pedido 000010 aprovado', tipo: 'pedido_aprovado', criada_em: '2026-11-04T18:02:00Z', lida: false, link: null }] },
  rota: escopo === 'proprio' ? { paradas_hoje: 6, visitadas_hoje: 3, restantes: 3, proxima: null, visita_aberta: null } : null,
  equipe_agora:
    escopo === 'equipe'
      ? [{ usuario_id: UUID, nome: 'Lucas Prado', status: 'em_rota', desde: null, cliente_id: null, paradas_hoje: 6, visitadas_hoje: 3, vendas_hoje_cents: 124_000, minutos_sem_atividade: null }]
      : null,
  base: { dia: '2026-11-04', calculado_em: '2026-11-04T20:00:00Z', defasado: false },
});
const VENDAS: VisaoInicio['metas'][number] = {
  indicador: 'venda_cents',
  situacao: 'a_cumprir',
  meta_mes: 3_100_000,
  realizado_ate_ontem: 1_116_000,
  realizado_hoje: 124_000,
  meta_dia: 320_000,
  atingimento_hoje_pct: 3875,
  dias_uteis_restantes: 19,
  membros: 1,
  membros_mes_batido: 0,
};

const render = () => renderToStaticMarkup(createElement(Inicio));
const pos = (html: string, testID: string) => html.indexOf(`data-testid="${testID}"`);

beforeEach(() => {
  sim.inicio = visaoInicio('proprio');
});

describe('Início do Campo (vendedor)', () => {
  it('blocos na ordem da referência, Sincronizar por último', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    const html = render();
    const ordem = ['inicio.saudacao', 'inicio.visitas', 'inicio.recados', 'inicio.meta', 'inicio-cards', 'inicio-sincronizar'].map((id) => pos(html, id));
    expect(ordem.every((p) => p > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain('6 visitas hoje · 3 feitas');
    expect(html).toContain('3 novos');
    expect(html).toContain('Faltam R$ 1.960 hoje');
    expect(html).toContain('mês 40%');
    expect(html.lastIndexOf('<button')).toBe(pos(html, 'inicio-sincronizar') - '<button '.length);
  });

  it('sem "Seus módulos", sem selo de hora duplicado e sem "Começar a rota"', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    const html = render();
    expect(html).not.toContain('Seus módulos');
    expect(html).not.toContain('Começar a rota');
    expect(html).not.toContain('Sincronizado às');
    expect(html.match(/Última sincronização/g)).toHaveLength(1);
  });

  it('COM o Vendedor: Orçamentos e A faturar logo abaixo da Meta de hoje, na linha inteira', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    const html = render();
    expect(pos(html, 'inicio.cards-vendedor')).toBeGreaterThan(pos(html, 'inicio.meta'));
    expect(pos(html, 'inicio.card-orcamentos')).toBeGreaterThan(0);
    expect(pos(html, 'inicio.card-a-faturar')).toBeGreaterThan(pos(html, 'inicio.card-orcamentos'));
  });

  it('SEM o Vendedor (licença desligada): Orçamentos e A faturar somem, sem erro; o resto da tela continua', () => {
    montar('campo', 'vendedor', ['core']);
    const html = render();
    expect(html).not.toContain('inicio.card-orcamentos');
    expect(html).not.toContain('inicio.card-a-faturar');
    expect(html).not.toContain('inicio-cards');
    expect(pos(html, 'inicio.recados')).toBeGreaterThan(0);
    expect(pos(html, 'inicio-sincronizar')).toBeGreaterThan(0);
  });
});

describe('Início do Campo com os campos prontos do Core (core.inicio@1 aditivo)', () => {
  it('usa recados_hoje, meta_hoje, sem_realizado e saudacao do Core', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = {
      ...visaoInicio('proprio'),
      saudacao: 'Boa tarde',
      recados_hoje: { novos: 2, itens: [{ id: UUID, titulo: 'Pedido 000010 aprovado', subtitulo: 'Mercadinho São Jorge', tipo: 'pedido_aprovado', criada_em: '2026-11-04T18:02:00Z', hora: '14:02', lida: false, link: null, destaque: false }] },
      meta_hoje: { indicador: 'venda_cents', situacao: 'a_cumprir', realizado_hoje: 124_000, meta_dia: 320_000, faltam_hoje: 196_000, mes_pct: 4000 },
      sem_realizado: ['positivacao'],
    } satisfies VisaoInicio;
    const html = render();
    expect(html).toContain('Boa tarde, Lucas');
    expect(html).toContain('2 novos');
    expect(html).toContain('Mercadinho São Jorge · 14:02');
    expect(html).toContain('Faltam R$ 1.960 hoje');
    expect(html).toContain('mês 40%');
    expect(html).toContain('Sincronize para ver as vendas');
  });
});

describe('Início do Campo (promotor, RN-PRO-01)', () => {
  it('sem cards de pedido mesmo com o Vendedor ativo; meta só do indicador com meta', () => {
    montar('campo', 'promotor', ['core', 'vendedor']);
    sim.inicio = visaoInicio('proprio', [{ ...VENDAS, indicador: 'visitas', meta_mes: 120, realizado_ate_ontem: 40, realizado_hoje: 3, meta_dia: 6, atingimento_hoje_pct: 5000 }]);
    const html = render();
    expect(html).not.toContain('inicio.card-');
    expect(html).toContain('Faltam 3 visitas hoje');
    expect(html).not.toContain('Sincronize para ver as vendas');
  });
});

describe('Início da Gestão (supervisor)', () => {
  beforeEach(() => {
    sim.inicio = visaoInicio('equipe');
  });

  it('mesma estrutura com os números da equipe: recados → meta da equipe → Pedidos para aprovar → Equipe agora → Sincronizar', () => {
    montar('gestao', 'supervisor', ['core', 'vendedor', 'gestor']);
    const html = render();
    const ordem = ['inicio.saudacao', 'inicio.recados', 'inicio.meta', 'inicio.card-aprovacoes', 'inicio.equipe-agora', 'inicio-sincronizar'].map((id) => pos(html, id));
    expect(ordem.every((p) => p > 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toContain('Equipe Manaus');
    expect(html).toContain('6 visitas hoje · 3 feitas');
    expect(html).not.toContain('inicio.card-orcamentos'); // Orçamentos e A faturar são do Campo
  });

  it('sem o Gestor: nada de Pedidos para aprovar', () => {
    montar('gestao', 'supervisor', ['core', 'vendedor']);
    expect(render()).not.toContain('inicio.card-aprovacoes');
  });
});
