/**
 * API do módulo Core (`/v1/core/*`, `/v1/auth/*`) — ADR 0006. O `apps/api` monta `moduloApi` sem conhecer o Fastify.
 * - Serviços de plataforma (só o Core): `autenticar` (JWT + usuário ativo) e `carteira` (RN-CORE-04).
 * - Rotas públicas: `auth/login`, `auth/refresh`, `auth/logout`, com limite por IP + código da empresa.
 * - Rotas: licenças por tenant → perfil → usuário (admin). `GET /v1/me/modulos` é da plataforma (T-0004).
 * - Rotas da T-0017: `clientes`, `clientes/:id` (Cliente 360), `carteira`, `equipe/hierarquia`; aparelhos (RN-CORE-15).
 * - Sync (pull): `cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`.
 * Segredo do JWT: `MACUXI_JWT_SEGREDO` (mín. 32 caracteres); sem ele o login responde 503 e ninguém autentica (falha fechada).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import { LoginSenhaRequestSchema, LogoutRequestSchema, RefreshRequestSchema } from '../contracts';
import { manifest } from '../manifest';
import { criarAutenticacao, type DepsAutenticacao } from './autenticacao';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { rotasDeDispositivos } from './dispositivos';
import { rotasDeLicencas } from './licencas';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const CINCO_MINUTOS = 5 * 60_000;

export function criarModuloApiCore(deps: DepsAutenticacao): ModuloApi {
  const auth = criarAutenticacao(deps);
  return definirModuloApi({
    manifesto: manifest,
    rotas: [...rotasDeLicencas, ...rotasDeClientes, ...rotasDeDispositivos],
    sync: provedoresSyncCore,
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/login',
        // 5 tentativas / 5 min por IP + código da empresa (429 MUITAS_TENTATIVAS); o bloqueio por usuário é do domínio
        limite: { max: 5, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { codigo_empresa?: string } | null)?.codigo_empresa ?? '' },
        corpo: LoginSenhaRequestSchema,
        executar: (ctx) => auth.login(ctx),
      },
      {
        metodo: 'POST',
        caminho: 'auth/refresh',
        limite: { max: 30, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { refresh_token?: string } | null)?.refresh_token?.slice(0, 36) ?? '' },
        corpo: RefreshRequestSchema,
        executar: (ctx) => auth.refresh(ctx),
      },
      {
        metodo: 'POST',
        caminho: 'auth/logout',
        status: 200,
        limite: { max: 30, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { refresh_token?: string } | null)?.refresh_token?.slice(0, 36) ?? '' },
        corpo: LogoutRequestSchema,
        executar: (ctx) => auth.logout(ctx),
      },
    ],
    servicos: {
      autenticar: (cabecalhos, banco) => auth.autenticar(cabecalhos, banco),
      carteira: (usuario, banco) => carteiraDoUsuario(usuario, banco),
      usuariosVisiveis: (usuario, banco) => usuariosVisiveisDoUsuario(usuario, banco),
    },
  });
}

/** Instância de produção: o segredo vem do ambiente a cada uso. */
export const moduloApi = criarModuloApiCore({ segredo: () => process.env.MACUXI_JWT_SEGREDO });
export default moduloApi;

export { criarAutenticacao } from './autenticacao';
export type { Autenticacao } from './autenticacao';
