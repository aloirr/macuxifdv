/**
 * Apoio dos testes da API do Promotor (só testes): contexto de rota falso com transação que valida e guarda os eventos
 * publicados e os arquivos registrados, relógio do teste (`@macuxi/comum/relogio`) e coletas válidas pelo contrato.
 * O pipeline real (login, licença, perfil, Zod, carteira) é do `createApp` (apps/api); aqui se testa o que o módulo faz.
 */
import type { RelogioDeTeste } from '@macuxi/comum/relogio';
import type { ContextoBase, ContextoRota, NovoArquivo, Perfil, TransacaoTenant } from '@macuxi/platform-sdk';
import type { z } from 'zod';
import type { ChecklistResposta, ColetaPreco, FotoColeta, GondolaRegistro, MedicaoShare, RupturaItem, TarefaExecucao, VisitaLoja } from '../contracts';

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const T1 = uuid(0xa1);
export const T2 = uuid(0xa2);
export const PROMOTOR = uuid(0xb1);
export const OUTRO_PROMOTOR = uuid(0xb2);
export const SUPERVISOR = uuid(0xb3);
export const LOJA = uuid(0xc1);
export const LOJA_FORA = uuid(0xc2);
export const VISITA_CORE = uuid(0xd1);
export const CATEGORIA = uuid(0xe1);
export const PRODUTO = uuid(0xe2);
export const MIX = uuid(0xe3);
export const META = uuid(0xe4);

/** Cadastro do Core visto pela consulta `core.cadastro_resumo@1` nos testes. */
export const NOMES_LOJA: Readonly<Record<string, string>> = { [LOJA]: 'Mercado Bom Preço' };

export interface EventoPublicado {
  nome: string;
  payload: unknown;
  agregado: string | null | undefined;
}

export interface CtxTeste {
  ctx: ContextoBase;
  eventos: EventoPublicado[];
  arquivos: NovoArquivo[];
  /** Contexto de rota com corpo/query/params (para chamar `rota.executar`). */
  rota<C = unknown, Q = unknown, P = unknown>(e: { corpo?: C; query?: Q; params?: P }): ContextoRota<C, Q, P>;
}

export function criarCtx(relogio: RelogioDeTeste, op: { tenant?: string; usuario?: string; perfil?: Perfil; carteira?: ReadonlySet<string> | 'tenant'; usuarios?: ReadonlySet<string> | 'tenant'; parametros?: Record<string, unknown> } = {}): CtxTeste {
  const eventos: EventoPublicado[] = [];
  const arquivos: NovoArquivo[] = [];
  const tx: TransacaoTenant = {
    async publicar(def, payload, agregadoId) {
      const p = (def.schema as z.ZodTypeAny).parse(payload);
      eventos.push({ nome: def.nome, payload: p, agregado: agregadoId });
      return { evento_id: uuid(eventos.length), nome: def.nome, tenant_id: op.tenant ?? T1, ocorrido_em: relogio.agora().toISOString(), payload: p } as never;
    },
    async registrarArquivo(a) {
      arquivos.push(a);
      return { criado: true };
    },
    async consultar(def, entrada) {
      if (def.nome !== 'core.cadastro_resumo@1') throw new Error(`consulta ${def.nome} não usada pelo Promotor`);
      const ids = (entrada as { cliente_ids?: string[] }).cliente_ids ?? [];
      const clientes = ids.filter((id) => NOMES_LOJA[id]).map((id) => ({ id, razao_social: `${NOMES_LOJA[id]} Ltda`, nome_fantasia: NOMES_LOJA[id]!, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null }));
      return { clientes, produtos: [], usuarios: [] } as never;
    },
    async auditar() {},
  };
  const db = { query: async () => ({ rows: [], rowCount: 0 }) };
  const ctx: ContextoBase = {
    usuario: { id: op.usuario ?? PROMOTOR, tenant_id: op.tenant ?? T1, perfil: op.perfil ?? 'promotor', modulos: ['core', 'promotor'] },
    dependencias: {},
    requestId: 'req-teste',
    agora: () => relogio.agora(),
    comTenant: (fn) => fn(db, tx),
    carteira: async () => op.carteira ?? new Set([LOJA]),
    usuariosVisiveis: async () => op.usuarios ?? new Set([op.usuario ?? PROMOTOR]),
    parametros: () => op.parametros ?? {},
    fuso: () => relogio.fuso,
    log: { info() {}, warn() {}, error() {} },
  };
  return { ctx, eventos, arquivos, rota: (e) => ({ ...ctx, corpo: e.corpo as never, query: e.query as never, params: e.params as never }) };
}

