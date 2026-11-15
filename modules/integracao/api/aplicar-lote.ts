/**
 * A7 — consumidor de `integracao.lote.recebido@1` (ADR 0007: a outbox é a fila): aplica o lote do staging em `registro_atual`.
 * Tudo numa transação (a do despachante, `ctx.db`): falhou = desfaz o lote inteiro e a outbox repete com espera crescente; a
 * reentrega de um lote já aplicado é um no-op (status diferente de `recebido`). Regras no `domain`; aqui só SQL e eventos.
 *
 *   lote travado → ordem (RN-INT-04: espera dependência/predecessor lançando erro, a outbox repete) → linhas inválidas do Conector
 *   (RN-INT-03) → validação por linha + duplicadas (RN-INT-02) → referências (RN-INT-04) → hash/obsoleta (RN-INT-02/06) → upsert
 *   monotônico + `integracao.<entidade>.atualizado@1` por registro que mudou → resultado, cursor (RN-INT-05) → sessão completa:
 *   inativação ou pendência (RN-INT-06) → `integracao.lote.concluido@1`.
 *
 * Diferenças do desenho (hub-api.md §7.10), assumidas na v1: sem checkpoint por bloco (a transação é uma só, o lote é atômico);
 * esgotadas as tentativas da outbox o lote fica `recebido` com o evento parado (alerta de operação, não `falhou`); parâmetros do
 * tenant não chegam ao consumidor, valem os padrões.
 */
import { CONSULTA_CADASTRO_CLIENTE, CONSULTA_FILIAIS, CONSULTA_MEDIDAS } from '@macuxi/core/contracts';
import { definirConsumidor, ehConsultaIndisponivel, type ClienteBanco, type ContextoConsumo } from '@macuxi/platform-sdk';
import { CAMPO_SOMA_CONTROLE, type AvisoLinha, type Cursor, type Entidade, type EstadoLote, type LinhaErro, type LinhaInvalidaConector, type LoteRecebidoEvento } from '../contracts';
import {
  avancarCursor,
  calcularInativacao,
  calcularResultadoLote,
  classificarMudancas,
  criarPendencia,
  cursorDoLote,
  filtrarAtivosElegiveis,
  idsDaSessaoNoLote,
  novaSessao,
  ordenarFilaAplicacao,
  anotarLinhaDoArquivo,
  avisosCadastroIncompleto,
  avisosReferenciaFraca,
  contarDuplicadasNoLote,
  siglasParaConferir,
  verificarMedidas,
  dadosParaConsultaCadastro,
  PARAMETROS_PADRAO,
  referenciasDoRegistro,
  referenciasFracasDoRegistro,
  registrarParte,
  situacaoSessao,
  tratarLinhasInvalidasConector,
  traduzirCanalDoCliente,
  validarLinhas,
  verificarReferencias,
  type LinhaValida,
  type MapeamentoGravado,
  type LoteNaFila,
  type SessaoCargaEstado,
} from '../domain';
import { inativarElegiveis } from './bko-inativacao';
import { EVENTO_LOTE_CONCLUIDO, EVENTO_LOTE_RECEBIDO, eventoAtualizado } from './eventos';
import { lerParametrosHub } from './parametros';

const BLOCO = 500;
const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());
const blocos = <T>(xs: readonly T[], n = BLOCO): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

interface LinhaLote {
  id: string;
  conector_id: string;
  entidade: Entidade;
  modo: 'completo' | 'delta';
  status: EstadoLote;
  sessao_id: string | null;
  recebidas: number;
}

interface CorpoStaging {
  registros?: unknown[];
  /** Carga por arquivo (RF-INT-03): linha física do arquivo de cada item de `registros`; os erros e avisos ganham "Linha N do arquivo:". */
  linhas_arquivo?: number[];
  linhas_invalidas?: LinhaInvalidaConector[];
  linhas_invalidas_omitidas?: number;
}

