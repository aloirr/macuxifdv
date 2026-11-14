/**
 * Consulta de CNPJ na base pública da Receita (ADR 0046; R-20261114-132600-alexandre): `POST /v1/plataforma/cnpj` do portal
 * `config.` (super-admin ou admin do cliente). Fonte grátis BrasilAPI; reserva CNPJá (API aberta), infra independente.
 * - Ordem: BrasilAPI → se fora OU 404, CNPJá (base mais nova: pega empresa recém-aberta). 404 nas duas, ou 404 numa e a
 *   outra fora = não encontrado; as duas fora = 503.
 * - Prazo curto por fonte (AbortController), cache em memória (sucesso e não encontrado) e pedidos simultâneos do mesmo
 *   CNPJ juntos numa chamada só.
 * - Sem dado pessoal em log: nunca o CNPJ, o corpo nem a resposta; só fonte, resultado e duração. Sócios/QSA não saem
 *   da fonte (o mapeamento nem lê esses campos e o contrato é `.strict()`).
 */
import {
  CODIGOS_CNPJ,
  CONSULTAS_CNPJ_POR_MINUTO,
  ConsultaCnpjPedidoSchema,
  ConsultaCnpjRespostaSchema,
  ROTA_PORTAL_CNPJ,
  type AcessoPortalAutenticado,
  type ConsultaCnpjResposta,
  type FonteCnpjNome,
  type SituacaoCadastral,
} from '@macuxi/platform-sdk';
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { ehUf } from '@macuxi/comum/endereco';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ErroHttp } from './erros';
import { criarLimitador, type Limitador } from './limitador';
import { marcarPortal } from './plataforma';

/** `fetch` (ou o falso dos testes). */
export type Buscar = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

/** Uma fonte de CNPJ. Lança em qualquer falha (prazo, 5xx, 429, rede, formato) = fonte "fora". */
export interface FonteCnpj {
  nome: FonteCnpjNome;
  consultar(cnpj: string, sinal: AbortSignal): Promise<ConsultaCnpjResposta | 'nao_encontrado'>;
}

export class FonteCnpjFora extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'FonteCnpjFora';
  }
}

const SITUACAO_POR_CODIGO: Record<number, SituacaoCadastral> = { 1: 'nula', 2: 'ativa', 3: 'suspensa', 4: 'inapta', 8: 'baixada' };
const CABECALHOS = { accept: 'application/json', 'user-agent': 'macuxi-api' };

