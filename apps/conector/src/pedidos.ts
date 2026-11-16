/**
 * Retorno de pedidos ao ERP (RF-INT-02, RN-INT-08).
 *
 *  Hub ──GET /pedidos/pendentes──► Conector ──SQL configurável──► ERP (tabela de entrada/procedure, numa transação)
 *   ▲                                   │ guarda o pedido localmente ANTES de gravar (idempotente pelo pedido_uuid)
 *   └──POST /pedidos/{uuid}/retorno─────┘ `integrado` (nº do ERP) | `rejeitado_erp` (motivo)
 *  Depois, a cada ciclo de status, consulta o ERP por pedido aberto e informa `faturado_parcial` (uma nota por vez, com itens
 *  faturados quando a consulta existir), `faturado_total` e `cancelado` (o Macuxi só escreve cancelamento no ERP quando o conector é cadastrado com "aceita cancelamento"
 *  (T-0114): o Hub então entrega `cancelamentos` em /pedidos/pendentes, o Conector executa `pedidos.cancelamento.executar` e confirma
 *  com o retorno `cancelado`; sem isso, nada é escrito.
 *
 *  - Erro de CONEXÃO com o ERP não conta como tentativa (volta depois). Erro do SQL/regra do ERP conta; esgotadas as tentativas
 *    o pedido é devolvido ao Hub como `rejeitado_erp` com o motivo (sem dado pessoal).
 *  - Cada retorno é persistido numa fila local e reenviado até o Hub aceitar (o Hub é idempotente); recusa por regra (4xx) não repete.
 */
import { type ItemFaturado, PedidoParaErp, RetornoErp, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import type { PedidoLocal } from './armazenamento/armazenamento';
import type { PedidosConfig } from './config/esquema';
import { type Contexto, resumoErro } from './contexto';
import { ehErroDeConexao, type Linha } from './erp/driver';
import { ErroHubAutenticacao, ErroHubTransitorio, ErroHubVersao } from './hub/cliente';
import type { RetornoParaHub } from './hub/tipos';
import { bloqueioPorVersao, tratarRecusaPorVersao } from './politica';
import { mascararTexto } from './log/mascara';
import { calcularEspera } from './util/retry';
import { iso } from './util/relogio';

const FINAIS = new Set(['faturado_total', 'cancelado', 'rejeitado_erp']);

export interface ResultadoPedidos {
  recebidos: number;
  gravados: number;
  rejeitados: number;
  retornosEnfileirados: number;
  retornosEnviados: number;
  retornosRecusados: number;
  erro?: string;
}

const novoResultado = (): ResultadoPedidos => ({ recebidos: 0, gravados: 0, rejeitados: 0, retornosEnfileirados: 0, retornosEnviados: 0, retornosRecusados: 0 });

function espera(ctx: Contexto, tentativas: number): number {
  const f = ctx.config.fila;
  return ctx.relogio.agora() + calcularEspera(tentativas, { baseMs: f.backoffBaseSegundos * 1000, maxMs: f.backoffMaxSegundos * 1000 }, ctx.aleatorio);
}

/** Espera de um retorno que o Hub não recebeu: backoff, nunca antes do `Retry-After` pedido pelo Hub (RN-INT-12, T-0048). */
function esperaHub(ctx: Contexto, tentativas: number, erro: unknown): number {
  const pedida = erro instanceof ErroHubTransitorio && erro.retryAfterMs ? ctx.relogio.agora() + erro.retryAfterMs : 0;
  return Math.max(espera(ctx, tentativas), pedida);
}

/** Um ciclo completo: buscar → gravar → acompanhar status → enviar retornos. */
export async function cicloPedidos(ctx: Contexto, partes: { buscar?: boolean; status?: boolean } = { buscar: true, status: true }): Promise<ResultadoPedidos> {
  const cfg = ctx.config.pedidos;
  const r = novoResultado();
  if (!cfg?.ativo) return r;
  const parado = bloqueioPorVersao(ctx);
  if (parado) {
    r.erro = parado.mensagem;
    return r;
  }
  // cada etapa é independente: o ERP fora do ar não impede de enviar os retornos já guardados, e o Hub fora não impede de gravar
  const etapa = async (nome: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      r.erro ??= resumoErro(e);
      if (e instanceof ErroHubAutenticacao) ctx.log.erro('hub_credencial_recusada', { status: e.status });
      else if (!tratarRecusaPorVersao(ctx, e, `pedidos_${nome}`)) ctx.log.aviso('etapa_pedidos_interrompida', { etapa: nome, erro: resumoErro(e) });
    }
  };
  if (partes.buscar) await etapa('buscar', () => buscarPedidos(ctx, r));
  await etapa('gravar', () => gravarPedidos(ctx, cfg, r));
  await etapa('cancelar', () => executarCancelamentos(ctx, cfg, r));
  if (partes.status) await etapa('status', () => acompanharStatus(ctx, cfg, r));
  await etapa('retornos', () => enviarRetornos(ctx, r));
  return r;
}

