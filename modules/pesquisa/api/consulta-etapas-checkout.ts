/**
 * Consulta `pesquisa.etapas_checkout@1` na API (ADR 0012; T-0039; RN-PES-03, RN-CORE-12). Só lê o schema da Pesquisa (pelo
 * repositório, na transação de quem consulta, com RLS do tenant) e nunca escreve. A regra está no domain
 * (`verificarEtapasCheckoutServidor`); aqui só se montam as entradas.
 *
 * Limites conhecidos (a consulta recebe só `visita_id`, `cliente_id`, `usuario_id`, `cliente_fechado`, e o contexto de consulta
 * não chama outros módulos): perfil vem do usuário da requisição (o checkout é do próprio usuário); equipe, segmento e região
 * do cliente não chegam. Pesquisa com público restrito por equipe, segmento ou região, que a consulta não consegue verificar,
 * NÃO vira etapa obrigatória (falha para o lado de liberar, nunca de bloquear a visita por engano); pesquisa sem restrição
 * ou restrita por perfil e por cliente nominal é verificada normalmente. Pedido de campos aditivos feito ao Core.
 */
import { implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_ETAPAS_CHECKOUT_PESQUISA } from '../contracts';
import { verificarEtapasCheckoutServidor, versaoVigente, type PesquisaDoTenant, type RespostaAnterior } from '../domain';
import type { FabricaRepositorio } from './repositorio';

export function criarConsultaEtapasCheckout(fabrica: FabricaRepositorio) {
  return implementarConsulta(CONSULTA_ETAPAS_CHECKOUT_PESQUISA, async (entrada, ctx) => {
    const repo = fabrica(ctx.usuario.tenant_id, ctx.db);
    const todas = await repo.listarQuestionarios();
    // só as que hoje têm versão vigente obrigatória no checkout: evita ler respostas de pesquisa avulsa
    const obrigatorias: PesquisaDoTenant[] = todas
      .filter((q) => versaoVigente(q.questionario, q.versoes)?.modo === 'checkout_obrigatoria')
      .map((q) => ({ questionario: q.questionario, versoes: q.versoes }));
    if (obrigatorias.length === 0) return { etapas: [] };

    // `desde`: 70 dias cobrem o início do mês anterior em qualquer fuso (semana e mês); o domain decide pela virada no fuso.
    const desde = new Date(ctx.agora().getTime() - 70 * 24 * 3600 * 1000).toISOString();
    const respostas: RespostaAnterior[] = await repo.respostasParaCheckout({
      questionario_ids: obrigatorias.map((o) => o.questionario.id),
      visita_id: entrada.visita_id,
      cliente_id: entrada.cliente_id,
      usuario_id: entrada.usuario_id,
      desde,
    });

    // O checkout é do próprio usuário da requisição; se o Core perguntar por outro, o perfil é desconhecido ('') e só valem
    // pesquisas sem restrição de perfil.
    const perfil = entrada.usuario_id === ctx.usuario.id ? ctx.usuario.perfil : '';
    const etapas = verificarEtapasCheckoutServidor({
      pesquisas: obrigatorias,
      usuario: { id: entrada.usuario_id, perfil, equipe_ids: [] },
      cliente: { id: entrada.cliente_id, segmento: null, regiao: null },
      visita_id: entrada.visita_id,
      agora: ctx.agora().toISOString(),
      respostas,
      fuso: ctx.fuso(),
      cliente_fechado: entrada.cliente_fechado,
    });
    return { etapas };
  });
}
