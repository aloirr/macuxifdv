/**
 * Delta ERP → fila local (RF-INT-02, RN-INT-05/06).
 *
 *  - Sem estado local: pergunta ao Hub o cursor da entidade. Cursor existente → segue por delta a partir dele;
 *    sem cursor → CARGA INICIAL COMPLETA (uma sessão, partes 1..n, a última com `ultimo: true`), depois só delta.
 *  - A consulta do ERP é paginada por cursor (`alterado_em`, `external_id`) e lê `limite + 1` linhas: a linha a mais diz
 *    se há mais páginas (e portanto qual parte é a última) sem precisar de um lote vazio.
 *  - Cada página vira lotes persistidos NA MESMA transação que avança o cursor de LEITURA; o cursor CONFIRMADO só avança
 *    quando o Hub conclui o lote (ver remetente.ts). Reiniciar a qualquer momento não perde nem duplica trabalho.
 *  - Ao voltar da carga completa para o delta relê uma folga (`margemDeltaSegundos`) para pegar o que mudou durante a carga.
 *  - Linhas inválidas (T-0027): na carga completa TODAS vão ao Hub com o external_id (o Hub nunca inativa registro que veio
 *    inválido, RN-INT-06); página só com linhas inválidas vira lote só com elas (exceção da RN-INT-01), no delta e na carga.
 */
import { EXTERNAL_ID_MAX, LIMITE_LINHAS_INVALIDAS_PADRAO, type Cursor } from '@macuxi/integracao/contracts';
import type { Fase } from './armazenamento/armazenamento';
import type { EntidadeConfig } from './config/esquema';
import { ehErroDeConexao } from './erp/driver';
import { type Contexto, resumoErro } from './contexto';
import { montarLotes } from './lotes';
import { compararCursor, limitarLinhasInvalidas, mapearEValidar } from './mapeamento';
import { bloqueioPorVersao, tratarRecusaPorVersao } from './politica';
import { iso } from './util/relogio';
import { VERSAO_CONECTOR } from './versao';
import type { Entidade } from './config/entidades';

const EPOCA: Cursor = { alterado_em: '1970-01-01T00:00:00.000Z', external_id: '' };
const MAX_PAGINAS_POR_CICLO = 50;
const MAX_ERROS_LOCAIS_POR_PAGINA = 200;

export interface ResultadoSincronizacao {
  entidade: string;
  fase: Fase | null;
  paginas: number;
  linhasLidas: number;
  lotesCriados: number;
  /** Motivo de não ter feito nada (bloqueada, hub fora, fila cheia…). */
  adiado?: string;
  /** Há mais para ler agora (limite de páginas do ciclo ou fila cheia): o agendador volta logo. */
  maisParaLer?: boolean;
  erro?: string;
}