/** Texto limpo: vazio vira null; corta em 500 (teto do contrato). */
function texto(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 500) : null;
}
function digitos(v: unknown, tamanhos: readonly number[]): string | null {
  const d = somenteDigitos(typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  return tamanhos.includes(d.length) ? d : null;
}
function uf(v: unknown): ConsultaCnpjResposta['uf'] {
  const t = texto(v)?.toUpperCase() ?? null;
  return t && ehUf(t) ? t : null;
}
const EmailValido = z.string().max(254).email();
function email(v: unknown): string | null {
  const t = texto(v)?.toLowerCase() ?? null;
  return t && EmailValido.safeParse(t).success ? t : null;
}
function cnae(codigo: unknown, descricao: unknown): ConsultaCnpjResposta['cnae_principal'] {
  const d = somenteDigitos(typeof codigo === 'string' || typeof codigo === 'number' ? String(codigo) : '');
  const desc = texto(descricao);
  if (!d || d.length > 7 || !desc) return null;
  return { codigo: d.padStart(7, '0'), descricao: desc };
}
function situacao(codigo: unknown): SituacaoCadastral {
  const s = SITUACAO_POR_CODIGO[Number(codigo)];
  if (!s) throw new FonteCnpjFora('situação cadastral desconhecida');
  return s;
}
/** Confere no contrato; fora do formato = fonte fora. */
function conferir(r: ConsultaCnpjResposta): ConsultaCnpjResposta {
  const c = ConsultaCnpjRespostaSchema.safeParse(r);
  if (!c.success) throw new FonteCnpjFora('resposta fora do contrato');
  return c.data;
}

/** GET com prazo da chamada; 404 = não encontrado; 200 = JSON; resto = fora. */
async function obter(buscar: Buscar, url: string, sinal: AbortSignal): Promise<unknown> {
  const r = await buscar(url, { signal: sinal, headers: CABECALHOS });
  if (r.status === 404) return 'nao_encontrado';
  if (r.status !== 200) throw new FonteCnpjFora(`HTTP ${r.status}`);
  try {
    return (await r.json()) as unknown;
  } catch {
    throw new FonteCnpjFora('JSON inválido');
  }
}

const Objeto = z.record(z.unknown());

/** Mapeia o 200 da BrasilAPI (`/api/cnpj/v1/{cnpj}`) para o contrato. Exportado para os testes. */
export function daBrasilApi(cnpj: string, corpo: unknown): ConsultaCnpjResposta {
  const o = Objeto.safeParse(corpo);
  if (!o.success) throw new FonteCnpjFora('resposta não é objeto');
  const b = o.data;
  const razao = texto(b.razao_social);
  if (!razao) throw new FonteCnpjFora('sem razão social');
  const tipo = texto(b.descricao_tipo_de_logradouro);
  const lograd = texto(b.logradouro);
  // o tipo ("RUA") vem à parte; não repete quando o logradouro já começa por ele
  const logradouro = lograd && tipo && !lograd.toUpperCase().startsWith(`${tipo.toUpperCase()} `) ? `${tipo} ${lograd}` : lograd;
  return conferir({
    cnpj,
    razao_social: razao,
    nome_fantasia: texto(b.nome_fantasia),
    endereco: { logradouro, numero: texto(b.numero), complemento: texto(b.complemento), bairro: texto(b.bairro) },
    municipio: texto(b.municipio),
    uf: uf(b.uf),
    cep: digitos(b.cep, [8]),
    situacao_cadastral: situacao(b.situacao_cadastral),
    cnae_principal: cnae(b.cnae_fiscal, b.cnae_fiscal_descricao),
    telefone: digitos(b.ddd_telefone_1, [10, 11]) ?? digitos(b.ddd_telefone_2, [10, 11]),
    email: email(b.email),
    fonte: 'brasilapi',
  });
}

/** Mapeia o 200 da CNPJá aberta (`/office/{cnpj}`) para o contrato. Exportado para os testes. */
export function daCnpja(cnpj: string, corpo: unknown): ConsultaCnpjResposta {
  const o = Objeto.safeParse(corpo);
  if (!o.success) throw new FonteCnpjFora('resposta não é objeto');
  const c = o.data;
  const sub = (v: unknown): Record<string, unknown> => {
    const r = Objeto.safeParse(v);
    return r.success ? r.data : {};
  };
  const lista = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(sub) : []);
  const razao = texto(sub(c.company).name);
  if (!razao) throw new FonteCnpjFora('sem razão social');
  const end = sub(c.address);
  const fone = lista(c.phones)
    .map((f) => digitos(`${texto(f.area) ?? ''}${texto(f.number) ?? ''}`, [10, 11]))
    .find((f) => f !== null);
  const mail = lista(c.emails)
    .map((e) => email(e.address))
    .find((e) => e !== null);
  const atividade = sub(c.mainActivity);
  return conferir({
    cnpj,
    razao_social: razao,
    nome_fantasia: texto(c.alias),
    endereco: { logradouro: texto(end.street), numero: texto(end.number), complemento: texto(end.details), bairro: texto(end.district) },
    municipio: texto(end.city),
    uf: uf(end.state),
    cep: digitos(end.zip, [8]),
    situacao_cadastral: situacao(sub(c.status).id),
    cnae_principal: cnae(atividade.id, atividade.text),
    telefone: fone ?? null,
    email: mail ?? null,
    fonte: 'cnpja',
  });
}

