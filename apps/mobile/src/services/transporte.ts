/**
 * Transportes do motor de sync (platform-sdk `TransporteSync`). Desenho T-0001 §13.
 *
 * - `v1`: contrato do doc 04 — `POST /v1/sync/push { itens }` e `GET /v1/sync/pull?entidade&cursor`
 *   (apps/api, T-0004). Erro de rede/5xx = exceção (o motor tenta de novo); 4xx no lote = rejeição por item.
 *   Fotos (ADR 0010): `PUT /v1/arquivos/:id` com o JPEG cru; 4xx vira rejeição com o código da API
 *   (`ARQUIVO_SEM_REFERENCIA` o motor mantém na fila).
 *   Novidades (RN-CORE-23, ADR 0018): `GET /v1/sync/novidades?desde=<cursor>` (sem cursor = sem `desde`); erro = exceção
 *   (o motor registra e tenta na próxima atualização).
 * - `fase-m` (demonstração, `EXPO_PUBLIC_API_MODO=demo` — mock-api): traduz a fila para o
 *   `POST /v1/sync/push { items: [{ kind }] }` da Fase M (pedido → order; visita → visit ou checkout)
 *   e não tem pull genérico (as cargas vêm das `etapasSync` REST dos módulos, B2).
 */
import {
  NovidadesRespostaSchema,
  type ItemPush,
  type LinhaSync,
  type PaginaSync,
  type ResultadoEnvioArquivo,
  type ResultadoItemPush,
  type TransporteSync,
} from '@macuxi/platform-sdk';

import type { ModoApi } from '@/lib/modo-api';

import { HttpError, type ApiClient } from './api';

export type ModoSync = 'fase-m' | 'v1';

/** Segue o modo da API: API real → v1; demonstração (mock-api) → fase-m. */
export function modoSync(modo: ModoApi): ModoSync {
  return modo === 'demo' ? 'fase-m' : 'v1';
}

// 401 = sessão (o item não tem culpa): o motor tenta de novo depois do novo login, sem rejeitar a fila
const retentavel = (e: unknown) => !(e instanceof HttpError) || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429;

/** Lote inteiro recusado com 4xx (ex.: 403 MODULO_INATIVO na rota): vira rejeição de cada item. */
function rejeitarLote(itens: ItemPush[], e: unknown): ResultadoItemPush[] {
  const err = e as HttpError;
  return itens.map((i) => ({ id: i.id, status: 'rejeitado' as const, codigo: err.code, mensagem: err.message }));
}

export function transporteV1(api: () => ApiClient): TransporteSync {
  return {
    async push(itens) {
      try {
        const r = await api().request<{ resultados: ResultadoItemPush[] }>('POST', '/sync/push', { body: { itens } });
        return r.data.resultados;
      } catch (e) {
        if (retentavel(e)) throw e;
        return rejeitarLote(itens, e);
      }
    },
    async pull(entidade, cursor) {
      return (await api().request<PaginaSync<LinhaSync>>('GET', '/sync/pull', { query: { entidade, cursor } })).data;
    },
    async novidades(desde) {
      const r = await api().request<unknown>('GET', '/sync/novidades', { query: desde ? { desde } : {} });
      return NovidadesRespostaSchema.parse(r.data);
    },
    async enviarArquivo(a): Promise<ResultadoEnvioArquivo> {
      try {
        // até 2 MB em rede de campo: prazo maior que o das chamadas JSON
        await api().request('PUT', `/arquivos/${encodeURIComponent(a.id)}`, { bytes: { dados: a.bytes, tipo: a.tipo }, timeoutMs: 60_000 });
        return { status: 'aceito' };
      } catch (e) {
        if (retentavel(e)) throw e;
        const err = e as HttpError;
        return { status: 'rejeitado', codigo: err.code, mensagem: err.message };
      }
    },
  };
}

type ItemFaseM =
  | { kind: 'order'; idempotency_key: string; payload: unknown }
  | { kind: 'visit'; idempotency_key: string; payload: unknown }
  | { kind: 'checkout'; idempotency_key: string; visit_id: string; payload: unknown };

/** Pedido → order; visita com `visit_id` + `outcome` → checkout; demais visitas → visit (check-in). */
export function itemDaFaseM(i: ItemPush): ItemFaseM | null {
  const p = (i.payload ?? {}) as Record<string, unknown>;
  if (i.entidade === 'pedido') return { kind: 'order', idempotency_key: i.id, payload: p };
  if (i.entidade === 'visita') {
    if (typeof p.visit_id === 'string' && 'outcome' in p) {
      const { visit_id, ...resto } = p;
      return { kind: 'checkout', idempotency_key: i.id, visit_id, payload: resto };
    }
    return { kind: 'visit', idempotency_key: i.id, payload: p };
  }
  return null;
}

export function transporteFaseM(api: () => ApiClient): TransporteSync {
  return {
    async push(itens) {
      const saida: ResultadoItemPush[] = [];
      const items: ItemFaseM[] = [];
      for (const i of itens) {
        const m = itemDaFaseM(i);
        if (m) items.push(m);
        else saida.push({ id: i.id, status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: `O servidor da Fase M não recebe ${i.entidade}.` });
      }
      if (items.length === 0) return saida;
      let r: { results: { idempotency_key: string; status: 'accepted' | 'rejected' | 'retry'; message: string }[] };
      try {
        r = (await api().request<typeof r>('POST', '/sync/push', { body: { items } })).data;
      } catch (e) {
        if (retentavel(e)) throw e;
        return [...saida, ...rejeitarLote(itens.filter((i) => items.some((m) => m.idempotency_key === i.id)), e)];
      }
      for (const x of r.results) {
        if (x.status === 'accepted') saida.push({ id: x.idempotency_key, status: 'aceito' });
        else if (x.status === 'rejected') saida.push({ id: x.idempotency_key, status: 'rejeitado', codigo: 'REJEITADO', mensagem: x.message });
        // 'retry' (planilha aberta no Excel): sem resultado → o motor conta tentativa e tenta depois
      }
      return saida;
    },
    async pull() {
      return { itens: [], proximo_cursor: null };
    },
  };
}
