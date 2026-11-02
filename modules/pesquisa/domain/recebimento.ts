/**
 * Recebimento da resposta no servidor (RF-PES-04, RN-PES-01, RN-PES-04): a mesma decisão para o push do sync e para
 * qualquer rota que grave resposta. Ordem: idempotência (mesmo id) → versão citada → perfil no público → validação
 * completa → flag de suspeita. Devolve a resposta a gravar e o payload do evento `pesquisa.resposta.registrada@1`.
 * Função pura: quem chama grava, publica e audita na mesma transação.
 */
import type { Questionario, QuestionarioVersao, RespostaEnvio, RespostaPesquisa, RespostaRegistradaV1 } from '../contracts';
import { decidirInsercao } from './idempotencia';
import { resolverParametros, type ParametrosPesquisa } from './parametros';
import { perfilNoPublico } from './publico';
import { versaoDaResposta } from './questionario';
import { avaliarRecebimentoDaResposta, validarResposta } from './resposta';
import type { AvisoResposta, ErroResposta } from './resposta-item';
import { falha, ok, type Resultado } from './util';

export interface EntradaRecebimento {
  questionario: Questionario;
  versoes: readonly QuestionarioVersao[];
  envio: RespostaEnvio;
  /** Resposta já gravada com o mesmo id (ou `null`). */
  existente: RespostaPesquisa | null;
  /** Quem enviou (do token) e a equipe direta dele agora (o Core informa; `null` sem equipe). */
  usuario: { id: string; perfil: string; equipe_id: string | null };
  tenant_id: string;
  /** Relógio do servidor (RN-PES-04). */
  recebida_em: string;
  parametros?: Partial<ParametrosPesquisa>;
}

export type Recebimento =
  | { resultado: 'inserir'; resposta: RespostaPesquisa; evento: RespostaRegistradaV1; avisos: AvisoResposta[] }
  | { resultado: 'duplicada'; resposta: RespostaPesquisa };

export type CodigoRecusaRecebimento = 'CONFLITO_DE_CONTEUDO' | 'VERSAO_INEXISTENTE' | 'VERSAO_NAO_PUBLICADA' | 'PERFIL_FORA_DO_PUBLICO' | 'RESPOSTA_INVALIDA';

/** RF-PES-04 / RN-PES-04: decide o que fazer com a resposta recebida. Nunca recusa por relógio, vigência ou arquivamento. */
export function receberResposta(e: EntradaRecebimento): Resultado<Recebimento, CodigoRecusaRecebimento, ErroResposta> {
  const parametros = resolverParametros(e.parametros);
  if (e.existente) {
    const d = decidirInsercao(e.existente, e.envio);
    if (d.resultado === 'duplicada') return ok({ resultado: 'duplicada', resposta: e.existente });
    if (d.resultado === 'conflito') return falha(d.codigo, d.mensagem);
  }

  const v = versaoDaResposta(e.versoes, e.envio);
  if (!v.ok) return v;
  const versao = v.valor;

  if (!perfilNoPublico(versao.publico_alvo, e.usuario)) {
    return falha('PERFIL_FORA_DO_PUBLICO', 'Esta pesquisa não é para o seu perfil. Atualize o app para ver as pesquisas disponíveis para você.');
  }

  const validacao = validarResposta(versao, e.envio, { modo: 'final', parametros });
  if (!validacao.valida) {
    return falha('RESPOSTA_INVALIDA', `A resposta tem ${validacao.erros.length} problema(s): ${validacao.erros[0]!.mensagem}`, validacao.erros);
  }

  const aval = avaliarRecebimentoDaResposta(versao.vigencia, { respondida_em: e.envio.respondida_em, recebida_em: e.recebida_em }, parametros.tolerancia_vigencia_h);
  const resposta: RespostaPesquisa = {
    ...e.envio,
    tenant_id: e.tenant_id,
    usuario_id: e.usuario.id,
    equipe_id: e.usuario.equipe_id,
    recebida_em: e.recebida_em,
    suspeita: aval.suspeita,
    motivos_suspeita: aval.motivos,
  };
  const evento: RespostaRegistradaV1 = {
    resposta_id: resposta.id,
    tenant_id: e.tenant_id,
    questionario_id: resposta.questionario_id,
    versao_id: resposta.versao_id,
    usuario_id: resposta.usuario_id,
    equipe_id: resposta.equipe_id,
    cliente_id: resposta.cliente_id,
    visita_id: resposta.visita_id,
    modo: versao.modo,
    respondida_em: resposta.respondida_em,
    recebida_em: resposta.recebida_em,
    total_itens: resposta.itens.length,
    suspeita: aval.suspeita,
  };
  return ok({ resultado: 'inserir', resposta, evento, avisos: validacao.avisos });
}
