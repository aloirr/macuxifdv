/**
 * Esvazia a fila local rumo ao Hub (RF-INT-02, RN-INT-03/05/06).
 *
 *  pendente ──POST /lotes──► aguardando ──GET /lotes/{id}──► concluido | concluido_com_erros | falhou
 *      │ (recusa 4xx do envelope)                                     │ (cursor só avança aqui, em ordem)
 *      └──► recusado  (entidade BLOQUEADA até `conector retomar`)     └─ erros por linha ficam no log local
 *
 *  - Falha de rede/5xx/429: o lote continua `pendente` com espera exponencial persistida (sobrevive a reinício).
 *  - 401/403 (credencial) e 426 (versão abaixo da mínima, T-0027): PAUSA com espera longa; nada é descartado nem bloqueado.
 *  - Recusa do envelope por regra (versão, entidade, limite, sessão…): NÃO é reenviada; bloqueia a entidade.
 *  - Erro por linha: recusa por regra (`campo_obrigatorio`, `tipo_invalido`…) NUNCA é reenviada (exige correção no ERP; quando
 *    corrigida, o `alterado_em` novo a traz no próximo delta). `referencia_ausente` o Hub guarda no staging e reprocessa sozinho.
 *    Só `falha_processamento` (transitório) é reenviada, em novo lote só com essas linhas, até `reenviosFalhaProcessamento` vezes.
 *  - Trava de inativação em massa (RN-INT-06): se o Hub devolver `inativacao.situacao = aguardando_confirmacao`, o Conector só avisa
 *    (log/status); quem confirma é o operador no BKO. Nunca reenvia nem força.
 */
import { VERSAO_CONTRATO, type LinhaErro, type LoteEnvelope } from '@macuxi/integracao/contracts';
import type { LoteLocal } from './armazenamento/armazenamento';
import { type Contexto, resumoErro } from './contexto';
import { chaveDoLote } from './lotes';
import { compararCursor } from './mapeamento';
import { ErroHubAutenticacao, ErroHubTransitorio } from './hub/cliente';
import type { ResultadoLoteHub } from './hub/tipos';
import { bloqueioPorVersao, tratarRecusaPorVersao } from './politica';
import { calcularEspera } from './util/retry';
import { iso } from './util/relogio';

export interface ResultadoFila {
  enviados: number;
  concluidos: number;
  recusados: number;
  adiados: number;
  /** Erro que interrompeu o ciclo (credencial, Hub fora). */
  interrompido?: string;
}

const FINAIS_BONS = new Set(['concluido', 'concluido_com_erros']);

function proximaTentativa(ctx: Contexto, tentativas: number): number {
  const f = ctx.config.fila;
  return ctx.relogio.agora() + calcularEspera(tentativas, { baseMs: f.backoffBaseSegundos * 1000, maxMs: f.backoffMaxSegundos * 1000 }, ctx.aleatorio);
}

export async function processarFila(ctx: Contexto): Promise<ResultadoFila> {
  const r: ResultadoFila = { enviados: 0, concluidos: 0, recusados: 0, adiados: 0 };
  const { store } = ctx;
  const parado = bloqueioPorVersao(ctx);
  if (parado) {
    // versão abaixo da mínima do Hub: nada sai (lotes ficam na fila local, sem perda); o sinal de vida segue
    r.interrompido = parado.mensagem;
    return r;
  }
  const bloqueadas = new Set(store.estados().filter((e) => e.bloqueio).map((e) => e.entidade));

  // 1) resultados dos lotes já aceitos; 2) envio dos pendentes (ordem da fila)
  const fila = [...store.lotesProntos('aguardando', ctx.relogio.agora()), ...store.lotesProntos('pendente', ctx.relogio.agora())];
  const ordenada = fila.sort((a, b) => (a.estado === b.estado ? a.id - b.id : a.estado === 'aguardando' ? -1 : 1));

  for (const lote of ordenada) {
    if (bloqueadas.has(lote.entidade)) continue;
    try {
      if (lote.estado === 'pendente') {
        await enviar(ctx, lote, r);
      } else {
        await consultar(ctx, lote, r);
      }
    } catch (e) {
      if (e instanceof ErroHubAutenticacao) {
        r.interrompido = e.message;
        ctx.log.erro('hub_credencial_recusada', { status: e.status });
        // espera longa: não adianta insistir a cada ciclo com credencial inválida
        const t = (lote.tentativas ?? 0) + 1;
        store.atualizarLote(lote.id, { tentativas: t, proximaMs: proximaTentativa(ctx, t), erro: 'credencial recusada pelo Hub' }, ctx.relogio.agora());
        break;
      }
      if (tratarRecusaPorVersao(ctx, e, lote.estado === 'pendente' ? 'enviar_lote' : 'consultar_lote')) {
        // 426 (T-0027): pausa como 401/403 — o lote continua na fila com espera, a entidade NÃO é bloqueada
        r.interrompido = (e as Error).message;
        const t = lote.tentativas + 1;
        store.atualizarLote(lote.id, { tentativas: t, proximaMs: proximaTentativa(ctx, t), erro: 'versão do Conector recusada pelo Hub (426)' }, ctx.relogio.agora());
        r.adiados++;
        break;
      }
      if (e instanceof ErroHubTransitorio) {
        const t = lote.tentativas + 1;
        store.atualizarLote(lote.id, { tentativas: t, proximaMs: proximaTentativa(ctx, t), erro: resumoErro(e) }, ctx.relogio.agora());
        r.adiados++;
        ctx.log.aviso('envio_adiado', { entidade: lote.entidade, lote_local: lote.id, tentativas: t, erro: resumoErro(e) });
        r.interrompido ??= resumoErro(e);
        // Hub fora do ar/limitando: os demais lotes falhariam do mesmo jeito (e cada um custaria os retries). O lote que falhou
        // fica com a espera persistida, então no próximo ciclo a fila segue com os outros.
        break;
      }
      throw e;
    }
  }
  return r;
}

