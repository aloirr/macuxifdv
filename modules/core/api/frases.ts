/**
 * Frase do dia do Início (RN-CORE-41; T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §2.1): rotas do BKO em
 * `/v1/core/frases` (`GET`, `POST`, `PUT /:id`, `DELETE /:id`, `PUT /ordem`), ação `frase_dia.editar` (analista e admin). O
 * rodízio e a validação são do domain (`domain/frase-avatar/frase-do-dia.ts`); aqui só se lê e se grava. Toda mudança vai para
 * a auditoria (RN-AUD-01, sem o texto da frase: só ids e contagens). Sem evento: o aparelho recebe pelo pull `frase_dia`.
 * Fora do escopo de carteira (a frase é do tenant). Sem dado pessoal em log.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { FraseDiaCriarSchema, FraseDiaEditarSchema, FraseDiaSyncSchema, FrasesOrdemSchema, FRASES_MAX, FRASE_TEXTO_MAX, type FraseDiaCriar, type FraseDiaEditar, type FraseDiaSync, type FrasesOrdem } from '../contracts/frases';
import { validarFrase, validarNovaOrdem, type ErroFrase } from '../domain/frase-avatar/frase-do-dia';
import { auditar } from './auditoria';
import { BASE } from './sync';

const IdParam = z.object({ id: z.string().uuid() }).strict();
const COLUNAS = `${BASE}, texto, ativa, ordem, padrao_codigo`;

const MENSAGEM: Record<ErroFrase['motivo'], string> = {
  vazia: 'Escreva a frase antes de salvar.',
  longa: `A frase pode ter no máximo ${FRASE_TEXTO_MAX} caracteres. Encurte o texto.`,
  repetida: 'Esta frase já está na lista. Escreva outra ou edite a que já existe.',
  limite: `A lista chegou a ${FRASES_MAX} frases, uma para cada dia do ano. Remova uma frase antes de incluir outra.`,
  ordem_incompleta: 'A lista mudou enquanto você reordenava. Atualize a página e reordene de novo.',
};

const recusa = (e: ErroFrase) => new ErroRegraNegocio(e.codigo, MENSAGEM[e.motivo], { motivo: e.motivo });
const naoEncontrada = () => new ErroNaoEncontrado('FRASE_NAO_ENCONTRADA', 'Frase não encontrada. Atualize a lista e tente de novo.');

async function vivas(db: ClienteBanco): Promise<Array<{ id: string; texto: string; ordem: number }>> {
  return (await db.query<{ id: string; texto: string; ordem: number }>('select id, texto, ordem from core.frase_dia where deleted_at is null order by ordem, id')).rows;
}

async function lerFrase(db: ClienteBanco, id: string): Promise<FraseDiaSync> {
  const r = await db.query(`select ${COLUNAS} from core.frase_dia where id = $1`, [id]);
  return FraseDiaSyncSchema.parse(r.rows[0]);
}

export const rotasDeFrases: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'frases',
    acao: 'frase_dia.editar',
    superficie: 'bko',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const r = await db.query(`select ${COLUNAS} from core.frase_dia where deleted_at is null order by ordem, id`);
        return { itens: z.array(FraseDiaSyncSchema).parse(r.rows) };
      }),
  },
  {
    // a frase nova entra no fim da lista (RN-CORE-41)
    metodo: 'POST',
    caminho: 'frases',
    acao: 'frase_dia.editar',
    superficie: 'bko',
    status: 201,
    carteira: 'nao_se_aplica',
    corpo: FraseDiaCriarSchema,
    executar: async (ctx) => {
      const c = ctx.corpo as FraseDiaCriar;
      return ctx.comTenant(async (db) => {
        // serializa criações simultâneas do mesmo tenant (limite e repetição valem sobre a lista inteira)
        await db.query("select pg_advisory_xact_lock(hashtext('frase_dia:' || plataforma.tenant_atual()::text))");
        const lista = await vivas(db);
        const v = validarFrase(c.texto, lista);
        if (!v.ok) throw recusa(v);
        const ordem = lista.reduce((m, f) => Math.max(m, f.ordem), 0) + 1;
        const r = await db.query<{ id: string }>('insert into core.frase_dia (tenant_id, texto, ativa, ordem) values (plataforma.tenant_atual(), $1, $2, $3) returning id', [v.texto, c.ativa, ordem]);
        const id = r.rows[0]!.id;
        await auditar(db, ctx, { acao: 'frase_dia.criar', entidade: 'frase_dia', entidadeId: id, antes: null, depois: { ativa: c.ativa, ordem } });
        return lerFrase(db, id);
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'frases/ordem',
    acao: 'frase_dia.editar',
    superficie: 'bko',
    carteira: 'nao_se_aplica',
    corpo: FrasesOrdemSchema,
    executar: async (ctx) => {
      const c = ctx.corpo as FrasesOrdem;
      return ctx.comTenant(async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtext('frase_dia:' || plataforma.tenant_atual()::text))");
        const lista = await vivas(db);
        const v = validarNovaOrdem(lista.map((f) => f.id), c.ids);
        if (!v.ok) throw recusa(v);
        const mudou = c.ids.filter((id, i) => lista.find((f) => f.id === id)?.ordem !== i + 1);
        for (const id of mudou) await db.query('update core.frase_dia set ordem = $2 where id = $1', [id, c.ids.indexOf(id) + 1]);
        if (mudou.length > 0) await auditar(db, ctx, { acao: 'frase_dia.ordenar', entidade: 'frase_dia', entidadeId: c.ids[0]!, antes: { ordem: lista.map((f) => f.id) }, depois: { ordem: c.ids } });
        return { ids: c.ids, alteradas: mudou.length };
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'frases/:id',
    acao: 'frase_dia.editar',
    superficie: 'bko',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: FraseDiaEditarSchema,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof IdParam>;
      const c = ctx.corpo as FraseDiaEditar;
      return ctx.comTenant(async (db) => {
        await db.query("select pg_advisory_xact_lock(hashtext('frase_dia:' || plataforma.tenant_atual()::text))");
        const lista = await vivas(db);
        const atual = (await db.query<{ ativa: boolean; texto: string }>('select ativa, texto from core.frase_dia where id = $1 and deleted_at is null', [id])).rows[0];
        if (!atual) throw naoEncontrada();
        let texto = atual.texto;
        if (c.texto !== undefined) {
          const v = validarFrase(c.texto, lista, { id });
          if (!v.ok) throw recusa(v);
          texto = v.texto;
        }
        const ativa = c.ativa ?? atual.ativa;
        if (texto !== atual.texto || ativa !== atual.ativa) {
          await db.query('update core.frase_dia set texto = $2, ativa = $3 where id = $1', [id, texto, ativa]);
          await auditar(db, ctx, { acao: 'frase_dia.editar', entidade: 'frase_dia', entidadeId: id, antes: { ativa: atual.ativa, texto_alterado: texto !== atual.texto }, depois: { ativa, texto_alterado: texto !== atual.texto } });
        }
        return lerFrase(db, id);
      });
    },
  },
  {
    // remove (deleted_at); a padrão removida não volta (único sem filtro de deleted_at na 0065). Repetir a chamada responde igual.
    metodo: 'DELETE',
    caminho: 'frases/:id',
    acao: 'frase_dia.editar',
    superficie: 'bko',
    carteira: 'nao_se_aplica',
    params: IdParam,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof IdParam>;
      return ctx.comTenant(async (db) => {
        const r = await db.query<{ deleted_at: string | null }>('select deleted_at from core.frase_dia where id = $1', [id]);
        if (r.rows.length === 0) throw naoEncontrada();
        if (r.rows[0]!.deleted_at === null) {
          await db.query('update core.frase_dia set deleted_at = now() where id = $1', [id]);
          await auditar(db, ctx, { acao: 'frase_dia.remover', entidade: 'frase_dia', entidadeId: id, antes: null, depois: null });
        }
        return { id, removida: true };
      });
    },
  },
];
