/**
 * Consulta `pesquisa.resposta_local@1` na API (T-0170, ADR 0012/0019; RN-PES-02). O SDK exige que toda consulta oferecida
 * tenha implementação na API; aqui "local" = as respostas JÁ sincronizadas do próprio usuário da requisição. Só lê o
 * schema da Pesquisa (pelo repositório, RLS do tenant). A regra está no domain (`respostaLocalMaisRecente`).
 */
import { ConsultaIndisponivel, implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_RESPOSTA_LOCAL } from '../contracts/consulta-tarefa';
import { respostaLocalMaisRecente } from '../domain/tarefa-pesquisa';
import type { FabricaRepositorio } from './repositorio';

export function criarConsultaRespostaLocalApi(fabrica: FabricaRepositorio) {
  return implementarConsulta(CONSULTA_RESPOSTA_LOCAL, async (entrada, ctx) => {
    // licença do módulo (RN-CORE-03): sem Pesquisa, a consulta fica indisponível
    if (!ctx.usuario.modulos.includes('pesquisa')) throw new ConsultaIndisponivel(CONSULTA_RESPOSTA_LOCAL.nome, 'pesquisa');
    const repo = fabrica(ctx.usuario.tenant_id, ctx.db);
    const respostas = await repo.listarRespostas(entrada.questionario_id);
    return { resposta_id: respostaLocalMaisRecente(respostas.filter((r) => r.usuario_id === ctx.usuario.id), entrada) };
  });
}