async function enviar(ctx: Contexto, lote: LoteLocal, r: ResultadoFila): Promise<void> {
  const { store, log } = ctx;
  const resp = await ctx.hub.enviarLote(lote.envelope, lote.chave);
  const agora = ctx.relogio.agora();
  if (resp.tipo === 'aceito') {
    store.atualizarLote(lote.id, { estado: 'aguardando', loteId: resp.aceito.lote_id, tentativas: 0, proximaMs: agora, erro: null }, agora);
    r.enviados++;
    log.info('lote_enviado', { entidade: lote.entidade, lote_local: lote.id, lote_id: resp.aceito.lote_id, linhas: lote.linhas, parte: lote.parte, ultimo: lote.ultimo });
    await consultar(ctx, { ...lote, estado: 'aguardando', loteId: resp.aceito.lote_id }, r);
    return;
  }
  const codigos = resp.recusa?.erros.map((e) => e.codigo).join(', ') ?? `http_${resp.status}`;
  const detalhe = resp.recusa?.erros.map((e) => `${e.codigo}${e.campo ? ` (${e.campo})` : ''}: ${e.mensagem}`).join(' | ') ?? `Hub respondeu HTTP ${resp.status}`;
  const motivo = `Hub recusou o lote (${codigos}). Corrija a causa e rode: conector retomar ${lote.entidade}`;
  store.transacao(() => {
    store.atualizarLote(lote.id, { estado: 'recusado', erro: detalhe.slice(0, 500) }, agora);
    store.esvaziarLote(lote.id);
    store.atualizarEstado(lote.entidade, { bloqueio: motivo });
  });
  r.recusados++;
  log.erro('lote_recusado', { entidade: lote.entidade, lote_local: lote.id, codigos, detalhe });
}

async function consultar(ctx: Contexto, lote: LoteLocal, r: ResultadoFila): Promise<void> {
  const { store, log } = ctx;
  const agora = ctx.relogio.agora();
  if (!lote.loteId) return;
  const res = await ctx.hub.consultarLote(lote.loteId);
  if (res === null) {
    // o Hub não conhece o lote: volta a pendente (a chave de idempotência evita duplicar se ele existir)
    store.atualizarLote(lote.id, { estado: 'pendente', loteId: null, proximaMs: agora }, agora);
    log.aviso('lote_desconhecido_no_hub', { lote_local: lote.id });
    return;
  }
  if (res.status === 'recebido' || res.status === 'processando') {
    store.atualizarLote(lote.id, { proximaMs: agora + ctx.config.fila.consultaResultadoSegundos * 1000 }, agora);
    return;
  }
  finalizar(ctx, lote, res);
  r.concluidos++;
}