export function fonteBrasilApi(buscar: Buscar = fetch): FonteCnpj {
  return {
    nome: 'brasilapi',
    async consultar(cnpj, sinal) {
      const corpo = await obter(buscar, `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, sinal);
      return corpo === 'nao_encontrado' ? corpo : daBrasilApi(cnpj, corpo);
    },
  };
}

export function fonteCnpja(buscar: Buscar = fetch): FonteCnpj {
  return {
    nome: 'cnpja',
    async consultar(cnpj, sinal) {
      const corpo = await obter(buscar, `https://open.cnpja.com/office/${cnpj}`, sinal);
      return corpo === 'nao_encontrado' ? corpo : daCnpja(cnpj, corpo);
    },
  };
}

/** Uma chamada a uma fonte, para o log (sem o CNPJ). */
export interface TentativaCnpj {
  fonte: FonteCnpjNome;
  resultado: 'ok' | 'nao_encontrado' | 'fora';
  ms: number;
}

export type ResultadoConsultaCnpj = (
  | { resultado: 'ok'; dados: ConsultaCnpjResposta }
  | { resultado: 'invalido' }
  | { resultado: 'nao_encontrado' }
  | { resultado: 'fora' }
) & { cache: boolean; tentativas: TentativaCnpj[] };

export interface ConsultaCnpj {
  /** CNPJ com ou sem máscara. */
  consultar(cnpj: string): Promise<ResultadoConsultaCnpj>;
}

export interface OpcoesConsultaCnpj {
  /** Em ordem: a primeira é a primária. */
  fontes: readonly FonteCnpj[];
  prazoMs?: number;
  ttlMs?: number;
  ttlNaoEncontradoMs?: number;
  maxCache?: number;
  agora?: () => number;
}

/** As duas fontes reais (BrasilAPI e a reserva CNPJá) com o `fetch` global. */
export function consultaCnpjPadrao(): ConsultaCnpj {
  return criarConsultaCnpj({ fontes: [fonteBrasilApi(), fonteCnpja()] });
}

export function criarConsultaCnpj(op: OpcoesConsultaCnpj): ConsultaCnpj {
  const prazoMs = op.prazoMs ?? 4_000;
  const ttlMs = op.ttlMs ?? 24 * 60 * 60 * 1000;
  const ttlNaoEncontradoMs = op.ttlNaoEncontradoMs ?? 60 * 60 * 1000;
  const maxCache = op.maxCache ?? 1_000;
  const agora = op.agora ?? Date.now;
  const cache = new Map<string, { valor: ConsultaCnpjResposta | 'nao_encontrado'; expira: number }>();
  const emCurso = new Map<string, Promise<ResultadoConsultaCnpj>>();

  const tentar = async (fonte: FonteCnpj, cnpj: string): Promise<ConsultaCnpjResposta | 'nao_encontrado' | 'fora'> => {
    const controle = new AbortController();
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<never>((_, falha) => {
      relogio = setTimeout(() => {
        controle.abort();
        falha(new FonteCnpjFora('prazo'));
      }, prazoMs);
    });
    try {
      return await Promise.race([fonte.consultar(cnpj, controle.signal), prazo]);
    } catch {
      return 'fora';
    } finally {
      clearTimeout(relogio);
    }
  };

  const buscarNasFontes = async (cnpj: string): Promise<ResultadoConsultaCnpj> => {
    const tentativas: TentativaCnpj[] = [];
    let naoEncontrado = false;
    for (const fonte of op.fontes) {
      const t0 = Date.now();
      const r = await tentar(fonte, cnpj);
      tentativas.push({ fonte: fonte.nome, resultado: typeof r === 'string' ? r : 'ok', ms: Date.now() - t0 });
      if (typeof r !== 'string') {
        guardar(cnpj, r, ttlMs);
        return { resultado: 'ok', dados: r, cache: false, tentativas };
      }
      if (r === 'nao_encontrado') naoEncontrado = true;
    }
    if (naoEncontrado) {
      guardar(cnpj, 'nao_encontrado', ttlNaoEncontradoMs);
      return { resultado: 'nao_encontrado', cache: false, tentativas };
    }
    return { resultado: 'fora', cache: false, tentativas };
  };

  const guardar = (cnpj: string, valor: ConsultaCnpjResposta | 'nao_encontrado', ttl: number) => {
    cache.delete(cnpj);
    while (cache.size >= maxCache) {
      const maisVelho = cache.keys().next().value;
      if (maisVelho === undefined) break;
      cache.delete(maisVelho);
    }
    cache.set(cnpj, { valor, expira: agora() + ttl });
  };

  return {
    consultar(entrada) {
      const cnpj = somenteDigitos(entrada);
      if (!cnpjValido(cnpj)) return Promise.resolve({ resultado: 'invalido', cache: false, tentativas: [] });
      const guardado = cache.get(cnpj);
      if (guardado && guardado.expira > agora()) {
        const v = guardado.valor;
        return Promise.resolve(v === 'nao_encontrado' ? { resultado: v, cache: true, tentativas: [] } : { resultado: 'ok', dados: v, cache: true, tentativas: [] });
      }
      if (guardado) cache.delete(cnpj);
      const andando = emCurso.get(cnpj);
      if (andando) return andando;
      const p = buscarNasFontes(cnpj).finally(() => emCurso.delete(cnpj));
      emCurso.set(cnpj, p);
      return p;
    },
  };
}

export interface DepsRotaConsultaCnpj {
  /** Quem entrou pelo portal; `null` = 401. */
  autenticar(req: FastifyRequest): Promise<AcessoPortalAutenticado | null>;
  validar(schema: z.ZodTypeAny, valor: unknown, onde: string): unknown;
  consulta: ConsultaCnpj;
  /** Padrão: `CONSULTAS_CNPJ_POR_MINUTO` por sessão do portal. */
  limitador?: Limitador;
}

/** `POST /v1/plataforma/cnpj`: super-admin ou admin do cliente. */
export function registrarRotaConsultaCnpj(app: FastifyInstance, dep: DepsRotaConsultaCnpj): void {
  const limitador = dep.limitador ?? criarLimitador(CONSULTAS_CNPJ_POR_MINUTO, 60_000);
  app.post(ROTA_PORTAL_CNPJ, async (req, reply) => {
    const quem = await dep.autenticar(req);
    if (!quem) throw new ErroHttp(401, 'NAO_AUTENTICADO', 'Entre no portal para continuar.');
    marcarPortal(req, { quem, tenantId: quem.tipo === 'admin_cliente' ? (quem.empresa?.tenant_id ?? null) : null });
    if (!limitador.tentar(quem.sessao_id)) {
      reply.header('retry-after', String(Math.max(1, limitador.esperaSegundos(quem.sessao_id))));
      throw new ErroHttp(429, CODIGOS_CNPJ.limite, 'Muitas consultas de CNPJ seguidas. Espere um minuto e tente de novo.');
    }
    // só o dígito errado vira CNPJ_INVALIDO; corpo fora do formato (campo extra, sem cnpj) é VALIDACAO
    const p = ConsultaCnpjPedidoSchema.safeParse(req.body);
    if (!p.success && p.error.issues.every((i) => i.code === 'custom')) {
      throw new ErroHttp(400, CODIGOS_CNPJ.invalido, 'CNPJ inválido: confira os dígitos.');
    }
    const { cnpj } = dep.validar(ConsultaCnpjPedidoSchema, req.body, 'corpo') as z.output<typeof ConsultaCnpjPedidoSchema>;
    const t0 = Date.now();
    const r = await dep.consulta.consultar(cnpj);
    req.log.info(
      { consulta_cnpj: { resultado: r.resultado, cache: r.cache, ms: Date.now() - t0, tentativas: r.tentativas, ...(r.resultado === 'ok' ? { fonte: r.dados.fonte } : {}) } },
      'consulta de CNPJ',
    );
    if (r.resultado === 'ok') return r.dados;
    if (r.resultado === 'invalido') throw new ErroHttp(400, CODIGOS_CNPJ.invalido, 'CNPJ inválido: confira os dígitos.');
    if (r.resultado === 'nao_encontrado') throw new ErroHttp(404, CODIGOS_CNPJ.naoEncontrado, 'CNPJ não encontrado na Receita Federal. Confira o número ou preencha os dados à mão.');
    throw new ErroHttp(503, CODIGOS_CNPJ.fonteFora, 'A consulta à Receita está fora do ar. Preencha os dados à mão ou tente de novo em instantes.');
  });
}
