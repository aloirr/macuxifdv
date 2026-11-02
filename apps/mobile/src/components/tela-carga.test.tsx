/**
 * T-0059 — teste de componente da tela de carga (rota `/sync`), renderizada com `react-dom/server` e com
 * `react-native`, o roteador e o estado da plataforma simulados.
 * - R-20261102-091336: o motor termina com sucesso → a tela navega para `/` pelo ESTADO (também com a tela remontada
 *   e depois de sair e voltar ao app); com "Pronto" há sempre o botão "Entrar no app".
 * - R-20261102-090915: nenhum nome técnico de entidade/etapa/módulo aparece; frase amigável; erro com "Tentar de novo".
 * - R-20261102-090919 item 2: voltar do segundo plano no meio da carga não a reinicia.
 */
import { CARGA_VAZIA, type EstadoMotorSync, type ModuloId, type Perfil } from '@macuxi/platform-sdk';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deveSincronizar, type MotivoSync } from '@/lib/carga';
import { MANIFESTOS_INSTALADOS } from '@/lib/instalados';

/** Uma linha do tempo só: o instante "agora" do teste (a carga termina 1 s antes). */
const AGORA = Date.parse('2026-11-02T13:10:00.000Z');

// ---------- simulações ----------
type Props = { children?: ReactNode; testID?: string };
const host = (tag: string) =>
  function Host({ children, testID }: Props) {
    return createElement(tag, testID ? { 'data-testid': testID } : {}, children);
  };

vi.mock('react-native', () => ({
  View: host('div'),
  Text: host('span'),
  ScrollView: host('main'),
  StyleSheet: { create: <T,>(s: T) => s },
  Animated: { Text: host('span'), View: host('div'), Value: class {}, timing: () => ({ start: () => undefined }) },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 48, left: 0, right: 0 }) }));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => createElement('a', { 'data-redirect': href }),
  router: { replace: () => undefined },
}));
vi.mock('@macuxi/ui/mobile', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  type: new Proxy({}, { get: () => ({}) }),
  firstName: (n: string) => n.split(' ')[0],
  Banner: host('p'),
  ProgressBar: ({ pct }: { pct: number }) => createElement('progress', { value: pct, max: 100 }),
  Button: ({ label, testID }: { label: string; testID?: string }) => createElement('button', { 'data-testid': testID }, label),
}));

const ESTADO_INICIAL: EstadoMotorSync = {
  fila: [],
  aceitos: [],
  enviando: false,
  sincronizando: false,
  etapa: '',
  progresso: 0,
  erro: null,
  sincronizado_em: null,
  modulosAtivos: [],
  limpezaPendente: [],
  avisos: [],
  arquivos: [],
  carga: CARGA_VAZIA,
};

const sim = vi.hoisted(() => ({
  estado: null as unknown as EstadoMotorSync,
  perfil: 'vendedor' as Perfil,
  variante: 'campo' as 'campo' | 'gestao',
  modulos: [] as ModuloId[],
  offline: false,
  sincronizacoes: 0,
  ultimoInicio: null as number | null,
}));

/** Mesma regra do shell (`state/plataforma.tsx`): decide pelo estado do motor com `deveSincronizar`. */
function sincronizarSeNecessario(motivo: MotivoSync) {
  if (deveSincronizar(motivo, { estado: sim.estado, emCurso: false, ultimoInicio: sim.ultimoInicio, agora: AGORA })) sim.sincronizacoes++;
  return null;
}

vi.mock('@macuxi/platform-sdk/react', () => ({ useMotorSync: () => ({ motor: null, estado: sim.estado }) }));
vi.mock('@/state/plataforma', () => ({
  usePlataforma: () => ({
    sessao: { token: 't', user: { id: 'u1', name: 'Lucas Andrade', email: 'lucas@demo', perfil: sim.perfil } },
    perfil: sim.perfil,
    variante: sim.variante,
    modulosAtivos: sim.modulos,
    offline: sim.offline,
    sincronizar: () => Promise.resolve(true),
    sincronizarSeNecessario,
    setOffline: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  }),
}));

const { TelaCarga } = await import('./tela-carga');

// ---------- utilitários ----------
const montar = () => renderToStaticMarkup(createElement(TelaCarga));
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const redireciona = (html: string) => /data-redirect="\/"/.test(html);