export async function buscarPedidos(ctx: Contexto, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const { pedidos, cancelamentos } = await ctx.hub.pedidosPendentes();
  for (const c of cancelamentos ?? []) {
    // guarda ANTES de executar: se o Hub reentregar (timeout), não executa duas vezes (idempotente pelo pedido_uuid)
    if (ctx.store.registrarCancelamento(c.pedido_uuid, JSON.stringify(c), ctx.relogio.agora())) ctx.log.info('cancelamento_recebido', { pedido_uuid: c.pedido_uuid, tentativa: c.tentativa });
  }
  for (const p of pedidos) {
    // guarda ANTES de qualquer outra coisa: se o Hub reentregar (timeout de 10 min), não grava duas vezes
    if (ctx.store.registrarPedido(p.pedido_uuid, JSON.stringify(p), ctx.relogio.agora())) {
      r.recebidos++;
      ctx.log.info('pedido_recebido', { pedido_uuid: p.pedido_uuid, itens: p.itens.length, tentativa: p.tentativa });
    }
  }
  return r;
}

export async function gravarPedidos(ctx: Contexto, cfg: PedidosConfig, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  for (const local of ctx.store.pedidosPorEstado(['recebido'], ctx.relogio.agora())) await gravar(ctx, cfg, local, r);
  return r;
}

/**
 * Parametros nomeados do SQL do cabecalho do pedido (1.4.0, T-0149). Campo ausente vira `null` (nunca `undefined`), para o SQL do
 * cliente poder testar `:param IS NULL`. Grupos:
 *  - filial (RN-CORE-39): `filial_codigo`, `filial_external_id` (nulos = filial padrao do ERP);
 *  - frete (RN-VEN-16): `frete_modalidade` (CIF|FOB|nulo) e, no FOB, `frete_transportadora_tipo` (cadastrada|digitada), `_id`,
 *    `_external_id` (so da cadastrada), `_nome`, `_cnpj`, `_telefone`;
 *  - entrega (RN-VEN-17): `entrega_origem` (erp|editado|nulo), `entrega_external_id` (NULO = usar os textos), `entrega_logradouro`,
 *    `_numero`, `_complemento`, `_bairro`, `_cidade`, `_uf`, `_cep`, `entrega_principal`;
 *  - pagamento (RN-VEN-24): `pagamento_forma_codigo`, `_forma_external_id`, `_prazo_codigo`, `_prazo_external_id`,
 *    `pagamento_parcelas_dias` (texto "30,60,90") e `pagamento_prazo_medio_dias` e, desde o 1.5.0 (RN-INT-15), `pagamento_percentual_ajuste` (só informativo).
 * Pedido antigo, sem esses blocos, grava tudo nulo e o SQL antigo (que nao os cita) segue igual.
 */
