/**
 * Chamadas do BKO "Frases do dia" (RN-CORE-41; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §2.1): `GET`,
 * `POST`, `PUT /:id`, `DELETE /:id` e `PUT /ordem` em `/v1/core/frases`, com os contratos da N-B. As rotas chegam na N-D.
 * `chamar` é o `api` do platform-sdk; os testes passam a API simulada.
 *
 * A lista vem como `{ itens }` (o envelope das listas do Core), cada item no `FraseDiaSyncSchema`. A "Frase de hoje" é
 * calculada aqui com o mesmo `fraseDoDia` do domain que o aparelho e a API usam: não depende de marca na resposta.
 */
import { api } from '@macuxi/platform-sdk/web';
import { z } from 'zod';
// `contracts/index.ts` ainda não reexporta `frases.ts` (a costura no PC faz isso); importa direto do arquivo do contrato.
import {
  FraseDiaCriarSchema,
  FraseDiaEditarSchema,
  FraseDiaSyncSchema,
  FrasesOrdemSchema,
  type FraseDiaCriar,
  type FraseDiaEditar,
  type FraseDiaSync,
} from '../../../contracts/frases';

export const CHAVE_FRASES = ['core', 'frases'] as const;

/** Vivas, na ordem do rodízio (ordem; empate pelo id, a mesma do `fraseDoDia`). */
export function ordenarFrases(frases: readonly FraseDiaSync[]): FraseDiaSync[] {
  return frases.filter((f) => !f.deleted_at).sort((a, b) => a.ordem - b.ordem || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function criarApiFrases(chamar: typeof api = api) {
  return {
    listar: async (): Promise<FraseDiaSync[]> => ordenarFrases(z.object({ itens: z.array(FraseDiaSyncSchema) }).parse(await chamar<unknown>('/core/frases')).itens),
    criar: async (corpo: FraseDiaCriar): Promise<void> => {
      await chamar<unknown>('/core/frases', { method: 'POST', body: FraseDiaCriarSchema.parse(corpo) });
    },
    editar: async (id: string, corpo: FraseDiaEditar): Promise<void> => {
      await chamar<unknown>(`/core/frases/${id}`, { method: 'PUT', body: FraseDiaEditarSchema.parse(corpo) });
    },
    remover: async (id: string): Promise<void> => {
      await chamar<unknown>(`/core/frases/${id}`, { method: 'DELETE' });
    },
    reordenar: async (ids: readonly string[]): Promise<void> => {
      await chamar<unknown>('/core/frases/ordem', { method: 'PUT', body: FrasesOrdemSchema.parse({ ids }) });
    },
  };
}
export type ApiFrases = ReturnType<typeof criarApiFrases>;
