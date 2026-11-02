/**
 * BKO de conteúdo do Catálogo (RF-CAT-07) e ficha rica (RF-CAT-03): sinônimos do tenant (RF-CAT-02), termos buscados
 * sem resultado e a montagem da ficha. Funções puras; a API revalida tudo antes de gravar.
 */
import type { AtributoProduto, ConteudoProduto, FichaProduto, ItemVitrine, MidiaProduto, SalvarSinonimo, Sinonimo, TermoSemResultado } from '../contracts';
import { chaveDeTermo } from './texto';
import type { ProdutoCatalogo } from './vitrine';

export type Resultado<T> = { ok: true; valor: T } | { ok: false; codigo: string; mensagem: string };

/**
 * RF-CAT-07: limpa o grupo de sinônimos — termo e sinônimos sem espaços sobrando, sinônimo repetido (sem acento, caixa
 * ou plural) uma vez só, na primeira grafia, e o próprio termo fora da lista. Sem sobra = recusado.
 */
export function normalizarSinonimo(s: SalvarSinonimo): Resultado<SalvarSinonimo> {
  const term = s.term.trim().replace(/\s+/g, ' ');
  const chaveTermo = chaveDeTermo(term);
  const vistos = new Set<string>([chaveTermo]);
  const synonyms: string[] = [];
  for (const bruto of s.synonyms) {
    const v = bruto.trim().replace(/\s+/g, ' ');
    const k = chaveDeTermo(v);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    synonyms.push(v);
  }
  if (!chaveTermo) return { ok: false, codigo: 'SINONIMO_TERMO_VAZIO', mensagem: 'Informe o termo com letras ou números.' };
  if (synonyms.length === 0) return { ok: false, codigo: 'SINONIMO_VAZIO', mensagem: 'Informe ao menos um sinônimo diferente do termo (acento, maiúscula e plural não contam).' };
  return { ok: true, valor: { term, synonyms, active: s.active } };
}

/**
 * RF-CAT-02/07: o mesmo termo em dois grupos ATIVOS deixaria a busca ambígua. Devolve a mensagem do conflito (com o
 * termo a editar) ou `null`. O próprio grupo (`id`), grupos inativos e o novo grupo inativo não conflitam.
 */
export function conflitoDeSinonimo(id: string, novo: SalvarSinonimo, existentes: readonly Pick<Sinonimo, 'id' | 'term' | 'active'>[]): string | null {
  if (!novo.active) return null;
  const k = chaveDeTermo(novo.term);
  const outro = existentes.find((e) => e.id !== id && e.active && chaveDeTermo(e.term) === k);
  return outro ? `Já existe um grupo ativo para "${outro.term}". Edite esse grupo ou desative-o antes de criar outro.` : null;
}

/** Tamanho máximo do termo guardado no registro de buscas. */
export const TAMANHO_MAXIMO_TERMO = 100;

/** RF-CAT-07: termo da busca como fica no registro (normalizado; o mesmo termo digitado de jeitos diferentes soma). */
export function termoDeBusca(q: string): string | null {
  const k = chaveDeTermo(q ?? '').slice(0, TAMANHO_MAXIMO_TERMO).trim();
  return k === '' ? null : k;
}

export interface RegistroBusca {
  termo: string;
  resultados: number;
  /** Instante da busca (ISO UTC). */
  em: string;
}

/** RF-CAT-07: termos sem resultado desde `desde` (inclusivo), mais buscados primeiro; empate, o mais recente, depois o termo. */
export function agruparTermosSemResultado(registros: readonly RegistroBusca[], desde: string, limite: number): TermoSemResultado[] {
  const inicio = Date.parse(desde);
  const porTermo = new Map<string, { count: number; ultimo: string; ms: number }>();
  for (const r of registros) {
    const ms = Date.parse(r.em);
    if (r.resultados !== 0 || Number.isNaN(ms) || ms < inicio) continue;
    const t = porTermo.get(r.termo);
    if (!t) porTermo.set(r.termo, { count: 1, ultimo: r.em, ms });
    else {
      t.count++;
      if (ms > t.ms) Object.assign(t, { ultimo: r.em, ms });
    }
  }
  return [...porTermo.entries()]
    .sort(([ta, a], [tb, b]) => b.count - a.count || b.ms - a.ms || (ta < tb ? -1 : ta > tb ? 1 : 0))
    .slice(0, Math.max(0, limite))
    .map(([term, t]) => ({ term, count: t.count, last_searched_at: t.ultimo }));
}

/** Conteúdo guardado do produto (BKO), com o instante da última alteração. */
export interface ConteudoGuardado extends ConteudoProduto {
  updated_at: string | null;
}

const CONTEUDO_VAZIO: ConteudoProduto = { description: null, selling_points: [], faq: [] };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * RF-CAT-03: ficha rica = o cartão (preço/estoque já decididos para o perfil, RN-CAT-05) + atributos (ordem de nome),
 * mídias (ordem cadastrada, depois id) e o conteúdo do BKO (vazio quando nunca enriquecido).
 */
export function montarFicha(p: ProdutoCatalogo, item: ItemVitrine, conteudo: ConteudoGuardado | null, midias: readonly MidiaProduto[]): FichaProduto {
  const attributes: AtributoProduto[] = [...p.atributos].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || cmp(a.value, b.value));
  const media = [...midias].sort((a, b) => a.order - b.order || cmp(a.id, b.id));
  const content: ConteudoProduto = conteudo ? { description: conteudo.description, selling_points: [...conteudo.selling_points], faq: [...conteudo.faq] } : { ...CONTEUDO_VAZIO };
  return { product: item, attributes, media, content, content_updated_at: conteudo?.updated_at ?? null };
}
