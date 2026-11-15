/**
 * Interpretação de consulta em filtros estruturados SEM LLM (RF-CAT-01, RF-CAT-02, RN-CAT-01).
 * É o caminho de contingência da busca inteligente (limite diário, falha do provedor, offline) e também o que o
 * LLM não pode contradizer: código exato, valores de preço escritos na frase.
 */
import { FiltrosInterpretados } from '../contracts';
import { chaveDeTermo, normalizarTexto, tokensDeBusca } from './texto';
/** Dígito verificador de GTIN (EAN-8, UPC-A/12, EAN-13, GTIN-14). */
export function gtinValido(codigo) {
    if (!/^\d+$/.test(codigo) || ![8, 12, 13, 14].includes(codigo.length))
        return false;
    const digitos = codigo.split('').map(Number);
    const dv = digitos.pop();
    const soma = digitos.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (soma % 10)) % 10 === dv;
}
const MEDIDA_RE = /^\d+(\.\d+)?(ml|g|cm|mm|un)$/;
const NUMERO_RE = /^\d+(\.\d+)?$/;
const DINHEIRO_RE = /^brl(\d+)$/;
/** Número em formato brasileiro → centavos inteiros ("1.299,90" → 129990; "10" → 1000; "7.9" → 790). */
function paraCentavos(bruto) {
    let inteiro;
    let decimal = '';
    if (bruto.includes(',')) {
        const [a, b = ''] = bruto.split(',');
        inteiro = a.replace(/\./g, '');
        decimal = b;
    }
    else if (/^\d{1,3}(\.\d{3})+$/.test(bruto)) {
        inteiro = bruto.replace(/\./g, '');
    }
    else if (bruto.includes('.')) {
        const [a, b = ''] = bruto.split('.');
        inteiro = a;
        decimal = b;
    }
    else {
        inteiro = bruto;
    }
    return Number(inteiro) * 100 + Number(decimal.padEnd(2, '0').slice(0, 2));
}
const NUM = String.raw `(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const MOEDA_PREFIXO = new RegExp(String.raw `(?:r\$|\brs\b\.?)\s*${NUM}`, 'gi');
const MOEDA_SUFIXO = new RegExp(String.raw `${NUM}\s*(?:reais|real)\b`, 'gi');
/** Troca "R$ 10,50" e "10 reais" por um marcador `brl1050` (centavos) antes da normalização. */
function marcarDinheiro(texto) {
    const troca = (_m, n) => ` brl${paraCentavos(n)} `;
    return texto.replace(MOEDA_PREFIXO, troca).replace(MOEDA_SUFIXO, troca);
}
function acharFrase(partes, usados, frase) {
    for (let i = 0; i + frase.length <= partes.length; i++) {
        if (frase.every((p, k) => partes[i + k] === p && !usados[i + k]))
            return i;
    }
    return -1;
}
function consumirFrase(partes, usados, frases) {
    let achou = false;
    for (const frase of frases) {
        const i = acharFrase(partes, usados, frase);
        if (i >= 0) {
            for (let k = 0; k < frase.length; k++)
                usados[i + k] = true;
            achou = true;
        }
    }
    return achou;
}
const FRASES_COM_ESTOQUE = [['com', 'estoque'], ['em', 'estoque'], ['tem', 'estoque'], ['tenha', 'estoque'], ['disponivel'], ['disponiveis']];
const FRASES_SEM_ESTOQUE = [['sem', 'estoque'], ['esgotado'], ['esgotados'], ['em', 'falta']];
const FRASES_BARATO = [['mais', 'barato'], ['mais', 'barata'], ['menor', 'preco'], ['mais', 'em', 'conta'], ['barato'], ['barata']];
const FRASES_CARO = [['mais', 'caro'], ['mais', 'cara'], ['maior', 'preco']];
const FRASES_CLIENTE_ATUAL = [['cliente', 'atual'], ['do', 'cliente']];
const CUES_MAXIMO = [['por', 'ate'], ['ate'], ['menos', 'de'], ['abaixo', 'de'], ['no', 'maximo'], ['maximo'], ['inferior', 'a'], ['menor', 'que']];
const CUES_MINIMO = [['a', 'partir', 'de'], ['acima', 'de'], ['mais', 'de'], ['no', 'minimo'], ['minimo'], ['superior', 'a'], ['maior', 'que']];
const EMBALAGENS = new Set(['cx', 'pct']);
/** Valor em centavos de um token: marcador de dinheiro (`brl1050`) ou número solto (reais). */
function valorDe(token, seguinte) {
    if (token === undefined)
        return null;
    const m = DINHEIRO_RE.exec(token);
    if (m)
        return { cents: Number(m[1]), explicito: true };
    if (NUMERO_RE.test(token) && !(seguinte !== undefined && EMBALAGENS.has(seguinte)))
        return { cents: paraCentavos(token), explicito: false };
    return null;
}
function extrairPreco(partes, usados) {
    let min = null;
    let max = null;
    const livre = (i) => i < partes.length && !usados[i];
    // faixa: "entre X e Y" e "de X a Y" (esta só com dinheiro explícito)
    for (let i = 0; i < partes.length; i++) {
        if (usados[i])
            continue;
        const entre = partes[i] === 'entre';
        const de = partes[i] === 'de';
        if (!entre && !de)
            continue;
        const sep = entre ? 'e' : 'a';
        if (!(livre(i + 1) && livre(i + 2) && livre(i + 3) && partes[i + 2] === sep))
            continue;
        const a = valorDe(partes[i + 1], partes[i + 2]);
        const b = valorDe(partes[i + 3], partes[i + 4]);
        if (!a || !b)
            continue;
        if (de && !(a.explicito || b.explicito))
            continue;
        min = Math.min(a.cents, b.cents);
        max = Math.max(a.cents, b.cents);
        for (let k = i; k <= i + 3; k++)
            usados[k] = true;
    }
    // limites: "até X", "acima de X"…
    const aplicar = (cues, alvo) => {
        for (const cue of cues) {
            for (let i = 0; i + cue.length < partes.length; i++) {
                if (!cue.every((p, k) => partes[i + k] === p && !usados[i + k]))
                    continue;
                let j = i + cue.length;
                if (partes[j] === 'de' && !usados[j])
                    j++; // "mais de", "ate de"
                const v = livre(j) ? valorDe(partes[j], partes[j + 1]) : null;
                if (!v)
                    continue;
                if (alvo === 'max')
                    max = v.cents;
                else
                    min = v.cents;
                for (let k = i; k <= j; k++)
                    usados[k] = true;
            }
        }
    };
    aplicar(CUES_MAXIMO, 'max');
    aplicar(CUES_MINIMO, 'min');
    // dinheiro solto, sem palavra de apoio: não filtra, mas sai do texto
    partes.forEach((p, i) => {
        if (!usados[i] && DINHEIRO_RE.test(p))
            usados[i] = true;
    });
    if (min !== null && max !== null && min > max)
        [min, max] = [max, min];
    return { min, max };
}
/** Procura a maior marca/categoria do vocabulário nas partes livres; devolve a grafia cadastrada. */
function acharNoVocabulario(partes, usados, vocabulario, cues, cueObrigatoria) {
    const chaves = partes.map((p) => chaveDeTermo(p));
    const candidatos = vocabulario
        .map((original) => ({ original, palavras: chaveDeTermo(original).split(' ').filter(Boolean) }))
        .filter((c) => c.palavras.length > 0)
        .sort((a, b) => b.palavras.length - a.palavras.length || a.original.localeCompare(b.original, 'pt-BR'));
    for (let i = 0; i < partes.length; i++) {
        for (const c of candidatos) {
            const n = c.palavras.length;
            if (i + n > partes.length)
                continue;
            if (!c.palavras.every((w, k) => chaves[i + k] === w && !usados[i + k]))
                continue;
            // palavra de apoio logo antes ("marca", "categoria"…); "da/de/do" são stopwords e saem do texto sozinhas
            let inicio = i;
            let comCue = false;
            if (i > 0 && !usados[i - 1] && cues.includes(partes[i - 1])) {
                comCue = true;
                inicio = i - 1;
            }
            if (cueObrigatoria && !comCue)
                continue;
            for (let k = inicio; k < i + n; k++)
                usados[k] = true;
            return c.original;
        }
    }
    return null;
}
/** Candidato a código: SKU/ERP com dígito, que não seja medida. */
function candidatoACodigo(bruto) {
    const t = bruto.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]{2,29}$/.test(t) || !/\d/.test(t))
        return null;
    if (MEDIDA_RE.test(normalizarTexto(t).replace(/ /g, '')))
        return null;
    if (/^\d+$/.test(t) && t.length < 4)
        return null;
    return t.toUpperCase();
}
/**
 * Interpreta a frase com regras locais: código/EAN exato, marca e categoria do vocabulário do tenant, faixa de
 * preço, estoque, ordenação por preço e medidas canônicas. O que sobra é o texto livre.
 */
export function interpretarConsulta(texto, vocabulario) {
    const bruto = String(texto ?? '').trim();
    let code = null;
    // 1. código exato (sobre o texto bruto: hífen e ponto fazem parte do SKU)
    const palavrasBrutas = bruto.split(/\s+/).filter(Boolean);
    let restoBruto = bruto;
    const ean = palavrasBrutas.find((p) => gtinValido(p));
    if (ean) {
        code = { type: 'ean', value: ean };
        restoBruto = palavrasBrutas.filter((p) => p !== ean).join(' ');
    }
    else if (palavrasBrutas.length === 1) {
        const sku = candidatoACodigo(palavrasBrutas[0]);
        if (sku)
            code = { type: 'sku', value: sku };
    }
    const partes = normalizarTexto(marcarDinheiro(restoBruto)).split(' ').filter(Boolean);
    const usados = partes.map(() => false);
    const preco = extrairPreco(partes, usados);
    const estoqueCom = consumirFrase(partes, usados, FRASES_COM_ESTOQUE);
    const estoqueSem = consumirFrase(partes, usados, FRASES_SEM_ESTOQUE);
    const barato = consumirFrase(partes, usados, FRASES_BARATO);
    const caro = consumirFrase(partes, usados, FRASES_CARO);
    consumirFrase(partes, usados, FRASES_CLIENTE_ATUAL);
    const brand = acharNoVocabulario(partes, usados, vocabulario.marcas, ['marca', 'fabricante'], false);
    const line = acharNoVocabulario(partes, usados, vocabulario.linhas, ['categoria', 'linha', 'departamento', 'setor'], true);
    const livres = partes.filter((_p, i) => !usados[i]);
    const measures = livres.filter((p) => MEDIDA_RE.test(p));
    return FiltrosInterpretados.parse({
        text: tokensDeBusca(livres.join(' ')).join(' '),
        brand,
        line,
        min_price_cents: preco.min,
        max_price_cents: preco.max,
        stock: estoqueSem ? 'sem' : estoqueCom ? 'com' : null,
        code,
        measures,
        sort: caro && !barato ? 'preco_desc' : barato ? 'preco_asc' : null,
    });
}
