/**
 * T-0076 — teste de componente do Início (referência aprovada), renderizado com `react-dom/server`, com `react-native`,
 * o roteador, o estado da plataforma e o `useInicio()` do Core simulados. Os cards saem do `criarShell` REAL com os
 * manifestos instalados reais (`MANIFESTOS_INSTALADOS`): o filtro por módulo efetivo, perfil e ação é o da plataforma.
 * - v1.0.6 (T-0170): o Campo mostra a `TelaInicioCampo` do Core com o sino do shell; sem Orçamentos, A faturar e Recados;
 * - Gestão: boas-vindas com o sino → Meta do mês → cards → Equipe agora → Sincronizar; sem o cartão de Recados (RD-0249);
 * - T-0124 (RD-0002 a RD-0012): textos sem repetição de "hoje"/"mês"/unidade, aviso de dado antigo único no Sincronizar;
 * - sem "Seus módulos", sem selo de hora duplicado e sem "Começar a rota";
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
  // como o kit (RD-0008): com `avisoDados`, a linha de situação vira o aviso (`{testID}-aviso-dados`) no lugar da última sincronização
  BotaoSincronizar: ({ testID, avisoDados }: { testID: string; avisoDados?: string | null }) =>
    createElement(
      'button',
      { 'data-testid': testID },
      'Sincronizar',
      avisoDados?.trim()
        ? createElement('span', { 'data-testid': `${testID}-situacao` }, createElement('span', { 'data-testid': `${testID}-aviso-dados` }, avisoDados), ' · 0 na fila')
        : createElement('span', { 'data-testid': `${testID}-situacao` }, 'Última sincronização 16:25 · 0 na fila'),
    ),
  useAtualizacaoAutomatica: () => ({ puxando: false, puxar: () => undefined }),
}));

const sim = vi.hoisted(() => ({
  variante: 'gestao' as 'campo' | 'gestao',
  limpeza: [] as unknown[],
  novos: 0,
  inicio: null as unknown,
  visao: null as unknown as { perfil: string; pagina: (id: string) => unknown; extensoes: (slot: string) => unknown[] },
}));
vi.mock('@macuxi/core/app', () => ({
  useInicio: () => sim.inicio,
  useInicioCampo: () => ({ sino: { recados: 0, tarefas: sim.novos, total: sim.novos } }),
  // a tela do Core simulada: só o que o shell passa (o sino, os avisos e as rotas)
  TelaInicioCampo: ({ sino, avisos }: { sino: (n: number) => ReactNode; avisos?: ReactNode }) =>
    createElement('main', { 'data-testid': 'inicio' }, createElement('section', { 'data-testid': 'inicio-campo.metas' }, sino(sim.novos)), avisos),
}));
vi.mock('@/lib/variante', () => ({ varianteAtual: () => sim.variante }));
vi.mock('@/components/sino', () => ({ Sino: ({ testID = 'sino' }: { testID?: string }) => createElement('button', { 'data-testid': testID }) }));
vi.mock('@/components/aviso-pos-login', () => ({ AvisoPosLogin: () => null }));
vi.mock('@macuxi/platform-sdk/react', () => ({
  useVisaoShell: () => sim.visao,
  useExtensoes: (slot: string) => sim.visao.extensoes(slot),
  useMotorSync: () => ({ estado: { fila: [], limpezaPendente: sim.limpeza, sincronizado_em: '2026-11-04T20:25:00Z' } }),
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
const UUID2 = '22222222-2222-4222-8222-222222222222';
const UUID3 = '33333333-3333-4333-8333-333333333333';
type ItemRecado = VisaoInicio['recados_hoje']['itens'][number];
const recado = (x: Partial<ItemRecado> = {}): ItemRecado => ({ id: UUID, titulo: 'Pedido 000010 aprovado', subtitulo: 'Mercadinho São Jorge', tipo: 'pedido_aprovado', criada_em: '2026-11-04T18:02:00Z', hora: '14:02', lida: false, link: null, destaque: false, ...x });
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
/** A visão como o `montarInicio` do Core entrega hoje: saudacao, recados_hoje, meta_hoje e sem_realizado sempre preenchidos. */
const visaoInicio = (escopo: 'proprio' | 'equipe', metas: VisaoInicio['metas'] = [VENDAS]): VisaoInicio => ({
  escopo,
  hoje: '2026-11-04',
  dia_util: true,
  dias_uteis_restantes: 19,
  metas,
  rota: escopo === 'proprio' ? { paradas_hoje: 6, visitadas_hoje: 3, restantes: 3, proxima: null, visita_aberta: null } : null,
  equipe_agora:
    escopo === 'equipe'
      ? [{ usuario_id: UUID, nome: 'Lucas Prado', status: 'em_rota', desde: null, cliente_id: null, paradas_hoje: 6, visitadas_hoje: 3, vendas_hoje_cents: 124_000, minutos_sem_atividade: null }]
      : null,
  base: { dia: '2026-11-04', calculado_em: '2026-11-04T20:00:00Z', defasado: false },
  saudacao: 'Boa tarde',
  recados_hoje: { novos: 3, total: 5, itens: [recado({ id: UUID2, titulo: 'Prioridade', subtitulo: 'Passe cedo no Mercadinho São Jorge', hora: '09:15', destaque: true }), recado(), recado({ id: UUID3, lida: true })] },
  meta_hoje: metas[0] ? { indicador: metas[0].indicador, situacao: metas[0].situacao, realizado_hoje: metas[0].realizado_hoje, meta_dia: metas[0].meta_dia, faltam_hoje: null, mes_pct: 4000, faltam_mes: 1_860_000, por_dia_util: null, dias_uteis_por_dia: 19 } : null,
  sem_realizado: [],
});

