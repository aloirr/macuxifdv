/// <reference types="node" />
/**
 * Geocodificador Nominatim (OpenStreetMap), sem chave (T-0191; RN-CORE-77; desenho docs/desenho/T-0191.md §3). Exportado SÓ pelo
 * subcaminho `@macuxi/platform-sdk/geocodificador-nominatim` (usa `fetch`, `AbortController` e o relógio do Node): só a API o importa.
 *
 * - Fila serial do processo: no máximo 1 requisição por segundo (política de uso do Nominatim público), para toda a API.
 * - Cache LRU com TTL pela `chaveGeocodificacao` (inclui o `null`); pedidos simultâneos do mesmo endereço viram uma chamada só.
 * - Busca estruturada pela rua (com o número) e, se ela não achar, pelo CEP de logradouro; `countrycodes=br`, `format=jsonv2`,
 *   `addressdetails=1`, `limit=1`, User-Agent genérico `MacuxiFDV/1.0`, prazo por requisição.
 * - Log só com origem (cache ou rede), resultado, precisão, status HTTP e duração: nunca endereço, URL nem coordenada.
 */
import { normalizarCep } from '@macuxi/comum/endereco';
import type { LogRota } from './api';
import {
  GEOCODIFICADOR_DESLIGADO,
  chaveGeocodificacao,
  erroGeocodificadorIndisponivel,
  numeroDaPorta,
  type CoordenadaGeocodificada,
  type EnderecoGeocodificacao,
  type Geocodificador,
  type PrecisaoGeocodificacao,
} from './geocodificador';

// ---------- fila serial com intervalo mínimo ----------

/** Relógio injetável: `agora` em ms; `esperar` resolve em `ms` ou assim que o `sinal` abortar. */
export interface RelogioGeocodificador {
  agora(): number;
  esperar(ms: number, sinal?: AbortSignal): Promise<void>;
}

const RELOGIO_REAL: RelogioGeocodificador = {
  agora: () => Date.now(),
  esperar: (ms, sinal) =>
    new Promise<void>((resolve) => {
      if (sinal?.aborted || ms <= 0) return resolve();
      const t = globalThis.setTimeout(() => {
        sinal?.removeEventListener('abort', fim);
        resolve();
      }, ms);
      const fim = () => {
        globalThis.clearTimeout(t);
        resolve();
      };
      sinal?.addEventListener('abort', fim, { once: true });
    }),
};

export interface FilaIntervalo {
  /** Roda `tarefa` depois das anteriores e pelo menos `intervaloMs` depois do início da anterior. */
  executar<T>(tarefa: () => Promise<T>): Promise<T>;
  /** Tarefas na fila (inclui a que está rodando). */
  tamanho(): number;
}

export function criarFilaIntervalo(intervaloMs: number, relogio: RelogioGeocodificador = RELOGIO_REAL): FilaIntervalo {
  let cauda: Promise<unknown> = Promise.resolve();
  let proximoInicio = -Infinity;
  let pendentes = 0;
  return {
    tamanho: () => pendentes,
    executar<T>(tarefa: () => Promise<T>): Promise<T> {
      pendentes++;
      const vez = cauda.then(async () => {
        const espera = proximoInicio - relogio.agora();
        if (espera > 0) await relogio.esperar(espera);
        proximoInicio = relogio.agora() + intervaloMs;
        return tarefa();
      });
      const fim = vez.finally(() => {
        pendentes--;
      });
      cauda = fim.catch(() => undefined);
      return fim;
    },
  };
}

/** Política do Nominatim público: no máximo 1 requisição por segundo por aplicação. */
const INTERVALO_NOMINATIM_MS = 1000;

let filaDoProcesso: FilaIntervalo | null = null;
/** A fila única do processo (todas as instâncias com o relógio real a compartilham). */
function filaNominatimDoProcesso(): FilaIntervalo {
  return (filaDoProcesso ??= criarFilaIntervalo(INTERVALO_NOMINATIM_MS));
}

// ---------- cache LRU com TTL ----------

interface EntradaCache {
  valor: CoordenadaGeocodificada | null;
  expiraEm: number;
}

function criarCacheLru(maximo: number, ttlMs: number, relogio: RelogioGeocodificador) {
  const mapa = new Map<string, EntradaCache>();
  return {
    ler(chave: string): { valor: CoordenadaGeocodificada | null } | undefined {
      const e = mapa.get(chave);
      if (!e) return undefined;
      mapa.delete(chave);
      if (e.expiraEm <= relogio.agora()) return undefined;
      mapa.set(chave, e); // mais recente no fim
      return { valor: e.valor };
    },
    gravar(chave: string, valor: CoordenadaGeocodificada | null): void {
      mapa.delete(chave);
      mapa.set(chave, { valor, expiraEm: relogio.agora() + ttlMs });
      while (mapa.size > maximo) mapa.delete(mapa.keys().next().value as string);
    },
    tamanho: () => mapa.size,
  };
}

