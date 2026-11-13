/**
 * Regras das consultas da tarefa de pesquisa (T-0170; RF-PES-02, RN-PES-01/02). Funções puras, usadas pelos dois canais
 * (`pesquisa.questionarios_para_tarefa@1` na API e `pesquisa.resposta_local@1` no aparelho).
 */
import type { Questionario, QuestionarioVersao } from '../contracts';
import { equipeNoPublico, perfilNoPublico, vigenteEm } from './publico';
import { versaoVigente } from './questionario';
import { instanteMs } from './util';

export interface PesquisaParaTarefa {
  questionario: Questionario;
  versoes: readonly QuestionarioVersao[];
}

/** Atributo `null` = o canal não sabe (não verificável): o critério correspondente não marca o usuário como fora. */
export interface UsuarioParaTarefa {
  id: string;
  perfil: string | null;
  equipe_ids: readonly string[] | null;
}

export interface QuestionarioParaTarefa {
  questionario_id: string;
  titulo: string;
  vigente_ate: string | null;
  fora_do_publico: string[];
}

/**
 * RN-PES-01/02 e RF-PES-02: questionários com versão vigente (publicada de maior número, não arquivado) e dentro da vigência
 * agora; para cada um, os usuários cujo perfil ou equipe (valem juntos) estão fora do público. Cliente não entra: a tarefa
 * ainda não tem cliente. Falha para o lado de não bloquear: atributo desconhecido não marca ninguém.
 */
export function questionariosParaTarefa(pesquisas: readonly PesquisaParaTarefa[], usuarios: readonly UsuarioParaTarefa[], agora: string): QuestionarioParaTarefa[] {
  const saida: QuestionarioParaTarefa[] = [];
  for (const p of pesquisas) {
    const v = versaoVigente(p.questionario, p.versoes);
    if (!v || !vigenteEm(v.vigencia, agora)) continue;
    const fora = usuarios
      .filter((u) => (u.perfil !== null && !perfilNoPublico(v.publico_alvo, { perfil: u.perfil })) || (u.equipe_ids !== null && !equipeNoPublico(v.publico_alvo, { equipe_ids: u.equipe_ids })))
      .map((u) => u.id);
    saida.push({ questionario_id: p.questionario.id, titulo: v.titulo, vigente_ate: v.vigencia.fim, fora_do_publico: fora });
  }
  return saida;
}

export interface RespostaLocalLida {
  id: string;
  questionario_id: string;
  cliente_id: string | null;
  respondida_em: string;
}

/** RN-PES-02: a resposta mais recente do questionário (e do cliente, se informado) a partir de `desde` (inclusive); empate pelo maior id. */
export function respostaLocalMaisRecente(respostas: readonly RespostaLocalLida[], filtro: { questionario_id: string; cliente_id: string | null; desde: string }): string | null {
  const limite = instanteMs(filtro.desde);
  let melhor: { id: string; t: number } | null = null;
  for (const r of respostas) {
    if (r.questionario_id !== filtro.questionario_id) continue;
    if (filtro.cliente_id !== null && r.cliente_id !== filtro.cliente_id) continue;
    const t = instanteMs(r.respondida_em);
    if (t < limite) continue;
    if (melhor === null || t > melhor.t || (t === melhor.t && r.id > melhor.id)) melhor = { id: r.id, t };
  }
  return melhor?.id ?? null;
}