const render = () => renderToStaticMarkup(createElement(Inicio));
const pos = (html: string, testID: string) => html.indexOf(`data-testid="${testID}"`);
const conta = (html: string, re: RegExp) => html.match(re)?.length ?? 0;
const rotulo = (html: string) => /data-testid="inicio\.meta"[^>]*><div><span>([^<]*)<\/span>/.exec(html)?.[1];

beforeEach(() => {
  sim.variante = 'gestao';
  sim.novos = 0;
  sim.limpeza = [];
  sim.inicio = visaoInicio('proprio');
});

/** v1.0.6 (T-0170): o Campo usa a tela do Core; o shell só passa o sino, os avisos e as rotas. */
describe('Início do Campo (T-0170)', () => {
  beforeEach(() => {
    sim.variante = 'campo';
  });

  it('TelaInicioCampo com o sino do shell uma vez; sem Orçamentos, A faturar e Recados (RD-0249)', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.novos = 3;
    const html = render();
    expect(conta(html, /data-testid="inicio-sino"/g)).toBe(1);
    expect(pos(html, 'inicio-sino')).toBeGreaterThan(pos(html, 'inicio-campo.metas'));
    expect(html).not.toContain('inicio.recados');
    expect(html).not.toContain('inicio.card-orcamentos');
    expect(html).not.toContain('inicio.card-a-faturar');
    expect(html).not.toContain('inicio-cards');
    expect(html).not.toContain('Orçamentos');
  });

  it('módulo desativado com itens na fila: o aviso vai pela prop `avisos` da tela', () => {
    montar('campo', 'vendedor', ['core']);
    sim.limpeza = [{ modulo: 'vendedor' }];
    expect(render()).toContain('aviso-modulo-desativado');
  });
});

/** T-0124 / RD-0002 e RD-0004: cartão do mês também no dia útil, com a meta do dia só na última linha. */
describe('Meta do mês (RD-0002, RD-0004)', () => {
  it('dia útil: "Meta do mês", "R$ 12.400 de R$ 31.000", "40%" uma vez e "Meta de hoje R$ 3.200"; "mês" só no título', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    const html = render();
    expect(rotulo(html)).toBe('Meta do mês');
    expect(html).toContain('>R$ 12.400</span><span>de R$ 31.000</span>');
    expect(conta(html, /40%/g)).toBe(1);
    expect(html).toContain('>Meta de hoje R$ 3.200<');
    expect(html).not.toContain('Faltam');
    expect(conta(html, /mês/gi)).toBe(1);
  });

  it('Gestão: "Meta do mês da equipe"', () => {
    montar('gestao', 'supervisor', ['core', 'vendedor', 'gestor']);
    sim.inicio = visaoInicio('equipe');
    expect(rotulo(render())).toBe('Meta do mês da equipe');
  });
});

describe('Início do Campo (promotor, RN-PRO-01)', () => {
  it('sem cards de pedido mesmo com o Vendedor ativo; meta só do indicador com meta', () => {
    montar('campo', 'promotor', ['core', 'vendedor']);
    sim.inicio = visaoInicio('proprio', [{ ...VENDAS, indicador: 'visitas', meta_mes: 120, realizado_ate_ontem: 40, realizado_hoje: 3, meta_dia: 6, atingimento_hoje_pct: 5000 }]);
    const html = render();
    expect(html).not.toContain('inicio.card-');
    expect(rotulo(html)).toBe('Meta do mês · Visitas');
    expect(html).toContain('Meta de hoje 6 visitas');
    expect(html).not.toContain('Sincronize para ver as vendas');
  });
});

