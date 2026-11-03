/**
 * Rotas do Conector para lotes, cursores e reconciliação (desenho T-0032 §4: A2, A3, A4).
 *  - A2 `POST /lotes` (RN-INT-01, 12, 13): sem `Idempotency-Key` = 400; mesma chave e mesmo conteúdo = 202 com o mesmo `lote_id`
 *    (`Idempotent-Replay: true`, sem novo evento); conteúdo diferente = 409; lote só de linhas inválidas é aceito (P-1).
 *  - A3 `GET /lotes/{id}` e `GET /cursores/{entidade}`: só do próprio Conector (404 para outro Conector ou tenant).
 *  - A4 `POST /reconciliacoes` (RN-INT-07).
 * Toda gravação usa `ctx.comTenant` (tenant DA CHAVE, RLS); evento por `tx.publicar` na mesma transação do fato.
 */
import { createHash } from 'node:crypto';
import { ErroConector, RespostaConector, type ContextoConector } from '@macuxi/platform-sdk';
import {
  CAMPO_SOMA_CONTROLE,
  Entidade,
  ParamsLote,
  QueryConsultaLote,
  ReconciliacaoEnvio,
  type AvisoLinha,
  type Cursor,
  type InativacaoLote,
  type LoteAceito,
  type LoteEnvelopeValido,
  type LoteResultado,
  type RespostaReconciliacao,
} from '../contracts';
import {
  conteudoCanonicoLote,
  decidirIdempotenciaLote,
  erroEntidadeDeOutroConector,
  reconciliar,
  validarChaveIdempotencia,
  validarEnvelope,
} from '../domain';
import type { ConectorHub } from './autenticacao';
import { EVENTO_LOTE_RECEBIDO, EVENTO_RECONCILIACAO_DIVERGENTE } from './eventos';
import { lerParametrosHub } from './parametros';

type Ctx<C = unknown, Q = unknown, P = unknown> = ContextoConector<ConectorHub, C, Q, P>;

const iso = (v: Date | string | null | undefined): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

// ---------------------------------------------------------------------------------------------------------------- A2

interface LoteExistente {
  lote_id: string;
  hash_conteudo: string;
  status: 'recebido' | 'processando' | 'concluido' | 'concluido_com_erros' | 'falhou';
  entidade: string;
  modo: 'completo' | 'delta';
  recebidas: number;
}

const aceito = (l: { lote_id: string; entidade: string; modo: string; recebidas: number }, repetido: boolean): LoteAceito =>
  ({
    lote_id: l.lote_id,
    status: 'recebido',
    entidade: l.entidade,
    modo: l.modo,
    recebidos: l.recebidas,
    ...(repetido ? { repetido: true } : {}),
    consulta: `/integracao/v1/lotes/${l.lote_id}`,
  }) as LoteAceito;

type DbTenant = Parameters<Parameters<Ctx['comTenant']>[0]>[0];
type TxTenant = Parameters<Parameters<Ctx['comTenant']>[0]>[1];

/** Tudo de que o registro de um lote precisa, venha ele do Conector (`POST /lotes`) ou de um arquivo do BKO (RF-INT-03). */
export interface EntradaGravarLote {
  tenantId: string;
  /** Conector dono do lote: `id` (uuid) e `identificador` (slug, vai no evento). */
  conector: { id: string; identificador: string };
  env: LoteEnvelopeValido;
  /** Idempotency-Key já validada (RN-INT-12). */
  chave: string;
  hashConteudo: string;
  recebidas: number;
  versaoConector: string | null;
  bytes: number;
  agora: Date;
  /** Conteúdo extra do staging (ex.: `origem` e `linhas_arquivo` da carga por arquivo), ao lado de registros e linhas inválidas. */
  stagingExtra?: Record<string, unknown>;
  log: { info(obj: Record<string, unknown>, msg: string): void };
}

export type ResultadoGravarLote =
  | { tipo: 'aceito'; repetido: boolean; lote: { lote_id: string; entidade: string; modo: string; recebidas: number } }
  | { tipo: 'conflito'; codigo: string; mensagem: string };

/**
 * O MESMO caminho de gravação para o Conector e para o arquivo (RN-INT-12, RN-INT-06): idempotência por (tenant, Conector, chave) —
 * mesma chave e conteúdo repete o lote, conteúdo diferente é conflito —, sessão de carga completa, lote, staging e o evento
 * `integracao.lote.recebido@1` na mesma transação. A validação do envelope e da topologia é de quem chama.
 */
