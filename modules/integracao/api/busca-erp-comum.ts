/**
 * Peças comuns da busca na API do ERP (RN-INT-17 a RN-INT-20): leitura da configuração e do segredo cifrado, sessão e chamadas ao
 * ERP pelo cliente HTTP de saída (SSRF, DNS, limite por minuto, 30 s) e a tradução das falhas.
 * A credencial decifrada vive só em memória, dentro destas funções e do adaptador; nunca vai a log, erro, auditoria ou resposta.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { Cofre, SegredoCifrado } from '@macuxi/platform-sdk/cofre-segredos';
import { ErroHttpSaida, type ClienteHttpSaida } from '@macuxi/platform-sdk/http-saida';
import type { ClasseFalhaColeta, Entidade, FrequenciasApiErp, ModeloErp } from '../contracts';
import {
  classificarFalhaCodigoSaida,
  classificarFalhaHttp,
  lerRetryAfterS,
  montarUrl,
  type AdaptadorErp,
  type ConfigAdaptador,
  type CredencialErp,
  type RequisicaoErp,
  type RespostaErp,
  type SessaoErp,
} from '../domain';

export interface LinhaConectorApi {
  conector_id: string;
  identificador: string;
  ativo: boolean;
  tipo: 'conector' | 'nuvem' | 'arquivo';
  recebe_pedidos: boolean;
  entidades: Entidade[];
  erp: ModeloErp;
  url_base: string;
  usuario_erp: string | null;
  parametros: Record<string, string | number | boolean>;
  frequencias: FrequenciasApiErp;
  coletas_paradas_em: Date | null;
}

const COLUNAS = `c.id as conector_id, c.identificador, c.ativo, c.tipo, c.recebe_pedidos, c.entidades, a.erp, a.url_base, a.usuario_erp, a.parametros, a.frequencias, a.coletas_paradas_em`;
const JUNCAO = `from integracao.conector c join integracao.conector_api a on a.tenant_id = c.tenant_id and a.conector_id = c.id and a.deleted_at is null`;

/** Configuração da busca do Conector `nuvem` (uma por Conector); `null` se o Conector não existe ou não tem busca configurada. */
export async function lerConectorApi(db: ClienteBanco, tenantId: string, conectorId: string): Promise<LinhaConectorApi | null> {
  const { rows } = await db.query<LinhaConectorApi>(`select ${COLUNAS} ${JUNCAO} where c.tenant_id = $1 and c.id = $2 and c.deleted_at is null`, [tenantId, conectorId]);
  return rows[0] ?? null;
}

/** Conectores `nuvem` ativos com busca configurada (agendador). */
export async function listarConectoresApiAtivos(db: ClienteBanco, tenantId: string): Promise<LinhaConectorApi[]> {
  const { rows } = await db.query<LinhaConectorApi>(`select ${COLUNAS} ${JUNCAO} where c.tenant_id = $1 and c.deleted_at is null and c.ativo and c.tipo = 'nuvem' order by c.identificador`, [tenantId]);
  return rows;
}

/** O Conector `nuvem` ativo que recebe os pedidos (RN-INT-13: um por empresa), com a busca configurada. */
export async function lerConectorApiDePedidos(db: ClienteBanco, tenantId: string): Promise<LinhaConectorApi | null> {
  const { rows } = await db.query<LinhaConectorApi>(`select ${COLUNAS} ${JUNCAO} where c.tenant_id = $1 and c.deleted_at is null and c.ativo and c.tipo = 'nuvem' and c.recebe_pedidos limit 1`, [tenantId]);
  return rows[0] ?? null;
}

export interface CredencialGravada {
  segredo: SegredoCifrado;
  atualizada_em: Date;
  atualizada_por: string | null;
}

export async function lerCredencialCifrada(db: ClienteBanco, tenantId: string, conectorId: string): Promise<CredencialGravada | null> {
  const { rows } = await db.query<{ cifrado: Buffer; iv: Buffer; tag: Buffer; chave_versao: number; atualizada_em: Date; atualizada_por: string | null }>(
    'select cifrado, iv, tag, chave_versao, atualizada_em, atualizada_por from integracao.credencial_erp where tenant_id = $1 and conector_id = $2 and deleted_at is null',
    [tenantId, conectorId],
  );
  const r = rows[0];
  return r ? { segredo: { cifrado: r.cifrado, iv: r.iv, tag: r.tag, chave_versao: Number(r.chave_versao) }, atualizada_em: r.atualizada_em, atualizada_por: r.atualizada_por } : null;
}

