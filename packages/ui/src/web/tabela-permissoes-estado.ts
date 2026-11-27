/**
 * Perfis (ADR 0073, etapa E5): parte pura da tabela de permissões de um perfil (docs/design/simulacoes/2026-11-24/perfis-tabela.md).
 * Sem regra de negócio: a tela diz o que está marcado, travado ou sem licença (pelo domain do Core); aqui só se conta, se
 * resolve o tri-estado da caixa do grupo e se filtra pela busca.
 */

/** O mínimo de uma linha que as contas precisam. */
export interface EstadoDaLinha {
  id: string;
  marcada: boolean;
  /** Cadeado (regra, cargo, autogestão): a caixa do grupo não mexe nela. */
  travada?: boolean;
  /** Módulo sem licença: valor guardado, linha desabilitada (ADR 0073 §2.5, item 8). */
  semLicenca?: boolean;
}

/** Estado da caixa do grupo: todas as livres marcadas, nenhuma, parte (traço) ou sem livres (desabilitada). */
export type EstadoDaCaixa = 'todas' | 'nenhuma' | 'parte' | 'sem-livres';

export const linhaLivre = (l: EstadoDaLinha): boolean => !l.travada && !l.semLicenca;

/** "n de m ligadas": conta todas as linhas do grupo, livres ou não, como na simulação. */
export function contagemDoGrupo(linhas: readonly EstadoDaLinha[]): { ligadas: number; total: number } {
  return { ligadas: linhas.filter((l) => l.marcada).length, total: linhas.length };
}

export const textoDaContagem = (ligadas: number, total: number): string => `${ligadas} de ${total} ligadas`;

/** Tri-estado da caixa do grupo, olhando só as linhas livres. */
export function estadoDaCaixaDoGrupo(linhas: readonly EstadoDaLinha[], semLicenca = false): EstadoDaCaixa {
  const livres = semLicenca ? [] : linhas.filter(linhaLivre);
  if (livres.length === 0) return 'sem-livres';
  const marcadas = livres.filter((l) => l.marcada).length;
  if (marcadas === livres.length) return 'todas';
  return marcadas === 0 ? 'nenhuma' : 'parte';
}

/** Valor do `aria-checked` da caixa do grupo. */
export function ariaCheckedDaCaixa(estado: EstadoDaCaixa): boolean | 'mixed' {
  return estado === 'todas' ? true : estado === 'parte' ? 'mixed' : false;
}

/**
 * O que um clique na caixa do grupo muda: com todas marcadas, desliga as livres; senão (nenhuma ou parte), liga as livres.
 * Devolve só as linhas que mudam (id → novo valor); travadas e sem licença ficam como estão.
 */
export function mudancasDaCaixaDoGrupo(linhas: readonly EstadoDaLinha[], semLicenca = false): Record<string, boolean> {
  const estado = estadoDaCaixaDoGrupo(linhas, semLicenca);
  if (estado === 'sem-livres') return {};
  const alvo = estado !== 'todas';
  const out: Record<string, boolean> = {};
  for (const l of linhas) if (linhaLivre(l) && l.marcada !== alvo) out[l.id] = alvo;
  return out;
}

/** Minúsculas e sem acento, para a busca ("permissao" acha "Permissão"). */
export const normalizarBusca = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Filtra os grupos pela busca: o grupo cujo título casa fica inteiro; nos outros, ficam só as linhas que casam; grupo sem
 * linha some. Busca vazia devolve tudo.
 */
export function filtrarGruposPorBusca<L extends { rotulo: string }, G extends { titulo: string; linhas: readonly L[] }>(
  grupos: readonly G[],
  busca: string,
): G[] {
  const termo = normalizarBusca(busca);
  if (!termo) return [...grupos];
  const out: G[] = [];
  for (const g of grupos) {
    if (normalizarBusca(g.titulo).includes(termo)) {
      out.push(g);
      continue;
    }
    const linhas = g.linhas.filter((l) => normalizarBusca(l.rotulo).includes(termo));
    if (linhas.length > 0) out.push({ ...g, linhas });
  }
  return out;
}

/** Nível do segmentado de escopo (Dados). */
export interface NivelDeEscopo {
  valor: string;
  rotulo: string;
}

/** Marca acima do teto do cargo: os níveis depois do `teto` na ordem ficam com cadeado. Teto ausente ou desconhecido: nenhum. */
export function niveisAcimaDoTeto(niveis: readonly NivelDeEscopo[], teto: string | null | undefined): Set<string> {
  const i = teto == null ? -1 : niveis.findIndex((n) => n.valor === teto);
  return new Set(i < 0 ? [] : niveis.slice(i + 1).map((n) => n.valor));
}

/** "O cargo Vendedor vai até "Carteira própria"." — motivo do cadeado nos níveis acima do teto (sem código de regra, UX-13). */
export function textoDoTeto(cargo: string, rotuloDoTeto: string): string {
  return `O cargo ${cargo} vai até "${rotuloDoTeto}".`;
}

/** Texto do grupo sem licença (simulação, linha "Sem licença"). */
export const SELO_SEM_LICENCA = 'Sem licença';
export const textoSemLicenca = (modulo: string): string => `Ative o módulo ${modulo} em Módulos para usar estas permissões.`;

/** Rótulos acessíveis. */
export const ROTULO_BUSCA_PERMISSAO = 'Buscar permissão';
export const rotuloDaCaixaDoGrupo = (titulo: string): string => `Todas de ${titulo}`;
export const rotuloDaSetaDoGrupo = (titulo: string, aberto: boolean): string => `${aberto ? 'Recolher' : 'Abrir'} ${titulo}`;
export const TEXTO_SEM_RESULTADO = 'Nenhuma permissão com esse nome.';
