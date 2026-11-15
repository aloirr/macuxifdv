import { expandirAplicacao } from './aplicacao';
import { nivelDaPalavra } from './ranking';
import { tokensDeBusca } from './texto';
export const SERVE_EM_MAX = 90;
const MAX_MARCAS = 20;
const SEPARADOR_SEGMENTO = /[;|•\r\n]/;
const ANO_RE = /^(19|20)\d{2}$/;
const PALAVRA_RE = /[\p{L}\p{N}]+(?:[.,][\p{N}]+)*/gu;
function palavrasDe(segmento) {
    const saida = [];
    for (const m of segmento.matchAll(PALAVRA_RE)) {
        const termo = tokensDeBusca(m[0])[0];
        if (termo)
            saida.push({ inicio: m.index, fim: m.index + m[0].length, termo });
    }
    return saida;
}
function casar(segmento, grupos, anoAtual) {
    const palavras = palavrasDe(segmento);
    const faixas = expandirAplicacao(segmento, { anoAtual }).faixas;
    const marcas = [];
    let casados = 0;
    let incluiAno = null;
    for (const grupo of grupos) {
        for (const alt of grupo) {
            const partes = alt.split(' ').filter(Boolean);
            if (partes.length === 0)
                continue;
            const achadas = [];
            let faixaDoAno = null;
            let todas = true;
            for (const q of partes) {
                const p = palavras.find((w) => nivelDaPalavra(q, w.termo) > 0);
                if (p) {
                    achadas.push([p.inicio, p.fim]);
                    continue;
                }
                const faixa = partes.length === 1 && ANO_RE.test(q) ? faixas.find((f) => Number(q) >= f.de && Number(q) <= f.ate) : undefined;
                if (faixa)
                    faixaDoAno = { ano: Number(q), faixa };
                else
                    todas = false;
            }
            if (!todas)
                continue;
            casados++;
            if (faixaDoAno) {
                marcas.push([faixaDoAno.faixa.inicio, faixaDoAno.faixa.fim]);
                if (incluiAno === null)
                    incluiAno = faixaDoAno.ano;
            }
            else
                marcas.push(...achadas);
            break;
        }
    }
    return { marcas, grupos: casados, incluiAno };
}
/** Une marcas que se tocam e ordena. */
function unir(marcas) {
    const ord = [...marcas].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const saida = [];
    for (const m of ord) {
        const ultimo = saida[saida.length - 1];
        if (ultimo && m[0] <= ultimo[1])
            ultimo[1] = Math.max(ultimo[1], m[1]);
        else
            saida.push([m[0], m[1]]);
    }
    return saida;
}
/**
 * RN-CAT-12: trecho da aplicação para a linha "Serve em". `grupos` são os da consulta (`expandirSinonimos`).
 * Nulo quando a aplicação é vazia ou nenhum grupo casou nela.
 */
export function trechoServeEm(aplicacao, grupos, opcoes) {
    const texto = aplicacao ?? '';
    if (texto.trim() === '' || grupos.length === 0)
        return null;
    const max = opcoes.max ?? SERVE_EM_MAX;
    // segmentos; no empate vale o primeiro
    let melhor = null;
    for (const bruto of texto.split(SEPARADOR_SEGMENTO)) {
        const seg = bruto.trim();
        if (seg === '')
            continue;
        const c = casar(seg, grupos, opcoes.anoAtual);
        if (c.grupos > 0 && (melhor === null || c.grupos > melhor.c.grupos))
            melhor = { texto: seg, c };
    }
    if (!melhor)
        return null;
    const marcas = unir(melhor.c.marcas).slice(0, MAX_MARCAS);
    const seg = melhor.texto;
    if (seg.length <= max)
        return { texto: seg, marcas, inclui_ano: melhor.c.incluiAno };
    // janela de até `max` (o "…" conta) em volta da primeira marca, em palavra inteira
    const primeira = marcas[0]?.[0] ?? 0;
    let ini = Math.max(0, primeira - 20);
    if (ini > 0 && seg[ini - 1] !== ' ') {
        const esp = seg.indexOf(' ', ini);
        if (esp >= 0 && esp + 1 <= primeira)
            ini = esp + 1;
    }
    const orcamento = max - (ini > 0 ? 1 : 0);
    let fim;
    if (seg.length - ini <= orcamento)
        fim = seg.length;
    else {
        const limite = ini + orcamento - 1;
        fim = limite;
        if (seg[limite] !== ' ') {
            const esp = seg.lastIndexOf(' ', limite);
            if (esp > ini)
                fim = esp;
        }
        while (fim > ini && seg[fim - 1] === ' ')
            fim--;
    }
    const prefixo = ini > 0 ? '…' : '';
    const sufixo = fim < seg.length ? '…' : '';
    const deslocamento = prefixo.length - ini;
    const recorte = marcas.filter(([a, b]) => a >= ini && b <= fim).map(([a, b]) => [a + deslocamento, b + deslocamento]);
    return { texto: `${prefixo}${seg.slice(ini, fim)}${sufixo}`, marcas: recorte, inclui_ano: melhor.c.incluiAno };
}
