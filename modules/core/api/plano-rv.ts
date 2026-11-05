/**
 * Plano de RV (`/v1/core/plano-rv`, `/v1/core/rv`; RN-CORE-29/30; T-0082; desenho docs/desenho/T-0082.md).
 * Plano: um por tenant e mês de início (`core.plano_rv`, migração 0028); só analista e admin editam (`plano_rv.editar`),
 * com auditoria antes/depois (RN-AUD-01). RV: calculada na hora pelo domain (`calcularRvDaPessoa`) sobre o realizado da
 * MESMA apuração do `GET metas/painel` (`calcularIndicadores`); nada de RV é gravado. Escopo: `usuariosVisiveis()` (RN-CORE-04).
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  PlanoRvParamsSchema,
  PlanoRvPutSchema,
  PlanosRvSchema,
  RvPainelSchema,
  RvQuerySchema,
  type PlanoRvDto,
  type PlanoRvPut,
  type PlanosRv,
  type RvPainel,
} from '../contracts';
import {
  calcularRvDaPessoa,
  calendarioDoTenant,
  dataDoFechamento,
  dataLocal,
  diasUteisDoMes,
  mesesFechadosDesde,
  planoJaValeuEmMesFechado,
  planoVigente,
  situacaoDoPeriodo,
  validarEdicaoPlanoRv,
  type IndicadorRv,
  type PerfilRv,
  type PlanoRv,
} from '../domain';
import { auditar } from './auditoria';
import { calcularIndicadores, fontePorConsulta } from './metas';

interface LinhaPlano {
  id: string;
  nome: string;
  vigencia_inicio: string;
  perfis: PerfilRv[];
  valor_maximo_cents: number;
  regras: PlanoRv['regras'];
  updated_at: string;
  atualizado_por_nome: string | null;
}

/** Forma canônica (ordem de chaves e de faixas): o jsonb do banco reordena chaves, então comparar exige normalizar. */
export function normalizarPlano(p: Pick<PlanoRv, 'id' | 'nome' | 'vigencia_inicio' | 'perfis' | 'valor_maximo_cents' | 'regras'>): PlanoRv {
  return {
    id: p.id,
    nome: p.nome,
    vigencia_inicio: p.vigencia_inicio,
    perfis: [...new Set(p.perfis)].sort() as PerfilRv[],
    valor_maximo_cents: p.valor_maximo_cents,
    regras: p.regras.map((r) => ({
      indicador: r.indicador,
      peso_pct: r.peso_pct,
      gatilho: r.gatilho,
      faixas: [...r.faixas].sort((a, b) => a.de_pct - b.de_pct).map((f) => ({ de_pct: f.de_pct, modo: f.modo, pagamento_pct: f.pagamento_pct })),
    })),
  };
}

async function lerPlanos(db: ClienteBanco): Promise<LinhaPlano[]> {
  const r = await db.query<Omit<LinhaPlano, 'valor_maximo_cents'> & { valor_maximo_cents: string | number }>(
    `select p.id, p.nome, p.vigencia_inicio, p.perfis, p.valor_maximo_cents::float8 as valor_maximo_cents, p.regras,
            to_char(p.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at, u.nome as atualizado_por_nome
       from core.plano_rv p left join core.usuario u on u.tenant_id = p.tenant_id and u.id = p.atualizado_por
      where p.deleted_at is null order by p.vigencia_inicio, p.id`,
  );
  return r.rows.map((l) => ({ ...l, valor_maximo_cents: Number(l.valor_maximo_cents) }));
}

const paraDominio = (l: LinhaPlano): PlanoRv => normalizarPlano(l);

function montarLista(linhas: LinhaPlano[], hoje: string): PlanosRv {
  const planos = linhas.map(paraDominio);
  const fechados = planos.length > 0 ? mesesFechadosDesde(planos.map((p) => p.vigencia_inicio).sort()[0]!, hoje) : [];
  const dtos: PlanoRvDto[] = linhas.map((l, i) => ({
    ...planos[i]!,
    updated_at: l.updated_at,
    atualizado_por_nome: l.atualizado_por_nome,
    editavel: !planoJaValeuEmMesFechado(planos, planos[i]!, fechados),
  }));
  const mes = hoje.slice(0, 7);
  const vigente = [...dtos].filter((p) => p.vigencia_inicio <= mes).sort((a, b) => b.vigencia_inicio.localeCompare(a.vigencia_inicio))[0] ?? null;
  // mais recente primeiro: é a ordem de leitura do histórico de versões
  return PlanosRvSchema.parse({ vigente, planos: [...dtos].reverse() });
}

