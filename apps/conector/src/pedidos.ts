/**
 * Retorno de pedidos ao ERP (RF-INT-02, RN-INT-08).
 *
 *  Hub ──GET /pedidos/pendentes──► Conector ──SQL configurável──► ERP (tabela de entrada/procedure, numa transação)
 *   ▲                                   │ guarda o pedido localmente ANTES de gravar (idempotente pelo pedido_uuid)
 *   └──POST /pedidos/{uuid}/retorno─────┘ `integrado` (nº do ERP) | `rejeitado_erp` (motivo)
 *  Depois, a cada ciclo de status, consulta o ERP por pedido aberto e informa `faturado_parcial` (uma nota por vez, com itens
 *  faturados quando a consulta existir), `faturado_total` e `cancelado` (o Macuxi nunca escreve cancelamento no ERP).
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
import { ErroHubAutenticacao, ErroHubTransitorio } from './hub/cliente';
import type { RetornoParaHub } from './hub/tipos';
import { bloqueioPorVersao } from './politica';
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
      else ctx.log.aviso('etapa_pedidos_interrompida', { etapa: nome, erro: resumoErro(e) });
    }
  };
  if (partes.buscar) await etapa('buscar', () => buscarPedidos(ctx, r));
  await etapa('gravar', () => gravarPedidos(ctx, cfg, r));
  if (partes.status) await etapa('status', () => acompanharStatus(ctx, cfg, r));
  await etapa('retornos', () => enviarRetornos(ctx, r));
  return r;
}

export async function buscarPedidos(ctx: Contexto, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const { pedidos } = await ctx.hub.pedidosPendentes();
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

async function gravar(ctx: Contexto, cfg: PedidosConfig, local: PedidoLocal, r: ResultadoPedidos): Promise<void> {
  const { store, log } = ctx;
  const agora = () => ctx.relogio.agora();
  const pedido = PedidoParaErp.parse(JSON.parse(local.payload));
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
      await tx.executar(cfg.gravacao.cabecalho, {
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
      });
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

export async function acompanharStatus(ctx: Contexto, cfg: PedidosConfig, r: ResultadoPedidos = novoResultado()): Promise<ResultadoPedidos> {
  const abertos = ctx.store.pedidosPorEstado(['gravado', 'faturado_parcial'], ctx.relogio.agora());
  for (const local of abertos) {
    const linhas = await ctx.erp.consultar(cfg.status.consulta, { pedido_uuid: local.pedidoUuid });
    for (const fato of fatosDoStatus(cfg, linhas)) {
      const { linha, status, nota, serie } = fato;
      const assinatura = status === 'integrado' ? 'integrado' : status === 'cancelado' || status === 'rejeitado_erp' ? status : `${status}|${nota ?? ''}|${serie ?? ''}`;
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
        const itens = cfg.status.consultaItensNota ? await itensDaNota(ctx, cfg, local.pedidoUuid, nota, serie) : undefined;
        if (itens) corpo.itens_faturados = itens;
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
      if (e instanceof ErroHubTransitorio) {
        const t = ret.tentativas + 1;
        store.atualizarRetorno(ret.id, { tentativas: t, proximaMs: espera(ctx, t), erro: resumoErro(e) });
        r.erro = resumoErro(e);
        return r; // Hub fora: os demais também falhariam
      }
      throw e;
    }
  }
  return r;
}
