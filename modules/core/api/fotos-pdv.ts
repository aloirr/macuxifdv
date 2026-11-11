/**
 * Fotos do PDV (RN-CORE-38; RF-CORE-15; T-0147; ADR 0041): tipos de foto (cadastro do admin) e resumo tem/falta por cliente.
 * Rotas `/v1/core/fotos-tipos` (GET: todos os perfis do Core; POST, PUT `:id` e DELETE: `foto_tipo.editar`, só o admin) e
 * `GET /v1/core/clientes/:id/fotos` (carteira; `arquivo_id` só nos tipos que o perfil pode abrir). Regras no domínio
 * (`domain/fotos-pdv.ts`). Escrita idempotente: o `id` nasce no cliente. O banco também protege (nome único, uma fachada).
 * O envio da foto pelo aparelho (push `cliente_foto`) depende do `perfis_leitura` do SDK (ADR 0041) e entra em seguida.
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { ERROS_FOTO_PDV, FotoTipoCriarSchema, FotoTipoEditarSchema, FotoTipoIdParamSchema, FotoTiposListaSchema, ResumoFotosClienteSchema, type FotoTipo } from '../contracts';
import { decidirApagarTipoFoto, podeAbrirFoto, resumoFotos, validarTipoFoto } from '../domain';
import { auditar } from './auditoria';

const COLUNAS = 'id, nome, obrigatorio, sensivel, fachada, ordem, ativo';
const IdParam = FotoTipoIdParamSchema;
const ClienteIdParam = z.object({ id: z.string().uuid() });

export async function tiposDeFoto(db: ClienteBanco): Promise<FotoTipo[]> {
  return (await db.query<FotoTipo>(`select ${COLUNAS} from core.foto_tipo where deleted_at is null order by ordem, nome, id`)).rows;
}
const tipoPorId = async (db: ClienteBanco, id: string): Promise<FotoTipo | undefined> => (await db.query<FotoTipo>(`select ${COLUNAS} from core.foto_tipo where id = $1 and deleted_at is null`, [id])).rows[0];

function recusar(r: { codigo: string; mensagem: string }): never {
  throw new ErroRegraNegocio(r.codigo, r.mensagem);
}
const naoEncontrado = () => new ErroNaoEncontrado(ERROS_FOTO_PDV.tipoNaoEncontrado, 'Tipo de foto não encontrado. Atualize a lista e tente de novo.');

/** 23505 = nome repetido ou segunda fachada; 23514 = fachada sensível. Nunca 500. */
async function comErroDeTipo<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
    if (code === '23505') throw new ErroRegraNegocio(ERROS_FOTO_PDV.tipoDuplicado, 'Já existe um tipo de foto com este nome. Use outro nome ou edite o existente.');
    if (code === '23514') throw new ErroRegraNegocio(ERROS_FOTO_PDV.tipoFachada, 'A fachada não pode ser sensível: o vendedor precisa abri-la.');
    throw e;
  }
}

