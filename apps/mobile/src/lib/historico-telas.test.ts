/**
 * T-0071 (achado R-20261105-121434): histórico das telas de módulo por aba. O voltar do Android (e o `router.back()` do
 * `BackLink`) desempilha antes de sair do app, o `replace` substitui o topo, trocar de aba guarda a pilha de cada aba e o
 * logout zera tudo. Os cenários de ponta a ponta rodam sobre o TabRouter do próprio expo-router 57 (o mesmo do app).
 */
import { TabRouter } from 'expo-router/build/react-navigation/routers/TabRouter';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  abaDaEntrada,
  abrirAba,
  abrirTela,
  chaveDaAba,
  chaveDosParams,
  comHistoricoDoShell,
  ehSubstituicaoDeModulo,
  entradaDaRota,
  HISTORICO_VAZIO,
  LIMITE_HISTORICO,
  limparHistoricoDoShell,
  marcarSaidaDoModulo,
  marcarVoltaAoModulo,
  obterHistoricoDoShell,
  registrarTelaAberta,
  ROTA_MODULO,
  selecionarAba,
  telaAnterior,
  PARAM_SUBSTITUIR,
  voltarDaRaiz,
  voltarDaTelaAberta,
  assinarHistoricoDoShell,
  marcarOrigemFora,
  origemDaPilha,
  type HistoricoShell,
  type ParamsDaRota,
} from './historico-telas';
import { abaAcesa, type AbaShell, type AbasDoShell } from './abas';

const aba = (href: string, label: string): AbaShell => ({ href, label, icon: 'file', testID: `tab-${label}`, modulo: null });
/** Barra do Campo com Pedidos na barra e o Treinamento no "Mais". */
const ABAS: AbasDoShell = {
  barra: [aba('/', 'Início'), aba('/m/pedidos', 'Pedidos'), aba('/m/clientes', 'Clientes'), aba('/m/metas', 'Metas'), aba('/mais', 'Mais')],
  mais: [aba('/m/treinamento', 'Treinar')],
};

const p = (caminho: string, extras: Record<string, string> = {}): ParamsDaRota => ({ caminho: caminho.split('/'), ...extras });
const e = (caminho: string, extras: Record<string, string> = {}) => entradaDaRota(p(caminho, extras));
const chaves = (h: HistoricoShell, aba: string) => (h.pilhas[aba] ?? []).map((x) => x.chave);

describe('entradas do histórico', () => {
  it('chave, href e aba a partir dos parâmetros crus da rota', () => {
    const x = entradaDaRota({ caminho: ['pedido'], id: 'a b', __internal_expo_router_no_animation: 'true', vazio: undefined });
    expect(x.chave).toBe('pedido?id=a b');
    expect(x.href).toBe('/m/pedido?id=a%20b');
    expect(abaDaEntrada(x)).toBe('/m/pedido');
    expect(chaveDosParams({ caminho: 'treinamento/licao' })).toBe('treinamento/licao');
    expect(chaveDosParams(undefined)).toBe('');
    expect(chaveDaAba('/m/pedidos')).toBe('pedidos');
  });
});

