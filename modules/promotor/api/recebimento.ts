/**
 * Recebimento das coletas do promotor (T-0056) — o mesmo caminho para o push do sync (app offline) e para as rotas REST.
 * Ordem, por item e na transação do tenant (`ctx.comTenant`):
 *  1. perfil: só o promotor coleta (doc 03 §2) — a licença do módulo a plataforma já conferiu;
 *  2. visita de loja: do próprio promotor (RN-CORE-04) e coleta dentro da janela check-in..checkout (RN-PRO-02);
 *  3. carteira: a loja está na carteira de quem envia (RN-CORE-04);
 *  4. idempotência: mesmo id e mesmo conteúdo = repetida; conteúdo diferente = conflito;
 *  5. regras do domain que dependem do servidor: fotos da mesma visita (RN-PRO-02), variação de preço (RN-PRO-04),
 *     checklist obrigatório no checkout (RN-PRO-06), permanência recalculada (RN-PRO-07);
 *  6. grava e publica o evento `promotor.*@1` na MESMA transação (outbox; payload validado pelo schema do contrato).
 * As regras de forma (share, índice, atingimento, conformidade…) já vieram validadas pelo contrato Zod (`coletas.ts`).
 * RN-PRO-01: nada aqui toca em pedido. Sem dado pessoal em log.
 */
import { verificarCarteira, type ContextoBase, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  EVENTO_GONDOLA_REGISTRADA,
  EVENTO_PRECO_COLETADO,
  EVENTO_RUPTURA_REGISTRADA,
  EVENTO_SHARE_MEDIDO,
  EVENTO_TAREFA_CONCLUIDA,
  EVENTO_VISITA_LOJA_CONCLUIDA,
  type ColetaPreco,
  type FotoColeta,
  type GondolaRegistro,
  type MedicaoShare,
  type RupturaItem,
  type TarefaExecucao,
  type VisitaLoja,
} from '../contracts';
import {
  arredondar,
  avaliarColeta,
  checkoutRespeitaChecklist,
  ErroPayloadEvento,
  eventoGondolaRegistrada,
  eventoPrecoColetado,
  eventoRupturaRegistrada,
  eventoShareMedido,
  eventoTarefaConcluida,
  eventoVisitaLojaConcluida,
  fotosReferenciadas,
  instanteDaColeta,
  mesmoConteudo,
  permanenciaMinutos,
  podeColetar,
  recusaDeFotos,
  recusaDeVariacaoDePreco,
  transicaoVisitaLoja,
  type ColetaDaVisita,
  type EventoPromotor,
  type OrigemEvento,
  type RecusaColeta,
  type VisitaLojaGuardada,
} from '../domain';
import { parametrosDoTenant } from './parametros';
import type { RepositorioPromotor, SessaoTenant } from './repositorio';

export type ResultadoRecebimento =
  | { tipo: 'aceito'; situacao: 'criada' | 'repetida' | 'checkout' }
  | { tipo: 'recusa'; recusa: RecusaColeta }
  | { tipo: 'conflito'; mensagem: string };

