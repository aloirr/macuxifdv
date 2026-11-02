/**
 * Rotas REST do Promotor (`/v1/promotor`; T-0056). O `createApp` aplica, em toda rota: login, LICENÇA do módulo, perfil
 * (pela ação do manifesto ou `perfis`), Zod e, quando a rota diz o cliente, a carteira (CLAUDE.md regra 6).
 *  - coletas: o mesmo `recebimento` do push (o app usa o sync; estas rotas servem integrações e testes de ponta a ponta);
 *  - relatórios do BKO de trade (RF-PRO-12): share × meta e ruptura por loja, no escopo de quem lê (RN-CORE-04).
 * RN-PRO-01: nenhum caminho nem ação de pedido.
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { ErroHttpModulo, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AcaoConcorrencia,
  ChecklistResposta,
  ColetaPreco,
  FiltroRelatorio,
  FotoColeta,
  GondolaRegistro,
  MedicaoShare,
  PontoExtra,
  RupturaItem,
  TarefaExecucao,
  ValidadeItem,
  VisitaLoja,
  type ColetaRegistradaApi,
  type RelatorioRupturaApi,
  type RelatorioShareApi,
} from '../contracts';
import { relatorioRupturaPorLoja, relatorioShareMeta, visitasQueContam, type ColetaDaVisita, type StatusPresenca } from '../domain';
import { parametrosDoTenant } from './parametros';
import type { Recebimento, ResultadoRecebimento } from './recebimento';
import type { RepositorioPromotor } from './repositorio';

/** Quem lê os relatórios de trade (doc 03 §2): gestores e o BKO. O promotor vê as próprias coletas no app. */
export const PERFIS_RELATORIO = ['supervisor', 'gerente', 'analista', 'admin'] as const;
/** Janela padrão dos relatórios quando o filtro não diz: últimos 30 dias civis no fuso do tenant. */
export const DIAS_PADRAO_RELATORIO = 30;

function respostaDoRecebimento(id: string, r: ResultadoRecebimento): ColetaRegistradaApi {
  if (r.tipo === 'aceito') return { id, situacao: r.situacao };
  if (r.tipo === 'conflito') throw new ErroHttpModulo(409, 'CONFLITO', r.mensagem);
  throw new ErroHttpModulo(r.recusa.http, r.recusa.codigo, r.recusa.mensagem);
}

/** Coleta REST: caminho, ação do manifesto (perfil) e contrato do corpo. */
const COLETAS_REST: readonly { entidade: ColetaDaVisita; caminho: string; acao: string; corpo: z.ZodTypeAny }[] = [
  { entidade: 'foto_coleta', caminho: 'coletas/fotos', acao: 'coleta.registrar', corpo: FotoColeta },
  { entidade: 'checklist_resposta', caminho: 'coletas/checklist', acao: 'checklist_loja.responder', corpo: ChecklistResposta },
  { entidade: 'gondola_registro', caminho: 'coletas/gondola', acao: 'gondola.registrar', corpo: GondolaRegistro },
  { entidade: 'medicao_share', caminho: 'coletas/share', acao: 'share.registrar', corpo: MedicaoShare },
  { entidade: 'coleta_preco', caminho: 'coletas/precos', acao: 'preco.registrar', corpo: ColetaPreco },
  { entidade: 'ruptura_item', caminho: 'coletas/ruptura', acao: 'ruptura.registrar', corpo: RupturaItem },
  { entidade: 'validade_item', caminho: 'coletas/validade', acao: 'validade.registrar', corpo: ValidadeItem },
  { entidade: 'ponto_extra', caminho: 'coletas/pontos-extras', acao: 'ponto_extra.registrar', corpo: PontoExtra },
  { entidade: 'acao_concorrencia', caminho: 'coletas/concorrencia', acao: 'concorrencia.registrar', corpo: AcaoConcorrencia },
  { entidade: 'tarefa_execucao', caminho: 'coletas/tarefas', acao: 'tarefa_trade.concluir', corpo: TarefaExecucao },
];

/** Período do filtro (padrão: últimos 30 dias até hoje no fuso do tenant). */
export function periodoDoFiltro(ctx: Pick<ContextoBase, 'agora' | 'fuso'>, f: z.infer<typeof FiltroRelatorio>): { de: string; ate: string } {
  const ate = f.ate ?? localIsoDate(ctx.agora(), ctx.fuso());
  return { de: f.de ?? somarDiasCivis(ate, -(DIAS_PADRAO_RELATORIO - 1)), ate };
}

