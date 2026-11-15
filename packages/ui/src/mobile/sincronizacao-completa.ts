/**
 * R-20261115-100000 (docs/design/sync-completa/spec.md): o botão Sincronizar faz a sincronização PARCIAL no toque (fila +
 * pedidos e clientes, o `agendador.puxar()` de sempre) e a COMPLETA quando o dedo fica 10 s no botão. Parte PURA: tempos,
 * textos, o desenho de cada instante do segurar e o controle do gesto (relógio e intervalo injetáveis). Sem react-native:
 * roda em Node (Vitest) e é reexportada por `@macuxi/ui/mobile/puro`. O `BotaoSincronizar` (sincronizacao.tsx) só liga isto
 * ao `Pressable`; o popup é o `Dialogo` (folha.tsx) `bloqueado`, sem botões, com a `BarraProgresso` (barra-progresso-rn.tsx).
 */

/** Tempo segurando que dispara a sincronização completa (na hora, mesmo com o dedo ainda no botão). */
export const SEGURAR_COMPLETA_MS = 10_000;

/** Antes disso o segurar ainda parece um toque: nada muda no botão. Depois, o anel aparece e vibra leve. */
export const ESPERA_ANEL_MS = 500;

/** Textos do popup e da ação do leitor de tela (R-20261115-100000). */
export const TEXTOS_SYNC_COMPLETA = {
  titulo: 'Realizando a sincronização completa',
  texto: 'Aguarde e não saia desta tela.',
  acao: 'Sincronização completa',
} as const;

/** Linha abaixo da situação: em repouso e enquanto segura. */
export const DICAS_SEGURAR = {
  repouso: 'Segure 10 s para a sincronização completa',
  segurando: 'Solte antes para atualizar só pedidos e clientes',
} as const;

/** Rótulo do botão para o leitor de tela quando a completa é oferecida (o TalkBack não segura 10 s: usa a ação). */
export const ROTULO_ACESSIVEL_SYNC = 'Sincronizar. Toque para pedidos e clientes; ação: sincronização completa';

/** Nome interno da ação do leitor de tela (`accessibilityActions`). */
export const ACAO_LEITOR_SYNC_COMPLETA = 'sincronizacaoCompleta';

/** Anel de progresso no lugar do ícone `sync`: 22 dp, traço 3; trilho na cor do texto do botão a 30%. */
export const ANEL_SEGURAR = { tamanho: 22, traco: 3, opacidadeTrilho: 0.3 } as const;

export type ForcaVibracao = 'leve' | 'media';

/**
 * O que o botão oferece:
 * - `segurar`: toque = parcial; segurar 10 s = completa (com dica e ação do leitor);
 * - `toque`: só o toque (o shell não passou `sincronizarCompleta`): sem dica, sem ação do leitor, segurar = toque;
 * - `nenhum`: sem sinal ou ocupado; o botão está desabilitado e segurar nada faz.
 */
export type ModoSegurar = 'segurar' | 'toque' | 'nenhum';

export function modoDoSegurar(s: { temCompleta: boolean; semSinal: boolean; ocupado: boolean }): ModoSegurar {
  if (s.semSinal || s.ocupado) return 'nenhum';
  return s.temCompleta ? 'segurar' : 'toque';
}

/** Dica abaixo da situação; só no modo `segurar` (`null` = sem a completa, sem sinal ou ocupado). */
export function dicaDoSegurar(s: { modo: ModoSegurar; segurando: boolean }): string | null {
  if (s.modo !== 'segurar') return null;
  return s.segurando ? DICAS_SEGURAR.segurando : DICAS_SEGURAR.repouso;
}

export interface DesenhoSegurar {
  /** O anel substitui o ícone (só depois de `ESPERA_ANEL_MS`). */
  anel: boolean;
  /** 0..1 do anel; com "reduzir movimento" fica cheio e parado (só a contagem muda). */
  progresso: number;
  /** Segundos que faltam, de 10 a 1 (0 quando a completa já disparou). */
  segundosRestantes: number;
  /** "Continue segurando · N s"; `null` = rótulo de sempre ("Sincronizar"). */
  rotulo: string | null;
  /** A completa dispara neste instante. */
  completa: boolean;
}

