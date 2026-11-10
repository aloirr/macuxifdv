/**
 * ADR 0017 §3 (T-0059): sincronização incremental em segundo plano (`expo-background-task`, WorkManager no Android).
 * Regras, puras e testadas em Node (a parte do Expo fica em `services/segundo-plano.ts`):
 * - tarefa `macuxi-sync-delta`, intervalo mínimo de 15 min; só com rede (restrição do WorkManager + conferência aqui);
 * - nunca roda sem `sincronizado_em` (a carga inicial só roda com o app aberto), com o modo sem sinal ligado, sem sessão
 *   guardada, sem sessão válida (a renovação do token falhou: não faz nada e o app pede login na próxima abertura) nem com
 *   o aparelho bloqueado (RN-CORE-15: o 423 limpa o aparelho e a tarefa para);
 * - orçamento de 60 s: passou disso, a tarefa termina; o que já foi gravado vale (cursor por página) e a próxima continua;
 * - app aberto no mesmo processo: usa o MESMO motor (mesma promessa); senão, a passada com o motor da tarefa segura a trava
 *   única do processo (`lib/trava-sync.ts`) e o app reaberto durante a tarefa espera por ela, sem segunda passada.
 *   RD-0033 (T-0140): a trava é a ÚNICA porta. O `sync:lease` persistido saiu: no Android a tarefa (WorkManager) e a tela
 *   rodam no mesmo processo e no mesmo runtime JS (o `HeadlessAppLoader` do expo-task-manager sobe o React host do app,
 *   que a tela aberta depois reaproveita), então não há segundo processo a excluir; e o lease que sobrava de um processo
 *   morto segurava o Sincronizar calado por até 2 min.
 * - sem notificação: o resultado vai para o Diagnóstico do Perfil ("Última sincronização em segundo plano").
 * T-0140 (relatos 1 e 6: o app abria e fechava depois de atualizado e na carga inicial), proteções da tarefa sem tela:
 * - não roda com o app em primeiro plano (o agendador do app sincroniza) nem com o app abrindo ou sincronizando no mesmo
 *   processo (trava única, `lib/trava-sync.ts`);
 * - não roda num build que ainda não abriu com tela (depois do `MY_PACKAGE_REPLACED` a 1ª abertura é do app);
 * - orçamento esgotado = a passada é cortada na próxima página e a tarefa espera ela parar (até 10 s) antes de devolver;
 * - nunca lança: qualquer erro vira `falhou` com a mensagem no Diagnóstico.
 * T-0144: espera 3 s antes de conferir o app (a tarefa atrasada dispara junto com a abertura do app pelo vendedor).
 */
import type { TravaSync } from './trava-sync';

export const TAREFA_SYNC_DELTA = 'macuxi-sync-delta';
/** Minutos (o mínimo do WorkManager). O sistema decide o momento exato. */
export const INTERVALO_MINIMO_MIN = 15;
export const ORCAMENTO_SEGUNDO_PLANO_MS = 60_000;
/**
 * Passada cortada que não parou na espera do corte: a trava fica com ela até ela parar (o app não começa outra passada
 * no mesmo arquivo), mas no máximo este tempo (uma requisição presa não segura o Sincronizar para sempre).
 */
export const LIMITE_DA_PASSADA_CORTADA_MS = 2 * 60_000;

/** Por que a tarefa não sincronizou (vai para o Diagnóstico; nada aparece ao usuário). */
export type MotivoPulo =
  | 'modo-sem-sinal'
  | 'sem-sessao'
  | 'sem-carga'
  | 'sessao-invalida'
  | 'sem-rede'
  | 'aparelho-bloqueado'
  | 'em-andamento'
  | 'app-aberto'
  | 'app-ocupado'
  | 'app-atualizado'
  | 'sem-permissao';

export interface ResultadoSegundoPlano {
  /** ISO 8601 (UTC) do início. */
  quando: string;
  /** `parcial` = o orçamento de tempo acabou antes do fim (o que foi gravado vale). */
  resultado: 'sincronizado' | 'parcial' | 'falhou' | 'pulado';
  motivo?: MotivoPulo;
  /** Mensagem técnica (do motor ou do transporte; sem token nem dado pessoal). */
  mensagem?: string;
  duracao_ms: number;
  /** A passada usou o motor da tarefa (app fechado, sem tela). Ausente = o motor do app vivo no processo, ou não rodou. */
  sem_tela?: boolean;
}

/**
 * O que a tarefa precisa do motor. `prepararSessao` confere a sessão (na demonstração, também os módulos efetivos);
 * `sincronizar` é a atualização leve na API real (ADR 0018 item 8: `motor.sincronizarNovidades`, que traz os módulos).
 */
