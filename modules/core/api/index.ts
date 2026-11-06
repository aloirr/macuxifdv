/**
 * API do módulo Core (`/v1/core/*`, `/v1/auth/*`) — ADR 0006. O `apps/api` monta `moduloApi` sem conhecer o Fastify.
 * - Serviços de plataforma (só o Core): `autenticar` (JWT + usuário ativo) e `carteira` (RN-CORE-04).
 * - Rotas públicas: `auth/login`, `auth/refresh`, `auth/logout`, com limite por IP + código da empresa.
 * - Rotas: licenças por tenant → perfil → usuário (admin); usuários no BKO (`usuarios`, `equipes`; T-0067, escrita só admin). `GET /v1/me/modulos` é da plataforma (T-0004).
 * - Rotas da T-0017: `clientes`, `clientes/:id` (Cliente 360), `carteira`, `equipe/hierarquia`; aparelhos (RN-CORE-15).
 * - Rotas da T-0018: `rotas` (leitura/edição/copiar/gerar), `visitas`, `motivos`, `coordenadas-sugeridas`, `clientes/:id/coordenada`.
 * - Sync: pull de `cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`, `motivo`,
 *   `rota`, `rota_parada`, `visita`; push de `visita` e `visita_checkout`.
 * Segredo do JWT: `MACUXI_JWT_SEGREDO` (mín. 32 caracteres); sem ele o login responde 503 e ninguém autentica (falha fechada).
 */
import { definirModuloApi, definirTarefa, type ModuloApi } from '@macuxi/platform-sdk';
import { AceitarConviteRequestSchema, DesafioSchema, LoginPlataformaSchema, LoginSenhaRequestSchema, LogoutRequestSchema, PrimeiroAcessoSchema, RefreshRequestSchema, RegerarRecuperacaoSchema, SegundoFatorSchema, TotpConfirmarSchema } from '../contracts';
import { manifest } from '../manifest';
import { criarAutenticacao, type DepsAutenticacao } from './autenticacao';
import { criarSuperAdmin, type DepsSuperAdmin } from './super-admin';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { rotasDeDispositivos } from './dispositivos';
import { provedoresDeNotificacao, rotasDeNotificacoes } from './notificacoes';
import { consultaCadastroCliente, consultaCadastroResumo, consultaPromotorVePedidos, consultaUsuariosResumo } from './consultas';
import { consumidorPushNotificacao } from './consumidores';
import { consumidoresDoErp } from './consumidores-erp';
import { consumidoresDePedido } from './consumidores-pedido';
import { consumidorMetaDefinida } from './consumidores-sistema';
import { rotasDeLicencas } from './licencas';
import { alertarPendenciasVencidas, consumidorBaixaPorResposta, rotasDePendenciaCheckout } from './etapas-pendencia';
import { consultaMedidas, rotasDeMedidas } from './medidas';
import { rotasDeFarol } from './farol';
import { rotasDePlanoRv } from './plano-rv';
import { rotasDeInicio } from './inicio';
import { rotasDeMetas } from './metas';
import { rotasDeProdutos } from './produtos';
import { rotasDePromotorPedidos } from './promotor-pedidos';
import { rotasDeParametrosInicio } from './parametros-inicio';
import { rotasDeRotasEVisitas } from './rotas';
import { rotasDeUsuarios } from './usuarios';
import { rotasDeEquipeCsv } from './equipe-csv';
import { aceitarConvite } from './convite-aceite';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const CINCO_MINUTOS = 5 * 60_000;
const QUINZE_MINUTOS = 15 * 60_000;

/** Segredos do portal (ADR 0029), lidos do ambiente a cada uso; sem eles as rotas `plataforma/auth/*` respondem 503. */
const depsPlataformaDoAmbiente: DepsSuperAdmin = {
  segredo: () => process.env.MACUXI_JWT_SEGREDO_PLATAFORMA,
  chaveTotp: () => process.env.MACUXI_CHAVE_TOTP,
  convite: () => process.env.MACUXI_SUPERADMIN_CONVITE,
};