describe('pilha de uma aba (função pura)', () => {
  const naAba = (aba: string, ...entradas: ReturnType<typeof e>[]): HistoricoShell => ({ pilhas: { [aba]: entradas }, aba, fora: false });

  it('vindo de fora, recomeça a pilha da aba da tela', () => {
    const r = abrirTela(HISTORICO_VAZIO, e('pedidos', { filtro: 'orcamentos' }), 'fora');
    expect(r.historico.aba).toBe('/m/pedidos');
    expect(chaves(r.historico, '/m/pedidos')).toEqual(['pedidos?filtro=orcamentos']);
    expect(r.historico.fora).toBe(false);
    expect(r.direcao).toBe('avancar');
  });
  it('navegar empilha e avança; a mesma tela não anima', () => {
    let h = naAba('/m/pedidos', e('pedidos'));
    let r = abrirTela(h, e('novo-pedido'), 'navegar');
    expect(r.direcao).toBe('avancar');
    h = r.historico;
    expect(chaves(h, '/m/pedidos')).toEqual(['pedidos', 'novo-pedido']);
    r = abrirTela(h, e('novo-pedido'), 'navegar');
    expect(r.direcao).toBe('nenhuma');
    expect(chaves(r.historico, '/m/pedidos')).toEqual(['pedidos', 'novo-pedido']);
  });
  it('ir para uma tela que já está na pilha volta até ela', () => {
    const h = naAba('/m/pedidos', e('pedidos'), e('pedido', { id: '1' }), e('cliente', { id: '9' }));
    const r = abrirTela(h, e('pedidos'), 'navegar');
    expect(r.direcao).toBe('voltar');
    expect(chaves(r.historico, '/m/pedidos')).toEqual(['pedidos']);
  });
  it('replace substitui o topo (o editor sai da pilha)', () => {
    const h = naAba('/m/pedidos', e('pedidos'), e('novo-pedido'));
    const r = abrirTela(h, e('pedido', { id: 'u1' }), 'substituir');
    expect(r.direcao).toBe('avancar');
    expect(chaves(r.historico, '/m/pedidos')).toEqual(['pedidos', 'pedido?id=u1']);
    // replace para a tela de baixo: só tira o topo
    expect(chaves(abrirTela(h, e('pedidos'), 'substituir').historico, '/m/pedidos')).toEqual(['pedidos']);
    // replace da única tela
    expect(chaves(abrirTela(naAba('/m/x', e('x')), e('y'), 'substituir').historico, '/m/x')).toEqual(['y']);
  });
  it('a pilha tem limite e guarda a raiz', () => {
    let h = naAba('/m/pedidos', e('pedidos'));
    for (let i = 0; i < LIMITE_HISTORICO + 10; i++) h = abrirTela(h, e('pedido', { id: String(i) }), 'navegar').historico;
    const pilha = chaves(h, '/m/pedidos');
    expect(pilha).toHaveLength(LIMITE_HISTORICO);
    expect(pilha[0]).toBe('pedidos');
    expect(pilha[pilha.length - 1]).toBe(`pedido?id=${LIMITE_HISTORICO + 9}`);
  });
  it('tela anterior só com a pilha em sincronia com a rota', () => {
    const h = naAba('/m/pedidos', e('pedidos'), e('pedido', { id: '1' }));
    expect(telaAnterior(h, 'pedido?id=1')?.chave).toBe('pedidos');
    expect(telaAnterior(h, 'outra')).toBeNull();
    expect(telaAnterior(naAba('/m/pedidos', e('pedidos')), 'pedidos')).toBeNull();
    expect(telaAnterior({ ...h, fora: true }, 'pedido?id=1')).toBeNull();
    expect(telaAnterior(HISTORICO_VAZIO, '')).toBeNull();
  });
  it('trocar de aba volta ao topo guardado; tocar de novo na aba em uso volta à raiz', () => {
    const h: HistoricoShell = {
      pilhas: { '/m/pedidos': [e('pedidos'), e('pedido', { id: '1' })], '/m/clientes': [e('clientes')] },
      aba: '/m/clientes',
      fora: false,
    };
    const ida = selecionarAba(h, '/m/pedidos', true);
    expect(ida.href).toBe('/m/pedido?id=1');
    expect(ida.historico.aba).toBe('/m/pedidos');
    const raiz = selecionarAba(ida.historico, '/m/pedidos', true);
    expect(raiz.href).toBe('/m/pedidos');
    expect(chaves(raiz.historico, '/m/pedidos')).toEqual(['pedidos']);
    // na aba em uso, mas vindo do Início (não está numa tela de módulo): volta ao topo, não à raiz
    expect(selecionarAba(ida.historico, '/m/pedidos', false).href).toBe('/m/pedido?id=1');
    // aba nova: raiz
    expect(selecionarAba(h, '/m/metas', false).href).toBe('/m/metas');
    // raiz que veio de fora com filtro: tocar de novo leva à raiz sem filtro
    const filtrada: HistoricoShell = { pilhas: { '/m/pedidos': [e('pedidos', { filtro: 'orcamentos' }), e('pedido', { id: '1' })] }, aba: '/m/pedidos', fora: false };
    const r = selecionarAba(filtrada, '/m/pedidos', true);
    expect(r.href).toBe('/m/pedidos');
    expect(chaves(r.historico, '/m/pedidos')).toEqual([]);
  });
  it('replace para tela de módulo, também aninhado no (tabs)', () => {
    expect(ehSubstituicaoDeModulo({ type: 'REPLACE', payload: { name: ROTA_MODULO, params: {} } })).toBe(true);
    expect(ehSubstituicaoDeModulo({ type: 'REPLACE', payload: { name: '(tabs)', params: { screen: ROTA_MODULO, params: {} } } })).toBe(true);
    expect(ehSubstituicaoDeModulo({ type: 'REPLACE', payload: { name: 'login' } })).toBe(false);
    expect(ehSubstituicaoDeModulo({ type: 'NAVIGATE', payload: { name: ROTA_MODULO } })).toBe(false);
  });
});

