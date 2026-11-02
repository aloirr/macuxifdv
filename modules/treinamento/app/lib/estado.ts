/**
 * Estado do Treinamento no aparelho (offline-first, desenho T-0058): transforma as linhas do pull (`trilha`, `progresso`,
 * `tentativa`, `xp_lancamento`, `medalha_usuario`) e a fila do motor (push `progresso`) no estado do domain e projeta o
 * que ainda não subiu com o MESMO `aplicarAtividades` da API — o aluno vê XP, nível e medalha na hora, sem sinal.
 * Puro e testado, sem React nem armazenamento: a leitura do SQLite é do hook.
 */
import type { LinhaSync } from '@macuxi/platform-sdk';
import {
  AtividadeEnvio,
  conteudoParaDominio,
  ParametrosTreinamentoSchema,
  type MedalhaUsuarioSyncLinha,
  type ProgressoSyncLinha,
  type TentativaSyncLinha,
  type TrilhaSyncLinha,
  type XpLancamentoSyncLinha,
} from '../../contracts';
import {
  aplicarAtividade,
  aplicarAtividades,
  resolverParametros,
  type AtividadeDoAluno,
  type ConteudoDoAluno,
  type EstadoDoAluno,
  type OpcoesAtividade,
  type ParametrosTreinamento,
  type ResultadoAtividade,
} from '../../domain';

export interface LinhasTreinamento {
  trilhas: TrilhaSyncLinha[];
  progresso: ProgressoSyncLinha[];
  tentativas: TentativaSyncLinha[];
  lancamentos: XpLancamentoSyncLinha[];
  medalhas: MedalhaUsuarioSyncLinha[];
}

export const LINHAS_VAZIAS: LinhasTreinamento = {
  trilhas: [],
  progresso: [],
  tentativas: [],
  lancamentos: [],
  medalhas: [],
};

/** O que o motor oferece para ler as linhas locais (subconjunto estrutural de `MotorSync`). */
export interface LeitorDeLinhas {
  linhas<L extends LinhaSync = LinhaSync>(entidade: string): Promise<L[]>;
}

const vivas = <T extends { deleted_at: string | null }>(l: readonly T[]): T[] =>
  l.filter((x) => !x.deleted_at);

export async function lerLinhas(motor: LeitorDeLinhas): Promise<LinhasTreinamento> {
  const ler = async <T extends LinhaSync>(e: string): Promise<T[]> => vivas(await motor.linhas<T>(e));
  const [trilhas, progresso, tentativas, lancamentos, medalhas] = await Promise.all([
    ler<TrilhaSyncLinha & LinhaSync>('trilha'),
    ler<ProgressoSyncLinha & LinhaSync>('progresso'),
    ler<TentativaSyncLinha & LinhaSync>('tentativa'),
    ler<XpLancamentoSyncLinha & LinhaSync>('xp_lancamento'),
    ler<MedalhaUsuarioSyncLinha & LinhaSync>('medalha_usuario'),
  ]);
  return { trilhas, progresso, tentativas, lancamentos, medalhas };
}

/**
 * Parâmetros do tenant guardados no aparelho (último `/v1/me/modulos`); inválidos ou ausentes = padrão do domain.
 * O fuso do login (tenant) prevalece sobre o do parâmetro.
 */
export function parametrosDoAparelho(
  bruto: Readonly<Record<string, unknown>>,
  fusoDoLogin?: string | null,
): ParametrosTreinamento {
  const lido = ParametrosTreinamentoSchema.safeParse(bruto);
  let params: ParametrosTreinamento;
  try {
    params = lido.success ? resolverParametros(lido.data) : resolverParametros();
  } catch {
    params = resolverParametros();
  }
  if (!fusoDoLogin) return params;
  try {
    return resolverParametros({ ...params, fuso: fusoDoLogin });
  } catch {
    return params;
  }
}

/** Trilhas do aparelho (o servidor só manda as do público do aluno; rascunho nunca deveria chegar e é ignorado). */
export function trilhasDoAparelho(linhas: Pick<LinhasTreinamento, 'trilhas'>): TrilhaSyncLinha[] {
  return linhas.trilhas.filter((t) => !t.deleted_at && t.status !== 'rascunho');
}