export function criarModuloApiCore(deps: DepsAutenticacao, plataforma: DepsSuperAdmin = depsPlataformaDoAmbiente): ModuloApi {
  const auth = criarAutenticacao(deps);
  const sa = criarSuperAdmin(plataforma);
  return definirModuloApi({
    manifesto: manifest,
    rotas: [...rotasDeLicencas, ...rotasDeUsuarios, ...rotasDeEquipeCsv, ...rotasDeClientes, ...rotasDeDispositivos, ...rotasDeRotasEVisitas, ...rotasDeMetas, ...rotasDeInicio, ...rotasDeProdutos, ...rotasDeMedidas, ...rotasDePromotorPedidos, ...rotasDeParametrosInicio, ...rotasDeFarol, ...rotasDePlanoRv, ...rotasDePendenciaCheckout, ...rotasDeNotificacoes],
    sync: [...provedoresSyncCore, ...provedoresDeNotificacao],
    consumidores: [consumidorPushNotificacao, ...consumidoresDePedido, consumidorBaixaPorResposta, consumidorMetaDefinida, ...consumidoresDoErp],
    // ADR 0022: varredura do alerta de pendência de etapa do checkout (RN-CORE-12); período múltiplo de 15 min (RN-CORE-23).
    tarefas: [definirTarefa({ nome: 'alerta_pendencia_checkout', cadaMin: 60, executar: (ctx) => alertarPendenciasVencidas(ctx) })],
    consultas: [consultaCadastroResumo, consultaCadastroCliente, consultaMedidas, consultaPromotorVePedidos, consultaUsuariosResumo],
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/login',
        // Teto geral contra abuso (conta tudo, inclusive acertos), folgado: atrás de túnel vários aparelhos dividem o IP.
        // O limite de FALHAS (10/5 min por IP + empresa + e-mail) está em `limite-login.ts` (T-0026).
        limite: { max: 300, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { codigo_empresa?: string } | null)?.codigo_empresa ?? '' },
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
      // T-0087 (fatia E, RN-CORE-31): aceite do convite de 1º acesso; token de uso único no corpo, limite por IP
      { metodo: 'POST', caminho: 'auth/convite/aceitar', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: AceitarConviteRequestSchema, executar: (ctx) => aceitarConvite(ctx) },
      // T-0087 / ADR 0029: identidade do super-admin de plataforma (limite por IP: 5/15 min no primeiro acesso, 10/5 min no resto)
      { metodo: 'POST', caminho: 'plataforma/auth/primeiro-acesso', limite: { max: 5, janelaMs: QUINZE_MINUTOS }, corpo: PrimeiroAcessoSchema, executar: (ctx) => sa.primeiroAcesso(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/login', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: LoginPlataformaSchema, executar: (ctx) => sa.login(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/totp/iniciar', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: DesafioSchema, executar: (ctx) => sa.totpIniciar(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/totp/confirmar', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: TotpConfirmarSchema, executar: (ctx) => sa.totpConfirmar(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/segundo-fator', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: SegundoFatorSchema, executar: (ctx) => sa.segundoFator(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/renovar', limite: { max: 10, janelaMs: CINCO_MINUTOS }, executar: (ctx) => sa.renovar(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/sair', status: 204, limite: { max: 10, janelaMs: CINCO_MINUTOS }, executar: (ctx) => sa.sair(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/recuperacao/regerar', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: RegerarRecuperacaoSchema, executar: (ctx) => sa.regerarRecuperacao(ctx) },
    ],
    servicos: {
      autenticar: (cabecalhos, banco) => auth.autenticar(cabecalhos, banco),
      carteira: (usuario, banco, opcoes) => carteiraDoUsuario(usuario, banco, opcoes),
      usuariosVisiveis: (usuario, banco) => usuariosVisiveisDoUsuario(usuario, banco),
      autenticarSuperAdmin: (cabecalhos, banco) => sa.autenticarSuperAdmin(cabecalhos, banco),
    },
  });
}

/** Instância de produção: o segredo vem do ambiente a cada uso. */
export const moduloApi = criarModuloApiCore({ segredo: () => process.env.MACUXI_JWT_SEGREDO });
export default moduloApi;

export { criarAutenticacao } from './autenticacao';
export type { Autenticacao } from './autenticacao';
/** T-0083 (RN-CORE-31): política do admin inicial, lida pelo comando `pnpm tenant:criar` (a fronteira não deixa o shell importar o domain). */
export { normalizarEmail, validarSenhaInicial } from '../domain/usuarios';
