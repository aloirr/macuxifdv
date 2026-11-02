/**
 * Recebimento das coletas (T-0056): regras que a API revalida em todo envio do aparelho — e que o app usa para
 * habilitar as telas. Funções puras, sem relógio e sem I/O (o instante vem da coleta).
 *  - RN-PRO-02: coleta só com check-in aberto. Offline-first: vale o instante da COLETA, não o da chegada; coleta feita
 *    com a visita aberta e enviada depois do checkout é aceita (janela check-in..checkout, inclusive);
 *  - doc 03 §2: só o promotor coleta; supervisor, gerente, analista e admin só leem;
 *  - RN-CORE-04: visita de loja de outro promotor não existe para quem envia (404, não revela);
 *  - RN-PRO-06: checkout de visita realizada exige as etapas obrigatórias do checklist concluídas;
 *  - idempotência: reenvio com o mesmo conteúdo é repetido; conteúdo diferente no mesmo id é conflito.
 * RN-PRO-01: nada aqui fala de pedido.
 */
import { avaliarCheckout, type DesfechoVisita } from './checklist';

/** Visita de loja como o servidor guarda (o `promotor_id` vem do token, não do aparelho). */
export interface VisitaLojaGuardada {
  id: string;
  visita_id: string;
  cliente_id: string;
  promotor_id: string;
  checklist_modelo_id: string | null;
  checkin_em: string;
  checkout_em: string | null;
  permanencia_min: number | null;
  desfecho: DesfechoVisita | null;
  foto_fachada_id: string | null;
  observacao: string | null;
}

/** Recusa de uma coleta: `http` orienta a rota REST; no push vira `rejeitado` com o `codigo`. */
export interface RecusaColeta {
  http: 403 | 404 | 409 | 422;
  codigo: string;
  mensagem: string;
}

export const PERFIS_QUE_COLETAM = ['promotor'] as const;

/** doc 03 §2: só o promotor registra coletas de trade. */
export function podeColetar(perfil: string): boolean {
  return (PERFIS_QUE_COLETAM as readonly string[]).includes(perfil);
}

/** RN-PRO-02: o instante da coleta está entre o check-in e o checkout da visita (inclusive; aberta = sem fim). */
export function coletaNaJanelaDaVisita(visita: { checkin_em: string; checkout_em: string | null }, instante: string): boolean {
  const t = Date.parse(instante);
  const ini = Date.parse(visita.checkin_em);
  if (Number.isNaN(t) || Number.isNaN(ini) || t < ini) return false;
  if (visita.checkout_em === null) return true;
  const fim = Date.parse(visita.checkout_em);
  return !Number.isNaN(fim) && t <= fim;
}

export const MENSAGEM_SEM_CHECKIN = 'Visita de loja não encontrada: faça o check-in na loja antes de registrar a coleta.';

