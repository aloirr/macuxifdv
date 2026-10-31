/**
 * Outbox no Postgres (doc 04 "Comunicação entre módulos"; desenho T-0004 §6): o evento é gravado em
 * `plataforma.evento` na MESMA transação do fato (`ctx.comTenant`), com o RLS do tenant. A validação (nome,
 * `publica` do manifesto, schema do payload) é a do barramento do platform-sdk. O despacho entre tenants
 * (papel `macuxi_worker`, ADR 0007) lê daqui depois.
 */
import {
  criarBarramento,
  type ClienteBanco,
  type EnvelopeEvento,
  type Manifesto,
  type ModuloId,
  type RegistroConsumo,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';

export async function gravarEvento(db: ClienteBanco, envelope: EnvelopeEvento, agregadoId: string | null): Promise<void> {
  await db.query(
    // usuario_id/request_id: envelope completo no banco para o rastreio ponta a ponta (ADR 0007 §4, migração 0003)
    `insert into plataforma.evento (id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, usuario_id, request_id)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      envelope.evento_id,
      envelope.tenant_id,
      envelope.nome,
      envelope.origem,
      agregadoId,
      JSON.stringify(envelope.payload),
      envelope.ocorrido_em,
      envelope.usuario_id,
      envelope.request_id,
    ],
  );
}

/** Publicar não consome: o registro de consumo é do despachante. */
const semConsumo: RegistroConsumo = {
  jaProcessado: async () => false,
  marcarProcessado: async () => undefined,
};

export interface OrigemTransacao {
  manifestos: readonly Manifesto[];
  /** Módulo da rota (quem publica). `null` = rota da plataforma, que não publica evento de módulo. */
  modulo: ModuloId | null;
  tenantId: string;
  usuarioId: string;
  requestId: string;
  agora: () => Date;
}

export function transacaoTenant(db: ClienteBanco, o: OrigemTransacao): TransacaoTenant {
  return {
    async publicar(def, payload, agregadoId = null) {
      if (!o.modulo) throw new Error('Rota da plataforma não publica evento de módulo');
      const barramento = criarBarramento({
        manifestos: o.manifestos,
        outbox: { gravar: (env) => gravarEvento(db, env, agregadoId) },
        consumo: semConsumo,
        agora: o.agora,
      });
      return barramento.publicar(o.modulo, def, payload, { tenant_id: o.tenantId, usuario_id: o.usuarioId, request_id: o.requestId });
    },
  };
}
