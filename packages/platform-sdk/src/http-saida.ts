/// <reference types="node" />
/**
 * Cliente HTTP de saída para URL informada pelo cliente (busca na API do ERP, Conector tipo `nuvem`; ADR 0066; desenho
 * `docs/desenho/integracao-modelos-erp.md` §2.5; RN-INT-16 e RN-INT-19 propostas). Usa `node:https` e `node:dns`: exportado
 * SÓ pelo subcaminho `@macuxi/platform-sdk/http-saida`.
 *
 * Proteção contra SSRF:
 * - só `https`, sem usuário e senha na URL;
 * - o DNS é resolvido antes e TODOS os endereços são conferidos; loopback, privado, CGNAT, link-local, metadados
 *   (169.254.169.254, fd00:ec2::254), multicast, documentação e reservado são recusados, em IPv4 e IPv6 (com IPv4 embutido);
 * - a conexão vai ao endereço conferido (o `lookup` do `https.request` devolve só ele), com o SNI e o certificado do host:
 *   não há segunda resolução entre a conferência e a conexão (DNS rebinding);
 * - redirecionamento só para o mesmo host e porta, em `https`, e passa de novo por toda a conferência; no máximo 3.
 *
 * Limites: 30 s no total por chamada (com os redirecionamentos), 60 chamadas por minuto por Conector (`chaveLimite`, em
 * memória do processo), resposta de até 20 MB. Nada é registrado: nem URL, nem cabeçalho, nem corpo. O erro leva só o código,
 * o host e o status.
 */
import { lookup as lookupDns } from 'node:dns/promises';
import { request as requestHttps } from 'node:https';
import { isIP } from 'node:net';
import { LIMITES_COLETA_ERP } from './coleta-erp';

// ---------- endereços bloqueados ----------