export function parametrosCabecalho(pedido: PedidoParaErp): Record<string, unknown> {
  const fr = pedido.frete ?? null;
  const tr = fr && fr.modalidade === 'FOB' ? fr.transportadora : null;
  const cad = tr && tr.tipo === 'cadastrada' ? tr : null;
  const en = pedido.endereco_entrega ?? null;
  const pg = pedido.pagamento ?? null;
  return {
    pedido_uuid: pedido.pedido_uuid,
    cliente_external_id: pedido.cliente_external_id,
    vendedor_external_id: pedido.vendedor_external_id,
    condicao_pagamento_erp: pedido.condicao_pagamento_erp ?? null,
    criado_em: new Date(pedido.criado_em),
    aprovado_em: new Date(pedido.aprovado_em),
    observacao: pedido.observacao ?? null,
    desconto_total_cents: pedido.desconto_total_cents,
    total_cents: pedido.total_cents,
    tentativa: pedido.tentativa,
    // T-0149 (RN-CORE-39, Conector 1.4.0): filial do pedido; nulos = filial padrao do ERP (pedido da filial padrao ou antigo)
    filial_codigo: pedido.filial?.codigo ?? null,
    filial_external_id: pedido.filial?.external_id ?? null,
    frete_modalidade: fr?.modalidade ?? null,
    frete_transportadora_tipo: tr?.tipo ?? null,
    frete_transportadora_id: cad?.id ?? null,
    frete_transportadora_external_id: cad?.external_id ?? null,
    frete_transportadora_nome: tr?.nome ?? null,
    frete_transportadora_cnpj: tr?.cnpj ?? null,
    frete_transportadora_telefone: tr?.telefone ?? null,
    entrega_origem: en ? (en.origem ?? 'erp') : null,
    entrega_external_id: en?.external_id ?? null,
    entrega_logradouro: en?.logradouro ?? null,
    entrega_numero: en?.numero ?? null,
    entrega_complemento: en?.complemento ?? null,
    entrega_bairro: en?.bairro ?? null,
    entrega_cidade: en?.cidade ?? null,
    entrega_uf: en?.uf ?? null,
    entrega_cep: en?.cep ?? null,
    entrega_principal: en ? (en.principal ?? null) : null,
    pagamento_forma_codigo: pg?.forma_codigo ?? null,
    pagamento_forma_external_id: pg?.forma_external_id ?? null,
    pagamento_prazo_codigo: pg?.prazo_codigo ?? null,
    pagamento_prazo_external_id: pg?.prazo_external_id ?? null,
    pagamento_parcelas_dias: pg ? pg.parcelas_dias.join(',') : null,
    pagamento_prazo_medio_dias: pg?.prazo_medio_dias ?? null,
    // RN-INT-15 (Conector 1.5.0): % de ajuste do prazo, só informativo; preço e total já vêm ajustados do Hub e não são recalculados
    pagamento_percentual_ajuste: pg?.percentual_ajuste ?? null,
  };
}