// ---------- Nominatim ----------

export const URL_NOMINATIM_PADRAO = 'https://nominatim.openstreetmap.org';
/** Genérico, sem contato nem dado pessoal. */
export const USER_AGENT_GEOCODIFICADOR = 'MacuxiFDV/1.0';

/** `fetch` (ou o falso dos testes). */
export type BuscarGeocodificacao = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

export interface OpcoesNominatim {
  /** Base do serviço (sem barra final). Padrão: `URL_NOMINATIM_PADRAO`. */
  url?: string;
  buscar?: BuscarGeocodificacao;
  relogio?: RelogioGeocodificador;
  /** Padrão: a fila do processo (relógio real) ou, com `relogio` injetado, uma fila própria com ele. */
  fila?: FilaIntervalo;
  /** Prazo de cada requisição. Padrão 8 s. */
  prazoMs?: number;
  /** Acima disso na fila, recusa com 503 em vez de enfileirar. Padrão 30. */
  filaMaxima?: number;
  cacheMaximo?: number;
  cacheTtlMs?: number;
  log?: LogRota;
}

const UF_NOME: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

type Consulta = { tipo: 'rua'; params: Record<string, string> } | { tipo: 'cep'; params: Record<string, string> };

/** CEP de logradouro: 8 dígitos e sufixo diferente de 000 (o CEP geral da cidade termina em 000 e cai no centro). */
function cepDeLogradouro(cep: string): boolean {
  return cep.length === 8 && !cep.endsWith('000');
}