/**
 * Conteúdo do domain a partir das trilhas do aparelho. RN-TRE-07: o pull de `trilha` já vem filtrado pelo público do
 * aluno no servidor (perfil E equipe, com os dados do Core); o login do aparelho não traz a equipe, então aqui o público
 * de cada trilha recebida conta como atendido — a prévia não esconde trilha de equipe e a API revalida o público no push.
 */
export function conteudoDoAparelho(linhas: Pick<LinhasTreinamento, 'trilhas'>): ConteudoDoAluno {
  return conteudoParaDominio(trilhasDoAparelho(linhas).map((t) => ({ ...t, publico_alvo: { perfis: [], equipes: [] } })));
}

export interface AlunoDoAparelho {
  id: string;
  perfil: string;
  /** O login do aparelho ainda não traz a equipe (premissa T-0058); o público já vem filtrado no pull (`conteudoDoAparelho`). */
  equipe_id: string | null;
}

/** Linhas do pull → estado do domain (só as do próprio aluno). */
export function estadoDasLinhas(linhas: LinhasTreinamento, aluno: AlunoDoAparelho): EstadoDoAluno {
  const meu = <T extends { usuario_id: string }>(l: readonly T[]) =>
    l.filter((x) => x.usuario_id === aluno.id);
  const tenant =
    [
      ...linhas.progresso,
      ...linhas.tentativas,
      ...linhas.lancamentos,
      ...linhas.medalhas,
      ...linhas.trilhas,
    ][0]?.tenant_id ?? '';
  return {
    tenant_id: tenant,
    usuario_id: aluno.id,
    usuario: { perfil: aluno.perfil, equipe_id: aluno.equipe_id },
    conclusoes: meu(linhas.progresso).map((p) => ({
      id: p.id,
      trilha_id: p.trilha_id,
      licao_id: p.licao_id,
      tempo_gasto_seg: p.tempo_gasto_seg,
      concluida_em: p.concluida_em,
    })),
    tentativas: meu(linhas.tentativas).map((t) => ({
      id: t.id,
      quiz_id: t.quiz_id,
      realizada_em: t.realizada_em,
      respostas: t.respostas,
      acertos: t.acertos,
      total_questoes: t.total_questoes,
      nota_pct: t.nota_pct,
      aprovada: t.aprovada,
      primeira_tentativa: t.primeira_tentativa,
      finalizada: t.finalizada,
    })),
    lancamentos: meu(linhas.lancamentos).map(({ updated_at: _u, deleted_at: _d, ...l }) => l),
    conquistas: meu(linhas.medalhas).map((m) => ({
      id: m.id,
      medalha_codigo: m.medalha_codigo,
      conquistada_em: m.conquistada_em,
    })),
  };
}

/** Payload do push `progresso` → atividade do domain. */
export function atividadeDoEnvio(p: AtividadeEnvio): AtividadeDoAluno {
  if (p.tipo === 'licao')
    return {
      tipo: 'licao',
      id: p.id,
      trilha_id: p.trilha_id,
      licao_id: p.licao_id,
      tempo_gasto_seg: p.tempo_gasto_seg,
      concluida_em: p.concluida_em,
    };
  return { tipo: 'quiz', id: p.id, quiz_id: p.quiz_id, realizada_em: p.realizada_em, respostas: p.respostas };
}

/** Atividade do domain → payload do push `progresso` (o `id` é o UUID do aparelho = id do item da fila). */
export function envioDaAtividade(a: AtividadeDoAluno): AtividadeEnvio {
  if (a.tipo === 'licao')
    return {
      tipo: 'licao',
      id: a.id,
      trilha_id: a.trilha_id,
      licao_id: a.licao_id,
      tempo_gasto_seg: a.tempo_gasto_seg,
      concluida_em: a.concluida_em,
    };
  return {
    tipo: 'quiz',
    id: a.id,
    quiz_id: a.quiz_id,
    realizada_em: a.realizada_em,
    respostas: a.respostas.map((r) => ({
      questao_id: r.questao_id,
      alternativa_ids: [...r.alternativa_ids],
    })),
  };
}

/** Item da fila/sobreposição do motor (subconjunto estrutural de `ItemSobreposicao`). */
export interface ItemDaFila {
  id: string;
  modulo: string;
  entidade: string;
  payload: unknown;
  situacao: string;
  ultimo_erro: string;
}

export interface Projecao {
  estado: EstadoDoAluno;
  /** Atividades ainda não aceitas pelo servidor (fila `pendente`). */
  na_fila: number;
  /** Recusadas pelo servidor (`falhou`): ficam fora da prévia, com a mensagem para o aluno. */
  recusadas: { id: string; mensagem: string }[];
}

