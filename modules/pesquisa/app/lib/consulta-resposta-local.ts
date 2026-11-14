/**
 * Consulta `pesquisa.resposta_local@1` no aparelho (T-0170, ADR 0019; RN-PES-02): a resposta local mais recente de um
 * questionário (e cliente), inclusive a ainda não sincronizada, para mostrar "Respondida" sem rede. A fonte das respostas
 * locais (pull + fila do motor) é injetada; a regra está no domain (`respostaLocalMaisRecente`).
 */
import { implementarConsultaAparelho, type ContextoConsultaAparelho } from '@macuxi/platform-sdk';
import { CONSULTA_RESPOSTA_LOCAL } from '../../contracts/consulta-tarefa';
import { respostaLocalMaisRecente, respostasLocaisDoUsuario, type RespostaLocalLida } from '../../domain/tarefa-pesquisa';
import type { RespostaPesquisaSync } from '../../contracts';
import { estadoLocal, respostasDaFila } from './local';

export type FonteRespostasLocais = (ctx: ContextoConsultaAparelho) => Promise<readonly RespostaLocalLida[]>;

export function criarConsultaRespostaLocal(fonte: FonteRespostasLocais) {
  return implementarConsultaAparelho(CONSULTA_RESPOSTA_LOCAL, async (entrada, ctx) => ({
    resposta_id: respostaLocalMaisRecente(await fonte(ctx), entrada),
  }));
}

/**
 * Fonte padrão do app: linhas do pull `resposta_pesquisa` (só as do usuário logado, sem apagadas) + as da fila do motor
 * (do próprio aparelho). Sem usuário logado, nada.
 */
export const fonteRespostasLocaisPadrao: FonteRespostasLocais = async (ctx) => {
  const usuario = ctx.usuario();
  if (!usuario) return [];
  const linhas = await ctx.linhas<RespostaPesquisaSync>('resposta_pesquisa');
  const fila = respostasDaFila(estadoLocal()?.leitor.sobreposicao(['resposta_pesquisa']) ?? []);
  return respostasLocaisDoUsuario(linhas, fila, usuario.id);
};
