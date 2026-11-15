/**
 * Regras de tela do BKO "Tarefas" (desenho `docs/desenho/tarefas-consultor.md` §1 e §7.1), puras: rótulos, montagem do corpo
 * da nova tarefa com os erros por campo e a leitura dos 422 da API. A regra de negócio fica no domain
 * (`domain/tarefas/situacao.ts`, `prazoAceito`) e a API revalida tudo.
 */
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import type { BadgeTone } from '@macuxi/ui/web';
import {
  CriarTarefaSchema,
  ERROS_TAREFA,
  TAREFA_DESCRICAO_MAX,
  TAREFA_DESTINATARIOS_MAX,
  TAREFA_MOTIVO_CANCELAMENTO_MAX,
  TAREFA_TITULO_MAX,
  type CriarTarefa,
  type SituacaoTarefa,
  type TipoTarefa,
} from '../../../contracts/tarefa';
import { prazoAceito } from '../../../domain/tarefas/situacao';
import type { TarefaResumoBko } from './api';

/** Campo de formulário do BKO (mesma medida das outras páginas do Core: 44 px de altura). */
export const CAMPO_TAREFA = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink';

export const ROTULO_TIPO: Record<TipoTarefa, string> = { simples: 'Simples', foto: 'Com foto', pesquisa: 'Pesquisa' };

export const ROTULO_SITUACAO: Record<SituacaoTarefa, { texto: string; tom: BadgeTone }> = {
  aberta: { texto: 'Aberta', tom: 'pending' },
  atrasada: { texto: 'Atrasada', tom: 'danger' },
  feita_no_prazo: { texto: 'Feita no prazo', tom: 'success' },
  feita_com_atraso: { texto: 'Feita com atraso', tom: 'warning' },
  cancelada: { texto: 'Cancelada', tom: 'neutral' },
  sem_modulo: { texto: 'Sem módulo', tom: 'neutral' },
  sem_consultor_ativo: { texto: 'Sem consultor ativo', tom: 'neutral' },
};

export const FILTROS_SITUACAO = [
  ['', 'Todas'],
  ['abertas', 'Abertas'],
  ['atrasadas', 'Atrasadas'],
  ['concluidas', 'Concluídas'],
  ['canceladas', 'Canceladas'],
] as const;

/** Coluna Destino: "Equipe Norte", "3 pessoas" ou "Todos". */
export function rotuloDestino(t: Pick<TarefaResumoBko, 'alvo' | 'equipe_nome' | 'total'>): string {
  if (t.alvo === 'todos') return 'Todos';
  if (t.alvo === 'equipe') return t.equipe_nome ?? 'Equipe';
  return t.total === 1 ? '1 pessoa' : `${t.total} pessoas`;
}

/** % no prazo em pontos-base → "85%"; nulo → "—". */
export function pctNoPrazo(pb: number | null): string {
  return pb === null ? '—' : `${Math.round(pb / 100)}%`;
}

// ---- Nova tarefa ----

export type AlvoTarefa = 'usuarios' | 'equipe' | 'todos';

export interface FormTarefa {
  titulo: string;
  descricao: string;
  prazo: string;
  tipo: TipoTarefa;
  questionario_id: string;
  alvo: AlvoTarefa;
  usuario_ids: string[];
  equipe_id: string;
}

export type CampoTarefa = 'titulo' | 'descricao' | 'prazo' | 'questionario_id' | 'destino';
export type ErrosTarefa = Partial<Record<CampoTarefa, string>>;