/** Gerador de ids da prévia (lançamentos e conquistas que só existem na tela até o pull trazer os do servidor). */
export function idsDePrevia(prefixo = 'previa'): () => string {
  let n = 0;
  return () => `${prefixo}-${++n}`;
}

/**
 * RN-TRE-04: projeta sobre o estado do pull o que está na fila (`pendente`) e o que o servidor aceitou mas o pull ainda
 * não trouxe (`aceito`). Item já presente no pull vira `duplicado` (mesmo id) e não conta duas vezes; `falhou` (recusado
 * pelo servidor) fica de fora da prévia.
 */
export function projetar(
  estado: EstadoDoAluno,
  conteudo: ConteudoDoAluno,
  itens: readonly ItemDaFila[],
  params: ParametrosTreinamento,
): Projecao {
  const nossos = itens.filter((i) => i.modulo === 'treinamento' && i.entidade === 'progresso');
  const recusadas = nossos
    .filter((i) => i.situacao === 'falhou')
    .map((i) => ({ id: i.id, mensagem: i.ultimo_erro || 'O servidor recusou esta atividade.' }));
  const validas = nossos
    .filter((i) => i.situacao === 'pendente' || i.situacao === 'aceito')
    .map((i) => AtividadeEnvio.safeParse(i.payload))
    .flatMap((r) => (r.success ? [atividadeDoEnvio(r.data)] : []));
  const { estado: novo } = aplicarAtividades(estado, validas, conteudo, { gerarId: idsDePrevia(), params });
  return { estado: novo, na_fila: nossos.filter((i) => i.situacao === 'pendente').length, recusadas };
}

export interface PlanoDeEnvio {
  /** Atividades a enfileirar (aceitas pelo domain, na ordem). */
  enviar: AtividadeDoAluno[];
  resultados: { atividade: AtividadeDoAluno; resultado: ResultadoAtividade }[];
  /** Primeira recusa do domain (a tela mostra a mensagem); as atividades depois dela não são enviadas. */
  recusa: Extract<ResultadoAtividade, { status: 'rejeitado' }> | null;
  estado: EstadoDoAluno;
}

/**
 * Confere no aparelho, com o domain, o que o aluno acabou de fazer, antes de enfileirar (RN-TRE-02/04): para na
 * primeira recusa; `duplicado` não é reenviado.
 */
export function planejarEnvio(
  estado: EstadoDoAluno,
  conteudo: ConteudoDoAluno,
  atividades: readonly AtividadeDoAluno[],
  opcoes: OpcoesAtividade,
): PlanoDeEnvio {
  let atual = estado;
  const enviar: AtividadeDoAluno[] = [];
  const resultados: PlanoDeEnvio['resultados'] = [];
  for (const a of atividades) {
    const r = aplicarAtividade(atual, a, conteudo, opcoes);
    resultados.push({ atividade: a, resultado: r.resultado });
    if (r.resultado.status === 'rejeitado') return { enviar, resultados, recusa: r.resultado, estado: atual };
    if (r.resultado.status === 'aceito') enviar.push(a);
    atual = r.estado;
  }
  return { enviar, resultados, recusa: null, estado: atual };
}

/** Chave do cache do ranking no armazenamento do módulo (o ranking é calculado no servidor, RN-TRE-03). */
export const chaveDoRanking = (periodo: string, escopo: string): string => `ranking:${periodo}:${escopo}`;

/** Rótulo do prazo de uma trilha obrigatória (texto curto da lista). */
export function rotuloDoPrazo(t: {
  prazo: string | null;
  atrasada: boolean;
  dias_para_prazo: number | null;
  concluida: boolean;
}): string | null {
  if (t.concluida || !t.prazo || t.dias_para_prazo === null) return null;
  if (t.atrasada)
    return t.dias_para_prazo === -1 ? 'Atrasada há 1 dia' : `Atrasada há ${-t.dias_para_prazo} dias`;
  if (t.dias_para_prazo === 0) return 'Vence hoje';
  if (t.dias_para_prazo === 1) return 'Vence amanhã';
  return `Vence em ${t.dias_para_prazo} dias`;
}

/** Texto do tempo (m:ss) do cronômetro da lição. */
export function textoDoTempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
