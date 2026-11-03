/**
 * Push das coletas pelo sync (`/v1/sync/push`; ADR 0009, T-0056). A plataforma já conferiu a licença do módulo
 * (MODULO_INATIVO) e o schema do contrato (PAYLOAD_INVALIDO); aqui roda o `recebimento` (perfil, RN-PRO-02, carteira,
 * idempotência, RN-PRO-04/06/07, evento na outbox). Cada item na própria transação: regra violada rejeita só o item.
 * Dependência que ainda não chegou (visita ou foto da coleta, retentável) volta `SYNC_NAO_IMPLEMENTADO`: o motor do app
 * mantém o item `pendente` e o reenvia — o lote do push agrupa por entidade e não garante a ordem entre elas.
 * Os cadastros de trade (pull pelo cursor) têm provedores em `sync-cadastros.ts`.
 */
import { ErroHttpModulo, SYNC_NAO_IMPLEMENTADO, type ContextoBase, type ItemPush, type ProvedorSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { ENTIDADES_COLETA, type VisitaLoja } from '../contracts';
import type { ColetaDaVisita } from '../domain';
import type { Recebimento, ResultadoRecebimento } from './recebimento';

const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });

/** Resultado do recebimento → resultado do item do push. */
export function resultadoDoPush(id: string, r: ResultadoRecebimento): ResultadoItemPush {
  if (r.tipo === 'aceito') return { id, status: 'aceito' };
  if (r.tipo === 'conflito') return { id, status: 'conflito', mensagem: r.mensagem };
  if (r.recusa.retentavel) return rejeitado(id, SYNC_NAO_IMPLEMENTADO, `${r.recusa.mensagem} (${r.recusa.codigo})`);
  return rejeitado(id, r.recusa.codigo, r.recusa.mensagem);
}

async function porItem(ctx: ContextoBase, itens: readonly ItemPush[], fn: (item: ItemPush, payload: Record<string, unknown> & { id: string; visita_loja_id: string }) => Promise<ResultadoItemPush>): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    const payload = item.payload as Record<string, unknown> & { id: string; visita_loja_id: string };
    if (item.operacao === 'remover') {
      saida.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'Coleta de trade não é removida pelo aparelho.'));
      continue;
    }
    if (payload.id !== item.id) {
      saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id da coleta.'));
      continue;
    }
    try {
      saida.push(await fn(item, payload));
    } catch (e) {
      if (!(e instanceof ErroHttpModulo) || e.status >= 500) throw e; // erro de banco: o lote volta inteiro para o aparelho reenviar
      saida.push(rejeitado(item.id, e.codigo, e.message));
    }
  }
  return saida;
}

/** Um provedor de push por entidade de coleta, todos sobre o mesmo recebimento. */
export function provedoresSyncPromotor(recebimento: Recebimento): ProvedorSync[] {
  const sessao = (ctx: ContextoBase) => ctx.usuario.tenant_id;
  const visita: ProvedorSync = {
    entidade: ENTIDADES_COLETA.visita_loja,
    receber: (ctx, itens) =>
      porItem(ctx, itens, (item, payload) =>
        ctx.comTenant(async (db, tx) => resultadoDoPush(item.id, await recebimento.visitaLoja(ctx, { db, tenant_id: sessao(ctx) }, tx, payload as unknown as VisitaLoja))),
      ),
  };
  const coletas = (Object.keys(ENTIDADES_COLETA).filter((n) => n !== 'visita_loja') as ColetaDaVisita[]).map(
    (nome): ProvedorSync => ({
      entidade: ENTIDADES_COLETA[nome],
      receber: (ctx, itens) =>
        porItem(ctx, itens, (item, payload) => ctx.comTenant(async (db, tx) => resultadoDoPush(item.id, await recebimento.coleta(ctx, { db, tenant_id: sessao(ctx) }, tx, nome, payload)))),
    }),
  );
  return [visita, ...coletas];
}