function finalizar(ctx: Contexto, lote: LoteLocal, res: ResultadoLoteHub): void {
  const { store, log } = ctx;
  const agora = ctx.relogio.agora();
  // linhas que o PRÓPRIO Conector informou como inválidas voltam no resultado com origem `conector`: já estão nos erros locais
  const erros = res.erros.filter((e) => e.origem !== 'conector');
  const naoReenviaveis = erros.filter((e) => !e.reprocessavel);
  const aguardandoReferencia = erros.filter((e) => e.codigo === 'referencia_ausente');
  const transitorios = erros.filter((e) => e.codigo === 'falha_processamento');

  store.transacao(() => {
    store.registrarErros(
      erros.slice(0, 500).map((e: LinhaErro) => ({
        entidade: lote.entidade, origem: 'hub' as const, loteChave: lote.chave, indice: e.indice, externalId: e.external_id, codigo: e.codigo, campo: e.campo, mensagem: e.mensagem, reprocessavel: e.reprocessavel,
      })),
      agora,
    );
    // `falhou` com erros por linha (todas as linhas recusadas): o Hub não aceita o lote e reenviar não adianta; as linhas
    // corrigidas no ERP voltam pelo delta (novo alterado_em). Para o Conector o lote está tratado. Sem erro por linha, a causa
    // é do lote inteiro: bloqueia a entidade até o operador agir.
    const terminal: 'concluido' | 'concluido_com_erros' | 'falhou' = FINAIS_BONS.has(res.status) ? (res.status as 'concluido' | 'concluido_com_erros') : erros.length > 0 ? 'concluido_com_erros' : 'falhou';
    store.atualizarLote(lote.id, { estado: terminal, erro: res.status === 'falhou' ? `lote falhou no Hub (${erros.length} linha(s) com erro)` : null }, agora);
    // reenvio só das linhas com falha transitória
    if (transitorios.length > 0 && lote.modo === 'delta' && lote.reenvios < ctx.config.fila.reenviosFalhaProcessamento) {
      reenfileirarLinhas(ctx, lote, new Set(transitorios.map((e) => e.indice)));
    }
    if (res.status === 'falhou' && erros.length === 0) {
      store.atualizarEstado(lote.entidade, { bloqueio: `O Hub marcou o lote como "falhou". Reprocesse no BKO (Integração) ou rode: conector retomar ${lote.entidade}` });
    }
    if (res.inativacao?.situacao === 'aguardando_confirmacao') {
      // P-2: o lote foi APLICADO (o cursor avança); só as inativações esperam a confirmação no BKO
      const pct = typeof res.inativacao.percentual === 'number' ? ` (${res.inativacao.percentual}% dos ativos)` : '';
      store.atualizarEstado(lote.entidade, {
        aviso: `Trava de inativação em massa (RN-INT-06): a carga completa foi aplicada, mas o Hub não inativou ${res.inativacao.candidatos ?? '?'} registro(s) ausentes${pct}. Confirme no BKO (Integração ERP > Inativação em massa) se a ausência é intencional.`,
      });
    }
    store.esvaziarLote(lote.id);
    confirmarCursor(ctx, lote.entidade);
  });

  if (res.inativacao?.situacao === 'aguardando_confirmacao') {
    log.aviso('inativacao_em_massa_aguardando_confirmacao', { entidade: lote.entidade, candidatos: res.inativacao.candidatos ?? null, lote_id: res.lote_id });
  }
  log.info('lote_concluido', {
    entidade: lote.entidade,
    lote_id: res.lote_id,
    status: res.status,
    recebidas: res.contagens.recebidas,
    novas: res.contagens.novas,
    atualizadas: res.contagens.atualizadas,
    inalteradas: res.contagens.inalteradas,
    com_erro: res.contagens.com_erro,
    erros_definitivos: naoReenviaveis.filter((e) => e.codigo !== 'falha_processamento').length,
    aguardando_referencia: aguardandoReferencia.length,
    reenviar_transitorios: transitorios.length,
    ...(res.erros_omitidos ? { erros_omitidos_pelo_hub: res.erros_omitidos } : {}),
  });
}

/**
 * Reenvia, em novo lote, só as linhas que o Hub devolveu como `falha_processamento`. O envelope é montado campo a campo (T-0048,
 * RN-INT-03): as `linhas_invalidas`/`linhas_invalidas_omitidas` do lote original já foram informadas e contadas pelo Hub; repeti-las
 * duplicaria o erro no monitor e faria o conteúdo divergir da chave de idempotência (calculada só com os registros).
 */
function reenfileirarLinhas(ctx: Contexto, lote: LoteLocal, indices: Set<number>): void {
  const env = JSON.parse(lote.envelope) as LoteEnvelope;
  const registros = env.registros.filter((_, i) => indices.has(i));
  if (registros.length === 0) return;
  const novo: LoteEnvelope = {
    versao_contrato: VERSAO_CONTRATO,
    entidade: env.entidade,
    modo: 'delta',
    enviado_em: iso(ctx.relogio.agora()),
    ...(env.conector_id ? { conector_id: env.conector_id } : {}),
    ...(env.versao_conector ? { versao_conector: env.versao_conector } : {}),
    registros,
  };
  const corpo = JSON.stringify(novo);
  const reenvios = lote.reenvios + 1;
  ctx.store.enfileirar(
    {
      entidade: lote.entidade, geracao: lote.geracao, modo: 'delta', chave: chaveDoLote({ entidade: lote.entidade, modo: 'delta', geracao: lote.geracao, sessaoId: `reenvio-${reenvios}-${lote.chave}`, registros }),
      envelope: corpo, linhas: registros.length, bytes: Buffer.byteLength(corpo), cursor: null, sessaoId: null, parte: null, ultimo: false, reenvios, semCursor: true,
    },
    ctx.relogio.agora(),
  );
}

/** Avança o cursor CONFIRMADO só até onde todos os lotes anteriores da entidade terminaram bem (RN-INT-05). */
export function confirmarCursor(ctx: Contexto, entidade: string): void {
  const estado = ctx.store.estado(entidade);
  if (!estado) return;
  let confirmado = estado.confirmado;
  for (const l of ctx.store.naoConfirmados(entidade, estado.geracao)) {
    if (!FINAIS_BONS.has(l.estado)) break;
    if (l.cursor && (confirmado === null || compararCursor(l.cursor, confirmado) > 0)) confirmado = l.cursor;
    ctx.store.marcarConfirmado(l.id);
  }
  if (confirmado !== estado.confirmado) ctx.store.atualizarEstado(entidade, { confirmado });
}
