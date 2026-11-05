/**
 * Histórico das telas de módulo por aba (T-0071, achado R-20261105-121434; T-0072). Puro: roda em Node (Vitest).
 *
 * Todas as telas de módulo moram numa rota só do Tabs (`(tabs)/m/[...caminho]`), então o expo-router não tem pilha entre
 * elas: navegar de uma tela de módulo para outra só troca os parâmetros da rota, e o `router.replace` do TabRouter ainda
 * tira a entrada anterior do histórico das abas. Sem este histórico, o voltar do Android sai do app.
 *
 * Regras (o shell aplica; ninguém nos módulos precisa saber delas):
 * - cada aba tem a própria pilha (chave = href da aba, ex.: `/m/pedidos`); trocar de aba pela barra guarda a pilha e volta
 *   ao topo dela; tocar de novo na aba em que se está volta à raiz da aba;
 * - navegar (push ou navigate) de uma tela de módulo para outra empilha; ir para uma tela que já está na pilha volta até ela;
 * - `replace` substitui o topo (o editor sai da pilha: docs/design/componentes.md §7.2);
 * - abrir uma tela de módulo vindo de fora das telas de módulo (Início, Mais, Perfil, notificação) recomeça a pilha da aba
 *   daquela tela, e o voltar na raiz devolve à tela de onde se veio (histórico das abas do expo-router);
 * - o voltar (do Android ou o `BackLink` do kit, via `router.back()`) desempilha antes de sair da aba
 *   (`comHistoricoDoShell`, ligado no `UNSTABLE_router` do Tabs);
 * - logout ou aparelho bloqueado zeram tudo (`limparHistoricoDoShell`).
 * Só guarda caminho e parâmetros da rota (ids): nada de dado de cliente.
 *
 * O que a interface lê daqui (T-0072, R-20261105-125027 e R-20261105-125030; docs/design/componentes.md §6.1):
 * - a aba acesa é a dona da pilha (`HistoricoShell.aba` + `origemDaPilha`; `abaAcesa` em lib/abas.ts);
 * - o rótulo do voltar na raiz de uma pilha aberta de fora diz para onde o voltar leva (`voltarDaRaiz`: "Início" ou
 *   "Mais"); o hook `useVoltarDoShell` (state/historico-do-shell.ts) já dá o valor no primeiro quadro da tela.
 * A barra e a tela releem pelo `assinarHistoricoDoShell` (useSyncExternalStore): a mudança feita no `useLayoutEffect`
 * da tela que abriu é aplicada antes de pintar, sem piscar a aba antiga.
 */
import { chaveDaRota, type DirecaoTransicao } from './transicao-modulo';

/** Nome da rota das telas de módulo no Tabs do shell. */
export const ROTA_MODULO = 'm/[...caminho]';

/** Telas guardadas por aba; passando disso, a raiz fica e as do meio saem. */
export const LIMITE_HISTORICO = 30;

/**
 * Parâmetro interno que o roteador do shell põe na tela aberta por `router.replace` de outra tela de módulo (ADR 0026,
 * R-20261105-130317 E1): a tela que abre substitui o topo da pilha. Começa com `__`, então não entra na chave da tela, e
 * não é guardado na pilha (voltar a essa tela não conta como nova substituição). Sem relógio e sem evento interno.
 */
export const PARAM_SUBSTITUIR = '__macuxi_substituir';

export type ParamsDaRota = Readonly<Record<string, unknown>>;

export interface EntradaHistorico {
  /** Caminho + parâmetros em ordem (`pedido?id=1`): identifica a tela. */
  chave: string;
  /** Href para voltar a ela pela barra de abas (`/m/pedido?id=1`). */
  href: string;
  /** Parâmetros crus da rota, como estão no estado de navegação (o voltar navega com eles). */
  params: ParamsDaRota;
}

/**
 * De onde a pilha da aba foi aberta: pela barra de abas ou pelo "Mais" (`aba`), ou de fora das telas de módulo,
 * pela tela de onde se veio (`inicio`, `mais`; `outra` quando não se sabe). O voltar na raiz leva de volta a ela.
 */
export type OrigemPilha = 'aba' | 'inicio' | 'mais' | 'outra';

