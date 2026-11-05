/**
 * RN-CORE-23 — sincronização no app (docs/produto/03 seção 3; R-20261102-121135, R-20261102-124413 e R-20261102-124628).
 * Substitui a "atualização automática de 3–5 min" (o R-20261102-123955 foi cancelado): nenhuma tela consulta o servidor
 * sozinha; quem atualiza é o MOTOR de sync, por um único agendador do app.
 *
 * Parte pura (sem react-native nem expo): o agendador recebe relógio e temporizador por injeção, para o teste com relógio
 * simulado. O shell (apps/mobile) cria UM agendador e liga ao AppState; as telas usam `useAtualizacaoAutomatica` e o
 * `BotaoSincronizar` (sincronizacao.tsx), que leem o mesmo agendador pelo `SincronizacaoProvider`.
 *
 * Quando sincroniza:
 * 1. ao abrir o app (atualização leve);
 * 2. ao voltar ao primeiro plano, se a última sincronização tem 30 min ou mais (leve);
 * 3. a cada `sync_auto_min` (padrão 30, mínimo 15) com o app em uso e com sinal (leve);
 * 4. aviso do servidor (push, com ou sem a lista de entidades): leve, só das entidades indicadas;
 * 5. puxar para baixo e botão "Sincronizar": envio da fila + pull na hora (completa), com proteção de 30 s.
 * Nada roda com o app em segundo plano (a tarefa do ADR 0017 é outra, de 15 min). Uma sincronização que falha espera o
 * intervalo inteiro antes da próxima automática (nada de repetir em laço sem sinal).
 */
import { dentroDaProtecao, PROTECAO_PUXAR_MS, VOLTA_PRIMEIRO_PLANO_MS } from '../comum/sincronizacao';
import { formatHHMM } from './time';

export * from '../comum/sincronizacao';

/** Por que o app sincroniza (RN-CORE-23). `manual` = puxar para baixo ou botão Sincronizar. */
export type MotivoSync = 'abertura' | 'volta' | 'periodico' | 'aviso' | 'manual';

/** `recente` = caiu na proteção de 30 s (nada foi feito); `falhou` = a sincronização terminou com erro. */
export type ResultadoPuxar = 'sincronizou' | 'recente' | 'falhou';

type Temporizador = unknown;

export interface OpcoesAgendadorSync {
  /** Intervalo da automática (ms), lido a cada agendamento: o parâmetro do tenant pode mudar numa sincronização. */
  intervaloMs: () => number;
  /**
   * Dispara o motor. `manual` = completa (fila + pull); os outros = leve (novidades; `entidades` no aviso do servidor).
   * Devolve `false` quando falhou (o motor guarda o erro no estado).
   */
  sincronizar: (motivo: MotivoSync, entidades?: readonly string[]) => Promise<unknown>;
  /** Instante (ms) da última sincronização concluída (`sincronizado_em` do motor) ou null. */
  ultimaSincronizacao: () => number | null;
  /** Sessão aberta, carga inicial feita e sinal (modo sem sinal desligado). Sem isso, nenhuma automática. */
  podeSincronizar: () => boolean;
  /** `false` = o app abriu sem precisar sincronizar já (ex.: acabou de fazer a carga inicial). Padrão: true. */
  sincronizarAoAbrir?: boolean;
  aoMudar?: (estado: EstadoAgendadorSync) => void;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => Temporizador;
  cancelar?: (t: Temporizador) => void;
}

export interface EstadoAgendadorSync {
  /** true durante a sincronização pedida pelo puxar/botão (liga o indicador do topo). A automática é silenciosa. */
  puxando: boolean;
  /** O último toque caiu na proteção de 30 s: a tela mostra "Atualizado há instantes". */
  recente: boolean;
}

export interface AgendadorSync {
  /** App em primeiro plano: na primeira vez é a abertura; depois, a volta (só sincroniza com 30 min sem sincronizar). */
  primeiroPlano(): void;
  /** App em segundo plano: cancela o próximo disparo (nenhuma consulta até voltar). */
  segundoPlano(): void;
  /** Puxar para baixo / botão Sincronizar (proteção de 30 s). */
  puxar(): Promise<ResultadoPuxar>;
  /** Aviso do servidor (push): leve, só das entidades indicadas (sem lista = novidades). Ignorado sem sinal. */
  aviso(entidades?: readonly string[]): Promise<void>;
  /** Recalcula o próximo disparo (ex.: o parâmetro mudou, ou o sinal voltou). */
  reprogramar(): void;
  /** Desliga de vez (logout, troca de usuário). */
  parar(): void;
  estado(): EstadoAgendadorSync;
}

