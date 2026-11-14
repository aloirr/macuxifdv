/**
 * Cliente HTTP do portal `config.` (T-0087; T-0093, ADR 0031). Separado do cliente do BKO (`@macuxi/platform-sdk/web`), que guarda o
 * token do tenant no `localStorage`: aqui o token é o de plataforma, no `sessionStorage` (`lib/portal-sessao.ts`).
 * - Chamada pelo proxy same-origin (`/api-proxy`), com `Authorization: Bearer` e, nas rotas de módulo, `x-macuxi-tenant`.
 * - Antes de cada chamada autenticada: token perto do fim → renova (uma renovação por vez); vencido → limpa e manda entrar.
 * - 401 numa rota autenticada → limpa a sessão (a guarda leva a `/entrar`).
 * - Admin do cliente: 403 `EMPRESA_NAO_PERMITIDA` e 409 `EMPRESA_NAO_ESCOLHIDA` → a guarda leva à "Escolha a empresa" (ou à
 *   entrada, com 1 empresa só): `desvioDoErro` em `lib/portal-sessao.ts`.
 * - Nada vai ao `console`: nem e-mail, nem senha, nem token, nem o corpo do erro.
 * - Modo falso (`NEXT_PUBLIC_PORTAL_FALSO=1`, só fora de produção): as mesmas chamadas respondidas no navegador por
 *   `lib/portal-falso.ts`, contra os mesmos schemas, para navegar o fluxo antes de as rotas reais chegarem.
 */
import { CABECALHO_TENANT_PLATAFORMA, SessaoPortalSchema } from '@macuxi/platform-sdk';
import { downloadBlob, filenameFromDisposition } from '@macuxi/platform-sdk/web';

import { ROTAS_PORTAL, ROTAS_PUBLICAS_PORTAL } from './portal-rotas';
import {
  desvioDoErro,
  estadoDaSessao,
  guardarAvisoPortal,
  guardarEmpresaIndisponivel,
  lerSessaoPortal,
  limparSessaoPortal,
  marcarSaidaPedida,
  pedirDesvioPortal,
  salvarSessaoPortal,
  sessaoSemEmpresa,
  USO_RECENTE_MS,
  type SessaoPortal,
} from './portal-sessao';

export const MODO_PORTAL_FALSO = process.env.NEXT_PUBLIC_PORTAL_FALSO === '1' && process.env.NODE_ENV !== 'production';

export const MENSAGEM_SEM_CONEXAO = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
/** Aviso da entrada quando a guarda manda para cá (spec docs/design/portal-entrar.md §4). */
export const MENSAGEM_SESSAO_TERMINOU = 'Sua sessão terminou. Entre de novo.';
export const MENSAGEM_FORMATO = 'A resposta do servidor veio num formato inesperado. Atualize a página; se continuar, avise o suporte.';
export const MENSAGEM_PADRAO = 'Algo deu errado. Tente de novo; se continuar, avise o suporte.';
/** 503 do portal: faltam os segredos no servidor (quem resolve é quem opera o deploy; R-20261106-023316 🟡 3). */
export const MENSAGEM_PORTAL_SEM_SEGREDOS = 'Faltam os segredos do portal neste servidor. Confira as chaves da plataforma no deploy deste ambiente.';

export class ErroPortal extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    message: string,
    readonly detalhes?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ErroPortal';
  }
}

/** Frase para a tela. Texto técnico (JSON, pilha, vazio) vira a mensagem padrão. */
export function mensagemDoErro(e: unknown, padrao = MENSAGEM_PADRAO): string {
  const m = e instanceof Error ? e.message.trim() : '';
  if (!m || m.startsWith('{') || m.startsWith('[') || /\n\s+at\s/.test(m)) return padrao;
  return e instanceof ErroPortal ? m : padrao;
}

/** Corpo de erro da API (`{ codigo, mensagem, detalhes }`, ADR 0008) ou `null`. */
export function lerErroDaApi(status: number, corpo: unknown): ErroPortal {
  const b = (corpo && typeof corpo === 'object' ? corpo : {}) as { codigo?: unknown; mensagem?: unknown; detalhes?: unknown };
  const codigo = typeof b.codigo === 'string' ? b.codigo : `http_${status}`;
  const mensagem = typeof b.mensagem === 'string' && b.mensagem.trim() ? b.mensagem : MENSAGEM_PADRAO;
  const detalhes = b.detalhes && typeof b.detalhes === 'object' ? (b.detalhes as Record<string, unknown>) : undefined;
  return new ErroPortal(status, codigo, mensagem, detalhes);
}

// ---------------------------------------------------------------------------------------------------------------- uso