const recusa = (r: RecusaColeta): ResultadoRecebimento => ({ tipo: 'recusa', recusa: r });
const FORA_DA_CARTEIRA: RecusaColeta = { http: 403, codigo: 'FORA_DA_CARTEIRA', mensagem: 'Loja fora da sua carteira.' };
const SEM_PERFIL: RecusaColeta = { http: 403, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Só o promotor registra coletas de trade.' };

async function naCarteira(ctx: ContextoBase, clienteId: string): Promise<boolean> {
  return verificarCarteira(clienteId, await ctx.carteira()).ok;
}

/** Evento inválido aqui é bug (o contrato já validou a coleta): a coleta é recusada junto, nada sai pela metade. */
function recusaDeEvento(e: unknown): ResultadoRecebimento {
  if (e instanceof ErroPayloadEvento) return recusa({ http: 422, codigo: 'EVENTO_INVALIDO', mensagem: e.message });
  throw e;
}

/** Evento `@1` da coleta (validado agora) e a função que o publica na transação; `null` = coleta sem evento. */
function eventoDaColeta(tx: TransacaoTenant, entidade: ColetaDaVisita, payload: Record<string, unknown> & { id: string }, origem: OrigemEvento): (() => Promise<unknown>) | null {
  switch (entidade) {
    case 'gondola_registro': {
      const ev = eventoGondolaRegistrada(payload as unknown as GondolaRegistro, origem);
      return () => tx.publicar(EVENTO_GONDOLA_REGISTRADA, ev.payload, payload.id);
    }
    case 'medicao_share': {
      const ev = eventoShareMedido(payload as unknown as MedicaoShare, origem);
      return () => tx.publicar(EVENTO_SHARE_MEDIDO, ev.payload, payload.id);
    }
    case 'coleta_preco': {
      const ev = eventoPrecoColetado(payload as unknown as ColetaPreco, origem);
      return () => tx.publicar(EVENTO_PRECO_COLETADO, ev.payload, payload.id);
    }
    case 'ruptura_item': {
      const ev = eventoRupturaRegistrada(payload as unknown as RupturaItem, origem);
      return () => tx.publicar(EVENTO_RUPTURA_REGISTRADA, ev.payload, payload.id);
    }
    case 'tarefa_execucao': {
      const ev = eventoTarefaConcluida(payload as unknown as TarefaExecucao, { promotor_id: origem.promotor_id });
      return () => tx.publicar(EVENTO_TAREFA_CONCLUIDA, ev.payload, payload.id);
    }
    default:
      return null; // foto, checklist, validade, ponto extra e concorrência não têm evento @1
  }
}

export function criarRecebimento(repo: RepositorioPromotor) {
  /** `visita_loja`: check-in (1º envio), checkout (mesmo id, fechada) ou reenvio idempotente. */
  async function visitaLoja(ctx: ContextoBase, s: SessaoTenant, tx: TransacaoTenant, v: VisitaLoja): Promise<ResultadoRecebimento> {
    const eu = ctx.usuario.id;
    if (!podeColetar(ctx.usuario.perfil)) return recusa(SEM_PERFIL);
    if (!(await naCarteira(ctx, v.cliente_id))) return recusa(FORA_DA_CARTEIRA);

    // RN-PRO-07: a permanência gravada é a recalculada (o contrato já recusou a que diverge além da tolerância)
    const nova: Omit<VisitaLojaGuardada, 'promotor_id'> = {
      ...v,
      permanencia_min: v.checkout_em === null ? null : arredondar(permanenciaMinutos(v.checkin_em, v.checkout_em)),
      observacao: v.observacao ?? null,
    };
    const atual = await repo.visita(s, v.id);
    const t = transicaoVisitaLoja(atual, nova, eu);
    if (t.tipo === 'recusa') return recusa({ http: 409, codigo: t.codigo, mensagem: t.mensagem });
    if (t.tipo === 'conflito') return { tipo: 'conflito', mensagem: t.mensagem };
    if (t.tipo === 'repetida') return { tipo: 'aceito', situacao: 'repetida' };

    let evento: EventoPromotor<'promotor.visita_loja.concluida@1'> | null = null;
    if (nova.checkout_em !== null && nova.desfecho !== null) {
      const respostas = (await repo.coletasDasVisitas(s, 'checklist_resposta', [v.id])).map((c) => c.payload as { checklist_item_id: string; obrigatoria: boolean; concluida: boolean });
      const m = checkoutRespeitaChecklist(nova.desfecho, respostas);
      if (m) return recusa({ http: 422, codigo: 'RN-PRO-06', mensagem: m });
      const fotos = (await repo.coletasDasVisitas(s, 'foto_coleta', [v.id])).map((c) => c.payload as Pick<FotoColeta, 'visita_loja_id' | 'sem_gps'>);
      try {
        evento = eventoVisitaLojaConcluida({ ...v, permanencia_min: nova.permanencia_min }, { promotor_id: eu }, fotos);
      } catch (e) {
        return recusaDeEvento(e);
      }
    }
    await repo.gravarVisita(s, { ...nova, promotor_id: eu });
    if (evento) await tx.publicar(EVENTO_VISITA_LOJA_CONCLUIDA, evento.payload, v.id);
    return { tipo: 'aceito', situacao: t.tipo === 'checkout' ? 'checkout' : 'criada' };
  }

  /** Demais coletas da visita (fotos, checklist, gôndola, share, preço, ruptura, validade, ponto extra, concorrência, tarefa). */
  async function coleta(ctx: ContextoBase, s: SessaoTenant, tx: TransacaoTenant, entidade: ColetaDaVisita, payload: Record<string, unknown> & { id: string; visita_loja_id: string }): Promise<ResultadoRecebimento> {
    const eu = ctx.usuario.id;
    if (!podeColetar(ctx.usuario.perfil)) return recusa(SEM_PERFIL);

    // idempotência primeiro: o reenvio de uma coleta aceita continua aceito mesmo depois do checkout
    const ja = await repo.coleta(s, entidade, payload.id);
    if (ja) {
      if (ja.promotor_id !== eu) return recusa({ http: 409, codigo: 'ID_EM_USO', mensagem: 'Este identificador de coleta já pertence a outro registro.' });
      return mesmoConteudo(ja.payload, payload) ? { tipo: 'aceito', situacao: 'repetida' } : { tipo: 'conflito', mensagem: 'Esta coleta já foi recebida com outro conteúdo. Registre uma nova coleta.' };
    }

    const visita = await repo.visita(s, payload.visita_loja_id);
    const r = avaliarColeta({ perfil: ctx.usuario.perfil, usuario_id: eu, visita, instante: instanteDaColeta(entidade, payload) });
    if (r) return recusa(r);
    const v = visita!;
    if (!(await naCarteira(ctx, v.cliente_id))) return recusa(FORA_DA_CARTEIRA);
    if (entidade === 'tarefa_execucao' && (payload as unknown as TarefaExecucao).cliente_id !== v.cliente_id) {
      return recusa({ http: 422, codigo: 'RN-PRO-02', mensagem: 'A tarefa foi concluída em outra loja: registre-a na visita daquela loja.' });
    }

    // RN-PRO-02: as fotos referenciadas são desta visita e já chegaram (a foto vai antes da coleta na fila)
    if (entidade !== 'foto_coleta') {
      const daVisita = new Set<string>();
      const deOutra = new Set<string>();
      for (const id of fotosReferenciadas(payload)) {
        const f = await repo.coleta(s, 'foto_coleta', id);
        if (f && f.visita_loja_id === v.id && f.promotor_id === eu) daVisita.add(id);
        else if (f) deOutra.add(id);
      }
      const rf = recusaDeFotos(fotosReferenciadas(payload), daVisita, deOutra);
      if (rf) return recusa(rf);
    }
    if (entidade === 'coleta_preco') {
      const rp = recusaDeVariacaoDePreco(payload as unknown as ColetaPreco, parametrosDoTenant(ctx).variacao_preco_max_pct);
      if (rp) return recusa(rp);
    }

    // o evento é montado (e validado pelo schema) ANTES de gravar: se não fechar, nada é gravado
    let publicar: (() => Promise<unknown>) | null;
    try {
      publicar = eventoDaColeta(tx, entidade, payload, { promotor_id: eu, cliente_id: v.cliente_id });
    } catch (e) {
      return recusaDeEvento(e);
    }
    if (entidade === 'foto_coleta') {
      // ADR 0010: a linha do arquivo nasce com o comando que o referencia; o upload só a completa
      const f = payload as unknown as FotoColeta;
      await tx.registrarArquivo({ id: f.id, finalidade: f.tipo, entidade: 'visita_loja', entidade_id: v.id, cliente_id: v.cliente_id });
    }
    await repo.gravarColeta(s, { entidade, id: payload.id, visita_loja_id: v.id, promotor_id: eu, cliente_id: v.cliente_id, payload, recebido_em: ctx.agora().toISOString() });
    if (publicar) await publicar();
    return { tipo: 'aceito', situacao: 'criada' };
  }

  return { visitaLoja, coleta };
}

export type Recebimento = ReturnType<typeof criarRecebimento>;
