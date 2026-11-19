/**
 * Leitura do trajeto do dia (T-0156; desenho `tracking.md` §5.2 e §7; ADR 0061). RN-CORE-13 e RN-CORE-04.
 * - `GET /v1/core/trajeto?usuario_id&data`: o próprio com `trajeto.ver_proprio`; outro usuário com `trajeto.ver_equipe`, só no escopo
 *   (fora dele = 404, igual a um que não existe); até 90 dias atrás.
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

/** Pontos e pausas do dia (data no fuso do tenant) dos usuários vivos entre os ids; quem não existe não volta. */
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
  const pausas = (
    await db.query<{ usuario_id: string; inicio: string; fim: string | null }>(
      `select usuario_id, to_char(inicio at time zone 'UTC', ${ISO}) as inicio, to_char(fim at time zone 'UTC', ${ISO}) as fim
         from core.pausa_trajeto
        where deleted_at is null and usuario_id = any($1::uuid[]) and inicio < ${fimJanela} and (fim is null or fim >= ${janela})
        order by usuario_id, inicio`,
      [ids, data, fuso],
    )
  ).rows;
  return ids.map((id) => {
    const meus = pontos.filter((p) => p.usuario_id === id).map((p) => ({ capturado_em: p.capturado_em, latitude: Number(p.latitude), longitude: Number(p.longitude), precisao_m: p.precisao_m }));
    return {
      id,
      metros: metrosDoTrajeto(meus).metros,
      pontos: meus.map((p) => ({ ...p, precisao_m: p.precisao_m ?? 0 })),
      pausas: pausas.filter((p) => p.usuario_id === id).map((p) => ({ inicio: p.inicio, fim: p.fim })),
    };
  });
}

export const rotasDeTrajeto: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'trajeto',
    // vale para o Campo ("Meu trajeto") e para o BKO/Gestão (equipe): a permissão decide dentro, por alvo
    carteira: 'nao_se_aplica',
    query: TrajetoQuerySchema,
    executar: async (ctx): Promise<TrajetoResposta> => {
      const q = ctx.query as TrajetoQuery;
      const alvo = q.usuario_id ?? ctx.usuario.id;
      const proprio = alvo === ctx.usuario.id;
      const verEquipe = pode(ctx.usuario.perfis, 'trajeto.ver_equipe');
      if (!(proprio ? pode(ctx.usuario.perfis, 'trajeto.ver_proprio') || verEquipe : verEquipe)) {
        throw new ErroHttpModulo(403, 'SEM_PERMISSAO', proprio ? 'Você não pode ver o seu trajeto. Fale com o administrador da empresa.' : 'Você não pode ver o trajeto da equipe. Fale com o administrador da empresa.');
      }
      exigirDataNaRetencao(q.data, ctx.agora(), ctx.fuso());
      const visiveis = await ctx.usuariosVisiveis();
      if (!proprio && visiveis !== 'tenant' && !visiveis.has(alvo)) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
      const fuso = ctx.fuso();
      const [usuario] = await ctx.comTenant((db) => trajetoDosUsuarios(db, [alvo], q.data, fuso));
      if (!usuario) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Atualize a lista e tente de novo.');
      return { data: q.data, usuario };
    },
  },
];

export const consultaTrajetoDoDia = implementarConsulta(CONSULTA_TRAJETO_DO_DIA, async (entrada, ctx): Promise<TrajetoDoDiaSaida> => {
  // sem a permissão, nada do escopo é visível (não é erro: a consulta devolve só o que quem pergunta pode ver)
  if (!pode(ctx.usuario.perfis, 'trajeto.ver_equipe')) return { data: entrada.data, usuarios: [] };
  exigirDataNaRetencao(entrada.data, ctx.agora(), ctx.fuso());
  const visiveis = await usuariosVisiveisNaTransacao(ctx.usuario, ctx.db);
  const pedidos = visiveis === 'tenant' ? entrada.usuario_ids : entrada.usuario_ids.filter((id) => visiveis.has(id));
  return { data: entrada.data, usuarios: await trajetoDosUsuarios(ctx.db, pedidos, entrada.data, ctx.fuso()) };
});
