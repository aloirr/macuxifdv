/**
 * T-0059 e T-0172 — teste de componente da carga depois do login (rota `/sync`) na tela única de entrada, renderizada com
 * `react-dom/server` e com `react-native`, o roteador e o estado da plataforma simulados.
 * - R-20261102-091336: o motor termina com sucesso → a tela navega para `/` pelo ESTADO (também com a tela remontada e
 *   depois de sair e voltar ao app). T-0172: abre o Início sozinho, sem botão.
 * - R-20261102-090915 e T-0172: nenhum nome técnico; só "Etapa n de N · nome", o percentual e as etapas; nenhuma frase
 *   sobre o que o app faz por trás; erro com "Tentar de novo" e "Trocar usuário".
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
  Animated: {
    View: host('div'),
    Value: class {
      setValue() {}
      interpolate() {
        return '0%';
      }
    },
    timing: () => ({ start: () => undefined }),
  },
  Pressable: ({ children, testID }: Props) => createElement('button', testID ? { 'data-testid': testID } : {}, children),
  StyleSheet: { create: <T,>(s: T) => s, absoluteFill: {} },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 48, left: 0, right: 0 }) }));
vi.mock('react-native-svg', () => ({ SvgXml: () => createElement('svg') }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('@/components/area-segura', () => ({ useFaixaSuperior: () => 24, useCorDaFaixa: () => undefined }));
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => createElement('a', { 'data-redirect': href }),
  router: { replace: () => undefined },
}));
vi.mock('@macuxi/ui/mobile', () => ({
  fonts: new Proxy({}, { get: () => 'fonte' }),
  temaDaEntrada: () => new Proxy({}, { get: () => '#000' }),
  firstName: (n: string) => n.split(' ')[0],
  Icon: () => createElement('i'),
  useReduzirMovimento: () => true,
  Botao: ({ rotulo, testID }: { rotulo: string; testID?: string }) => createElement('button', { 'data-testid': testID }, rotulo),
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

describe('Carga na tela de entrada — navegação pelo estado (R-20261102-091336, T-0172)', () => {
  it('motor termina com sucesso → "Pronto", 100%, tudo feito e abre o Início sozinho, sem botão', () => {
    sim.estado = { ...sim.estado, sincronizando: true, etapa: 'cliente_condicao', progresso: 0.1 };
    const durante = montar();
    expect(redireciona(durante)).toBe(false);

    sim.estado = { ...sim.estado, sincronizando: false, etapa: 'Pronto', progresso: 1, sincronizado_em: '2026-11-02T13:09:00.000Z' };
    const depois = montar();
    expect(redireciona(depois)).toBe(true);
    expect(texto(depois)).toContain('Pronto 100%');
    expect(depois).not.toMatch(/data-testid="entrada-etapa-\d-(atual|pendente)"/);
    expect(depois).not.toContain('entrar-no-app');
    expect(depois).not.toContain('<button');
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
    semNomeTecnico(html);
  });
});

describe('Carga na tela de entrada — etapas sem nome técnico (R-20261102-090915, T-0172)', () => {
  it('em nenhuma entidade do motor aparece entidade ou módulo; aparece "Etapa n de N · nome", "Olá" e o percentual', () => {
    expect(ENTIDADES).toEqual(expect.arrayContaining(['cliente_condicao', 'cliente_tabela_preco', 'historico_compra', 'indicador_diario', 'pedido_evento']));
    for (const entidade of ENTIDADES) {
      sim.estado = { ...ESTADO_INICIAL, sincronizando: true, etapa: entidade, progresso: 0.5, carga: { ...CARGA_VAZIA, entidade, modulo: 'core', total: 10, concluidas: 5 } };
      const html = montar();
      semNomeTecnico(html);
      expect(texto(html)).toMatch(/Etapa \d de \d · [A-ZÀ-Ú]/);
      expect(texto(html)).toContain('Olá, Lucas');
      expect(texto(html)).toContain('50%');
    }
  }, 120_000); // renderiza todas as entidades do motor: com a máquina carregada (bundle, outros agentes) passa de 30 s

  it('Campo: etapa atual pelo módulo em curso; as anteriores feitas e as seguintes a fazer', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, progresso: 0.4, carga: { ...CARGA_VAZIA, entidade: 'produto', modulo: 'catalogo', total: 10, concluidas: 4 } };
    const html = montar();
    expect(texto(html)).toContain('Etapa 3 de 5 · Catálogo e preços');
    expect(html).toContain('entrada-etapa-2-feita');
    expect(html).toContain('entrada-etapa-3-atual');
    expect(html).toContain('entrada-etapa-4-pendente');
  });

  it('sem frase sobre o que o app faz por trás (só o nome da etapa e o percentual)', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, progresso: 0.2, carga: { ...CARGA_VAZIA, retomada: true } };
    expect(texto(montar())).not.toMatch(/Mantenha o app aberto|Continuando de onde parou|Preparando|Estamos deixando/);
  });

  it('RN-PRO-01: o promotor não vê etapa de pedido; Gestão: etapas da equipe', () => {
    sim.estado = { ...ESTADO_INICIAL, sincronizando: true, progresso: 0.2 };
    sim.perfil = 'promotor';
    expect(texto(montar())).not.toMatch(/pedido/i);
    sim.perfil = 'supervisor';
    sim.variante = 'gestao';
    const gestao = texto(montar());
    expect(gestao).toContain('Equipe');
    expect(gestao).toContain('Aprovações');
    expect(gestao).not.toMatch(/Clientes e rota/);
  });

  it('retomada: a barra parte do que já estava gravado', () => {
    sim.estado = {
      ...ESTADO_INICIAL,
      sincronizando: true,
      etapa: 'cliente_condicao',
      progresso: 0.6,
      carga: { entidade: 'cliente_condicao', modulo: 'core', concluidas: 6, total: 10, paginas: 3, retomada: true },
    };
    const html = montar();
    // 60% gravado + metade da fatia da entidade em andamento (3 páginas de ~6)
    expect(texto(html)).toContain('65%');
    semNomeTecnico(html);
  });
});

describe('Carga na tela de entrada — parou (T-0172)', () => {
  it('erro: "Parou na etapa n de N", "Tentar de novo" e "Trocar usuário"; o detalhe técnico não aparece', () => {
    sim.estado = { ...ESTADO_INICIAL, erro: 'HTTP 500: falha ao puxar cliente_condicao (código SYNC_PULL)', carga: { ...CARGA_VAZIA, entidade: 'cliente_condicao', modulo: 'core' } };
    const html = montar();
    semNomeTecnico(html);
    expect(texto(html)).toContain('Parou na etapa 2 de 5');
    expect(html).toContain('data-testid="tentar-de-novo"');
    expect(texto(html)).toContain('Trocar usuário');
    // a lista continua, com a etapa que parou marcada
    expect(html).toContain('entrada-etapa-2-parou');
    expect(texto(html)).not.toContain('HTTP 500');
    expect(texto(html)).not.toContain('SYNC_PULL');
    expect(redireciona(html)).toBe(false);
  });

  it('sem sinal: "Sem internet na etapa n de N"; no modo sem sinal, oferece desligá-lo', () => {
    sim.estado = { ...ESTADO_INICIAL, erro: 'Sem sinal: a sincronização fica para quando a conexão voltar.' };
    const semSinal = montar();
    expect(texto(semSinal)).toContain('Sem internet na etapa 1 de 5');
    expect(semSinal).not.toContain('desligar-sem-sinal');
    sim.offline = true;
    const modo = montar();
    expect(modo).toContain('data-testid="desligar-sem-sinal"');
    expect(modo).toContain('data-testid="tentar-de-novo"');
  });
});
