/**
 * Licença do TENANT para os módulos que mudam a fonte da positivação (RN-CORE-03/27): Integração ativa liga as notas do ERP e
 * Vendedor ativo manda o pedido (devolução não tira). Uma só consulta para o Início e o Farol não divergirem (R-20261105-114454 C3).
 * O Core é o dono do licenciamento (`licencas.ts`); a leitura é a de `tenant_modulo` com `ativo` e sem `deleted_at`.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';

export interface LicencaDoTenant {
  integracaoNoTenant: boolean;
  vendedorNoTenant: boolean;
}

export async function licencaDoTenant(db: ClienteBanco): Promise<LicencaDoTenant> {
  const lic = await db.query<{ modulo: string }>("select modulo from plataforma.tenant_modulo where modulo in ('integracao', 'vendedor') and ativo and deleted_at is null");
  return { integracaoNoTenant: lic.rows.some((r) => r.modulo === 'integracao'), vendedorNoTenant: lic.rows.some((r) => r.modulo === 'vendedor') };
}
