import { itemRespondido } from './resposta-item';
import { ehDataCivil } from './util';
const TODOS_COM_RESPOSTA = ['respondida', 'nao_respondida'];
const COMPARACAO = ['maior_que', 'maior_ou_igual', 'menor_que', 'menor_ou_igual'];
/** Operadores permitidos por tipo da pergunta de origem. */
const OPERADORES_DO_TIPO = {
    sim_nao: ['igual', 'diferente', ...TODOS_COM_RESPOSTA],
    unica: ['igual', 'diferente', ...TODOS_COM_RESPOSTA],
    multipla: ['contem', 'nao_contem', ...TODOS_COM_RESPOSTA],
    numero: ['igual', 'diferente', ...COMPARACAO, ...TODOS_COM_RESPOSTA],
    escala: ['igual', 'diferente', ...COMPARACAO, ...TODOS_COM_RESPOSTA],
    texto: ['igual', 'diferente', ...TODOS_COM_RESPOSTA],
    data: ['igual', 'diferente', ...COMPARACAO, ...TODOS_COM_RESPOSTA],
    foto: [...TODOS_COM_RESPOSTA],
    codigo_barras: ['igual', 'diferente', ...TODOS_COM_RESPOSTA],
};
const rotuloDe = (p) => `"${p.enunciado}"`;
const normalizar = (s) => s.trim().toLowerCase();
function valorCombinaComTipo(origem, valor) {
    switch (origem.tipo) {
        case 'sim_nao':
            return typeof valor === 'boolean';
        case 'unica':
        case 'multipla':
            return typeof valor === 'string' && origem.opcoes.some((o) => o.id === valor);
        case 'numero':
        case 'escala':
            return typeof valor === 'number' && Number.isFinite(valor);
        case 'texto':
        case 'codigo_barras':
            return typeof valor === 'string' && valor.trim().length > 0;
        case 'data':
            return ehDataCivil(valor);
        case 'foto':
            return false;
    }
}
/** Avalia UMA regra contra a resposta da pergunta de origem (`undefined` = sem resposta). */
export function avaliarCondicao(origem, item, regra) {
    const respondido = item !== undefined && item.tipo === origem.tipo && itemRespondido(item);
    if (regra.operador === 'respondida')
        return respondido;
    if (regra.operador === 'nao_respondida')
        return !respondido;
    if (!respondido || item === undefined)
        return false;
    const v = regra.valor;
    switch (item.tipo) {
        case 'sim_nao':
            return regra.operador === 'igual' ? item.valor === v : regra.operador === 'diferente' ? typeof v === 'boolean' && item.valor !== v : false;
        case 'unica':
            return regra.operador === 'igual' ? item.opcao_id === v : regra.operador === 'diferente' ? typeof v === 'string' && item.opcao_id !== v : false;
        case 'multipla': {
            if (typeof v !== 'string')
                return false;
            if (regra.operador === 'contem')
                return item.opcao_ids.includes(v);
            if (regra.operador === 'nao_contem')
                return !item.opcao_ids.includes(v);
            return false;
        }
        case 'numero':
            return comparar(item.numero, regra.operador, v);
        case 'escala':
            return comparar(item.valor, regra.operador, v);
        case 'data':
            return comparar(item.data, regra.operador, v);
        case 'texto':
            return typeof v === 'string' ? compararIgualdade(normalizar(item.texto), regra.operador, normalizar(v)) : false;
        case 'codigo_barras':
            return typeof v === 'string' ? compararIgualdade(normalizar(item.codigo), regra.operador, normalizar(v)) : false;
        case 'foto':
            return false;
    }
}
function compararIgualdade(a, op, b) {
    if (op === 'igual')
        return a === b;
    if (op === 'diferente')
        return a !== b;
    return false;
}
function comparar(a, op, b) {
    if (typeof a !== typeof b)
        return false;
    const x = a;
    const y = b;
    switch (op) {
        case 'igual':
            return x === y;
        case 'diferente':
            return x !== y;
        case 'maior_que':
            return x > y;
        case 'maior_ou_igual':
            return x >= y;
        case 'menor_que':
            return x < y;
        case 'menor_ou_igual':
            return x <= y;
        default:
            return false;
    }
}
/**
 * RF-PES-01: quais perguntas aparecem dadas as respostas. Percorre na ordem do questionário; a resposta de pergunta
 * oculta (ou que ainda não veio na ordem) não alimenta regra nenhuma. Resultado na ordem das perguntas.
 */