/** Coletas válidas pelo contrato, com instantes relativos ao check-in (minutos). */
export function fabrica(relogio: RelogioDeTeste) {
  const em = (min: number) => relogio.relativo({ minutos: min }).toISOString();
  let seq = 0x100;
  const novo = () => uuid(++seq);
  return {
    em,
    novo,
    visita(id: string, extra: Partial<VisitaLoja> = {}): VisitaLoja {
      return { id, visita_id: VISITA_CORE, cliente_id: LOJA, checklist_modelo_id: null, checkin_em: em(0), checkout_em: null, permanencia_min: null, desfecho: null, foto_fachada_id: null, observacao: null, ...extra };
    },
    fechar(v: VisitaLoja, min: number, extra: Partial<VisitaLoja> = {}): VisitaLoja {
      return { ...v, checkout_em: em(min), permanencia_min: min, desfecho: 'realizada', ...extra };
    },
    foto(visita_loja_id: string, min = 5, extra: Partial<FotoColeta> = {}): FotoColeta {
      return { id: novo(), visita_loja_id, tipo: 'gondola_antes', origem: 'camera', tirada_em: em(min), latitude: -3.1, longitude: -60.02, sem_gps: false, arquivo_ref: null, enviada_em: null, ...extra };
    },
    gondola(visita_loja_id: string, antes: string, depois: string, min = 6): GondolaRegistro {
      return { id: novo(), visita_loja_id, categoria_gondola_id: CATEGORIA, foto_antes_id: antes, foto_depois_id: depois, foto_referencia_id: null, conformidade: 'conforme', motivo: null, registrado_em: em(min) };
    },
    share(visita_loja_id: string, nossas: number, total: number, min = 7, meta: number | null = 40): MedicaoShare {
      const share = total === 0 ? null : Math.round((nossas / total) * 10000) / 100;
      const ating = share === null || meta === null ? null : Math.round((share / meta) * 10000) / 100;
      return { id: novo(), visita_loja_id, categoria_gondola_id: CATEGORIA, frentes_nossas: nossas, frentes_total: total, cm_nossos: null, cm_total: null, share_pct: share, meta_share_id: meta === null ? null : META, meta_pct: meta, atingimento_pct: ating, medido_em: em(min) };
    },
    preco(visita_loja_id: string, preco_cents: number, anterior: number | null = null, confirmada = false, min = 8): ColetaPreco {
      return { id: novo(), visita_loja_id, produto_id: PRODUTO, concorrente_id: null, produto_concorrente_id: null, preco_cents, em_promocao: false, em_encarte: false, preco_promocional_cents: null, preco_nosso_ref_cents: null, indice_preco: null, preco_anterior_cents: anterior, variacao_confirmada: confirmada, coletado_em: em(min) };
    },
    ruptura(visita_loja_id: string, status: RupturaItem['status'], min = 9): RupturaItem {
      return { id: novo(), visita_loja_id, produto_id: PRODUTO, mix_obrigatorio_id: MIX, status, quantidade_reposta: 0, foto_id: null, registrado_em: em(min) };
    },
    resposta(visita_loja_id: string, item: string, obrigatoria: boolean, concluida: boolean, min = 10): ChecklistResposta {
      return { id: novo(), visita_loja_id, checklist_item_id: item, obrigatoria, concluida, respondido_em: em(min), valor: null, foto_id: null };
    },
    tarefa(visita_loja_id: string, fotos: string[], min = 11): TarefaExecucao {
      return { id: novo(), tarefa_trade_id: uuid(0xf1), visita_loja_id, cliente_id: LOJA, foto_ids: fotos, observacao: null, concluida_em: em(min) };
    },
  };
}