export interface HistoricoShell {
  /** Pilha de cada aba (chave = href da aba). */
  pilhas: Readonly<Record<string, readonly EntradaHistorico[]>>;
  /** Origem de cada pilha (chave = href da aba); sem registro = `aba`. */
  origens?: Readonly<Record<string, OrigemPilha>>;
  /** Aba das telas de módulo em uso (a da última tela de módulo aberta). */
  aba: string | null;
  /** As telas de módulo estão fora de foco (Início, Mais, Perfil): a próxima que abrir recomeça a pilha da aba dela. */
  fora: boolean;
  /**
   * Última tela fora das telas de módulo que ganhou foco (padrão: Início). A pilha aberta de fora guarda esta origem: é
   * para onde o histórico das abas devolve no voltar da raiz.
   */
  origemFora?: 'inicio' | 'mais';
}

export type ModoAbertura = 'navegar' | 'substituir' | 'fora';

export const HISTORICO_VAZIO: HistoricoShell = { pilhas: {}, aba: null, fora: true };

// ---------- entradas ----------

function textoDoParam(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map(String).join(',');
  return String(v);
}

/** Parâmetros que não identificam a tela: o próprio caminho, vazios e os internos do expo-router (`__...`). */
function paramDaChave(k: string, v: unknown): boolean {
  return k !== 'caminho' && !k.startsWith('__') && textoDoParam(v) !== null;
}

function caminhoDosParams(params: ParamsDaRota | undefined): string[] {
  const c = params?.caminho;
  if (Array.isArray(c)) return c.map(String).filter(Boolean);
  if (typeof c === 'string') return c.split('/').filter(Boolean);
  return [];
}

/** Chave da tela a partir dos parâmetros crus da rota (a mesma no shell e no roteador). */
export function chaveDosParams(params: ParamsDaRota | undefined): string {
  const caminho = caminhoDosParams(params);
  const extras: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (paramDaChave(k, v)) extras[k] = textoDoParam(v) as string;
  }
  return chaveDaRota(caminho, extras);
}

