/**
 * Estado local da Pesquisa no aparelho (offline-first, RF-PES-03/04): linhas do pull (`questionario_versao`,
 * `resposta_pesquisa`), clientes do Core (segmento, para o público-alvo) e a fila do motor (respostas ainda não
 * enviadas ou aceitas e não puxadas). Guarda um retrato em memória para o `concluida()` da etapa do checkout, que
 * o Core chama de forma síncrona (RN-PES-03). Sem retrato carregado, a etapa fica PENDENTE (falha fechada).
 */
import type { ClienteSync, ContextoCheckout, ContextoCliente } from '@macuxi/core/contracts';
import type { ItemSobreposicao, LinhaSync } from '@macuxi/platform-sdk';
import { RespostaEnvio, type QuestionarioVersaoSync, type RespostaPesquisaSync } from '../../contracts';
import { avaliarEtapaCheckout, clienteFechadoNoContexto, haPesquisaDisponivel, montarPesquisasDoAparelho, respostasConhecidas, type ClienteAlvo, type PesquisaDoTenant, type ResultadoEtapaCheckout, type UsuarioAlvo } from '../../domain';

/** O que o motor oferece (subconjunto estrutural de `MotorSync`). */
export interface LeitorLocal {
  linhas<L extends LinhaSync = LinhaSync>(entidade: string): Promise<L[]>;
  sobreposicao(entidades?: readonly string[]): readonly ItemSobreposicao[];
}

export interface RetratoPesquisa {
  pesquisas: PesquisaDoTenant[];
  respostasPull: RespostaPesquisaSync[];
  clientes: ReadonlyMap<string, ClienteAlvo>;
}

export const RETRATO_VAZIO: RetratoPesquisa = { pesquisas: [], respostasPull: [], clientes: new Map() };

/** Lê as linhas locais (SQLite) e monta o retrato. Entidade sem linhas = lista vazia. */
export async function lerRetrato(motor: Pick<LeitorLocal, 'linhas'>): Promise<RetratoPesquisa> {
  const [versoes, respostas, clientes] = await Promise.all([
    motor.linhas<QuestionarioVersaoSync & LinhaSync>('questionario_versao'),
    motor.linhas<RespostaPesquisaSync & LinhaSync>('resposta_pesquisa'),
    motor.linhas<ClienteSync & LinhaSync>('cliente').catch(() => [] as (ClienteSync & LinhaSync)[]),
  ]);
  const mapa = new Map<string, ClienteAlvo>();
  // Premissa T-0057: o cliente do Core ainda não tem "região". T-0115/RN-PES-05: o canal vem da linha local do cliente (offline).
  for (const c of clientes) if (!c.deleted_at) mapa.set(c.id, { id: c.id, segmento: c.segmento, regiao: null, canal: c.canal ?? null });
  return { pesquisas: montarPesquisasDoAparelho(versoes), respostasPull: respostas.filter((r) => !r.deleted_at), clientes: mapa };
}

/** Respostas da fila do motor (pendentes, com falha ou aceitas ainda não puxadas). */
export function respostasDaFila(itens: readonly ItemSobreposicao[]): RespostaEnvio[] {
  const saida: RespostaEnvio[] = [];
  for (const i of itens) {
    if (i.entidade !== 'resposta_pesquisa' || i.operacao !== 'upsert') continue;
    const p = RespostaEnvio.safeParse(i.payload);
    if (p.success) saida.push(p.data);
  }
  return saida;
}

export interface EntradaCheckoutLocal {
  retrato: RetratoPesquisa;
  fila: readonly RespostaEnvio[];
  usuario: UsuarioAlvo;
  contexto: Pick<ContextoCheckout, 'clienteId' | 'visitaId' | 'clienteFechado' | 'motivoClienteFechado'>;
  agora: string;
  fuso: string;
}

/** RN-PES-03 / RN-CORE-14: a etapa do checkout desta visita, sobre o que o aparelho sabe. */
export function avaliarCheckoutLocal(e: EntradaCheckoutLocal): ResultadoEtapaCheckout {
  return avaliarEtapaCheckout({
    pesquisas: e.retrato.pesquisas,
    usuario: e.usuario,
    cliente: e.retrato.clientes.get(e.contexto.clienteId) ?? { id: e.contexto.clienteId, segmento: null, regiao: null },
    visita_id: e.contexto.visitaId,
    agora: e.agora,
    respostas: respostasConhecidas({ linhas: e.retrato.respostasPull, fila: e.fila, usuario_id: e.usuario.id }),
    fuso: e.fuso,
    cliente_fechado: clienteFechadoNoContexto(e.contexto),
  });
}

// ---------- retrato em memória para o `concluida()` síncrono ----------

interface EstadoMemoria {
  retrato: RetratoPesquisa;
  leitor: Pick<LeitorLocal, 'sobreposicao'>;
  usuario: UsuarioAlvo;
  fuso: string;
  agora: () => Date;
}

let memoria: EstadoMemoria | null = null;
const ouvintes = new Set<() => void>();

export function definirEstadoLocal(e: EstadoMemoria | null): void {
  memoria = e;
  for (const f of ouvintes) f();
}

export function estadoLocal(): EstadoMemoria | null {
  return memoria;
}

export function assinarEstadoLocal(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

/** Resultado da etapa no contexto do checkout; `null` enquanto o retrato não foi carregado. */
export function etapaDoCheckout(ctx: Pick<ContextoCheckout, 'clienteId' | 'visitaId' | 'clienteFechado' | 'motivoClienteFechado'>): ResultadoEtapaCheckout | null {
  if (!memoria) return null;
  return avaliarCheckoutLocal({
    retrato: memoria.retrato,
    fila: respostasDaFila(memoria.leitor.sobreposicao(['resposta_pesquisa'])),
    usuario: memoria.usuario,
    contexto: ctx,
    agora: memoria.agora().toISOString(),
    fuso: memoria.fuso,
  });
}

/**
 * `EtapaCheckout.concluida` (RN-CORE-12): cliente fechado dispensa (RN-CORE-14); sem retrato carregado, pendente
 * (falha fechada: nunca libera o checkout sem saber se há pesquisa obrigatória).
 */
export function etapaConcluida(ctx: Pick<ContextoCheckout, 'clienteId' | 'visitaId' | 'clienteFechado' | 'motivoClienteFechado'>): boolean {
  if (clienteFechadoNoContexto(ctx)) return true;
  return etapaDoCheckout(ctx)?.concluida ?? false;
}

/**
 * `disponivel` do slot `cliente.abas` (RF-PES-03): o botão "Pesquisa" da ficha só aparece com pesquisa para responder
 * neste cliente. Síncrono, sobre o retrato em memória e a fila do motor (offline). Sem retrato carregado, não aparece.
 */
export function pesquisaDisponivelNoCliente(ctx: Pick<ContextoCliente, 'clienteId' | 'visitaId'>): boolean {
  if (!memoria) return false;
  const usuario = memoria.usuario;
  return haPesquisaDisponivel({
    pesquisas: memoria.retrato.pesquisas,
    usuario,
    cliente: memoria.retrato.clientes.get(ctx.clienteId) ?? { id: ctx.clienteId, segmento: null, regiao: null },
    visita_id: ctx.visitaId,
    agora: memoria.agora().toISOString(),
    respostas: respostasConhecidas({ linhas: memoria.retrato.respostasPull, fila: respostasDaFila(memoria.leitor.sobreposicao(['resposta_pesquisa'])), usuario_id: usuario.id }),
    fuso: memoria.fuso,
  });
}
