/**
 * API do módulo Gestor (`/v1/gestor`, T-0055). Rotas declarativas (rotas.ts): o `createApp` aplica login, licença do
 * Gestor, perfil (ação do manifesto ou `perfis`) e Zod; o escopo (RN-CORE-04) é aplicado aqui pelo domain.
 * Consumidores (consumidores.ts) alimentam a projeção com os eventos de `consome`.
 * Persistência: repositório em MEMÓRIA até a migração do schema `gestor` (banco-dados) chegar ao main; a troca é só
 * a fábrica abaixo (rotas e consumidores recebem a interface `RepositorioGestor`).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { criarConsumidoresGestor } from './consumidores';
import { criarRepositorioEmMemoria, type RepositorioGestor } from './repositorio';
import { criarRotasGestor, PERFIS_LEITURA } from './rotas';

export { criarConsumidoresGestor, criarRepositorioEmMemoria, criarRotasGestor, PERFIS_LEITURA };
export type { RepositorioGestor };

/** Monta a API do Gestor sobre um repositório (testes usam um repositório próprio). */
export function criarApiGestor(repo: RepositorioGestor): ModuloApi {
  return definirModuloApi({ manifesto: manifest, rotas: criarRotasGestor(repo), consumidores: criarConsumidoresGestor(repo) });
}

/** Repositório do processo (memória; ver acima). */
export const repositorioGestor: RepositorioGestor = criarRepositorioEmMemoria();

export const apiGestor: ModuloApi = criarApiGestor(repositorioGestor);
/** Convenção do desenho T-0004 §3; o `default` também é aceito pela API. */
export const moduloApi = apiGestor;
export default apiGestor;