// ---------- ponta a ponta sobre o TabRouter do expo-router 57 ----------

interface Rota {
  name: string;
  key: string;
  params?: object;
}
interface Estado {
  key: string;
  index: number;
  routes: Rota[];
  history: unknown[];
}
interface Acao {
  type: string;
  target?: string;
  payload?: object;
}
interface Opcoes {
  routeNames: string[];
  routeParamList: Record<string, object | undefined>;
  routeGetIdList: Record<string, undefined>;
}
interface Roteador {
  getInitialState(o: Opcoes): Estado;
  getStateForAction(s: Estado, a: Acao, o: Opcoes): Estado | null;
}

/**
 * Simula o shell: o Tabs com `backBehavior="history"` e o roteador do shell; a tela de módulo registra quando a chave
 * muda (efeito de layout); depois vêm os eventos de foco da rota `m/[...caminho]`; o ouvinte de ações marca o replace.
 */
function simularShell() {
  const base = (TabRouter as unknown as (o: { backBehavior: string }) => Roteador)({ backBehavior: 'history' });
  const roteador: Roteador = { ...base, ...comHistoricoDoShell(base) };
  const opcoes: Opcoes = { routeNames: ['index', ROTA_MODULO, 'mais'], routeParamList: {}, routeGetIdList: {} };
  let estado = roteador.getInitialState(opcoes);
  let chaveMontada: string | null = null;
  let focada = 'index';
  const direcoes: string[] = [];
  /** Rótulo do voltar que mudou entre o render da tela e o registro dela (deve ficar vazio). */
  const piscadas: string[] = [];

  const aplicar = (novo: Estado | null): boolean => {
    if (!novo) return false;
    estado = novo;
    const rota = estado.routes[estado.index];
    if (rota.name === ROTA_MODULO) {
      const c = chaveDosParams(rota.params as ParamsDaRota);
      // o render da tela (antes do registro) já dá o rótulo do voltar que valerá depois dele: sem piscar
      const noRender = voltarDaTelaAberta(obterHistoricoDoShell(), rota.params as ParamsDaRota);
      if (c !== chaveMontada) {
        direcoes.push(registrarTelaAberta(rota.params as ParamsDaRota));
        chaveMontada = c;
      }
      const depois = voltarDaTelaAberta(obterHistoricoDoShell(), rota.params as ParamsDaRota);
      if (noRender !== depois) piscadas.push(`${c}: ${noRender?.rotulo ?? '-'} → ${depois?.rotulo ?? '-'}`);
    }
    if (rota.name !== focada) {
      if (focada === ROTA_MODULO) marcarSaidaDoModulo();
      if (rota.name === ROTA_MODULO) marcarVoltaAoModulo();
      if (rota.name === 'index') marcarOrigemFora('inicio');
      if (rota.name === 'mais') marcarOrigemFora('mais');
      focada = rota.name;
    }
    return true;
  };
  const acaoPara = (href: string, type: string): Acao => {
    const [caminho, qs] = href.split('?');
    if (caminho === '/') return { type, target: estado.key, payload: { name: 'index', params: {} } };
    if (caminho === '/mais') return { type, target: estado.key, payload: { name: 'mais', params: {} } };
    const params: Record<string, unknown> = { caminho: caminho.replace(/^\/m\//, '').split('/').map(decodeURIComponent) };
    for (const [k, v] of new URLSearchParams(qs ?? '')) params[k] = v;
    return { type, target: estado.key, payload: { name: ROTA_MODULO, params } };
  };
  const despachar = (a: Acao) => {
    const novo = roteador.getStateForAction(estado, a, opcoes);
    return aplicar(novo);
  };
  const tela = (): string => {
    const rota = estado.routes[estado.index];
    if (rota.name === 'index') return '/';
    if (rota.name === 'mais') return '/mais';
    return `/m/${chaveDosParams(rota.params as ParamsDaRota)}`;
  };
  const paramsDaTela = () => estado.routes[estado.index].params as ParamsDaRota | undefined;
  return {
    tela,
    direcoes,
    piscadas,
    /** Rótulo do voltar que o shell dá à tela de módulo em uso (`null` = vale o do módulo). */
    rotuloDoVoltar: () => voltarDaTelaAberta(obterHistoricoDoShell(), paramsDaTela())?.rotulo ?? null,
    /** Aba acesa na barra (o mesmo que o TabBar faz). */
    acesa: () => {
      const h = obterHistoricoDoShell();
      return abaAcesa(ABAS, tela(), { aba: h.aba, origem: origemDaPilha(h, h.aba) })?.label ?? null;
    },
    /** `router.navigate` / `router.push` (no Tabs, o push vira NAVIGATE). */
    ir: (href: string) => despachar(acaoPara(href, 'NAVIGATE')),
    substituir: (href: string) => despachar(acaoPara(href, 'REPLACE')),
    /** Toque na barra de abas (o mesmo que o TabBar faz). */
    tocarAba: (href: string) => despachar(acaoPara(href.startsWith('/m/') ? abrirAba(href, tela().startsWith('/m/')) : href, 'NAVIGATE')),
    /** Item da tela "Mais". */
    tocarNoMais: (href: string) => despachar(acaoPara(abrirAba(href, false), 'NAVIGATE')),
    /** `router.canGoBack()`: roda o GO_BACK "a seco". */
    podeVoltar: () => roteador.getStateForAction(estado, { type: 'GO_BACK' }, opcoes) !== null,
    /** Voltar do Android (ou `router.back()`): `false` = o app vai para segundo plano. */
    voltar: () => despachar({ type: 'GO_BACK' }),
  };
}

describe('voltar do Android entre telas de módulo (TabRouter do expo-router 57)', () => {
  beforeEach(() => limparHistoricoDoShell());

  it('orçamento salvo: o editor sai da pilha e o voltar leva a Pedidos, depois ao Início, depois sai do app', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/novo-pedido?customerId=c1');
    app.substituir('/m/pedido?id=u1');
    expect(app.tela()).toBe('/m/pedido?id=u1');
    expect(app.voltar()).toBe(true);
    expect(app.tela()).toBe('/m/pedidos');
    expect(app.voltar()).toBe(true);
    expect(app.tela()).toBe('/');
    expect(app.voltar()).toBe(false);
    expect(app.direcoes).toEqual(['nenhuma', 'avancar', 'avancar', 'voltar']);
  });

  it('o BackLink (canGoBack + back) desempilha sem cair no fallback', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    expect(app.podeVoltar()).toBe(true);
    expect(app.podeVoltar()).toBe(true); // a seco não mexe no histórico
    expect(chaves(obterHistoricoDoShell(), '/m/pedidos')).toEqual(['pedidos', 'pedido?id=1']);
    app.voltar();
    expect(app.tela()).toBe('/m/pedidos');
  });

  it('trocar de aba guarda o histórico de cada aba', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    app.tocarAba('/m/clientes');
    app.ir('/m/cliente?id=9');
    app.tocarAba('/m/pedidos');
    expect(app.tela()).toBe('/m/pedido?id=1');
    app.voltar();
    expect(app.tela()).toBe('/m/pedidos');
    app.tocarAba('/m/clientes');
    expect(app.tela()).toBe('/m/cliente?id=9');
    app.voltar();
    expect(app.tela()).toBe('/m/clientes');
    // troca de aba pela barra não desliza
    expect(app.direcoes).toEqual(['nenhuma', 'avancar', 'nenhuma', 'avancar', 'nenhuma', 'voltar', 'nenhuma', 'voltar']);
  });

  it('pelo Início e de volta à aba, a pilha continua', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    app.tocarAba('/');
    expect(app.tela()).toBe('/');
    app.tocarAba('/m/pedidos');
    expect(app.tela()).toBe('/m/pedido?id=1');
    app.voltar();
    expect(app.tela()).toBe('/m/pedidos');
  });

  it('tocar de novo na aba em uso volta à raiz da aba', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    app.ir('/m/cliente?id=9');
    app.tocarAba('/m/pedidos');
    expect(app.tela()).toBe('/m/pedidos');
    app.voltar();
    expect(app.tela()).toBe('/');
  });

  it('do Início para uma tela de módulo: a pilha recomeça e o voltar devolve ao Início', () => {
    const app = simularShell();
    app.tocarAba('/m/clientes');
    app.ir('/m/cliente?id=9');
    app.tocarAba('/');
    app.ir('/m/pedidos?filtro=orcamentos'); // card do Início
    app.ir('/m/pedido?id=1');
    app.voltar();
    expect(app.tela()).toBe('/m/pedidos?filtro=orcamentos');
    app.voltar();
    expect(app.tela()).toBe('/');
    // a aba Clientes continua onde estava
    app.tocarAba('/m/clientes');
    expect(app.tela()).toBe('/m/cliente?id=9');
  });

  it('pelo "Mais": o voltar na raiz da aba devolve ao Mais', () => {
    const app = simularShell();
    app.tocarAba('/mais');
    app.tocarNoMais('/m/treinamento');
    app.ir('/m/licao?id=3');
    app.voltar();
    expect(app.tela()).toBe('/m/treinamento');
    app.voltar();
    expect(app.tela()).toBe('/mais');
  });

  it('navegar para uma tela que já está na pilha (ex.: "Ver pedidos" no detalhe) volta até ela', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    app.ir('/m/pedidos');
    expect(chaves(obterHistoricoDoShell(), '/m/pedidos')).toEqual(['pedidos']);
    app.voltar();
    expect(app.tela()).toBe('/');
  });

  it('o replace vem marcado nos parâmetros da tela (sem relógio): aparelho lento não traz o editor de volta', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/novo-pedido');
    app.substituir('/m/pedido?id=u1');
    // o parâmetro não entra na chave nem fica guardado na pilha
    expect(chaves(obterHistoricoDoShell(), '/m/pedidos')).toEqual(['pedidos', 'pedido?id=u1']);
    expect(obterHistoricoDoShell().pilhas['/m/pedidos']!.some((x) => PARAM_SUBSTITUIR in x.params)).toBe(false);
    // navegar depois do replace empilha (nada de sinal pendurado)
    app.ir('/m/cliente?id=9');
    expect(chaves(obterHistoricoDoShell(), '/m/pedidos')).toEqual(['pedidos', 'pedido?id=u1', 'cliente?id=9']);
    // voltar à tela aberta por replace não conta como nova substituição
    app.voltar();
    app.ir('/m/produto?id=p');
    expect(chaves(obterHistoricoDoShell(), '/m/pedidos')).toEqual(['pedidos', 'pedido?id=u1', 'produto?id=p']);
  });

  it('o logout zera o histórico', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    limparHistoricoDoShell();
    expect(obterHistoricoDoShell()).toEqual(HISTORICO_VAZIO);
    expect(abrirAba('/m/pedidos', false)).toBe('/m/pedidos');
  });

  it('sem o roteador do shell, o replace do TabRouter tira o Início do histórico (o bug do achado)', () => {
    const base = (TabRouter as unknown as (o: { backBehavior: string }) => Roteador)({ backBehavior: 'history' });
    const opcoes: Opcoes = { routeNames: ['index', ROTA_MODULO, 'mais'], routeParamList: {}, routeGetIdList: {} };
    let s = base.getInitialState(opcoes);
    s = base.getStateForAction(s, { type: 'NAVIGATE', target: s.key, payload: { name: ROTA_MODULO, params: { caminho: ['novo-pedido'] } } }, opcoes) as Estado;
    s = base.getStateForAction(s, { type: 'REPLACE', target: s.key, payload: { name: ROTA_MODULO, params: { caminho: ['pedido'], id: 'u1' } } }, opcoes) as Estado;
    expect(base.getStateForAction(s, { type: 'GO_BACK' }, opcoes)).toBeNull();
  });
});

