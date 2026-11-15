/**
 * `POST /v1/core/usuarios/:id/vincular-erp` (RN-CORE-58, T-0175): o admin junta o vendedor/promotor PROVISÓRIO da carga do ERP
 * (`:id`, e-mail `@sem-email.invalid`) a um usuário real (`usuario_id`). O plano é do domínio (`planejarVinculoErp`); aqui só
 * se executa, numa transação única e com as duas linhas travadas: o real ganha o `external_id`, recebe a carteira (sem duplicar),
 * as notas, rotas, metas, tarefas, visitas, deslocamentos, indicadores e a chefia de equipe do provisório; o provisório é liberado primeiro
 * (external_id nulo, inativo, `deleted_at`) e a repetição é reconhecida pela auditoria e pelo código já no real. Auditoria na mesma transação (só ids e contagens) e um `core.cliente.atualizado@1` por cliente
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
        // repetição: o provisório já saiu (deleted_at, external_id nulo) e a auditoria mostra este vínculo; apagado por outro motivo = 404
        const jaFeito = p.deleted_at !== null;
        if (jaFeito) {
          const feito = r.external_id !== null && (await db.query("select 1 from plataforma.auditoria where acao = 'usuario.vincular_erp' and entidade_id = $1 and depois->>'provisorio_id' = $2 limit 1", [realId, provId])).rows.length > 0;
          if (!feito) throw naoEncontrado();
        }
        const visitaAberta = jaFeito ? false : (await db.query('select 1 from core.visita where usuario_id = $1 and checkout_em is null and deleted_at is null limit 1', [provId])).rows.length > 0;
        const carteira = async (usuario: string) =>
          (await db.query<CarteiraDoVinculo>('select id, cliente_id, papel from core.carteira where usuario_id = $1 and deleted_at is null order by cliente_id, papel, id', [usuario])).rows;
        const plano = planejarVinculoErp({
          provisorio: { ...p, vinculado: jaFeito },
          real: r,
          carteiraProvisorio: jaFeito ? [] : await carteira(provId),
          carteiraReal: jaFeito ? [] : await carteira(realId),
          visitaAbertaDoProvisorio: visitaAberta,
        });
        if (!plano.ok) throw new ErroRegraNegocio(plano.codigo, plano.mensagem);
        if (plano.ja_vinculado) return VincularErpRespostaSchema.parse({ provisorio_id: provId, usuario_id: realId, external_id: plano.external_id, clientes_movidos: 0, ja_vinculado: true });

        // 1) libera o código do provisório (índice único parcial por tenant, não adiável); 2) só então o real o recebe
        await db.query('update core.usuario set external_id = null, ativo = false, deleted_at = now(), desligado_no_bko_em = coalesce(desligado_no_bko_em, now()), sessao_versao = sessao_versao + 1 where id = $1', [provId]);
        await db.query('update core.usuario set external_id = $2 where id = $1', [realId, plano.external_id]);
        await db.query('update core.carteira set usuario_id = $2 where id = any($1::uuid[])', [plano.carteira_mover, realId]);
        await db.query('update core.carteira set deleted_at = now() where id = any($1::uuid[])', [plano.carteira_descartar]);
        await db.query('update core.nota_erp set usuario_id = $2 where usuario_id = $1', [provId, realId]);
        // com índice único por usuário: onde o real já tem a linha, a do provisório ganha deleted_at e fica a do real; o resto passa
        const colide = (tabela: string, alias: string, chaves: string): string =>
          `update ${tabela} ${alias} set deleted_at = now() where ${alias}.usuario_id = $1 and ${alias}.deleted_at is null and exists (select 1 from ${tabela} x where x.usuario_id = $2 and x.deleted_at is null and ${chaves})`;
        const passa = (tabela: string): string => `update ${tabela} set usuario_id = $2 where usuario_id = $1`;
        const par = [provId, realId];
        // rota: as paradas da rota que fica com o provisório também são apagadas; as demais acompanham a rota (cascata)
        await db.query('update core.rota_parada pa set deleted_at = now() from core.rota r where pa.rota_id = r.id and r.usuario_id = $1 and r.deleted_at is null and pa.deleted_at is null and exists (select 1 from core.rota x where x.usuario_id = $2 and x.data = r.data and x.deleted_at is null)', par);
        await db.query(colide('core.rota', 'r', 'x.data = r.data'), par);
        await db.query(passa('core.rota'), par);
        await db.query(colide('core.meta', 'm', 'x.periodo = m.periodo and x.indicador = m.indicador'), par);
        await db.query(passa('core.meta'), par);
        await db.query(colide('core.meta_produtividade', 'm', 'x.escopo = m.escopo and x.indicador = m.indicador and x.vigencia_inicio = m.vigencia_inicio'), par);
        await db.query(passa('core.meta_produtividade'), par);
        await db.query(colide('core.tarefa_destinatario', 't', 'x.tarefa_id = t.tarefa_id'), par);
        await db.query(passa('core.tarefa_destinatario'), par);
        await db.query(colide('core.deslocamento_dia', 'd', 'x.data = d.data'), par);
        await db.query(passa('core.deslocamento_dia'), par);
        await db.query(colide('core.indicador_diario', 'i', 'x.data = i.data'), par);
        await db.query(passa('core.indicador_diario'), par);
        await db.query(passa('core.visita'), par); // visita aberta já foi recusada pelo domínio; as fechadas só mudam de dono
        await db.query('update core.equipe set responsavel_id = $2 where responsavel_id = $1', par);
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