export const rotasDeFotosPdv: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'fotos-tipos',
    acao: 'cliente_foto.ver',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db) => FotoTiposListaSchema.parse({ itens: await tiposDeFoto(db) })),
  },
  {
    metodo: 'POST',
    caminho: 'fotos-tipos',
    acao: 'foto_tipo.editar',
    carteira: 'nao_se_aplica',
    status: 201,
    corpo: FotoTipoCriarSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof FotoTipoCriarSchema>;
        const existente = await tipoPorId(db, c.id);
        if (existente) return existente; // idempotente: mesmo id, sem nova escrita nem auditoria
        const todos = await tiposDeFoto(db);
        const v = validarTipoFoto(c, todos);
        if (!v.ok) recusar(v);
        const ordem = (todos.at(-1)?.ordem ?? 0) + 10;
        await comErroDeTipo(() =>
          db.query('insert into core.foto_tipo (id, tenant_id, nome, obrigatorio, sensivel, fachada, ordem, ativo) values ($1, plataforma.tenant_atual(), $2, $3, $4, false, $5, true) on conflict (id) do nothing', [c.id, v.tipo.nome, v.tipo.obrigatorio, v.tipo.sensivel, ordem]),
        );
        await auditar(db, ctx, { acao: 'foto_tipo.criar', entidade: 'foto_tipo', entidadeId: c.id, antes: null, depois: v.tipo });
        return (await tipoPorId(db, c.id))!;
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'fotos-tipos/:id',
    acao: 'foto_tipo.editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: FotoTipoEditarSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo as z.infer<typeof FotoTipoEditarSchema>;
        const id = (ctx.params as z.infer<typeof IdParam>).id;
        const antes = await tipoPorId(db, id);
        if (!antes) throw naoEncontrado();
        const v = validarTipoFoto({ id, nome: c.nome ?? antes.nome, obrigatorio: c.obrigatorio ?? antes.obrigatorio, sensivel: c.sensivel ?? antes.sensivel, ativo: c.ativo ?? antes.ativo }, await tiposDeFoto(db));
        if (!v.ok) recusar(v);
        const ordem = c.ordem ?? antes.ordem;
        if (v.tipo.nome === antes.nome && v.tipo.obrigatorio === antes.obrigatorio && v.tipo.sensivel === antes.sensivel && v.tipo.ativo === antes.ativo && ordem === antes.ordem) return antes;
        await comErroDeTipo(async () => {
          await db.query('update core.foto_tipo set nome = $2, obrigatorio = $3, sensivel = $4, ativo = $5, ordem = $6 where id = $1', [id, v.tipo.nome, v.tipo.obrigatorio, v.tipo.sensivel, v.tipo.ativo, ordem]);
          // Mudou o "sensível": o aparelho repuxa as fotos do tipo (o arquivo_id vem nulo ou preenchido conforme o tipo, ADR 0041 §3)
          if (v.tipo.sensivel !== antes.sensivel) await db.query('update core.cliente_foto set updated_at = now() where foto_tipo_id = $1', [id]);
        });
        await auditar(db, ctx, { acao: 'foto_tipo.editar', entidade: 'foto_tipo', entidadeId: id, antes: { nome: antes.nome, obrigatorio: antes.obrigatorio, sensivel: antes.sensivel, ativo: antes.ativo }, depois: { ...v.tipo, ordem } });
        return (await tipoPorId(db, id))!;
      }),
  },
  {
    metodo: 'DELETE',
    caminho: 'fotos-tipos/:id',
    acao: 'foto_tipo.editar',
    carteira: 'nao_se_aplica',
    status: 204,
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const id = (ctx.params as z.infer<typeof IdParam>).id;
        const antes = await tipoPorId(db, id);
        if (!antes) throw naoEncontrado();
        const d = decidirApagarTipoFoto(antes);
        if (!d.ok) recusar(d);
        await db.query('update core.foto_tipo set deleted_at = now() where id = $1', [id]);
        await auditar(db, ctx, { acao: 'foto_tipo.apagar', entidade: 'foto_tipo', entidadeId: id, antes: { nome: antes.nome }, depois: null });
        return null;
      }),
  },
  {
    // Resumo tem/falta do cliente. O `arquivo_id` só sai nos tipos que o perfil pode abrir (o sensível não vai ao vendedor).
    metodo: 'GET',
    caminho: 'clientes/:id/fotos',
    acao: 'cliente_foto.ver',
    carteira: 'filtrar_no_dominio',
    params: ClienteIdParam,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof ClienteIdParam>;
      const visiveis = await ctx.carteira();
      if (visiveis !== 'tenant' && !visiveis.has(id)) throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado na sua carteira. Atualize a lista e tente de novo.');
      return ctx.comTenant(async (db) => {
        const tipos = await tiposDeFoto(db);
        const fotos = (await db.query<{ foto_tipo_id: string; arquivo_id: string }>('select foto_tipo_id, arquivo_id from core.cliente_foto where cliente_id = $1 and deleted_at is null', [id])).rows;
        const r = resumoFotos(tipos, fotos);
        const arquivoDe = new Map(fotos.map((f) => [f.foto_tipo_id, f.arquivo_id]));
        const fachada = new Map(tipos.map((t) => [t.id, t.fachada]));
        return ResumoFotosClienteSchema.parse({
          faltam_obrigatorias: r.faltam_obrigatorias,
          itens: r.itens.map((i) => ({ ...i, arquivo_id: i.situacao === 'tem' && podeAbrirFoto(ctx.usuario.perfil, { fachada: fachada.get(i.tipo_id) ?? false }) ? (arquivoDe.get(i.tipo_id) ?? null) : null })),
        });
      });
    },
  },
];
