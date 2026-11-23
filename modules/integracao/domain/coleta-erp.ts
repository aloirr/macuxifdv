/**
 * Coleta na API do ERP (Conector tipo `nuvem`; ADR 0066; desenho `docs/desenho/integracao-modelos-erp.md` §2.3 e §2.4).
 * Funções puras: o que coletar e quando (RN-INT-17), a janela incremental (RN-INT-05) e as classes de falha com a espera de
 * cada tentativa (RN-INT-20). A API só executa o que o plano manda.
 */
import { problemaFrequenciaColeta } from '@macuxi/platform-sdk';
import type { CodigoErroHttpSaida } from '@macuxi/platform-sdk/http-saida';
import { ORDEM_CARGA_ENTIDADES, type ClasseFalhaColeta, type Entidade, type FrequenciasApiErp, type ModoCarga } from '../contracts';

/**
 * RN-INT-17: frequência padrão por entidade, em minutos (doc 06). Preço, escalonada e estoque a cada 15 min; cadastros e títulos a
 * cada 1 h; estruturas (filial, vendedor, formas, prazos, transportadora, árvore, rota) 1 vez por dia. Nota (faturamento e retorno do
 * pedido) a cada 15 min. O tenant só ajusta dentro de 15 a 1.440 min, em múltiplos de 15.
 */
export const FREQUENCIA_PADRAO_MIN: Readonly<Record<Entidade, number>> = Object.freeze({
  preco: 15,
  tabela_escalonada: 15,
  estoque: 15,
  nota: 15,
  cliente: 60,
  produto: 60,
  produto_unidade: 60,
  cliente_endereco: 60,
  titulo: 60,
  filial: 1440,
  vendedor: 1440,
  forma_pagamento: 1440,
  prazo_pagamento: 1440,
  transportadora: 1440,
  catalogo_no: 1440,
  rota: 1440,
});

/** RN-INT-17: a carga completa roda 1 vez por semana, fora do horário comercial; é a única que inativa registros (RN-INT-06). */
export const CARGA_COMPLETA_INTERVALO_DIAS = 7;
/** "De madrugada" no fuso do tenant: de 00:00 até 05:59. */
export const MADRUGADA_HORAS = { de: 0, ate: 6 } as const;
/** Janela de sobreposição do incremental (parâmetro do tenant; padrão 10 min): cobre o relógio do ERP e a transação tardia (§2.3 item 4). */
export const SOBREPOSICAO_PADRAO_MIN = 10;

/** Frequência que vale para a entidade: a do tenant se válida (RN-INT-17), senão o padrão. */
export function frequenciaDaEntidade(frequencias: FrequenciasApiErp, entidade: Entidade): number {
  const v = frequencias[entidade];
  return typeof v === 'number' && problemaFrequenciaColeta(v) === null ? v : FREQUENCIA_PADRAO_MIN[entidade];
}

/** Problemas das frequências informadas pelo admin (vazio = válidas), um texto por entidade, com a ação. */
export function problemasFrequencias(frequencias: Readonly<Record<string, number>>): string[] {
  const p: string[] = [];
  for (const [entidade, minutos] of Object.entries(frequencias)) {
    const problema = problemaFrequenciaColeta(minutos);
    if (problema) p.push(`${entidade}: ${problema}`);
  }
  return p;
}

export interface EstadoColetaEntidade {
  /** Há coleta `solicitada` ou `executando` desta entidade (um trabalho vivo por alvo). */
  viva: boolean;
  /** Última coleta pedida (qualquer estado), em ISO; nula = nunca. */
  ultimaSolicitadaEm: string | null;
  /** Última coleta de modo `completo` CONCLUÍDA; nula = a primeira carga ainda não aconteceu. */
  ultimaCompletaConcluidaEm: string | null;
}

export interface EntradaPlanoColeta {
  agora: string;
  fuso: string;
  entidades: readonly Entidade[];
  frequencias: FrequenciasApiErp;
  /** `conector_api.coletas_paradas_em`: preenchido quando o ERP recusou a credencial (RN-INT-20). */
  coletasParadasEm: string | null;
  estados: Partial<Record<Entidade, EstadoColetaEntidade>>;
}

export interface ColetaPlanejada {
  entidade: Entidade;
  modo: ModoCarga;
  motivo: 'carga_semanal' | 'frequencia';
}

/** Hora local (0 a 23) no fuso; fuso inválido cai em UTC. */
export function horaLocal(agora: string, fuso: string): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: fuso }).format(new Date(agora));
    return Number(h) % 24;
  } catch {
    return new Date(agora).getUTCHours();
  }
}

/**
 * RN-INT-17: o que a tarefa `agendar_coletas` pede agora, na ordem de carga (RN-INT-04).
 *  - Coletas paradas por credencial recusada: nada (RN-INT-20).
 *  - Entidade com coleta viva: nada. Entidade sem a primeira carga completa: nada (a primeira carga é pedida pelo admin, "Iniciar carga completa").
 *  - 7 dias ou mais desde a última completa e hora local de madrugada: `completo` (a única que inativa).
 *  - Senão, vencida a frequência da entidade desde a última coleta pedida: `delta`.
 */
