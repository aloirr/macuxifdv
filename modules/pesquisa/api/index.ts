/**
 * API do módulo Pesquisa (`/v1/pesquisa`; T-0057). Rotas declarativas; o `createApp` (apps/api) aplica autenticação,
 * licença do módulo, perfil/ação do manifesto, Zod e escopo de carteira em toda rota (CLAUDE.md regra 6). A regra de
 * negócio vive no domain e é revalidada aqui (regra 2).
 * Dados: atrás de `RepositorioPesquisa`. Hoje em memória (a migração 0016 do schema `pesquisa` ainda não está no
 * `main`; pedido ao banco-dados na T-0057) — troca pela implementação SQL sem mudar as rotas.
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { rotasDoConstrutor } from './construtor';
import type { FabricaRepositorio } from './repositorio';
import { criarRepositorioEmMemoria } from './repositorio-memoria';
import { rotasDeResultados } from './resultados';
import { provedoresSync } from './sync';

export type { FabricaRepositorio, RepositorioPesquisa } from './repositorio';
export { criarRepositorioEmMemoria } from './repositorio-memoria';

/** Monta a API da Pesquisa sobre um repositório (testes passam o seu). */
export function criarApiPesquisa(fabrica: FabricaRepositorio): ModuloApi {
  return definirModuloApi({
    manifesto: manifest,
    rotas: [...rotasDoConstrutor(fabrica), ...rotasDeResultados(fabrica)],
    sync: provedoresSync(fabrica),
  });
}

/** Repositório do processo até a migração 0016 (dados somem ao reiniciar a API). */
export const repositorioPadrao = criarRepositorioEmMemoria();

export const moduloApi: ModuloApi = criarApiPesquisa(repositorioPadrao);
export default moduloApi;