export async function gravarLote(db: DbTenant, tx: TxTenant, e: EntradaGravarLote): Promise<ResultadoGravarLote> {
  const { env } = e;
  const lerPorChave = async (): Promise<LoteExistente | null> => {
    const { rows } = await db.query<LoteExistente>(
      `select id as lote_id, hash_conteudo, status, entidade, modo, recebidas
         from integracao.lote where tenant_id = $1 and conector_id = $2 and chave_idempotencia = $3`,
      [e.tenantId, e.conector.id, e.chave],
    );
    return rows[0] ?? null;
  };
  const decidir = (existente: LoteExistente | null) =>
    decidirIdempotenciaLote({ chave: e.chave, hashConteudo: e.hashConteudo, existente: existente && { lote_id: existente.lote_id, hash_conteudo: existente.hash_conteudo, status: existente.status } });
  const responder = (d: ReturnType<typeof decidir>, existente: LoteExistente | null): ResultadoGravarLote | null => {
    if (d.acao === 'conflito') return { tipo: 'conflito', codigo: d.codigo, mensagem: d.mensagem };
    if (d.acao === 'repetir' && existente) return { tipo: 'aceito', repetido: true, lote: existente };
    return null;
  };

  const existente = await lerPorChave();
  const resposta = responder(decidir(existente), existente);
  if (resposta) return resposta;

  // sessão de carga completa (RN-INT-06): uma linha por (Conector, sessao_uuid)
  let sessaoId: string | null = null;
  if (env.modo === 'completo' && env.sessao) {
    const { rows } = await db.query<{ id: string }>(
      `insert into integracao.sessao_carga (tenant_id, sessao_uuid, conector_id, entidade, ultima_parte)
       values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, conector_id, sessao_uuid) do update
         set ultima_parte = coalesce(excluded.ultima_parte, integracao.sessao_carga.ultima_parte)
       returning id`,
      [e.tenantId, env.sessao.id, e.conector.id, env.entidade, env.sessao.ultimo ? env.sessao.parte : null],
    );
    sessaoId = rows[0]?.id ?? null;
  }

  const { rows: novo } = await db.query<{ id: string }>(
    `insert into integracao.lote
       (tenant_id, conector_id, entidade, modo, versao_contrato, sessao_id, sessao_parte, sessao_ultimo, chave_idempotencia, hash_conteudo,
        recebidas, invalidas_omitidas, cursor_declarado, versao_conector, bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)
     on conflict (tenant_id, conector_id, chave_idempotencia) do nothing
     returning id`,
    [
      e.tenantId,
      e.conector.id,
      env.entidade,
      env.modo,
      env.versao_contrato.slice(0, 10),
      sessaoId,
      sessaoId ? (env.sessao?.parte ?? null) : null,
      sessaoId ? (env.sessao?.ultimo ?? null) : null,
      e.chave,
      e.hashConteudo,
      e.recebidas,
      env.linhas_invalidas_omitidas ?? 0,
      env.cursor ? JSON.stringify(env.cursor) : null,
      e.versaoConector,
      e.bytes,
    ],
  );
  const loteId = novo[0]?.id;
  if (!loteId) {
    // corrida na unique (mesma chave, dois POST ao mesmo tempo): quem perdeu relê e responde como repetição (ou conflito)
    const outra = await lerPorChave();
    const r = responder(decidir(outra), outra);
    if (r) return r;
    throw new Error('lote não gravado e sem lote para a chave de idempotência');
  }

  await db.query(`insert into integracao.lote_staging (tenant_id, lote_id, corpo) values ($1, $2, $3::jsonb)`, [
    e.tenantId,
    loteId,
    JSON.stringify({ registros: env.registros, linhas_invalidas: env.linhas_invalidas ?? [], linhas_invalidas_omitidas: env.linhas_invalidas_omitidas ?? 0, ...(e.stagingExtra ?? {}) }),
  ]);
  await tx.publicar(
    EVENTO_LOTE_RECEBIDO,
    { lote_id: loteId, conector_id: e.conector.identificador, entidade: env.entidade, modo: env.modo, recebidas: e.recebidas, recebido_em: e.agora.toISOString() },
    loteId,
  );
  e.log.info({ lote_id: loteId, entidade: env.entidade, modo: env.modo, recebidas: e.recebidas }, 'lote recebido');
  return { tipo: 'aceito', repetido: false, lote: { lote_id: loteId, entidade: env.entidade, modo: env.modo, recebidas: e.recebidas } };
}

