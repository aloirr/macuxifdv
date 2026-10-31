/**
 * Validação da resposta inteira contra a versão que ela cita (RN-PES-01, RF-PES-01, RF-PES-04) e avaliação da hora do aparelho
 * contra a vigência, com flag de suspeita (RN-PES-04). A API sempre revalida; o app usa a mesma função
 * antes de gravar na outbox (modo `rascunho` no salvamento automático, `final` ao concluir).
 */
import type { ItemResposta, QuestionarioVersao, RespostaEnvio, Vigencia } from '../contracts';
import { calcularVisiveis } from './condicional';
import { PARAMETROS_PADRAO, type ParametrosPesquisa } from './parametros';
import { avisarItem, itemRespondido, validarItem, type AvisoResposta, type ErroResposta } from './resposta-item';
import { instanteMs } from './util';

export interface ValidacaoResposta {
  valida: boolean;
  erros: ErroResposta[];
  /** Avisos que não bloqueiam (RN-PES-06: dígito GS1 inválido). */
  avisos: AvisoResposta[];
}

export interface OpcoesValidacao {
  /** `rascunho` não exige obrigatórias nem ao menos uma resposta (RF-PES-04). Padrão: `final`. */
  modo?: 'final' | 'rascunho';
  parametros?: ParametrosPesquisa;
}

/**
 * RN-PES-01: valida a resposta contra a versão que ela referencia (mesmo que exista uma mais nova).
 * RF-PES-01: tipo, limites, opções e obrigatoriedade; obrigatória OCULTA pelas regras condicionais não é exigida.
 */
export function validarResposta(versao: QuestionarioVersao, resposta: Pick<RespostaEnvio, 'questionario_id' | 'versao_id' | 'itens'>, opcoes: OpcoesValidacao = {}): ValidacaoResposta {
  const modo = opcoes.modo ?? 'final';
  const parametros = opcoes.parametros ?? PARAMETROS_PADRAO;
  const erros: ErroResposta[] = [];
  const avisos: AvisoResposta[] = [];
  const falhar = (codigo: ErroResposta['codigo'], mensagem: string, pergunta_id: string | null = null) => erros.push({ codigo, pergunta_id, mensagem });

  if (resposta.versao_id !== versao.id || resposta.questionario_id !== versao.questionario_id) {
    falhar('VERSAO_INEXISTENTE', 'A resposta é de outra versão do questionário. Atualize o app e responda de novo.');
    return { valida: false, erros, avisos };
  }
  if (versao.status !== 'publicada') {
    falhar('VERSAO_NAO_PUBLICADA', 'Essa versão do questionário ainda não foi publicada, então não recebe respostas.');
    return { valida: false, erros, avisos };
  }

  const definicao = new Map(versao.perguntas.map((p) => [p.id, p] as const));
  const vistos = new Set<string>();
  const unicos: ItemResposta[] = [];
  for (const it of resposta.itens) {
    const p = definicao.get(it.pergunta_id);
    if (!p) {
      falhar('PERGUNTA_DESCONHECIDA', 'A resposta traz uma pergunta que não existe nesta versão do questionário. Atualize o app.', it.pergunta_id);
      continue;
    }
    if (vistos.has(it.pergunta_id)) {
      falhar('PERGUNTA_REPETIDA', `A pergunta "${p.enunciado}" foi respondida mais de uma vez. Mantenha só uma resposta.`, it.pergunta_id);
      continue;
    }
    vistos.add(it.pergunta_id);
    unicos.push(it);
  }

  const respondidos = unicos.filter(itemRespondido);
  const visiveis = new Set(calcularVisiveis(versao.perguntas, versao.regras, respondidos).filter((v) => v.visivel).map((v) => v.pergunta_id));

  for (const it of respondidos) {
    const p = definicao.get(it.pergunta_id)!;
    if (!visiveis.has(p.id)) {
      falhar('PERGUNTA_OCULTA', `A pergunta "${p.enunciado}" está oculta pelas respostas anteriores e não deve ser respondida. Apague essa resposta.`, p.id);
      continue;
    }
    erros.push(...validarItem(p, it, parametros));
    avisos.push(...avisarItem(p, it));
  }

  if (modo === 'final') {
    const feitas = new Set(respondidos.map((i) => i.pergunta_id));
    for (const p of versao.perguntas) {
      if (p.obrigatoria && visiveis.has(p.id) && !feitas.has(p.id)) falhar('OBRIGATORIA', `Responda a pergunta obrigatória "${p.enunciado}".`, p.id);
    }
    if (respondidos.length === 0 && erros.length === 0) falhar('SEM_RESPOSTAS', 'Responda ao menos uma pergunta antes de enviar.');
  }
  return { valida: erros.length === 0, erros, avisos };
}

export type CodigoSuspeita = 'ANTES_DA_VIGENCIA' | 'APOS_A_VIGENCIA' | 'RELOGIO_ADIANTADO';

export interface AvaliacaoRecebimento {
  /** RN-PES-04: sempre `true` — a resposta nunca é recusada por relógio ou vigência. */
  aceita: true;
  /** Flag de suspeita, visível no resultado. */
  suspeita: boolean;
  motivos: CodigoSuspeita[];
  /** Texto para o resultado/BKO; `null` quando não há suspeita. */
  mensagem: string | null;
}

const HORA_MS = 3_600_000;

const TEXTO_SUSPEITA: Record<CodigoSuspeita, string> = {
  RELOGIO_ADIANTADO: 'A hora do aparelho estava adiantada em relação ao servidor.',
  ANTES_DA_VIGENCIA: 'A resposta foi feita antes de a pesquisa começar a valer.',
  APOS_A_VIGENCIA: 'A resposta foi feita depois do fim da vigência da pesquisa.',
};

/**
 * RN-PES-04: a resposta guarda a hora do aparelho e o servidor grava `recebido_em`. O prazo usa a hora do APARELHO
 * (resposta feita offline no prazo vale mesmo sincronizada depois), com tolerância de [24 h] nas duas pontas. Relógio
 * adiantado além da tolerância ou resposta fora da vigência: ACEITA e SINALIZADA (suspeita), nunca recusada.
 */
export function avaliarRecebimentoDaResposta(vigencia: Vigencia, horas: { respondida_em: string; recebida_em: string }, tolerancia_h: number): AvaliacaoRecebimento {
  const tol = tolerancia_h * HORA_MS;
  const feita = instanteMs(horas.respondida_em);
  const motivos: CodigoSuspeita[] = [];
  if (feita > instanteMs(horas.recebida_em) + tol) motivos.push('RELOGIO_ADIANTADO');
  if (feita < instanteMs(vigencia.inicio) - tol) motivos.push('ANTES_DA_VIGENCIA');
  else if (vigencia.fim !== null && feita > instanteMs(vigencia.fim) + tol) motivos.push('APOS_A_VIGENCIA');
  return { aceita: true, suspeita: motivos.length > 0, motivos, mensagem: motivos.length ? motivos.map((m) => TEXTO_SUSPEITA[m]).join(' ') : null };
}