let ultimoUso = 0;
/** Interação do usuário (clique, tecla): a renovação automática só acontece com uso recente. */
export function registrarUso(agora = Date.now()) {
  ultimoUso = agora;
}
export function houveUsoRecente(agora = Date.now()): boolean {
  return agora - ultimoUso <= USO_RECENTE_MS;
}

// ---------------------------------------------------------------------------------------------------------------- transporte

type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT';

async function transportar(metodo: Metodo, caminho: string, corpo: unknown, cabecalhos: Record<string, string>): Promise<Response> {
  if (MODO_PORTAL_FALSO) {
    const { responderFalso } = await import('./portal-falso');
    return responderFalso(metodo, caminho, corpo, cabecalhos);
  }
  return fetch(`/api-proxy${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    cache: 'no-store',
    credentials: 'omit',
  });
}

function comQuery(caminho: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${caminho}?${s}` : caminho;
}

// ---------------------------------------------------------------------------------------------------------------- sessão

let renovando: Promise<SessaoPortal | null> | null = null;

/** `POST /plataforma/auth/renovar` (uma por vez). Recusada = sessão encerrada. */
export function renovarSessaoPortal(): Promise<SessaoPortal | null> {
  renovando ??= (async () => {
    const atual = lerSessaoPortal();
    if (!atual) return null;
    try {
      const res = await transportar('POST', ROTAS_PORTAL.renovar, undefined, { Authorization: `Bearer ${atual.token}` });
      if (!res.ok) {
        limparSessaoPortal();
        return null;
      }
      const nova = SessaoPortalSchema.safeParse(await res.json());
      if (!nova.success) return null;
      salvarSessaoPortal(nova.data);
      return nova.data;
    } catch {
      return null;
    } finally {
      renovando = null;
    }
  })();
  return renovando;
}

async function tokenDaSessao(): Promise<string> {
  const s = lerSessaoPortal();
  const estado = estadoDaSessao(s, Date.now());
  if (estado === 'ausente' || estado === 'expirada' || !s) {
    if (s) limparSessaoPortal();
    throw new ErroPortal(401, 'SESSAO_EXPIRADA', MENSAGEM_SESSAO_TERMINOU);
  }
  if (estado === 'renovar') {
    const nova = await renovarSessaoPortal();
    if (nova) return nova.token;
    if (estadoDaSessao(lerSessaoPortal(), Date.now()) === 'expirada') throw new ErroPortal(401, 'SESSAO_EXPIRADA', MENSAGEM_SESSAO_TERMINOU);
  }
  return s.token;
}

/** Sai: revoga a sessão no servidor (melhor esforço) e limpa a aba. */
export async function sairDoPortal(): Promise<void> {
  const s = lerSessaoPortal();
  // saída pedida: a guarda não mostra "Sua sessão terminou" nem guarda a página para voltar
  marcarSaidaPedida();
  limparSessaoPortal();
  if (!s) return;
  try {
    await transportar('POST', ROTAS_PORTAL.sair, undefined, { Authorization: `Bearer ${s.token}` });
  } catch {
    // sem rede: o token vence sozinho em 15 min
  }
}

// ---------------------------------------------------------------------------------------------------------------- chamadas

export interface OpcoesChamada<T> {
  metodo?: Metodo;
  corpo?: unknown;
  /** Tenant em que o super-admin age (rotas de módulo com `superAdmin`). */
  tenant?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Schema da resposta (Zod do contrato): formato diferente = `ErroPortal` com mensagem amigável. */
  schema?: { safeParse(x: unknown): { success: true; data: T } | { success: false } };
}

async function enviar(caminho: string, o: { metodo: Metodo; corpo?: unknown; tenant?: string; query?: OpcoesChamada<unknown>['query'] }): Promise<Response> {
  const publica = ROTAS_PUBLICAS_PORTAL.includes(caminho);
  const cabecalhos: Record<string, string> = {};
  if (o.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';
  if (!publica) cabecalhos.Authorization = `Bearer ${await tokenDaSessao()}`;
  if (o.tenant) cabecalhos[CABECALHO_TENANT_PLATAFORMA] = o.tenant;
  registrarUso();
  let res: Response;
  try {
    res = await transportar(o.metodo, comQuery(caminho, o.query), o.corpo, cabecalhos);
  } catch {
    throw new ErroPortal(0, 'sem_conexao', MENSAGEM_SEM_CONEXAO);
  }
  if (!res.ok) {
    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      // corpo não é JSON
    }
    const erro = lerErroDaApi(res.status, corpo);
    // a própria escolha (POST auth/empresa) trata o 403 na tela: só o 401 muda a sessão
    if (!publica) desviarPeloErro(erro, caminho === ROTAS_PORTAL.escolherEmpresa, o.tenant);
    throw erro;
  }
  return res;
}

/**
 * Rota autenticada com erro de sessão ou de empresa: 401 limpa a sessão (a guarda leva à entrada); 403/409 de empresa do admin do
 * cliente pedem à guarda a "Escolha a empresa" (2+) ou a entrada com aviso (1 empresa: a sessão acaba). No 403 com 2+, a empresa
 * da chamada sai da sessão (quando o resto ainda é sessão válida) e vai para a Escolha tirá-la da lista e dizer o nome: sem isso ela
 * ficava como "Atual" e levava de volta à página do 403 (R-20261107-174216 🟡 2).
 */
function desviarPeloErro(e: ErroPortal, soSessao: boolean, tenant: string | undefined) {
  if (e.status === 401) {
    limparSessaoPortal();
    return;
  }
  if (soSessao) return;
  const s = lerSessaoPortal();
  const d = desvioDoErro(s, e.status, e.codigo, tenant);
  if (!d) return;
  if (d.empresa && s) {
    guardarEmpresaIndisponivel(d.empresa);
    const sem = sessaoSemEmpresa(s, d.empresa.id);
    if (sem) salvarSessaoPortal(sem);
  } else if (d.aviso) guardarAvisoPortal(d.aviso);
  if (d.para === 'entrar') {
    // não é "sessão terminou": a guarda não guarda volta nem mostra esse aviso; a entrada mostra o da empresa
    marcarSaidaPedida();
    limparSessaoPortal();
    return;
  }
  pedirDesvioPortal(d);
}

/** Chamada JSON do portal. 204 = `undefined`. */
export async function chamarPortal<T = unknown>(caminho: string, o: OpcoesChamada<T> = {}): Promise<T> {
  const res = await enviar(caminho, { metodo: o.metodo ?? 'GET', corpo: o.corpo, tenant: o.tenant, query: o.query });
  if (res.status === 204) return undefined as T;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ErroPortal(0, 'formato_inesperado', MENSAGEM_FORMATO);
  }
  if (!o.schema) return json as T;
  const p = o.schema.safeParse(json);
  if (!p.success) throw new ErroPortal(0, 'formato_inesperado', MENSAGEM_FORMATO);
  return p.data;
}