async function gravar(ctx: Contexto, cfg: PedidosConfig, local: PedidoLocal, r: ResultadoPedidos): Promise<void> {
  const { store, log } = ctx;
  const agora = () => ctx.relogio.agora();
  const lido = lerPedidoLocal(local.payload);
  if (!lido.ok) {
    // T-0048 (RN-INT-08): um pedido fora do contrato não pode interromper a gravação dos seguintes. Vai como `rejeitado_erp` com
    // os CAMPOS que falharam (nunca os valores: podem ter dado pessoal) e o ciclo segue para o próximo.
    const motivo = `pedido fora do contrato PedidoParaErp (${lido.campos}); o pedido não foi gravado no ERP`.slice(0, 300);
    store.atualizarPedido(local.pedidoUuid, { estado: 'rejeitado_erp', final: true, erro: motivo }, agora());
    enfileirar(ctx, r, local.pedidoUuid, 'rejeitado_erp', { status: 'rejeitado_erp', motivo, ocorrido_em: iso(agora()) });
    r.rejeitados++;
    log.erro('pedido_fora_do_contrato', { pedido_uuid: local.pedidoUuid, campos: lido.campos });
    return;
  }
  const pedido = lido.pedido;
  try {
    // Janela "commit aplicado, resposta perdida": se já houve tentativa (falha de SQL) ou o último erro foi de conexão (erro de
    // conexão não conta tentativa, mas deixa `erro` preenchido), o ERP pode já ter o pedido. Pergunta ANTES de gravar; se houver
    // número, só confirma. Não depende de o SQL do cliente ter IF NOT EXISTS (defesa em profundidade, não substitui).
    if (local.tentativas > 0 || local.erro !== null) {
      const existente = numeroGravado(await ctx.erp.consultar(cfg.gravacao.numeroErp, { pedido_uuid: pedido.pedido_uuid }));
      if (existente !== null) {
        confirmarGravacao(ctx, r, pedido.pedido_uuid, existente);
        log.aviso('pedido_ja_existia_no_erp', { pedido_uuid: pedido.pedido_uuid, numero_erp: existente, dica: 'uma tentativa anterior gravou e a resposta se perdeu; nada foi gravado de novo' });
        return;
      }
    }
    const numero = await ctx.erp.transacao(async (tx) => {
      await tx.executar(cfg.gravacao.cabecalho, parametrosCabecalho(pedido));
      if (cfg.gravacao.itens) {
        for (const it of pedido.itens) {
          await tx.executar(cfg.gravacao.itens, { pedido_uuid: pedido.pedido_uuid, sequencia: it.sequencia, produto_external_id: it.produto_external_id, quantidade: it.quantidade, preco_unitario_cents: it.preco_unitario_cents, desconto_cents: it.desconto_cents, total_cents: it.total_cents });
        }
      }
      const n = numeroGravado(await tx.consultar(cfg.gravacao.numeroErp, { pedido_uuid: pedido.pedido_uuid }));
      if (n === null) throw new ErroRegraErp('o ERP não devolveu o número do pedido gravado (consulta numeroErp sem resultado)');
      return n;
    });
    confirmarGravacao(ctx, r, pedido.pedido_uuid, numero);
    log.info('pedido_gravado_no_erp', { pedido_uuid: pedido.pedido_uuid, numero_erp: numero });
  } catch (e) {
    const motivo = mascararTexto(resumoErro(e));
    if (ehErroDeConexao(e)) {
      store.atualizarPedido(pedido.pedido_uuid, { proximaMs: espera(ctx, Math.max(1, local.tentativas + 1)), erro: motivo }, agora());
      log.aviso('pedido_adiado_erp_indisponivel', { pedido_uuid: pedido.pedido_uuid });
      throw e;
    }
    const tentativas = local.tentativas + 1;
    if (tentativas >= cfg.maxTentativasGravacao) {
      store.atualizarPedido(pedido.pedido_uuid, { estado: 'rejeitado_erp', final: true, tentativas, erro: motivo }, agora());
      enfileirar(ctx, r, pedido.pedido_uuid, 'rejeitado_erp', { status: 'rejeitado_erp', motivo: motivo.slice(0, 300) || 'o ERP recusou o pedido', ocorrido_em: iso(agora()) });
      r.rejeitados++;
      log.erro('pedido_rejeitado_pelo_erp', { pedido_uuid: pedido.pedido_uuid, tentativas, motivo });
    } else {
      store.atualizarPedido(pedido.pedido_uuid, { tentativas, proximaMs: espera(ctx, tentativas), erro: motivo }, agora());
      log.aviso('pedido_falhou_ao_gravar', { pedido_uuid: pedido.pedido_uuid, tentativas, motivo });
    }
  }
}

class ErroRegraErp extends Error {}

/**
 * T-0114: executa no ERP o cancelamento recebido do Hub (view/procedure `pedidos.cancelamento.executar`) e confirma com o retorno
 * `cancelado`. Pedido que nunca chegou a ser gravado no ERP (ainda `recebido`) não chama o ERP: só é encerrado e confirmado.
 * Erro de CONEXÃO não conta tentativa; erro do SQL conta e, esgotadas as tentativas, o cancelamento fica `falhou` no log e no status
 * (o pedido continua vivo no ERP; o operador resolve lá). O Conector então envia o retorno `cancelamento_recusado` com o motivo (já mascarado) para o monitor do BKO alertar.
 */