export async function sincronizarEntidade(ctx: Contexto, entidade: Entidade): Promise<ResultadoSincronizacao> {
  const cfg = ctx.config.entidades[entidade];
  const res: ResultadoSincronizacao = { entidade, fase: null, paginas: 0, linhasLidas: 0, lotesCriados: 0 };
  if (!cfg || !cfg.ativa) return { ...res, adiado: 'entidade desativada' };
  // versão abaixo da mínima do Hub: não lê nem enfileira nada novo (a causa aparece em `conector status` e no log)
  if (bloqueioPorVersao(ctx)) return { ...res, adiado: 'versão do Conector abaixo da mínima exigida pelo Hub: atualize o Conector' };
  const { store, log } = ctx;
  const agora = () => ctx.relogio.agora();

  let estado = store.estado(entidade);
  if (estado?.bloqueio) return { ...res, fase: estado.fase, adiado: `bloqueada: ${estado.bloqueio}` };

  if (!estado) {
    try {
      const hub = await ctx.hub.consultarCursor(entidade);
      estado = hub.cursor
        ? store.iniciarEstado(entidade, 'delta', { cursor: hub.cursor, agoraMs: agora() })
        : store.iniciarEstado(entidade, 'completo', { sessaoId: ctx.uuid(), agoraMs: agora() });
      log.info('entidade_iniciada', { entidade, fase: estado.fase, origem_cursor: hub.cursor ? 'hub' : 'nenhum' });
    } catch (e) {
      if (tratarRecusaPorVersao(ctx, e, 'consultar_cursor')) return { ...res, adiado: 'Hub recusou esta versão do Conector (426): atualize o Conector' };
      log.aviso('hub_indisponivel_para_iniciar', { entidade, erro: resumoErro(e) });
      return { ...res, adiado: 'Hub indisponível para consultar o cursor' };
    }
  }
  res.fase = estado.fase;

  const pagina = cfg.maxLinhas ?? ctx.config.lote.maxLinhas;
  try {
    for (let p = 0; p < MAX_PAGINAS_POR_CICLO; p++) {
      estado = store.estado(entidade) ?? estado;
      if (store.contarLotes(entidade, ['pendente', 'aguardando']) >= ctx.config.fila.maxLotesPendentesPorEntidade) {
        res.adiado = 'fila cheia: aguardando o Hub processar os lotes anteriores';
        break;
      }
      const continuar = await lerPagina(ctx, entidade, cfg, pagina, res);
      if (!continuar) break;
      if (p === MAX_PAGINAS_POR_CICLO - 1) res.maisParaLer = true;
    }
    if (res.adiado?.startsWith('fila cheia')) res.maisParaLer = true;
    store.atualizarEstado(entidade, { ultimaExecucaoMs: agora(), ultimoSucessoMs: agora(), ultimoErro: null, ultimoErroMs: null });
  } catch (e) {
    const transitorio = ehErroDeConexao(e);
    res.erro = resumoErro(e);
    store.atualizarEstado(entidade, { ultimaExecucaoMs: agora(), ultimoErroMs: agora(), ultimoErro: res.erro });
    log[transitorio ? 'aviso' : 'erro']('leitura_erp_falhou', { entidade, transitorio, erro: res.erro });
  }
  return res;
}

