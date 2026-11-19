/**
 * Chamadas do BKO do rastreamento (T-0156; RN-CORE-13): parâmetro e ausências em `/v1/core`, com os contratos de `trajeto.ts`.
 * `chamar` é o `api` do platform-sdk; os testes passam a API simulada.
 */
import { api } from '@macuxi/platform-sdk/web';
import {
  AusenciaListaRespostaSchema,
  AusenciaUsuarioSchema,
  ParametrosRastreamentoSchema,
  type AusenciaUsuario,
  type AusenciaUsuarioEntrada,
  type ParametrosRastreamento,
} from '../../../contracts';

export const CHAVE_RASTREAMENTO = ['core', 'parametros', 'rastreamento'] as const;
export const CHAVE_AUSENCIAS = ['core', 'ausencias'] as const;

export function criarApiRastreamento(chamar: typeof api = api) {
  return {
    ler: async (): Promise<ParametrosRastreamento> => ParametrosRastreamentoSchema.parse(await chamar<unknown>('/core/parametros/rastreamento')),
    gravar: async (p: ParametrosRastreamento): Promise<void> => {
      await chamar<unknown>('/core/parametros/rastreamento', { method: 'PUT', body: ParametrosRastreamentoSchema.parse(p) });
    },
    ausencias: async (usuarioId?: string): Promise<AusenciaUsuario[]> =>
      AusenciaListaRespostaSchema.parse(await chamar<unknown>('/core/ausencias', { query: usuarioId ? { usuario_id: usuarioId } : {} })).ausencias,
    cadastrarAusencia: async (e: AusenciaUsuarioEntrada): Promise<AusenciaUsuario> => AusenciaUsuarioSchema.parse(await chamar<unknown>('/core/ausencias', { method: 'POST', body: e })),
    cancelarAusencia: async (id: string): Promise<void> => {
      await chamar<unknown>(`/core/ausencias/${id}`, { method: 'DELETE' });
    },
  };
}
export type ApiRastreamento = ReturnType<typeof criarApiRastreamento>;
