/**
 * API do módulo Pesquisa (`/v1/pesquisa`; T-0057). Rotas declarativas; o `createApp` (apps/api) aplica autenticação,
 * licença do módulo, perfil/ação do manifesto, Zod e escopo de carteira em toda rota (CLAUDE.md regra 6). A regra de
 * negócio vive no domain e é revalidada aqui (regra 2).
 * Dados: atrás de `RepositorioPesquisa`. A API em produção usa o Postgres (`repositorio-postgres.ts`, schema `pesquisa`
 * da migração 0016, RLS por tenant), como o Catálogo; o repositório em memória fica só para os testes de unidade
 * (`criarApiPesquisa(criarRepositorioEmMemoria())`).
 */
import { definirModuloApi, type ModuloApi } from '@macuxi/platform-sdk';
import manifest from '../manifest';
import { criarConsultaEtapasCheckout } from './consulta-etapas-checkout';
import { criarConsultaQuestionariosParaTarefa } from './consulta-questionarios-para-tarefa';
import { criarConsultaRespostaLocalApi } from './consulta-resposta-local';
import { rotasDoConstrutor } from './construtor';
import type { FabricaRepositorio } from './repositorio';
import { criarRepositorioPostgres } from './repositorio-postgres';
import { rotasDeResultados } from './resultados';
import { provedoresSync } from './sync';

export type { FabricaRepositorio, RepositorioPesquisa } from './repositorio';
export { criarRepositorioEmMemoria } from './repositorio-memoria';
export { criarRepositorioPostgres, traduzirErroBanco } from './repositorio-postgres';

/** Monta a API da Pesquisa sobre um repositório (os testes passam o seu). */
export function criarApiPesquisa(fabrica: FabricaRepositorio): ModuloApi {
  return definirModuloApi({
    manifesto: manifest,
    rotas: [...rotasDoConstrutor(fabrica), ...rotasDeResultados(fabrica)],
    sync: provedoresSync(fabrica),
    consultas: [criarConsultaEtapasCheckout(fabrica), criarConsultaQuestionariosParaTarefa(fabrica), criarConsultaRespostaLocalApi(fabrica)],
  });
}

export const moduloApi: ModuloApi = criarApiPesquisa(criarRepositorioPostgres());
export default moduloApi;