/** Entrada do histórico para a tela de módulo aberta com estes parâmetros. */
export function entradaDaRota(params: ParamsDaRota | undefined): EntradaHistorico {
  const caminho = caminhoDosParams(params);
  const query = Object.keys(params ?? {})
    .filter((k) => paramDaChave(k, params?.[k]))
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(textoDoParam(params?.[k]) as string)}`);
  const href = `/m/${caminho.map(encodeURIComponent).join('/')}${query.length ? `?${query.join('&')}` : ''}`;
  const guardados: Record<string, unknown> = { ...(params ?? {}) };
  delete guardados[PARAM_SUBSTITUIR];
  return { chave: chaveDosParams(params), href, params: guardados };
}

/** A tela abriu por um `router.replace` de outra tela de módulo (marcado pelo roteador do shell)? */
export function abriuSubstituindo(params: ParamsDaRota | undefined): boolean {
  return params?.[PARAM_SUBSTITUIR] === '1';
}

/** Aba de uma tela aberta de fora: a do próprio caminho (`/m/pedidos?filtro=x` → `/m/pedidos`). */
export function abaDaEntrada(entrada: EntradaHistorico): string {
  return `/m/${entrada.chave.split('?')[0]}`;
}

/** Chave da raiz de uma aba (`/m/pedidos` → `pedidos`). */
export function chaveDaAba(aba: string): string {
  return aba.replace(/^\/m\/+/, '').split('?')[0].replace(/\/+$/, '');
}

function limitar(pilha: readonly EntradaHistorico[]): EntradaHistorico[] {
  if (pilha.length <= LIMITE_HISTORICO) return [...pilha];
  return [pilha[0], ...pilha.slice(-(LIMITE_HISTORICO - 1))];
}

/** Grava a pilha da aba (e a origem dela, quando a pilha recomeça). */
function comPilha(h: HistoricoShell, aba: string, pilha: readonly EntradaHistorico[], origem?: OrigemPilha): HistoricoShell {
  const origens = origem ? { ...h.origens, [aba]: origem } : h.origens;
  return { ...h, pilhas: { ...h.pilhas, [aba]: pilha }, ...(origens ? { origens } : {}), aba, fora: false };
}

/** Origem da pilha desta aba (sem registro = aberta pela barra ou pelo "Mais"). */
export function origemDaPilha(h: HistoricoShell, aba: string | null): OrigemPilha {
  return (aba !== null && h.origens?.[aba]) || 'aba';
}

// ---------- transições ----------

/**
 * Próximo histórico e direção da animação para a tela de módulo que acabou de abrir. `origem` = tela de onde se veio
 * quando a pilha recomeça (modo `fora`).
 */
export function abrirTela(
  h: HistoricoShell,
  entrada: EntradaHistorico,
  modo: ModoAbertura,
  origem: OrigemPilha = 'outra',
): { historico: HistoricoShell; direcao: DirecaoTransicao } {
  if (modo === 'fora' || h.aba === null) {
    return { historico: comPilha(h, abaDaEntrada(entrada), [entrada], origem), direcao: 'avancar' };
  }
  const aba = h.aba;
  const pilha = h.pilhas[aba] ?? [];
  if (modo === 'substituir') {
    const base = pilha.slice(0, -1);
    const i = base.findLastIndex((e) => e.chave === entrada.chave);
    if (i >= 0) return { historico: comPilha(h, aba, [...base.slice(0, i), entrada]), direcao: 'voltar' };
    return { historico: comPilha(h, aba, limitar([...base, entrada])), direcao: 'avancar' };
  }
  if (pilha.length === 0) return { historico: comPilha(h, aba, [entrada]), direcao: 'nenhuma' };
  const topo = pilha[pilha.length - 1];
  if (topo.chave === entrada.chave) return { historico: comPilha(h, aba, [...pilha.slice(0, -1), entrada]), direcao: 'nenhuma' };
  const i = pilha.findLastIndex((e) => e.chave === entrada.chave);
  if (i >= 0) return { historico: comPilha(h, aba, [...pilha.slice(0, i), entrada]), direcao: 'voltar' };
  return { historico: comPilha(h, aba, limitar([...pilha, entrada])), direcao: 'avancar' };
}

/**
 * Toque numa aba de módulo (barra ou "Mais"): devolve para onde navegar. `jaNaAba` = a pessoa está numa tela de módulo e
 * tocou na aba em uso → volta à raiz da aba; senão, volta ao topo da pilha guardada (ou à raiz, na primeira vez).
 */
export function selecionarAba(h: HistoricoShell, aba: string, jaNaAba: boolean): { historico: HistoricoShell; href: string } {
  const pilha = h.pilhas[aba] ?? [];
  if (jaNaAba && h.aba === aba) {
    const raiz = pilha[0];
    const manter = raiz && raiz.chave === chaveDaAba(aba) ? [raiz] : [];
    return { historico: comPilha(h, aba, manter, 'aba'), href: aba };
  }
  const topo = pilha[pilha.length - 1];
  return { historico: comPilha(h, aba, pilha, 'aba'), href: topo?.href ?? aba };
}

/** Tela para onde o voltar leva dentro da aba, ou `null` (raiz da aba ou histórico fora de sincronia com a rota). */
export function telaAnterior(h: HistoricoShell, chaveAtual: string): EntradaHistorico | null {
  if (h.aba === null || h.fora) return null;
  const pilha = h.pilhas[h.aba] ?? [];
  if (pilha.length < 2 || pilha[pilha.length - 1].chave !== chaveAtual) return null;
  return pilha[pilha.length - 2];
}

/** Rótulo do voltar dado pelo shell (o `BackLink` do kit usa por cima do rótulo do módulo). */
export interface VoltarDoShell {
  /** Para onde o voltar leva: "Início" ou "Mais". */
  readonly rotulo: string;
}

/** Valores fixos (mesma referência a cada leitura: o contexto do kit não re-renderiza à toa). */
const VOLTAR_PARA: Partial<Record<OrigemPilha, VoltarDoShell>> = {
  inicio: Object.freeze({ rotulo: 'Início' }),
  mais: Object.freeze({ rotulo: 'Mais' }),
};

/**
 * Rótulo do voltar da tela `chaveAtual` dado pelo shell: só na raiz de uma pilha aberta de fora das telas de módulo
 * (Início, ou o "Mais" por um link), em que o voltar devolve à tela de origem. No resto (telas do meio da pilha, raiz
 * de uma aba aberta pela barra, histórico fora de sincronia), `null`: vale o rótulo do módulo.
 */
export function voltarDaRaiz(h: HistoricoShell, chaveAtual: string): VoltarDoShell | null {
  if (h.aba === null || h.fora) return null;
  const pilha = h.pilhas[h.aba] ?? [];
  if (pilha.length !== 1 || pilha[0].chave !== chaveAtual) return null;
  return VOLTAR_PARA[origemDaPilha(h, h.aba)] ?? null;
}

// ---------- roteador do Tabs ----------

interface AcaoMinima {
  type: string;
  target?: string;
  payload?: unknown;
}

interface EstadoDasAbasMinimo {
  key: string;
  index: number;
  routes: readonly { name: string; params?: object }[];
}

/** A ação é um `router.replace` para uma tela de módulo? (o payload pode vir aninhado: `(tabs)` → `m/[...caminho]`). */
export function ehSubstituicaoDeModulo(acao: AcaoMinima): boolean {
  if (acao.type !== 'REPLACE') return false;
  let p: unknown = acao.payload;
  for (let i = 0; i < 6 && p && typeof p === 'object'; i++) {
    const { name, screen, params } = p as { name?: unknown; screen?: unknown; params?: unknown };
    if (name === ROTA_MODULO || screen === ROTA_MODULO) return true;
    p = params;
  }
  return false;
}

/**
 * Sobrescreve o roteador do Tabs (`UNSTABLE_router`) sem efeito colateral (o `canGoBack` roda o GO_BACK "a seco"):
 * - GO_BACK numa tela de módulo com tela anterior na pilha da aba → mesma rota com os parâmetros da anterior (o
 *   `registrarTelaAberta` desempilha quando ela abre); na raiz da aba, segue o histórico das abas;
 * - REPLACE de tela de módulo para tela de módulo → JUMP_TO (o REPLACE do TabRouter do expo-router 57 tira a aba anterior
 *   do histórico das abas e o voltar sairia do app), com `PARAM_SUBSTITUIR` nos parâmetros: a tela que abre substitui o
 *   topo da pilha (ADR 0026).
 */
export function comHistoricoDoShell<S extends EstadoDasAbasMinimo, A extends AcaoMinima, O, R>(
  original: { getStateForAction(state: S, action: A, options: O): R },
  lerHistorico: () => HistoricoShell = obterHistoricoDoShell,
): { getStateForAction(state: S, action: A, options: O): R } {
  return {
    getStateForAction(state, action, options) {
      const rota = state.routes[state.index];
      const paraEsteNavegador = !action.target || action.target === state.key;
      if (paraEsteNavegador && rota?.name === ROTA_MODULO) {
        if (action.type === 'GO_BACK') {
          const anterior = telaAnterior(lerHistorico(), chaveDosParams(rota.params as ParamsDaRota | undefined));
          if (anterior) {
            const ir = { type: 'JUMP_TO', target: state.key, payload: { name: ROTA_MODULO, params: { ...anterior.params } } };
            return original.getStateForAction(state, ir as unknown as A, options);
          }
        } else if (ehSubstituicaoDeModulo(action) && (action.payload as { name?: unknown } | undefined)?.name === ROTA_MODULO) {
          const payload = action.payload as { params?: object };
          const ir = { ...action, type: 'JUMP_TO', payload: { ...payload, params: { ...payload.params, [PARAM_SUBSTITUIR]: '1' } } };
          return original.getStateForAction(state, ir, options);
        }
      }
      return original.getStateForAction(state, action, options);
    },
  };
}

// ---------- estado do shell (um histórico por app) ----------

let historicoDoShell: HistoricoShell = HISTORICO_VAZIO;
const ouvintes = new Set<() => void>();

function mudar(h: HistoricoShell): void {
  if (h === historicoDoShell) return;
  historicoDoShell = h;
  for (const ouvir of [...ouvintes]) ouvir();
}

/** Retrato atual do histórico (o `getSnapshot` do `useSyncExternalStore`: mesma referência enquanto não muda). */
export function obterHistoricoDoShell(): HistoricoShell {
  return historicoDoShell;
}

/** Avisa a cada mudança do histórico (o `subscribe` do `useSyncExternalStore`); devolve a função que cancela. */
export function assinarHistoricoDoShell(ouvir: () => void): () => void {
  ouvintes.add(ouvir);
  return () => {
    ouvintes.delete(ouvir);
  };
}

/** A rota das telas de módulo perdeu o foco (Início, Mais, Perfil...). */
export function marcarSaidaDoModulo(): void {
  if (!historicoDoShell.fora) mudar({ ...historicoDoShell, fora: true });
}

/** A rota das telas de módulo voltou ao foco sem trocar de tela (o voltar das abas, o fim do Perfil). */
export function marcarVoltaAoModulo(): void {
  if (historicoDoShell.fora) mudar({ ...historicoDoShell, fora: false });
}

/**
 * O Início ou o "Mais" ganhou foco: uma tela de módulo aberta de lá (cartão do Início, notificação, link do Perfil, que
 * fecha por cima dele) recomeça a pilha com esta origem. É a última rota do Tabs fora das telas de módulo, para onde o
 * histórico das abas devolve no voltar da raiz.
 */
export function marcarOrigemFora(origem: 'inicio' | 'mais'): void {
  if ((historicoDoShell.origemFora ?? 'inicio') !== origem) mudar({ ...historicoDoShell, origemFora: origem });
}

/** Toque numa aba de módulo: guarda a escolha e devolve o href para navegar (topo da pilha da aba ou a raiz). */
export function abrirAba(aba: string, jaNaAba: boolean): string {
  const r = selecionarAba(historicoDoShell, aba, jaNaAba);
  mudar(r.historico);
  return r.href;
}

/**
 * O que `registrarTelaAberta` fará com a tela destes parâmetros, sem mudar nada. Puro: depende só do retrato do
 * histórico e dos parâmetros da rota (o replace vem marcado em `PARAM_SUBSTITUIR`), então a tela pode ler no render.
 * Depois do registro, prever de novo dá a mesma pilha.
 */
export function preverTelaAberta(h: HistoricoShell, params: ParamsDaRota | undefined): { historico: HistoricoShell; direcao: DirecaoTransicao } {
  const modo: ModoAbertura = h.fora ? 'fora' : abriuSubstituindo(params) ? 'substituir' : 'navegar';
  return abrirTela(h, entradaDaRota(params), modo, h.origemFora ?? 'inicio');
}

/**
 * Rótulo do voltar da tela de módulo destes parâmetros, como ficará depois do registro (`voltarDaRaiz` sobre
 * `preverTelaAberta`): a tela lê no render e já nasce com "‹ Início" na raiz de uma pilha aberta pelo Início.
 * A tela que já está no topo da pilha não se registra de novo (a mesma tela volta ao foco, ex.: o fim do Perfil): vale a
 * pilha como está, também enquanto ela está fora de foco. Puro (retrato + parâmetros).
 */
export function voltarDaTelaAberta(h: HistoricoShell, params: ParamsDaRota | undefined): VoltarDoShell | null {
  const chave = chaveDosParams(params);
  const pilha = h.aba === null ? [] : (h.pilhas[h.aba] ?? []);
  if (pilha.length > 0 && pilha[pilha.length - 1].chave === chave) return voltarDaRaiz({ ...h, fora: false }, chave);
  return voltarDaRaiz(preverTelaAberta(h, params).historico, chave);
}

/** Registra a tela de módulo que abriu e devolve a direção da animação. */
export function registrarTelaAberta(params: ParamsDaRota | undefined): DirecaoTransicao {
  const r = preverTelaAberta(historicoDoShell, params);
  mudar(r.historico);
  return r.direcao;
}

/** Zera o histórico do shell: no fim da sessão (logout ou aparelho bloqueado) e nos testes. */
export function limparHistoricoDoShell(): void {
  mudar(HISTORICO_VAZIO);
}
