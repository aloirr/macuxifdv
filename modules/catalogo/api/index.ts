/**
 * API do Catálogo (`/v1/catalogo`). T-0029: provedores de pull de preço e a consulta `catalogo.precos_cliente@1`
 * (ADR 0012). T-0052: rotas de busca, vitrine, ficha, filtros e o BKO de conteúdo (`rotas.ts`), sobre o repositório
 * Postgres (`repositorio-postgres.ts`; tabelas da migração 0013 ligadas).
 * Provedor de IA da busca (opcional): `MACUXI_CATALOGO_IA_URL` (+ `MACUXI_CATALOGO_IA_CHAVE`, enviada como
 * `Authorization: Bearer`) no `.env`. Sem URL, a busca usa só as regras locais (sem aviso: não há IA a perder).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { consultaPrecosCliente } from './consultas';
import { consumidoresDoErp } from './consumidores-erp';
import { criarPortaInterpretacaoHttp } from './ia';
import { criarRepositorioPostgres } from './repositorio-postgres';
import { criarRotasCatalogo, type DependenciasRotas } from './rotas';
import { consultaSugestoesPedido } from './sugestoes';
import { provedoresSyncCatalogo } from './sync';

export { criarRotasCatalogo, type DependenciasRotas } from './rotas';
export { criarRepositorioMemoria, type DadosTenantMemoria, type FabricaRepositorio, type RepositorioCatalogo } from './repositorio';

/** Porta do LLM a partir do ambiente (segredo só do `.env`; nunca no código nem no log). */
export function portaIaDoAmbiente(env: Readonly<Record<string, string | undefined>> = process.env): DependenciasRotas['portaIa'] {
  const url = env.MACUXI_CATALOGO_IA_URL?.trim();
  if (!url) return () => null;
  const chave = env.MACUXI_CATALOGO_IA_CHAVE?.trim();
  return (timeoutMs) => criarPortaInterpretacaoHttp({ url, timeoutMs, ...(chave ? { cabecalhos: { authorization: `Bearer ${chave}` } } : {}) });
}

export function criarModuloApiCatalogo(dep: DependenciasRotas): ModuloApi {
  return definirModuloApi({ manifesto: manifest, rotas: criarRotasCatalogo(dep), sync: provedoresSyncCatalogo, consumidores: consumidoresDoErp, consultas: [consultaPrecosCliente, consultaSugestoesPedido] });
}

export const moduloApi: ModuloApi = criarModuloApiCatalogo({ repositorio: criarRepositorioPostgres(), portaIa: portaIaDoAmbiente() });
export default moduloApi;
