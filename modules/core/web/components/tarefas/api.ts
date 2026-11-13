/**
 * Chamadas do BKO "Tarefas" (RF-CORE-18 proposto; desenho `docs/desenho/tarefas-consultor.md` §4.1 e §7.1). Os corpos de
 * envio são os contratos da N-B (`CriarTarefaSchema`, `CancelarTarefaSchema`, `TarefaListaQuerySchema`). As rotas chegam
 * na N-D. `chamar` é o `api` do platform-sdk; os testes passam a API simulada.
 *
 * PENDENTE DE CONTRATO: as respostas de leitura (lista, detalhe e por consultor) ainda não têm schema em
 * `contracts/tarefa.ts`. Os formatos abaixo seguem o §4.1 ("resumo por tarefa" e "resumo por consultor") e entram no
 * contrato junto com as rotas da N-D; até lá ficam aqui, sem `.strict()`, para campo novo da API não quebrar a tela.
 */
import { api } from '@macuxi/platform-sdk/web';
import { z } from 'zod';
import { EquipeListaRespostaSchema, HierarquiaEquipeSchema, type EquipeOpcao } from '../../../contracts';
// `contracts/index.ts` ainda não reexporta `tarefa.ts` (a costura no PC faz isso); importa direto do arquivo do contrato.
import {
  CancelarTarefaSchema,
  CriarTarefaRespostaSchema,
  CriarTarefaSchema,
  SITUACOES_TAREFA,
  TIPOS_TAREFA,
  type CancelarTarefa,
  type CriarTarefa,
  type CriarTarefaResposta,
  type TarefaListaQuery,
} from '../../../contracts/tarefa';

export type Chamar = typeof api;

const Inteiro = z.number().int().nonnegative();

export const TarefaResumoBkoSchema = z.object({
  id: z.string().uuid(),
  titulo: z.string(),
  tipo: z.enum(TIPOS_TAREFA),
  prazo: z.string(),
  alvo: z.enum(['usuarios', 'equipe', 'todos']),
  equipe_nome: z.string().nullable(),
  total: Inteiro,
  feitas: Inteiro,
  atrasadas: Inteiro,
  cancelada_em: z.string().nullable(),
});
export type TarefaResumoBko = z.infer<typeof TarefaResumoBkoSchema>;

export const LinhaConsultorTarefaSchema = z.object({
  id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  nome: z.string(),
  situacao: z.enum(SITUACOES_TAREFA),
  concluida_em: z.string().nullable(),
  observacao: z.string().nullable(),
  fotos: Inteiro,
  suspeita: z.boolean(),
});
export type LinhaConsultorTarefa = z.infer<typeof LinhaConsultorTarefaSchema>;

export const TarefaDetalheBkoSchema = TarefaResumoBkoSchema.extend({
  descricao: z.string().nullable(),
  motivo_cancelamento: z.string().nullable(),
  destinatarios: z.array(LinhaConsultorTarefaSchema),
});
export type TarefaDetalheBko = z.infer<typeof TarefaDetalheBkoSchema>;

export const ResumoPorConsultorSchema = z.object({
  usuario_id: z.string().uuid(),
  nome: z.string(),
  abertas: Inteiro,
  atrasadas: Inteiro,
  feitas_no_prazo: Inteiro,
  feitas_com_atraso: Inteiro,
  /** Pontos-base (10000 = 100%); nulo sem tarefa feita nem vencida no período. */
  pct_no_prazo_pb: Inteiro.nullable(),
});
export type ResumoPorConsultor = z.infer<typeof ResumoPorConsultorSchema>;

export const QuestionarioParaTarefaSchema = z.object({ questionario_id: z.string().uuid(), titulo: z.string() });
export type QuestionarioParaTarefa = z.infer<typeof QuestionarioParaTarefaSchema>;

const itens = <T extends z.ZodTypeAny>(item: T) => z.object({ itens: z.array(item) });

/** Consultor que pode receber tarefa: vendedor ou promotor ativo do escopo de quem cria (RN-CORE-TAR-01, RN-CORE-04). */
export interface ConsultorOpcao {
  id: string;
  nome: string;
}

/** Filtros da tela, só os preenchidos vão na query. */
export type FiltrosTarefas = Pick<TarefaListaQuery, 'situacao' | 'usuario_id' | 'equipe_id' | 'de' | 'ate'>;

const query = (f: FiltrosTarefas) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));

export const CHAVE_TAREFAS = ['core', 'tarefas'] as const;
export const chaveLista = (f: FiltrosTarefas) => [...CHAVE_TAREFAS, 'lista', query(f)] as const;
export const chaveDetalhe = (id: string) => [...CHAVE_TAREFAS, 'detalhe', id] as const;
export const chavePorConsultor = (f: FiltrosTarefas) => [...CHAVE_TAREFAS, 'por-consultor', query(f)] as const;
export const CHAVE_CONSULTORES = [...CHAVE_TAREFAS, 'consultores'] as const;
export const CHAVE_EQUIPES = ['core', 'equipes'] as const;
export const CHAVE_QUESTIONARIOS = [...CHAVE_TAREFAS, 'questionarios'] as const;

export function criarApiTarefas(chamar: Chamar = api) {
  return {
    listar: async (f: FiltrosTarefas): Promise<TarefaResumoBko[]> =>
      itens(TarefaResumoBkoSchema).parse(await chamar<unknown>('/core/tarefas', { query: query(f) })).itens,
    detalhe: async (id: string): Promise<TarefaDetalheBko> => TarefaDetalheBkoSchema.parse(await chamar<unknown>(`/core/tarefas/${id}`)),
    porConsultor: async (f: FiltrosTarefas): Promise<ResumoPorConsultor[]> =>
      itens(ResumoPorConsultorSchema).parse(await chamar<unknown>('/core/tarefas/por-consultor', { query: query(f) })).itens,
    criar: async (corpo: CriarTarefa): Promise<CriarTarefaResposta> =>
      CriarTarefaRespostaSchema.parse(await chamar<unknown>('/core/tarefas', { method: 'POST', body: CriarTarefaSchema.parse(corpo) })),
    cancelar: async (id: string, corpo: CancelarTarefa): Promise<void> => {
      await chamar<unknown>(`/core/tarefas/${id}/cancelar`, { method: 'POST', body: CancelarTarefaSchema.parse(corpo) });
    },
    /** Vendedores e promotores ativos da hierarquia (a API já recorta pelo escopo de quem pede). */
    consultores: async (): Promise<ConsultorOpcao[]> =>
      HierarquiaEquipeSchema.parse(await chamar<unknown>('/core/equipe/hierarquia'))
        .membros.filter((m) => m.ativo && (m.perfil === 'vendedor' || m.perfil === 'promotor'))
        .map((m) => ({ id: m.id, nome: m.nome }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    equipes: async (): Promise<EquipeOpcao[]> => EquipeListaRespostaSchema.parse(await chamar<unknown>('/core/equipes')).itens,
    /** Questionários publicados (consulta `pesquisa.questionarios_para_tarefa@1` pela API do Core). Falha = sem a Pesquisa. */
    questionarios: async (): Promise<QuestionarioParaTarefa[]> =>
      itens(QuestionarioParaTarefaSchema).parse(await chamar<unknown>('/core/tarefas/questionarios')).itens,
  };
}
export type ApiTarefas = ReturnType<typeof criarApiTarefas>;