export async function enviarLote(ctx: Ctx): Promise<RespostaConector> {
  // 1) Idempotency-Key obrigatória (RN-INT-12)
  const chave = validarChaveIdempotencia(ctx.cabecalhos['idempotency-key']);
  if (!chave.ok) {
    throw new ErroConector(400, { codigo: chave.codigo, mensagem: chave.mensagem, erros: [{ codigo: chave.codigo, campo: 'Idempotency-Key', mensagem: chave.mensagem }] });
  }

  // 2) envelope (RN-INT-01) e entidade do Conector (P-6, RN-INT-13)
  const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
  const validado = validarEnvelope(ctx.corpo, {
    limiteRegistros: parametros.limiteRegistrosLote,
    versoesSuportadas: parametros.versoesSuportadas,
    entidadesDoConector: ctx.conector.entidades,
  });
  if (!validado.ok) {
    const primeiro = validado.erros[0] as (typeof validado.erros)[number];
    const status = validado.erros.some((e) => e.codigo === 'envelope_invalido') ? 400 : 422;
    throw new ErroConector(status, { codigo: primeiro.codigo, mensagem: primeiro.mensagem, erros: validado.erros });
  }
  const env: LoteEnvelopeValido = validado.envelope;
  const hashConteudo = createHash('sha256').update(conteudoCanonicoLote(ctx.corpo), 'utf8').digest('hex');
  const recebidas = env.registros.length + (env.linhas_invalidas?.length ?? 0) + (env.linhas_invalidas_omitidas ?? 0);
  const versaoConector = (env.versao_conector ?? ctx.cabecalhos['x-macuxi-conector-versao'] ?? null)?.slice(0, 40) ?? null;

  return ctx.comTenant(async (db, tx) => {
    const r = await gravarLote(db, tx, {
      tenantId: ctx.tenantId,
      conector: { id: ctx.conector.id, identificador: ctx.conector.identificador },
      env,
      chave: chave.chave,
      hashConteudo,
      recebidas,
      versaoConector,
      bytes: ctx.bytesCorpo,
      agora: ctx.agora(),
      log: ctx.log,
    });
    if (r.tipo === 'conflito') {
      throw new ErroConector(409, { codigo: r.codigo, mensagem: r.mensagem, erros: [{ codigo: r.codigo, campo: 'Idempotency-Key', mensagem: r.mensagem }] });
    }
    if (r.repetido) return new RespostaConector(aceito(r.lote, true), { status: 202, cabecalhos: { 'idempotent-replay': 'true' } });
    return new RespostaConector(aceito(r.lote, false), { status: 202 });
  });
}

// ---------------------------------------------------------------------------------------------------------------- A3

interface LinhaLote {
  id: string;
  entidade: string;
  modo: 'completo' | 'delta';
  status: LoteResultado['status'];
  recebidas: number;
  duplicadas_no_lote: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  obsoletas: number;
  inativadas: number;
  invalidas_omitidas: number;
  cursor_resultante: Cursor | null;
  avisos: AvisoLinha[] | null;
  recebido_em: Date;
  concluido_em: Date | null;
  sessao_id: string | null;
  sessao_ultimo: boolean | null;
}

/**
 * Resultado de um lote com os erros por linha. `conectorId` limita ao lote do próprio Conector (Hub: 404 para outro Conector);
 * sem ele vale o tenant inteiro (BKO). Em lote de arquivo, mensagens e avisos já levam "Linha N do arquivo:".
 */
