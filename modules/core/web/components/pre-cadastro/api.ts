/**
 * Chamadas do BKO do pré-cadastro (v1.0.30; RN-CORE-16, RN-CORE-78 e RN-CORE-79; ADR 0069 §6 e §7): a lista única de campos
 * obrigatórios (`/v1/core/parametros/campos-obrigatorios`) e os recusados (lista, histórico, revisão atual e o reenvio).
 * Tudo validado pelos contratos na ida e na volta.
 */
import { api } from '@macuxi/platform-sdk/web';
import {
  CorrecaoPreCadastroSchema,
  HistoricoPreCadastroSchema,
  ParametroCamposObrigatoriosClienteSchema,
  PreCadastroAtualSchema,
  PreCadastroClienteSaidaSchema,
  RecusadosSaidaSchema,
  type CorrecaoPreCadastro,
  type HistoricoPreCadastro,
  type ParametroCamposObrigatoriosCliente,
  type PreCadastroAtual,
  type PreCadastroClienteSaida,
  type RecusadosSaida,
  type SituacaoRecusado,
} from '../../../contracts';

export const CHAVE_CAMPOS_OBRIGATORIOS = ['core', 'parametros', 'campos-obrigatorios'] as const;
export const CHAVE_RECUSADOS = ['core', 'pre-cadastro', 'recusados'] as const;

const CAMINHO_CAMPOS = '/core/parametros/campos-obrigatorios';

export function criarApiCamposObrigatorios(chamar: typeof api = api) {
  return {
    ler: async (): Promise<ParametroCamposObrigatoriosCliente> => ParametroCamposObrigatoriosClienteSchema.parse(await chamar<unknown>(CAMINHO_CAMPOS)),
    gravar: async (p: ParametroCamposObrigatoriosCliente): Promise<void> => {
      await chamar<unknown>(CAMINHO_CAMPOS, { method: 'PUT', body: ParametroCamposObrigatoriosClienteSchema.parse(p) });
    },
  };
}
export type ApiCamposObrigatorios = ReturnType<typeof criarApiCamposObrigatorios>;

const caminhoDoCliente = (id: string) => `/core/clientes/${encodeURIComponent(id)}/pre-cadastro`;

export function criarApiRecusados(chamar: typeof api = api) {
  return {
    listar: async (f: { situacao: SituacaoRecusado; busca?: string; cursor?: string; limite?: number }, signal?: AbortSignal): Promise<RecusadosSaida> =>
      RecusadosSaidaSchema.parse(
        await chamar<unknown>('/core/clientes/pre-cadastro/recusados', {
          query: { situacao: f.situacao, busca: f.busca || undefined, cursor: f.cursor || undefined, limite: f.limite },
          signal,
        }),
      ),
    historico: async (id: string): Promise<HistoricoPreCadastro> => HistoricoPreCadastroSchema.parse(await chamar<unknown>(`${caminhoDoCliente(id)}/historico`)),
    atual: async (id: string): Promise<PreCadastroAtual> => PreCadastroAtualSchema.parse(await chamar<unknown>(caminhoDoCliente(id))),
    reenviar: async (id: string, corpo: CorrecaoPreCadastro): Promise<PreCadastroClienteSaida> =>
      PreCadastroClienteSaidaSchema.parse(await chamar<unknown>(caminhoDoCliente(id), { method: 'PUT', body: CorrecaoPreCadastroSchema.parse(corpo) })),
  };
}
export type ApiRecusados = ReturnType<typeof criarApiRecusados>;