export async function executarCancelamentos(ctx: Contexto, cfg: PedidosConfig, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const abertos = ctx.store.cancelamentosAbertos(ctx.relogio.agora());
  if (abertos.length === 0) return r;
  if (!cfg.cancelamento) {
    ctx.log.aviso('cancelamento_sem_configuracao', { pendentes: abertos.length, dica: 'o Hub entregou cancelamentos, mas pedidos.cancelamento.executar não está configurado; nada foi escrito no ERP' });
    return r;
  }
  const agora = () => ctx.relogio.agora();
  for (const c of abertos) {
    const dados = JSON.parse(c.payload) as { numero_erp?: string | null; motivo?: string | null; cancelado_em: string };
    const local = ctx.store.pedido(c.pedidoUuid);
    if (local?.estado === 'cancelado') {
      ctx.store.atualizarCancelamento(c.pedidoUuid, { estado: 'confirmado', final: true }, agora());
      enfileirar(ctx, r, c.pedidoUuid, 'cancelado', { status: 'cancelado', numero_erp: local.numeroErp ?? undefined, motivo: dados.motivo?.slice(0, 300), ocorrido_em: iso(agora()) });
      continue;
    }
    if (local?.estado === 'rejeitado_erp') {
      ctx.store.atualizarCancelamento(c.pedidoUuid, { estado: 'dispensado', final: true, erro: 'o ERP já havia rejeitado o pedido' }, agora());
      continue;
    }
    try {
      if (local && local.estado !== 'recebido') {
        await ctx.erp.transacao(async (tx) => {
          await tx.executar((cfg.cancelamento as { executar: string }).executar, {
            pedido_uuid: c.pedidoUuid,
            numero_erp: dados.numero_erp ?? local.numeroErp ?? null,
            motivo: dados.motivo ?? null,
            cancelado_em: new Date(dados.cancelado_em),
          });
        });
      }
      ctx.store.atualizarCancelamento(c.pedidoUuid, { estado: 'confirmado', final: true, erro: null }, agora());
      if (local) ctx.store.atualizarPedido(c.pedidoUuid, { estado: 'cancelado', final: true }, agora());
      enfileirar(ctx, r, c.pedidoUuid, 'cancelado', { status: 'cancelado', numero_erp: local?.numeroErp ?? dados.numero_erp ?? undefined, motivo: dados.motivo?.slice(0, 300), ocorrido_em: iso(agora()) });
      ctx.log.info('cancelamento_executado_no_erp', { pedido_uuid: c.pedidoUuid, chamou_erp: Boolean(local && local.estado !== 'recebido') });
    } catch (e) {
      const motivo = mascararTexto(resumoErro(e));
      if (ehErroDeConexao(e)) {
        ctx.store.atualizarCancelamento(c.pedidoUuid, { proximaMs: espera(ctx, Math.max(1, c.tentativas + 1)), erro: motivo }, agora());
        ctx.log.aviso('cancelamento_adiado_erp_indisponivel', { pedido_uuid: c.pedidoUuid });
        throw e;
      }
      const tentativas = c.tentativas + 1;
      if (tentativas >= cfg.maxTentativasGravacao) {
        ctx.store.atualizarCancelamento(c.pedidoUuid, { estado: 'falhou', final: true, tentativas, erro: motivo }, agora());
        // T-0114: avisa o Hub (aditivo na v1) para o monitor do BKO mostrar a recusa; Hub antigo recusaria o status novo (422) e o retorno fica na fila local
        enfileirar(ctx, r, c.pedidoUuid, 'cancelamento_recusado', { status: 'cancelamento_recusado', numero_erp: local?.numeroErp ?? dados.numero_erp ?? undefined, motivo: motivo.slice(0, 300) || 'o ERP recusou o cancelamento', ocorrido_em: iso(agora()) });
        ctx.log.erro('cancelamento_falhou_no_erp', { pedido_uuid: c.pedidoUuid, tentativas, motivo, dica: 'o pedido continua ativo no ERP; cancele por lá ou corrija a procedure e peça novo cancelamento' });
      } else {
        ctx.store.atualizarCancelamento(c.pedidoUuid, { tentativas, proximaMs: espera(ctx, tentativas), erro: motivo }, agora());
        ctx.log.aviso('cancelamento_falhou_ao_executar', { pedido_uuid: c.pedidoUuid, tentativas, motivo });
      }
    }
  }
  return r;
}

/** Lê o pedido guardado na fila local pelo contrato; na falha devolve só os caminhos dos campos (sem valores). */
function lerPedidoLocal(payload: string): { ok: true; pedido: PedidoParaErp } | { ok: false; campos: string } {
  let bruto: unknown;
  try {
    bruto = JSON.parse(payload);
  } catch {
    return { ok: false, campos: 'JSON ilegível' };
  }
  const v = PedidoParaErp.safeParse(bruto);
  if (v.success) return { ok: true, pedido: v.data };
  const campos = [...new Set(v.error.issues.map((i) => i.path.join('.') || '(raiz)'))].slice(0, 10).join(', ');
  return { ok: false, campos };
}

