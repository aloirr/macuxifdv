/**
 * Apoio dos consumidores do ERP (`integracao.<entidade>.atualizado@1`; T-0066). Os schemas são estruturais (subconjunto do
 * payload canônico do Hub): o Core não importa pacote do Integracao. Referência ausente (RN-INT-04) lança
 * `ReferenciaAusenteErp`: a transação do consumo desfaz e a outbox repete com espera crescente, nunca grava órfão.
 */
import { z } from 'zod';
import { definirEvento, type ClienteBanco } from '@macuxi/platform-sdk';

/** Envelope `integracao.<entidade>.atualizado@1` (campos extras do Hub, como `lote_id` e `hash`, são ignorados). */
export function eventoIntegracao<S extends z.ZodTypeAny>(entidade: string, registro: S) {
  return definirEvento(
    `integracao.${entidade}.atualizado@1`,
    z.object({
      external_id: z.string().min(1),
      acao: z.enum(['criado', 'atualizado', 'inativado']),
      registro: registro.optional(),
      ocorrido_em: z.string(),
    }),
  );
}

export class ReferenciaAusenteErp extends Error {
  constructor(
    public readonly entidade: string,
    quantidade = 1,
  ) {
    super(`referencia_ausente: ${String(quantidade)} registro(s) de ${entidade} ainda não chegaram do ERP; a entrega será repetida (RN-INT-04)`);
    this.name = 'ReferenciaAusenteErp';
  }
}

/** Texto opcional do payload. */
export const TextoErp = z.string().nullish();

export async function usuarioPorExternalId(db: ClienteBanco, externalId: string): Promise<string | null> {
  const r = await db.query<{ id: string }>('select id from core.usuario where external_id = $1 and deleted_at is null', [externalId]);
  return r.rows[0]?.id ?? null;
}

export async function clientePorExternalId(db: ClienteBanco, externalId: string): Promise<string | null> {
  const r = await db.query<{ id: string }>('select id from core.cliente where external_id = $1 and deleted_at is null', [externalId]);
  return r.rows[0]?.id ?? null;
}

/** Saldo em aberto do financeiro = soma dos saldos dos títulos abertos vivos (Cliente 360). Só atualiza se o financeiro existe. */
export async function recalcularSaldoFinanceiro(db: ClienteBanco, clienteId: string): Promise<void> {
  await db.query(
    `update core.cliente_financeiro set saldo_aberto_cents =
       (select coalesce(sum(saldo_cents), 0) from core.titulo where cliente_id = $1 and situacao = 'aberto' and deleted_at is null)
     where cliente_id = $1 and deleted_at is null`,
    [clienteId],
  );
}
