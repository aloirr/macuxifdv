/**
 * Logout e o push do aparelho (RF-CORE-09, RN-CORE-15; revisão R-20261102-174535 do engenheiro-software, 🟡 1).
 * Funções puras (rodam em Node nos testes); quem chama a API e guarda a fila é `state/plataforma.tsx`.
 *
 * Ao sair, o app:
 * 1. apaga o token do push do aparelho no servidor (`DELETE /v1/dispositivos/atual/push?dispositivo_id=`) — melhor
 *    esforço: rota ausente (servidor antigo, 404), acesso vencido (401) ou outro 4xx não impedem a saída;
 * 2. revoga a família do refresh (`POST /v1/auth/logout`), que no servidor também limpa o token do push do aparelho;
 * 3. SEM SINAL no passo 2: guarda a saída na fila (`PendenciaSaida`, no armazenamento seguro) e reenvia o
 *    `/auth/logout` quando houver sinal (abertura do app, próximo login). Assim o usuário que saiu deixa de receber
 *    push mesmo que tenha saído offline.
 * O registro do token no login do próximo usuário já acontece sozinho: o registro local é por usuário e é esquecido
 * no logout (`esquecerRegistroPush`), então o próximo login faz o `PUT /v1/dispositivos/atual/push` de novo.
 */

export interface PendenciaSaida {
  /** Refresh da sessão que saiu (só no armazenamento seguro, nunca em log). */
  refresh: string;
  dispositivo_id: string;
  /** ISO do logout. */
  em: string;
}

/** O refresh vale 30 dias; depois disso o servidor já não tem o que revogar. */
export const VALIDADE_PENDENCIA_SAIDA_MS = 30 * 24 * 60 * 60_000;
/** Poucas saídas guardadas (o armazenamento seguro do Android tem limite de tamanho por chave). */
export const MAX_PENDENCIAS_SAIDA = 5;

function valida(p: PendenciaSaida, agora: number): boolean {
  const em = Date.parse(p.em);
  return typeof p.refresh === 'string' && p.refresh.length > 0 && Number.isFinite(em) && agora - em < VALIDADE_PENDENCIA_SAIDA_MS && em <= agora + 60_000;
}

/** Fila sem vencidas, sem repetição (mesmo refresh) e com as mais novas por último, no máximo `MAX_PENDENCIAS_SAIDA`. */
export function filaDeSaidas(lista: readonly PendenciaSaida[] | null | undefined, agora: number, nova?: PendenciaSaida): PendenciaSaida[] {
  const todas = [...(Array.isArray(lista) ? lista : []), ...(nova ? [nova] : [])].filter((p) => p && valida(p, agora));
  const porRefresh = new Map<string, PendenciaSaida>();
  for (const p of todas) {
    porRefresh.delete(p.refresh);
    porRefresh.set(p.refresh, p);
  }
  return [...porRefresh.values()].slice(-MAX_PENDENCIAS_SAIDA);
}

/** Resultado de uma chamada ao servidor no logout. */
export type ResultadoChamada = 'ok' | 'sem_sinal' | 'recusado';

export interface PassosSaida {
  /** `DELETE /v1/dispositivos/atual/push` com o acesso da sessão. */
  apagarPush(): Promise<ResultadoChamada>;
  /** `POST /v1/auth/logout` com o refresh (o servidor revoga a família e limpa o push do aparelho). */
  revogar(): Promise<ResultadoChamada>;
}

/**
 * Ordem do logout no servidor: apaga o push ANTES de revogar (depois da revogação o acesso não serve mais) e revoga
 * mesmo que o apagar falhe. Devolve `pendente` só quando a revogação não chegou ao servidor (sem sinal): a saída vai
 * para a fila. Recusa (4xx) não volta para a fila: a sessão já não vale no servidor.
 */
export async function sairNoServidor(passos: PassosSaida): Promise<'feito' | 'pendente'> {
  const push = await passos.apagarPush().catch((): ResultadoChamada => 'sem_sinal');
  // sem sinal no primeiro passo: nem tenta o segundo agora (economiza o tempo de espera do usuário)
  if (push === 'sem_sinal') return 'pendente';
  const revogado = await passos.revogar().catch((): ResultadoChamada => 'sem_sinal');
  return revogado === 'sem_sinal' ? 'pendente' : 'feito';
}

/** Reenvia as saídas guardadas; devolve as que continuam pendentes (sem sinal). */
export async function reenviarSaidas(
  lista: readonly PendenciaSaida[],
  revogar: (p: PendenciaSaida) => Promise<ResultadoChamada>,
): Promise<PendenciaSaida[]> {
  const restam: PendenciaSaida[] = [];
  for (const p of lista) {
    const r = await revogar(p).catch((): ResultadoChamada => 'sem_sinal');
    if (r === 'sem_sinal') restam.push(p);
  }
  return restam;
}
