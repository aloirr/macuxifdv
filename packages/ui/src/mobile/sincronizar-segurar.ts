/**
 * Botão "Sincronizar": toque e segurar 10 s (estoque diário, parte F; spec docs/design/sincronizacao-completa.md §1 e §2;
 * R-20261115-100000-alexandre, decisão 4; ADR 0057). Parte PURA (sem react-native), testada com timers falsos:
 * - toque, ou soltar antes dos 10 s = `onToque` (sincronização parcial);
 * - aos 600 ms segurando, a contagem "Sincronização completa em N s" e a faixa aparecem (vibração leve);
 * - aos 10 s ainda segurando, vibra e chama `onSegurar` (sincronização completa); soltar depois não faz nada.
 * Os textos do popup da completa também moram aqui.
 */

/** Tempo segurando até a sincronização completa. */
export const SEGURAR_COMPLETA_MS = 10_000;
/** A contagem e a faixa só aparecem depois deste tempo (o toque de quem tem pressa não pisca a contagem). */
export const LIMIAR_CONTAGEM_MS = 600;
/** "Pronto" e 100% ficam na tela este tempo antes de o popup fechar sozinho (o mesmo da tela de carga). */
export const ESPERA_PRONTO_POPUP_MS = 600;

/** Texto do popup em andamento: literal do Alexandre (R-20261115-100000-alexandre). Não mude. */
export const TEXTO_SINCRONIZACAO_COMPLETA = 'Realizando a sincronização completa, aguarde e não saia dessa tela';
/** Rótulo da ação de acessibilidade (menu de ações do TalkBack) que abre a completa direto. */
export const ACAO_SINCRONIZACAO_COMPLETA = 'Sincronização completa';
/** Dica do leitor de tela no botão (a tela não mostra dica de "segure"). */
export const DICA_SINCRONIZAR_SEGURAR = 'Toque para atualizar pedidos e clientes. Segure 10 segundos para a sincronização completa.';

export interface EstadoSegurar {
  /** `repouso`: rótulo normal; `pressionado`: dedo no botão, antes dos 600 ms; `contando`: contagem e faixa na tela. */
  fase: 'repouso' | 'pressionado' | 'contando';
  /** Segundos que faltam (9 a 1) na fase `contando`; 0 fora dela. */
  segundos: number;
  /** Faixa de 0 a 100, contada do toque (6 aos 600 ms, depois de 10 em 10 a cada segundo). */
  pct: number;
}

export const ESTADO_REPOUSO: EstadoSegurar = { fase: 'repouso', segundos: 0, pct: 0 };

/** Segundos que faltam para os 10 s, de 9 a 1 (aos 600 ms: 9; aos 4 s: 6). */
export function segundosParaCompleta(decorridoMs: number): number {
  return Math.max(1, Math.min(9, Math.ceil((SEGURAR_COMPLETA_MS - decorridoMs) / 1000)));
}

/** Rótulo do botão enquanto segura. */
export function rotuloDoSegurar(segundos: number): string {
  return `Sincronização completa em ${segundos} s`;
}

/** Anúncio único do leitor de tela aos 600 ms. */
export function anuncioDoSegurar(segundos: number): string {
  return `Sincronização completa em ${segundos} segundos`;
}

/** Faixa em % do tempo, contada do toque. */
export function pctDoSegurar(decorridoMs: number): number {
  return Math.max(0, Math.min(100, Math.round((decorridoMs / SEGURAR_COMPLETA_MS) * 100)));
}

/** Estado "Pronto" do popup: chegou a 100% sem erro (a frase sai; ficam "Pronto", 100% e a barra cheia). */
export function popupPronto(pct: number | null, erro: string | null | undefined): boolean {
  return !erro && pct !== null && pct >= 100;
}

export interface OpcoesSegurar {
  /** Toque, ou soltou antes dos 10 s: sincronização parcial. */
  onToque: () => void;
  /** Segurou 10 s: sincronização completa. */
  onSegurar: () => void;
  /** Cada mudança do rótulo e da faixa. */
  onMudar?: (estado: EstadoSegurar) => void;
  /** Vibração (aos 600 ms e aos 10 s). */
  vibrar?: () => void;
  /** Aos 600 ms, uma vez (o leitor de tela anuncia a contagem). */
  onAnunciar?: (texto: string) => void;
  /** Outra sincronização em curso: o toque não faz nada; o segurar funciona. */
  ocupado?: () => boolean;
  /** Relógio (testes). */
  agora?: () => number;
}

export interface ControleSegurar {
  pressionar: () => void;
  soltar: () => void;
  /** Desmontou ou o gesto foi interrompido sem soltar: limpa sem disparar nada. */
  cancelar: () => void;
}

/** Máquina do gesto: `pressionar` no `onPressIn`, `soltar` no `onPressOut`. */
export function criarControleSegurar(o: OpcoesSegurar): ControleSegurar {
  const agora = o.agora ?? (() => Date.now());
  let inicio = 0;
  let ativo = false;
  let timers: ReturnType<typeof setTimeout>[] = [];

  const limpar = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };
  const mudar = (e: EstadoSegurar) => o.onMudar?.(e);
  const contar = () => {
    const decorrido = agora() - inicio;
    mudar({ fase: 'contando', segundos: segundosParaCompleta(decorrido), pct: pctDoSegurar(decorrido) });
  };

  return {
    pressionar() {
      limpar();
      ativo = true;
      inicio = agora();
      mudar({ fase: 'pressionado', segundos: 0, pct: 0 });
      timers.push(
        setTimeout(() => {
          contar();
          o.vibrar?.();
          o.onAnunciar?.(anuncioDoSegurar(segundosParaCompleta(LIMIAR_CONTAGEM_MS)));
        }, LIMIAR_CONTAGEM_MS),
      );
      for (let s = 1000; s < SEGURAR_COMPLETA_MS; s += 1000) timers.push(setTimeout(contar, s));
      timers.push(
        setTimeout(() => {
          limpar();
          ativo = false;
          mudar(ESTADO_REPOUSO);
          o.vibrar?.();
          o.onSegurar();
        }, SEGURAR_COMPLETA_MS),
      );
    },
    soltar() {
      if (!ativo) return;
      limpar();
      ativo = false;
      mudar(ESTADO_REPOUSO);
      if (!o.ocupado?.()) o.onToque();
    },
    cancelar() {
      limpar();
      if (ativo) mudar(ESTADO_REPOUSO);
      ativo = false;
    },
  };
}
