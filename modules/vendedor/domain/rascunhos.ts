/**
 * Rascunhos do Novo pedido (RN-VEN-38, RN-VEN-39; T-0141). Funções puras, sem relógio próprio (o "agora" entra por argumento).
 * O pedido que o vendedor deixa sem enviar e sem salvar como orçamento (qualquer saída sem salvar) é um rascunho, que mora só
 * no aparelho e some 24 h depois da última alteração, a não ser que vire orçamento ou pedido (aí sai do mapa de rascunhos). Sem exceção: a edição de registro salvo também some em 24 h.
 */

/** RN-VEN-39: quanto o rascunho vive depois da última alteração. */
export const RASCUNHO_VALIDADE_HORAS = 24;

/** O que a regra precisa de um rascunho (o `Rascunho` do app tem estes campos). */
export interface RascunhoMinimo {
  customer_id: string;
  /** chave da linha → quantidade */
  lines: Record<string, number>;
  /** ISO (UTC) da última alteração */
  updated_at: string;
  /** edição de um registro salvo (chave `edit:<id>`): também some 24 h depois da última alteração, e o registro salvo fica intacto (RN-VEN-39) */
  edit_order_id?: string | null;
  /** RN-VEN-48: ISO de quando o pedido foi salvo (Salvar → Pedido); o pedido salvo mora na aba Pedidos até ser enviado */
  salvo_em?: string | null;
  tipo?: string;
}

export interface LinhaDaListaDeRascunhos {
  /** chave no mapa de rascunhos: é por ela que o app retoma */
  chave: string;
  customer_id: string;
  itens: number;
  atualizado_em: string;
  /** edição de um registro salvo (id do pedido ou orçamento); `null` = pedido novo */
  edicao_de: string | null;
}

const temItens = (r: RascunhoMinimo) => Object.values(r.lines).some((q) => q > 0);

/** RN-VEN-48: rascunho salvo como pedido (não é edição de registro nem orçamento). Critério único. */
export function ehRascunhoSalvoComoPedido(r: Pick<RascunhoMinimo, 'salvo_em' | 'edit_order_id' | 'tipo'>): boolean {
  return !!r.salvo_em && !r.edit_order_id && r.tipo !== 'orcamento';
}

/** RN-VEN-39 / RN-VEN-48: venceu quando passaram 24 h (ou mais) desde a última alteração; o pedido salvo nunca vence (nada digitado se perde). */
export function rascunhoExpirou(r: Pick<RascunhoMinimo, 'updated_at'> & Partial<Pick<RascunhoMinimo, 'salvo_em' | 'edit_order_id' | 'tipo'>>, agora: Date): boolean {
  if (ehRascunhoSalvoComoPedido(r)) return false;
  const t = Date.parse(r.updated_at);
  return Number.isFinite(t) && agora.getTime() >= t + RASCUNHO_VALIDADE_HORAS * 3_600_000;
}

/**
 * RN-VEN-39: a lista Rascunhos — pedido novo vivo e com itens, mais a edição de um registro salvo (que também some em 24 h e pode
 * estar sem itens: spec F.2); do mais recente ao mais antigo.
 */
export function rascunhosParaLista(rascunhos: Readonly<Record<string, RascunhoMinimo>>, agora: Date): LinhaDaListaDeRascunhos[] {
  return Object.entries(rascunhos)
    .filter(([, r]) => (Boolean(r.edit_order_id) || temItens(r)) && !rascunhoExpirou(r, agora))
    .map(([chave, r]) => ({ chave, customer_id: r.customer_id, itens: Object.values(r.lines).filter((q) => q > 0).length, atualizado_em: r.updated_at, edicao_de: r.edit_order_id ?? null }))
    .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
}

/** RN-VEN-39: limpeza 24 h depois da última alteração; devolve o mapa que fica e as chaves apagadas. Vale também para a edição de registro salvo: o registro fica intacto, só a alteração não salva se perde. */
export function limparRascunhosExpirados<R extends RascunhoMinimo>(rascunhos: Readonly<Record<string, R>>, agora: Date): { mantidos: Record<string, R>; removidos: string[] } {
  const mantidos: Record<string, R> = {};
  const removidos: string[] = [];
  for (const [chave, r] of Object.entries(rascunhos)) {
    if (rascunhoExpirou(r, agora)) removidos.push(chave);
    else mantidos[chave] = r;
  }
  return { mantidos, removidos };
}

/** Selo "Some em": só quando faltam menos de 3 h (spec F.2). */
export const RASCUNHO_AVISO_MINUTOS = 180;

/** Minutos até o rascunho sumir (arredonda para cima); `null` se a data não é válida. */
export function minutosParaSumir(r: Pick<RascunhoMinimo, 'updated_at'>, agora: Date): number | null {
  const t = Date.parse(r.updated_at);
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t + RASCUNHO_VALIDADE_HORAS * 3_600_000 - agora.getTime()) / 60_000);
}

