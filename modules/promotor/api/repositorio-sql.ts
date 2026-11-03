/**
 * `RepositorioPromotor` sobre o schema `promotor` (migração 0015, banco-dados; T-0056). Só persistência: repetido,
 * conflito, checkout e janela da visita são decididos pelo domain/recebimento; aqui só se lê e grava.
 * Roda no `ClienteBanco` da `SessaoTenant` (transação de `ctx.comTenant`: papel macuxi_app, RLS por `app.tenant_id`) —
 * nunca abre conexão própria. O `tenant_id` do filtro é redundância de leitura/índice; quem isola é o RLS.
 * O INSERT grava só `(id, tenant_id, promotor_id, [cliente_id,] payload, recebido_em)`: o gatilho `derivar_<tabela>`
 * preenche as colunas tipadas a partir do payload. A tabela de cada entidade vem de um MAPA FIXO (nunca texto do cliente).
 * SQL de referência: docs/banco/promotor.md ("SQL da RepositorioPromotor"). Sem dado pessoal em log nem em erro.
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import type { ColetaDaVisita, VisitaLojaGuardada } from '../domain';
import type { ColetaGuardada, FiltroVisitas, RepositorioPromotor, SessaoTenant } from './repositorio';

/** Entidade de coleta → tabela do schema `promotor` (lista fechada; interpolada no SQL só a partir daqui). */
export const TABELA_DA_COLETA: Readonly<Record<ColetaDaVisita, string>> = {
  foto_coleta: 'promotor.foto_coleta',
  checklist_resposta: 'promotor.checklist_resposta',
  gondola_registro: 'promotor.gondola_registro',
  medicao_share: 'promotor.medicao_share',
  coleta_preco: 'promotor.coleta_preco',
  ruptura_item: 'promotor.ruptura_item',
  validade_item: 'promotor.validade_item',
  ponto_extra: 'promotor.ponto_extra',
  acao_concorrencia: 'promotor.acao_concorrencia',
  tarefa_execucao: 'promotor.tarefa_execucao',
};

/** Instante em ISO 8601 UTC com `Z` (milissegundos), igual ao que o app e o recebimento usam. */
const ISO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const COLUNAS_COLETA = `id, visita_loja_id, promotor_id, cliente_id, payload, to_char(recebido_em at time zone 'UTC', ${ISO_UTC}) as recebido_em`;

interface LinhaVisita {
  id: string;
  promotor_id: string;
  payload: Record<string, unknown>;
}
interface LinhaColeta {
  id: string;
  visita_loja_id: string;
  promotor_id: string;
  cliente_id: string;
  payload: Record<string, unknown>;
  recebido_em: string;
}

const paraVisita = (l: LinhaVisita): VisitaLojaGuardada => ({ ...(l.payload as unknown as Omit<VisitaLojaGuardada, 'promotor_id'>), promotor_id: l.promotor_id });

const paraColeta = (entidade: ColetaDaVisita, l: LinhaColeta): ColetaGuardada => ({
  entidade,
  id: l.id,
  visita_loja_id: l.visita_loja_id,
  promotor_id: l.promotor_id,
  cliente_id: l.cliente_id,
  payload: l.payload,
  recebido_em: l.recebido_em,
});

const tabelaDa = (entidade: ColetaDaVisita): string => {
  const t = TABELA_DA_COLETA[entidade];
  if (!t) throw new Error(`Entidade de coleta desconhecida: ${String(entidade)}`);
  return t;
};

export function criarRepositorioSql(): RepositorioPromotor {
  return {
    async visita(s: SessaoTenant, id) {
      const r = await s.db.query<LinhaVisita>('select id, promotor_id, payload from promotor.visita_loja where tenant_id = $1 and id = $2 for update', [s.tenant_id, id]);
      return r.rows[0] ? paraVisita(r.rows[0]) : null;
    },

    async gravarVisita(s, v) {
      // o promotor_id é coluna (vem do token); o payload é o contrato como o servidor o aceitou, sem ele
      const { promotor_id, ...payload } = v;
      const r = await s.db.query(
        `insert into promotor.visita_loja as v (id, tenant_id, promotor_id, payload, recebido_em)
         values ($1, $2, $3, $4::jsonb, now())
         on conflict (id) do update set payload = excluded.payload
          where v.checkout_em is null and v.promotor_id = excluded.promotor_id`,
        [v.id, s.tenant_id, promotor_id, JSON.stringify(payload)],
      );
      // 0 linhas = a visita já estava fechada (ou é de outro promotor): o domain já tinha decidido, então é corrida/bug — não segue
      if (r.rowCount === 0) throw new ErroHttpModulo(409, 'VISITA_LOJA_FECHADA', 'A visita de loja já foi encerrada e não aceita mais alteração.');
    },

    async coleta(s, entidade, id) {
      const r = await s.db.query<LinhaColeta>(`select ${COLUNAS_COLETA} from ${tabelaDa(entidade)} where tenant_id = $1 and id = $2`, [s.tenant_id, id]);
      return r.rows[0] ? paraColeta(entidade, r.rows[0]) : null;
    },

    async gravarColeta(s, c) {
      try {
        await s.db.query(
          `insert into ${tabelaDa(c.entidade)} (id, tenant_id, promotor_id, cliente_id, payload, recebido_em) values ($1, $2, $3, $4, $5::jsonb, $6)`,
          [c.id, s.tenant_id, c.promotor_id, c.cliente_id, JSON.stringify(c.payload), c.recebido_em],
        );
      } catch (e) {
        // corrida: outra transação gravou o mesmo id entre a leitura do recebimento e este INSERT. A transação já está
        // abortada (não dá para reler nela): erro retentável (503) — o reenvio lê a linha e decide repetida × conflito.
        if ((e as { code?: string }).code === '23505') throw new ErroHttpModulo(503, 'COLETA_EM_CORRIDA', 'A coleta chegou em duplicidade; reenvie para confirmar.');
        throw e;
      }
    },

    async coletasDasVisitas(s, entidade, visitaLojaIds) {
      if (visitaLojaIds.length === 0) return [];
      const r = await s.db.query<LinhaColeta>(
        `select ${COLUNAS_COLETA} from ${tabelaDa(entidade)}
          where tenant_id = $1 and visita_loja_id = any($2::uuid[]) and deleted_at is null
          order by visita_loja_id, id`,
        [s.tenant_id, [...visitaLojaIds]],
      );
      return r.rows.map((l) => paraColeta(entidade, l));
    },

    async visitasDoPeriodo(s, f: FiltroVisitas) {
      // data LOCAL do check-in no fuso do tenant -> [meia-noite de `de`, meia-noite de `ate + 1`) em instantes UTC
      const r = await s.db.query<LinhaVisita>(
        `select id, promotor_id, payload from promotor.visita_loja
          where tenant_id = $1
            and checkin_em >= ($2::date)::timestamp at time zone $4
            and checkin_em <  ($3::date + 1)::timestamp at time zone $4
            and ($5::uuid is null or cliente_id = $5)
            and deleted_at is null
          order by checkin_em, id`,
        [s.tenant_id, f.de, f.ate, f.fuso, f.cliente_id ?? null],
      );
      return r.rows.map(paraVisita);
    },

    async nomesDasCategorias(s, ids) {
      if (ids.length === 0) return new Map();
      const r = await s.db.query<{ id: string; nome: string }>('select id, nome from promotor.categoria_gondola where tenant_id = $1 and id = any($2::uuid[])', [s.tenant_id, [...ids]]);
      return new Map(r.rows.map((l) => [l.id, l.nome] as const));
    },
  };
}