describe('Início da Gestão (supervisor)', () => {
  beforeEach(() => {
    sim.inicio = visaoInicio('equipe');
  });

  it('números da equipe: sino → meta da equipe → Pedidos para aprovar → Equipe agora → Sincronizar; sem o cartão de Recados (RD-0249)', () => {
    montar('gestao', 'supervisor', ['core', 'vendedor', 'gestor']);
    const html = render();
    expect(html).not.toContain('inicio.recados');
    expect(conta(html, /data-testid="inicio-sino"/g)).toBe(1);
    const ordem = ['inicio.saudacao', 'inicio-sino', 'inicio.meta', 'inicio.card-aprovacoes', 'inicio.equipe-agora', 'inicio-sincronizar'].map((id) => pos(html, id));
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

/**
 * T-0124 — domingo 08/11 do teste de campo (dia não útil, RN-CORE-26; vendedor Lucas, base de 06/11 6h28). A tela tem de
 * sair como a proposta do dono do produto (relatório docs/qualidade/redundancias/2026-11-08-inicio-campo.md §3).
 */
describe('domingo 08/11 do teste de campo (RD-0001 a RD-0010)', () => {
  const POSITIVACAO = { ...VENDAS, indicador: 'positivacao' as const, situacao: 'dia_nao_util' as const, meta_mes: 15, realizado_ate_ontem: 1, realizado_hoje: 0, meta_dia: null, atingimento_hoje_pct: null };
  const domingo = (escopo: 'proprio' | 'equipe', meta: Partial<NonNullable<VisaoInicio['meta_hoje']>> = {}): VisaoInicio => ({
    ...visaoInicio(escopo, [
      { ...VENDAS, situacao: 'dia_nao_util', meta_mes: 18_000_000, realizado_ate_ontem: 55_300, realizado_hoje: 0, meta_dia: null, atingimento_hoje_pct: null, dias_uteis_restantes: 19 },
      POSITIVACAO,
      { ...POSITIVACAO, indicador: 'visitas', meta_mes: 90, realizado_ate_ontem: 0 },
      { ...POSITIVACAO, indicador: 'cobertura_pct', situacao: 'do_mes', meta_mes: 9000, realizado_ate_ontem: 0 },
    ]),
    hoje: '2026-11-08',
    dia_util: false,
    rota: escopo === 'proprio' ? { paradas_hoje: 0, visitadas_hoje: 0, restantes: 0, proxima: null, visita_aberta: null } : null,
    base: { dia: '2026-11-06', calculado_em: '2026-11-06T10:28:00Z', defasado: true },
    recados_hoje: { novos: 1, total: 1, itens: [recado({ id: UUID2, titulo: 'Prioridade', subtitulo: 'Passe cedo no Mercadinho São Jorge: tem título vencido e o cliente quer negociar.', hora: '09:15', destaque: true })] },
    meta_hoje: { indicador: 'venda_cents', situacao: 'dia_nao_util', realizado_hoje: 0, meta_dia: null, faltam_hoje: null, mes_pct: 31, faltam_mes: null, por_dia_util: null, dias_uteis_por_dia: 19, ...meta },
  });
  const COM_ADITIVO = { faltam_mes: 17_944_700, por_dia_util: 944_458, dias_uteis_por_dia: 19 };

  it('RD-0001/RD-0002: "Meta do mês", "R$ 553 de R$ 180.000", "0,3%" e "Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)" com os números do Core', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = domingo('proprio', COM_ADITIVO);
    const html = render();
    expect(rotulo(html)).toBe('Meta do mês');
    expect(html).not.toContain('Meta de hoje');
    expect(html).toContain('>R$ 553</span><span>de R$ 180.000</span>');
    expect(html).toContain('data-testid="inicio.meta.mes">0,3%<');
    expect(html).toContain('>Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)<');
    expect(html).not.toMatch(/Faltam [^<]* hoje/);
  });

  it('RD-0002: sem os números do Core (null) a última linha fica oculta (o shell não calcula)', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = domingo('proprio');
    const html = render();
    expect(html).not.toContain('inicio.meta.apoio');
    expect(html).not.toContain('por dia útil');
  });

  it('RD-0003/RD-0006: "Sem rota hoje · não é dia útil" uma vez; no máximo 1 "hoje" na tela', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = domingo('proprio', COM_ADITIVO);
    const html = render();
    expect(html).toContain('data-testid="inicio.visitas">Sem rota hoje · não é dia útil<');
    expect(conta(html, /não é dia útil/gi)).toBe(1);
    expect(conta(html, /hoje/gi)).toBe(1);
  });

  it('RD-0004/RD-0005/RD-0007/RD-0010: "mês" só no título; "1 de 15 clientes", "0 de 90", "0% de 90%"; só a barra principal', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = domingo('proprio', COM_ADITIVO);
    const html = render();
    expect(conta(html, /mês/gi)).toBe(1);
    expect(html).toMatch(/data-testid="inicio\.meta\.positivacao"><span>Positivação<\/span><span>1 de 15 clientes<\/span>/);
    expect(html).toMatch(/data-testid="inicio\.meta\.visitas"><span>Visitas<\/span><span>0 de 90<\/span>/);
    expect(html).toMatch(/data-testid="inicio\.meta\.cobertura_pct"><span>Cobertura de rota<\/span><span>0% de 90%<\/span>/);
    expect(html).not.toMatch(/clientes? de \d+ clientes?|visitas de \d+ visitas|meta \d+%/);
    expect(conta(html, /<progress/g)).toBe(1);
  });

  it('RD-0008: um aviso só de dado antigo, na prop `avisoDados` do Sincronizar ("Dados de 06/11, 6h28"), fora do cartão Meta', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = domingo('proprio', COM_ADITIVO);
    const html = render();
    expect(html).toContain('data-testid="inicio-sincronizar-aviso-dados">Dados de 06/11, 6h28<');
    expect(pos(html, 'inicio-sincronizar-aviso-dados')).toBeGreaterThan(pos(html, 'inicio-sincronizar'));
    expect(html).not.toContain('inicio.aviso-dados'); // a linha provisória saiu
    expect(html).not.toContain('inicio.meta.aviso');
    expect(html).not.toContain('Última sincronização');
    expect(conta(html, /Dados de/g)).toBe(1);
    expect(conta(html, /Sincronize/g)).toBe(0);
  });

  it('RD-0008: promotor só com visitas e cobertura não recebe o aviso (inicio.md §2)', () => {
    montar('campo', 'promotor', ['core']);
    sim.inicio = { ...domingo('proprio'), metas: [{ ...POSITIVACAO, indicador: 'visitas', meta_mes: 90, realizado_ate_ontem: 0 }] } satisfies VisaoInicio;
    const html = render();
    expect(html).not.toContain('inicio-sincronizar-aviso-dados');
    expect(html).toContain('Última sincronização');
  });

  it('Gestão: "Meta do mês da equipe", sem "Meta de hoje da equipe"', () => {
    montar('gestao', 'supervisor', ['core', 'vendedor', 'gestor']);
    sim.inicio = domingo('equipe', COM_ADITIVO);
    const html = render();
    expect(rotulo(html)).toBe('Meta do mês da equipe');
    expect(html).not.toContain('Meta de hoje');
    expect(html).toContain('Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)');
  });
});

