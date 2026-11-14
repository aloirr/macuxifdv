/**
 * Pendência de etapa no checkout (RN-CORE-12, complemento T-0039 §2; docs/desenho/T-0039.md, docs/design/checkout-pendencia.md).
 * - `gravarEtapasDoCheckout`: upsert de `core.visita_etapa` sem rebaixar uma linha `concluida`, e a contagem `visita.etapas_pendentes`
 *   na MESMA transação do checkout (o banco não recalcula).
 * - `consumidorBaixaPorResposta`: `pesquisa.resposta.registrada@1` → conclui a tarefa de pesquisa do usuário (T-0170, `concluirTarefaPorResposta`)
 *   → reconsulta `<modulo>.etapas_checkout@1` → baixa (idempotente).
 * - `alertarPendenciasVencidas`: varredura do alerta (`checkout_pendencia_alerta_h`, padrão 24): reconsulta, e se ainda pendente
 *   notifica vendedor e supervisor UMA vez (`alertada_em`; `envio_id` = id da linha torna a notificação idempotente).
 * - Dispensa manual no BKO (§2.5a): `POST visitas/:id/etapas/:modulo/:etapa/dispensa`, com justificativa e auditoria (RN-AUD-01).
 * Sem dado pessoal em log: só ids.
 */
import { definirConsumidor, eventoTolerante, type ClienteBanco, type ConsumidorEvento, type ContextoConsumo, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  DispensarEtapaParamsSchema,
  DispensarEtapaRequestSchema,
  DispensarEtapaRespostaSchema,
  EVENTO_NOTIFICACAO_CRIADA,
  PARAMETRO_CHECKOUT_PENDENCIA_ALERTA_H,
  ParametroCheckoutPendenciaSchema,
  type DispensarEtapaResposta,
  type ParametroCheckoutPendencia,
  type SituacaoVisitaEtapa,
} from '../contracts';
import { baixarPendenciasPorEvento, pendenciaViraAlerta, prazoAlertaPendenciaH, textoAlertaPendencia } from '../domain';
import { DEF_RESPOSTA_REGISTRADA } from '../../pesquisa/contracts';
import { auditar } from './auditoria';
import { erroHttp } from './erros';
import { concluirTarefaPorResposta } from './tarefas';
import { CONSULTAS_ETAPAS_CHECKOUT, MODULO_DO_EVENTO_DE_BAIXA, verificadorPorConsulta } from './etapas-checkout';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: Date | string): string => new Date(d).toISOString();