/** Perfil (doc 03 §2), dono da visita (RN-CORE-04) e janela da visita (RN-PRO-02). `null` = coleta liberada. */
export function avaliarColeta(e: { perfil: string; usuario_id: string; visita: Pick<VisitaLojaGuardada, 'promotor_id' | 'checkin_em' | 'checkout_em'> | null; instante: string }): RecusaColeta | null {
  if (!podeColetar(e.perfil)) return { http: 403, codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Só o promotor registra coletas de trade.' };
  if (!e.visita || e.visita.promotor_id !== e.usuario_id) return { http: 404, codigo: 'VISITA_LOJA_NAO_ENCONTRADA', mensagem: MENSAGEM_SEM_CHECKIN };
  if (!coletaNaJanelaDaVisita(e.visita, e.instante)) {
    return { http: 422, codigo: 'RN-PRO-02', mensagem: 'A coleta precisa ser feita com o check-in aberto na loja (entre o check-in e o checkout).' };
  }
  return null;
}

/** Igualdade estrutural (chaves em qualquer ordem; listas na ordem). Base da idempotência do reenvio. */
export function mesmoConteudo(a: unknown, b: unknown): boolean {
  return normalizar(a) === normalizar(b);
}

function normalizar(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(normalizar).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${normalizar(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export type TransicaoVisitaLoja =
  | { tipo: 'nova'; concluida: boolean }
  | { tipo: 'checkout' }
  | { tipo: 'repetida' }
  | { tipo: 'conflito'; mensagem: string }
  | { tipo: 'recusa'; codigo: string; mensagem: string };

const CAMPOS_DO_CHECKIN = ['visita_id', 'cliente_id', 'checklist_modelo_id', 'checkin_em'] as const;

/**
 * Envio da visita de loja (mesmo id do aparelho): 1º envio cria (aberta ou já fechada, se o aparelho ficou offline a
 * visita inteira); aberta → fechada com os dados do check-in iguais = checkout; o mesmo conteúdo = repetido; qualquer
 * outra mudança (reabrir, mudar loja/horário, mudar um checkout já feito) = conflito.
 */
export function transicaoVisitaLoja(atual: VisitaLojaGuardada | null, nova: Omit<VisitaLojaGuardada, 'promotor_id'>, usuario_id: string): TransicaoVisitaLoja {
  if (!atual) return { tipo: 'nova', concluida: nova.checkout_em !== null };
  if (atual.promotor_id !== usuario_id) return { tipo: 'recusa', codigo: 'ID_EM_USO', mensagem: 'Este identificador de visita de loja já pertence a outro registro.' };
  const { promotor_id: _p, ...guardada } = atual;
  if (mesmoConteudo(guardada, nova)) return { tipo: 'repetida' };
  if (CAMPOS_DO_CHECKIN.some((k) => atual[k] !== nova[k])) {
    return { tipo: 'conflito', mensagem: 'A visita de loja já foi recebida com outra loja ou outro check-in.' };
  }
  if (atual.checkout_em !== null) return { tipo: 'conflito', mensagem: 'A visita de loja já foi encerrada; o checkout não pode ser desfeito nem alterado.' };
  if (nova.checkout_em === null) return { tipo: 'conflito', mensagem: 'A visita de loja ainda está aberta: só o checkout pode alterá-la.' };
  return { tipo: 'checkout' };
}

/**
 * RN-PRO-06 no servidor: visita `realizada` só fecha com as etapas obrigatórias do checklist concluídas (a última
 * resposta de cada item vale). Loja fechada / acesso negado dispensam o checklist. `null` = checkout liberado.
 */
export function checkoutRespeitaChecklist(desfecho: DesfechoVisita, respostas: readonly { checklist_item_id: string; obrigatoria: boolean; concluida: boolean }[]): string | null {
  const ultima = new Map<string, { obrigatoria: boolean; concluida: boolean }>();
  for (const r of respostas) ultima.set(r.checklist_item_id, r);
  const etapas = [...ultima.entries()].map(([id, r]) => ({ id, rotulo: `etapa ${id}`, obrigatoria: r.obrigatoria, concluida: r.concluida }));
  const a = avaliarCheckout({ contexto: { clienteFechado: desfecho !== 'realizada' }, etapas });
  return a.pode ? null : `RN-PRO-06: faltam ${a.pendentes.length} etapa(s) obrigatória(s) do checklist. Conclua-as para fazer o checkout.`;
}

const CAMPOS_FOTO = ['foto_fachada_id', 'foto_antes_id', 'foto_depois_id', 'foto_id'] as const;

/** Ids de foto que a coleta referencia (campos `foto_*_id` e `foto_ids`), sem nulos e sem repetir. */
export function fotosReferenciadas(coleta: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const k of CAMPOS_FOTO) {
    const v = coleta[k];
    if (typeof v === 'string') ids.push(v);
  }
  if (Array.isArray(coleta.foto_ids)) for (const v of coleta.foto_ids) if (typeof v === 'string') ids.push(v);
  return [...new Set(ids)];
}
