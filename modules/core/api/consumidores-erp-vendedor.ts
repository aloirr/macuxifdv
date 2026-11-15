/**
 * `integracao.vendedor.atualizado@1` -> `core.usuario` perfil `vendedor` (T-0066; RN-INT-02/04). Upsert por `external_id`,
 * idempotente. NÃO cria senha: `senha_hash` fica nulo e o usuário só entra depois do convite/ativação pelo BKO (o admin
 * define a senha); `ativo = false` e a inativação do ERP bloqueiam o login. E-mail ausente ou já usado por outro usuário
 * recebe e-mail provisório estável (`emailDoVendedorErp`). Usuário já existente com o mesmo e-mail e sem `external_id`
 * (vendedor/promotor cadastrado antes) é ADOTADO: ganha o `external_id`, mantém perfil, equipe e senha. Perfil e equipe
 * nunca são alterados pelo ERP depois de criado. Nada de dado pessoal no log.
 * T-0095: versão com `alterado_em` menor que `core.usuario.erp_alterado_em` (reentrega fora de ordem) é ignorada; vendedor
 * desligado pelo admin no BKO (`desligado_no_bko_em`) não é reativado pela carga: segue inativo e o admin recebe aviso UMA vez por
 * versão do registro (só quando o `alterado_em` avança; a carga completa repetida não reavisa). A adoção por e-mail e o upsert
 * seguem a mesma regra. A inativação usa só o relógio do ERP (`registro.alterado_em`): o `ocorrido_em` é do Hub, outro relógio
 * (RN-INT-02), então sem registro a inativação se aplica sem comparar nem avançar `erp_alterado_em`.
 * T-0175 / RN-CORE-58: o vínculo é pelo código do ERP, não pelo e-mail (a adoção por e-mail igual segue como atalho). Casou o `external_id`
 * com o usuário real (vinculado pelo admin), a carga só atualiza nome, ativo e ordem: não recria o provisório, não troca o e-mail real
 * e não mexe na carteira (ela é do cliente do ERP, que também casa pelo código). Criar um provisório avisa os admins, uma vez por código.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { decidirOrdemErp, decidirReativacaoDoErp, ehVersaoNovaDoErp, ehUsuarioProvisorio, emailDoVendedorErp, emailQueACargaPodeGravar, decidirVinculoPorNome } from '../domain';

import { EVENTO_ERP_VENDEDOR_ATUALIZADO } from '../../integracao/contracts';
import { notificarSistema } from './consumidores-sistema';

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

/** RN-CORE-58: o nome do vendedor do ERP não pôde ser vinculado sozinho; o admin decide (só o código do ERP e a contagem, sem nome nem e-mail). */
async function avisarVinculoPorNomeRecusado(ctx: ContextoConsumo, externalId: string, motivo: 'homonimo' | 'outro_codigo' | 'inativo', candidatos: number): Promise<void> {
  ctx.log.warn({ external_id: externalId, motivo, candidatos }, 'vínculo automático por nome não feito');
  const texto = { homonimo: `há ${candidatos} usuários com o mesmo nome`, outro_codigo: 'o usuário com este nome já tem outro código do ERP', inativo: 'o usuário com este nome está desativado' }[motivo];
  const admins = await ctx.db.query<{ id: string }>("select id from core.usuario where perfil = 'admin' and ativo and deleted_at is null");
  for (const a of admins.rows) {
    await notificarSistema(ctx, a.id, {
      titulo: 'Vendedor do ERP sem vínculo automático',
      corpo: `O vendedor ${externalId} não foi vinculado pelo nome: ${texto}. Em Usuários, use Vincular vendedor do ERP.`,
      link: null,
      prioridade: 'normal',
    }, `vendedor-nome|${externalId}|${motivo}`);
  }
}

/** Aviso de provisório ao admin: texto sob simulação do designer-ux (R-20261115-075000); desligado até o dono aprovar. */
export const AVISO_PROVISORIO_ATIVO = false;

