/** Chamadas do BKO do parâmetro dos campos obrigatórios do pré-cadastro (RN-CORE-79) em `/v1/core/parametros/pre-cadastro`. */
import { api } from '@macuxi/platform-sdk/web';
import { ParametroPreCadastroPutSchema, ParametroPreCadastroSchema, type ParametroPreCadastro } from '../../../contracts';

export const CHAVE_PRE_CADASTRO = ['core', 'parametros', 'pre-cadastro'] as const;

export function criarApiPreCadastro(chamar: typeof api = api) {
  return {
    ler: async (): Promise<ParametroPreCadastro> => ParametroPreCadastroSchema.parse(await chamar<unknown>('/core/parametros/pre-cadastro')),
    gravar: async (p: ParametroPreCadastro): Promise<void> => {
      await chamar<unknown>('/core/parametros/pre-cadastro', { method: 'PUT', body: ParametroPreCadastroPutSchema.parse(p) });
    },
  };
}
export type ApiPreCadastro = ReturnType<typeof criarApiPreCadastro>;
