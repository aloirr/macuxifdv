/**
 * Formulário de resposta no aparelho (RF-PES-01/04): rascunho local salvo a cada toque, perguntas visíveis pelas
 * regras condicionais e montagem do envio. Puro (sem React nem armazenamento); as regras vêm do domain
 * (`calcularVisiveis`, `descartarRespostasOcultas`, `validarResposta`) — o servidor revalida tudo.
 */
import type { ItemResposta, Pergunta, QuestionarioVersao, RespostaEnvio } from '../../contracts';
import { calcularVisiveis, descartarRespostasOcultas, itemRespondido, validarResposta, type AvisoResposta, type ErroResposta, type ParametrosPesquisa } from '../../domain';

/** Rascunho só no aparelho (premissa T-0012 §4): não sobe ao servidor nem entra no sync. */
export interface RascunhoResposta {
  /** UUID gerado no aparelho; vira o id da resposta (idempotência). */
  id: string;
  questionario_id: string;
  versao_id: string;
  cliente_id: string | null;
  visita_id: string | null;
  iniciado_em: string;
  itens: ItemResposta[];
}

/** Um rascunho por pesquisa e contexto (visita > cliente > avulsa). */
export function chaveDoRascunho(questionarioId: string, contexto: { visita_id: string | null; cliente_id: string | null }): string {
  return `${questionarioId}:${contexto.visita_id ?? contexto.cliente_id ?? 'avulsa'}`;
}

export function novoRascunho(a: { id: string; versao: QuestionarioVersao; cliente_id: string | null; visita_id: string | null; agora: string }): RascunhoResposta {
  return { id: a.id, questionario_id: a.versao.questionario_id, versao_id: a.versao.id, cliente_id: a.cliente_id, visita_id: a.visita_id, iniciado_em: a.agora, itens: [] };
}

/** Grava (ou troca) a resposta de uma pergunta; item em branco remove. Devolve cópia. */
export function responder(r: RascunhoResposta, item: ItemResposta): RascunhoResposta {
  const outros = r.itens.filter((i) => i.pergunta_id !== item.pergunta_id);
  return { ...r, itens: itemRespondido(item) ? [...outros, item] : outros };
}

export function itemDa(r: RascunhoResposta, perguntaId: string): ItemResposta | undefined {
  return r.itens.find((i) => i.pergunta_id === perguntaId);
}

export interface CampoDoFormulario {
  pergunta: Pergunta;
  item: ItemResposta | undefined;
  /** Número exibido (1, 2, 3…) entre as visíveis. */
  ordem: number;
}

/** RF-PES-01 / RN-PES-05: perguntas visíveis agora (a resposta oculta não conta nas regras seguintes). */
export function camposVisiveis(versao: QuestionarioVersao, r: RascunhoResposta): CampoDoFormulario[] {
  const vis = calcularVisiveis(versao.perguntas, versao.regras, r.itens);
  const visiveis = new Set(vis.filter((v) => v.visivel).map((v) => v.pergunta_id));
  let n = 0;
  return versao.perguntas.filter((p) => visiveis.has(p.id)).map((p) => ({ pergunta: p, item: itemDa(r, p.id), ordem: ++n }));
}

export interface Progresso {
  visiveis: number;
  respondidas: number;
  obrigatorias_faltando: number;
}

export function progresso(versao: QuestionarioVersao, r: RascunhoResposta): Progresso {
  const campos = camposVisiveis(versao, r);
  const respondidas = campos.filter((c) => c.item !== undefined).length;
  const obrigatorias_faltando = campos.filter((c) => c.pergunta.obrigatoria && c.item === undefined).length;
  return { visiveis: campos.length, respondidas, obrigatorias_faltando };
}

export type Preparo = { ok: true; envio: RespostaEnvio; avisos: AvisoResposta[] } | { ok: false; erros: ErroResposta[]; avisos: AvisoResposta[] };

/**
 * RF-PES-04: monta o envio a partir do rascunho — descarta respostas de perguntas que ficaram ocultas, valida no modo
 * final (obrigatórias visíveis, limites, tipos) e carimba a hora do APARELHO (RN-PES-04).
 */
export function prepararEnvio(versao: QuestionarioVersao, r: RascunhoResposta, a: { agora: string; parametros?: ParametrosPesquisa }): Preparo {
  const itens = descartarRespostasOcultas(versao.perguntas, versao.regras, r.itens).filter(itemRespondido);
  const envio: RespostaEnvio = { id: r.id, questionario_id: r.questionario_id, versao_id: r.versao_id, cliente_id: r.cliente_id, visita_id: r.visita_id, respondida_em: a.agora, itens };
  const v = validarResposta(versao, envio, { modo: 'final', ...(a.parametros ? { parametros: a.parametros } : {}) });
  return v.valida ? { ok: true, envio, avisos: v.avisos } : { ok: false, erros: v.erros, avisos: v.avisos };
}

/** Erros por pergunta para mostrar embaixo de cada campo (o primeiro de cada uma). */
export function errosPorPergunta(erros: readonly ErroResposta[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const e of erros) if (e.pergunta_id && !(e.pergunta_id in m)) m[e.pergunta_id] = e.mensagem;
  return m;
}

/** Ids das fotos do envio (vão para a fila de arquivos do motor, ADR 0010). */
export function fotosDoEnvio(envio: RespostaEnvio): string[] {
  return envio.itens.flatMap((i) => (i.tipo === 'foto' ? i.fotos.map((f) => f.id) : []));
}
