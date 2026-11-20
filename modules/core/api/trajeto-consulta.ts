/**
 * Leitura do trajeto do dia (T-0156; desenho `tracking.md` §5.2 e §7; ADR 0061). RN-CORE-13 e RN-CORE-04.
 * - `GET /v1/core/trajeto?usuario_id&data`: exige `usuario_id` e `trajeto.ver_equipe`, só no escopo (fora dele = 404, igual a um que
 *   não existe; o próprio usuário também dá 404, para qualquer perfil); até 90 dias atrás.
 * - `core.trajeto_do_dia@1` (provedor): o Gestor lê os pontos da equipe; o escopo e a permissão são conferidos AQUI, e id fora dele some.
 * O analista não vê pontos (não tem `trajeto.ver_equipe` de fábrica) e nenhuma rota exporta pontos. Nenhuma coordenada vai para log.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, implementarConsulta, pode, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { CONSULTA_TRAJETO_DO_DIA, TRAJETO_DIAS_MAX, TrajetoQuerySchema, type TrajetoDoDiaSaida, type TrajetoDoUsuario, type TrajetoQuery, type TrajetoResposta } from '../contracts';
import { metrosDoTrajeto } from '../domain/performance/trajeto';
import { usuariosVisiveisNaTransacao } from './usuarios-visiveis';

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const DIA_MS = 86_400_000;

/** RN-CORE-13: o trajeto só existe por `TRAJETO_DIAS_MAX` dias (expurgo); data mais antiga que isso é recusada. */
export function exigirDataNaRetencao(data: string, agora: Date, fuso: string): void {
  const hoje = Date.parse(`${localIsoDate(agora, fuso)}T00:00:00Z`);
  if (Date.parse(`${data}T00:00:00Z`) < hoje - TRAJETO_DIAS_MAX * DIA_MS) {
    throw new ErroRegraNegocio('TRAJETO_FORA_DA_RETENCAO', `O trajeto fica guardado por ${TRAJETO_DIAS_MAX} dias. Escolha uma data mais recente.`);
  }
}

/** Pontos do dia (data no fuso do tenant) dos usuários vivos entre os ids; quem não existe não volta. */
export async function trajetoDosUsuarios(db: ClienteBanco, usuarioIds: readonly string[], data: string, fuso: string): Promise<TrajetoDoUsuario[]> {
  if (usuarioIds.length === 0) return [];
  const janela = '($2::date)::timestamp at time zone $3';
  const fimJanela = '(($2::date) + 1)::timestamp at time zone $3';
  const ids = (await db.query<{ id: string }>('select id from core.usuario where deleted_at is null and id = any($1::uuid[]) order by id', [[...usuarioIds]])).rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const pontos = (
    await db.query<{ usuario_id: string; capturado_em: string; latitude: string; longitude: string; precisao_m: number | null }>(
      `select usuario_id, to_char(capturado_em at time zone 'UTC', ${ISO}) as capturado_em, latitude::text as latitude, longitude::text as longitude, precisao_m
         from core.ponto_trajeto
        where deleted_at is null and usuario_id = any($1::uuid[]) and capturado_em >= ${janela} and capturado_em < ${fimJanela}
        order by usuario_id, capturado_em`,
      [ids, data, fuso],
    )
  ).rows;
  return ids.map((id) => {
    const meus = pontos.filter((p) => p.usuario_id === id).map((p) => ({ capturado_em: p.capturado_em, latitude: Number(p.latitude), longitude: Number(p.longitude), precisao_m: p.precisao_m }));
    return {
      id,
      metros: metrosDoTrajeto(meus).metros,
      pontos: meus.map((p) => ({ ...p, precisao_m: p.precisao_m ?? 0 })),
    };
  });
}

const usuarioNaoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');

export const rotasDeTrajeto: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'trajeto',
    // BKO e Gestão (equipe): a permissão e o escopo são conferidos dentro, por alvo
    carteira: 'nao_se_aplica',
    query: TrajetoQuerySchema,
    executar: async (ctx): Promise<TrajetoResposta> => {
      const q = ctx.query as TrajetoQuery;
      const alvo = q.usuario_id;
      if (!pode(ctx.usuario.perfis, 'trajeto.ver_equipe')) {
        throw new ErroHttpModulo(403, 'SEM_PERMISSAO', 'Você não pode ver o trajeto da equipe. Fale com o administrador da empresa.');
      }
      exigirDataNaRetencao(q.data, ctx.agora(), ctx.fuso());
      // RN-CORE-13: o próprio trajeto nunca aparece (igual a um usuário que não existe)
      if (alvo === ctx.usuario.id) throw usuarioNaoEncontrado();
      const visiveis = await ctx.usuariosVisiveis();
      if (visiveis !== 'tenant' && !visiveis.has(alvo)) throw usuarioNaoEncontrado();
      const fuso = ctx.fuso();
      const [usuario] = await ctx.comTenant((db) => trajetoDosUsuarios(db, [alvo], q.data, fuso));
      if (!usuario) throw usuarioNaoEncontrado();
      return { data: q.data, usuario };
    },
  },
];

export const consultaTrajetoDoDia = implementarConsulta(CONSULTA_TRAJETO_DO_DIA, async (entrada, ctx): Promise<TrajetoDoDiaSaida> => {
  // sem a permissão, nada do escopo é visível (não é erro: a consulta devolve só o que quem pergunta pode ver)
  if (!pode(ctx.usuario.perfis, 'trajeto.ver_equipe')) return { data: entrada.data, usuarios: [] };
  exigirDataNaRetencao(entrada.data, ctx.agora(), ctx.fuso());
  const visiveis = await usuariosVisiveisNaTransacao(ctx.usuario, ctx.db);
  const doEscopo = visiveis === 'tenant' ? entrada.usuario_ids : entrada.usuario_ids.filter((id) => visiveis.has(id));
  const pedidos = doEscopo.filter((id) => id !== ctx.usuario.id); // RN-CORE-13: o id da sessão sai
  return { data: entrada.data, usuarios: await trajetoDosUsuarios(ctx.db, pedidos, entrada.data, ctx.fuso()) };
});