function ipv4ParaNumero(ip: string): number | null {
  const partes = ip.split('.');
  if (partes.length !== 4) return null;
  let n = 0;
  for (const p of partes) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const FAIXAS_V4_BLOQUEADAS: readonly [string, number][] = [
  ['0.0.0.0', 8], // "esta rede"
  ['10.0.0.0', 8], // privada
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local e metadados (169.254.169.254)
  ['172.16.0.0', 12], // privada
  ['192.0.0.0', 24], // atribuições do IETF
  ['192.0.2.0', 24], // documentação
  ['192.88.99.0', 24], // relay 6to4
  ['192.168.0.0', 16], // privada
  ['198.18.0.0', 15], // testes de desempenho
  ['198.51.100.0', 24], // documentação
  ['203.0.113.0', 24], // documentação
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reservado e broadcast
];

function v4Bloqueado(n: number): boolean {
  return FAIXAS_V4_BLOQUEADAS.some(([base, bits]) => {
    const b = ipv4ParaNumero(base)!;
    const tam = 2 ** (32 - bits);
    return n >= b && n < b + tam;
  });
}

/** 8 grupos de 16 bits; `null` se não for IPv6 válido. Aceita IPv4 no fim (`::ffff:10.0.0.1`) e zona (`fe80::1%eth0`). */
function ipv6ParaGrupos(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zona = s.indexOf('%');
  if (zona >= 0) s = s.slice(0, zona);
  const ultimo = s.lastIndexOf(':');
  if (s.slice(ultimo + 1).includes('.')) {
    // IPv4 no fim vira os dois últimos grupos (`::ffff:10.0.0.1` → `::ffff:a00:1`)
    const n = ipv4ParaNumero(s.slice(ultimo + 1));
    if (n === null) return null;
    s = `${s.slice(0, ultimo + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const lados = s.split('::');
  if (lados.length > 2) return null;
  const ler = (t: string) => (t === '' ? [] : t.split(':'));
  const esq = ler(lados[0]!);
  const dir = lados.length === 2 ? ler(lados[1]!) : [];
  if ([...esq, ...dir].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const total = esq.length + dir.length;
  if (lados.length === 1 && total !== 8) return null;
  if (lados.length === 2 && total > 7) return null;
  const zeros = lados.length === 2 ? new Array<number>(8 - total).fill(0) : [];
  return [...esq, ...zeros.map(String), ...dir].map((g) => parseInt(g, 16));
}

function v6Bloqueado(g: number[]): boolean {
  const [a, b, c, d, e, f, h, i] = g as [number, number, number, number, number, number, number, number];
  const v4 = (alto: number, baixo: number) => v4Bloqueado(alto * 65536 + baixo);
  // ::ffff:a.b.c.d (IPv4 mapeado) vale o IPv4; o resto de ::/80 (::, ::1, IPv4 compatível) não é roteável
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) return f === 0xffff ? v4(h, i) : true;
  if (a === 0x64 && b === 0xff9b) return c === 0 && d === 0 && e === 0 && f === 0 ? v4(h, i) : true; // NAT64 (e o local)
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true; // descarte
  if (a === 0x2001 && b < 0x200) return true; // 2001::/23 IETF (Teredo, ORCHID…)
  if (a === 0x2001 && b === 0xdb8) return true; // documentação
  if (a === 0x2002) return v4(b, c); // 6to4: IPv4 nos bits 16–48
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 local única (inclui fd00:ec2::254)
  if ((a & 0xffc0) === 0xfe80) return true; // link-local
  if ((a & 0xffc0) === 0xfec0) return true; // site-local (obsoleto)
  if ((a & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/**
 * O endereço é proibido como destino (loopback, privado, link-local, metadados, multicast, documentação, reservado), em IPv4
 * ou IPv6. Texto que não é IP também é proibido (falha fechada).
 */
export function enderecoIpBloqueado(ip: string): boolean {
  const limpo = ip.trim().replace(/^\[|\]$/g, '');
  const tipo = isIP(limpo.split('%')[0]!);
  if (tipo === 4) return v4Bloqueado(ipv4ParaNumero(limpo)!);
  if (tipo === 6) {
    const g = ipv6ParaGrupos(limpo);
    return g === null ? true : v6Bloqueado(g);
  }
  return true;
}

// ---------- erros ----------

export type CodigoErroHttpSaida =
  | 'URL_INVALIDA'
  | 'ESQUEMA_PROIBIDO'
  | 'CREDENCIAL_NA_URL'
  | 'DESTINO_BLOQUEADO'
  | 'DNS_FALHOU'
  | 'REDIRECIONAMENTO_PROIBIDO'
  | 'REDIRECIONAMENTOS_DEMAIS'
  | 'TEMPO_ESGOTADO'
  | 'RESPOSTA_GRANDE_DEMAIS'
  | 'LIMITE_POR_MINUTO'
  | 'REDE';

const RETENTAVEIS: ReadonlySet<CodigoErroHttpSaida> = new Set(['DNS_FALHOU', 'TEMPO_ESGOTADO', 'LIMITE_POR_MINUTO', 'REDE']);

/** Erro do cliente de saída: só código, host e, no limite por minuto, quanto esperar. Nunca URL completa, cabeçalho ou corpo. */
export class ErroHttpSaida extends Error {
  readonly retentavel: boolean;
  constructor(
    readonly codigo: CodigoErroHttpSaida,
    readonly host: string | null,
    readonly esperarMs?: number,
  ) {
    super(`saída HTTP recusada: ${codigo}${host ? ` (${host})` : ''}`);
    this.name = 'ErroHttpSaida';
    this.retentavel = RETENTAVEIS.has(codigo);
  }
}

// ---------- portas injetáveis ----------

export interface EnderecoResolvido {
  address: string;
  family: 4 | 6;
}

/** Resolve o host em todos os endereços (A e AAAA). */
export type ResolverDns = (host: string) => Promise<EnderecoResolvido[]>;

export interface PedidoTransporte {
  url: URL;
  metodo: string;
  cabecalhos: Record<string, string>;
  corpo?: string | Uint8Array;
  /** Endereço já conferido: a conexão vai só a ele. */
  endereco: EnderecoResolvido;
  sinal: AbortSignal;
  limiteBytes: number;
}

export interface RespostaHttpSaida {
  status: number;
  cabecalhos: Record<string, string | string[] | undefined>;
  corpo: Buffer;
}

export type TransporteHttpSaida = (p: PedidoTransporte) => Promise<RespostaHttpSaida>;

export const resolverDnsPadrao: ResolverDns = async (host) => {
  const res = await lookupDns(host, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

/** `https.request` com o endereço fixado pelo `lookup` (SNI e certificado do host), sem pool (`agent: false`). */
export const transporteHttpsPadrao: TransporteHttpSaida = (p) =>
  new Promise((resolve, reject) => {
    const { address, family } = p.endereco;
    const host = p.url.hostname.replace(/^\[|\]$/g, '');
    const req = requestHttps(
      {
        protocol: 'https:',
        hostname: host,
        port: p.url.port || 443,
        path: `${p.url.pathname}${p.url.search}`,
        method: p.metodo,
        headers: p.cabecalhos,
        agent: false,
        signal: p.sinal,
        ...(isIP(host) ? {} : { servername: host }),
        lookup: ((_h: string, opcoes: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opcoes?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
      },
      (res) => {
        const partes: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > p.limiteBytes) {
            res.destroy();
            reject(new ErroHttpSaida('RESPOSTA_GRANDE_DEMAIS', p.url.host));
            return;
          }
          partes.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, cabecalhos: { ...res.headers }, corpo: Buffer.concat(partes) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (p.corpo !== undefined) req.write(p.corpo);
    req.end();
  });

// ---------- cliente ----------

export interface OpcoesClienteHttpSaida {
  /** Total por chamada, com os redirecionamentos (padrão 30 s). */
  timeoutMs?: number;
  /** Chamadas por minuto por `chaveLimite` (padrão 60, por Conector). */
  limitePorMinuto?: number;
  maxRedirecionamentos?: number;
  limiteBytesResposta?: number;
  resolver?: ResolverDns;
  transporte?: TransporteHttpSaida;
  /** Relógio em ms (testes). */
  agora?: () => number;
}

export interface PedidoHttpSaida {
  url: string;
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cabecalhos?: Record<string, string>;
  corpo?: string | Uint8Array;
  /** Chave do limite por minuto: o `conector_id`. Sem ela, o host. */
  chaveLimite?: string;
}

export interface ClienteHttpSaida {
  requisitar(p: PedidoHttpSaida): Promise<RespostaHttpSaida>;
}

const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);
const JANELA_MS = 60_000;

/** Confere a URL (só https, sem credencial embutida); devolve a URL normalizada. */
export function validarUrlSaida(texto: string): URL {
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    throw new ErroHttpSaida('URL_INVALIDA', null);
  }
  if (url.protocol !== 'https:') throw new ErroHttpSaida('ESQUEMA_PROIBIDO', url.host || null);
  if (url.username || url.password) throw new ErroHttpSaida('CREDENCIAL_NA_URL', url.host);
  if (!url.hostname) throw new ErroHttpSaida('URL_INVALIDA', null);
  return url;
}

export function criarClienteHttpSaida(opcoes: OpcoesClienteHttpSaida = {}): ClienteHttpSaida {
  const timeoutMs = opcoes.timeoutMs ?? LIMITES_COLETA_ERP.timeoutChamadaMs;
  const limite = opcoes.limitePorMinuto ?? LIMITES_COLETA_ERP.chamadasPorMinutoPorConector;
  const maxRedir = opcoes.maxRedirecionamentos ?? 3;
  const limiteBytes = opcoes.limiteBytesResposta ?? 20 * 1024 * 1024;
  const resolver = opcoes.resolver ?? resolverDnsPadrao;
  const transporte = opcoes.transporte ?? transporteHttpsPadrao;
  const agora = opcoes.agora ?? Date.now;
  const chamadas = new Map<string, number[]>();

  const contar = (chave: string, host: string) => {
    const t = agora();
    const recentes = (chamadas.get(chave) ?? []).filter((x) => x > t - JANELA_MS);
    if (recentes.length >= limite) {
      chamadas.set(chave, recentes);
      throw new ErroHttpSaida('LIMITE_POR_MINUTO', host, recentes[0]! + JANELA_MS - t);
    }
    recentes.push(t);
    chamadas.set(chave, recentes);
  };

  const conferirDestino = async (url: URL): Promise<EnderecoResolvido> => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let enderecos: EnderecoResolvido[];
    if (isIP(host)) enderecos = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
    else {
      try {
        enderecos = await resolver(host);
      } catch {
        throw new ErroHttpSaida('DNS_FALHOU', url.host);
      }
    }
    if (enderecos.length === 0) throw new ErroHttpSaida('DNS_FALHOU', url.host);
    if (enderecos.some((e) => enderecoIpBloqueado(e.address))) throw new ErroHttpSaida('DESTINO_BLOQUEADO', url.host);
    return enderecos[0]!;
  };

  return {
    async requisitar(p) {
      let url = validarUrlSaida(p.url);
      const origem = url.host;
      const chave = p.chaveLimite ?? origem;
      let metodo: string = p.metodo ?? 'GET';
      let corpo = p.corpo;
      const controle = new AbortController();
      const relogio = setTimeout(() => controle.abort(), timeoutMs);
      try {
        for (let salto = 0; ; salto++) {
          const endereco = await conferirDestino(url);
          if (controle.signal.aborted) throw new ErroHttpSaida('TEMPO_ESGOTADO', url.host);
          contar(chave, url.host);
          let resposta: RespostaHttpSaida;
          try {
            resposta = await transporte({ url, metodo, cabecalhos: { ...(p.cabecalhos ?? {}) }, ...(corpo !== undefined ? { corpo } : {}), endereco, sinal: controle.signal, limiteBytes });
          } catch (e) {
            if (e instanceof ErroHttpSaida) throw e;
            throw new ErroHttpSaida(controle.signal.aborted ? 'TEMPO_ESGOTADO' : 'REDE', url.host);
          }
          if (!REDIRECIONAMENTOS.has(resposta.status)) return resposta;
          const local = resposta.cabecalhos.location;
          const destino = Array.isArray(local) ? local[0] : local;
          if (!destino) return resposta;
          if (salto >= maxRedir) throw new ErroHttpSaida('REDIRECIONAMENTOS_DEMAIS', url.host);
          let proxima: URL;
          try {
            proxima = new URL(destino, url);
          } catch {
            throw new ErroHttpSaida('REDIRECIONAMENTO_PROIBIDO', url.host);
          }
          if (proxima.protocol !== 'https:') throw new ErroHttpSaida('ESQUEMA_PROIBIDO', url.host);
          if (proxima.host !== origem) throw new ErroHttpSaida('REDIRECIONAMENTO_PROIBIDO', url.host);
          url = validarUrlSaida(proxima.toString());
          if (resposta.status === 303 || ((resposta.status === 301 || resposta.status === 302) && metodo === 'POST')) {
            metodo = 'GET';
            corpo = undefined;
          }
        }
      } finally {
        clearTimeout(relogio);
      }
    },
  };
}
