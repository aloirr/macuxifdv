/**
 * `integracao.cliente_endereco.atualizado@1` -> `core.cliente_endereco` (endereços de entrega do Cliente 360 e do pedido,
 * RF-CORE-12, RN-VEN-17; T-0061; RN-INT-02/04/06). Upsert idempotente por `external_id`; inativação do ERP = `ativo = false`
 * (nunca apaga). Cliente ainda ausente = `ReferenciaAusenteErp` (a outbox repete, sem órfão). Invariante da 0013: no máximo
 * um `principal` vivo por cliente — marcar um novo desmarca o anterior na mesma transação do consumo (a regra é
 * `planejarEnderecoDoErp`, no domain). O schema abaixo é estrutural (subconjunto do `ClienteEnderecoPayload` do Hub).
 * Sem dado pessoal no log (só `external_id` e o motivo).
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { planejarEnderecoDoErp, type EventoEnderecoAtualizado } from '../domain';
import { clientePorExternalId, ReferenciaAusenteErp } from './erp-apoio';
import { EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO } from '../../integracao/contracts';

export const EventoIntegracaoClienteEnderecoAtualizado = eventoTolerante(EVENTO_ERP_CLIENTE_ENDERECO_ATUALIZADO);

export const consumidorClienteEnderecoDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoClienteEnderecoAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const plano = planejarEnderecoDoErp(p as EventoEnderecoAtualizado);
    if (plano.tipo === 'ignorar') {
      if (plano.motivo !== 'sem_registro') ctx.log.warn({ external_id: p.external_id, motivo: plano.motivo }, 'endereço do ERP ignorado');
      return;
    }
    if (plano.tipo === 'inativar') {
      await ctx.db.query('update core.cliente_endereco set ativo = false, principal = false where external_id = $1 and deleted_at is null and (ativo or principal)', [plano.external_id]);
      return;
    }
    const l = plano.linha;
    const clienteId = await clientePorExternalId(ctx.db, l.cliente_external_id);
    if (!clienteId) throw new ReferenciaAusenteErp('cliente');

    // No máximo um principal vivo por cliente (índice único): desmarca o anterior antes de gravar o novo.
    if (plano.desmarcar_outros_principais) {
      await ctx.db.query('update core.cliente_endereco set principal = false where cliente_id = $1 and principal and deleted_at is null and external_id is distinct from $2', [clienteId, l.external_id]);
    }

    await ctx.db.query(
      `insert into core.cliente_endereco as e (tenant_id, external_id, cliente_id, tipo, descricao, logradouro, numero, complemento, bairro, cidade, uf, cep, latitude, longitude, principal, ativo)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
       do update set cliente_id = excluded.cliente_id, tipo = excluded.tipo, descricao = excluded.descricao, logradouro = excluded.logradouro,
                     numero = excluded.numero, complemento = excluded.complemento, bairro = excluded.bairro, cidade = excluded.cidade,
                     uf = excluded.uf, cep = excluded.cep, latitude = excluded.latitude, longitude = excluded.longitude,
                     principal = excluded.principal, ativo = excluded.ativo
       where (e.cliente_id, e.tipo, e.descricao, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf, e.cep, e.latitude, e.longitude, e.principal, e.ativo) is distinct from
             (excluded.cliente_id, excluded.tipo, excluded.descricao, excluded.logradouro, excluded.numero, excluded.complemento, excluded.bairro, excluded.cidade, excluded.uf, excluded.cep, excluded.latitude, excluded.longitude, excluded.principal, excluded.ativo)`,
      [l.external_id, clienteId, l.tipo, l.descricao, l.logradouro, l.numero, l.complemento, l.bairro, l.cidade, l.uf, l.cep, l.latitude, l.longitude, l.principal, l.ativo],
    );
  },
});