/** Número do pedido no ERP a partir da consulta `numeroErp` (primeira linha, coluna `numero_erp`); `null` se não houver. */
function numeroGravado(linhas: Linha[]): string | null {
  const n = col(linhas[0], 'numero_erp');
  if (n === undefined || n === null || String(n).trim() === '') return null;
  return String(n).trim().slice(0, 40);
}

/** Pedido está no ERP: anota `gravado` e põe `integrado` (com o número) na fila de retornos ao Hub. */
function confirmarGravacao(ctx: Contexto, r: ResultadoPedidos, uuid: string, numero: string): void {
  const agora = ctx.relogio.agora();
  ctx.store.atualizarPedido(uuid, { estado: 'gravado', numeroErp: numero, erro: null }, agora);
  enfileirar(ctx, r, uuid, 'integrado', { status: 'integrado', numero_erp: numero, ocorrido_em: iso(agora) });
  r.gravados++;
}

/** Lê coluna sem diferenciar maiúsculas. */
function col(linha: Linha | undefined, nome: string): unknown {
  if (!linha) return undefined;
  if (nome in linha) return linha[nome];
  const alvo = nome.toLowerCase();
  for (const k of Object.keys(linha)) if (k.toLowerCase() === alvo) return linha[k];
  return undefined;
}

type CorpoRetorno = Omit<RetornoParaHub, 'versao_contrato' | 'pedido_uuid'>;

