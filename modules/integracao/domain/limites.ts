/**
 * Limites do Hub por Conector (RN-INT-12, proposta T-0025): tamanho do corpo, linhas por lote (em `envelope.ts`) e taxa de
 * chamadas. Sem relógio implícito: `agora` entra como argumento. O estado do balde é guardado pela API (memória do processo
 * numa instância; tabela/Redis com várias — mesma interface).
 */
import { PARAMETROS_PADRAO, type ParametrosHub } from './parametros';

export type ClasseRota = 'lote' | 'geral';

export type ResultadoTamanhoCorpo = { ok: true } | { ok: false; status: 413; codigo: 'corpo_grande'; limite_bytes: number; mensagem: string };

/** 413 quando o corpo passa do limite da classe da rota. */
export function verificarTamanhoCorpo(bytes: number, classe: ClasseRota, parametros: Partial<Pick<ParametrosHub, 'limiteCorpoLoteBytes' | 'limiteCorpoGeralBytes'>> = {}): ResultadoTamanhoCorpo {
  const limite = classe === 'lote' ? (parametros.limiteCorpoLoteBytes ?? PARAMETROS_PADRAO.limiteCorpoLoteBytes) : (parametros.limiteCorpoGeralBytes ?? PARAMETROS_PADRAO.limiteCorpoGeralBytes);
  if (bytes <= limite) return { ok: true };
  const mib = (limite / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return {
    ok: false,
    status: 413,
    codigo: 'corpo_grande',
    limite_bytes: limite,
    mensagem: classe === 'lote' ? `O corpo do lote passa do limite de ${mib} MiB. Divida em lotes menores (na carga completa, use partes da mesma sessão).` : `O corpo da requisição passa do limite de ${mib} MiB.`,
  };
}

/** `POST /lotes` tem balde próprio e mais apertado; o resto usa o geral. */
export function classeDaRota(metodo: string, caminho: string): ClasseRota {
  return metodo.toUpperCase() === 'POST' && caminho === '/lotes' ? 'lote' : 'geral';
}

export interface ConfigBalde {
  capacidade: number;
  reposicaoPorMin: number;
}

export interface EstadoBalde {
  tokens: number;
  /** Instante (ms desde a época) da última atualização. */
  atualizadoEm: number;
}

export interface ResultadoToken {
  permitido: boolean;
  estado: EstadoBalde;
  /** Segundos até haver tokens (inteiro, para o `Retry-After`); 0 quando permitido ou quando o custo nunca caberá. */
  retryAfterSeg: number;
}

/**
 * Token bucket: balde novo começa cheio; repõe `reposicaoPorMin` por minuto até `capacidade`; negar não consome. Relógio que anda
 * para trás não repõe (clamp). Custo maior que a capacidade nunca passa (`retryAfterSeg` 0 = não adianta esperar).
 */
export function consumirToken(estado: EstadoBalde | null, agora: string, cfg: ConfigBalde, custo = 1): ResultadoToken {
  const t = Date.parse(agora);
  const base: EstadoBalde = estado ?? { tokens: cfg.capacidade, atualizadoEm: t };
  const decorridoSeg = Math.max(0, (t - base.atualizadoEm) / 1000);
  const porSeg = cfg.reposicaoPorMin / 60;
  const tokens = Math.min(cfg.capacidade, base.tokens + decorridoSeg * porSeg);
  const atualizadoEm = Math.max(t, base.atualizadoEm);
  if (custo > cfg.capacidade) return { permitido: false, estado: base, retryAfterSeg: 0 };
  if (tokens + 1e-9 >= custo) return { permitido: true, estado: { tokens: Math.max(0, tokens - custo), atualizadoEm }, retryAfterSeg: 0 };
  const falta = custo - tokens;
  return { permitido: false, estado: { tokens, atualizadoEm }, retryAfterSeg: Math.max(1, Math.ceil(falta / porSeg - 1e-9)) };
}
