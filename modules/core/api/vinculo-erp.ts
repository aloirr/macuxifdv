/**
 * `POST /v1/core/usuarios/:id/vincular-erp` (RN-CORE-58, T-0175): o admin junta o vendedor/promotor PROVISÓRIO da carga do ERP
 * (`:id`, e-mail `@sem-email.invalid`) a um usuário real (`usuario_id`). O plano é do domínio (`planejarVinculoErp`); aqui só
 * se executa, numa transação única e com as duas linhas travadas: o real ganha o `external_id`, recebe a carteira (sem duplicar),
 * as notas, rotas, metas e indicadores do provisório; o provisório é desativado e sai da lista (`deleted_at`), mantendo o código
 * para a repetição ser idempotente. Auditoria na mesma transação (só ids e contagens) e um `core.cliente.atualizado@1` por cliente
 * movido. Só o admin (`usuario.editar`); a licença do core e o tenant vêm da rota/RLS.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { EVENTO_CLIENTE_ATUALIZADO, VincularErpRequestSchema, VincularErpRespostaSchema, type VincularErpResposta } from '../contracts';
import { planejarVinculoErp, type CarteiraDoVinculo, type UsuarioDoVinculo } from '../domain';
import { auditar } from './auditoria';
import { carteiraDoEvento } from './rotas';

const IdParam = z.object({ id: z.string().uuid() });

interface LinhaUsuario extends UsuarioDoVinculo {
  deleted_at: string | null;
}

async function travar(db: ClienteBanco, ids: readonly string[]): Promise<Map<string, LinhaUsuario>> {
  // os dois ids em ordem fixa (sem deadlock entre dois vínculos cruzados); inclui o provisório já desativado (repetição)
  const r = await db.query<LinhaUsuario>('select id, tenant_id, perfil, email, external_id, deleted_at::text from core.usuario where id = any($1::uuid[]) order by id for update', [[...ids]]);
  return new Map(r.rows.map((l) => [l.id, l]));
}

const naoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');

export const rotasDeVinculoErp: readonly RotaModulo[] = [
  {
    metodo: 'POST',
    caminho: 'usuarios/:id/vincular-erp',
    superficie: 'bko',
    acao: 'usuario.editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: VincularErpRequestSchema,
    executar: (ctx): Promise<VincularErpResposta> =>
      ctx.comTenant(async (db, tx) => {
        const provId = ctx.params.id;
        const realId = ctx.corpo.usuario_id;
        const linhas = await travar(db, [provId, realId]);
        const p = linhas.get(provId);
        const r = linhas.get(realId);
        if (!p || !r || r.deleted_at !== null) throw naoEncontrado();
        const jaFeito = p.deleted_at !== null;
        if (jaFeito && p.external_id !== r.external_id) throw naoEncontrado(); // provisório apagado por outro motivo: não é repetição
        const carteira = async (usuario: string) =>
          (await db.query<CarteiraDoVinculo>('select id, cliente_id, papel from core.carteira where usuario_id = $1 and deleted_at is null order by cliente_id, papel, id', [usuario])).rows;
        const plano = planejarVinculoErp({
          provisorio: { ...p, vinculado: jaFeito },
          real: r,
          carteiraProvisorio: jaFeito ? [] : await carteira(provId),
          carteiraReal: jaFeito ? [] : await carteira(realId),
        });
        if (!plano.ok) throw new ErroRegraNegocio(plano.codigo, plano.mensagem);
        if (plano.ja_vinculado) return VincularErpRespostaSchema.parse({ provisorio_id: provId, usuario_id: realId, external_id: plano.external_id, clientes_movidos: 0, ja_vinculado: true });

        // libera o código antes de passar ao real (índice único parcial por tenant), na mesma transação
        await db.query('update core.usuario set ativo = false, deleted_at = now(), desligado_no_bko_em = coalesce(desligado_no_bko_em, now()), sessao_versao = sessao_versao + 1 where id = $1', [provId]);
        await db.query('update core.usuario set external_id = $2 where id = $1', [realId, plano.external_id]);
        await db.query('update core.carteira set usuario_id = $2 where id = any($1::uuid[])', [plano.carteira_mover, realId]);
        await db.query('update core.carteira set deleted_at = now() where id = any($1::uuid[])', [plano.carteira_descartar]);
        await db.query('update core.nota_erp set usuario_id = $2 where usuario_id = $1', [provId, realId]);
        // rota (e as paradas, por cascata), meta e indicador têm um por usuário/dia|período: o que o real já tem fica, o resto passa
        await db.query('update core.rota r set usuario_id = $2 where r.usuario_id = $1 and (r.deleted_at is not null or not exists (select 1 from core.rota x where x.usuario_id = $2 and x.data = r.data and x.deleted_at is null))', [provId, realId]);
        await db.query('update core.meta m set usuario_id = $2 where m.usuario_id = $1 and (m.deleted_at is not null or not exists (select 1 from core.meta x where x.usuario_id = $2 and x.periodo = m.periodo and x.indicador = m.indicador and x.deleted_at is null))', [provId, realId]);
        await db.query('update core.indicador_diario i set usuario_id = $2 where i.usuario_id = $1 and (i.deleted_at is not null or not exists (select 1 from core.indicador_diario x where x.usuario_id = $2 and x.data = i.data and x.deleted_at is null))', [provId, realId]);
        // o e-mail real nunca é trocado pelo provisório; o ERP volta a falar com o real pelo código (carga idempotente)
        await auditar(db, ctx, {
          acao: 'usuario.vincular_erp',
          entidade: 'usuario',
          entidadeId: realId,
          antes: { external_id: null, provisorio_id: provId },
          depois: { external_id: plano.external_id, provisorio_id: provId, carteira_movida: plano.carteira_mover.length, carteira_descartada: plano.carteira_descartar.length, clientes: plano.eventos_cliente.length },
        });
        for (const clienteId of plano.eventos_cliente) {
          await tx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: clienteId, campos: ['vendedor_id'], origem: 'bko', ...(await carteiraDoEvento(db, clienteId)) }, clienteId);
        }
        return VincularErpRespostaSchema.parse({ provisorio_id: provId, usuario_id: realId, external_id: plano.external_id, clientes_movidos: plano.eventos_cliente.length, ja_vinculado: false });
      }),
  },
];
