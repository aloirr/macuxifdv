/**
 * Botão "Sincronizar" do shell (estoque diário, parte E; ADR 0057; docs/design/sincronizacao-completa.md §1 e §2). Puro:
 * - toque = sincronização parcial; segurar 10 s = completa com o popup (R-20261115-100000-alexandre, decisão 4). O toque
 *   não faz a carga diária (R-20261115-121000-alexandre): isso fica no motor (`modo: 'parcial'` pula as diárias);
 * - limite da sincronização MANUAL (R-20261115-125500-alexandre): uma a cada `INTERVALO_SYNC_MANUAL_MS`, contando toque e
 *   completa juntos. Dentro da janela o gesto não faz nada e não mostra nada (silencioso). O servidor também limita.
 *   O "puxar para baixo", a tela de carga e o agendador não passam por aqui.
 */
import type { ProgressoEntrada } from '@macuxi/core/contracts';
import type { ModoSincronizacao } from '@macuxi/platform-sdk';

import { textoDoErro } from './entrada';

/** Janela mínima entre duas sincronizações manuais (toque ou segurar 10 s). */
export const INTERVALO_SYNC_MANUAL_MS = 30_000;

export interface LimiteManual {
  /** O gesto pode disparar agora? Se sim, a janela começa aqui. */
  tentar: () => boolean;
}

export function criarLimiteManual(o: { intervaloMs?: number; agora?: () => number } = {}): LimiteManual {
  const intervalo = o.intervaloMs ?? INTERVALO_SYNC_MANUAL_MS;
  const agora = o.agora ?? (() => Date.now());
  let ultimo: number | null = null;
  return {
    tentar() {
      const t = agora();
      if (ultimo !== null && t - ultimo < intervalo) return false;
      ultimo = t;
      return true;
    },
  };
}

/** Fase do popup da completa (spec §2): fechado, em andamento, pronto (100% por 600 ms) ou parou (erro). */
export type FasePopupCompleta = 'fechado' | 'andando' | 'pronto' | 'erro';

export interface PopupCompleta {
  visivel: boolean;
  rotulo: string;
  pct: number | null;
  erro: string | null;
}

/**
 * O que o `PopupSincronizacaoCompleta` mostra: a mesma linha da barra da tela de carga sem a lista ("Etapa n de N · nome" e
 * o percentual, RN-CORE-48 e ADR 0017); pronto = "Pronto" e 100%; erro = `textoDoErro` sem a lista.
 */
export function popupDaCompleta(
  fase: FasePopupCompleta,
  progresso: Pick<ProgressoEntrada, 'atual' | 'total' | 'percentual' | 'parou_em'>,
  semSinal: boolean,
): PopupCompleta {
  if (fase === 'fechado') return { visivel: false, rotulo: '', pct: null, erro: null };
  if (fase === 'pronto') return { visivel: true, rotulo: 'Pronto', pct: 100, erro: null };
  const rotulo = `Etapa ${progresso.atual.numero} de ${progresso.total} · ${progresso.atual.nome}`;
  if (fase === 'erro')
    return { visivel: true, rotulo, pct: null, erro: textoDoErro(progresso.parou_em ?? progresso.atual, progresso.total, semSinal) };
  return { visivel: true, rotulo, pct: Math.min(99, progresso.percentual), erro: null };
}

export interface OpcoesSincronizacaoManual {
  limite: LimiteManual;
  /** `sincronizarManual` da plataforma: resolve `true` com sucesso. */
  sincronizar: (modo: ModoSincronizacao) => Promise<boolean>;
  /** Cada troca de fase do popup. */
  aoMudar: (fase: FasePopupCompleta) => void;
}

export interface SincronizacaoManual {
  /** Toque (ou soltou antes dos 10 s). Dentro da janela, nada. */
  tocar: () => void;
  /** Segurou 10 s: abre o popup e roda a completa. Dentro da janela, nada. */
  segurar: () => void;
  /**
   * "Tentar de novo" do popup: retoma a completa que parou. Não passa pelo limite (é a mesma completa que o usuário pediu;
   * se o servidor recusar, o popup volta ao erro).
   */
  tentarDeNovo: () => void;
  /** "Fechar" (erro) ou o fim do "Pronto". */
  fechar: () => void;
}

export function criarSincronizacaoManual(o: OpcoesSincronizacaoManual): SincronizacaoManual {
  let vez = 0;
  const completa = () => {
    const minha = ++vez;
    o.aoMudar('andando');
    void o
      .sincronizar('completa')
      .catch(() => false)
      .then((ok) => {
        if (minha === vez) o.aoMudar(ok ? 'pronto' : 'erro');
      });
  };
  return {
    tocar() {
      if (o.limite.tentar()) void o.sincronizar('parcial').catch(() => false);
    },
    segurar() {
      if (o.limite.tentar()) completa();
    },
    tentarDeNovo: completa,
    fechar() {
      vez++;
      o.aoMudar('fechado');
    },
  };
}
