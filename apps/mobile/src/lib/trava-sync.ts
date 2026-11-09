/**
 * Trava única do processo entre o app com tela e a tarefa sem tela (T-0140, relatos 1 e 6: o app abria e fechava depois de
 * atualizado e na carga inicial). Depois da troca do APK (`MY_PACKAGE_REPLACED`), o WorkManager e o expo-task-manager
 * restauram as tarefas `macuxi-sync-delta` e `macuxi-push-sync` e o Android acorda o JS sem tela; o vendedor abre o app ao
 * mesmo tempo. Esta trava impede as duas sincronizações de andarem juntas no mesmo processo:
 * - o app declara o que está fazendo (`entrar('abertura' | 'sincronizacao')`, `sair(...)`), sem nunca esperar pela trava:
 *   a abertura e a carga do app não ficam presas atrás da tarefa;
 * - a tarefa só começa com o app parado (`tomarSegundoPlano`); com o app abrindo ou sincronizando, ela desiste na hora
 *   (vai ao Diagnóstico como "não rodou: o app estava abrindo ou sincronizando");
 * - o app que precisa sincronizar enquanto a tarefa roda espera ela terminar (`esperarSegundoPlano`) e relê o que ela gravou.
 * Pura (roda em Node): a instância do processo fica em `services/segundo-plano.ts`.
 */

export type AtividadeDoApp = 'abertura' | 'sincronizacao';

export interface TravaSync {
  /** O app começou uma atividade (contador por tipo: chamadas aninhadas valem). */
  entrar(a: AtividadeDoApp): void;
  /** O app terminou a atividade (a mais, sem `entrar`, é ignorada). */
  sair(a: AtividadeDoApp): void;
  /** Alguma atividade do app em andamento. */
  appOcupado(): boolean;
  /** A tarefa sem tela tenta começar: só com o app parado e sem outra passada da tarefa. */
  tomarSegundoPlano(): boolean;
  liberarSegundoPlano(): void;
  segundoPlanoAtivo(): boolean;
  /** Resolve quando a passada da tarefa terminar (na hora, sem passada). */
  esperarSegundoPlano(): Promise<void>;
}

export function criarTravaSync(): TravaSync {
  const contagem: Record<AtividadeDoApp, number> = { abertura: 0, sincronizacao: 0 };
  let segundoPlano = false;
  let esperando: (() => void)[] = [];
  const appOcupado = () => contagem.abertura > 0 || contagem.sincronizacao > 0;
  return {
    entrar(a) {
      contagem[a]++;
    },
    sair(a) {
      contagem[a] = Math.max(0, contagem[a] - 1);
    },
    appOcupado,
    tomarSegundoPlano() {
      if (segundoPlano || appOcupado()) return false;
      segundoPlano = true;
      return true;
    },
    liberarSegundoPlano() {
      if (!segundoPlano) return;
      segundoPlano = false;
      const fila = esperando;
      esperando = [];
      for (const f of fila) f();
    },
    segundoPlanoAtivo: () => segundoPlano,
    esperarSegundoPlano() {
      if (!segundoPlano) return Promise.resolve();
      return new Promise<void>((resolve) => esperando.push(resolve));
    },
  };
}

/**
 * Corte da passada sem tela quando o orçamento de tempo acaba: o motor do SDK não tem "cancelar", então o transporte da
 * tarefa (e o `online()` dela) passam a recusar a próxima página. O que já foi gravado vale (cursor por página) e a próxima
 * execução continua. Sem isso a passada seguia gravando depois de a tarefa avisar o sistema que terminou, e o Android podia
 * encerrar o processo no meio de uma escrita do SQLite.
 */
export interface CorteDaPassada {
  cortar(): void;
  cortada(): boolean;
  /** Lança `PassadaCortada` se o orçamento acabou (chamado antes de cada requisição da tarefa). */
  conferir(): void;
}

export class PassadaCortada extends Error {
  constructor() {
    super('Tempo da sincronização em segundo plano esgotado; continua na próxima execução.');
    this.name = 'PassadaCortada';
  }
}

export function criarCorteDaPassada(): CorteDaPassada {
  let cortada = false;
  return {
    cortar() {
      cortada = true;
    },
    cortada: () => cortada,
    conferir() {
      if (cortada) throw new PassadaCortada();
    },
  };
}

/**
 * Identidade do build instalado (versão do app + versionCode do EAS, que sobe a cada build). A tarefa sem tela não roda
 * num build que ainda não abriu com tela: a 1ª abertura depois da atualização (passagem de dados, reindexação da busca,
 * carga) é sempre do app, com o vendedor vendo.
 */
export function idDoBuild(versao: string | null | undefined, versionCode: number | string | null | undefined): string {
  return `${versao || '?'}+${versionCode ?? '?'}`;
}

/** O build atual ainda não abriu com tela neste aparelho (nenhum registro, ou o registro é de outro build). */
export function buildAindaNaoAberto(atual: string, registrado: string | null | undefined): boolean {
  return registrado !== atual;
}

/**
 * Roda `fn` sem nunca lançar (nem síncrono nem assíncrono): o erro vai a `registrar` e volta `reserva`. Usado no corpo das
 * tarefas sem tela e na definição delas no escopo global (um erro ali, na carga do bundle, derrubaria o app a cada abertura).
 */
export async function semDerrubar<T>(fn: () => T | Promise<T>, registrar: (e: unknown) => void, reserva: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    try {
      registrar(e);
    } catch {
      // registrar nunca derruba
    }
    return reserva;
  }
}

/** Versão síncrona de `semDerrubar` (definição das tarefas no escopo global, na carga do bundle). */
export function semDerrubarAgora(fn: () => void, registrar: (e: unknown) => void): void {
  try {
    fn();
  } catch (e) {
    try {
      registrar(e);
    } catch {
      // registrar nunca derruba
    }
  }
}

/** Devolve a vez ao sistema (eventos de toque, desenho, ouvintes) entre duas páginas da carga. */
export function cederAVez(agendar: (f: () => void) => void = (f) => setTimeout(f, 0)): Promise<void> {
  return new Promise<void>((resolve) => agendar(resolve));
}