/** "Some em 2 h" (de 1 h a menos de 3 h, horas inteiras) ou "Some em 40 min"; `null` com 3 h ou mais. */
export function textoSomeEm(minutos: number | null): string | null {
  if (minutos === null || minutos >= RASCUNHO_AVISO_MINUTOS) return null;
  if (minutos >= 60) return `Some em ${Math.floor(minutos / 60)} h`;
  return `Some em ${Math.max(1, minutos)} min`;
}

// ---------- RN-VEN-39 / RN-VEN-48: vários pedidos salvos por cliente ----------

/**
 * RN-VEN-39: o rascunho EM DIGITAÇÃO continua um por cliente (retoma o que ficou); a chave é o id do cliente.
 * RN-VEN-48: o pedido SALVO tem chave própria (UUID gerado no aparelho), então o cliente pode ter vários.
 */
export function chaveDoRascunhoNovo(customerId: string): string {
  return customerId;
}

/**
 * RN-VEN-48: a chave em que o rascunho passa a morar ao ser salvo: o do cliente ganha chave própria; o que já tem (salvo, cópia, edição) mantém.
 * RN-VEN-33: é também o id do pedido enviado (o salvo envia com a própria chave, e o reenvio não duplica).
 */
export function chaveParaSalvar(chaveAtual: string, customerId: string, novoId: string): string {
  return chaveAtual === chaveDoRascunhoNovo(customerId) ? novoId : chaveAtual;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * RN-VEN-33: id do pedido no envio; só UUID. Chave do cliente em digitação gera `novoId`; chave de salvo (UUID) vale como id;
 * `edit:<uuid>` (edição do que está na fila) reenvia com o uuid do pedido editado; qualquer outra chave também gera `novoId`.
 */
export function idDoPedidoNoEnvio(chave: string, customerId: string, novoId: string): string {
  if (UUID.test(chave)) return chave;
  const editado = chave.startsWith('edit:') ? chave.slice(5) : '';
  if (chave !== chaveDoRascunhoNovo(customerId) && UUID.test(editado)) return editado;
  return novoId;
}

/** RN-VEN-48: Duplicar do pedido salvo: cópia dos itens e das condições, ainda não salva (sem `salvo_em`), aberta no Resumo. O original não muda. */
export function copiaDoPedidoSalvo<R extends RascunhoMinimo & { aba?: string; notice?: string }>(r: R, agora: string): R {
  const { notice: _aviso, ...resto } = r;
  void _aviso;
  return { ...resto, lines: { ...r.lines }, salvo_em: null, updated_at: agora, aba: 'resumo' } as unknown as R;
}

/**
 * RN-VEN-39/48: o pedido salvo guardado na chave do cliente (formato anterior, um por cliente) passa para a chave própria, sem perder nada.
 * Idempotente: sem salvo na chave do cliente não muda nada; se a cópia já existe (gravação interrompida), a chave antiga só sai.
 */
export function migrarSalvosParaChavePropria<R extends RascunhoMinimo>(
  rascunhos: Readonly<Record<string, R>>,
  novoId: () => string,
): { rascunhos: Record<string, R>; movidos: Array<{ de: string; para: string }> } {
  const saida: Record<string, R> = { ...rascunhos };
  const movidos: Array<{ de: string; para: string }> = [];
  for (const [chave, r] of Object.entries(rascunhos)) {
    if (chave !== chaveDoRascunhoNovo(r.customer_id) || !ehRascunhoSalvoComoPedido(r)) continue;
    const igual = Object.entries(saida).find(([k, o]) => k !== chave && ehRascunhoSalvoComoPedido(o) && o.customer_id === r.customer_id && o.salvo_em === r.salvo_em && o.updated_at === r.updated_at && JSON.stringify(o.lines) === JSON.stringify(r.lines));
    const para = igual ? igual[0] : novoId();
    delete saida[chave];
    if (!igual) saida[para] = r;
    movidos.push({ de: chave, para });
  }
  return { rascunhos: saida, movidos };
}

/** RN-VEN-39/48: a chave do rascunho ao duplicar/editar pedido existente: a cópia vai para chave nova (não sobrescreve o rascunho em digitação do cliente); a edição usa `edit:<id>`. */
export function chaveDaCopiaDoPedido(modo: 'duplicate' | 'edit', orderId: string, novoId: string): string {
  return modo === 'edit' ? `edit:${orderId}` : novoId;
}

/** RN-VEN-48: o `rascunhoId` da rota para abrir a chave; o rascunho do cliente (e a edição, que vai por `editId`) abre sem ele. */
export function rascunhoIdNaRota(chave: string, customerId: string): string | undefined {
  return chave === chaveDoRascunhoNovo(customerId) || chave.startsWith('edit:') ? undefined : chave;
}