/** Lê e enfileira uma página. Devolve `true` se há mais páginas a ler neste ciclo. */
async function lerPagina(ctx: Contexto, entidade: Entidade, cfg: EntidadeConfig, tamanho: number, res: ResultadoSincronizacao): Promise<boolean> {
  const { store, log } = ctx;
  const estado = store.estado(entidade);
  if (!estado) return false;
  const leitura = estado.lido ?? EPOCA;
  const linhas = await ctx.erp.consultar(cfg.consulta, {
    cursor_alterado_em: new Date(Date.parse(leitura.alterado_em)),
    cursor_alterado_em_ms: Date.parse(leitura.alterado_em),
    cursor_external_id: leitura.external_id,
    limite: tamanho + 1,
  });
  res.paginas++;
  const temMais = linhas.length > tamanho;
  const pagina = temMais ? linhas.slice(0, tamanho) : linhas;
  res.linhasLidas += pagina.length;
  const completo = estado.fase === 'completo';
  const agora = ctx.relogio.agora();

  if (pagina.length === 0) {
    if (completo) {
      if (estado.sessaoParte === 0) log.aviso('carga_completa_vazia', { entidade, dica: 'a consulta não devolveu linhas; nada será enviado nem inativado' });
      else log.aviso('sessao_nao_fechada', { entidade, dica: 'a última página ficou vazia; o Hub deixa a sessão expirar e não inativa nada' });
      concluirCargaCompleta(ctx, entidade, estado.lido, estado.cargaIniciadaMs);
    }
    return false;
  }

  // carga completa: toda linha inválida vai ao Hub com o external_id, qualquer que seja `linhasInvalidas` (RN-INT-06, T-0027 🔴)
  const m = mapearEValidar(entidade, cfg, pagina, estado.lido, { enviarInvalidas: completo });
  const motivoSemAvanco = 'a leitura não avança (várias linhas com o mesmo alterado_em e external_id, ou alterado_em com precisão menor que a do filtro); use alterado_em em milissegundos e external_id único';
  if (m.repetidas === pagina.length) {
    // sem mais páginas: só linhas já lidas (precisão de alterado_em), sem novidade. Com mais páginas: a próxima leitura
    // devolveria a mesma página para sempre; bloqueia com a causa visível em vez de parar em silêncio.
    if (temMais) {
      store.atualizarEstado(entidade, { bloqueio: motivoSemAvanco });
      log.erro('entidade_bloqueada', { entidade, motivo: motivoSemAvanco });
    }
    return false;
  }
  if (m.ultimo === null) {
    const motivo = 'nenhuma linha lida tem external_id e alterado_em legíveis; confira o mapeamento de colunas e a consulta';
    store.atualizarEstado(entidade, { bloqueio: motivo });
    log.erro('entidade_bloqueada', { entidade, motivo });
    return false;
  }
  if (m.descartadas > 0 || m.invalidas > 0) {
    log.aviso('linhas_com_problema', { entidade, descartadas: m.descartadas, invalidas: m.invalidas, envio: cfg.linhasInvalidas });
    store.registrarErros(
      m.problemas.slice(0, MAX_ERROS_LOCAIS_POR_PAGINA).map((pr) => ({
        entidade, origem: 'local' as const, loteChave: null, indice: pr.posicao, externalId: pr.external_id, codigo: 'mapeamento', campo: pr.campo, mensagem: pr.mensagem, reprocessavel: false,
      })),
      agora,
    );
  }

  const ultimaPagina = !temMais;
  // Delta: linhas recusadas localmente vão ao Hub com o motivo até lote.maxLinhasInvalidas por página; o resto só na contagem.
  // Carga completa (T-0027 🔴): NENHUMA fica de fora — sem o external_id o Hub inativaria o registro (ou, com omitidas, não
  // inativaria nada na sessão). Vão em fatias de até 500 por lote; o que sobrar vira lote só de linhas inválidas (RN-INT-01).
  const inval = completo ? { enviadas: m.linhasInvalidas, omitidas: 0 } : limitarLinhasInvalidas(m.linhasInvalidas, ctx.config.lote.maxLinhasInvalidas);
  const lotes = montarLotes({
    entidade,
    modo: completo ? 'completo' : 'delta',
    geracao: estado.geracao,
    registros: m.registros,
    // o cursor declarado é informativo: um external_id acima do contrato não pode derrubar o envelope inteiro
    cursorDeclarado: m.cursor && m.cursor.external_id.length <= EXTERNAL_ID_MAX ? m.cursor : null,
    cursorLeitura: m.ultimo,
    maxLinhas: ctx.config.lote.maxLinhas,
    maxBytes: ctx.config.lote.maxBytes,
    sessao: completo && estado.sessaoId ? { id: estado.sessaoId, primeiraParte: estado.sessaoParte + 1, ultimaPagina } : undefined,
    enviadoEm: iso(agora),
    conectorId: ctx.config.hub.conectorId,
    versaoConector: ctx.versao ?? VERSAO_CONECTOR,
    linhasInvalidas: inval.enviadas,
    linhasInvalidasOmitidas: inval.omitidas,
    maxLinhasInvalidasPorLote: completo ? porLoteNaCargaCompleta(ctx.config.lote.maxLinhasInvalidas) : undefined,
  });

  if (temMais && estado.lido && compararCursor(m.ultimo, estado.lido) <= 0) {
    store.atualizarEstado(entidade, { bloqueio: motivoSemAvanco });
    log.erro('entidade_bloqueada', { entidade, motivo: motivoSemAvanco });
    return false;
  }

  store.transacao(() => {
    let criados = 0;
    for (const l of lotes) {
      const entrou = store.enfileirar(
        { entidade, geracao: estado.geracao, modo: completo ? 'completo' : 'delta', chave: l.chave, envelope: l.corpo, linhas: l.linhas, bytes: l.bytes, cursor: l.cursorConfirmar, sessaoId: completo ? estado.sessaoId : null, parte: l.parte, ultimo: l.ultimo },
        agora,
      );
      if (entrou) criados++;
    }
    res.lotesCriados += criados;
    const novoLido = estado.lido === null || compararCursor(m.ultimo as Cursor, estado.lido) > 0 ? m.ultimo : estado.lido;
    store.atualizarEstado(entidade, { lido: novoLido, sessaoParte: estado.sessaoParte + lotes.length });
  });
  log.info('pagina_enfileirada', { entidade, fase: estado.fase, linhas: pagina.length, lotes: lotes.length, mais: temMais });

  if (!temMais && completo) {
    const atual = store.estado(entidade);
    concluirCargaCompleta(ctx, entidade, atual?.lido ?? m.ultimo, estado.cargaIniciadaMs);
    if (lotes.length === 0) log.aviso('sessao_nao_fechada', { entidade, dica: 'a última página não tinha linhas enviáveis; o Hub deixa a sessão expirar e não inativa nada' });
  }
  return temMais;
}