/** `visita.etapas_pendentes` = linhas `pendente` vivas da visita. Chamar na mesma transação que mexe em `visita_etapa`. */
export async function recalcularEtapasPendentes(db: ClienteBanco, visitaId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `update core.visita v
        set etapas_pendentes = least(32767, (select count(*) from core.visita_etapa e
                                              where e.tenant_id = v.tenant_id and e.visita_id = v.id and e.situacao = 'pendente' and e.deleted_at is null))
      where v.id = $1
      returning v.etapas_pendentes as n`,
    [visitaId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export interface EtapaParaGravar {
  modulo: string;
  etapa: string;
  situacao: SituacaoVisitaEtapa;
  rotulo?: string | null;
  referenciaId?: string | null;
}

/**
 * Checkout: grava as etapas da visita. Linha já `concluida` não é rebaixada (nota (a) do engenheiro-software);
 * `pendente_desde` é o instante do servidor; contagem recalculada na mesma transação.
 */
export async function gravarEtapasDoCheckout(db: ClienteBanco, visitaId: string, etapas: readonly EtapaParaGravar[], agora: Date): Promise<number> {
  for (const e of etapas) {
    const ref = e.referenciaId && UUID.test(e.referenciaId) ? e.referenciaId : null;
    await db.query(
      `insert into core.visita_etapa (tenant_id, visita_id, modulo, etapa, situacao, referencia_id, rotulo, pendente_desde)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, case when $4 = 'pendente' then $7::timestamptz else null end)
       on conflict (tenant_id, visita_id, modulo, etapa) do update
          set situacao = excluded.situacao, referencia_id = excluded.referencia_id, rotulo = excluded.rotulo, pendente_desde = excluded.pendente_desde
        where core.visita_etapa.situacao not in ('concluida', 'dispensada')`,
      [visitaId, e.modulo, e.etapa, e.situacao, ref, e.rotulo ?? null, iso(agora)],
    );
  }
  return recalcularEtapasPendentes(db, visitaId);
}

interface LinhaEtapa {
  id: string;
  visita_id: string;
  modulo: string;
  etapa: string;
  situacao: SituacaoVisitaEtapa;
  rotulo: string | null;
  pendente_desde: Date | null;
  alertada_em: Date | null;
}

export interface ResultadoReconsulta {
  baixadas: number;
  pendentes: number;
}

/**
 * Reconsulta `<modulo>.etapas_checkout@1` da visita e baixa (`concluida` + `resolvida_em`) as pendentes que a consulta diz concluídas.
 * Idempotente: sem linha pendente do módulo não consulta nem muda nada. Fecha a corrida checkout × evento (as linhas são travadas).
 */
export async function reconsultarEBaixar(
  db: ClienteBanco,
  consultar: TransacaoTenant['consultar'],
  o: { visitaId: string; modulo: string; referenciaId: string | null; agora: Date },
): Promise<ResultadoReconsulta> {
  // Ordem de trava única (visita, depois visita_etapa), igual ao checkout e à dispensa: evita deadlock.
  const v = (
    await db.query<{ cliente_id: string; usuario_id: string }>('select cliente_id, usuario_id from core.visita where id = $1 and deleted_at is null for update', [o.visitaId])
  ).rows[0];
  if (!v) return { baixadas: 0, pendentes: 0 };
  const linhas = (
    await db.query<LinhaEtapa>(
      `select id, visita_id, modulo, etapa, situacao, rotulo, pendente_desde, alertada_em from core.visita_etapa
        where visita_id = $1 and deleted_at is null order by modulo, etapa for update`,
      [o.visitaId],
    )
  ).rows;
  const doModulo = linhas.some((l) => l.situacao === 'pendente' && l.modulo === o.modulo);
  const pendentesAntes = linhas.filter((l) => l.situacao === 'pendente').length;
  if (!doModulo) return { baixadas: 0, pendentes: pendentesAntes };
  const defs = CONSULTAS_ETAPAS_CHECKOUT.filter((d) => d.modulo === o.modulo);
  const reconsulta = await verificadorPorConsulta({ consultar }, defs)({ visita_id: o.visitaId, cliente_id: v.cliente_id, usuario_id: v.usuario_id, cliente_fechado: false });
  const r = baixarPendenciasPorEvento({
    linhas: linhas.map((l) => ({ visitaId: l.visita_id, modulo: l.modulo, etapa: l.etapa, situacao: l.situacao })),
    visitaId: o.visitaId,
    modulo: o.modulo,
    referenciaId: o.referenciaId ?? '',
    reconsulta,
    agora: iso(o.agora),
  });
  const ref = o.referenciaId && UUID.test(o.referenciaId) ? o.referenciaId : null;
  for (const b of r.baixar) {
    await db.query(
      `update core.visita_etapa set situacao = 'concluida', resolvida_em = $4, referencia_id = coalesce($5::uuid, referencia_id)
        where visita_id = $1 and modulo = $2 and etapa = $3 and situacao = 'pendente'`,
      [o.visitaId, o.modulo, b.etapa, b.resolvidaEm, ref],
    );
    const linha = linhas.find((l) => l.modulo === o.modulo && l.etapa === b.etapa);
    if (linha) await baixarNotificacoesDaPendencia(db, linha.id, o.agora);
  }
  if (r.baixar.length > 0) await recalcularEtapasPendentes(db, o.visitaId);
  return { baixadas: r.baixar.length, pendentes: r.etapasPendentes };
}

/**
 * RN-CORE-12: a pendência deixou de existir (chegou ou foi dispensada) = as notificações dela (vendedor e supervisor) são
 * removidas com `deleted_at`, para o pull levar a exclusão ao aparelho (a janela do pull esconde `expira_em`, não `deleted_at`).
 * Idempotente; roda na mesma transação da baixa.
 */
export async function baixarNotificacoesDaPendencia(db: ClienteBanco, etapaId: string, agora: Date): Promise<number> {
  const r = await db.query(
    `update core.notificacao set deleted_at = $2::timestamptz, updated_at = $2::timestamptz
      where envio_id = $1 and origem_modulo = 'core' and tipo = 'sistema' and deleted_at is null`,
    [etapaId, iso(agora)],
  );
  return r.rowCount ?? 0;
}

/** `pesquisa.resposta.registrada@1` com `visita_id`: reconsulta e baixa a pendência da visita (evento antes do checkout = nada). */
export const consumidorBaixaPorResposta: ConsumidorEvento = definirConsumidor({
  evento: eventoTolerante(DEF_RESPOSTA_REGISTRADA),
  executar: async (p, ctx: ContextoConsumo) => {
    // T-0170 (tarefas-consultor.md §4.3): um passo a mais do MESMO consumidor, antes do return de quem não tem visita
    await concluirTarefaPorResposta(p, ctx);
    if (!p.visita_id) return;
    const modulo = MODULO_DO_EVENTO_DE_BAIXA['pesquisa.resposta.registrada@1'];
    if (!modulo) return;
    const r = await reconsultarEBaixar(ctx.db, ctx.consultar, { visitaId: p.visita_id, modulo, referenciaId: p.resposta_id, agora: ctx.agora() });
    if (r.baixadas > 0) ctx.log.info({ visita_id: p.visita_id, baixadas: r.baixadas }, 'pendência de etapa baixada pela resposta');
  },
});

/** Prazo efetivo do tenant (`plataforma.parametro` core/checkout_pendencia_alerta_h); ausente ou fora de 1..168 = 24. */
export async function lerPrazoAlertaH(db: ClienteBanco): Promise<number> {
  const r = await db.query<{ valor: unknown }>(
    "select valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = $1 and deleted_at is null limit 1",
    [PARAMETRO_CHECKOUT_PENDENCIA_ALERTA_H],
  );
  return prazoAlertaPendenciaH(r.rows[0]?.valor);
}

interface PendenciaVencida extends LinhaEtapa {
  cliente_id: string;
  usuario_id: string;
  cliente_nome: string;
  checkin_em: Date;
  vendedor_nome: string;
  supervisor_id: string | null;
}

export interface ResultadoAlerta {
  baixadas: number;
  alertadas: number;
  notificacoes: number;
}

/**
 * Varredura do alerta de UM tenant (na transação do tenant; o agendador por tenant é da plataforma). Para cada pendência com
 * `pendente_desde < agora - prazo` e `alertada_em` nulo: reconsulta antes (baixa se já concluída); se segue pendente, cria
 * `core.notificacao` para o vendedor e para o supervisor da equipe (uma por pendência e destinatário) e grava `alertada_em`.
 */
export async function alertarPendenciasVencidas(
  ctx: Pick<ContextoConsumo, 'db' | 'consultar' | 'publicar' | 'fuso' | 'agora'>,
  limite = 200,
): Promise<ResultadoAlerta> {
  const db = ctx.db;
  const agora = ctx.agora();
  const prazoH = await lerPrazoAlertaH(db);
  const corte = new Date(agora.getTime() - prazoH * 3_600_000);
  const vencidas = (
    await db.query<PendenciaVencida>(
      `select e.id, e.visita_id, e.modulo, e.etapa, e.situacao, e.rotulo, e.pendente_desde, e.alertada_em,
              v.cliente_id, v.usuario_id, v.checkin_em, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente_nome,
              u.nome as vendedor_nome, q.responsavel_id as supervisor_id
         from core.visita_etapa e
         join core.visita v on v.tenant_id = e.tenant_id and v.id = e.visita_id
         join core.cliente c on c.id = v.cliente_id
         join core.usuario u on u.id = v.usuario_id
         left join core.equipe q on q.id = u.equipe_id and q.deleted_at is null
        where e.situacao = 'pendente' and e.deleted_at is null and e.pendente_desde < $1 and e.alertada_em is null
        order by e.pendente_desde, e.id limit $2`,
      [corte.toISOString(), limite],
    )
  ).rows;
  const res: ResultadoAlerta = { baixadas: 0, alertadas: 0, notificacoes: 0 };
  for (const p of vencidas) {
    const rec = await reconsultarEBaixar(db, ctx.consultar, { visitaId: p.visita_id, modulo: p.modulo, referenciaId: null, agora });
    res.baixadas += rec.baixadas;
    const atual = (await db.query<{ situacao: SituacaoVisitaEtapa; alertada_em: Date | null }>('select situacao, alertada_em from core.visita_etapa where id = $1', [p.id])).rows[0];
    if (!atual) continue;
    const vira = pendenciaViraAlerta({
      situacao: atual.situacao,
      pendenteDesde: p.pendente_desde ? iso(p.pendente_desde) : null,
      alertadaEm: atual.alertada_em ? iso(atual.alertada_em) : null,
      agora: iso(agora),
      prazoH,
    });
    if (!vira) continue;
    const base = { rotulo: p.rotulo ?? 'Etapa da visita', clienteNome: p.cliente_nome, visitaEm: iso(p.checkin_em), fusoTenant: ctx.fuso(), prazoH };
    const destinos: { uid: string; texto: { titulo: string; corpo: string } }[] = [{ uid: p.usuario_id, texto: textoAlertaPendencia({ ...base, destinatario: 'vendedor' }) }];
    if (p.supervisor_id && p.supervisor_id !== p.usuario_id) {
      destinos.push({ uid: p.supervisor_id, texto: textoAlertaPendencia({ ...base, destinatario: 'supervisor', vendedorNome: p.vendedor_nome }) });
    }
    for (const d of destinos) {
      const n = await db.query<{ id: string }>(
        `insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, link, origem_modulo, envio_id, prioridade, subtipo)
         select plataforma.tenant_atual(), u.id, 'sistema', $2, $3, $4, 'core', $5, 'normal', 'etapa_pendente_checkout' from core.usuario u where u.id = $1 and u.deleted_at is null and u.ativo
         on conflict (tenant_id, usuario_id, envio_id) where envio_id is not null do nothing
         returning id`,
        [d.uid, d.texto.titulo.slice(0, 120), d.texto.corpo.slice(0, 1000), `/m/cliente?id=${p.cliente_id}`, p.id],
      );
      if (n.rows[0]) {
        res.notificacoes++;
        await ctx.publicar(EVENTO_NOTIFICACAO_CRIADA, { notificacao_id: n.rows[0].id, usuario_id: d.uid, tipo: 'sistema', prioridade: 'normal' }, n.rows[0].id);
      }
    }
    await db.query("update core.visita_etapa set alertada_em = $2 where id = $1 and situacao = 'pendente' and alertada_em is null", [p.id, iso(agora)]);
    res.alertadas++;
  }
  return res;
}

const naoEncontrada = () => erroHttp(404, 'VISITA_NAO_ENCONTRADA', 'Visita não encontrada. Atualize a lista e tente de novo.');

export const rotasDePendenciaCheckout: readonly RotaModulo[] = [
  {
    // §2.5a: o supervisor da equipe da visita (escopo) ou o admin dispensa a etapa pendente; idempotente (já não pendente = 200 sem mudança)
    metodo: 'POST',
    caminho: 'visitas/:id/etapas/:modulo/:etapa/dispensa',
    acao: 'visita.dispensar_etapa',
    carteira: 'filtrar_no_dominio',
    status: 200,
    params: DispensarEtapaParamsSchema,
    corpo: DispensarEtapaRequestSchema,
    executar: async (ctx): Promise<DispensarEtapaResposta> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const v = (await db.query<{ usuario_id: string }>('select usuario_id from core.visita where id = $1 and deleted_at is null for update', [ctx.params.id])).rows[0];
        if (!v || (visiveis !== 'tenant' && !visiveis.has(v.usuario_id))) throw naoEncontrada();
        const e = (
          await db.query<{ id: string; situacao: SituacaoVisitaEtapa }>('select id, situacao from core.visita_etapa where visita_id = $1 and modulo = $2 and etapa = $3 and deleted_at is null for update', [
            ctx.params.id,
            ctx.params.modulo,
            ctx.params.etapa,
          ])
        ).rows[0];
        if (!e) throw erroHttp(404, 'ETAPA_NAO_ENCONTRADA', 'Etapa não encontrada nesta visita. Atualize a lista e tente de novo.');
        const base = { visita_id: ctx.params.id, modulo: ctx.params.modulo, etapa: ctx.params.etapa };
        if (e.situacao !== 'pendente') {
          const n = (await db.query<{ n: number }>('select etapas_pendentes as n from core.visita where id = $1', [ctx.params.id])).rows[0];
          return DispensarEtapaRespostaSchema.parse({ ...base, situacao: e.situacao, alterada: false, etapas_pendentes: Number(n?.n ?? 0) });
        }
        await db.query("update core.visita_etapa set situacao = 'dispensada', resolvida_em = $2 where id = $1 and situacao = 'pendente'", [e.id, ctx.agora().toISOString()]);
        await baixarNotificacoesDaPendencia(db, e.id, ctx.agora());
        const restam = await recalcularEtapasPendentes(db, ctx.params.id);
        await auditar(db, ctx, {
          acao: 'visita.dispensar_etapa',
          entidade: 'visita_etapa',
          entidadeId: e.id,
          antes: { situacao: 'pendente' },
          depois: { situacao: 'dispensada', visita_id: ctx.params.id, modulo: ctx.params.modulo, etapa: ctx.params.etapa, justificativa: ctx.corpo.justificativa },
        });
        return DispensarEtapaRespostaSchema.parse({ ...base, situacao: 'dispensada', alterada: true, etapas_pendentes: restam });
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'parametros/checkout-pendencia',
    acao: 'parametro.checkout_pendencia',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametroCheckoutPendencia> => ({ [PARAMETRO_CHECKOUT_PENDENCIA_ALERTA_H]: await lerPrazoAlertaH(db) })),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/checkout-pendencia',
    acao: 'parametro.checkout_pendencia',
    carteira: 'nao_se_aplica',
    corpo: ParametroCheckoutPendenciaSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db): Promise<ParametroCheckoutPendencia> => {
        const antes = await lerPrazoAlertaH(db);
        const novo = ctx.corpo.checkout_pendencia_alerta_h;
        if (novo !== antes) {
          await db.query(
            `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
             on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`,
            [PARAMETRO_CHECKOUT_PENDENCIA_ALERTA_H, JSON.stringify(novo)],
          );
          await auditar(db, ctx, { acao: 'parametro.checkout_pendencia', entidade: 'parametro', entidadeId: null, antes: { checkout_pendencia_alerta_h: antes }, depois: { checkout_pendencia_alerta_h: novo } });
        }
        return { checkout_pendencia_alerta_h: novo };
      }),
  },
];
