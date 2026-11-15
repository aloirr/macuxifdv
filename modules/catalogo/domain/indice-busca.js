import { anoCivilNoFuso } from './ano-civil';
import { expandirAplicacao } from './aplicacao';
import { casaComCodigo, cmp, codigoCompacto, codigosDaConsulta, nivelDaPalavra, nomeChave, notaFinal, soCasaExato, TOKENS_DO_PRODUTO, tokensDoDoc, toleranciaDaPalavra } from './ranking';
import { chaveDeTermo, expandirSinonimos, tokensDeBuscaSemMemo } from './texto';
import { aplicarChips, entraNaVitrine, temEstoqueParaBusca } from './vitrine';
import { filtrosParaPerfil } from './visibilidade';
/** Abaixo disto o ranking completo é barato e o índice não compensa. */
export const MINIMO_PARA_INDICE = 2000;
/**
 * Teto de candidatos que entram no ranking completo (T-0119, D-T0107b). Acima dele `cortarCandidatos` fica com os melhores por uma
 * nota barata (acertos no índice + os mesmos boosts do ranking). Com o corte, o `total` da busca para em `TETO_CANDIDATOS` (a tela pede
 * para refinar; sem corte ele para em `LIMITE_RESULTADOS_BUSCA`, 500). Medido: ~0,3 ms por candidato no ranking completo.
 */
