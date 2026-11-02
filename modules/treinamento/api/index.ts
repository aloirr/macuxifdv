/**
 * API do Treinamento (`/v1/treinamento`; desenho T-0058, ADR 0006). Rotas declarativas: o `createApp` (apps/api) aplica
 * autenticação, licença do módulo, perfil pela ação do manifesto e validação; o escopo do dado é aplicado nas rotas.
 *
 * `criarApiTreinamento({ fabrica })` monta rotas + sync sobre um repositório (`repositorio.ts`). O `moduloApi` de
 * produção ainda NÃO tem fábrica: a migração do schema `treinamento` (0017) é do banco-dados e não está no main. Por isso
 * as rotas respondem 503 `TREINAMENTO_INDISPONIVEL` (depois de licença e perfil) e o sync não serve as entidades — o
 * aparelho guarda a fila (`SYNC_NAO_IMPLEMENTADO`, retentável) e nada se perde. Ligar o SQL = passar a fábrica aqui.
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import type { FabricaRepositorio } from './repositorio';
import { criarRotas } from './rotas';
import { criarProvedoresSync } from './sync';

export type { FabricaRepositorio, RepositorioTreinamento, UsuarioTreinamento } from './repositorio';

export function criarApiTreinamento(op: { fabrica?: FabricaRepositorio | null } = {}): ModuloApi {
  const fabrica = op.fabrica ?? null;
  return definirModuloApi({ manifesto: manifest, rotas: criarRotas(fabrica), ...(fabrica ? { sync: criarProvedoresSync(fabrica) } : {}) });
}

export const apiTreinamento: ModuloApi = criarApiTreinamento();
/** Convenção do desenho T-0004 §3; o `default` também é aceito pela API. */
export const moduloApi = apiTreinamento;
export default apiTreinamento;