export function criarRotasPromotor(repo: RepositorioPromotor, recebimento: Recebimento): RotaModulo[] {
  const visitaLoja: RotaModulo = {
    metodo: 'POST',
    caminho: 'visitas-loja',
    acao: 'coleta.registrar',
    corpo: VisitaLoja,
    carteira: (e) => (e.corpo as VisitaLoja).cliente_id,
    async executar(ctx) {
      const v = ctx.corpo as VisitaLoja;
      return ctx.comTenant(async (db, tx) => respostaDoRecebimento(v.id, await recebimento.visitaLoja(ctx, { db, tenant_id: ctx.usuario.tenant_id }, tx, v)));
    },
  };

  const coletas = COLETAS_REST.map(
    (c): RotaModulo => ({
      metodo: 'POST',
      caminho: c.caminho,
      acao: c.acao,
      corpo: c.corpo,
      // a loja vem da visita de loja: o recebimento confere a carteira dela (RN-CORE-04)
      carteira: 'filtrar_no_dominio',
      async executar(ctx) {
        const p = ctx.corpo as Record<string, unknown> & { id: string; visita_loja_id: string };
        return ctx.comTenant(async (db, tx) => respostaDoRecebimento(p.id, await recebimento.coleta(ctx, { db, tenant_id: ctx.usuario.tenant_id }, tx, c.entidade, p)));
      },
    }),
  );

  /** Visitas do período no escopo de quem lê: promotores visíveis (equipe) e lojas da carteira (RN-CORE-04). */
  async function visitasNoEscopo(ctx: ContextoBase, db: Parameters<Parameters<ContextoBase['comTenant']>[0]>[0], f: z.infer<typeof FiltroRelatorio>) {
    const { de, ate } = periodoDoFiltro(ctx, f);
    const [usuarios, carteira] = await Promise.all([ctx.usuariosVisiveis(), ctx.carteira()]);
    const todas = await repo.visitasDoPeriodo({ db, tenant_id: ctx.usuario.tenant_id }, { de, ate, fuso: ctx.fuso(), ...(f.cliente_id ? { cliente_id: f.cliente_id } : {}) });
    const visitas = todas.filter((v) => (usuarios === 'tenant' || usuarios.has(v.promotor_id)) && (carteira === 'tenant' || carteira.has(v.cliente_id)));
    return { de, ate, visitas, validas: visitasQueContam(visitas, parametrosDoTenant(ctx).permanencia_min_min) };
  }

  const relatorioShare: RotaModulo = {
    metodo: 'GET',
    caminho: 'relatorios/share',
    perfis: [...PERFIS_RELATORIO],
    carteira: 'filtrar_no_dominio',
    query: FiltroRelatorio,
    async executar(ctx): Promise<RelatorioShareApi> {
      const f = ctx.query as z.infer<typeof FiltroRelatorio>;
      return ctx.comTenant(async (db) => {
        const { de, ate, validas } = await visitasNoEscopo(ctx, db, f);
        const medicoes = await repo.coletasDasVisitas({ db, tenant_id: ctx.usuario.tenant_id }, 'medicao_share', [...validas]);
        const r = relatorioShareMeta(
          medicoes.map((m) => ({ cliente_id: m.cliente_id, visita_loja_id: m.visita_loja_id, ...(m.payload as Pick<MedicaoShare, 'categoria_gondola_id' | 'share_pct' | 'meta_pct' | 'medido_em'>) })),
          validas,
        );
        return { de, ate, ...r };
      });
    },
  };

  const relatorioRuptura: RotaModulo = {
    metodo: 'GET',
    caminho: 'relatorios/ruptura',
    perfis: [...PERFIS_RELATORIO],
    carteira: 'filtrar_no_dominio',
    query: FiltroRelatorio,
    async executar(ctx): Promise<RelatorioRupturaApi> {
      const f = ctx.query as z.infer<typeof FiltroRelatorio>;
      return ctx.comTenant(async (db) => {
        const { de, ate, visitas, validas } = await visitasNoEscopo(ctx, db, f);
        const itens = await repo.coletasDasVisitas({ db, tenant_id: ctx.usuario.tenant_id }, 'ruptura_item', [...validas]);
        const linhas = relatorioRupturaPorLoja(
          itens.map((i) => ({ visita_loja_id: i.visita_loja_id, ...(i.payload as { status: StatusPresenca; quantidade_reposta: number }) })),
          visitas,
          validas,
        );
        return { de, ate, linhas };
      });
    },
  };

  return [visitaLoja, ...coletas, relatorioShare, relatorioRuptura];
}
