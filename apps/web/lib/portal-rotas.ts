/**
 * Caminhos que o portal `config.` chama (T-0087; desenho §4 e §5; confirmados pelo modulo-integracao em R-20261106-011153).
 * Todos relativos ao `/v1` da API (o navegador chama `/api-proxy<caminho>`, o proxy same-origin do Next). Um lugar só: se um
 * caminho mudar, muda aqui.
 */
import { ROTA_PORTAL_CNPJ, ROTA_PORTAL_EMPRESA_COM_PLANO, ROTA_PORTAL_PLANOS, rotaPortalAssinatura } from '@macuxi/platform-sdk';

/** As rotas do SDK vêm com o `/v1`; aqui os caminhos são relativos a ele. */
const semV1 = (rota: string): string => rota.replace(/^\/v1(?=\/)/, '');

export const ROTAS_PORTAL = {
  // Core: acesso ao portal só com e-mail e senha (T-0093; ADR 0031). `login` é pública; `empresa`, `renovar` e `sair` levam o token.
  login: '/plataforma/auth/login',
  /** Admin do cliente: escolhe ou troca de empresa (`EscolherEmpresaPortalSchema`); devolve uma sessão nova (token novo). */
  escolherEmpresa: '/plataforma/auth/empresa',
  renovar: '/plataforma/auth/renovar',
  sair: '/plataforma/auth/sair',
  // API da plataforma
  empresas: '/plataforma/empresas',
  /** T-0094 fatia S: admins da empresa (`ListaAdminsDaEmpresaSchema`); só o time da Macuxi. Tenant no caminho, sem `x-macuxi-tenant`. */
  adminsDaEmpresa: (tenantId: string) => `/plataforma/empresas/${encodeURIComponent(tenantId)}/admins`,
  /** Redefine a senha do admin (`RedefinirSenhaAdminSchema` → `RedefinirSenhaAdminRespostaSchema`); idempotente por `email_id`. */
  redefinirSenhaAdmin: (tenantId: string, usuarioId: string) =>
    `/plataforma/empresas/${encodeURIComponent(tenantId)}/admins/${encodeURIComponent(usuarioId)}/redefinir-senha`,
  /** T-0158 (ADR 0043): Portal › Diagnósticos, só o time da Macuxi (o admin do cliente recebe 403). Sem `x-macuxi-tenant`. */
  diagnosticos: '/plataforma/diagnosticos',
  diagnostico: (id: string) => `/plataforma/diagnosticos/${encodeURIComponent(id)}`,
  /** Bytes do print (JPEG), `private, no-store`; o portal abre como `Blob`. */
  printDoDiagnostico: (id: string) => `/plataforma/diagnosticos/${encodeURIComponent(id)}/print`,
  /** ADR 0046: planos e licenças (`ListaPlanosSchema`, `CriarEmpresaComPlanoSchema`, `FichaAssinaturaSchema`/`TrocarPlanoSchema`). */
  planos: semV1(ROTA_PORTAL_PLANOS),
  empresaComPlano: semV1(ROTA_PORTAL_EMPRESA_COM_PLANO),
  assinatura: (tenantId: string) => semV1(rotaPortalAssinatura(encodeURIComponent(tenantId))),
  /** ADR 0046: CNPJ na base pública da Receita (`ConsultaCnpjPedidoSchema` → `ConsultaCnpjRespostaSchema`); POST, CNPJ fora da URL. */
  cnpj: semV1(ROTA_PORTAL_CNPJ),
  // Integração (com `x-macuxi-tenant`)
  conectores: '/integracao/conectores',
  /** T-0098: link temporário (presign) do pacote do Conector on-premise; auditado na API. Ausente = indisponível. */
  conectorDownload: '/integracao/conector/download',
} as const;

/**
 * OpenAPI 3.1 do Hub (T-0092, ADR 0030): rota pública `GET /integracao/v1/openapi.json`, fora do `/v1` e sem token. O navegador
 * baixa pelo caminho same-origin abaixo, que o `next.config.ts` (`PROXY_OPENAPI_HUB`) repassa à API; teste em `portal.test.ts`.
 */
export const OPENAPI_HUB = Object.freeze({ rotaNaApi: '/integracao/v1/openapi.json', viaProxy: '/api-proxy/_publico/integracao/v1/openapi.json' });

/** Rotas públicas (sem token): só a entrada com e-mail e senha (T-0093: sem primeiro acesso, convite nem 2º passo). */
export const ROTAS_PUBLICAS_PORTAL: readonly string[] = [ROTAS_PORTAL.login];
