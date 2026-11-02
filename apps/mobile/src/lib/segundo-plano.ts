/**
 * ADR 0017 §3 (T-0059): sincronização incremental em segundo plano (`expo-background-task`, WorkManager no Android).
 * Regras, puras e testadas em Node (a parte do Expo fica em `services/segundo-plano.ts`):
 * - tarefa `macuxi-sync-delta`, intervalo mínimo de 15 min; só com rede (restrição do WorkManager + conferência aqui);
 * - nunca roda sem `sincronizado_em` (a carga inicial só roda com o app aberto), com o modo sem sinal ligado, sem sessão
 *   guardada, sem sessão válida (a renovação do token falhou: não faz nada e o app pede login na próxima abertura) nem com
 *   o aparelho bloqueado (RN-CORE-15: o 423 limpa o aparelho e a tarefa para);
 * - orçamento de 60 s: passou disso, a tarefa termina; o que já foi gravado vale (cursor por página) e a próxima continua;
 * - app aberto no mesmo processo: usa o MESMO motor (mesma promessa); senão, o motor da tarefa segura o `sync:lease`
 *   (dono + expira em 2 min) para o app reaberto durante a tarefa não fazer uma segunda passada.
 * - sem notificação: o resultado vai para o Diagnóstico do Perfil ("Última sincronização em segundo plano").
 */

export const TAREFA_SYNC_DELTA = 'macuxi-sync-delta';
/** Minutos (o mínimo do WorkManager). O sistema decide o momento exato. */
export const INTERVALO_MINIMO_MIN = 15;
export const ORCAMENTO_SEGUNDO_PLANO_MS = 60_000;
export const VALIDADE_LEASE_MS = 2 * 60_000;
/** Chave no armazenamento do motor do usuário (some com `limparAparelho`, RN-CORE-15). */
export const CHAVE_LEASE = 'sync:lease';
/** Prefixo do dono do lease quando é a tarefa em segundo plano que sincroniza (`segundo-plano:<início>`). */
export const DONO_SEGUNDO_PLANO = 'segundo-plano';
/** Dono do lease visto pelo app aberto (ele só lê: o lease é da tarefa). */
export const DONO_APP = 'app';

export interface LeaseSync {
  dono: string;
  /** ISO 8601 (UTC). */
  expira_em: string;
}

/** O lease está com outro dono e ainda vale (lease ilegível ou vencido = livre). */
export function leaseOcupado(lease: LeaseSync | null | undefined, dono: string, agora: number): boolean {
  if (!lease || typeof lease.dono !== 'string' || lease.dono === dono) return false;
  const expira = Date.parse(lease.expira_em);
  return Number.isFinite(expira) && expira > agora;
}

export function novoLease(dono: string, agora: number): LeaseSync {
  return { dono, expira_em: new Date(agora + VALIDADE_LEASE_MS).toISOString() };
}

/** Por que a tarefa não sincronizou (vai para o Diagnóstico; nada aparece ao usuário). */
export type MotivoPulo =
  | 'modo-sem-sinal'
  | 'sem-sessao'
  | 'sem-carga'
  | 'sessao-invalida'
  | 'sem-rede'
  | 'aparelho-bloqueado'
  | 'em-andamento';

export interface ResultadoSegundoPlano {
  /** ISO 8601 (UTC) do início. */
  quando: string;
  /** `parcial` = o orçamento de tempo acabou antes do fim (o que foi gravado vale). */
  resultado: 'sincronizado' | 'parcial' | 'falhou' | 'pulado';
  motivo?: MotivoPulo;
  /** Mensagem técnica (do motor ou do transporte; sem token nem dado pessoal). */
  mensagem?: string;
  duracao_ms: number;
}

/** O que a tarefa precisa do motor. `prepararSessao` confere a sessão e os módulos efetivos (`GET /v1/me/modulos`). */
export interface MotorSegundoPlano {
  sincronizadoEm(): string | null;
  prepararSessao(): Promise<'ok' | 'sessao-invalida' | 'sem-rede' | 'aparelho-bloqueado'>;
  sincronizar(): Promise<boolean>;
  erro(): string | null;
}

export interface LeaseArmazenado {
  ler(): Promise<LeaseSync | null>;
  gravar(l: LeaseSync): Promise<void>;
  remover(): Promise<void>;
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
  lease(usuarioId: string): LeaseArmazenado;
  /** Abre (e carrega) o motor do usuário fora da interface. */
  abrirMotor(usuarioId: string): Promise<MotorSegundoPlano>;
}

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
  const fim = (r: Omit<ResultadoSegundoPlano, 'quando' | 'duracao_ms'>): ResultadoSegundoPlano => ({
    quando: new Date(inicio).toISOString(),
    duracao_ms: Math.max(0, d.agora() - inicio),
    ...r,
  });
  const orcamento = d.orcamentoMs ?? ORCAMENTO_SEGUNDO_PLANO_MS;
  const dono = `${DONO_SEGUNDO_PLANO}:${inicio}`;
  let lease: LeaseArmazenado | null = null;
  try {
    if (await d.modoSemSinal()) return fim({ resultado: 'pulado', motivo: 'modo-sem-sinal' });

    let motor = d.motorDoApp();
    if (!motor) {
      const usuario = await d.usuarioDaSessao();
      if (!usuario) return fim({ resultado: 'pulado', motivo: 'sem-sessao' });
      lease = d.lease(usuario);
      if (leaseOcupado(await lease.ler(), dono, d.agora())) {
        lease = null;
        return fim({ resultado: 'pulado', motivo: 'em-andamento' });
      }
      motor = await d.abrirMotor(usuario);
      if (!motor.sincronizadoEm()) {
        lease = null;
        return fim({ resultado: 'pulado', motivo: 'sem-carga' });
      }
      await lease.gravar(novoLease(dono, d.agora()));
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
      // o lease vence sozinho em 2 min: a passada ainda pode estar gravando até o sistema encerrar o processo
      lease = null;
      return fim({ resultado: 'parcial', mensagem: `Orçamento de ${Math.round(orcamento / 1000)} s esgotado; continua na próxima execução.` });
    }
    // aparelho bloqueado: a limpeza já apagou tudo (inclusive o lease)
    if (r.valor.motivo === 'aparelho-bloqueado') lease = null;
    return fim(r.valor);
  } catch (e) {
    return fim({ resultado: 'falhou', mensagem: e instanceof Error ? e.message : String(e) });
  } finally {
    if (lease) await lease.remover().catch(() => undefined);
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
  };
  const base =
    r.resultado === 'sincronizado'
      ? 'concluída'
      : r.resultado === 'parcial'
        ? 'parcial (tempo esgotado)'
        : r.resultado === 'pulado'
          ? `não rodou: ${r.motivo ? motivo[r.motivo] : 'sem motivo'}`
          : 'falhou';
  return `${base} · ${Math.round(r.duracao_ms / 100) / 10} s${r.mensagem ? `\n${r.mensagem}` : ''}`;
}