export function calcularVisiveis(perguntas, regras, itens) {
    const porPergunta = new Map();
    for (const i of itens)
        if (!porPergunta.has(i.pergunta_id))
            porPergunta.set(i.pergunta_id, i);
    const definicao = new Map(perguntas.map((p) => [p.id, p]));
    const visiveis = new Set();
    const saida = [];
    const verdadeira = (r) => {
        const origem = definicao.get(r.origem_id);
        if (!origem)
            return false;
        const resp = visiveis.has(r.origem_id) ? porPergunta.get(r.origem_id) : undefined;
        return avaliarCondicao(origem, resp, r);
    };
    for (const p of perguntas) {
        const mostrar = regras.filter((r) => r.pergunta_id === p.id && r.acao === 'mostrar');
        const ocultar = regras.filter((r) => r.pergunta_id === p.id && r.acao === 'ocultar');
        let visivel = true;
        let motivo = 'sem_regra';
        if (mostrar.length > 0) {
            visivel = mostrar.some(verdadeira);
            motivo = visivel ? 'regra_mostrar' : 'sem_regra_mostrar_verdadeira';
        }
        if (visivel && ocultar.some(verdadeira)) {
            visivel = false;
            motivo = 'regra_ocultar';
        }
        if (visivel)
            visiveis.add(p.id);
        saida.push({ pergunta_id: p.id, visivel, motivo });
    }
    return saida;
}
export function perguntasVisiveis(perguntas, regras, itens) {
    const v = new Set(calcularVisiveis(perguntas, regras, itens).filter((x) => x.visivel).map((x) => x.pergunta_id));
    return perguntas.filter((p) => v.has(p.id));
}
/** Tira as respostas de perguntas que ficaram ocultas (o app chama a cada mudança de resposta). */
export function descartarRespostasOcultas(perguntas, regras, itens) {
    const v = new Set(calcularVisiveis(perguntas, regras, itens).filter((x) => x.visivel).map((x) => x.pergunta_id));
    return itens.filter((i) => v.has(i.pergunta_id));
}
// ---------------------------------------------------------------------------------------------
// Validação das regras no construtor (RF-PES-01)
// ---------------------------------------------------------------------------------------------
/** A pergunta é respondida sempre que aparece? (obrigatória e sem regra de visibilidade) */
function sempreRespondida(p, regras) {
    return p.obrigatoria && !regras.some((r) => r.pergunta_id === p.id);
}
function limites(origem) {
    if (origem.tipo === 'escala')
        return { min: origem.minimo, max: origem.maximo };
    if (origem.tipo === 'numero')
        return { min: origem.minimo ?? null, max: origem.maximo ?? null };
    if (origem.tipo === 'data')
        return { min: origem.minima ?? null, max: origem.maxima ?? null };
    return { min: null, max: null };
}
/** A condição pode ser verdadeira para alguma resposta válida da origem? */
function condicaoPossivel(origem, regra, regras) {
    if (regra.operador === 'respondida')
        return true;
    if (regra.operador === 'nao_respondida')
        return !sempreRespondida(origem, regras);
    if (origem.tipo !== 'escala' && origem.tipo !== 'numero' && origem.tipo !== 'data')
        return true;
    const v = regra.valor;
    const { min, max } = limites(origem);
    const abaixoDoMin = (x) => min !== null && x < min;
    const acimaDoMax = (x) => max !== null && x > max;
    switch (regra.operador) {
        case 'igual':
            if (origem.tipo === 'escala' && !Number.isInteger(v))
                return false;
            if (origem.tipo === 'numero' && origem.inteiro && !Number.isInteger(v))
                return false;
            return !abaixoDoMin(v) && !acimaDoMax(v);
        case 'maior_que':
            return max === null || v < max;
        case 'maior_ou_igual':
            return !acimaDoMax(v);
        case 'menor_que':
            return min === null || v > min;
        case 'menor_ou_igual':
            return !abaixoDoMin(v);
        default:
            return true;
    }
}
/** RF-PES-01: erros (impedem publicar) e avisos (não impedem) das regras de um questionário. */
export function validarRegras(perguntas, regras) {
    const erros = [];
    const avisos = [];
    const indice = new Map(perguntas.map((p, i) => [p.id, i]));
    const def = new Map(perguntas.map((p) => [p.id, p]));
    const validas = [];
    for (const r of regras) {
        const alvo = def.get(r.pergunta_id);
        const origem = def.get(r.origem_id);
        if (!alvo) {
            erros.push({ codigo: 'REGRA_ALVO_INEXISTENTE', regra_id: r.id, mensagem: 'Uma regra aponta para uma pergunta que não existe mais. Apague a regra ou recrie a pergunta.' });
            continue;
        }
        if (!origem) {
            erros.push({ codigo: 'REGRA_ORIGEM_INEXISTENTE', regra_id: r.id, pergunta_id: alvo.id, mensagem: `A regra de ${rotuloDe(alvo)} olha uma pergunta que não existe mais. Escolha outra pergunta de origem.` });
            continue;
        }
        if (r.origem_id !== r.pergunta_id && indice.get(r.origem_id) > indice.get(r.pergunta_id)) {
            erros.push({
                codigo: 'REGRA_ORIGEM_NAO_ANTERIOR',
                regra_id: r.id,
                pergunta_id: alvo.id,
                mensagem: `A regra de ${rotuloDe(alvo)} olha ${rotuloDe(origem)}, que vem depois. Uma regra só pode olhar uma pergunta anterior: mude a ordem ou escolha outra origem.`,
            });
            continue;
        }
        if (!OPERADORES_DO_TIPO[origem.tipo].includes(r.operador)) {
            erros.push({ codigo: 'REGRA_OPERADOR_INVALIDO', regra_id: r.id, pergunta_id: alvo.id, mensagem: `A regra de ${rotuloDe(alvo)} usa uma comparação que não vale para ${rotuloDe(origem)}. Escolha outro operador.` });
            continue;
        }
        if (r.operador !== 'respondida' && r.operador !== 'nao_respondida' && !valorCombinaComTipo(origem, r.valor)) {
            erros.push({ codigo: 'REGRA_VALOR_INVALIDO', regra_id: r.id, pergunta_id: alvo.id, mensagem: `O valor da regra de ${rotuloDe(alvo)} não combina com ${rotuloDe(origem)}. Escolha uma opção ou valor dela.` });
            continue;
        }
        validas.push(r);
    }
    // Ciclo: arestas alvo -> origem entre perguntas existentes (autorreferência é ciclo de tamanho 1).
    const arestas = new Map();
    for (const r of regras) {
        if (def.has(r.pergunta_id) && def.has(r.origem_id))
            arestas.set(r.pergunta_id, [...(arestas.get(r.pergunta_id) ?? []), r.origem_id]);
    }
    const estado = new Map();
    const vistos = new Set();
    const trilha = [];
    const visitar = (id) => {
        estado.set(id, 1);
        trilha.push(id);
        for (const prox of arestas.get(id) ?? []) {
            if (estado.get(prox) === 1) {
                const ciclo = trilha.slice(trilha.indexOf(prox));
                const chave = [...ciclo].sort().join('|');
                if (!vistos.has(chave)) {
                    vistos.add(chave);
                    const nomes = [...ciclo, prox].map((x) => rotuloDe(def.get(x))).join(' → ');
                    erros.push({ codigo: 'REGRA_CICLO', pergunta_id: prox, mensagem: `As regras formam um ciclo: ${nomes}. Remova uma delas para a pesquisa poder ser respondida.` });
                }
            }
            else if (!estado.has(prox))
                visitar(prox);
        }
        trilha.pop();
        estado.set(id, 2);
    };
    for (const p of perguntas)
        if (!estado.has(p.id))
            visitar(p.id);
    // Alcançabilidade (só com regras estruturalmente válidas), na ordem das perguntas.
    const alcancavel = new Map();
    for (const p of perguntas) {
        const mostrar = validas.filter((r) => r.pergunta_id === p.id && r.acao === 'mostrar');
        const ocultar = validas.filter((r) => r.pergunta_id === p.id && r.acao === 'ocultar');
        let ok = true;
        if (mostrar.length > 0) {
            ok = mostrar.some((r) => alcancavel.get(r.origem_id) !== false && condicaoPossivel(def.get(r.origem_id), r, regras));
        }
        if (ok && ocultar.some((r) => alcancavel.get(r.origem_id) !== false && condicaoSempreVerdadeira(def.get(r.origem_id), r, regras)))
            ok = false;
        alcancavel.set(p.id, ok);
        if (!ok) {
            avisos.push({
                codigo: 'PERGUNTA_INALCANCAVEL',
                pergunta_id: p.id,
                mensagem: `${rotuloDe(p)} nunca vai aparecer: as regras dela não podem ser verdadeiras. Revise as regras ou o tipo/limites da pergunta de origem.`,
            });
        }
    }
    return { erros, avisos };
}
/** Regra "ocultar" que é verdadeira sempre que a origem aparece (origem obrigatória e sempre visível + "respondida"). */
function condicaoSempreVerdadeira(origem, regra, regras) {
    return regra.operador === 'respondida' && sempreRespondida(origem, regras);
}