export async function lerResultadoLote(db: DbTenant, tenantId: string, loteId: string, opcoes: { conectorId?: string; limiteErros: number }): Promise<LoteResultado | null> {
  const { rows } = await db.query<LinhaLote>(
    `select id, entidade, modo, status, recebidas, duplicadas_no_lote, com_erro, novas, atualizadas, inalteradas, obsoletas, inativadas,
            invalidas_omitidas, cursor_resultante, avisos, recebido_em, concluido_em, sessao_id, sessao_ultimo
       from integracao.lote where tenant_id = $1 and id = $2 and ($3::uuid is null or conector_id = $3::uuid)`,
    [tenantId, loteId, opcoes.conectorId ?? null],
  );
  const l = rows[0];
  if (!l) return null;

  // falha_processamento primeiro (o Conector reenvia essas), depois pela posição da linha
  const { rows: erros } = await db.query<{ indice: number; external_id: string | null; codigo: string; campo: string | null; mensagem: string; reprocessavel: boolean; origem: 'hub' | 'conector' }>(
    `select indice, external_id, codigo, campo, mensagem, reprocessavel, origem
       from integracao.lote_linha_erro where tenant_id = $1 and lote_id = $2
      order by (codigo <> 'falha_processamento'), indice, origem limit $3`,
    [tenantId, l.id, opcoes.limiteErros],
  );
  const { rows: total } = await db.query<{ n: string }>('select count(*)::text as n from integracao.lote_linha_erro where tenant_id = $1 and lote_id = $2', [tenantId, l.id]);
  const errosTotal = Number(total[0]?.n ?? 0);

  let inativacao: InativacaoLote | undefined;
  if (l.modo === 'completo' && l.sessao_ultimo && l.sessao_id && (l.status === 'concluido' || l.status === 'concluido_com_erros')) {
    inativacao = await inativacaoDoLote(db, tenantId, l);
  }

  return {
    lote_id: l.id,
    entidade: l.entidade,
    modo: l.modo,
    status: l.status,
    contagens: { recebidas: l.recebidas, duplicadas_no_lote: l.duplicadas_no_lote, com_erro: l.com_erro, novas: l.novas, atualizadas: l.atualizadas, inalteradas: l.inalteradas, obsoletas: l.obsoletas },
    erros,
    avisos: l.avisos ?? [],
    cursor: l.cursor_resultante ?? null,
    invalidas_omitidas: l.invalidas_omitidas,
    erros_total: errosTotal,
    erros_omitidos: Math.max(0, errosTotal - erros.length),
    ...(inativacao ? { inativacao } : {}),
    inativadas: l.inativadas,
    recebido_em: iso(l.recebido_em) as string,
    concluido_em: iso(l.concluido_em),
  } as LoteResultado;
}

export async function consultarLote(ctx: Ctx<unknown, ReturnType<typeof QueryConsultaLote.parse>, ReturnType<typeof ParamsLote.parse>>): Promise<LoteResultado> {
  return ctx.comTenant(async (db) => {
    const r = await lerResultadoLote(db, ctx.tenantId, ctx.params.id, { conectorId: ctx.conector.id, limiteErros: ctx.query.limite_erros });
    if (!r) throw new ErroConector(404, { codigo: 'lote_nao_encontrado', mensagem: 'Lote não encontrado para este Conector. Se o envio foi interrompido, reenvie o lote com a mesma Idempotency-Key.' });
    return r;
  });
}

/** Situação da inativação no resultado do último lote da sessão (o que o Conector lê; RN-INT-06). */
async function inativacaoDoLote(db: DbTenant, tenantId: string, l: LinhaLote): Promise<InativacaoLote> {
  const { rows } = await db.query<{ estado: string; candidatos: number; percentual: string }>(
    'select estado, candidatos, percentual from integracao.pendencia_inativacao where tenant_id = $1 and sessao_id = $2',
    [tenantId, l.sessao_id],
  );
  const p = rows[0];
  if (p?.estado === 'aguardando') return { situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: p.candidatos, percentual: Number(p.percentual) };
  if (p?.estado === 'confirmada') return { situacao: 'aplicada', motivo: null, candidatos: p.candidatos, percentual: Number(p.percentual) };
  const { rows: s } = await db.query<{ inativadas: number; situacao: string }>('select inativadas, situacao from integracao.sessao_carga where tenant_id = $1 and id = $2', [tenantId, l.sessao_id]);
  if (s[0]?.situacao === 'completa' && s[0].inativadas > 0) return { situacao: 'aplicada', motivo: null, candidatos: s[0].inativadas, percentual: 0 };
  return { situacao: 'nao_aplicavel', motivo: p?.estado ?? null, candidatos: 0, percentual: 0 };
}