/** Só o estado da credencial (existe e quando foi trocada): NUNCA seleciona as colunas do segredo. */
export async function lerEstadoCredencial(db: ClienteBanco, tenantId: string, conectorId: string): Promise<{ atualizada_em: Date; atualizada_por: string | null } | null> {
  const { rows } = await db.query<{ atualizada_em: Date; atualizada_por: string | null }>(
    'select atualizada_em, atualizada_por from integracao.credencial_erp where tenant_id = $1 and conector_id = $2 and deleted_at is null',
    [tenantId, conectorId],
  );
  return rows[0] ?? null;
}

type CredencialJson = { senha: string; token?: string; appkey?: string };

/** Cifra a credencial (AAD `tenant_id|conector_id`) e grava, trocando a anterior na mesma linha viva (RN-INT-18). Devolve só `atualizada_em`. */
export async function gravarCredencial(db: ClienteBanco, cofre: Cofre, e: { tenantId: string; conectorId: string; credencial: CredencialJson; porUsuario: string | null; agora: Date }): Promise<Date> {
  const c = cofre.cifrar(JSON.stringify(e.credencial), { tenant_id: e.tenantId, conector_id: e.conectorId });
  await db.query(
    `insert into integracao.credencial_erp (tenant_id, conector_id, cifrado, iv, tag, chave_versao, atualizada_em, atualizada_por)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (tenant_id, conector_id) where deleted_at is null
     do update set cifrado = excluded.cifrado, iv = excluded.iv, tag = excluded.tag, chave_versao = excluded.chave_versao,
                   atualizada_em = excluded.atualizada_em, atualizada_por = excluded.atualizada_por`,
    [e.tenantId, e.conectorId, c.cifrado, c.iv, c.tag, c.chave_versao, e.agora.toISOString(), e.porUsuario],
  );
  return e.agora;
}

/** Decifra em memória. Lança `ErroCofre` (sem o valor) se a chave ou o AAD não batem. */
export function decifrarCredencial(cofre: Cofre, e: { tenantId: string; conectorId: string; usuario_erp: string | null; gravada: CredencialGravada }): CredencialErp {
  const j = JSON.parse(cofre.decifrar(e.gravada.segredo, { tenant_id: e.tenantId, conector_id: e.conectorId })) as CredencialJson;
  return { usuario: e.usuario_erp, senha: j.senha, ...(j.token ? { token: j.token } : {}), ...(j.appkey ? { appkey: j.appkey } : {}) };
}

// ---------------------------------------------------------------- chamadas ao ERP

export interface FalhaErp {
  classe: ClasseFalhaColeta;
  /** Código curto, sem dado: `HTTP_401`, `TEMPO_ESGOTADO`, `FORMATO`… (vai a `coleta_execucao.erro_codigo`). */
  codigo: string;
  status: number | null;
  retryAfterS: number | null;
  tenta: boolean;
  paraColetas: boolean;
  /** Português, com a ação seguinte; sem URL, cabeçalho nem corpo do ERP. */
  mensagem: string;
  /** Só quando a falha veio do cliente de saída (`DESTINO_BLOQUEADO`…). */
  codigoSaida?: string;
}

export class ErroErp extends Error {
  constructor(readonly falha: FalhaErp) {
    super(`erp: ${falha.codigo}`);
    this.name = 'ErroErp';
  }
}

export function falhaDeStatus(status: number, cabecalhos: RespostaErp['cabecalhos'], agora: string): FalhaErp {
  const c = classificarFalhaHttp(status);
  const ra = lerRetryAfterS(Array.isArray(cabecalhos['retry-after']) ? cabecalhos['retry-after'][0] : (cabecalhos['retry-after'] as string | undefined), agora);
  const mensagem =
    c.classe === 'credencial_recusada'
      ? `O ERP recusou a credencial (HTTP ${status}). Troque a credencial em Integração ERP > Conectores; as coletas ficam paradas até lá.`
      : c.classe === 'transitoria'
        ? `O ERP não atendeu agora (HTTP ${status}). O Macuxi tenta de novo sozinho.`
        : `O ERP respondeu HTTP ${status}. Confira a URL da API e o modelo do ERP em Integração ERP > Conectores.`;
  return { classe: c.classe, codigo: `HTTP_${status}`, status, retryAfterS: ra, tenta: c.tenta, paraColetas: c.paraColetas, mensagem };
}