/** Valor de controle (soma da reconciliação, RN-INT-07) que o registro carrega; `null` quando a entidade só tem contagem. */
function valorControle(entidade: Entidade, registro: unknown): number | null {
  const campo = CAMPO_SOMA_CONTROLE[entidade];
  if (campo === null) return null;
  const v = (registro as Record<string, unknown>)[campo];
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

export async function aplicarLote(payload: LoteRecebidoEvento, ctx: ContextoConsumo): Promise<void> {
  const db = ctx.db;
  const agora = ctx.agora().toISOString();

  const { rows: lotes } = await db.query<LinhaLote>(
    `select id, conector_id, entidade, modo, status, sessao_id, recebidas
       from integracao.lote where id = $1 and deleted_at is null for update`,
    [payload.lote_id],
  );
  const lote = lotes[0];
  // outro tenant (RLS) ou lote inexistente: nada a fazer; já aplicado (reentrega): idempotente
  if (!lote || lote.status !== 'recebido') return;
  const tenantId = ctx.envelope.tenant_id;

  // ---- ordem de dependência (RN-INT-04)
  const { rows: fila } = await db.query<{ lote_id: string; conector_id: string; entidade: Entidade; status: EstadoLote; recebido_em: Date; parte: number | null }>(
    `select id as lote_id, conector_id, entidade, status, recebido_em, sessao_parte as parte
       from integracao.lote where tenant_id = $1 and status in ('recebido', 'processando') and deleted_at is null`,
    [tenantId],
  );
  const naFila: LoteNaFila[] = fila.map((l) => ({ ...l, recebido_em: iso(l.recebido_em) }));
  const ordem = ordenarFilaAplicacao(naFila, agora, { esperaMaxDependenciaMin: PARAMETROS_PADRAO.esperaMaxDependenciaMin });
  if (!ordem.prontos.some((p) => p.lote_id === lote.id)) {
    const espera = ordem.aguardando.find((a) => a.lote.lote_id === lote.id);
    // a outbox repete com espera crescente (5 s, 10 s…); depois de esperaMaxDependenciaMin a dependência não segura mais
    throw new Error(
      espera?.motivo === 'dependencia'
        ? `Lote aguardando a carga de ${espera.esperaPor.join(', ')} (RN-INT-04); a aplicação será tentada de novo.`
        : 'Lote aguardando o lote anterior da mesma entidade; a aplicação será tentada de novo.',
    );
  }

  const { rows: st } = await db.query<{ corpo: CorpoStaging | null }>('select corpo from integracao.lote_staging where tenant_id = $1 and lote_id = $2', [tenantId, lote.id]);
  const corpo = st[0]?.corpo ?? null;
  if (!corpo) {
    await db.query(
      `update integracao.lote set status = 'falhou', iniciado_em = coalesce(iniciado_em, now()), concluido_em = now(), tentativas = tentativas + 1,
              ultimo_erro = 'Conteúdo do lote indisponível no staging. Reenvie o lote pelo Conector.' where tenant_id = $1 and id = $2`,
      [tenantId, lote.id],
    );
    await ctx.publicar(EVENTO_LOTE_CONCLUIDO, { lote_id: lote.id, entidade: lote.entidade, modo: lote.modo, status: 'falhou', recebidas: lote.recebidas, com_erro: lote.recebidas, concluido_em: agora }, lote.id);
    return;
  }

  // ---- linhas inválidas do Conector (RN-INT-03) e validação das do Hub (RN-INT-02)
  const trat = tratarLinhasInvalidasConector(
    { linhas_invalidas: corpo.linhas_invalidas ?? [], linhas_invalidas_omitidas: corpo.linhas_invalidas_omitidas ?? 0 },
    { limite: PARAMETROS_PADRAO.limiteLinhasInvalidas },
  );
  const registros = corpo.registros ?? [];
  const v = validarLinhas(lote.entidade, registros);

  // ---- referências (RN-INT-04): só quem cita registro existente é aceito
  const existentesRef: Partial<Record<Entidade, Set<string>>> = {};
  const alvos = new Map<Entidade, Set<string>>();
  for (const l of v.validas) {
    for (const r of referenciasDoRegistro(lote.entidade, l.registro)) {
      if (!alvos.has(r.entidade)) alvos.set(r.entidade, new Set());
      alvos.get(r.entidade)?.add(r.external_id);
    }
  }
  for (const [entidade, ids] of alvos) {
    const achados = new Set<string>();
    for (const bloco of blocos([...ids])) {
      const { rows } = await db.query<{ external_id: string }>(
        'select external_id from integracao.registro_atual where tenant_id = $1 and entidade = $2 and external_id = any($3::text[]) and deleted_at is null',
        [tenantId, entidade, bloco],
      );
      for (const r of rows) achados.add(r.external_id);
    }
    // RN-CORE-39 + RN-INT-04: filial existe se está no Hub (registro_atual) OU no Core (core.filiais@1); a recusa do core fica como revalidação
    if (entidade === 'filial') for (const id of await filiaisDoCore(ctx, [...ids])) achados.add(id);
    existentesRef[entidade] = achados;
  }
  const ref = verificarReferencias(lote.entidade, v.validas, existentesRef);
  // medida (RN-CORE-19): sigla não cadastrada/inativa = referencia_ausente; sem como conferir (consulta indisponível), não recusa
  const situacaoMedidas = await situacaoDasMedidas(ctx, siglasParaConferir(lote.entidade, ref.aceitas));
  const med = verificarMedidas(lote.entidade, ref.aceitas as LinhaValida[], situacaoMedidas && situacaoMedidas.ativas, situacaoMedidas?.inativas);
  const aceitasValidas = med.aceitas;
  // referência fraca (produto -> nó do catálogo): aviso, a linha entra normalmente
  const fracas = new Set<string>();
  for (const l of aceitasValidas) for (const r of referenciasFracasDoRegistro(lote.entidade, l.registro)) fracas.add(r.external_id);
  const achadasFracas = new Set<string>();
  for (const bloco of blocos([...fracas])) {
    const { rows } = await db.query<{ external_id: string }>(
      "select external_id from integracao.registro_atual where tenant_id = $1 and entidade = 'catalogo_no' and external_id = any($2::text[]) and deleted_at is null",
      [tenantId, bloco],
    );
    for (const r of rows) achadasFracas.add(r.external_id);
  }
  const avisosFracos = avisosReferenciaFraca(lote.entidade, aceitasValidas, { catalogo_no: achadasFracas });

  // ---- hash e obsolescência (RN-INT-02, RN-INT-06)
  const existentes = new Map<string, { hash: string; alterado_em: string }>();
  for (const bloco of blocos(aceitasValidas.map((l) => l.external_id))) {
    const { rows } = await db.query<{ external_id: string; hash: string; alterado_em: Date }>(
      'select external_id, hash, alterado_em from integracao.registro_atual where tenant_id = $1 and entidade = $2 and external_id = any($3::text[]) and deleted_at is null and hash is not null',
      [tenantId, lote.entidade, bloco],
    );
    for (const r of rows) existentes.set(r.external_id, { hash: r.hash, alterado_em: iso(r.alterado_em) });
  }
  const cls = classificarMudancas(aceitasValidas, existentes);
  const mudaram = [...cls.novas, ...cls.atualizadas];
  // RN-INT-14: cliente sem campo obrigatório é aplicado normalmente e ganha o aviso `cadastro_incompleto` (decisão do Core)
  const avisos: AvisoLinha[] = anotarLinhaDoArquivo([...v.avisos, ...avisosFracos, ...(lote.entidade === 'cliente' ? await avisarCadastroIncompleto(ctx, aceitasValidas) : [])], corpo.linhas_arquivo);

  // ---- gravação: upsert monotônico (a guarda repete a regra no banco) e visto_em/sessao_id de todo registro aceito
  for (const bloco of blocos(mudaram)) {
    await db.query(
      `insert into integracao.registro_atual
         (tenant_id, entidade, conector_id, hash, payload, valor_controle, alterado_em, ativo, lote_id, sessao_id, external_id, visto_em, aplicado_em)
       select $1, $2, $3, x.hash, x.payload::jsonb, x.valor, x.alterado_em, x.ativo, $4, $5, x.external_id, now(), now()
         from unnest($6::text[], $7::text[], $8::text[], $9::bigint[], $10::timestamptz[], $11::boolean[]) as x(external_id, hash, payload, valor, alterado_em, ativo)
       on conflict (tenant_id, entidade, external_id) do update set
         conector_id = excluded.conector_id, hash = excluded.hash, payload = excluded.payload, valor_controle = excluded.valor_controle,
         alterado_em = excluded.alterado_em, ativo = excluded.ativo, lote_id = excluded.lote_id, sessao_id = excluded.sessao_id,
         visto_em = now(), aplicado_em = now(), deleted_at = null
       where integracao.registro_atual.deleted_at is not null or excluded.alterado_em >= integracao.registro_atual.alterado_em`,
      [
        tenantId,
        lote.entidade,
        lote.conector_id,
        lote.id,
        lote.sessao_id,
        bloco.map((l) => l.external_id),
        bloco.map((l) => l.hash),
        bloco.map((l) => JSON.stringify(l.registro)),
        bloco.map((l) => valorControle(lote.entidade, l.registro)),
        bloco.map((l) => l.alterado_em),
        bloco.map((l) => (l.registro as { ativo?: boolean }).ativo !== false),
      ],
    );
  }
  for (const bloco of blocos(aceitasValidas.map((l) => l.external_id))) {
    await db.query(
      `update integracao.registro_atual set visto_em = now(), sessao_id = coalesce($4, sessao_id)
        where tenant_id = $1 and entidade = $2 and external_id = any($3::text[])`,
      [tenantId, lote.entidade, bloco, lote.sessao_id],
    );
  }
  const evento = eventoAtualizado(lote.entidade);
  // T-0115 (RN-INT-08): o canal do cliente sai traduzido pelo de-para do tenant; o registro_atual guarda o valor do ERP (hash estável)
  const deParaCanal: MapeamentoGravado[] =
    lote.entidade === 'cliente' && cls.novas.length + cls.atualizadas.length > 0
      ? (
          await db.query<MapeamentoGravado>(
            "select id, tipo, codigo_erp, codigo_macuxi, ativo from integracao.mapeamento where tenant_id = $1 and tipo = 'canal' and ativo and deleted_at is null",
            [tenantId],
          )
        ).rows
      : [];
  for (const [lista, criada] of [
    [cls.novas, true],
    [cls.atualizadas, false],
  ] as const) {
    for (const l of lista) {
      const ativo = (l.registro as { ativo?: boolean }).ativo !== false;
      await ctx.publicar(
        evento,
        {
          lote_id: lote.id,
          entidade: lote.entidade,
          external_id: l.external_id,
          acao: ativo ? (criada ? 'criado' : 'atualizado') : 'inativado',
          hash: l.hash,
          ...(ativo ? { registro: lote.entidade === 'cliente' ? traduzirCanalDoCliente(l.registro as object, deParaCanal) : l.registro } : {}),
          ocorrido_em: agora,
        },
        null,
      );
    }
  }

  // ---- erros por linha: um por (origem, índice) — a unique do banco; o primeiro campo com problema basta
  const errosHub: LinhaErro[] = [];
  const vistos = new Set<number>();
  for (const e of [...v.erros, ...ref.erros, ...med.erros]) {
    if (vistos.has(e.indice)) continue;
    vistos.add(e.indice);
    errosHub.push({ ...e, origem: 'hub' });
  }
  const registroPorIndice = new Map(v.validas.map((l) => [l.indice, l.registro]));
  // as linhas inválidas do Conector/arquivo (`trat.erros`) já nascem com a mensagem pronta; só as do Hub (índice do lote) ganham a linha do arquivo
  for (const bloco of blocos([...anotarLinhaDoArquivo(errosHub, corpo.linhas_arquivo), ...trat.erros])) {
    await db.query(
      `insert into integracao.lote_linha_erro (tenant_id, lote_id, indice, origem, codigo, campo, mensagem, reprocessavel, payload, external_id)
       select $1, $2, x.indice, x.origem, x.codigo, x.campo, x.mensagem, x.reprocessavel, x.payload::jsonb, x.external_id
         from unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::boolean[], $9::text[], $10::text[]) as x(indice, origem, codigo, campo, mensagem, reprocessavel, payload, external_id)
       on conflict (tenant_id, lote_id, origem, indice) do nothing`,
      [
        tenantId,
        lote.id,
        bloco.map((e) => e.indice),
        bloco.map((e) => e.origem ?? 'hub'),
        bloco.map((e) => e.codigo),
        bloco.map((e) => (e.campo ? e.campo.slice(0, 100) : null)),
        bloco.map((e) => e.mensagem.slice(0, 1000)),
        bloco.map((e) => e.reprocessavel),
        // o conteúdo da linha só é guardado para reprocessar (referência ausente / falha); nunca para erro de validação
        bloco.map((e) => (e.origem !== 'conector' && e.reprocessavel ? JSON.stringify(registroPorIndice.get(e.indice) ?? null) : null)),
        bloco.map((e) => e.external_id),
      ],
    );
  }

  // ---- resultado do lote e cursor (RN-INT-03, RN-INT-05)
  const resultado = calcularResultadoLote({
    recebidas: registros.length,
    duplicadas_no_lote: contarDuplicadasNoLote(v.avisos),
    erros: errosHub,
    novas: cls.novas.length,
    atualizadas: cls.atualizadas.length,
    inalteradas: cls.inalteradas.length,
    obsoletas: cls.obsoletas.length,
    invalidas_conector: trat.totalComErro,
  });
  const { rows: cur } = await db.query<{ cursor_alterado_em: Date | null; cursor_external_id: string | null }>(
    'select cursor_alterado_em, cursor_external_id from integracao.cursor_entidade where tenant_id = $1 and conector_id = $2 and entidade = $3 and deleted_at is null',
    [tenantId, lote.conector_id, lote.entidade],
  );
  const atual: Cursor | null = cur[0]?.cursor_alterado_em && cur[0].cursor_external_id ? { alterado_em: iso(cur[0].cursor_alterado_em), external_id: cur[0].cursor_external_id } : null;
  const av = avancarCursor(atual, cursorDoLote(aceitasValidas), resultado.status);
  if (av.avancou && av.cursor) {
    await db.query(
      `insert into integracao.cursor_entidade (tenant_id, conector_id, entidade, cursor_alterado_em, cursor_external_id, atualizado_em)
       values ($1, $2, $3, $4::timestamptz, $5, now())
       on conflict (tenant_id, conector_id, entidade) do update set cursor_alterado_em = excluded.cursor_alterado_em,
         cursor_external_id = excluded.cursor_external_id, atualizado_em = now(), deleted_at = null`,
      [tenantId, lote.conector_id, lote.entidade, av.cursor.alterado_em, av.cursor.external_id],
    );
  }
  const c = resultado.contagens;
  await db.query(
    `update integracao.lote set status = $3, com_erro = $4, duplicadas_no_lote = $5, novas = $6, atualizadas = $7, inalteradas = $8, obsoletas = $9,
            invalidas_omitidas = $10, aplicado_ate_indice = $11, cursor_resultante = $12::jsonb, avisos = $13::jsonb,
            iniciado_em = coalesce(iniciado_em, now()), concluido_em = now(), tentativas = tentativas + 1, ultimo_erro = null
      where tenant_id = $1 and id = $2`,
    [
      tenantId,
      lote.id,
      resultado.status,
      c.com_erro,
      c.duplicadas_no_lote,
      c.novas,
      c.atualizadas,
      c.inalteradas,
      c.obsoletas,
      trat.omitidas,
      registros.length > 0 ? registros.length - 1 : null,
      av.cursor ? JSON.stringify(av.cursor) : null,
      avisos.length > 0 ? JSON.stringify(avisos) : null,
    ],
  );

  // ---- sessão de carga completa (RN-INT-06)
  if (lote.sessao_id) {
    await fecharSessaoSeCompleta(db, ctx, { tenantId, agora, lote, aceitas: aceitasValidas, errosHub, trat, omitidasDoConector: Math.max(0, corpo.linhas_invalidas_omitidas ?? 0) });
  }

  await ctx.publicar(
    EVENTO_LOTE_CONCLUIDO,
    { lote_id: lote.id, entidade: lote.entidade, modo: lote.modo, status: resultado.status, recebidas: c.recebidas, com_erro: c.com_erro, concluido_em: agora },
    lote.id,
  );
  ctx.log.info({ lote_id: lote.id, entidade: lote.entidade, status: resultado.status, novas: c.novas, atualizadas: c.atualizadas, com_erro: c.com_erro }, 'lote aplicado');
}

/**
 * RN-CORE-19: situação das siglas de medida citadas (`core.medidas@1`, por bloco de 500): `ativas` e `inativas` (existem, mas o BKO
 * as desativou). Sigla ausente das duas = não cadastrada. `null` = não deu para conferir (o Core fora do ar para o tenant, RN-INT-14):
 * ninguém é recusado por isso.
 * A consulta está em `manifest.usaConsultas`.
 */
async function situacaoDasMedidas(ctx: ContextoConsumo, siglas: readonly string[]): Promise<{ ativas: Set<string>; inativas: Set<string> } | null> {
  if (siglas.length === 0) return { ativas: new Set(), inativas: new Set() };
  const ativas = new Set<string>();
  const inativas = new Set<string>();
  try {
    for (const bloco of blocos(siglas, 500)) {
      const r = await ctx.consultar(CONSULTA_MEDIDAS, { siglas: bloco });
      for (const m of r.medidas) (m.ativo ? ativas : inativas).add(m.sigla.toUpperCase());
    }
  } catch (e) {
    if (!ehConsultaIndisponivel(e)) ctx.log.warn({ consulta: 'core.medidas@1' }, 'não foi possível conferir as medidas; o lote segue sem a conferência');
    return null;
  }
  return { ativas, inativas };
}

/** RN-CORE-39: dos `filial_external_id` citados, os que existem no tenant (`core.filiais@1`); consulta indisponível = nenhum (vale só o Hub). */
async function filiaisDoCore(ctx: ContextoConsumo, ids: readonly string[]): Promise<Set<string>> {
  const achadas = new Set<string>();
  try {
    for (const bloco of blocos(ids, 500)) {
      const r = await ctx.consultar(CONSULTA_FILIAIS, { external_ids: bloco });
      for (const f of r.por_external_id) achadas.add(f.external_id);
    }
  } catch (e) {
    if (!ehConsultaIndisponivel(e)) ctx.log.warn({ consulta: 'core.filiais@1' }, 'não foi possível conferir as filiais; vale só o que o Hub já recebeu');
    return new Set();
  }
  return achadas;
}

async function avisarCadastroIncompleto(ctx: ContextoConsumo, aceitas: readonly LinhaValida[]): Promise<AvisoLinha[]> {
  if (aceitas.length === 0) return [];
  const avisos: AvisoLinha[] = [];
  for (const bloco of blocos(aceitas, 500)) {
    // o Core fora do ar para o tenant (ConsultaIndisponivel) não derruba o lote: sem consulta, sem aviso
    const r = await ctx.consultar(CONSULTA_CADASTRO_CLIENTE, { clientes: bloco.map((l) => dadosParaConsultaCadastro(l.registro as Parameters<typeof dadosParaConsultaCadastro>[0])) }).catch((e: unknown) => {
      if (ehConsultaIndisponivel(e)) return null;
      throw e;
    });
    if (r === null) return avisos;
    avisos.push(...avisosCadastroIncompleto(bloco.map((l) => ({ indice: l.indice, external_id: l.external_id })), r.resultados));
  }
  return avisos;
}

async function fecharSessaoSeCompleta(
  db: ClienteBanco,
  ctx: ContextoConsumo,
  p: {
    tenantId: string;
    agora: string;
    lote: LinhaLote;
    aceitas: readonly LinhaValida[];
    errosHub: readonly LinhaErro[];
    trat: ReturnType<typeof tratarLinhasInvalidasConector>;
    omitidasDoConector: number;
  },
): Promise<void> {
  const { tenantId, lote } = p;
  const sessaoId = lote.sessao_id as string;
  // o que esta parte deixou para a inativação: quem chegou inválido nunca é inativado; linha sem id impede
  const ids = idsDaSessaoNoLote({
    aceitas: p.aceitas,
    errosHub: p.errosHub,
    invalidasConector: { externalIds: p.trat.externalIds, semIdentificacao: p.trat.semIdentificacao },
  });
  for (const bloco of blocos(ids.invalidos)) {
    await db.query(
      'insert into integracao.sessao_carga_recebido (tenant_id, sessao_id, external_id) select $1, $2, x from unnest($3::text[]) as x on conflict (tenant_id, sessao_id, external_id) do nothing',
      [tenantId, sessaoId, bloco],
    );
  }
  const { rows: s } = await db.query<{ iniciada_em: Date; ultima_parte: number | null; situacao: string; linhas_sem_identificacao: number; invalidas_omitidas: number }>(
    `update integracao.sessao_carga set linhas_sem_identificacao = linhas_sem_identificacao + $3, invalidas_omitidas = invalidas_omitidas + $4
      where tenant_id = $1 and id = $2
      returning iniciada_em, ultima_parte, situacao, linhas_sem_identificacao, invalidas_omitidas`,
    [tenantId, sessaoId, ids.semIdentificacao, p.omitidasDoConector],
  );
  const sessao = s[0];
  if (!sessao || sessao.situacao !== 'aberta') return;

  const { rows: partes } = await db.query<{ sessao_parte: number; sessao_ultimo: boolean | null; status: EstadoLote }>(
    'select sessao_parte, sessao_ultimo, status from integracao.lote where tenant_id = $1 and sessao_id = $2 and deleted_at is null',
    [tenantId, sessaoId],
  );
  let estado: SessaoCargaEstado = novaSessao(sessaoId, lote.entidade, iso(sessao.iniciada_em));
  for (const x of partes) estado = registrarParte(estado, { parte: x.sessao_parte, ultimo: x.sessao_ultimo === true, status: x.status });
  // mesma fonte da rota da carga em partes (bko-carga-arquivo): o parâmetro do tenant, com o padrão só como reserva
  const parametros = lerParametrosHub(typeof ctx.parametros === 'function' ? ctx.parametros() : {}, ctx.log);
  const situacao = situacaoSessao(estado, p.agora, { ttlMin: parametros.ttlSessaoMin });
  if (situacao === 'aberta') return;
  const fechar = (nova: 'completa' | 'expirada') => db.query('update integracao.sessao_carga set situacao = $3, fechada_em = now() where tenant_id = $1 and id = $2', [tenantId, sessaoId, nova]);
  if (situacao === 'expirada') {
    await fechar('expirada');
    return;
  }

  // sessão completa: ativos do Conector e o que a carga trouxe
  const { rows: ativos } = await db.query<{ external_id: string; visto_em: Date }>(
    'select external_id, visto_em from integracao.registro_atual where tenant_id = $1 and entidade = $2 and conector_id = $3 and ativo and deleted_at is null',
    [tenantId, lote.entidade, lote.conector_id],
  );
  const { rows: vistos } = await db.query<{ external_id: string }>('select external_id from integracao.registro_atual where tenant_id = $1 and sessao_id = $2 and deleted_at is null', [tenantId, sessaoId]);
  const { rows: invalidos } = await db.query<{ external_id: string }>('select external_id from integracao.sessao_carga_recebido where tenant_id = $1 and sessao_id = $2', [tenantId, sessaoId]);
  const r = calcularInativacao({
    sessao: estado,
    agora: p.agora,
    ativosNoMacuxi: ativos.map((a) => a.external_id),
    ativosElegiveis: filtrarAtivosElegiveis(ativos.map((a) => ({ external_id: a.external_id, visto_em: iso(a.visto_em) })), estado.iniciadaEm),
    recebidosNaSessao: vistos.map((x) => x.external_id),
    invalidosNaSessao: invalidos.map((x) => x.external_id),
    linhasSemExternalId: sessao.linhas_sem_identificacao,
    linhasInvalidasOmitidas: sessao.invalidas_omitidas,
    limitePct: parametros.limiteInativacaoPct,
    ttlMin: parametros.ttlSessaoMin,
  });
  await fechar('completa');
  if (r.permitido) {
    const inativadas = await inativarElegiveis(db, ctx, { tenantId, sessaoId, entidade: lote.entidade, conectorId: lote.conector_id, loteId: lote.id, agora: p.agora });
    if (inativadas > 0) {
      await db.query('update integracao.sessao_carga set inativadas = inativadas + $3 where tenant_id = $1 and id = $2', [tenantId, sessaoId, inativadas]);
      await db.query('update integracao.lote set inativadas = inativadas + $3 where tenant_id = $1 and id = $2', [tenantId, lote.id, inativadas]);
    }
  } else if (r.motivo === 'excede_limite_inativacao') {
    const pend = criarPendencia(r, {
      id: sessaoId,
      sessao_id: sessaoId,
      entidade: lote.entidade,
      conector_id: lote.conector_id,
      lote_id: lote.id,
      agora: p.agora,
      totalAtivos: new Set(ativos.map((a) => a.external_id)).size,
      limitePct: parametros.limiteInativacaoPct,
      ttlDias: parametros.ttlConfirmacaoInativacaoDias,
    });
    await db.query(
      `insert into integracao.pendencia_inativacao (tenant_id, sessao_id, entidade, conector_id, lote_id, candidatos, total_ativos, percentual, limite_pct, amostra, expira_em)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz)
       on conflict (tenant_id, sessao_id) do nothing`,
      [tenantId, sessaoId, lote.entidade, lote.conector_id, lote.id, pend.candidatos, pend.total_ativos, pend.percentual, pend.limite_pct, JSON.stringify(pend.amostra), pend.expira_em],
    );
  }
}

/** O despachante só entrega eventos de `consome` do manifesto; o lote é publicado pelo próprio `POST /lotes`. */
export const consumidorLoteRecebido = definirConsumidor({ evento: EVENTO_LOTE_RECEBIDO, executar: aplicarLote });