/** Entidades de sync de todos os manifestos instalados (ex.: cliente_condicao, pedido_evento) e ids técnicos de módulo. */
const ENTIDADES = [...new Set(MANIFESTOS_INSTALADOS.flatMap((m) => m.sync))];
const IDS_TECNICOS = ['core', 'catalogo', 'gestor', 'integracao'];
const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento'];

function semNomeTecnico(html: string) {
  const t = texto(html);
  expect(t).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  const palavras = new Set(t.toLowerCase().split(/[^a-zà-ú0-9_]+/i));
  for (const e of ENTIDADES) {
    if (e.includes('_')) expect(t).not.toContain(e);
  }
  for (const id of IDS_TECNICOS) expect(palavras.has(id)).toBe(false);
}

beforeEach(() => {
  sim.estado = { ...ESTADO_INICIAL };
  sim.perfil = 'vendedor';
  sim.variante = 'campo';
  sim.modulos = TODOS;
  sim.offline = false;
  sim.sincronizacoes = 0;
  sim.ultimoInicio = null;
});

describe('Tela de carga — navegação pelo estado (R-20261102-091336)', () => {
  it('motor termina com sucesso → redireciona para / e mostra "Pronto", 100% e "Entrar no app"', () => {
    sim.estado = { ...sim.estado, sincronizando: true, etapa: 'cliente_condicao', progresso: 0.1 };
    const durante = montar();
    expect(redireciona(durante)).toBe(false);
    expect(durante).not.toContain('entrar-no-app');

    sim.estado = { ...sim.estado, sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' };
    const depois = montar();
    expect(redireciona(depois)).toBe(true);
    expect(texto(depois)).toContain('Pronto');
    expect(texto(depois)).toContain('100%');
    expect(depois).toContain('data-testid="entrar-no-app"');
    expect(texto(depois)).toContain('Entrar no app');
  });

  it('término com a tela remontada (a promessa se perdeu): a montagem nova já navega pelo estado', () => {
    sim.estado = { ...sim.estado, sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' };
    expect(redireciona(montar())).toBe(true);
    // nada a fazer na montagem: a carga terminou agora
    expect(sim.sincronizacoes).toBe(0);
  });

  it('sair e voltar durante a carga: não reinicia; quando o motor termina com o app fora, a volta entra no Início', () => {
    sim.ultimoInicio = AGORA - 20_000;
    sim.estado = { ...sim.estado, sincronizando: true, etapa: 'historico_compra', progresso: 0.45 };
    expect(redireciona(montar())).toBe(false);
    // AppState background → active com a carga em andamento (regra do shell)
    sincronizarSeNecessario('volta');
    expect(sim.sincronizacoes).toBe(0);
    // o motor terminou enquanto o app estava em segundo plano; a volta re-renderiza a tela
    sim.estado = { ...sim.estado, sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: new Date(AGORA - 1_000).toISOString() };
    sincronizarSeNecessario('volta');
    expect(sim.sincronizacoes).toBe(0);
    expect(redireciona(montar())).toBe(true);
  });

  it('abrir com a carga já gravada → entra direto, mesmo com a sincronização rodando em segundo plano', () => {
    sim.estado = { ...sim.estado, sincronizando: true, etapa: 'pedido_evento', progresso: 0.3, sincronizado_em: '2026-11-01T20:00:00.000Z' };
    const html = montar();
    expect(redireciona(html)).toBe(true);
    expect(html).toContain('data-testid="entrar-no-app"');
    semNomeTecnico(html);
  });

  it('nunca fica "Pronto" sem caminho: todo estado com "Pronto" tem redirecionamento e botão', () => {
    const estados: Partial<EstadoMotorSync>[] = [
      { sincronizando: false, progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' },
      { sincronizando: false, progresso: 0, sincronizado_em: '2026-11-02T13:09:00.000Z', erro: 'HTTP 502' },
    ];
    for (const e of estados) {
      sim.estado = { ...ESTADO_INICIAL, ...e };
      const html = montar();
      if (texto(html).includes('Pronto')) {
        expect(redireciona(html)).toBe(true);
        expect(html).toContain('entrar-no-app');
      }
    }
  });
});

describe('Tela de carga — sem nome técnico (R-20261102-090915)', () => {
  it('em nenhuma etapa do motor aparece entidade, etapa ou módulo; aparece uma frase amigável', () => {
    expect(ENTIDADES).toEqual(expect.arrayContaining(['cliente_condicao', 'cliente_tabela_preco', 'historico_compra', 'indicador_diario', 'pedido_evento']));
    for (const etapa of ['Enviando a fila', ...ENTIDADES, 'Seu perfil']) {
      sim.estado = { ...ESTADO_INICIAL, sincronizando: true, etapa, progresso: 0.5 };
      const html = montar();
      semNomeTecnico(html);
      expect(texto(html)).not.toContain(etapa === 'Seu perfil' || etapa === 'Enviando a fila' ? etapa : `${etapa} `);
      expect(html).toContain('data-testid="carga-frase"');
      expect(texto(html)).toContain('Olá, Lucas');
      expect(texto(html)).toContain('50%');
    }
  }, 30_000); // renderiza todas as etapas do motor: com a máquina carregada (bundle, outros agentes) passa de 5 s

  it('promotor: frase sem pedido; Gestão: frase da equipe', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, etapa: 'pedido', progresso: 0.2 };
    sim.perfil = 'promotor';
    expect(texto(montar())).not.toMatch(/pedido/i);
    sim.perfil = 'supervisor';
    sim.variante = 'gestao';
    expect(texto(montar())).not.toMatch(/rota de hoje|bater sua meta/i);
  });

  it('erro: mensagem amigável e "Tentar de novo"; o detalhe técnico não aparece', () => {
    sim.estado = { ...ESTADO_INICIAL, erro: 'HTTP 500: falha ao puxar cliente_condicao (código SYNC_PULL)' };
    const html = montar();
    semNomeTecnico(html);
    expect(texto(html)).toContain('Não conseguimos baixar seus dados. Confira o sinal e tente de novo.');
    expect(html).toContain('data-testid="tentar-de-novo"');
    expect(texto(html)).not.toContain('HTTP 500');
    expect(texto(html)).not.toContain('SYNC_PULL');
    expect(redireciona(html)).toBe(false);
  });

  it('erro no modo sem sinal: oferece desligar o modo sem sinal', () => {
    sim.offline = true;
    sim.estado = { ...ESTADO_INICIAL, erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' };
    const html = montar();
    expect(html).toContain('data-testid="desligar-sem-sinal"');
    expect(html).toContain('data-testid="tentar-de-novo"');
  });

  it('a raiz rola (ScrollView) e a frase some ao terminar', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, progresso: 0.5 };
    expect(montar()).toMatch(/^<main data-testid="tela-carga">/);
    sim.estado = { ...ESTADO_INICIAL, progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' };
    expect(montar()).not.toContain('carga-frase');
  });
});

describe('Tela de carga — retomada e progresso (ADR 0017, EstadoMotorSync.carga)', () => {
  it('carga em andamento: aviso "Mantenha o app aberto"; some com a carga pronta', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, progresso: 0.2 };
    expect(texto(montar())).toContain('Mantenha o app aberto');
    sim.estado = { ...ESTADO_INICIAL, progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' };
    expect(montar()).not.toContain('carga-app-aberto');
  });

  it('retomada: "Continuando de onde parou" e a barra parte do que já estava gravado, sem nome técnico', () => {
    sim.estado = {
      ...ESTADO_INICIAL,
      sincronizando: true,
      etapa: 'cliente_condicao',
      progresso: 0.6,
      carga: { entidade: 'cliente_condicao', modulo: 'core', concluidas: 6, total: 10, paginas: 3, retomada: true },
    };
    const html = montar();
    expect(texto(html)).toContain('Continuando de onde parou');
    // 60% gravado + metade da fatia da entidade em andamento (3 páginas de ~6)
    expect(texto(html)).toContain('65%');
    semNomeTecnico(html);
    // passada normal: rótulo "Sincronizando"
    sim.estado = { ...sim.estado, carga: { ...sim.estado.carga, retomada: false } };
    expect(texto(montar())).not.toContain('Continuando de onde parou');
  });

  it('frase do módulo em andamento (carga.modulo) sem citar o módulo', () => {
    sim.estado = {
      ...ESTADO_INICIAL,
      sincronizando: true,
      etapa: 'pedido',
      progresso: 0.5,
      carga: { entidade: 'pedido', modulo: 'vendedor', concluidas: 5, total: 10, paginas: 0, retomada: false },
    };
    const html = montar();
    expect(texto(html)).toContain('Trazendo seus pedidos recentes para consultar sem sinal');
    semNomeTecnico(html);
  });
});