/** A busca estruturada por rua e, se ela não achar, a do CEP de logradouro. */
export function consultasNominatim(e: EnderecoGeocodificacao): Consulta[] {
  const lista: Consulta[] = [];
  const logradouro = (e.logradouro ?? '').trim();
  const cidade = (e.cidade ?? '').trim();
  const uf = (e.uf ?? '').trim().toUpperCase();
  const estado = UF_NOME[uf];
  const cep = normalizarCep(e.cep);
  if (logradouro && cidade) {
    const numero = numeroDaPorta(e.numero) ? (e.numero ?? '').trim() : '';
    lista.push({
      tipo: 'rua',
      params: { street: numero ? `${numero} ${logradouro}` : logradouro, city: cidade, ...(estado ? { state: estado } : {}) },
    });
  }
  if (cepDeLogradouro(cep)) lista.push({ tipo: 'cep', params: { postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}` } });
  return lista;
}

/** Item do `format=jsonv2`, só os campos lidos. */
interface ItemNominatim {
  lat?: unknown;
  lon?: unknown;
  place_rank?: unknown;
  category?: unknown;
  type?: unknown;
  addresstype?: unknown;
  address?: { house_number?: unknown; road?: unknown } | null;
}

/**
 * RN-CORE-77: precisão do resultado. `numero` = imóvel com número (rank ≥ 28); `rua` = via (rank 26–27 ou categoria
 * `highway`); `cep` = só na busca pelo CEP de logradouro e com resultado do tipo `postcode`; o resto (bairro, cidade, estado,
 * área) = `null`.
 */
function precisaoDoResultado(item: ItemNominatim, tipo: Consulta['tipo']): PrecisaoGeocodificacao | null {
  const rank = typeof item.place_rank === 'number' ? item.place_rank : 0;
  const temNumero = typeof item.address?.house_number === 'string' && item.address.house_number.trim() !== '';
  if (tipo === 'cep') return item.type === 'postcode' || item.addresstype === 'postcode' ? 'cep' : null;
  if (rank >= 28 && temNumero) return 'numero';
  if ((rank >= 26 && rank <= 27) || (item.category === 'highway' && rank >= 26)) return 'rua';
  return null;
}

function coordenada(v: unknown, limite: number): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && Math.abs(n) <= limite ? n : null;
}

/** Resposta inválida (não é lista) → lança; lista vazia ou item sem precisão aceita → `null`. */
export function lerRespostaNominatim(corpo: unknown, tipo: Consulta['tipo']): CoordenadaGeocodificada | null {
  if (!Array.isArray(corpo)) throw new Error('resposta fora do formato');
  const item = corpo[0] as ItemNominatim | undefined;
  if (!item || typeof item !== 'object') return null;
  const lat = coordenada(item.lat, 90);
  const lng = coordenada(item.lon, 180);
  if (lat === null || lng === null) throw new Error('coordenada fora do formato');
  const precisao = precisaoDoResultado(item, tipo);
  return precisao ? { lat, lng, precisao } : null;
}

export function criarGeocodificadorNominatim(op: OpcoesNominatim = {}): Geocodificador {
  const base = (op.url ?? URL_NOMINATIM_PADRAO).replace(/\/+$/, '');
  const buscar: BuscarGeocodificacao = op.buscar ?? ((url, init) => globalThis.fetch(url, init));
  const relogio = op.relogio ?? RELOGIO_REAL;
  const fila = op.fila ?? (op.relogio ? criarFilaIntervalo(INTERVALO_NOMINATIM_MS, relogio) : filaNominatimDoProcesso());
  const prazoMs = op.prazoMs ?? 8000;
  const filaMaxima = op.filaMaxima ?? 30;
  const cache = criarCacheLru(op.cacheMaximo ?? 5000, op.cacheTtlMs ?? 7 * 24 * 3600 * 1000, relogio);
  const emAndamento = new Map<string, Promise<CoordenadaGeocodificada | null>>();
  const log = op.log;

  async function requisitar(c: Consulta): Promise<{ valor: CoordenadaGeocodificada | null; status: number }> {
    const qs = new URLSearchParams({ ...c.params, countrycodes: 'br', format: 'jsonv2', addressdetails: '1', limit: '1' });
    const ac = new AbortController();
    const fimDoPrazo = new AbortController();
    const prazo = relogio.esperar(prazoMs, fimDoPrazo.signal).then(() => {
      if (!fimDoPrazo.signal.aborted) ac.abort();
    });
    try {
      const resposta = await Promise.race([
        buscar(`${base}/search?${qs.toString()}`, {
          signal: ac.signal,
          headers: { accept: 'application/json', 'accept-language': 'pt-BR', 'user-agent': USER_AGENT_GEOCODIFICADOR },
        }),
        prazo.then(() => {
          throw new Error('prazo');
        }),
      ]);
      if (!resposta.ok) throw Object.assign(new Error('http'), { status: resposta.status });
      return { valor: lerRespostaNominatim(await resposta.json(), c.tipo), status: resposta.status };
    } finally {
      fimDoPrazo.abort();
    }
  }

  async function consultar(endereco: EnderecoGeocodificacao): Promise<CoordenadaGeocodificada | null> {
    const inicio = relogio.agora();
    let status = 0;
    try {
      for (const c of consultasNominatim(endereco)) {
        if (fila.tamanho() >= filaMaxima) throw new Error('fila cheia');
        const r = await fila.executar(() => requisitar(c));
        status = r.status;
        if (r.valor) {
          log?.info({ geocodificacao: 'rede', resultado: 'localizado', precisao: r.valor.precisao, duracao_ms: relogio.agora() - inicio }, 'geocodificação');
          return r.valor;
        }
      }
      log?.info({ geocodificacao: 'rede', resultado: 'nao_localizado', status, duracao_ms: relogio.agora() - inicio }, 'geocodificação');
      return null;
    } catch (e) {
      // só o status: a mensagem do fetch pode trazer a URL (com o endereço)
      const st = typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : null;
      log?.warn({ geocodificacao: 'rede', resultado: 'indisponivel', status: st, duracao_ms: relogio.agora() - inicio }, 'geocodificação');
      throw erroGeocodificadorIndisponivel();
    }
  }

  return {
    disponivel: () => true,
    async localizar(endereco) {
      const chave = chaveGeocodificacao(endereco);
      const guardado = cache.ler(chave);
      if (guardado) {
        log?.info({ geocodificacao: 'cache', resultado: guardado.valor ? 'localizado' : 'nao_localizado' }, 'geocodificação');
        return guardado.valor;
      }
      const junto = emAndamento.get(chave);
      if (junto) return junto;
      const p = consultar(endereco)
        .then((valor) => {
          cache.gravar(chave, valor); // o `null` também (não repete a consulta)
          return valor;
        })
        .finally(() => emAndamento.delete(chave));
      emAndamento.set(chave, p);
      return p;
    },
  };
}

/**
 * `MACUXI_NOMINATIM_URL`: ausente = o Nominatim público; `desligado` = sem serviço (503); outro valor tem de ser http(s).
 * Lê na subida e lança com valor inválido (falha fechada; a mensagem não repete o valor). `criar(log)` monta o geocodificador
 * com o log do app (o mesmo padrão de `lerPacotesDoAmbiente`).
 */
export function geocodificadorDoAmbiente(
  env: Readonly<Record<string, string | undefined>>,
  op: Omit<OpcoesNominatim, 'url' | 'log'> = {},
): { descricao: string; criar(log?: LogRota): Geocodificador } {
  const v = (env.MACUXI_NOMINATIM_URL ?? '').trim();
  if (v.toLowerCase() === 'desligado') return { descricao: 'desligado', criar: () => GEOCODIFICADOR_DESLIGADO };
  const url = v || URL_NOMINATIM_PADRAO;
  const invalida = 'MACUXI_NOMINATIM_URL inválida: use http(s)://host ou "desligado".';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(invalida);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(invalida);
  return { descricao: `nominatim ${u.host}`, criar: (log) => criarGeocodificadorNominatim({ ...op, url, ...(log ? { log } : {}) }) };
}