export function criarAgendadorSync(op: OpcoesAgendadorSync): AgendadorSync {
  const agora = op.agora ?? (() => Date.now());
  const agendar = op.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar = op.cancelar ?? ((t: Temporizador) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let ativo = false;
  let parado = false;
  let aberto = false;
  let timer: Temporizador | null = null;
  /** Só apaga o "Atualizado há instantes" quando a proteção acaba (único disparo, sem consulta ao servidor). */
  let timerRecente: Temporizador | null = null;
  let emCurso: Promise<boolean> | null = null;
  /** Início da última tentativa (automática ou manual): base do próximo disparo quando a sincronização falha. */
  let ultimaTentativa: number | null = null;
  let ultimoManual: number | null = null;
  let st: EstadoAgendadorSync = { puxando: false, recente: false };

  const mudar = (parcial: Partial<EstadoAgendadorSync>) => {
    const novo = { ...st, ...parcial };
    if (novo.puxando === st.puxando && novo.recente === st.recente) return;
    st = novo;
    op.aoMudar?.(st);
  };
  const limpar = () => {
    if (timer !== null) cancelar(timer);
    timer = null;
  };
  const programar = () => {
    limpar();
    if (!ativo || parado) return;
    const base = Math.max(op.ultimaSincronizacao() ?? 0, ultimaTentativa ?? 0) || agora();
    const falta = Math.max(0, base + op.intervaloMs() - agora());
    timer = agendar(() => {
      timer = null;
      if (!ativo || parado) return;
      if (op.podeSincronizar()) void rodar('periodico');
      else {
        // sem sinal: tenta de novo só depois de mais um intervalo inteiro
        ultimaTentativa = agora();
        programar();
      }
    }, falta);
  };
  const rodar = (motivo: MotivoSync, entidades?: readonly string[]): Promise<boolean> => {
    if (parado) return Promise.resolve(false);
    if (emCurso) {
      // o aviso do servidor pode ter chegado depois do pull da entidade: roda de novo quando a atual terminar
      if (motivo === 'aviso' || motivo === 'manual') return emCurso.then(() => rodar(motivo, entidades));
      return emCurso;
    }
    limpar();
    ultimaTentativa = agora();
    const p: Promise<boolean> = (async () => {
      try {
        return (await op.sincronizar(motivo, entidades)) !== false;
      } catch {
        // o motor guarda o erro no estado; a tela mostra pelo estado, o agendador só segue o ritmo
        return false;
      } finally {
        emCurso = null;
        programar();
      }
    })();
    emCurso = p;
    return p;
  };

  return {
    primeiroPlano() {
      if (ativo || parado) return;
      ativo = true;
      if (!aberto) {
        aberto = true;
        if (op.sincronizarAoAbrir !== false && op.podeSincronizar()) {
          void rodar('abertura');
          return;
        }
        programar();
        return;
      }
      const ult = op.ultimaSincronizacao();
      if (op.podeSincronizar() && (ult === null || agora() - ult >= VOLTA_PRIMEIRO_PLANO_MS)) void rodar('volta');
      else programar();
    },
    segundoPlano() {
      ativo = false;
      limpar();
    },
    async puxar() {
      const t = agora();
      if (dentroDaProtecao(ultimoManual, t)) {
        mudar({ recente: true });
        if (timerRecente !== null) cancelar(timerRecente);
        timerRecente = agendar(() => {
          timerRecente = null;
          mudar({ recente: false });
        }, Math.max(0, (ultimoManual ?? t) + PROTECAO_PUXAR_MS - t));
        return 'recente';
      }
      ultimoManual = t;
      mudar({ puxando: true, recente: false });
      try {
        return (await rodar('manual')) ? 'sincronizou' : 'falhou';
      } finally {
        mudar({ puxando: false });
      }
    },
    async aviso(entidades) {
      if (parado || !op.podeSincronizar()) return;
      await rodar('aviso', entidades);
    },
    reprogramar() {
      if (!emCurso) programar();
    },
    parar() {
      parado = true;
      ativo = false;
      limpar();
      if (timerRecente !== null) cancelar(timerRecente);
      timerRecente = null;
    },
    estado() {
      return st;
    },
  };
}

/** "Última sincronização hh:mm · N na fila" (RN-CORE-23 item 1), hora no fuso do tenant. */
export function textoUltimaSincronizacao(sincronizadoEm: number | string | Date | null | undefined, naFila: number, tz?: string): string {
  const fila = `${naFila} na fila`;
  if (sincronizadoEm === null || sincronizadoEm === undefined || sincronizadoEm === '') return `Ainda não sincronizado · ${fila}`;
  return `Última sincronização ${formatHHMM(sincronizadoEm, tz)} · ${fila}`;
}

/**
 * Textos do `BotaoSincronizar` (T-0076, referência R-20261104-164000-alexandre): botão curto ("Sincronizar"; sem sinal,
 * "Sem sinal", desabilitado) e, abaixo, centralizada, a linha "Última sincronização hh:mm · N na fila". O motivo do
 * desabilitado vai numa linha própria: o rótulo do botão é de uma linha só e o texto longo cortava em 360 dp.
 */
export function desenhoBotaoSincronizar(s: {
  semSinal: boolean;
  recente: boolean;
  sincronizadoEm: number | string | Date | null | undefined;
  naFila: number;
  tz?: string;
}): { rotulo: string; situacao: string; aviso: string | null } {
  return {
    rotulo: s.semSinal ? 'Sem sinal' : 'Sincronizar',
    situacao: s.recente ? 'Atualizado há instantes' : textoUltimaSincronizacao(s.sincronizadoEm, s.naFila, s.tz),
    aviso: s.semSinal ? 'Desligue o modo sem sinal para sincronizar' : null,
  };
}

/**
 * Rodapé das listas: "Atualizado às hh:mm · puxe para sincronizar"; depois de um toque dentro da proteção, "Atualizado há instantes".
 * Modo sem sinal (T-0071, revisão de UX): só a hora, sem o convite a puxar (o puxar não sincroniza; a tela mostra o motivo).
 */
export function rodapeAtualizacao(atualizadoEm: number | string | Date | null | undefined, tz?: string, opcoes: { recente?: boolean; semSinal?: boolean } = {}): string {
  const semHora = atualizadoEm === null || atualizadoEm === undefined || atualizadoEm === '';
  if (opcoes.semSinal) return semHora ? 'Ainda não sincronizado' : `Atualizado às ${formatHHMM(atualizadoEm, tz)}`;
  if (opcoes.recente) return 'Atualizado há instantes';
  if (semHora) return 'Puxe para sincronizar';
  return `Atualizado às ${formatHHMM(atualizadoEm, tz)} · puxe para sincronizar`;
}
