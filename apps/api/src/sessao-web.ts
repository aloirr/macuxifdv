/**
 * T-0117 (ADR 0038): token de renovação do BKO em cookie httpOnly nas rotas públicas com `cookieSessao` (login, troca de
 * senha, refresh e logout do Core). As regras puras (nome, atributos, leitura, modo) estão no SDK (`cookie-sessao.ts`).
 *
 * - Sem `X-Macuxi-CSRF`: nada muda (o app manda e recebe o token no corpo).
 * - `X-Macuxi-CSRF: 1` (o BKO): `renovar`/`encerrar` leem o cookie para `corpo.refresh_token`; a resposta de
 *   `emitir`/`renovar` sai SEM o `refresh_token` e com o `Set-Cookie`; `encerrar` apaga o cookie sempre; `renovar` recusado
 *   (401/423) apaga o cookie. Respostas com `Cache-Control: no-store`.
 * - Cabeçalho com outro valor ou `Sec-Fetch-Site` de outro site: 403 `CSRF_RECUSADO`, antes de validar o corpo ou contar
 *   tentativa.
 * O valor do token nunca vai para log (o `Cookie` já é redigido; `Set-Cookie` também: `CAMINHOS_REDIGIDOS_LOG`).
 */
import {
  CAMPO_TOKEN_RENOVACAO,
  cookieSessaoApagado,
  lerCookie,
  modoDaSessaoWeb,
  montarCookieSessao,
  nomeDoCookieSessao,
  type CookieSessaoRota,
} from '@macuxi/platform-sdk';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ErroHttp } from './erros';

/** Configuração do cookie (`MACUXI_SESSAO_COOKIE_SEGURO`, `lerSessaoWeb` em `config.ts`). */
export interface OpcoesSessaoWeb {
  /** `true` = HTTPS (demo e produção): nome `__Secure-macuxi_rt` e atributo `Secure`. */
  seguro: boolean;
}

/** Padrão do `createApp`: seguro (falha fechada; o PC liga o modo local pela configuração). */
export const SESSAO_WEB_PADRAO: OpcoesSessaoWeb = { seguro: true };

export const CODIGO_CSRF_RECUSADO = 'CSRF_RECUSADO';
const MENSAGEM_CSRF = 'Pedido recusado por segurança. Atualize a página e entre de novo.';
/** Mesmo código do Core para refresh inválido (`CODIGOS_AUTH.sessao`): o BKO trata igual. */
const CODIGO_SESSAO = 'SESSAO_INVALIDA';
const MENSAGEM_SESSAO = 'Sua sessão expirou. Entre de novo com o código da empresa, o e-mail e a senha.';

export interface SessaoWebDaRequisicao {
  /** Corpo a validar: o do pedido, com o token do cookie em `refresh_token` (`renovar`/`encerrar`). */
  corpo: unknown;
  /** `encerrar` sem cookie: não há o que revogar; a rota responde sem chamar o módulo. */
  semCookie: boolean;
  /** Corpo da resposta de sucesso (sem o token) e os cabeçalhos do cookie. */
  aoSucesso(resultado: unknown): unknown;
  /** Erro da rota: apaga o cookie quando a sessão acabou. Não engole o erro. */
  aoErro(erro: unknown): void;
}

function statusDoErro(e: unknown): number | undefined {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

function semToken(resultado: Record<string, unknown>): Record<string, unknown> {
  const { [CAMPO_TOKEN_RENOVACAO]: _token, ...resto } = resultado;
  return resto;
}

/**
 * Prepara a rota pública para o modo cookie. `null` = rota sem `cookieSessao` ou chamada sem o cabeçalho (segue como sempre).
 * Lança 403 `CSRF_RECUSADO` (cabeçalho inválido ou outro site) e 401 `SESSAO_INVALIDA` (`renovar` sem cookie).
 */
export function prepararSessaoWeb(req: FastifyRequest, reply: FastifyReply, rota: CookieSessaoRota | undefined, opcoes: OpcoesSessaoWeb): SessaoWebDaRequisicao | null {
  if (!rota) return null;
  const modo = modoDaSessaoWeb(req.headers);
  if (modo === 'corpo') return null;
  reply.header('cache-control', 'no-store');
  if (modo === 'recusado') throw new ErroHttp(403, CODIGO_CSRF_RECUSADO, MENSAGEM_CSRF);

  const apagar = () => reply.header('set-cookie', cookieSessaoApagado(opcoes.seguro));
  const gravar = (token: string) => reply.header('set-cookie', montarCookieSessao(token, { seguro: opcoes.seguro, maxAgeSegundos: rota.validadeSegundos ?? 0 }));

  let corpo: unknown = req.body;
  let semCookie = false;
  if (rota.papel === 'renovar' || rota.papel === 'encerrar') {
    const token = lerCookie(req.headers.cookie, nomeDoCookieSessao(opcoes.seguro));
    if (!token) {
      apagar();
      if (rota.papel === 'renovar') throw new ErroHttp(401, CODIGO_SESSAO, MENSAGEM_SESSAO);
      semCookie = true;
    }
    // o token do cookie substitui qualquer `refresh_token` do corpo: no modo cookie só vale o cookie
    const base = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};
    corpo = token ? { ...base, [CAMPO_TOKEN_RENOVACAO]: token } : base;
  }

  return {
    corpo,
    semCookie,
    aoSucesso(resultado) {
      if (rota.papel === 'encerrar') {
        apagar();
        return resultado;
      }
      if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return resultado;
      const token = (resultado as Record<string, unknown>)[CAMPO_TOKEN_RENOVACAO];
      if (typeof token !== 'string') return resultado;
      gravar(token);
      return semToken(resultado as Record<string, unknown>);
    },
    aoErro(erro) {
      const status = statusDoErro(erro);
      if (rota.papel === 'encerrar' || (rota.papel === 'renovar' && (status === 401 || status === 423))) apagar();
    },
  };
}
