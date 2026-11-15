import { chaveDeTermo } from './texto';
/**
 * RF-CAT-07: limpa o grupo de sinônimos — termo e sinônimos sem espaços sobrando, sinônimo repetido (sem acento, caixa
 * ou plural) uma vez só, na primeira grafia, e o próprio termo fora da lista. Sem sobra = recusado.
 */
export function normalizarSinonimo(s) {
    const term = s.term.trim().replace(/\s+/g, ' ');
    const chaveTermo = chaveDeTermo(term);
    const vistos = new Set([chaveTermo]);
    const synonyms = [];
    for (const bruto of s.synonyms) {
        const v = bruto.trim().replace(/\s+/g, ' ');
        const k = chaveDeTermo(v);
        if (!k || vistos.has(k))
            continue;
        vistos.add(k);
        synonyms.push(v);
    }
    if (!chaveTermo)
        return { ok: false, codigo: 'SINONIMO_TERMO_VAZIO', mensagem: 'Informe o termo com letras ou números.' };
    if (synonyms.length === 0)
        return { ok: false, codigo: 'SINONIMO_VAZIO', mensagem: 'Informe ao menos um sinônimo diferente do termo (acento, maiúscula e plural não contam).' };
    return { ok: true, valor: { term, synonyms, active: s.active } };
}
/**
 * RF-CAT-02/07: um termo vivo por tenant. O índice único `sinonimo_termo_uk` (tenant, lower(termo), sem removidos) vale
 * também para grupo inativo, então o mesmo termo em dois grupos (ativos ou não) é conflito. Devolve a mensagem (com o
 * termo e a ação seguinte) ou `null`. O próprio grupo (`id`) não conflita.
 */
export function conflitoDeSinonimo(id, novo, existentes) {
    const k = chaveDeTermo(novo.term);
    const outro = existentes.find((e) => e.id !== id && chaveDeTermo(e.term) === k);
    if (!outro)
        return null;
    return outro.active
        ? `Já existe um grupo ativo para "${outro.term}". Edite esse grupo ou desative-o antes de criar outro.`
        : `Já existe um grupo inativo para "${outro.term}". Reative e edite esse grupo, ou remova-o antes de criar outro.`;
}
/** Tamanho máximo do termo guardado no registro de buscas. */
export const TAMANHO_MAXIMO_TERMO = 100;
/** RF-CAT-07: termo da busca como fica no registro (normalizado; o mesmo termo digitado de jeitos diferentes soma). */
export function termoDeBusca(q) {
    const k = chaveDeTermo(q ?? '').slice(0, TAMANHO_MAXIMO_TERMO).trim();
    return k === '' ? null : k;
}
/** RF-CAT-07: termos sem resultado desde `desde` (inclusivo), mais buscados primeiro; empate, o mais recente, depois o termo. */
export function agruparTermosSemResultado(registros, desde, limite) {
    const inicio = Date.parse(desde);
    const porTermo = new Map();
    for (const r of registros) {
        const ms = Date.parse(r.em);
        if (r.resultados !== 0 || Number.isNaN(ms) || ms < inicio)
            continue;
        const t = porTermo.get(r.termo);
        if (!t)
            porTermo.set(r.termo, { count: 1, ultimo: r.em, ms });
        else {
            t.count++;
            if (ms > t.ms)
                Object.assign(t, { ultimo: r.em, ms });
        }
    }
    return [...porTermo.entries()]
        .sort(([ta, a], [tb, b]) => b.count - a.count || b.ms - a.ms || (ta < tb ? -1 : ta > tb ? 1 : 0))
        .slice(0, Math.max(0, limite))
        .map(([term, t]) => ({ term, count: t.count, last_searched_at: t.ultimo }));
}
const CONTEUDO_VAZIO = { description: null, selling_points: [], faq: [] };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * RF-CAT-03: ficha rica = o cartão (preço/estoque já decididos para o perfil, RN-CAT-05) + atributos (ordem de nome),
 * mídias (ordem cadastrada, depois id) e o conteúdo do BKO (vazio quando nunca enriquecido).
 */
export function montarFicha(p, item, conteudo, midias, extras = {}) {
    const attributes = [...p.atributos].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || cmp(a.value, b.value));
    const media = [...midias].sort((a, b) => a.order - b.order || cmp(a.id, b.id));
    const content = conteudo ? { description: conteudo.description, selling_points: [...conteudo.selling_points], faq: [...conteudo.faq] } : { ...CONTEUDO_VAZIO };
    const catalogo = {
        aplicacao: p.aplicacao ? p.aplicacao : null,
        referencias: [...(p.referencias ?? [])].slice(0, 3),
        oferece_junto: [...(extras.ofereceJunto ?? [])].slice(0, 5),
        etiquetas: [...(extras.etiquetas ?? [])].slice(0, 4),
    };
    return { product: item, attributes, media, content, content_updated_at: conteudo?.updated_at ?? null, catalogo };
}
