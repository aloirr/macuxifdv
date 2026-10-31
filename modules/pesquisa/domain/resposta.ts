/**
 * Validação da resposta inteira contra a versão que ela cita (RN-PES-01, RF-PES-01, RF-PES-04) e do prazo de
 * vigência pela hora do aparelho com tolerância (RN-PES-04). A API sempre revalida; o app usa a mesma função
 * antes de gravar na outbox (modo `rascunho` no salvamento automático, `final` ao concluir).
 */
import type { ItemResposta, QuestionarioVersao, RespostaEnvio, Vigencia } from '../contracts';
import { calcularVisiveis } from './condicional';
import { PARAMETROS_PADRAO, type ParametrosPesquisa } from './parametros';
import { itemRespondido, validarItem, type ErroResposta } from './resposta-item';
import { instanteMs } from './util';

export interface ValidacaoResposta {
  valida: boolean;
  erros: ErroResposta[];
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
  const falhar = (codigo: ErroResposta['codigo'], mensagem: string, pergunta_id: string | null = null) => erros.push({ codigo, pergunta_id, mensagem });

  if (resposta.versao_id !== versao.id || resposta.questionario_id !== versao.questionario_id) {
    falhar('VERSAO_INEXISTENTE', 'A resposta é de outra versão do questionário. Atualize o app e responda de novo.');
    return { valida: false, erros };
  }
  if (versao.status !== 'publicada') {
    falhar('VERSAO_NAO_PUBLICADA', 'Essa versão do questionário ainda não foi publicada, então não recebe respostas.');
    return { valida: false, erros };
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
  }

  if (modo === 'final') {
    const feitas = new Set(respondidos.map((i) => i.pergunta_id));
    for (const p of versao.perguntas) {
      if (p.obrigatoria && visiveis.has(p.id) && !feitas.has(p.id)) falhar('OBRIGATORIA', `Responda a pergunta obrigatória "${p.enunciado}".`, p.id);
    }
    if (respondidos.length === 0 && erros.length === 0) falhar('SEM_RESPOSTAS', 'Responda ao menos uma pergunta antes de enviar.');
  }
  return { valida: erros.length === 0, erros };
}

export type CodigoVigencia = 'ANTES_DA_VIGENCIA' | 'APOS_A_VIGENCIA' | 'RELOGIO_ADIANTADO';

export interface ResultadoVigencia {
  valida: boolean;
  codigo?: CodigoVigencia;
  mensagem?: string;
}

const HORA_MS = 3_600_000;

/**
 * RN-PES-04: a resposta guarda a hora do aparelho e a de recebimento. O prazo de vigência usa a hora do APARELHO
 * (resposta feita offline no prazo vale mesmo sincronizada depois), com tolerância de [24 h] nas duas pontas. Premissa
 * T-0012: aparelho com relógio adiantado além da tolerância em relação ao servidor é recusado (evita burlar o prazo).
 */
export function validarVigenciaDaResposta(vigencia: Vigencia, horas: { respondida_em: string; recebida_em: string }, tolerancia_h: number): ResultadoVigencia {
  const tol = tolerancia_h * HORA_MS;
  const feita = instanteMs(horas.respondida_em);
  if (feita > instanteMs(horas.recebida_em) + tol) {
    return { valida: false, codigo: 'RELOGIO_ADIANTADO', mensagem: 'A hora do aparelho está adiantada em relação ao servidor. Acerte o relógio do celular e responda de novo.' };
  }
  if (feita < instanteMs(vigencia.inicio) - tol) {
    return { valida: false, codigo: 'ANTES_DA_VIGENCIA', mensagem: 'A resposta foi feita antes de a pesquisa começar a valer (vigência).' };
  }
  if (vigencia.fim !== null && feita > instanteMs(vigencia.fim) + tol) {
    return { valida: false, codigo: 'APOS_A_VIGENCIA', mensagem: 'A resposta foi feita depois do fim da vigência da pesquisa, além da tolerância. Fale com o supervisor se precisar registrá-la.' };
  }
  return { valida: true };
}
