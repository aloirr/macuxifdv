/**
 * `integracao.vendedor.atualizado@1` -> `core.usuario` perfil `vendedor` (T-0066; RN-INT-02/04). Upsert por `external_id`,
 * idempotente. NÃO cria senha: `senha_hash` fica nulo e o usuário só entra depois do convite/ativação pelo BKO (o admin
 * define a senha); `ativo = false` e a inativação do ERP bloqueiam o login. E-mail ausente ou já usado por outro usuário
 * recebe e-mail provisório estável (`emailDoVendedorErp`). Usuário já existente com o mesmo e-mail e sem `external_id`
 * (vendedor/promotor cadastrado antes) é ADOTADO: ganha o `external_id`, mantém perfil, equipe e senha. Perfil e equipe
 * nunca são alterados pelo ERP depois de criado. Nada de dado pessoal no log.
 * T-0176 (RN-CORE-39): `filial_external_id` opcional grava a filial do vendedor (`aplicarFilialDoErp`); ausente não altera; filial inexistente não grava e registra o erro; vendedor sem filial segue bloqueado no app.
 * T-0095: versão com `alterado_em` menor que `core.usuario.erp_alterado_em` (reentrega fora de ordem) é ignorada; vendedor
 * desligado pelo admin no BKO (`desligado_no_bko_em`) não é reativado pela carga: segue inativo e o admin recebe aviso UMA vez por
 * versão do registro (só quando o `alterado_em` avança; a carga completa repetida não reavisa). A adoção por e-mail e o upsert
 * seguem a mesma regra. A inativação usa só o relógio do ERP (`registro.alterado_em`): o `ocorrido_em` é do Hub, outro relógio
 * (RN-INT-02), então sem registro a inativação se aplica sem comparar nem avançar `erp_alterado_em`.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { decidirOrdemErp, decidirReativacaoDoErp, ehVersaoNovaDoErp, emailDoVendedorErp } from '../domain';

import { EVENTO_ERP_VENDEDOR_ATUALIZADO } from '../../integracao/contracts';
import { notificarSistema } from './consumidores-sistema';
import { aplicarFilialDoErp } from './filiais-usuario';

export const EventoIntegracaoVendedorAtualizado = eventoTolerante(EVENTO_ERP_VENDEDOR_ATUALIZADO);

/** RN-CORE-27 (T-0080): notas que chegaram antes do vendedor ganham o usuário (idempotente: só toca `usuario_id is null`). */
async function completarNotasDoVendedor(ctx: ContextoConsumo, usuarioId: string, externalId: string): Promise<void> {
  await ctx.db.query('update core.nota_erp set usuario_id = $1 where vendedor_external_id = $2 and usuario_id is null and deleted_at is null', [usuarioId, externalId.trim()]);
}

/** O ERP mandou ativo um vendedor que o admin desligou no BKO: não reativa; avisa os admins (sem nome nem e-mail; só o código do ERP). */
async function avisarDesligadoNoBko(ctx: ContextoConsumo, externalId: string, versao: string | null | undefined): Promise<void> {
  ctx.log.warn({ external_id: externalId }, 'vendedor do ERP segue desligado: o admin desativou no BKO');
  const admins = await ctx.db.query<{ id: string }>("select id from core.usuario where perfil = 'admin' and ativo and deleted_at is null");
  for (const a of admins.rows) {
    await notificarSistema(ctx, a.id, {
      titulo: 'Vendedor do ERP segue desligado',
      corpo: `A carga do ERP trouxe o vendedor ${externalId} como ativo, mas ele foi desativado no BKO. Reative em Usuários se for o caso.`,
      link: null, // o CHECK notificacao_link_formato só aceita rota do app (/m/...); o admin age no BKO
      prioridade: 'normal',
    }, `vendedor-desligado|${externalId}|${versao ?? ''}`); // um aviso por versão do registro (não só por evento)
  }
}

/** T-0176 / RN-CORE-39: `filial_external_id` é opcional no payload do Hub (lido de forma tolerante); ausente = não altera. */
const filialDaCarga = (r: object): string | null | undefined => (r as { filial_external_id?: string | null }).filial_external_id;

