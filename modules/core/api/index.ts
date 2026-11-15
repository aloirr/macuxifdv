/**
 * API do módulo Core (`/v1/core/*`, `/v1/auth/*`) — ADR 0006. O `apps/api` monta `moduloApi` sem conhecer o Fastify.
 * - Serviços de plataforma (só o Core): `autenticar` (JWT + usuário ativo) e `carteira` (RN-CORE-04).
 * - Rotas públicas: `auth/login`, `auth/refresh`, `auth/logout`, `auth/senha/trocar` e `auth/senha/esqueci` (T-0094, ADR 0032), com limite por IP + código da empresa.
 * - Rotas: licenças por tenant → perfil → usuário (admin); usuários no BKO (`usuarios`, `equipes`; T-0067, escrita só admin). `GET /v1/me/modulos` é da plataforma (T-0004).
 * - Rotas da T-0017: `clientes`, `clientes/:id` (Cliente 360), `carteira`, `equipe/hierarquia`; aparelhos (RN-CORE-15).
 * - Rotas da T-0018: `rotas` (leitura/edição/copiar/gerar), `visitas`, `motivos`, `coordenadas-sugeridas`, `clientes/:id/coordenada`.
 * - Sync: pull de `cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`, `motivo`,
 *   `rota`, `rota_parada`, `visita`; push de `visita` e `visita_checkout`.
 * Segredo do JWT: `MACUXI_JWT_SEGREDO` (mín. 32 caracteres); sem ele o login responde 503 e ninguém autentica (falha fechada).
 */
import { definirModuloApi, definirTarefa, type ModuloApi } from '@macuxi/platform-sdk';
import { EscolherEmpresaPortalSchema, EsqueciSenhaRequestSchema, LoginPortalSchema, LoginSenhaRequestSchema, LogoutRequestSchema, RefreshRequestSchema, TrocarSenhaRequestSchema } from '../contracts';
import { REFRESH_DIAS } from '../domain/auth';
import { manifest } from '../manifest';
import { criarAutenticacao, type DepsAutenticacao } from './autenticacao';
import { criarSuperAdmin, type DepsSuperAdmin } from './super-admin';
import { carteiraDoUsuario } from './carteira';
import { rotasDeClientes } from './clientes';
import { rotasDeDispositivos } from './dispositivos';
import { provedoresDeNotificacao, rotasDeNotificacoes } from './notificacoes';
import { consultaCadastroCliente, consultaCadastroResumo, consultaCalendarioMetas, consultaFinanceiroCliente, consultaPromotorVePedidos, consultaUsuariosResumo } from './consultas';
import { consultaProdutividadeEquipe, registrarContatoDoAparelho } from './produtividade-equipe';
import { consumidorPushNotificacao } from './consumidores';
import { consumidoresDoErp } from './consumidores-erp';
import { consumidoresDePedido } from './consumidores-pedido';
import { consumidorMetaDefinida } from './consumidores-sistema';
import { rotasDeLicencas } from './licencas';
import { alertarPendenciasVencidas, consumidorBaixaPorResposta, rotasDePendenciaCheckout } from './etapas-pendencia';
import { consultaFiliais, rotasDeFiliais } from './filiais';
import { rotasDeFotosPdv } from './fotos-pdv';
import { consultaMedidas, rotasDeMedidas } from './medidas';
import { rotasDeFarol } from './farol';
import { rotasDePlanoRv } from './plano-rv';
import { rotasDeInicio } from './inicio';
import { rotasDeMetas } from './metas';
import { rotasDeProdutos } from './produtos';
import { rotasDePromotorPedidos } from './promotor-pedidos';
import { rotasDeParametrosInicio } from './parametros-inicio';
import { rotasDeParametrosAlertas } from './parametros-alertas';
import { rotasDeParametrosJornada } from './parametros-jornada';
import { rotasDeParametrosCurvaAbc } from './parametros-curvas-abc';
import { rotasDeAvatar } from './avatar';
import { rotasDeFrases } from './frases';
import { rotasDeMetasProdutividade } from './metas-produtividade';
import { rotasDePerformance } from './performance';
import { provedoresSyncT0170 } from './sync-t0170';
import { rotasDeTarefas } from './tarefas';
import { rotasDeRotasEVisitas } from './rotas';
import { rotasDeUsuarios } from './usuarios';
import { rotasDePerfis } from './perfis';
import { rotasDeEquipeCsv } from './equipe-csv';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const CINCO_MINUTOS = 5 * 60_000;