/** Desenho do botão com o dedo há `ms` no botão (`null` = solto). */
export function desenhoSegurar(ms: number | null, opcoes: { reduzirMovimento?: boolean } = {}): DesenhoSegurar {
  if (ms === null || !Number.isFinite(ms) || ms < ESPERA_ANEL_MS) {
    return { anel: false, progresso: 0, segundosRestantes: SEGURAR_COMPLETA_MS / 1000, rotulo: null, completa: false };
  }
  const completa = ms >= SEGURAR_COMPLETA_MS;
  const segundosRestantes = completa ? 0 : Math.ceil((SEGURAR_COMPLETA_MS - ms) / 1000);
  const progresso = opcoes.reduzirMovimento ? 1 : Math.min(1, ms / SEGURAR_COMPLETA_MS);
  return {
    anel: true,
    progresso,
    segundosRestantes,
    rotulo: completa ? null : `Continue segurando · ${segundosRestantes} s`,
    completa,
  };
}

/** Vibração ao passar de `antes` para `agora` (ms segurando): leve ao surgir o anel, média aos 10 s. */
export function vibracaoDoSegurar(antes: number, agora: number): ForcaVibracao | null {
  if (antes < SEGURAR_COMPLETA_MS && agora >= SEGURAR_COMPLETA_MS) return 'media';
  if (antes < ESPERA_ANEL_MS && agora >= ESPERA_ANEL_MS) return 'leve';
  return null;
}

// ---------- controle do gesto ----------

export interface OpcoesControleSegurar {
  /** Modo atual (lido a cada evento: o shell pode perder o sinal no meio). */
  modo: () => ModoSegurar;
  /** Toque normal: a parcial (`agendador.puxar()`). */
  parcial: () => void;
  /** Aos 10 s segurando. */
  completa: () => void;
  /**
   * Intervalo mínimo entre disparos manuais (R-20261115-125500, `agendador.liberarManual()`): `false` = a completa é ignorada
   * em silêncio (sem a vibração final e sem `completa`). Ausente = sempre livre.
   */
  liberar?: () => boolean;
  vibrar?: (forca: ForcaVibracao) => void;
  /** Ms segurando a cada passo (`null` = solto), para redesenhar. */
  aoMudar: (ms: number | null) => void;
  agora?: () => number;
  /** Passo do redesenho (padrão 50 ms; com "reduzir movimento" o componente pode passar 250). */
  passoMs?: number;
  definirIntervalo?: (fn: () => void, ms: number) => unknown;
  limparIntervalo?: (id: unknown) => void;
}

export interface ControleSegurar {
  /** `onPressIn`: começa a contar (só no modo `segurar`). */
  pressionar(): void;
  /** `onPressOut` (vem antes do `onPress` no Pressable; também no cancelamento): para de contar. */
  soltar(): void;
  /** `onPress`: a parcial, a não ser que a completa já tenha disparado neste gesto. */
  tocar(): void;
  /** Ação do leitor de tela: a completa direto. */
  acaoDoLeitor(): void;
  /** Desmontou ou ficou desabilitado no meio: para sem disparar nada. */
  desligar(): void;
}

export function criarControleSegurar(o: OpcoesControleSegurar): ControleSegurar {
  const agora = o.agora ?? (() => Date.now());
  // timer-permitido: contagem visual do segurar 10 s, só com o dedo no botão; não consulta o servidor.
  const definir = o.definirIntervalo ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const limpar = o.limparIntervalo ?? ((id: unknown) => clearInterval(id as ReturnType<typeof setInterval>));
  let inicio: number | null = null;
  let ultimo = 0;
  let id: unknown = null;
  let disparou = false;

  const parar = () => {
    if (id !== null) limpar(id);
    id = null;
    const segurava = inicio !== null;
    inicio = null;
    ultimo = 0;
    if (segurava) o.aoMudar(null);
  };

  const passo = () => {
    if (inicio === null) return;
    if (o.modo() !== 'segurar') {
      parar();
      return;
    }
    const ms = agora() - inicio;
    const forca = vibracaoDoSegurar(ultimo, ms);
    ultimo = ms;
    if (ms >= SEGURAR_COMPLETA_MS) {
      disparou = true;
      parar();
      if (o.liberar && !o.liberar()) return;
      if (forca) o.vibrar?.(forca);
      o.completa();
      return;
    }
    if (forca) o.vibrar?.(forca);
    o.aoMudar(ms);
  };

  return {
    pressionar() {
      parar();
      disparou = false;
      if (o.modo() !== 'segurar') return;
      inicio = agora();
      ultimo = 0;
      id = definir(passo, o.passoMs ?? 50);
    },
    soltar() {
      parar();
    },
    tocar() {
      if (disparou) {
        disparou = false;
        return;
      }
      if (o.modo() === 'nenhum') return;
      o.parcial();
    },
    acaoDoLeitor() {
      if (o.modo() !== 'segurar') return;
      if (o.liberar && !o.liberar()) return;
      o.completa();
    },
    desligar() {
      parar();
    },
  };
}