export const consumidorVendedorDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoVendedorAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const r = p.registro;
    if (p.acao === 'inativado' || !r || r.ativo === false) {
      // evento antigo reentregue depois de uma versão mais nova não inativa. Só o `alterado_em` do ERP entra na ordem: o
      // `ocorrido_em` é do relógio do Hub e não se compara com o do ERP (RN-INT-02); sem registro, inativa sem avançar a ordem
      const quando = r?.alterado_em ?? null;
      if (quando === null) {
        await ctx.db.query('update core.usuario set ativo = false where external_id = $1 and deleted_at is null and ativo', [p.external_id]);
        return;
      }
      await ctx.db.query(
        `update core.usuario set ativo = false, erp_alterado_em = greatest(coalesce(erp_alterado_em, $2::timestamptz), $2::timestamptz)
          where external_id = $1 and deleted_at is null and (erp_alterado_em is null or erp_alterado_em <= $2::timestamptz)`,
        [p.external_id, quando],
      );
      return;
    }
    const nome = r.nome.trim();
    if (!nome) return;
    const { email, provisorio } = emailDoVendedorErp(r.email, r.external_id);

    const atual = (await ctx.db.query<{ id: string; erp_alterado_em: string | null; desligado_no_bko_em: string | null }>(
      'select id, erp_alterado_em::text, desligado_no_bko_em::text from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (atual) {
      if (decidirOrdemErp(atual.erp_alterado_em, r.alterado_em) === 'ignorar_antigo') {
        ctx.log.warn({ external_id: r.external_id }, 'vendedor do ERP ignorado: versão mais antiga que a já aplicada');
        return;
      }
      const reativacao = decidirReativacaoDoErp({ desligadoNoBkoEm: atual.desligado_no_bko_em, ativoNoErp: true, versaoNova: ehVersaoNovaDoErp(atual.erp_alterado_em, r.alterado_em) });
      if (reativacao.avisar) await avisarDesligadoNoBko(ctx, r.external_id, r.alterado_em);
      // E-mail real só troca se ninguém mais o usa (índice único por tenant); o provisório nunca sobrescreve um e-mail real.
      const livre = provisorio ? false : (await ctx.db.query('select 1 from core.usuario where lower(email) = $1 and deleted_at is null and id <> $2', [email, atual.id])).rows.length === 0;
      await ctx.db.query('update core.usuario set nome = $2, ativo = $5::boolean, erp_alterado_em = $6::timestamptz, email = case when $3::boolean then $4 else email end where id = $1', [atual.id, nome, livre, email, reativacao.ativo, r.alterado_em]);
      await completarNotasDoVendedor(ctx, atual.id, r.external_id);
      await aplicarFilialDoErp(ctx, atual.id, r.external_id, filialDaCarga(r));
      return;
    }

    const igual = (await ctx.db.query<{ id: string; external_id: string | null; perfil: string; desligado_no_bko_em: string | null }>('select id, external_id, perfil, desligado_no_bko_em::text from core.usuario where lower(email) = $1 and deleted_at is null', [email])).rows[0];
    if (igual && !igual.external_id && !provisorio && (igual.perfil === 'vendedor' || igual.perfil === 'promotor')) {
      // quem o admin desligou no BKO não volta ativo pela adoção (mesma regra do upsert); o aviso sai uma vez, na adoção
      const adocao = decidirReativacaoDoErp({ desligadoNoBkoEm: igual.desligado_no_bko_em, ativoNoErp: true });
      if (adocao.avisar) await avisarDesligadoNoBko(ctx, r.external_id, r.alterado_em);
      await ctx.db.query('update core.usuario set external_id = $2, ativo = case when $4::boolean then ativo else $5::boolean end, erp_alterado_em = $3::timestamptz where id = $1', [igual.id, r.external_id, r.alterado_em, igual.desligado_no_bko_em !== null, adocao.ativo]);
      await completarNotasDoVendedor(ctx, igual.id, r.external_id);
      await aplicarFilialDoErp(ctx, igual.id, r.external_id, filialDaCarga(r));
      return;
    }
    const emailFinal = igual ? emailDoVendedorErp(null, r.external_id).email : email;
    await ctx.db.query(
      `insert into core.usuario (tenant_id, external_id, nome, email, perfil, ativo, erp_alterado_em) values (plataforma.tenant_atual(), $1, $2, $3, 'vendedor', true, $4::timestamptz)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome, ativo = (core.usuario.desligado_no_bko_em is null), erp_alterado_em = excluded.erp_alterado_em`,
      [r.external_id, nome, emailFinal, r.alterado_em],
    );
    const criado = (await ctx.db.query<{ id: string }>('select id from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (criado) {
      await completarNotasDoVendedor(ctx, criado.id, r.external_id);
      await aplicarFilialDoErp(ctx, criado.id, r.external_id, filialDaCarga(r));
    }
  },
});
