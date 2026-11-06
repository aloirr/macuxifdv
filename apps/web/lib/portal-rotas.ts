/**
 * Caminhos que o portal `config.` chama (T-0087; desenho §4 e §5; confirmados pelo modulo-integracao em R-20261106-011153).
 * Todos relativos ao `/v1` da API (o navegador chama `/api-proxy<caminho>`, o proxy same-origin do Next). Um lugar só: se um
 * caminho mudar, muda aqui.
 */
import type { Entidade } from '@macuxi/integracao/contracts';

export const ROTAS_PORTAL = {
  // Core (rotas públicas de autenticação do super-admin)
  primeiroAcesso: '/plataforma/auth/primeiro-acesso',
  login: '/plataforma/auth/login',
  totpIniciar: '/plataforma/auth/totp/iniciar',
  totpConfirmar: '/plataforma/auth/totp/confirmar',
  segundoFator: '/plataforma/auth/segundo-fator',
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
  // N1 (PR #97, nuvem): até o merge respondem 404 e o portal mostra "em breve"
  modeloCsv: (e: Entidade) => `/integracao/modelos/${e}.csv`,
  dicionario: (e: Entidade) => `/integracao/modelos/${e}.json`,
  // N2 (PR #99, nuvem)
  openapi: '/integracao/openapi.json',
} as const;

/** Rotas públicas (sem token): a 1ª e a 2ª etapa do login e o cadastro do TOTP (o desafio é a credencial). */
export const ROTAS_PUBLICAS_PORTAL: readonly string[] = [
  ROTAS_PORTAL.primeiroAcesso,
  ROTAS_PORTAL.login,
  ROTAS_PORTAL.totpIniciar,
  ROTAS_PORTAL.totpConfirmar,
  ROTAS_PORTAL.segundoFator,
];

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
