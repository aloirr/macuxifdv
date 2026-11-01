/**
 * Orquestração da interpretação da busca na API (RF-CAT-01, RN-CAT-03): mede a duração, registra log estruturado
 * (tenant e duração, nunca o texto da pergunta nem dado pessoal) e debita a cota SÓ quando o provedor respondeu.
 * A decisão (fallback sem IA, aviso, desfecho) é do domain (`interpretarBusca`); aqui só entram I/O e medição.
 * Ordem na rota: cache (não consome) → `verificarConsultaIa` → `interpretarComMedicao` → persistir o uso.
 */
import { interpretarBusca, resumoDaInterpretacao, type EntradaInterpretarBusca, type ResultadoInterpretacao } from '../../domain';

/** Logger no formato do pino/Fastify (`log.info(objeto, mensagem)`). */
export interface LogIa {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface EntradaBuscaIa extends EntradaInterpretarBusca {
  log: LogIa;
  /** Relógio monotônico em ms (padrão `performance.now`); injetável para teste. */
  relogio?: () => number;
  /** Tempo limite aplicado à porta, só para constar no log. */
  timeoutMs?: number;
  /**
   * Débito da cota (RN-CAT-03). Chamado no máximo uma vez, e só depois de o provedor ter respondido. No banco deve
   * ser um incremento atômico condicional (`... set usadas = usadas + 1 where usadas < limite`). Falha aqui não
   * derruba a busca (o usuário já tem o resultado); fica no log.
   */
  debitarCota?: () => Promise<void>;
}

export interface ResultadoBuscaIa extends ResultadoInterpretacao {
  /** Campos de `ResultadoBusca` (contrato): `interpreted_by`, `degraded`, `notice`. */
  resumo: ReturnType<typeof resumoDaInterpretacao>;
  /** Duração da interpretação, em ms (0 quando o provedor não foi chamado). */
  duracaoMs: number;
  /** A cota foi debitada nesta chamada. */
  cotaDebitada: boolean;
}

export async function interpretarComMedicao(e: EntradaBuscaIa): Promise<ResultadoBuscaIa> {
  const relogio = e.relogio ?? (() => performance.now());
  const inicio = relogio();
  const { tenant_id, texto, vocabulario, porta, online, ia, signal } = e;
  const { log, timeoutMs, debitarCota } = e;
  const r = await interpretarBusca({ tenant_id, texto, vocabulario, porta, online, ia, signal });
  const duracaoMs = Math.max(0, Math.round(relogio() - inicio));

  if (r.chamouProvedor) {
    const dados = { evento: 'catalogo.ia.interpretacao', tenant_id: e.tenant_id, duracao_ms: duracaoMs, desfecho: r.desfecho, origem: r.origem, timeout_ms: timeoutMs ?? null };
    if (r.desfecho === 'respondida') log.info(dados, 'Busca inteligente respondida pelo provedor.');
    else log.warn(dados, 'Provedor de IA indisponível: busca atendida sem IA.');
  }

  let cotaDebitada = false;
  if (r.consomeCota && debitarCota) {
    try {
      await debitarCota();
      cotaDebitada = true;
    } catch {
      log.warn({ evento: 'catalogo.ia.debito_falhou', tenant_id: e.tenant_id }, 'Não foi possível debitar a cota de IA.');
    }
  }
  return { ...r, resumo: resumoDaInterpretacao(r), duracaoMs, cotaDebitada };
}
