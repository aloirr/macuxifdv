/**
 * Consulta `pesquisa.resposta_local@1` no aparelho (T-0170, ADR 0019; RN-PES-02): a resposta local mais recente de um
 * questionário (e cliente), inclusive a ainda não sincronizada, para mostrar "Respondida" sem rede. A fonte das respostas
 * locais (pull + fila do motor) é injetada; a regra está no domain (`respostaLocalMaisRecente`).
 */
import { implementarConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_RESPOSTA_LOCAL } from '../../contracts/consulta-tarefa';
import { respostaLocalMaisRecente, type RespostaLocalLida } from '../../domain/tarefa-pesquisa';

export type FonteRespostasLocais = () => Promise<readonly RespostaLocalLida[]>;

export function criarConsultaRespostaLocal(fonte: FonteRespostasLocais) {
  return implementarConsultaAparelho(CONSULTA_RESPOSTA_LOCAL, async (entrada) => ({
    resposta_id: respostaLocalMaisRecente(await fonte(), entrada),
  }));
}