export function falhaDeSaida(e: ErroHttpSaida): FalhaErp {
  const c = classificarFalhaCodigoSaida(e.codigo);
  const mensagem =
    e.codigo === 'DESTINO_BLOQUEADO'
      ? 'O endereço do ERP aponta para uma rede interna ou não permitida. Informe a URL pública (https) da API.'
      : c.tenta
        ? 'Não foi possível falar com o ERP agora (rede ou tempo esgotado). O Macuxi tenta de novo sozinho.'
        : 'A URL do ERP não é aceita (use https, sem usuário e senha na URL). Corrija em Integração ERP > Conectores.';
  return { classe: c.classe, codigo: e.codigo, status: null, retryAfterS: e.esperarMs ? Math.ceil(e.esperarMs / 1000) : null, tenta: c.tenta, paraColetas: false, mensagem, codigoSaida: e.codigo };
}

function lerCorpo(buf: Buffer): unknown {
  if (buf.length === 0) return null;
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return null;
  }
}

export interface ClienteErp {
  /** Chama o ERP. Lança `ErroErp` em 401/403/408/429/5xx e falha de rede; devolve as demais respostas (o adaptador lê). */
  chamar(req: RequisicaoErp): Promise<RespostaErp>;
}

export function criarClienteErp(o: {
  http: ClienteHttpSaida;
  adaptador: AdaptadorErp;
  urlBase: string;
  chaveLimite: string;
  credencial: CredencialErp;
  cfg: ConfigAdaptador;
  agora(): string;
}): ClienteErp {
  let sessao: SessaoErp | null = null;

  const enviar = async (req: RequisicaoErp, cabSessao: Readonly<Record<string, string>>): Promise<RespostaErp> => {
    try {
      const r = await o.http.requisitar({
        url: montarUrl(o.urlBase, req.caminho, req.query),
        metodo: req.metodo,
        cabecalhos: { accept: 'application/json', ...(req.corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...req.cabecalhos, ...cabSessao },
        ...(req.corpo !== undefined ? { corpo: JSON.stringify(req.corpo) } : {}),
        chaveLimite: o.chaveLimite,
      });
      return { status: r.status, cabecalhos: r.cabecalhos, corpo: lerCorpo(r.corpo) };
    } catch (e) {
      if (e instanceof ErroHttpSaida) throw new ErroErp(falhaDeSaida(e));
      throw e;
    }
  };

  const entrar = async (): Promise<SessaoErp> => {
    const r = await enviar(o.adaptador.requisicaoLogin(o.credencial, o.cfg), {});
    const s = o.adaptador.lerSessao(r, o.agora());
    if (!s.ok) {
      const f = s.motivo === 'credencial_recusada' ? falhaDeStatus(401, r.cabecalhos, o.agora()) : falhaDeStatus(s.status >= 400 ? s.status : 502, r.cabecalhos, o.agora());
      if (s.motivo === 'formato_mudou' && s.status >= 200 && s.status < 300) {
        throw new ErroErp({ ...f, classe: 'formato_mudou', codigo: 'LOGIN_FORMATO', tenta: false, paraColetas: false, mensagem: 'O login do ERP respondeu, mas não no formato esperado. Confira a URL da API e o modelo do ERP.' });
      }
      throw new ErroErp(f);
    }
    sessao = s.sessao;
    return s.sessao;
  };

  const sessaoValida = () => sessao !== null && (sessao.expiraEm === null || Date.parse(sessao.expiraEm) > Date.parse(o.agora()));

  const classificar = (r: RespostaErp): RespostaErp => {
    if (r.status === 401 || r.status === 403 || r.status === 408 || r.status === 429 || r.status >= 500) throw new ErroErp(falhaDeStatus(r.status, r.cabecalhos, o.agora()));
    return r;
  };

  return {
    async chamar(req) {
      if (!sessaoValida()) await entrar();
      let r = await enviar(req, sessao!.cabecalhos);
      if (r.status === 401) {
        // a sessão do ERP pode ter vencido: entra de novo UMA vez; se recusar de novo, a credencial é o problema
        await entrar();
        r = await enviar(req, sessao!.cabecalhos);
      }
      return classificar(r);
    },
  };
}
