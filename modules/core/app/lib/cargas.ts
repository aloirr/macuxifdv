/**
 * Cargas do Core para o aparelho que ainda vêm do REST da Fase M (etapas de sync do módulo — `moduloApp.etapasSync`):
 * só `metas` (T-0020) e `pedidos-da-visita` (ligação do pedido com a visita; o pedido real vem do Vendedor).
 * Carteira, rota do dia e visitas saíram daqui na T-0018: chegam pelo pull genérico (`entidades-cliente.ts`,
 * `entidades-rota.ts`) e a tela lê só o aparelho.
 */
import { monthStart } from '@macuxi/ui/mobile/puro';
import type { EtapaSync } from '@macuxi/platform-sdk';

import { InicioSchema, type SellerGoals } from '../../contracts';
import { CHAVES, fusoDe } from './estado';
import { erroDeCliente, exigirHttp } from './http';
import type { OrderLike } from './visit';

interface Pagina<T> {
  items: T[];
}

/** 404/501 (sem rota ou sync não implementado) = "vazio"; 401/403/423 seguem como erro (RN-CORE-15). */
async function ou4xxNulo<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    if (erroDeCliente(e)) return null;
    throw e;
  }
}

/** 401/423 sobem (sessão e aparelho bloqueado, RN-CORE-15); sem sinal, 403, 404 e 5xx mantêm a cópia anterior. */
const erroDeSessao = (e: unknown): boolean => {
  const s = (e as { status?: unknown } | null)?.status;
  return s === 401 || s === 423;
};

export const etapasCore: readonly EtapaSync[] = [
  {
    id: 'metas',
    rotulo: 'Metas e RV',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      // Só o vendedor tem meta nesta carga (Fase M): o mock-api da demo responde 400 validation_error ("Perfil sem vendedor")
      // a supervisor/gerente/promotor. Pular aqui evita derrubar o Sincronizar sem afrouxar o D-5 (401/403/423 seguem como erro).
      const perfil = ctx.usuario()?.perfil;
      if (perfil && perfil !== 'vendedor') {
        await ctx.armazenamento.gravar(CHAVES.metas, null);
        return;
      }
      const metas = await ou4xxNulo(() => http.get<SellerGoals>('/goals/me'));
      await ctx.armazenamento.gravar(CHAVES.metas, metas);
    },
  },
  {
    id: 'pedidos-da-visita',
    rotulo: 'Pedidos do mês (ligação com a visita)',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      const me = await ctx.armazenamento.ler<Parameters<typeof fusoDe>[0]>(CHAVES.me);
      // D-5: 403 MODULO_INATIVO sobe como erro (não é mais engolido); só 404/501 viram lista vazia.
      // TODO(REST de pedidos v1 com licença): pular esta etapa quando o Vendedor não for efetivo para o usuário
      // (`ctx.usuario()?.modulos`), em vez de depender do 403.
      const fuso = ctx.usuario()?.fuso ?? fusoDe(me);
      const r = (await ou4xxNulo(() => http.get<Pagina<OrderLike>>('/orders', { from: monthStart(ctx.agora(), fuso), limit: 1000 }))) ?? { items: [] };
      const pedidos: OrderLike[] = r.items.map((o) => ({ id: o.id, number: o.number, customer_id: o.customer_id, status: o.status, total_cents: o.total_cents, received_at: o.received_at, created_offline_at: o.created_offline_at ?? null }));
      await ctx.armazenamento.gravar(CHAVES.pedidos, pedidos);
    },
  },
  {
    // T-0073 §1.4: copia o realizado de vendas/positivação (até ontem × hoje) e os nomes da equipe para o aparelho.
    // Roda no ritmo do motor (RN-CORE-23: nenhum timer próprio). Falhou ou veio fora do contrato: mantém a cópia anterior.
    id: 'core-inicio',
    rotulo: 'Início (metas do dia)',
    modulo: 'core',
    async executar(ctx) {
      const http = exigirHttp(ctx);
      let corpo: unknown;
      try {
        corpo = await http.get<unknown>('/core/inicio');
      } catch (e) {
        if (erroDeSessao(e)) throw e;
        return;
      }
      const r = InicioSchema.safeParse(corpo);
      if (r.success) await ctx.armazenamento.gravar(CHAVES.inicio, r.data);
    },
  },
];