export async function consultarCursor(ctx: Ctx<unknown, unknown, { entidade?: string }>): Promise<unknown> {
  const entidade = Entidade.safeParse(ctx.params.entidade);
  if (!entidade.success) {
    throw new ErroConector(404, { codigo: 'entidade_desconhecida', mensagem: `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.` });
  }
  return ctx.comTenant(async (db) => {
    const { rows } = await db.query<{ cursor_alterado_em: Date | null; cursor_external_id: string | null; atualizado_em: Date }>(
      `select cursor_alterado_em, cursor_external_id, atualizado_em from integracao.cursor_entidade
        where tenant_id = $1 and conector_id = $2 and entidade = $3 and deleted_at is null`,
      [ctx.tenantId, ctx.conector.id, entidade.data],
    );
    const c = rows[0];
    return {
      entidade: entidade.data,
      cursor: c && c.cursor_alterado_em && c.cursor_external_id ? { alterado_em: iso(c.cursor_alterado_em) as string, external_id: c.cursor_external_id } : null,
      atualizado_em: iso(c?.atualizado_em),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------- A4

export async function enviarReconciliacao(ctx: Ctx<ReturnType<typeof ReconciliacaoEnvio.parse>>): Promise<RespostaReconciliacao> {
  const corpo = ctx.corpo;
  const outro = erroEntidadeDeOutroConector(corpo.entidade, ctx.conector.entidades);
  if (outro) throw new ErroConector(422, { codigo: outro.codigo, mensagem: outro.mensagem, erros: [outro] });
  const parametros = lerParametrosHub(ctx.parametros(), ctx.log);
  const temSoma = CAMPO_SOMA_CONTROLE[corpo.entidade] !== null;

  return ctx.comTenant(async (db, tx) => {
    const { rows: m } = await db.query<{ contagem: string; soma: string | null }>(
      `select count(*)::text as contagem, sum(valor_controle)::text as soma from integracao.registro_atual
        where tenant_id = $1 and entidade = $2 and conector_id = $3 and ativo and deleted_at is null`,
      [ctx.tenantId, corpo.entidade, ctx.conector.id],
    );
    const { rows: aberto } = await db.query<{ n: string }>(
      `select count(*)::text as n from integracao.lote where tenant_id = $1 and conector_id = $2 and entidade = $3 and status in ('recebido', 'processando')`,
      [ctx.tenantId, ctx.conector.id, corpo.entidade],
    );
    const macuxi = { contagem: Number(m[0]?.contagem ?? 0), soma: temSoma ? Number(m[0]?.soma ?? 0) : null };
    const r = reconciliar(
      { entidade: corpo.entidade, erp: { contagem: corpo.contagem, soma: temSoma ? corpo.soma : null }, macuxi },
      { toleranciaContagem: parametros.toleranciaContagem, toleranciaSomaPct: parametros.toleranciaSomaPct },
    );
    // com lote em aberto o resultado é provisório: a comparação definitiva sai quando eles terminarem
    const situacao: 'comparada' | 'pendente' = Number(aberto[0]?.n ?? 0) > 0 ? 'pendente' : 'comparada';
    const { rows: gravada } = await db.query<{ evento_publicado: boolean }>(
      `insert into integracao.reconciliacao
         (tenant_id, conector_id, entidade, data_referencia, contagem_erp, soma_erp, contagem_macuxi, soma_macuxi, diferenca_contagem,
          diferenca_soma, diferenca_pct, divergente, motivos, situacao, calculada_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::text[], $14, $15)
       on conflict (tenant_id, conector_id, entidade, data_referencia) do update set
         contagem_erp = excluded.contagem_erp, soma_erp = excluded.soma_erp, contagem_macuxi = excluded.contagem_macuxi,
         soma_macuxi = excluded.soma_macuxi, diferenca_contagem = excluded.diferenca_contagem, diferenca_soma = excluded.diferenca_soma,
         diferenca_pct = excluded.diferenca_pct, divergente = excluded.divergente, motivos = excluded.motivos,
         situacao = excluded.situacao, calculada_em = excluded.calculada_em
       returning evento_publicado`,
      [
        ctx.tenantId,
        ctx.conector.id,
        corpo.entidade,
        corpo.data_referencia,
        corpo.contagem,
        temSoma && corpo.soma !== null ? Math.round(corpo.soma) : null,
        macuxi.contagem,
        macuxi.soma,
        r.contagem.diferenca,
        r.soma ? Math.round(r.soma.diferenca) : null,
        r.soma?.diferenca_pct ?? null,
        r.divergente,
        r.motivos,
        situacao,
        ctx.agora().toISOString(),
      ],
    );
    // divergência definitiva publica o evento uma vez só por (Conector, entidade, dia)
    if (r.divergente && situacao === 'comparada' && !gravada[0]?.evento_publicado) {
      await tx.publicar(
        EVENTO_RECONCILIACAO_DIVERGENTE,
        { entidade: corpo.entidade, data_referencia: corpo.data_referencia, contagem_erp: corpo.contagem, contagem_macuxi: macuxi.contagem, soma_erp: temSoma ? corpo.soma : null, soma_macuxi: macuxi.soma, motivos: r.motivos },
        null,
      );
      await db.query(
        'update integracao.reconciliacao set evento_publicado = true where tenant_id = $1 and conector_id = $2 and entidade = $3 and data_referencia = $4',
        [ctx.tenantId, ctx.conector.id, corpo.entidade, corpo.data_referencia],
      );
    }
    return {
      situacao,
      entidade: corpo.entidade,
      data_referencia: corpo.data_referencia,
      divergente: r.divergente,
      motivos: r.motivos,
      contagem: r.contagem,
      soma: r.soma,
    };
  });
}
