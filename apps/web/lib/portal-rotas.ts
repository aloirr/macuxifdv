/**
 * Caminhos que o portal `config.` chama (T-0087; desenho §4 e §5; confirmados pelo modulo-integracao em R-20261106-011153).
 * Todos relativos ao `/v1` da API (o navegador chama `/api-proxy<caminho>`, o proxy same-origin do Next). Um lugar só: se um
 * caminho mudar, muda aqui.
 */
import { rotaLogoEmpresa, rotaMarcaEmpresa, rotaOcultarMarcaMacuxi, ROTA_PORTAL_FRASES_CARGA } from '@macuxi/platform-sdk';

/** Caminho do SDK (`/v1/...`) relativo ao `/v1`, como o portal e o `api()` do BKO chamam. */
export const semV1 = (caminho: string) => caminho.replace(/^\/v1(?=\/)/, '');

/** T-0181: a rota das frases vem do SDK (com o `/v1`). */
const FRASES_CARGA = semV1(ROTA_PORTAL_FRASES_CARGA);

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
  /** T-0181: frases da tela de carga do app, só o time da Macuxi (o admin do cliente recebe 403). Sem DELETE. */
  frasesCarga: FRASES_CARGA,
  fraseCarga: (id: string) => `${FRASES_CARGA}/${encodeURIComponent(id)}`,
  /**
   * T-0182: nome fantasia e resumo da logo (`MarcaEmpresaSchema`; `PUT` com `GravarNomeFantasiaSchema`). Logo: `GET` (bytes),
   * `PUT` (bytes crus PNG/JPEG) e `DELETE`. Ler: time da Macuxi e admin do cliente (a própria); gravar: só o time da Macuxi.
   */
  marcaDaEmpresa: (tenantId: string) => semV1(rotaMarcaEmpresa(encodeURIComponent(tenantId))),
  logoDaEmpresa: (tenantId: string) => semV1(rotaLogoEmpresa(encodeURIComponent(tenantId))),
  /** Item 15 (v1.0.17): `PUT { ocultar }` oculta a logomarca do Macuxi no app e no BKO; só o time da Macuxi; responde a marca. */
  ocultarMarcaMacuxi: (tenantId: string) => semV1(rotaOcultarMarcaMacuxi(encodeURIComponent(tenantId))),
  // Integração (com `x-macuxi-tenant`)
  ordemCarga: '/integracao/ordem-carga',
  conectores: '/integracao/conectores',
  /** T-0098: link temporário (presign) do pacote do Conector on-premise; auditado na API. Ausente = 'em breve'. */
  conectorDownload: '/integracao/conector/download',
  /** T-0190: link temporário do APK do Campo ou do Gestão (`{ variante }`); auditado na API. Só admin e super-admin. */
  appDownload: '/core/apps/download',
} as const;

/**
 * OpenAPI 3.1 do Hub (T-0092, ADR 0030): rota pública `GET /integracao/v1/openapi.json`, fora do `/v1` e sem token. O navegador
 * baixa pelo caminho same-origin abaixo, que o `next.config.ts` (`PROXY_OPENAPI_HUB`) repassa à API; teste em `portal.test.ts`.
 */
export const OPENAPI_HUB = Object.freeze({ rotaNaApi: '/integracao/v1/openapi.json', viaProxy: '/api-proxy/_publico/integracao/v1/openapi.json' });

/** Rotas públicas (sem token): só a entrada com e-mail e senha (T-0093: sem primeiro acesso, convite nem 2º passo). */
export const ROTAS_PUBLICAS_PORTAL: readonly string[] = [ROTAS_PORTAL.login];

/**
 * Identificador do antigo Conector de arquivo do portal (R-20261106-011153). A carga por arquivo saiu do `config.` (v1.0.21; spec
 * portal-config-enxuto §10); fica só o identificador que `aba-integracao.tsx` ainda lê, até ela deixar de ler. Depois, apagar.
 */
export const CONECTOR_ARQUIVO_PORTAL = Object.freeze({ conector_id: 'implantacao-csv' });