export function planejarColetas(e: EntradaPlanoColeta): ColetaPlanejada[] {
  if (e.coletasParadasEm !== null) return [];
  const agora = Date.parse(e.agora);
  const madrugada = horaLocal(e.agora, e.fuso) >= MADRUGADA_HORAS.de && horaLocal(e.agora, e.fuso) < MADRUGADA_HORAS.ate;
  const plano: ColetaPlanejada[] = [];
  for (const entidade of ORDEM_CARGA_ENTIDADES) {
    if (!e.entidades.includes(entidade)) continue;
    const s = e.estados[entidade];
    if (!s || s.viva || s.ultimaCompletaConcluidaEm === null) continue;
    const semanal = agora - Date.parse(s.ultimaCompletaConcluidaEm) >= CARGA_COMPLETA_INTERVALO_DIAS * 24 * 60 * 60_000;
    if (semanal && madrugada) {
      plano.push({ entidade, modo: 'completo', motivo: 'carga_semanal' });
      continue;
    }
    const vencida = s.ultimaSolicitadaEm === null || agora - Date.parse(s.ultimaSolicitadaEm) >= frequenciaDaEntidade(e.frequencias, entidade) * 60_000;
    if (vencida) plano.push({ entidade, modo: 'delta', motivo: 'frequencia' });
  }
  return plano;
}

/**
 * RN-INT-05: de onde a API do ERP deve filtrar (`alterado_em >= janela`): o cursor menos a sobreposição. Sem cursor = `null`, lê tudo.
 * A guarda monotônica do Hub descarta o repetido da sobreposição.
 */
export function janelaIncremental(e: { cursorAlteradoEm: string | null; sobreposicaoMin: number }): string | null {
  if (e.cursorAlteradoEm === null) return null;
  return new Date(Date.parse(e.cursorAlteradoEm) - e.sobreposicaoMin * 60_000).toISOString();
}

// ---------------------------------------------------------------- falhas (RN-INT-20)

export interface ClassificacaoFalha {
  classe: ClasseFalhaColeta;
  /** Tenta de novo (1, 2, 4, 8 e 16 min). */
  tenta: boolean;
  /** 401 ou 403: marca `coletas_paradas_em` e só volta depois de trocar a credencial. */
  paraColetas: boolean;
}

/** RN-INT-20: 401/403 param; 408, 429 e 5xx tentam de novo; o resto (404, 400, 422…) é endpoint ou formato mudado e não adianta repetir. */
export function classificarFalhaHttp(status: number): ClassificacaoFalha {
  if (status === 401 || status === 403) return { classe: 'credencial_recusada', tenta: false, paraColetas: true };
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return { classe: 'transitoria', tenta: true, paraColetas: false };
  return { classe: 'formato_mudou', tenta: false, paraColetas: false };
}

/** RN-INT-20: rede, DNS, timeout e o limite por minuto do Macuxi tentam de novo; destino bloqueado, URL inválida e resposta enorme não. */
export function classificarFalhaCodigoSaida(codigo: CodigoErroHttpSaida): ClassificacaoFalha {
  const tenta = codigo === 'TEMPO_ESGOTADO' || codigo === 'DNS_FALHOU' || codigo === 'REDE' || codigo === 'LIMITE_POR_MINUTO';
  return tenta ? { classe: 'transitoria', tenta: true, paraColetas: false } : { classe: 'formato_mudou', tenta: false, paraColetas: false };
}

const ESPERA_MIN = [1, 2, 4, 8, 16] as const;
const RETRY_AFTER_MAX_S = 3600;

/**
 * RN-INT-20: espera em segundos antes da tentativa `n` (1 a 5: 1, 2, 4, 8 e 16 min), respeitando o `Retry-After` do ERP quando for
 * maior (no máximo 1 hora). Depois da quinta, `null`: a coleta falha e volta no próximo ciclo da tarefa.
 */
export function esperaTentativaS(tentativa: number, opcoes: { retryAfterS?: number | null } = {}): number | null {
  const n = Math.max(1, Math.floor(tentativa));
  if (n > ESPERA_MIN.length) return null;
  const base = ESPERA_MIN[n - 1]! * 60;
  const ra = opcoes.retryAfterS;
  if (typeof ra === 'number' && Number.isFinite(ra) && ra > 0) return Math.min(Math.max(base, ra), RETRY_AFTER_MAX_S);
  return base;
}

/** `Retry-After` em segundos ou em data HTTP; `null` se ausente ou ilegível. Data no passado = 0. */
export function lerRetryAfterS(valor: string | undefined | null, agora: string): number | null {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (/^\d{1,9}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((t - Date.parse(agora)) / 1000));
}

// ---------------------------------------------------------------- credencial (RN-INT-18)

const origem = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * RN-INT-18: a credencial gravada só vai ao host para o qual foi testada. Se a URL muda de host ou porta (ou ainda não havia
 * configuração), a mesma chamada precisa trazer a credencial nova: o segredo antigo nunca é enviado a outro destino.
 */
export function exigeNovaCredencial(antes: { url_base: string } | null, depois: { url_base: string }): boolean {
  if (antes === null) return true;
  const a = origem(antes.url_base);
  const d = origem(depois.url_base);
  return a === null || d === null || a !== d;
}