export interface MotorSegundoPlano {
  sincronizadoEm(): string | null;
  prepararSessao(): Promise<'ok' | 'sessao-invalida' | 'sem-rede' | 'aparelho-bloqueado'>;
  sincronizar(): Promise<boolean>;
  erro(): string | null;
}

export interface DepsTarefaSegundoPlano {
  agora(): number;
  orcamentoMs?: number;
  /** Modo sem sinal ligado pelo usuário (nada sai do aparelho). */
  modoSemSinal(): Promise<boolean>;
  /** O app está aberto neste processo com a sessão e o motor: a tarefa usa o mesmo motor. */
  motorDoApp(): MotorSegundoPlano | null;
  /** Usuário da sessão guardada no aparelho (sessão do modo deste build e com tokens), ou `null`. */
  usuarioDaSessao(): Promise<string | null>;
  /** Abre (e carrega) o motor do usuário fora da interface. */
  abrirMotor(usuarioId: string): Promise<MotorSegundoPlano>;
  /** T-0140: o app está em primeiro plano (o agendador do app cuida da sincronização). */
  appEmPrimeiroPlano?(): boolean;
  /** T-0140/RD-0033: trava única do processo (o app abrindo ou sincronizando = a tarefa desiste; o app espera a tarefa). */
  trava: Pick<TravaSync, 'tomarSegundoPlano' | 'liberarSegundoPlano' | 'segundoPlanoAtivo'>;
  /** T-0140: o build instalado ainda não abriu com tela (logo depois da atualização do APK). */
  buildAindaNaoAberto?(): Promise<boolean>;
  /** T-0140: o orçamento acabou: corta a passada do motor sem tela na próxima página. */
  aoEsgotarOrcamento?(): void;
  /** Espera pela passada cortada parar (padrão `ESPERA_DO_CORTE_MS`). */
  esperaDoCorteMs?: number;
  /**
   * T-0144: espera antes de decidir (padrão `ESPERA_INICIAL_MS`). O WorkManager pode disparar a tarefa no mesmo instante em
   * que o vendedor abre o app (a tarefa atrasada roda assim que o processo sobe, típico logo depois de atualizar o APK): nesse
   * começo o Android ainda diz "segundo plano" e a tela ainda não montou. Depois da espera, a conferência vê o app abrindo.
   */
  esperar?(ms: number): Promise<void>;
  esperaInicialMs?: number;
  /** T-0145 (RN-CORE-37): as permissões obrigatórias da variante estão concedidas (sem elas nada sincroniza). */
  permissoesLiberadas?(): Promise<boolean>;
}

export const ESPERA_INICIAL_MS = 3_000;

export const ESPERA_DO_CORTE_MS = 10_000;

type Corrida<T> = { terminou: true; valor: T } | { terminou: false };

/** Espera `p` por até `ms`; depois disso devolve `terminou: false` (a promessa segue, sem ninguém esperar). */
export function comOrcamento<T>(p: Promise<T>, ms: number): Promise<Corrida<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<Corrida<T>>((resolve) => {
    timer = setTimeout(() => resolve({ terminou: false }), ms);
  });
  return Promise.race([p.then((valor) => ({ terminou: true as const, valor })), limite]).finally(() => clearTimeout(timer));
}