/** Bytes de uma rota autenticada como `Blob` (o print do diagnóstico, T-0158), sem baixar: a tela mostra e abre em outra aba. */
export async function blobDoPortal(caminho: string): Promise<Blob> {
  const res = await enviar(caminho, { metodo: 'GET' });
  return res.blob();
}

/**
 * Baixa um documento público (sem token nem tenant), pelo caminho same-origin do `next.config.ts`. Hoje só o OpenAPI do Hub
 * (`OPENAPI_HUB`). No modo falso não há API: responde como rota ausente (`TEXTO_INDISPONIVEL`).
 */
export async function baixarDocumentoPublico(viaProxy: string, nomePadrao: string): Promise<void> {
  if (MODO_PORTAL_FALSO) throw new ErroPortal(404, 'http_404', 'Documento ausente no modo falso.');
  let res: Response;
  try {
    res = await fetch(viaProxy, { method: 'GET', cache: 'no-store', credentials: 'omit' });
  } catch {
    throw new ErroPortal(0, 'sem_conexao', MENSAGEM_SEM_CONEXAO);
  }
  if (!res.ok) {
    let corpo: unknown = null;
    try {
      corpo = await res.json();
    } catch {
      // corpo não é JSON
    }
    throw lerErroDaApi(res.status, corpo);
  }
  downloadBlob(await res.blob(), filenameFromDisposition(res.headers.get('content-disposition'), nomePadrao));
}

/** O que a tela mostra, ao lado do controle, quando a rota ainda não existe neste servidor (RD-0288: um texto só). */
export const TEXTO_INDISPONIVEL = 'Ainda não disponível neste servidor.';

/**
 * 404 de rota que ainda não existe neste servidor (N1/N2 da nuvem antes do merge): a tela mostra `TEXTO_INDISPONIVEL`. A API responde
 * `NAO_ENCONTRADO` para rota desconhecida (apps/api/src/app.ts); 404 de recurso tem código próprio (`LOTE_NAO_ENCONTRADO`...).
 */
export function ehRotaAusente(e: unknown): boolean {
  return e instanceof ErroPortal && e.status === 404 && (e.codigo === 'NAO_ENCONTRADO' || e.codigo === 'http_404');
}
