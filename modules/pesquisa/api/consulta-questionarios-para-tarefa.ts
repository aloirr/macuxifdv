/**
 * Consulta `pesquisa.questionarios_para_tarefa@1` na API (T-0170, ADR 0012/0019; RF-PES-02). Só lê o schema da Pesquisa (pelo
 * repositório, RLS do tenant) e nunca escreve. A regra está no domain (`questionariosParaTarefa`).
 * Limite conhecido: a consulta recebe só ids; o perfil só é conhecido para o próprio usuário da requisição e a equipe não
 * chega. Atributo desconhecido não marca ninguém como fora do público (não bloqueia a tarefa por engano).
 */
import { ConsultaIndisponivel, implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_QUESTIONARIOS_PARA_TAREFA } from '../contracts/consulta-tarefa';
import { questionariosParaTarefa } from '../domain/tarefa-pesquisa';
import type { FabricaRepositorio } from './repositorio';

export function criarConsultaQuestionariosParaTarefa(fabrica: FabricaRepositorio) {
  return implementarConsulta(CONSULTA_QUESTIONARIOS_PARA_TAREFA, async (entrada, ctx) => {
    // licença do módulo (RN-CORE-03): sem Pesquisa, a consulta fica indisponível
    if (!ctx.usuario.modulos.includes('pesquisa')) throw new ConsultaIndisponivel(CONSULTA_QUESTIONARIOS_PARA_TAREFA.nome, 'pesquisa');
    const repo = fabrica(ctx.usuario.tenant_id, ctx.db);
    const todas = await repo.listarQuestionarios();
    const usuarios = entrada.usuario_ids.map((id) => ({ id, perfil: id === ctx.usuario.id ? ctx.usuario.perfil : null, equipe_ids: null }));
    return questionariosParaTarefa(
      todas.map((q) => ({ questionario: q.questionario, versoes: q.versoes })),
      usuarios,
      ctx.agora().toISOString(),
    );
  });
}