export const TETO_CANDIDATOS = 200;
/** Bit `código do caractere mod 32` de cada caractere do texto. */
function mascaraDe(t) {
    let m = 0;
    for (let i = 0; i < t.length; i++)
        m |= 1 << (t.charCodeAt(i) & 31);
    return m;
}
function bits(n) {
    n -= (n >>> 1) & 0x55555555;
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function acrescentar(m, termo, i) {
    if (!termo)
        return;
    const l = m.get(termo);
    if (!l)
        m.set(termo, [i]);
    else if (l[l.length - 1] !== i)
        l.push(i);
}
/**
 * Construtor do índice em passos: a carga de 20 mil produtos custa segundos de CPU e, numa só volta, travaria o servidor inteiro
 * (T-0119). `passo` processa um pedaço e devolve se terminou; quem chama cede o laço de eventos entre os pedaços.
 * Cada produto guarda também os termos de seus campos (`TOKENS_DO_PRODUTO`), que o ranking reaproveita.
 */
export class ConstrutorIndice {
    produtos;
    anoAtual;
    porTermo = new Map();
    porTermoApl = new Map();
    porCodigo = new Map();
    anos;
    marcaChave = [];
    categoriaChave = [];
    maxVendasAtivos = 0;
    proximo = 0;
    constructor(produtos, anoAtual) {
        this.produtos = produtos;
        this.anoAtual = anoAtual;
        this.anos = new Array(produtos.length).fill(null);
    }
    get terminou() {
        return this.proximo >= this.produtos.length;
    }
    /** Processa até `quantos` produtos; `true` quando acabou. */
    passo(quantos) {
        const fim = Math.min(this.produtos.length, this.proximo + quantos);
        for (; this.proximo < fim; this.proximo++)
            this.produto(this.proximo);
        return this.terminou;
    }
    produto(i) {
        const p = this.produtos[i];
        const atributos = p.atributos.map((x) => `${x.name} ${x.value}`).join(' ');
        const tk = tokensDoDoc({ sku: p.sku, ean: p.ean, nome: p.nome, marca: p.marca, categoria: p.categoria, atributos, referencias: p.referencias ?? [] }, true);
        TOKENS_DO_PRODUTO.set(p, tk);
        for (const campo of [tk.nome, tk.codigo, tk.marca, tk.categoria, tk.atributos])
            for (const x of campo)
                acrescentar(this.porTermo, x, i);
        for (const r of p.referencias ?? [])
            acrescentar(this.porCodigo, codigoCompacto(r.codigo), i);
        const apl = p.aplicacao ?? '';
        if (apl !== '') {
            for (const x of tokensDeBuscaSemMemo(apl))
                acrescentar(this.porTermoApl, x, i);
            const e = expandirAplicacao(apl, { anoAtual: this.anoAtual });
            for (const x of tokensDeBuscaSemMemo(e.textoIndice))
                acrescentar(this.porTermoApl, x, i);
            if (e.anos.length > 0)
                this.anos[i] = e.anos;
        }
        acrescentar(this.porCodigo, codigoCompacto(p.sku), i);
        if (p.ean)
            acrescentar(this.porCodigo, p.ean, i);
        this.marcaChave[i] = chaveDeTermo(p.marca);
        this.categoriaChave[i] = chaveDeTermo(p.categoria);
        if (p.ativo && p.vendas > this.maxVendasAtivos)
            this.maxVendasAtivos = p.vendas;
    }
    concluir() {
        if (!this.terminou)
            throw new Error('Índice de busca incompleto.');
        const sub = (m) => {
            const termos = [...m.keys()].sort((a, b) => a.length - b.length);
            return { porTermo: m, termos, alfa: [...m.keys()].sort(cmp), mascaras: Int32Array.from(termos, mascaraDe) };
        };
        return {
            produtos: this.produtos,
            anoAtual: this.anoAtual,
            texto: sub(this.porTermo),
            aplicacao: sub(this.porTermoApl),
            anos: this.anos,
            porCodigo: this.porCodigo,
            marcaChave: this.marcaChave,
            categoriaChave: this.categoriaChave,
            maxVendasAtivos: this.maxVendasAtivos,
        };
    }
}
/** Índice de uma vez (testes e quem não tem retrato); a API usa `prepararIndice`, que cede o laço de eventos. */
export function construirIndiceBusca(produtos, anoAtual) {
    const c = new ConstrutorIndice(produtos, anoAtual);
    c.passo(produtos.length);
    return c.concluir();
}
/** Devolve o laço de eventos para as requisições entrarem. */
export const cederLaco = () => new Promise((r) => setImmediate(r));
/** Fatia de CPU contínua de cada pedaço da carga: curta o bastante para as requisições entrarem entre um pedaço e outro. */
export const FATIA_MS_INDICE = 8;
/**
 * Aquecimento do índice fora da requisição (T-0119): constrói em pedaços de ~`FATIA_MS_INDICE` ms, cedendo o laço de eventos
 * entre eles com `setImmediate`, e guarda o resultado para `indiceDe`. `null` = catálogo pequeno demais para valer o índice.
 */
export async function prepararIndice(produtos, anoAtual, opcoes = {}) {
    if (produtos.length < (opcoes.minimo ?? MINIMO_PARA_INDICE))
        return null;
    const existente = indices.get(produtos);
    if (existente && existente.anoAtual === anoAtual)
        return existente;
    const ceder = opcoes.ceder ?? cederLaco;
    const c = new ConstrutorIndice(produtos, anoAtual);
    let tamanho = 50;
    while (!c.terminou) {
        const t0 = performance.now();
        c.passo(tamanho);
        const gasto = performance.now() - t0;
        tamanho = Math.max(10, Math.min(2000, Math.round(tamanho * (FATIA_MS_INDICE / Math.max(0.5, gasto)))));
        await ceder();
    }
    const indice = c.concluir();
    indices.set(produtos, indice);
    return indice;
}
/** Percorre os termos do índice que a palavra casa (exato, prefixo ou erro de digitação), com o nível do casamento. */
function casamentos(indice, palavra, aoCasar) {
    const exato = indice.porTermo.get(palavra);
    if (exato)
        aoCasar(exato, nivelDaPalavra(palavra, palavra));
    // medidas e códigos (com dígito) só casam exatos; palavras curtas só exatas (ver `nivelDaPalavra`)
    if (soCasaExato(palavra) || palavra.length < 3)
        return;
    const tolerancia = toleranciaDaPalavra(palavra);
    const menor = palavra.length - tolerancia;
    const maior = palavra.length + tolerancia;
    const primeiroComTamanho = (n) => {
        let ini = 0;
        let fim = indice.termos.length;
        while (ini < fim) {
            const m = (ini + fim) >> 1;
            if (indice.termos[m].length < n)
                ini = m + 1;
            else
                fim = m;
        }
        return ini;
    };
    // 1) termos de tamanho dentro do alcance da digitação (o comprimento limita antes de qualquer distância): prefixo ou erro de digitação
    const mascaraP = mascaraDe(palavra);
    const fimJanela = primeiroComTamanho(maior + 1);
    for (let k = primeiroComTamanho(menor); k < fimJanela; k++) {
        const t = indice.termos[k];
        if (t === palavra)
            continue;
        // cada caractere da palavra que não existe no termo custa pelo menos uma edição
        if (!t.startsWith(palavra) && bits(mascaraP & ~indice.mascaras[k]) > tolerancia)
            continue;
        const nivel = nivelDaPalavra(palavra, t);
        if (nivel > 0)
            aoCasar(indice.porTermo.get(t), nivel);
    }
    // 2) termos além do alcance da digitação: só o prefixo conta, e quem tem o prefixo é uma faixa contínua da ordem alfabética
    let ini = 0;
    let fim = indice.alfa.length;
    while (ini < fim) {
        const m = (ini + fim) >> 1;
        if (indice.alfa[m] < palavra)
            ini = m + 1;
        else
            fim = m;
    }
    for (let k = ini; k < indice.alfa.length; k++) {
        const t = indice.alfa[k];
        if (!t.startsWith(palavra))
            break;
        if (t.length > maior)
            aoCasar(indice.porTermo.get(t), nivelDaPalavra(palavra, t));
    }
}
/** Posições dos produtos que têm algum termo que a palavra casa (exato, prefixo ou erro de digitação). */
export function posicoesDaPalavra(indice, palavra, destino) {
    for (const sub of [indice.texto, indice.aplicacao]) {
        casamentos(sub, palavra, (posicoes) => {
            for (const i of posicoes)
                destino.add(i);
        });
    }
}
/** Melhor nível (1 exato, 0,7 prefixo, 0,5 digitação) da palavra em cada produto. */
function niveisDaPalavra(indice, palavra) {
    const m = new Map();
    casamentos(indice, palavra, (posicoes, nivel) => {
        for (const i of posicoes)
            if ((m.get(i) ?? 0) < nivel)
                m.set(i, nivel);
    });
    return m;
}
const indices = new WeakMap();
/** Índice da lista (guardado enquanto a lista for o mesmo objeto; o repositório troca a lista quando o cadastro muda). */
export function indiceDe(produtos, anoAtual) {
    const i = indices.get(produtos);
    if (i && i.anoAtual === anoAtual)
        return i;
    const novo = construirIndiceBusca(produtos, anoAtual);
    indices.set(produtos, novo);
    return novo;
}
/** Marca e linha do filtro (os de preço e estoque já foram descartados: nesses casos não há pré-seleção): compara as chaves prontas do índice. */
function passaCadastro(indice, i, marca, linha) {
    return (marca === null || indice.marcaChave[i] === marca) && (linha === null || indice.categoriaChave[i] === linha);
}
/**
 * Pré-seleção da busca (T-0119): os produtos ativos que podem aparecer no resultado e o `maxVendas` do ranking completo.
 * `null` = não vale pré-selecionar (catálogo pequeno, sem texto nem código, nota semântica, filtro de preço ou de estoque,
 * ou "só vendáveis", que dependem do cartão de cada produto): o chamador usa a lista inteira, como antes.
 * Invariante (testada contra `buscarProdutos` sobre a lista inteira): mesmos itens, mesma ordem, mesmo `total`.
 */
export function candidatosDaBusca(e) {
    if (e.produtos.length < (e.minimo ?? MINIMO_PARA_INDICE))
        return null;
    if ((e.semantica?.size ?? 0) > 0 || e.chips?.only_sellable)
        return null;
    const filtros = filtrosParaPerfil(aplicarChips(e.filtros, e.chips ?? {}), e.contexto.perfil, e.contexto.parametros);
    if (filtros.min_price_cents !== null || filtros.max_price_cents !== null || filtros.stock !== null)
        return null;
    const grupos = expandirSinonimos(filtros.text, e.sinonimos);
    if (grupos.length === 0 && !filtros.code)
        return null;
    const anoAtual = e.anoAtual ?? anoCivilNoFuso(e.contexto.agora, e.fuso);
    const indice = indiceDe(e.produtos, anoAtual);
    const marcaDoFiltro = filtros.brand === null ? null : chaveDeTermo(filtros.brand);
    const linhaDoFiltro = filtros.line === null ? null : chaveDeTermo(filtros.line);
    const entra = (i) => entraNaVitrine(e.produtos[i], e.chips) && passaCadastro(indice, i, marcaDoFiltro, linhaDoFiltro);
    const saida = (posicoes) => {
        const ordenadas = [...posicoes].sort((a, b) => a - b);
        return { produtos: ordenadas.map((i) => e.produtos[i]), maxVendas: 0 };
    };
    // código exato (SKU, EAN, referência): se achou, só eles entram (igual ao `rankear`)
    if (filtros.code) {
        const v = codigoCompacto(filtros.code.value);
        const achados = new Set();
        // o índice só aponta; quem decide se o código casa é a mesma função do ranking (`casaComCodigo`)
        for (const i of indice.porCodigo.get(filtros.code.value) ?? [])
            if (casaComCodigo(e.produtos[i], filtros.code))
                achados.add(i);
        if (filtros.code.type !== 'ean' && v !== '')
            for (const i of indice.porCodigo.get(v) ?? [])
                if (casaComCodigo(e.produtos[i], filtros.code))
                    achados.add(i);
        const validos = [...achados].filter(entra);
        if (validos.length > 0) {
            const r = saida(validos);
            return { ...r, maxVendas: r.produtos.reduce((m, p) => Math.max(m, p.vendas), 0) };
        }
        if (grupos.length === 0)
            return { produtos: [], maxVendas: 0 };
    }
    // maior venda do universo que o ranking completo enxergaria (todo ativo que passa nos filtros de cadastro)
    let maxVendas = 0;
    if (marcaDoFiltro === null && linhaDoFiltro === null && !e.chips?.campaign && !e.chips?.only_product_ids)
        maxVendas = indice.maxVendasAtivos;
    else
        for (let i = 0; i < e.produtos.length; i++)
            if (e.produtos[i].vendas > maxVendas && entra(i))
                maxVendas = e.produtos[i].vendas;
    // por campo (texto × aplicação), por grupo: a melhor alternativa (todas as palavras dela casam; vale o menor nível)
    const palavras = new Set();
    for (const g of grupos)
        for (const alt of g)
            for (const w of alt.split(' '))
                if (w)
                    palavras.add(w);
    const doGrupo = (sub, g) => {
        const niveis = new Map();
        for (const w of palavras)
            niveis.set(w, niveisDaPalavra(sub, w));
        const melhor = new Map();
        for (const alt of g) {
            const ws = alt.split(' ').filter(Boolean);
            if (ws.length === 0)
                continue;
            const atual = new Map(niveis.get(ws[0]));
            for (const w of ws.slice(1)) {
                const outro = niveis.get(w);
                for (const [i, n] of atual) {
                    const o = outro.get(i);
                    if (o === undefined)
                        atual.delete(i);
                    else if (o < n)
                        atual.set(i, o);
                }
            }
            for (const [i, n] of atual)
                if ((melhor.get(i) ?? 0) < n)
                    melhor.set(i, n);
        }
        return melhor;
    };
    const porGrupo = grupos.map((g) => ({ texto: doGrupo(indice.texto, g), aplicacao: doGrupo(indice.aplicacao, g), ano: g.filter((alt) => ANO_RE.test(alt)).map(Number), palavra: g.some((alt) => /[a-z]/.test(alt)) }));
    const alvo = new Set();
    for (const x of porGrupo) {
        for (const i of x.texto.keys())
            alvo.add(i);
        for (const i of x.aplicacao.keys())
            alvo.add(i);
    }
    // as palavras soltas também entram (um grupo de sinônimos pode ter alternativa com várias palavras): superset exato como antes
    for (const w of palavras)
        posicoesDaPalavra(indice, w, alvo);
    // n-gramas de código ("cb 3401" → "cb3401") e o código do filtro
    const porCodigo = new Set();
    for (const c of codigosDaConsulta(filtros.text))
        for (const i of indice.porCodigo.get(c) ?? []) {
            alvo.add(i);
            porCodigo.add(i);
        }
    const posicoes = [...alvo].filter(entra).sort((a, b) => a - b);
    const pre = posicoes.map((i) => {
        if (porCodigo.has(i))
            return { pontos: 1, exato: true, soAplicacao: false };
        let soma = 0;
        let casados = 0;
        let casadosSoAplicacao = 0;
        let casouPalavra = false;
        let tiraPeloAno = false;
        for (const x of porGrupo) {
            const fora = x.texto.get(i) ?? 0;
            const melhor = Math.max(fora, (x.aplicacao.get(i) ?? 0) * PESO_APLICACAO);
            // RN-CAT-12: o ano da consulta que a aplicação (com anos) não cobre tira o produto, salvo se o grupo casar em outro campo
            const anos = indice.anos[i];
            if (anos && fora === 0 && x.ano.length > 0 && !x.ano.some((a) => anos.includes(a)))
                tiraPeloAno = true;
            if (melhor > 0) {
                casados++;
                if (fora === 0)
                    casadosSoAplicacao++;
                if (x.palavra)
                    casouPalavra = true;
            }
            soma += melhor;
        }
        // número solto não basta quando a consulta também tem palavras (como em `pontuacaoTextual`)
        const temPalavra = porGrupo.some((x) => x.palavra);
        const zerado = tiraPeloAno || (temPalavra && !casouPalavra);
        return { pontos: zerado ? 0 : arred(soma / Math.max(1, grupos.length)), exato: false, soAplicacao: casados > 0 && casadosSoAplicacao === casados };
    });
    return { produtos: posicoes.map((i) => e.produtos[i]), pre, maxVendas };
}
const ANO_RE = /^(19|20)d{2}$/;
/** `peso_aplicacao` padrão (RN-CAT-12); a nota barata não lê o parâmetro do tenant. */
const PESO_APLICACAO = 0.5;
const arred = (n) => Math.round(n * 1e6) / 1e6;
/**
 * Corte dos candidatos antes do ranking completo (T-0119, D-T0107b): o ranking custa ~0,3 ms por produto, e num catálogo de 20 mil
 * uma consulta comum ("pastilha de freio") deixa milhares de candidatos. Acima de `teto`, ficam os melhores por uma nota barata:
 * a mesma conta do ranking (`notaFinal`: boosts de estoque, mais vendido e campanha, exato primeiro) sobre os acertos do índice,
 * com o desempate do ranking. O contexto só precisa do estoque (sem preço: preço não entra na nota, e quem filtra por preço não
 * pré-seleciona). DIFERENÇA ACEITA: a nota barata ignora o peso do campo (nome 1, marca 0,6, categoria 0,4, atributo 0,3,
 * aplicação 0,5), que só o ranking completo aplica; um produto fora do corte por isso pode ser trocado por outro de nota
 * textual um pouco menor. O `maxVendas` não muda e a primeira página de 20 itens bate com o ranking completo nos casos de teste.
 */
export function cortarCandidatos(c, contexto, teto = TETO_CANDIDATOS) {
    const pre = c.pre;
    if (!pre || c.produtos.length <= teto)
        return c;
    const p = contexto.parametros;
    // nota textual 0 no ranking (ano fora da aplicação, ou só número): o produto não entra
    const vivos = c.produtos.map((_, k) => k).filter((k) => pre[k].exato || pre[k].pontos > 0);
    // classes da ordem do ranking: 0 exato, 1 casou fora da aplicação, 2 só pela aplicação (RN-CAT-12). Nenhum boost soma mais que
    // `maiorBoost`: quem tem nota-base a mais que isso abaixo do último que cabe na própria classe (e depois das classes melhores) não entra, e nem é medido.
    const maiorBoost = p.peso_estoque + p.peso_mais_vendido + p.peso_campanha;
    const classe = (k) => (pre[k].exato ? 0 : pre[k].soAplicacao ? 2 : 1);
    const bases = [[], [], []];
    for (const k of vivos)
        bases[classe(k)].push(pre[k].pontos);
    for (const l of bases)
        l.sort((x, y) => y - x);
    const pisoDa = (cl) => {
        const adiante = bases.slice(0, cl).reduce((s, l) => s + l.length, 0);
        const resta = teto - adiante;
        if (resta <= 0)
            return Infinity;
        return (bases[cl][resta - 1] ?? -Infinity) - maiorBoost;
    };
    const pisos = [-Infinity, pisoDa(1), pisoDa(2)];
    const linhas = vivos.flatMap((k) => {
        const produto = c.produtos[k];
        const { pontos, exato, soAplicacao } = pre[k];
        if (!exato && pontos < pisos[classe(k)])
            return [];
        const tem = temEstoqueParaBusca(produto, contexto);
        const nota = notaFinal(exato ? 1 : pontos, { estoque: tem ? 1 : 0, vendas_norm: c.maxVendas > 0 ? produto.vendas / c.maxVendas : 0, campanha: produto.campanha }, p);
        return [{ k, produto, pontos, exato, soAplicacao, nota, tem, chave: null }];
    });
    const chaveDe = (x) => (x.chave ??= nomeChave(x.produto));
    const melhores = linhas
        .sort((a, b) => Number(b.exato) - Number(a.exato) ||
        Number(a.soAplicacao) - Number(b.soAplicacao) ||
        b.nota - a.nota ||
        b.pontos - a.pontos ||
        Number(b.tem) - Number(a.tem) ||
        b.produto.vendas - a.produto.vendas ||
        cmp(chaveDe(a), chaveDe(b)) ||
        cmp(a.produto.id, b.produto.id))
        .slice(0, teto)
        .sort((a, b) => a.k - b.k);
    return { produtos: melhores.map((x) => x.produto), pre: melhores.map((x) => pre[x.k]), maxVendas: c.maxVendas };
}
