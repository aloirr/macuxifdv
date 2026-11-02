/**
 * `integracao.rota.atualizado@1` -> `core.rota` + `core.rota_parada` (T-0066; RN-INT-02/04/06). A rota do ERP é recorrente
 * (dia da semana); o Core trabalha com rota datada (uma por vendedor e dia). O consumidor materializa as próximas 4
 * ocorrências do dia (ou só hoje, sem dia fixo), no calendário do tenant (`ctx.fuso()`), com `origem = 'erp'`,
 * `situacao = 'publicada'` e `external_id = <rota>@<AAAA-MM-DD>`; paradas com `external_id = <rota>@<data>:<cliente>`.
 * Ocorrências futuras que saíram do conjunto e paradas que saíram da rota são removidas (`deleted_at`); passado nunca muda.
 * Vendedor ou cliente ainda ausente = `ReferenciaAusenteErp` (a outbox repete). Dia que já tem rota de outra origem
 * para o mesmo vendedor não é sobrescrito (aviso). Limite da v1: a janela de 4 semanas só avança quando o ERP reenvia a rota.
 */
import { z } from 'zod';
import { definirConsumidor, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { dataLocal, datasDaRotaErp, planejarParadasErp } from '../domain';
import { clientePorExternalId, eventoIntegracao, ReferenciaAusenteErp, usuarioPorExternalId } from './erp-apoio';

const SEMANAS_MATERIALIZADAS = 4;

const RegistroRota = z.object({
  external_id: z.string(),
  alterado_em: z.string(),
  ativo: z.boolean().optional(),
  nome: z.string(),
  vendedor_external_id: z.string(),
  dia_semana: z.number().int().min(0).max(6).nullish(),
  paradas: z.array(z.object({ ordem: z.number().int(), cliente_external_id: z.string() })).default([]),
});

export const EventoIntegracaoRotaAtualizado = eventoIntegracao('rota', RegistroRota);

export const consumidorRotaDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoRotaAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const agora = ctx.agora();
    const hoje = dataLocal(agora, ctx.fuso());
    const prefixo = `${p.external_id}@`;

    /** Remove (soft delete) as rotas futuras do ERP desta rota que não estão em `manter`, com as paradas. */
    const removerFuturas = async (manter: string[]) => {
      const x = await ctx.db.query<{ id: string }>(
        'update core.rota set deleted_at = $3 where starts_with(external_id, $1) and data >= $2::date and deleted_at is null and not (data = any($4::date[])) returning id',
        [prefixo, hoje, agora, manter],
      );
      if (x.rows.length > 0) {
        await ctx.db.query('update core.rota_parada set deleted_at = $2 where rota_id = any($1::uuid[]) and deleted_at is null', [x.rows.map((l) => l.id), agora]);
      }
    };

    const r = p.registro;
    if (p.acao === 'inativado' || !r || r.ativo === false) {
      await removerFuturas([]);
      return;
    }

    const usuarioId = await usuarioPorExternalId(ctx.db, r.vendedor_external_id);
    if (!usuarioId) throw new ReferenciaAusenteErp('vendedor');
    const plano = planejarParadasErp(r.paradas);
    const clientes = new Map<string, string>();
    let ausentes = 0;
    for (const parada of plano) {
      const id = await clientePorExternalId(ctx.db, parada.cliente_external_id);
      if (id) clientes.set(parada.cliente_external_id, id);
      else ausentes += 1;
    }
    if (ausentes > 0) throw new ReferenciaAusenteErp('cliente', ausentes);

    const datas = datasDaRotaErp(r.dia_semana, hoje, SEMANAS_MATERIALIZADAS);
    await removerFuturas(datas);

    for (const data of datas) {
      const externalRota = `${r.external_id}@${data}`;
      const outra = await ctx.db.query('select 1 from core.rota where usuario_id = $1 and data = $2::date and deleted_at is null and external_id is distinct from $3', [usuarioId, data, externalRota]);
      if (outra.rows.length > 0) {
        ctx.log.warn({ data }, 'rota do ERP não aplicada: o vendedor já tem outra rota neste dia');
        continue;
      }
      const rota = await ctx.db.query<{ id: string }>(
        `insert into core.rota (tenant_id, usuario_id, data, situacao, origem, regiao, external_id)
         values (plataforma.tenant_atual(), $1, $2::date, 'publicada', 'erp', $3, $4)
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
         do update set usuario_id = excluded.usuario_id, data = excluded.data, situacao = 'publicada', origem = 'erp', regiao = excluded.regiao
         returning id`,
        [usuarioId, data, r.nome.trim(), externalRota],
      );
      const rotaId = rota.rows[0]?.id;
      if (!rotaId) continue;
      const ids = plano.map((x) => clientes.get(x.cliente_external_id)!);
      await ctx.db.query('update core.rota_parada set deleted_at = $3 where rota_id = $1 and deleted_at is null and not (cliente_id = any($2::uuid[]))', [rotaId, ids, agora]);
      for (const parada of plano) {
        await ctx.db.query(
          `insert into core.rota_parada (tenant_id, rota_id, usuario_id, data, cliente_id, sequencia, external_id)
           values (plataforma.tenant_atual(), $1, $2, $3::date, $4, $5, $6)
           on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null
           do update set rota_id = excluded.rota_id, usuario_id = excluded.usuario_id, data = excluded.data, cliente_id = excluded.cliente_id, sequencia = excluded.sequencia`,
          [rotaId, usuarioId, data, clientes.get(parada.cliente_external_id), parada.sequencia, `${externalRota}:${parada.cliente_external_id}`],
        );
      }
    }
  },
});