/**
 * Linhas inválidas por lote na carga completa: o configurado, limitado ao padrão do Hub (500, acima disso o Hub só conta e a
 * sessão não inativa nada); `0` ("só a contagem") não vale aqui, porque o external_id é o que protege o registro.
 */
export function porLoteNaCargaCompleta(configurado: number): number {
  return configurado > 0 ? Math.min(configurado, LIMITE_LINHAS_INVALIDAS_PADRAO) : LIMITE_LINHAS_INVALIDAS_PADRAO;
}

/** Fim da carga completa: passa ao delta relendo uma folga antes do início da carga (mudanças durante a carga). */
function concluirCargaCompleta(ctx: Contexto, entidade: Entidade, fim: Cursor | null, iniciadaMs: number | null): void {
  const margemMs = ctx.config.margemDeltaSegundos * 1000;
  let lido: Cursor | null = fim;
  if (iniciadaMs !== null) {
    const folga: Cursor = { alterado_em: iso(Math.max(0, iniciadaMs - margemMs)), external_id: '' };
    if (lido === null || compararCursor(folga, lido) < 0) lido = folga;
  }
  ctx.store.atualizarEstado(entidade, { fase: 'delta', lido, sessaoId: null, sessaoParte: 0, cargaIniciadaMs: null });
  ctx.log.info('carga_completa_enfileirada', { entidade });
}

/** `conector carga-completa <entidade>`: descarta o que estiver na fila da entidade e recomeça com nova sessão. */
export function reiniciarCargaCompleta(ctx: Pick<Contexto, 'store' | 'log' | 'relogio' | 'uuid'>, entidade: Entidade): void {
  ctx.store.transacao(() => {
    ctx.store.substituirLotesAbertos(entidade, ctx.relogio.agora());
    ctx.store.iniciarEstado(entidade, 'completo', { sessaoId: ctx.uuid(), agoraMs: ctx.relogio.agora() });
  });
  ctx.log.info('carga_completa_solicitada', { entidade });
}

/**
 * `conector retomar <entidade>`: depois de corrigir a configuração ou a causa de um bloqueio. Delta: relê a partir do cursor
 * CONFIRMADO (nada se perde); carga completa: recomeça a sessão.
 */
export function retomarEntidade(ctx: Pick<Contexto, 'store' | 'log' | 'relogio' | 'uuid'>, entidade: Entidade): void {
  const estado = ctx.store.estado(entidade);
  if (!estado) return;
  if (estado.fase === 'completo') {
    reiniciarCargaCompleta(ctx, entidade);
    return;
  }
  ctx.store.transacao(() => {
    ctx.store.substituirLotesAbertos(entidade, ctx.relogio.agora());
    ctx.store.iniciarEstado(entidade, 'delta', { cursor: estado.confirmado, agoraMs: ctx.relogio.agora() });
  });
  ctx.log.info('entidade_retomada', { entidade });
}
