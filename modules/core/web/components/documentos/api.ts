/**
 * Chamadas do BKO › Parâmetros › Documentos (T-0186): `GET` e `PUT /v1/core/documentos/permissoes` e `PUT /v1/core/documentos/excecoes`
 * (ação `documento.permissoes`, só admin), mais a lista de perfis e a busca de cliente e de documento para "Adicionar exceção".
 */
import { api, ApiRequestError } from '@macuxi/platform-sdk/web';
import {
  ClienteListaRespostaSchema, DocumentoPermissoesRespostaSchema, DocumentosRespostaSchema, PerfilListaRespostaSchema,
  type DocumentoExcecaoPut, type DocumentoPermissoesPut, type DocumentoPermissoesResposta,
} from '../../../contracts';
import { colunasDePerfil, type ColunaPerfil } from '../../lib/documentos-permissoes';

export const CHAVE_DOCUMENTOS = ['core', 'documentos', 'permissoes'] as const;

export function criarApiDocumentos(chamar: typeof api = api) {
  return {
    ler: async (): Promise<DocumentoPermissoesResposta> => DocumentoPermissoesRespostaSchema.parse(await chamar<unknown>('/core/documentos/permissoes')),
    salvarMatriz: async (corpo: DocumentoPermissoesPut): Promise<DocumentoPermissoesResposta> =>
      DocumentoPermissoesRespostaSchema.parse(await chamar<unknown>('/core/documentos/permissoes', { method: 'PUT', body: corpo })),
    salvarExcecao: async (corpo: DocumentoExcecaoPut): Promise<void> => {
      await chamar<unknown>('/core/documentos/excecoes', { method: 'PUT', body: corpo });
    },
    colunas: async (): Promise<ColunaPerfil[]> => colunasDePerfil(PerfilListaRespostaSchema.parse(await chamar<unknown>('/core/perfis')).itens),
    buscarClientes: async (q: string) => ClienteListaRespostaSchema.parse(await chamar<unknown>('/core/clientes', { query: { q, limite: 8 } })).itens,
    documentosDoCliente: async (clienteId: string) => DocumentosRespostaSchema.parse(await chamar<unknown>(`/core/clientes/${clienteId}/documentos`)).itens,
  };
}

/** O texto do erro é o da API (já em português, com a ação seguinte); sem resposta dela, só a falha de conexão. */
export function textoDoErro(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return 'Não foi possível salvar. Confira a conexão e tente de novo.';
}