/** Uma passada da tarefa `macuxi-sync-delta`. Nunca lança: o resultado vai para o Diagnóstico. */
export async function executarTarefaSegundoPlano(d: DepsTarefaSegundoPlano): Promise<ResultadoSegundoPlano> {
  const inicio = d.agora();
  /** A passada usa (ou tentaria usar) o motor da tarefa, sem tela. */
  let semTela = false;
  const fim = (r: Omit<ResultadoSegundoPlano, 'quando' | 'duracao_ms'>): ResultadoSegundoPlano => ({
    quando: new Date(inicio).toISOString(),
    duracao_ms: Math.max(0, d.agora() - inicio),
    ...r,
    ...(semTela ? { sem_tela: true } : {}),
  });
  const orcamento = d.orcamentoMs ?? ORCAMENTO_SEGUNDO_PLANO_MS;
  let comTrava = false;
  /** Passada cortada que não parou: a trava é solta quando ela parar (ou no limite), não no `finally`. */
  let soltarDepois: Promise<unknown> | null = null;
  try {
    if (await d.modoSemSinal()) return fim({ resultado: 'pulado', motivo: 'modo-sem-sinal' });
    if (d.permissoesLiberadas && !(await d.permissoesLiberadas())) return fim({ resultado: 'pulado', motivo: 'sem-permissao' });
    if (d.esperar) await d.esperar(d.esperaInicialMs ?? ESPERA_INICIAL_MS);
    if (d.appEmPrimeiroPlano?.()) return fim({ resultado: 'pulado', motivo: 'app-aberto' });
    if (!d.trava.tomarSegundoPlano()) return fim({ resultado: 'pulado', motivo: d.trava.segundoPlanoAtivo() ? 'em-andamento' : 'app-ocupado' });
    comTrava = true;

    let motor = d.motorDoApp();
    if (motor) {
      // motor do app vivo no processo (app em segundo plano): a sincronização dele já é uma por vez e entra na trava
      // como do app; segurar a trava aqui faria o app esperar a tarefa que espera o app
      d.trava.liberarSegundoPlano();
      comTrava = false;
    }
    if (!motor) {
      if (await d.buildAindaNaoAberto?.()) return fim({ resultado: 'pulado', motivo: 'app-atualizado' });
      semTela = true;
      const usuario = await d.usuarioDaSessao();
      if (!usuario) return fim({ resultado: 'pulado', motivo: 'sem-sessao' });
      motor = await d.abrirMotor(usuario);
      if (!motor.sincronizadoEm()) return fim({ resultado: 'pulado', motivo: 'sem-carga' });
    } else if (!motor.sincronizadoEm()) {
      return fim({ resultado: 'pulado', motivo: 'sem-carga' });
    }

    const m = motor;
    const passada = (async (): Promise<Omit<ResultadoSegundoPlano, 'quando' | 'duracao_ms'>> => {
      const sessao = await m.prepararSessao();
      if (sessao !== 'ok') return { resultado: 'pulado', motivo: sessao };
      const ok = await m.sincronizar();
      return ok ? { resultado: 'sincronizado' } : { resultado: 'falhou', mensagem: m.erro() ?? 'A sincronização parou.' };
    })();
    const r = await comOrcamento(passada, orcamento);
    if (!r.terminou) {
      // T-0140: corta a passada sem tela na próxima página e espera ela parar antes de devolver ao sistema (que pode
      // encerrar o processo logo depois, no meio de uma escrita); se nem assim parar, a trava fica com ela até ela parar
      // (no máximo `LIMITE_DA_PASSADA_CORTADA_MS`), para o app não começar outra passada no mesmo arquivo
      let parou = false;
      if (semTela && d.aoEsgotarOrcamento) {
        d.aoEsgotarOrcamento();
        parou = (await comOrcamento(passada.catch(() => undefined), d.esperaDoCorteMs ?? ESPERA_DO_CORTE_MS)).terminou;
      }
      if (!parou && comTrava) soltarDepois = comOrcamento(passada.catch(() => undefined), LIMITE_DA_PASSADA_CORTADA_MS);
      return fim({ resultado: 'parcial', mensagem: `Orçamento de ${Math.round(orcamento / 1000)} s esgotado; continua na próxima execução.` });
    }
    return fim(r.valor);
  } catch (e) {
    return fim({ resultado: 'falhou', mensagem: e instanceof Error ? e.message : String(e) });
  } finally {
    if (comTrava) {
      const trava = d.trava;
      if (soltarDepois) void soltarDepois.then(() => trava.liberarSegundoPlano());
      else trava.liberarSegundoPlano();
    }
  }
}

/** Linha do Diagnóstico do Perfil (técnica, para o suporte). */
export function textoDoResultado(r: ResultadoSegundoPlano): string {
  const motivo: Record<MotivoPulo, string> = {
    'modo-sem-sinal': 'modo sem sinal ligado',
    'sem-sessao': 'sem sessão no aparelho',
    'sem-carga': 'carga inicial ainda não concluída',
    'sessao-invalida': 'sessão expirada (entrar de novo)',
    'sem-rede': 'sem conexão com o servidor',
    'aparelho-bloqueado': 'aparelho bloqueado',
    'em-andamento': 'outra sincronização em andamento',
    'app-aberto': 'o app estava aberto (ele mesmo sincroniza)',
    'app-ocupado': 'o app estava abrindo ou sincronizando',
    'app-atualizado': 'app atualizado, espera a 1ª abertura',
    'sem-permissao': 'falta permissão do aparelho',
  };
  const base =
    r.resultado === 'sincronizado'
      ? 'concluída'
      : r.resultado === 'parcial'
        ? 'parcial (tempo esgotado)'
        : r.resultado === 'pulado'
          ? `não rodou: ${r.motivo ? motivo[r.motivo] : 'sem motivo'}`
          : 'falhou';
  return `${base} · ${Math.round(r.duracao_ms / 100) / 10} s${r.sem_tela ? ' · app fechado' : ''}${r.mensagem ? `\n${r.mensagem}` : ''}`;
}
