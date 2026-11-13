/**
 * Chamadas da aba Metas e RV › Produtividade (RN-CORE-45; desenho `docs/desenho/performance-produtividade.md` §7.3), com os
 * contratos da N-A: `GET /v1/core/metas-produtividade` (as linhas vivas do tenant, `MetaProdutividadeSchema`, no envelope
 * `{ itens }` das listas do Core), `PUT` em lote (`MetasProdutividadePutSchema`) e `DELETE /:id` ("voltar a herdar"). As rotas
 * chegam na N-D. A tela resolve "Vale hoje" com o mesmo `metasProdutividadeVigentes` do domain, por isso pede todas as linhas.
 */
import { api } from '@macuxi/platform-sdk/web';
import { z } from 'zod';
import { EquipeListaRespostaSchema, UsuarioListaRespostaSchema, type EquipeOpcao } from '../../../contracts';
// `contracts/index.ts` ainda não reexporta `performance.ts` (a costura no PC faz isso); importa direto do arquivo do contrato.
import { MetaProdutividadeSchema, MetasProdutividadePutSchema, type MetaProdutividade, type MetasProdutividadePut } from '../../../contracts/performance';

export const CHAVE_METAS_PRODUTIVIDADE = ['core', 'metas-produtividade'] as const;
export const CHAVE_EQUIPES = ['core', 'equipes'] as const;
export const CHAVE_CONSULTORES_METAS = [...CHAVE_METAS_PRODUTIVIDADE, 'consultores'] as const;

/** Usuário que pode ter meta própria: vendedor ou promotor ativo (§6.4), com a equipe para a herança. */
export interface ConsultorDaMeta {
  id: string;
  nome: string;
  equipe_id: string | null;
}

export function criarApiMetasProdutividade(chamar: typeof api = api) {
  return {
    listar: async (): Promise<MetaProdutividade[]> => z.object({ itens: z.array(MetaProdutividadeSchema) }).parse(await chamar<unknown>('/core/metas-produtividade')).itens,
    salvar: async (corpo: MetasProdutividadePut): Promise<void> => {
      await chamar<unknown>('/core/metas-produtividade', { method: 'PUT', body: MetasProdutividadePutSchema.parse(corpo) });
    },
    herdar: async (id: string): Promise<void> => {
      await chamar<unknown>(`/core/metas-produtividade/${id}`, { method: 'DELETE' });
    },
    equipes: async (): Promise<EquipeOpcao[]> => EquipeListaRespostaSchema.parse(await chamar<unknown>('/core/equipes')).itens,
    consultores: async (): Promise<ConsultorDaMeta[]> =>
      UsuarioListaRespostaSchema.parse(await chamar<unknown>('/core/usuarios', { query: { ativo: 'true' } }))
        .itens.filter((u) => u.perfil === 'vendedor' || u.perfil === 'promotor')
        .map((u) => ({ id: u.id, nome: u.nome, equipe_id: u.equipe_id }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  };
}
export type ApiMetasProdutividade = ReturnType<typeof criarApiMetasProdutividade>;