const erroDeRegra = (erros: string[]) => new ErroRegraNegocio('RN-CORE-30', erros.join(' '), { erros });

const planoDoCorpo = (id: string, c: PlanoRvPut): PlanoRv => normalizarPlano({ id, ...c });

export const rotasDePlanoRv: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'plano-rv',
    acao: 'plano_rv.ver',
    carteira: 'nao_se_aplica',
    executar: (ctx): Promise<PlanosRv> => ctx.comTenant(async (db) => montarLista(await lerPlanos(db), dataLocal(ctx.agora(), ctx.fuso()))),
  },
  {
    metodo: 'PUT',
    caminho: 'plano-rv/:id',
    acao: 'plano_rv.editar',
    carteira: 'nao_se_aplica',
    params: PlanoRvParamsSchema,
    corpo: PlanoRvPutSchema,
    executar: async (ctx): Promise<PlanoRvDto> => {
      const { id } = ctx.params as z.infer<typeof PlanoRvParamsSchema>;
      const novo = planoDoCorpo(id, ctx.corpo as PlanoRvPut);
      const hoje = dataLocal(ctx.agora(), ctx.fuso());
      return ctx.comTenant(async (db) => {
        const linhas = await lerPlanos(db);
        const planos = linhas.map(paraDominio);
        const atual = planos.find((p) => p.id === id) ?? null;
        if (!atual) {
          const apagado = await db.query('select 1 from core.plano_rv where id = $1 and deleted_at is not null', [id]);
          if ((apagado.rowCount ?? 0) > 0) throw erroDeRegra(['Este plano foi excluído. Crie um plano novo.']);
        }
        const primeiro = [...planos.map((p) => p.vigencia_inicio), novo.vigencia_inicio].sort()[0]!;
        const erros = validarEdicaoPlanoRv(planos, atual, novo, mesesFechadosDesde(primeiro, hoje));
        if (erros.length > 0) throw erroDeRegra(erros);
        // idempotente: o mesmo corpo não grava nem audita de novo
        if (!atual || JSON.stringify(atual) !== JSON.stringify(novo)) {
          const valores = [id, novo.nome, novo.vigencia_inicio, novo.perfis, novo.valor_maximo_cents, JSON.stringify(novo.regras), ctx.usuario.id];
          if (atual) {
            await db.query(
              'update core.plano_rv set nome = $2, vigencia_inicio = $3, perfis = $4::text[], valor_maximo_cents = $5, regras = $6::jsonb, atualizado_por = $7 where id = $1 and deleted_at is null',
              valores,
            );
          } else {
            await db.query(
              `insert into core.plano_rv (id, tenant_id, nome, vigencia_inicio, perfis, valor_maximo_cents, regras, atualizado_por)
               values ($1, plataforma.tenant_atual(), $2, $3, $4::text[], $5, $6::jsonb, $7)`,
              valores,
            );
          }
          await auditar(db, ctx, { acao: 'plano_rv.editar', entidade: 'plano_rv', entidadeId: id, antes: atual, depois: novo });
        }
        const lista = montarLista(await lerPlanos(db), hoje);
        const gravado = lista.planos.find((p) => p.id === id);
        if (!gravado) throw new ErroNaoEncontrado('PLANO_RV_NAO_ENCONTRADO', 'Plano de RV não encontrado. Atualize a lista e tente de novo.');
        return gravado;
      });
    },
  },
  {
    metodo: 'DELETE',
    caminho: 'plano-rv/:id',
    acao: 'plano_rv.editar',
    carteira: 'nao_se_aplica',
    params: PlanoRvParamsSchema,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof PlanoRvParamsSchema>;
      const hoje = dataLocal(ctx.agora(), ctx.fuso());
      return ctx.comTenant(async (db) => {
        const planos = (await lerPlanos(db)).map(paraDominio);
        const atual = planos.find((p) => p.id === id);
        if (!atual) return { id, excluido: true }; // idempotente: já não existe
        const fechados = mesesFechadosDesde(planos.map((p) => p.vigencia_inicio).sort()[0]!, hoje);
        if (planoJaValeuEmMesFechado(planos, atual, fechados)) {
          throw erroDeRegra(['Este plano já valeu para um mês fechado e não pode ser excluído. Crie uma versão nova com vigência a partir do mês aberto.']);
        }
        await db.query('update core.plano_rv set deleted_at = $3::timestamptz, atualizado_por = $2 where id = $1 and deleted_at is null', [id, ctx.usuario.id, ctx.agora().toISOString()]);
        await auditar(db, ctx, { acao: 'plano_rv.excluir', entidade: 'plano_rv', entidadeId: id, antes: atual, depois: null });
        return { id, excluido: true };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'rv',
    acao: 'rv.ver',
    carteira: 'filtrar_no_dominio',
    query: RvQuerySchema,
    executar: async (ctx): Promise<RvPainel> => {
      const visiveis = await ctx.usuariosVisiveis();
      const q = ctx.query as z.infer<typeof RvQuerySchema>;
      return ctx.comTenant(async (db, tx) => {
        const hoje = dataLocal(ctx.agora(), ctx.fuso());
        const periodo = q.periodo ?? hoje.slice(0, 7);
        const situacao = situacaoDoPeriodo(periodo, hoje);
        const fechamento_em = dataDoFechamento(periodo);
        const planos = (await lerPlanos(db)).map(paraDominio);
        const vazio = (plano_id: string | null) => RvPainelSchema.parse({ periodo, situacao, fechamento_em, plano_id, pessoas: [] });
        if (planos.length === 0) return vazio(null);

        // equipe fora do escopo = lista vazia (não revela que existe)
        let escopo: ReadonlySet<string> | 'tenant' = visiveis;
        if (q.equipe_id) {
          const m = await db.query<{ id: string }>("select id from core.usuario where equipe_id = $1 and deleted_at is null and ativo and perfil in ('vendedor', 'promotor')", [q.equipe_id]);
          escopo = new Set(m.rows.map((r) => r.id).filter((i) => visiveis === 'tenant' || visiveis.has(i)));
        }
        const ind = await calcularIndicadores(db, escopo, ctx.agora(), ctx.fuso(), { periodo, usuario_id: q.usuario_id }, fontePorConsulta(tx));
        const ids = ind.itens.map((i) => i.usuario_id);
        const info = await db.query<{ id: string; perfil: string; equipe_id: string | null }>('select id, perfil, equipe_id from core.usuario where id = any($1::uuid[])', [ids]);
        const infoDe = new Map(info.rows.map((r) => [r.id, r]));
        const parametros = await db.query<{ modulo: string; chave: string; valor: unknown }>(
          "select modulo, chave, valor from plataforma.parametro where modulo = 'core' and chave = 'metas.dias_uteis_semana' and deleted_at is null",
        );
        const dias = diasUteisDoMes(periodo, hoje, calendarioDoTenant(parametros.rows).dias_uteis_semana);

        const pessoas: RvPainel['pessoas'] = [];
        let planoUsado: string | null = null;
        for (const item of ind.itens) {
          const u = infoDe.get(item.usuario_id);
          const perfil = u?.perfil === 'vendedor' || u?.perfil === 'promotor' ? u.perfil : null;
          const plano = perfil ? planoVigente(planos, periodo, perfil) : null;
          if (!perfil || !plano) continue; // sem plano para o perfil naquele mês: sem RV
          if (!planoUsado || perfil === 'vendedor') planoUsado = plano.id;
          const metas: Partial<Record<IndicadorRv, number>> = {};
          const realizados: Partial<Record<IndicadorRv, number>> = {};
          for (const m of item.metas) {
            metas[m.indicador] = m.meta;
            realizados[m.indicador] = m.realizado ?? 0;
          }
          const rv = calcularRvDaPessoa(plano, metas, realizados, dias, situacao);
          pessoas.push({
            usuario_id: item.usuario_id,
            nome: item.usuario_nome,
            equipe_id: u?.equipe_id ?? null,
            rv_cents: rv.rv_cents,
            rv_bruta_cents: rv.rv_bruta_cents,
            bloqueada_por: rv.bloqueada_por,
            indicadores: rv.indicadores.map((l) => ({
              indicador: l.indicador,
              meta: l.meta,
              realizado: l.realizado,
              atingimento_pbp: Math.round(l.atingimento_pct * 100),
              projetado_pbp: Math.round(l.projetado_pct * 100),
              pagamento_pct: l.pagamento_pct,
              valor_cents: l.valor_cents,
              gatilho: l.gatilho,
              gatilho_ok: l.gatilho_ok,
              sem_meta: l.sem_meta,
            })),
          });
        }
        return RvPainelSchema.parse({ periodo, situacao, fechamento_em, plano_id: planoUsado, pessoas });
      });
    },
  },
];
