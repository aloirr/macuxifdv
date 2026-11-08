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
  // Integração (com `x-macuxi-tenant`)
  ordemCarga: '/integracao/ordem-carga',
  cargaArquivo: '/integracao/cargas-arquivo',
  conferirArquivo: '/integracao/cargas-arquivo/conferir',
  sessaoArquivo: (sessaoId: string) => `/integracao/cargas-arquivo/sessoes/${encodeURIComponent(sessaoId)}`,
  lote: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}`,
  errosLote: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}/erros`,
  errosLoteCsv: (id: string) => `/integracao/lotes/${encodeURIComponent(id)}/erros.csv`,
  conectores: '/integracao/conectores',
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

/**
 * Download do pacote do Conector on-premise (ADR 0013). Ainda sem endereço publicado: `null` mostra "em breve" na aba
 * Integração (pendência registrada na entrega da T-0087).
 */
export const LINK_DOWNLOAD_CONECTOR: string | null = null;

/** Identificador do Conector tipo arquivo que o portal cria na primeira importação (R-20261106-011153). */
export const CONECTOR_ARQUIVO_PORTAL = Object.freeze({
  conector_id: 'implantacao-csv',
  nome: 'Carga por arquivo (implantação)',
  tipo: 'arquivo' as const,
  recebe_pedidos: false,
});
