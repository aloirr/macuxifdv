/**
 * Nomes canônicos da plataforma: módulos, perfis, apps, eventos, extensões e entidades de sync.
 * Fonte: docs/produto/02 (módulos), 03 (perfis) e 04 (convenções); registro em .coord/contratos/.
 */

export const MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const;
export type ModuloId = (typeof MODULOS)[number];

export const PERFIS = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
export type Perfil = (typeof PERFIS)[number];

/** Onde um módulo aparece: apps Android (variantes do shell), BKO web e Conector on-premise. */
export const APPS = ['campo', 'gestao', 'web', 'conector'] as const;
export type AppId = (typeof APPS)[number];

const SEG = '[a-z][a-z0-9_]*';

/** `<modulo>.<entidade>.<fato>@vN` — ex.: `vendedor.pedido.criado@1`. */
export const EVENTO_RE = new RegExp(`^(${SEG})\\.(${SEG})\\.(${SEG})@([1-9][0-9]*)$`);

/** Slot de extensão de UI `<entidade>.<ponto>` — ex.: `cliente.abas`, `pedido.criar_em_nome`. */
export const EXTENSAO_RE = new RegExp(`^${SEG}\\.${SEG}$`);

/** Ação com permissão por perfil `<entidade>.<verbo>` — ex.: `pedido.criar`, `pedido.criar_em_nome`. */
export const ACAO_RE = new RegExp(`^${SEG}\\.${SEG}$`);

/** Ações de pedido (`pedido.*`, `pedido_item.*`…), de leitura ou de escrita. */
export function ehAcaoDePedido(acao: string): boolean {
  return /^pedido(_[a-z0-9_]+)?\./.test(acao);
}

/**
 * Verbos de LEITURA de uma ação (`<entidade>.ver`). Leitura de pedido segue a matriz do doc 03 §2 ("Ver pedidos":
 * promotor = carteira, leitura; esclarecimento O-3 de 2026-10-31): quem lê é decidido pelo `perfis` da ação no
 * manifesto (ADR 0004), não por exceção no código.
 */
export const VERBOS_DE_LEITURA = ['ver'] as const;

/** Ação que dá a leitura de pedidos (lista, detalhe e pull de `pedido*`); quem a tem é o `perfis` do manifesto. */
export const ACAO_VER_PEDIDO = 'pedido.ver';

/** Ação de pedido somente de leitura (`pedido.ver`, `pedido_item.ver`…): pode ser concedida ao promotor pelo manifesto. */
export function ehAcaoDeLeituraDePedido(acao: string): boolean {
  return ehAcaoDePedido(acao) && (VERBOS_DE_LEITURA as readonly string[]).includes(acao.slice(acao.indexOf('.') + 1));
}

/** Ação de pedido que cria/edita/cancela/duplica/exclui/aprova…: o promotor nunca a executa (RN-PRO-01). */
export function ehAcaoDeEscritaDePedido(acao: string): boolean {
  return ehAcaoDePedido(acao) && !ehAcaoDeLeituraDePedido(acao);
}

/** Entidade de sync de pedido (`pedido`, `pedido_item`, `pedido_evento`…): o promotor nunca envia push (RN-PRO-01). */
export function ehEntidadeDePedido(nome: string): boolean {
  return /^pedido(_[a-z0-9_]+)?$/.test(nome);
}

/** Entidade de sync em snake_case — ex.: `checklist_loja`. */
export const ENTIDADE_SYNC_RE = new RegExp(`^${SEG}$`);

export interface NomeEvento {
  modulo: string;
  entidade: string;
  fato: string;
  versao: number;
}

export function lerNomeEvento(nome: string): NomeEvento | null {
  const m = EVENTO_RE.exec(nome);
  if (!m) return null;
  return { modulo: m[1]!, entidade: m[2]!, fato: m[3]!, versao: Number(m[4]) };
}

export function formatarNomeEvento(n: NomeEvento): string {
  const nome = `${n.modulo}.${n.entidade}.${n.fato}@${n.versao}`;
  if (!EVENTO_RE.test(nome)) throw new Error(`Nome de evento inválido: ${nome}`);
  return nome;
}

export function ehModulo(id: string): id is ModuloId {
  return (MODULOS as readonly string[]).includes(id);
}