/** T-0124 / RD-0010 e RD-0012: estado zero e campos do Core sem contorno local. */
describe('estado zero e campos prontos do Core (RD-0010, RD-0012)', () => {
  it('sem as vendas na cópia (`sem_realizado`): o cartão some e uma frase só, no Sincronizar, explica', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = { ...visaoInicio('proprio', []), meta_hoje: null, sem_realizado: ['venda_cents'] } satisfies VisaoInicio;
    const html = render();
    expect(html).not.toContain('inicio.meta');
    expect(conta(html, /Sincronize para ver as vendas/g)).toBe(1);
    expect(html).toContain('data-testid="inicio-sincronizar-aviso-dados">Sincronize para ver as vendas<');
    expect(html).not.toContain('<progress');
  });

  it('sem meta nenhuma: uma frase, sem barra', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = { ...visaoInicio('proprio', []), meta_hoje: null } satisfies VisaoInicio;
    const html = render();
    expect(html).toContain('Nenhuma meta cadastrada.');
    expect(html).not.toContain('<progress');
  });

  it('só os campos prontos do Core (RD-0012): saudação do Core', () => {
    montar('campo', 'vendedor', ['core', 'vendedor']);
    sim.inicio = { ...visaoInicio('proprio'), saudacao: 'Bom dia', recados_hoje: { novos: 0, total: 0, itens: [] }, base: { dia: null, calculado_em: null, defasado: false } } satisfies VisaoInicio;
    const html = render();
    expect(html).toContain('data-testid="inicio.saudacao">Bom dia, Lucas<');
    expect(html).not.toContain('Sincronize para ver as vendas'); // sem `base.dia === null` local
  });
});
