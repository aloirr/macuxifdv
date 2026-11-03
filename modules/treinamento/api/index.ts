/**
 * API do Treinamento (`/v1/treinamento`; desenho T-0058, ADR 0006). Rotas declarativas: o `createApp` (apps/api) aplica
 * autenticação, licença do módulo, perfil pela ação do manifesto e validação; o escopo do dado é aplicado nas rotas.
 *
 * `criarApiTreinamento({ fabrica })` monta rotas + sync sobre um repositório (`repositorio.ts`). O `moduloApi` de
 * produção usa a fábrica SQL (`repositorio-postgres.ts`, schema `treinamento`, migração 0017): tudo dentro de
 * `ctx.comTenant` (RLS). Sem fábrica (`criarApiTreinamento()`), as rotas respondem 503 `TREINAMENTO_INDISPONIVEL`
 * (depois de licença e perfil) e o sync não serve as entidades — o aparelho guarda a fila e nada se perde.
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import type { FabricaRepositorio } from './repositorio';
import { criarFabricaPostgres } from './repositorio-postgres';
import { criarRotas } from './rotas';
import { criarProvedoresSync } from './sync';

export type { FabricaRepositorio, RepositorioTreinamento, UsuarioTreinamento } from './repositorio';
export { criarFabricaPostgres, usuariosPeloCadastroResumo, type FonteDeUsuarios } from './repositorio-postgres';

export function criarApiTreinamento(op: { fabrica?: FabricaRepositorio | null } = {}): ModuloApi {
  const fabrica = op.fabrica ?? null;
  return definirModuloApi({ manifesto: manifest, rotas: criarRotas(fabrica), ...(fabrica ? { sync: criarProvedoresSync(fabrica) } : {}) });
}

/** Produção: repositório SQL (a fábrica não abre conexão; usa o `ClienteBanco` da transação do tenant). */
export const apiTreinamento: ModuloApi = criarApiTreinamento({ fabrica: criarFabricaPostgres() });
/** Convenção do desenho T-0004 §3; o `default` também é aceito pela API. */
export const moduloApi = apiTreinamento;
export default apiTreinamento;
