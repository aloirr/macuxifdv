/**
 * Política de versão do Conector por empresa (RN-INT-11): `GET/PUT /v1/integracao/politica-versao`. Só admin grava
 * (`conector.gerenciar`); quem tem `monitor.ver` lê. A mínima vale em toda rota de dados do Hub (426); o sinal de vida passa.
 * Decisão do dono do produto (R-20261101-203953; RN-INT-11 emendada no doc 03): quem recebe pedidos exige Conector >= 1.2.1 (o 1.2.0
 * ainda reenvia os itens no fechamento sem nota nova). O padrão está no Hub (`POLITICA_VERSAO_PADRAO_PEDIDOS`): sem linha da empresa,
 * o Conector que recebe pedidos já vale com mínima 1.2.1 e o GET devolve `origem: padrao_hub`. A linha da empresa manda; o PUT recusa
 * mínima abaixo do piso com Conector ativo que recebe pedidos (422 RN-INT-11); descer abaixo do piso só por SQL, por decisão explícita.
 * Quem não recebe pedidos e não tem linha fica sem política (sem política ou versão ilegível nunca bloqueia).
 */
import { ErroRegraNegocio, type ContextoRota, type RotaModulo } from '@macuxi/platform-sdk';
import { PoliticaVersaoEntrada } from '../contracts';
import { politicaEfetiva, validarPisoParaPedidos, validarPoliticaVersao } from '../domain';
import { lerPolitica, tenantRecebePedidos } from './bko-comum';

export const rotaLerPolitica: RotaModulo = {
  metodo: 'GET',
  caminho: 'politica-versao',
  acao: 'monitor.ver',
  carteira: 'nao_se_aplica',
  executar: async (ctx: ContextoRota) =>
    ctx.comTenant(async (db) => {
      const gravada = await lerPolitica(db, ctx.usuario.tenant_id);
      // sem linha da empresa vale o padrão do Hub para quem recebe pedidos (RN-INT-11); `origem` é aditivo
      const efetiva = politicaEfetiva(gravada, gravada ? false : await tenantRecebePedidos(db, ctx.usuario.tenant_id));
      return { politica_versao: efetiva, origem: gravada ? ('tenant' as const) : efetiva ? ('padrao_hub' as const) : null };
    }),
};

export const rotaGravarPolitica: RotaModulo = {
  metodo: 'PUT',
  caminho: 'politica-versao',
  acao: 'conector.gerenciar',
  carteira: 'nao_se_aplica',
  corpo: PoliticaVersaoEntrada,
  executar: async (ctx: ContextoRota<PoliticaVersaoEntrada>) => {
    const p = ctx.corpo;
    const v = validarPoliticaVersao(p);
    if (!v.ok) throw new ErroRegraNegocio('RN-INT-11', v.erros.join(' '), { erros: v.erros });
    const tenantId = ctx.usuario.tenant_id;
    return ctx.comTenant(async (db, tx) => {
      const piso = validarPisoParaPedidos(p, await tenantRecebePedidos(db, tenantId));
      if (!piso.ok) throw new ErroRegraNegocio('RN-INT-11', piso.erros.join(' '), { erros: piso.erros });
      const antes = await lerPolitica(db, tenantId);
      await db.query(
        `insert into integracao.politica_versao (tenant_id, versao_minima, versao_recomendada, mensagem, pacote)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (tenant_id) where deleted_at is null do update
           set versao_minima = excluded.versao_minima, versao_recomendada = excluded.versao_recomendada, mensagem = excluded.mensagem, pacote = excluded.pacote`,
        [tenantId, p.versao_minima, p.versao_recomendada, p.mensagem ?? null, p.pacote ? JSON.stringify(p.pacote) : null],
      );
      await tx.auditar({
        acao: 'politica_versao.gravar',
        entidade: 'politica_versao',
        entidade_id: null,
        antes: antes ? { versao_minima: antes.versao_minima, versao_recomendada: antes.versao_recomendada } : null,
        depois: { versao_minima: p.versao_minima, versao_recomendada: p.versao_recomendada },
      });
      return { politica_versao: await lerPolitica(db, tenantId), origem: 'tenant' as const };
    });
  },
};