/** Segredo do portal (ADR 0031: o único), lido do ambiente a cada uso; sem ele as rotas `plataforma/auth/*` respondem 503. */
const depsPlataformaDoAmbiente: DepsSuperAdmin = {
  segredo: () => process.env.MACUXI_JWT_SEGREDO_PLATAFORMA,
};

export function criarModuloApiCore(deps: DepsAutenticacao, plataforma: DepsSuperAdmin = depsPlataformaDoAmbiente): ModuloApi {
  const auth = criarAutenticacao(deps);
  const sa = criarSuperAdmin(plataforma);
  return definirModuloApi({
    manifesto: manifest,
    rotas: [...rotasDeLicencas, ...rotasDeUsuarios, ...rotasDePerfis, ...rotasDeEquipeCsv, ...rotasDeClientes, ...rotasDeDispositivos, ...rotasDeRotasEVisitas, ...rotasDeMetas, ...rotasDeInicio, ...rotasDeProdutos, ...rotasDeMedidas, ...rotasDeFiliais, ...rotasDeFotosPdv, ...rotasDePromotorPedidos, ...rotasDeParametrosInicio, ...rotasDeParametrosAlertas, ...rotasDeParametrosJornada, ...rotasDeParametrosCurvaAbc, ...rotasDeFarol, ...rotasDePlanoRv, ...rotasDePendenciaCheckout, ...rotasDeNotificacoes, ...rotasDeTarefas, ...rotasDeFrases, ...rotasDeAvatar, ...rotasDeMetasProdutividade, ...rotasDePerformance],
    sync: [...provedoresSyncCore, ...provedoresDeNotificacao, ...provedoresSyncT0170],
    consumidores: [consumidorPushNotificacao, ...consumidoresDePedido, consumidorBaixaPorResposta, consumidorMetaDefinida, ...consumidoresDoErp],
    // ADR 0022: varredura do alerta de pendência de etapa do checkout (RN-CORE-12); período múltiplo de 15 min (RN-CORE-23).
    tarefas: [definirTarefa({ nome: 'alerta_pendencia_checkout', cadaMin: 60, executar: (ctx) => alertarPendenciasVencidas(ctx) })],
    consultas: [consultaCadastroResumo, consultaCadastroCliente, consultaFinanceiroCliente, consultaMedidas, consultaFiliais, consultaPromotorVePedidos, consultaUsuariosResumo, consultaCalendarioMetas, consultaProdutividadeEquipe],
    // T-0180 (ADR 0059 §5): último contato do aparelho, chamado pela API depois do novidades e do push (melhor esforço)
    // PENDÊNCIA T-0180: o tipo `ModuloApi.contatoDoAparelho` vem do branch do engenheiro-software (ainda fora do main); o spread isola
    // a propriedade para este branch compilar sozinho. Com o SDK no main, trocar por `contatoDoAparelho: registrarContatoDoAparelho,`.
    ...({ contatoDoAparelho: registrarContatoDoAparelho } satisfies Record<string, unknown>),
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/login',
        // T-0117 (ADR 0038): no modo cookie do BKO a plataforma troca o refresh_token do corpo por cookie httpOnly; o app segue com o corpo.
        cookieSessao: { papel: 'emitir', validadeSegundos: REFRESH_DIAS * 86_400 },
        // Teto geral contra abuso (conta tudo, inclusive acertos), folgado: atrás de túnel vários aparelhos dividem o IP.
        // O limite de FALHAS (10/5 min por IP + empresa + e-mail) está em `limite-login.ts` (T-0026).
        limite: { max: 300, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { codigo_empresa?: string } | null)?.codigo_empresa ?? '' },
        corpo: LoginSenhaRequestSchema,
        executar: (ctx) => auth.login(ctx),
      },
      {
        metodo: 'POST',
        caminho: 'auth/refresh',
        // T-0117 (ADR 0038): no modo cookie do BKO a plataforma troca o refresh_token do corpo por cookie httpOnly; o app segue com o corpo.
        cookieSessao: { papel: 'renovar', validadeSegundos: REFRESH_DIAS * 86_400 },
        limite: { max: 30, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { refresh_token?: string } | null)?.refresh_token?.slice(0, 36) ?? '' },
        corpo: RefreshRequestSchema,
        executar: (ctx) => auth.refresh(ctx),
      },
      {
        metodo: 'POST',
        caminho: 'auth/logout',
        // T-0117 (ADR 0038): no modo cookie do BKO a plataforma troca o refresh_token do corpo por cookie httpOnly; o app segue com o corpo.
        cookieSessao: { papel: 'encerrar' },
        status: 200,
        limite: { max: 30, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { refresh_token?: string } | null)?.refresh_token?.slice(0, 36) ?? '' },
        corpo: LogoutRequestSchema,
        executar: (ctx) => auth.logout(ctx),
      },
      // T-0094 (RN-CORE-32/34): "Crie sua senha" (troca obrigatória no 1º uso; devolve a sessão) e "Esqueci a senha" (202 sempre igual;
      // limite por e-mail e por IP dentro do módulo, além do teto geral da plataforma por IP)
      {
        metodo: 'POST',
        caminho: 'auth/senha/trocar',
        // T-0117 (ADR 0038): no modo cookie do BKO a plataforma troca o refresh_token do corpo por cookie httpOnly; o app segue com o corpo.
        cookieSessao: { papel: 'emitir', validadeSegundos: REFRESH_DIAS * 86_400 },
        limite: { max: 60, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { codigo_empresa?: string } | null)?.codigo_empresa ?? '' },
        corpo: TrocarSenhaRequestSchema,
        executar: (ctx) => auth.trocarSenha(ctx),
      },
      {
        metodo: 'POST',
        caminho: 'auth/senha/esqueci',
        status: 202,
        limite: { max: 60, janelaMs: CINCO_MINUTOS, chave: (e) => (e.corpo as { codigo_empresa?: string } | null)?.codigo_empresa ?? '' },
        corpo: EsqueciSenhaRequestSchema,
        executar: (ctx) => auth.esqueciSenha(ctx),
      },
      // T-0093 / ADR 0031: entrada no portal só com e-mail e senha (limite por IP: 10/5 min no login, 30/5 min na escolha da empresa)
      { metodo: 'POST', caminho: 'plataforma/auth/login', conexao: 'portal', limite: { max: 10, janelaMs: CINCO_MINUTOS }, corpo: LoginPortalSchema, executar: (ctx) => sa.login(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/empresa', conexao: 'portal', limite: { max: 30, janelaMs: CINCO_MINUTOS }, corpo: EscolherEmpresaPortalSchema, executar: (ctx) => sa.escolherEmpresa(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/renovar', conexao: 'portal', limite: { max: 10, janelaMs: CINCO_MINUTOS }, executar: (ctx) => sa.renovar(ctx) },
      { metodo: 'POST', caminho: 'plataforma/auth/sair', conexao: 'portal', status: 204, limite: { max: 10, janelaMs: CINCO_MINUTOS }, executar: (ctx) => sa.sair(ctx) },
    ],
    servicos: {
      autenticar: (cabecalhos, banco) => auth.autenticar(cabecalhos, banco),
      carteira: (usuario, banco, opcoes) => carteiraDoUsuario(usuario, banco, opcoes),
      usuariosVisiveis: (usuario, banco) => usuariosVisiveisDoUsuario(usuario, banco),
      autenticarPortal: (cabecalhos, banco) => sa.autenticarPortal(cabecalhos, banco),
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
export { gerarSenhaTemporaria } from '../domain/acesso-senha';