describe('T-0072 — aba acesa e rótulo do voltar pela pilha (R-20261105-125027, R-20261105-125030)', () => {
  beforeEach(() => limparHistoricoDoShell());

  it('Pedidos › detalhe e Pedidos › Novo pedido: a aba Pedidos fica acesa; o voltar mantém o rótulo do módulo', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    expect(app.acesa()).toBe('Pedidos');
    app.ir('/m/pedido?id=1');
    expect(app.acesa()).toBe('Pedidos');
    expect(app.rotuloDoVoltar()).toBeNull();
    app.voltar();
    app.ir('/m/novo-pedido?customerId=c1');
    expect(app.acesa()).toBe('Pedidos');
    expect(app.rotuloDoVoltar()).toBeNull();
    // o editor sai da pilha no replace e o detalhe continua na aba Pedidos
    app.substituir('/m/pedido?id=u1');
    expect(app.acesa()).toBe('Pedidos');
    expect(app.piscadas).toEqual([]);
  });

  it('Mais › Treinamento › lição: o "Mais" fica aceso', () => {
    const app = simularShell();
    app.tocarAba('/mais');
    expect(app.acesa()).toBe('Mais');
    app.tocarNoMais('/m/treinamento');
    expect(app.acesa()).toBe('Mais');
    app.ir('/m/licao?id=3');
    expect(app.acesa()).toBe('Mais');
    expect(app.rotuloDoVoltar()).toBeNull();
  });

  it('Início › cartão que abre um detalhe: o Início fica aceso e o voltar diz "Início" desde o primeiro quadro', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    app.ir('/m/pedido?id=1');
    app.tocarAba('/');
    expect(app.acesa()).toBe('Início');
    app.ir('/m/novo-pedido'); // cartão Novo pedido do Início
    expect(app.acesa()).toBe('Início');
    expect(app.rotuloDoVoltar()).toBe('Início');
    // salvar o orçamento (replace): a raiz continua sendo da pilha aberta pelo Início, e o voltar leva ao Início
    app.substituir('/m/pedido?id=u1');
    expect(app.acesa()).toBe('Início');
    expect(app.rotuloDoVoltar()).toBe('Início');
    // uma tela adiante na mesma pilha: vale o rótulo do módulo
    app.ir('/m/cliente?id=9');
    expect(app.rotuloDoVoltar()).toBeNull();
    expect(app.acesa()).toBe('Início');
    app.voltar();
    expect(app.rotuloDoVoltar()).toBe('Início');
    app.voltar();
    expect(app.tela()).toBe('/');
    // a aba Pedidos continua onde estava e acende de novo
    app.tocarAba('/m/pedidos');
    expect(app.tela()).toBe('/m/pedido?id=1');
    expect(app.acesa()).toBe('Pedidos');
    expect(app.rotuloDoVoltar()).toBeNull();
    expect(app.piscadas).toEqual([]);
  });

  it('cartão do Início que abre a raiz de uma aba: acende a própria aba', () => {
    const app = simularShell();
    app.ir('/m/pedidos?filtro=orcamentos');
    expect(app.acesa()).toBe('Pedidos');
    expect(app.rotuloDoVoltar()).toBe('Início');
  });

  it('pela aba, a raiz não ganha rótulo do shell; tocar de novo na aba também não', () => {
    const app = simularShell();
    app.tocarAba('/m/pedidos');
    expect(app.rotuloDoVoltar()).toBeNull();
    app.ir('/m/pedido?id=1');
    app.tocarAba('/m/pedidos');
    expect(app.tela()).toBe('/m/pedidos');
    expect(app.rotuloDoVoltar()).toBeNull();
    expect(app.acesa()).toBe('Pedidos');
  });

  it('pilha aberta de fora vinda do "Mais" (por um link): acende o "Mais" e o voltar diz "Mais"', () => {
    const app = simularShell();
    app.tocarAba('/mais');
    app.ir('/m/licao?id=3');
    expect(app.acesa()).toBe('Mais');
    expect(app.rotuloDoVoltar()).toBe('Mais');
    app.voltar();
    expect(app.tela()).toBe('/mais');
  });

  it('fora das telas de módulo, pelo caminho; sem dona conhecida, pelo caminho', () => {
    expect(abaAcesa(ABAS, '/', { aba: '/m/pedidos', origem: 'aba' })?.label).toBe('Início');
    expect(abaAcesa(ABAS, '/mais', { aba: '/m/pedidos', origem: 'aba' })?.label).toBe('Mais');
    expect(abaAcesa(ABAS, '/m/clientes', { aba: null, origem: 'aba' })?.label).toBe('Clientes');
    expect(abaAcesa(ABAS, '/m/pedido', { aba: null, origem: 'aba' })).toBeNull();
    // pilha aberta de fora sem origem conhecida (ex.: Perfil por cima de uma tela de módulo): o Início
    expect(abaAcesa(ABAS, '/m/meus-modulos', { aba: '/m/meus-modulos', origem: 'outra' })?.label).toBe('Início');
  });

  it('o rótulo do shell é a mesma referência enquanto não muda e some fora de sincronia', () => {
    const h = abrirTela(HISTORICO_VAZIO, e('novo-pedido'), 'fora', 'inicio').historico;
    expect(voltarDaRaiz(h, 'novo-pedido')).toEqual({ rotulo: 'Início' });
    expect(voltarDaRaiz(h, 'novo-pedido')).toBe(voltarDaRaiz(abrirTela(h, e('novo-pedido'), 'navegar').historico, 'novo-pedido'));
    expect(voltarDaRaiz(h, 'pedido?id=1')).toBeNull();
    expect(voltarDaRaiz({ ...h, fora: true }, 'novo-pedido')).toBeNull();
    expect(voltarDaRaiz(abrirTela(HISTORICO_VAZIO, e('novo-pedido'), 'fora', 'outra').historico, 'novo-pedido')).toBeNull();
    // a mesma tela voltando ao foco (fim do Perfil) não se registra de novo: vale a pilha como está
    expect(voltarDaTelaAberta({ ...h, fora: true }, p('novo-pedido'))).toEqual({ rotulo: 'Início' });
  });

  it('a barra e a tela releem a cada mudança do histórico (useSyncExternalStore)', () => {
    let avisos = 0;
    const cancelar = assinarHistoricoDoShell(() => avisos++);
    registrarTelaAberta(p('pedidos'));
    abrirAba('/m/clientes', true);
    marcarSaidaDoModulo();
    marcarSaidaDoModulo(); // sem mudança, sem aviso
    marcarVoltaAoModulo();
    expect(avisos).toBe(4);
    cancelar();
    limparHistoricoDoShell();
    expect(avisos).toBe(4);
  });
});
