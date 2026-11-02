/**
 * Sync da Pesquisa (ADR 0006/0009): pull de `questionario_versao` (publicadas, escopo tenant — o aparelho decide a
 * oferta pelo público, offline) e de `resposta_pesquisa` (resumo, escopo carteira + próprias, RN-PES-02); push de
 * `resposta_pesquisa` (RF-PES-04: só inserção, idempotente pelo UUID do aparelho), cada item na sua transação.
 * O recebimento revalida tudo no domain (`receberResposta`), grava, liga as fotos (ADR 0010) e publica
 * `pesquisa.resposta.registrada@1` na mesma transação.
 */
import { ErroHttpModulo, type ContextoBase, type ItemPush, type LinhaSync, type PedidoPull, type ProvedorSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { DEF_RESPOSTA_REGISTRADA, entidadeQuestionarioVersao, entidadeRespostaPesquisa, PERFIS_QUE_RESPONDEM, RespostaEnvio } from '../contracts';
import { receberResposta, respostaNoEscopoDoAparelho } from '../domain';
import { comRepositorio, parametrosDaRota } from './comum';
import type { FabricaRepositorio, JanelaPull } from './repositorio';

const janela = (p: PedidoPull): JanelaPull => ({ desde: p.desde ? { updated_at: p.desde.updated_at, id: p.desde.id } : null, ate: p.ate, limite: p.limite });

const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });

/** RF-PES-04: recebe um item do push. Nunca lança por regra: devolve aceito, rejeitado (com código) ou conflito. */
export async function receberUma(ctx: ContextoBase, fabrica: FabricaRepositorio, item: ItemPush, carteira: ReadonlySet<string> | 'tenant'): Promise<ResultadoItemPush> {
  if (item.operacao === 'remover') return rejeitado(item.id, 'SOMENTE_INSERCAO', 'Resposta de pesquisa não pode ser apagada depois de enviada.');
  if (!(PERFIS_QUE_RESPONDEM as readonly string[]).includes(ctx.usuario.perfil)) return rejeitado(item.id, 'PERFIL_SEM_ACESSO', 'Seu perfil não responde pesquisas.');
  const p = RespostaEnvio.safeParse(item.payload);
  if (!p.success) return rejeitado(item.id, 'PAYLOAD_INVALIDO', p.error.issues[0]?.message ?? 'Resposta em formato inválido.');
  const envio = p.data;
  if (envio.id !== item.id) return rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id da resposta difere do id do item enviado.');
  // RN-CORE-04: resposta ligada a cliente só no escopo da carteira
  if (envio.cliente_id !== null && carteira !== 'tenant' && !carteira.has(envio.cliente_id)) return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira.');
  const parametros = parametrosDaRota(ctx);
  const agora = ctx.agora().toISOString();
  try {
    return await comRepositorio(ctx, fabrica, async (repo, tx) => {
      const c = await repo.carregar(envio.questionario_id);
      if (!c) return rejeitado(item.id, 'QUESTIONARIO_INEXISTENTE', 'Esta pesquisa não existe mais. Atualize o app.');
      const r = receberResposta({
        questionario: c.questionario,
        versoes: c.versoes,
        envio,
        existente: await repo.obterResposta(envio.id),
        // Premissa T-0057: a equipe do usuário vem do Core quando ele oferecer a consulta; até lá, null
        usuario: { id: ctx.usuario.id, perfil: ctx.usuario.perfil, equipe_id: null },
        tenant_id: ctx.usuario.tenant_id,
        recebida_em: agora,
        parametros,
      });
      if (!r.ok) return r.codigo === 'CONFLITO_DE_CONTEUDO' ? { id: item.id, status: 'conflito' as const, mensagem: r.mensagem } : rejeitado(item.id, r.codigo, r.mensagem);
      if (r.valor.resultado === 'duplicada') return { id: item.id, status: 'aceito' as const, em: agora };
      const { resposta, evento } = r.valor;
      // fotos e evento antes da resposta: se algum falhar (ex.: 409 ARQUIVO_JA_REFERENCIADO), nada fica gravado —
      // a transação do banco desfaz e o repositório em memória (sem transação) nem chega a inserir
      for (const it of resposta.itens) {
        if (it.tipo !== 'foto') continue;
        for (const f of it.fotos) await tx.registrarArquivo({ id: f.id, finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: resposta.id, cliente_id: resposta.cliente_id, tipo: 'image/jpeg' });
      }
      await tx.publicar(DEF_RESPOSTA_REGISTRADA, evento, resposta.id);
      await repo.inserirResposta(resposta, agora);
      return { id: item.id, status: 'aceito' as const, em: agora };
    });
  } catch (e) {
    if (e instanceof ErroHttpModulo) return rejeitado(item.id, e.codigo, e.message);
    throw e;
  }
}

export function provedoresSync(fabrica: FabricaRepositorio): ProvedorSync[] {
  return [
    {
      entidade: entidadeQuestionarioVersao,
      escopo: 'tenant',
      puxar: (ctx, p) => comRepositorio(ctx, fabrica, async (repo) => (await repo.puxarVersoes(janela(p))) as unknown as LinhaSync[]),
    },
    {
      entidade: entidadeRespostaPesquisa,
      escopo: 'carteira',
      puxar: async (ctx, p) => {
        const carteira = await ctx.carteira();
        return comRepositorio(ctx, fabrica, async (repo) => (await repo.puxarRespostas(janela(p), (r) => respostaNoEscopoDoAparelho(r, ctx.usuario.id, carteira))) as unknown as LinhaSync[]);
      },
      receber: async (ctx, itens) => {
        const carteira = await ctx.carteira();
        const saida: ResultadoItemPush[] = [];
        for (const item of itens) saida.push(await receberUma(ctx, fabrica, item, carteira));
        return saida;
      },
    },
  ];
}
