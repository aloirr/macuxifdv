/**
 * Caminhos que o portal `config.` chama (T-0087; desenho §4 e §5; confirmados pelo modulo-integracao em R-20261106-011153).
 * Todos relativos ao `/v1` da API (o navegador chama `/api-proxy<caminho>`, o proxy same-origin do Next). Um lugar só: se um
 * caminho mudar, muda aqui.
 */
import type { Entidade } from '@macuxi/integracao/contracts';

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
  frasesCarga: '/plataforma/frases-carga',
  fraseCarga: (id: string) => `/plataforma/frases-carga/${encodeURIComponent(id)}`,
  // Integração (com `x-macuxi-tenant`)
  ordemCarga: '/integracao/ordem-carga',
  cargaArquivo: '/integracao/cargas-arquivo',
  conferirArquivo: '/integracao/cargas-arquivo/conferir',
  sessaoArquivo: (sessaoId: string) => `/integracao/cargas-arquivo/sessoes/${encodeURIComponent(sessaoId)}`,
  lote: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}`,
  errosLote: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}/erros`,
  errosLoteCsv: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}/erros.csv`,
  conectores: '/integracao/conectores',
  /** T-0098: link temporário (presign) do pacote do Conector on-premise; auditado na API. Ausente = 'em breve'. */
  conectorDownload: '/integracao/conector/download',
  // Core: Equipe por CSV (T-0087 fatia E, R-20261106-041540; com `x-macuxi-tenant`); sem convite desde a T-0094
  equipeModeloCsv: '/core/equipe/modelo.csv',
  equipeImportacoes: '/core/equipe/importacoes',
  // N1 (PR #97, nuvem): até o merge respondem 404 e o portal mostra "em breve"
  modeloCsv: (e: Entidade) => `/integracao/modelos/${e}.csv`,
  dicionario: (e: Entidade) => `/integracao/modelos/${e}.json`,
} as const;

/**
 * OpenAPI 3.1 do Hub (T-0092, ADR 0030): rota pública `GET /integracao/v1/openapi.json`, fora do `/v1` e sem token. O navegador
 * baixa pelo caminho same-origin abaixo, que o `next.config.ts` (`PROXY_OPENAPI_HUB`) repassa à API; teste em `portal.test.ts`.
 */
export const OPENAPI_HUB = Object.freeze({ rotaNaApi: '/integracao/v1/openapi.json', viaProxy: '/api-proxy/_publico/integracao/v1/openapi.json' });

/** Rotas públicas (sem token): só a entrada com e-mail e senha (T-0093: sem primeiro acesso, convite nem 2º passo). */
export const ROTAS_PUBLICAS_PORTAL: readonly string[] = [ROTAS_PORTAL.login];

/** Identificador do Conector tipo arquivo que o portal cria na primeira importação (R-20261106-011153). */
export const CONECTOR_ARQUIVO_PORTAL = Object.freeze({
  conector_id: 'implantacao-csv',
  nome: 'Carga por arquivo (implantação)',
  tipo: 'arquivo' as const,
  recebe_pedidos: false,
});
