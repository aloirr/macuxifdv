/**
 * Apoio dos testes de API da T-0186 (Cliente 360 v2): as URLs das rotas novas do Core (`ROTAS_CLIENTE360_V2`, com o prefixo
 * `/v1/core/`) e os ids da fixture dois-tenants (DOCUMENTOS_FIXTURE, nota de faturamento de cada tenant).
 */
import { ROTAS_CLIENTE360_V2 } from '@macuxi/core/contracts';
import { DOCUMENTOS_FIXTURE } from '../../../db/seeds/fixtures/dois-tenants';

export { DOCUMENTOS_FIXTURE };

const url = (caminho: string, params: Record<string, string> = {}) => `/v1/core/${Object.entries(params).reduce((c, [k, v]) => c.replace(`:${k}`, v), caminho)}`;

/** As 7 rotas novas (método e URL), para um cliente, uma nota e um documento. */
export function rotas360(e: { cliente: string; nota: string; documento: string }) {
  return {
    notas: { method: 'GET' as const, url: url(ROTAS_CLIENTE360_V2.notas, { id: e.cliente }) },
    nota: { method: 'GET' as const, url: url(ROTAS_CLIENTE360_V2.nota, { id: e.cliente, nota_id: e.nota }) },
    documentos: { method: 'GET' as const, url: url(ROTAS_CLIENTE360_V2.documentos, { id: e.cliente }) },
    documento: { method: 'GET' as const, url: url(ROTAS_CLIENTE360_V2.documento, { id: e.cliente, documento_id: e.documento }) },
    permissoes: { method: 'GET' as const, url: url(ROTAS_CLIENTE360_V2.documentosPermissoes) },
    gravarPermissoes: { method: 'PUT' as const, url: url(ROTAS_CLIENTE360_V2.documentosPermissoes) },
    gravarExcecao: { method: 'PUT' as const, url: url(ROTAS_CLIENTE360_V2.documentosExcecoes) },
  };
}