export const formTarefaVazio = (prazo: string): FormTarefa => ({
  titulo: '',
  descricao: '',
  prazo,
  tipo: 'simples',
  questionario_id: '',
  alvo: 'usuarios',
  usuario_ids: [],
  equipe_id: '',
});

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Corpo do `POST /v1/core/tarefas` (contrato `CriarTarefaSchema`) ou os erros por campo. `id` é o mesmo a cada tentativa. */
export function corpoDaTarefa(f: FormTarefa, id: string, hoje: string): { ok: true; corpo: CriarTarefa } | { ok: false; erros: ErrosTarefa } {
  const erros: ErrosTarefa = {};
  const titulo = f.titulo.trim();
  const descricao = f.descricao.trim();
  if (!titulo) erros.titulo = 'Escreva o título.';
  else if (titulo.length > TAREFA_TITULO_MAX) erros.titulo = `Use até ${TAREFA_TITULO_MAX} caracteres.`;
  if (descricao.length > TAREFA_DESCRICAO_MAX) erros.descricao = `Use até ${TAREFA_DESCRICAO_MAX} caracteres.`;
  if (!DATA.test(f.prazo)) erros.prazo = 'Escolha o prazo.';
  // RN-CORE-TAR-02: o prazo é hoje ou depois, no fuso do tenant
  else if (!prazoAceito(f.prazo, hoje)) erros.prazo = 'Escolha hoje ou uma data depois.';
  if (f.tipo === 'pesquisa' && !f.questionario_id) erros.questionario_id = 'Escolha o questionário.';
  if (f.alvo === 'usuarios' && f.usuario_ids.length === 0) erros.destino = 'Escolha ao menos uma pessoa.';
  else if (f.alvo === 'usuarios' && f.usuario_ids.length > TAREFA_DESTINATARIOS_MAX) erros.destino = `Escolha até ${TAREFA_DESTINATARIOS_MAX} pessoas.`;
  if (f.alvo === 'equipe' && !f.equipe_id) erros.destino = 'Escolha a equipe.';
  if (Object.keys(erros).length > 0) return { ok: false, erros };

  const destino: CriarTarefa['destino'] =
    f.alvo === 'usuarios' ? { alvo: 'usuarios', usuario_ids: f.usuario_ids } : f.alvo === 'equipe' ? { alvo: 'equipe', equipe_id: f.equipe_id } : { alvo: 'todos' };
  const r = CriarTarefaSchema.safeParse({
    id,
    titulo,
    descricao: descricao || null,
    prazo: f.prazo,
    cliente_id: null,
    tipo: f.tipo,
    questionario_id: f.tipo === 'pesquisa' ? f.questionario_id : null,
    destino,
  });
  return r.success ? { ok: true, corpo: r.data } : { ok: false, erros: { titulo: 'Confira os campos e tente de novo.' } };
}

/** Código do 422/403 da API → campo da nova tarefa. Fora desta lista, o erro vai para o aviso do topo da folha. */
const CAMPO_DO_CODIGO: Readonly<Record<string, CampoTarefa>> = {
  [ERROS_TAREFA.prazo]: 'prazo',
  [ERROS_TAREFA.destinatarios]: 'destino',
  [ERROS_TAREFA.destinatarioVazio]: 'destino',
  [ERROS_TAREFA.foraDoEscopo]: 'destino',
  [ERROS_TAREFA.inativo]: 'destino',
  [ERROS_TAREFA.cliente]: 'destino',
  [ERROS_TAREFA.promotor]: 'destino',
  [ERROS_TAREFA.pesquisa]: 'questionario_id',
};

/** Erro da API no campo, com os nomes das pessoas quando a API manda (`detalhes.nomes`, §7.1). */
export function errosDaApi(e: unknown): { campos: ErrosTarefa; aviso: string | null } {
  if (!(e instanceof ApiRequestError)) return { campos: {}, aviso: errorMessage(e) };
  const campo = CAMPO_DO_CODIGO[e.code];
  if (!campo) return { campos: {}, aviso: errorMessage(e) };
  const nomes = Array.isArray(e.details?.nomes) ? e.details.nomes.filter((n): n is string => typeof n === 'string') : [];
  const faltam = nomes.filter((n) => !e.message.includes(n));
  return { campos: { [campo]: faltam.length > 0 ? `${e.message} ${faltam.join(', ')}.` : e.message }, aviso: null };
}

/** Motivo do cancelamento (RN-CORE-TAR-08): obrigatório, até 300 caracteres. */
export function validarMotivo(motivo: string): { ok: true; motivo: string } | { ok: false; erro: string } {
  const m = motivo.trim();
  if (!m) return { ok: false, erro: 'Escreva o motivo.' };
  if (m.length > TAREFA_MOTIVO_CANCELAMENTO_MAX) return { ok: false, erro: `Use até ${TAREFA_MOTIVO_CANCELAMENTO_MAX} caracteres.` };
  return { ok: true, motivo: m };
}
