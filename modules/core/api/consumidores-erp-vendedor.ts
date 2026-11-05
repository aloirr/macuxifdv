/**
 * `integracao.vendedor.atualizado@1` -> `core.usuario` perfil `vendedor` (T-0066; RN-INT-02/04). Upsert por `external_id`,
 * idempotente. NÃO cria senha: `senha_hash` fica nulo e o usuário só entra depois do convite/ativação pelo BKO (o admin
 * define a senha); `ativo = false` e a inativação do ERP bloqueiam o login. E-mail ausente ou já usado por outro usuário
 * recebe e-mail provisório estável (`emailDoVendedorErp`). Usuário já existente com o mesmo e-mail e sem `external_id`
 * (vendedor/promotor cadastrado antes) é ADOTADO: ganha o `external_id`, mantém perfil, equipe e senha. Perfil e equipe
 * nunca são alterados pelo ERP depois de criado. Nada de dado pessoal no log.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { emailDoVendedorErp } from '../domain';

import { EVENTO_ERP_VENDEDOR_ATUALIZADO } from '../../integracao/contracts';

export const EventoIntegracaoVendedorAtualizado = eventoTolerante(EVENTO_ERP_VENDEDOR_ATUALIZADO);

/** RN-CORE-27 (T-0080): notas que chegaram antes do vendedor ganham o usuário (idempotente: só toca `usuario_id is null`). */
async function completarNotasDoVendedor(ctx: ContextoConsumo, usuarioId: string, externalId: string): Promise<void> {
  await ctx.db.query('update core.nota_erp set usuario_id = $1 where vendedor_external_id = $2 and usuario_id is null and deleted_at is null', [usuarioId, externalId.trim()]);
}

export const consumidorVendedorDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoVendedorAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const r = p.registro;
    if (p.acao === 'inativado' || !r || r.ativo === false) {
      await ctx.db.query('update core.usuario set ativo = false where external_id = $1 and deleted_at is null and ativo', [p.external_id]);
      return;
    }
    const nome = r.nome.trim();
    if (!nome) return;
    const { email, provisorio } = emailDoVendedorErp(r.email, r.external_id);

    const atual = (await ctx.db.query<{ id: string }>('select id from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (atual) {
      // E-mail real só troca se ninguém mais o usa (índice único por tenant); o provisório nunca sobrescreve um e-mail real.
      const livre = provisorio ? false : (await ctx.db.query('select 1 from core.usuario where lower(email) = $1 and deleted_at is null and id <> $2', [email, atual.id])).rows.length === 0;
      await ctx.db.query('update core.usuario set nome = $2, ativo = true, email = case when $3::boolean then $4 else email end where id = $1', [atual.id, nome, livre, email]);
      await completarNotasDoVendedor(ctx, atual.id, r.external_id);
      return;
    }

    const igual = (await ctx.db.query<{ id: string; external_id: string | null; perfil: string }>('select id, external_id, perfil from core.usuario where lower(email) = $1 and deleted_at is null', [email])).rows[0];
    if (igual && !igual.external_id && !provisorio && (igual.perfil === 'vendedor' || igual.perfil === 'promotor')) {
      await ctx.db.query('update core.usuario set external_id = $2, ativo = true where id = $1', [igual.id, r.external_id]);
      await completarNotasDoVendedor(ctx, igual.id, r.external_id);
      return;
    }
    const emailFinal = igual ? emailDoVendedorErp(null, r.external_id).email : email;
    await ctx.db.query(
      `insert into core.usuario (tenant_id, external_id, nome, email, perfil, ativo) values (plataforma.tenant_atual(), $1, $2, $3, 'vendedor', true)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome, ativo = true`,
      [r.external_id, nome, emailFinal],
    );
    const criado = (await ctx.db.query<{ id: string }>('select id from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (criado) await completarNotasDoVendedor(ctx, criado.id, r.external_id);
  },
});