/** Valida pelo contrato `RetornoErp` e põe na fila de retornos (assinatura evita duplicar o mesmo fato). */
function enfileirar(ctx: Contexto, r: ResultadoPedidos, uuid: string, assinatura: string, corpo: CorpoRetorno): boolean {
  const completo = { versao_contrato: VERSAO_CONTRATO, pedido_uuid: uuid, ...corpo };
  const v = RetornoErp.safeParse(completo);
  if (!v.success) {
    ctx.log.aviso('retorno_invalido_nao_enviado', { pedido_uuid: uuid, status: corpo.status, problemas: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    return false;
  }
  const novo = ctx.store.enfileirarRetorno(uuid, assinatura, JSON.stringify(completo), ctx.relogio.agora());
  if (novo) r.retornosEnfileirados++;
  return novo;
}

const texto = (v: unknown): string | undefined => (v === null || v === undefined || String(v).trim() === '' ? undefined : String(v).trim());
const dataIso = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(typeof v === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/i.test(v) ? `${v.replace(' ', 'T')}Z` : (v as string | number));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

interface FatoStatus {
  linha: Linha;
  status: 'integrado' | 'rejeitado_erp' | 'faturado_parcial' | 'faturado_total' | 'cancelado';
  nota?: string;
  serie?: string;
  emitidaEm?: string;
}

/**
 * Cada linha da consulta de status descreve um fato do pedido (integração, uma nota, cancelamento). Como o `status` do ERP
 * costuma ser do PEDIDO, só a última nota pode ser `faturado_total`; as anteriores contam como `faturado_parcial`.
 * Ordem de envio: integrado → notas (da mais antiga à mais nova) → cancelado/rejeitado.
 */
function fatosDoStatus(cfg: PedidosConfig, linhas: Linha[]): FatoStatus[] {
  const fatos: FatoStatus[] = [];
  for (const linha of linhas) {
    const codigo = texto(col(linha, 'status'));
    const status = codigo === undefined ? undefined : cfg.status.mapaStatus[codigo];
    if (!status) continue; // situação do ERP sem equivalente no contrato (ex.: "em separação"): nada a informar
    fatos.push({ linha, status, nota: texto(col(linha, 'nota_numero')), serie: texto(col(linha, 'nota_serie')), emitidaEm: dataIso(col(linha, 'nota_emitida_em')) });
  }
  const ehNota = (f: FatoStatus) => (f.status === 'faturado_parcial' || f.status === 'faturado_total') && f.nota !== undefined;
  const notas = fatos.filter(ehNota).sort((a, b) => (a.emitidaEm ?? '').localeCompare(b.emitidaEm ?? '') || (a.nota ?? '').localeCompare(b.nota ?? '', 'pt', { numeric: true }));
  notas.slice(0, -1).forEach((f) => (f.status = 'faturado_parcial'));
  const unicas = new Map<string, FatoStatus>();
  for (const f of notas) unicas.set(`${f.nota}|${f.serie ?? ''}`, f); // a mesma nota repetida em várias linhas conta uma vez
  const outros = fatos.filter((f) => !ehNota(f));
  return [...outros.filter((f) => f.status === 'integrado'), ...unicas.values(), ...outros.filter((f) => f.status !== 'integrado')];
}

/** Assinatura do fato na fila de retornos: o mesmo fato nunca entra duas vezes (RN-INT-08, idempotência por pedido+status+nota). */
const assinaturaDoFato = (status: FatoStatus['status'], nota?: string, serie?: string): string =>
  status === 'integrado' || status === 'cancelado' || status === 'rejeitado_erp' ? status : `${status}|${nota ?? ''}|${serie ?? ''}`;

/**
 * A nota já foi para a fila de retornos com outro status (qualquer `faturado_*`)? Então os itens dela já saíram uma vez.
 * T-0048 (🔴 da revisão da T-0023): o ERP fecha o pedido sem nota nova e a última nota, já enviada como `faturado_parcial`, volta
 * como `faturado_total`; esse fechamento vai com a mesma nota e SEM `itens_faturados`, senão o Hub somaria os itens de novo.
 */
function notaJaRetornada(ctx: Contexto, uuid: string, nota: string, serie: string | undefined): boolean {
  return (['faturado_parcial', 'faturado_total'] as const).some((s) => ctx.store.retornoExiste(uuid, assinaturaDoFato(s, nota, serie)));
}

export async function acompanharStatus(ctx: Contexto, cfg: PedidosConfig, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const abertos = ctx.store.pedidosPorEstado(['gravado', 'faturado_parcial'], ctx.relogio.agora());
  for (const local of abertos) {
    const linhas = await ctx.erp.consultar(cfg.status.consulta, { pedido_uuid: local.pedidoUuid });
    for (const fato of fatosDoStatus(cfg, linhas)) {
      const { linha, status, nota, serie } = fato;
      const assinatura = assinaturaDoFato(status, nota, serie);
      if (ctx.store.retornoExiste(local.pedidoUuid, assinatura)) continue;
      const corpo: CorpoRetorno = {
        status,
        numero_erp: texto(col(linha, 'numero_erp')) ?? local.numeroErp ?? undefined,
        motivo: texto(col(linha, 'motivo'))?.slice(0, 300),
        ocorrido_em: dataIso(col(linha, 'ocorrido_em')) ?? iso(ctx.relogio.agora()),
      };
      if ((status === 'faturado_parcial' || status === 'faturado_total') && nota) {
        const total = Number(col(linha, 'nota_total_cents'));
        corpo.nota = { numero: nota, serie, emitida_em: fato.emitidaEm ?? corpo.ocorrido_em, total_cents: Number.isFinite(total) ? Math.max(0, Math.round(total)) : 0 };
        if (notaJaRetornada(ctx, local.pedidoUuid, nota, serie)) {
          // fechamento sem nota nova: só o status muda; os itens desta nota já foram (RN-INT-08)
          ctx.log.info('fechamento_sem_nota_nova', { pedido_uuid: local.pedidoUuid, status, nota });
        } else {
          const itens = cfg.status.consultaItensNota ? await itensDaNota(ctx, cfg, local.pedidoUuid, nota, serie) : undefined;
          if (itens) corpo.itens_faturados = itens;
        }
      }
      if (enfileirar(ctx, r, local.pedidoUuid, assinatura, corpo)) {
        ctx.store.atualizarPedido(local.pedidoUuid, { estado: status === 'integrado' ? 'gravado' : status, final: FINAIS.has(status), numeroErp: corpo.numero_erp ?? local.numeroErp }, ctx.relogio.agora());
      }
    }
  }
  return r;
}

/**
 * Itens faturados NESTA nota (RN-INT-08): colunas OBRIGATÓRIAS `sequencia`, `quantidade` (inteiros > 0), `valor_cents` (centavos
 * inteiros >= 0) e `produto_external_id` (chave do produto no ERP; decisão do Alexandre na T-0023). Linhas da mesma sequência somam
 * (o ERP pode partir o item em lotes) e devem trazer o mesmo produto. Nunca inventa valor nem produto: se qualquer linha vier sem
 * um deles ou fora do formato, o retorno segue SEM `itens_faturados` (campo opcional do retorno) e o aviso `itens_faturados_omitidos`
 * traz o motivo e a linha, para o operador corrigir a consulta `consultaItensNota`.
 */
async function itensDaNota(ctx: Contexto, cfg: PedidosConfig, uuid: string, nota: string, serie: string | undefined): Promise<ItemFaturado[] | undefined> {
  const linhas = await ctx.erp.consultar(cfg.status.consultaItensNota as string, { pedido_uuid: uuid, nota_numero: nota, nota_serie: serie ?? null });
  const porSequencia = new Map<number, ItemFaturado>();
  const invalida = (indice: number, motivo: string): undefined => {
    ctx.log.aviso('itens_faturados_omitidos', { pedido_uuid: uuid, nota, linha: indice + 1, motivo });
    return undefined;
  };
  for (const [i, l] of linhas.entries()) {
    const sequencia = Number(col(l, 'sequencia'));
    const quantidade = Number(col(l, 'quantidade'));
    if (!Number.isInteger(sequencia) || sequencia < 1) return invalida(i, 'sequencia ausente ou inválida (esperado inteiro > 0, a sequência do pedido enviado)');
    if (!Number.isInteger(quantidade) || quantidade < 1) return invalida(i, 'quantidade ausente ou fora do esperado (inteiro > 0, faturado nesta nota)');
    const bruto = col(l, 'valor_cents');
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') return invalida(i, 'valor_cents ausente: a consulta de itens da nota deve devolver o valor faturado do item em centavos');
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor < 0) return invalida(i, 'valor_cents deve ser inteiro em centavos, >= 0');
    const produto = texto(col(l, 'produto_external_id'));
    if (!produto) return invalida(i, 'produto_external_id ausente: a consulta de itens da nota deve devolver o código do produto no ERP');
    const atual = porSequencia.get(sequencia);
    if (atual) {
      if (atual.produto_external_id !== produto) return invalida(i, `sequencia ${sequencia} com produtos diferentes na mesma nota`);
      atual.quantidade += quantidade;
      atual.valor_cents += valor;
    } else {
      porSequencia.set(sequencia, { sequencia, produto_external_id: produto, quantidade, valor_cents: valor });
    }
  }
  return porSequencia.size > 0 ? [...porSequencia.values()].sort((a, b) => a.sequencia - b.sequencia) : undefined;
}

export async function enviarRetornos(ctx: Contexto, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const { store, log } = ctx;
  for (const ret of store.retornosProntos(ctx.relogio.agora())) {
    try {
      const resp = await ctx.hub.enviarRetorno(ret.pedidoUuid, JSON.parse(ret.corpo) as RetornoParaHub);
      if (resp.tipo === 'aceito') {
        store.atualizarRetorno(ret.id, { estado: 'enviado', erro: null });
        r.retornosEnviados++;
        log.info('retorno_enviado', { pedido_uuid: ret.pedidoUuid, assinatura: ret.assinatura.split('|')[0], repetido: resp.aceito.repetido });
      } else {
        store.atualizarRetorno(ret.id, { estado: 'recusado', erro: `${resp.codigo}: ${resp.mensagem}`.slice(0, 300) });
        r.retornosRecusados++;
        log.erro('retorno_recusado_pelo_hub', { pedido_uuid: ret.pedidoUuid, status_http: resp.status, codigo: resp.codigo, mensagem: resp.mensagem });
      }
    } catch (e) {
      if (e instanceof ErroHubTransitorio || e instanceof ErroHubVersao) {
        // Hub fora ou 426 (versão abaixo da mínima, T-0027): o retorno espera na fila local; nunca vira "recusado"
        tratarRecusaPorVersao(ctx, e, 'enviar_retorno');
        const t = ret.tentativas + 1;
        store.atualizarRetorno(ret.id, { tentativas: t, proximaMs: esperaHub(ctx, t, e), erro: resumoErro(e) });
        r.erro = resumoErro(e);
        return r; // Hub fora: os demais também falhariam
      }
      throw e;
    }
  }
  return r;
}