/** RN-CORE-58: a carga criou um usuário provisório; o admin vincula ao usuário real. Só o código do ERP vai no aviso (sem nome nem e-mail). */
async function avisarProvisorioCriado(ctx: ContextoConsumo, externalId: string): Promise<void> {
  ctx.log.warn({ external_id: externalId }, 'vendedor do ERP entrou como usuário provisório (sem e-mail)');
  const admins = await ctx.db.query<{ id: string }>("select id from core.usuario where perfil = 'admin' and ativo and deleted_at is null");
  for (const a of admins.rows) {
    await notificarSistema(ctx, a.id, {
      titulo: 'Vendedor do ERP sem usuário',
      corpo: `A carga criou o vendedor ${externalId} como usuário provisório. Em Usuários, filtre por Provisórios e use Vincular vendedor do ERP.`,
      link: null,
      prioridade: 'normal',
    }, `vendedor-provisorio|${externalId}`);
  }
}

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

    const atual = (await ctx.db.query<{ id: string; email: string; erp_alterado_em: string | null; desligado_no_bko_em: string | null }>(
      'select id, email, erp_alterado_em::text, desligado_no_bko_em::text from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (atual) {
      if (decidirOrdemErp(atual.erp_alterado_em, r.alterado_em) === 'ignorar_antigo') {
        ctx.log.warn({ external_id: r.external_id }, 'vendedor do ERP ignorado: versão mais antiga que a já aplicada');
        return;
      }
      const reativacao = decidirReativacaoDoErp({ desligadoNoBkoEm: atual.desligado_no_bko_em, ativoNoErp: true, versaoNova: ehVersaoNovaDoErp(atual.erp_alterado_em, r.alterado_em) });
      if (reativacao.avisar) await avisarDesligadoNoBko(ctx, r.external_id, r.alterado_em);
      // E-mail real só troca se ninguém mais o usa (índice único por tenant); o provisório nunca sobrescreve um e-mail real.
      // RN-CORE-58: o e-mail só sai do provisório para um real livre (índice único por tenant); o e-mail real do vínculo nunca é trocado
      const livre = provisorio ? false : (await ctx.db.query('select 1 from core.usuario where lower(email) = $1 and deleted_at is null and id <> $2', [email, atual.id])).rows.length === 0;
      const novoEmail = emailQueACargaPodeGravar({ emailAtual: atual.email, emailDoErp: email, erpProvisorio: provisorio, emailLivre: livre });
      await ctx.db.query('update core.usuario set nome = $2, ativo = $3::boolean, erp_alterado_em = $4::timestamptz, email = coalesce($5::text, email) where id = $1', [atual.id, nome, reativacao.ativo, r.alterado_em, novoEmail]);
      await completarNotasDoVendedor(ctx, atual.id, r.external_id);
      return;
    }

    const igual = (await ctx.db.query<{ id: string; external_id: string | null; perfil: string; desligado_no_bko_em: string | null }>('select id, external_id, perfil, desligado_no_bko_em::text from core.usuario where lower(email) = $1 and deleted_at is null', [email])).rows[0];
    if (igual && !igual.external_id && !provisorio && (igual.perfil === 'vendedor' || igual.perfil === 'promotor')) {
      // quem o admin desligou no BKO não volta ativo pela adoção (mesma regra do upsert); o aviso sai uma vez, na adoção
      const adocao = decidirReativacaoDoErp({ desligadoNoBkoEm: igual.desligado_no_bko_em, ativoNoErp: true });
      if (adocao.avisar) await avisarDesligadoNoBko(ctx, r.external_id, r.alterado_em);
      await ctx.db.query('update core.usuario set external_id = $2, ativo = case when $4::boolean then ativo else $5::boolean end, erp_alterado_em = $3::timestamptz where id = $1', [igual.id, r.external_id, r.alterado_em, igual.desligado_no_bko_em !== null, adocao.ativo]);
      await completarNotasDoVendedor(ctx, igual.id, r.external_id);
      return;
    }
    // RN-CORE-58: sem código nem e-mail igual, o nome completo igual a UM usuário elegível vincula; homônimo e afins só avisam
    const porNome = (await ctx.db.query<{ id: string; nome: string; perfil: string; ativo: boolean; external_id: string | null; email: string }>(
      "select id, nome, perfil, ativo, external_id, email from core.usuario where deleted_at is null and perfil in ('vendedor', 'promotor')")).rows;
    const decisao = decidirVinculoPorNome(nome, porNome);
    if (decisao.acao === 'vincular') {
      const vinculou = await ctx.db.query('update core.usuario set external_id = $2, erp_alterado_em = $3::timestamptz where id = $1 and external_id is null', [decisao.usuario_id, r.external_id, r.alterado_em]);
      // auditoria com ator sistema/Hub (usuario_id nulo): só ids e a regra, sem o nome (RN-AUD-01)
      if (vinculou.rowCount) {
        await ctx.db.query(
          `insert into plataforma.auditoria (tenant_id, usuario_id, modulo, acao, entidade, entidade_id, antes, depois, request_id)
           values (plataforma.tenant_atual(), null, 'core', 'usuario.vincular_erp_por_nome', 'usuario', $1, null, $2::jsonb, $3)`,
          [decisao.usuario_id, JSON.stringify({ usuario_id: decisao.usuario_id, external_id: r.external_id, regra: 'RN-CORE-58', ator: 'hub' }), ctx.envelope.evento_id],
        );
      }
      await completarNotasDoVendedor(ctx, decisao.usuario_id, r.external_id);
      return;
    }
    if (decisao.acao === 'avisar') await avisarVinculoPorNomeRecusado(ctx, r.external_id, decisao.motivo, decisao.candidatos);
    const emailFinal = igual ? emailDoVendedorErp(null, r.external_id).email : email;
    await ctx.db.query(
      `insert into core.usuario (tenant_id, external_id, nome, email, perfil, ativo, erp_alterado_em) values (plataforma.tenant_atual(), $1, $2, $3, 'vendedor', true, $4::timestamptz)
       on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set nome = excluded.nome, ativo = (core.usuario.desligado_no_bko_em is null), erp_alterado_em = excluded.erp_alterado_em`,
      [r.external_id, nome, emailFinal, r.alterado_em],
    );
    const criado = (await ctx.db.query<{ id: string }>('select id from core.usuario where external_id = $1 and deleted_at is null', [r.external_id])).rows[0];
    if (criado) await completarNotasDoVendedor(ctx, criado.id, r.external_id);
    if (AVISO_PROVISORIO_ATIVO && criado && ehUsuarioProvisorio(emailFinal)) await avisarProvisorioCriado(ctx, r.external_id);
  },
});
