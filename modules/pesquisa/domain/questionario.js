import { validarRegras } from './condicional';
import { PARAMETROS_PADRAO } from './parametros';
import { congelarProfundo, falha, instanteMs, ok } from './util';
const profunda = (x) => structuredClone(x);
/** RF-PES-05: a primeira versão do questionário, vazia e em rascunho. */
export function criarPrimeiraVersao(a) {
    return {
        id: a.id,
        questionario_id: a.questionario_id,
        tenant_id: a.tenant_id,
        numero: 1,
        status: 'rascunho',
        titulo: a.titulo,
        modo: 'avulsa',
        frequencia: 'a_cada_visita',
        publico_alvo: { perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] },
        vigencia: { inicio: a.agora, fim: null },
        perguntas: [],
        regras: [],
        criada_em: a.agora,
        publicada_em: null,
        publicada_por: null,
    };
}
/** RN-PES-01: só rascunho muda. A API chama isto antes de qualquer UPDATE em versão. */
export function podeAlterarVersao(versao) {
    if (versao.status === 'publicada') {
        return falha('VERSAO_PUBLICADA_IMUTAVEL', 'Esta versão já foi publicada e não pode mudar. Crie uma nova versão para editar o questionário.');
    }
    return ok(true);
}
/** RF-PES-01: aplica as alterações no rascunho (devolve uma cópia). */
export function editarRascunho(versao, alteracoes) {
    const p = podeAlterarVersao(versao);
    if (!p.ok)
        return p;
    return ok({ ...profunda(versao), ...profunda(alteracoes) });
}
/**
 * RF-PES-05: "editar" um questionário. Com rascunho aberto, continua nele; senão copia a versão de maior número em
 * um novo rascunho (número + 1). Os ids de perguntas e opções são mantidos, para comparar resultados entre versões.
 */
export function iniciarEdicao(versoes, a) {
    const aberto = versoes.find((v) => v.status === 'rascunho');
    if (aberto)
        return ok({ versao: aberto, criada: false });
    if (versoes.length === 0)
        return falha('SEM_VERSAO', 'Este questionário ainda não tem versão. Crie o questionário antes de editar.');
    const base = versoes.reduce((x, y) => (y.numero > x.numero ? y : x));
    return ok({
        criada: true,
        versao: { ...profunda(base), id: a.novo_id, numero: base.numero + 1, status: 'rascunho', criada_em: a.agora, publicada_em: null, publicada_por: null },
    });
}
/** RN-PES-01: a versão vigente é a publicada de maior número; arquivado ou sem publicada = `null`. */
export function versaoVigente(questionario, versoes) {
    if (questionario.arquivado_em !== null)
        return null;
    let melhor = null;
    for (const v of versoes)
        if (v.status === 'publicada' && (melhor === null || v.numero > melhor.numero))
            melhor = v;
    return melhor;
}
/** RN-PES-01: acha a versão que a resposta cita (a vigente no momento em que o aparelho baixou). */
export function versaoDaResposta(versoes, resposta) {
    const v = versoes.find((x) => x.id === resposta.versao_id && x.questionario_id === resposta.questionario_id);
    if (!v)
        return falha('VERSAO_INEXISTENTE', 'A versão do questionário citada pela resposta não existe. Atualize o app e responda de novo.');
    if (v.status !== 'publicada')
        return falha('VERSAO_NAO_PUBLICADA', 'Essa versão do questionário ainda não foi publicada, então não recebe respostas.');
    return ok(v);
}
const rotulo = (p) => `"${p.enunciado}"`;
/** RF-PES-01, RF-PES-02: erros (impedem publicar) e avisos da versão. */
export function validarVersao(versao, parametros = PARAMETROS_PADRAO) {
    const erros = [];
    const avisos = [];
    const { perguntas } = versao;
    if (perguntas.length === 0)
        erros.push({ codigo: 'SEM_PERGUNTAS', mensagem: 'Adicione ao menos uma pergunta antes de publicar.' });
    if (perguntas.length > parametros.max_perguntas)
        erros.push({ codigo: 'LIMITE_PERGUNTAS', mensagem: `O questionário tem ${perguntas.length} perguntas; o limite é ${parametros.max_perguntas}. Divida em dois questionários.` });
    if (new Set(perguntas.map((p) => p.id)).size !== perguntas.length)
        erros.push({ codigo: 'IDS_REPETIDOS', mensagem: 'Há perguntas com o mesmo id. Recrie a pergunta duplicada.' });
    for (const p of perguntas) {
        if (p.tipo === 'unica' || p.tipo === 'multipla') {
            if (new Set(p.opcoes.map((o) => o.id)).size !== p.opcoes.length)
                erros.push({ codigo: 'IDS_REPETIDOS', pergunta_id: p.id, mensagem: `${rotulo(p)} tem opções com o mesmo id. Recrie a opção duplicada.` });
            if (p.opcoes.length > parametros.max_opcoes_por_pergunta) {
                erros.push({ codigo: 'LIMITE_OPCOES', pergunta_id: p.id, mensagem: `${rotulo(p)} tem ${p.opcoes.length} opções; o limite é ${parametros.max_opcoes_por_pergunta}. Reduza as opções.` });
            }
            const rotulos = p.opcoes.map((o) => o.rotulo.trim().toLowerCase());
            if (new Set(rotulos).size !== rotulos.length)
                avisos.push({ codigo: 'ROTULOS_REPETIDOS', pergunta_id: p.id, mensagem: `${rotulo(p)} tem opções com o mesmo texto. Quem responde não vai conseguir distinguir.` });
        }
        if (p.tipo === 'multipla') {
            const min = p.min_selecoes ?? 1;
            const max = p.max_selecoes ?? p.opcoes.length;
            if (min > max || max > p.opcoes.length)
                erros.push({ codigo: 'SELECOES_INVALIDAS', pergunta_id: p.id, mensagem: `${rotulo(p)} pede de ${min} a ${max} seleções, mas só tem ${p.opcoes.length} opções. Ajuste o mínimo e o máximo.` });
        }
        if (p.tipo === 'escala' && (p.maximo <= p.minimo || p.maximo - p.minimo > parametros.escala_amplitude_max)) {
            erros.push({ codigo: 'ESCALA_AMPLITUDE', pergunta_id: p.id, mensagem: `${rotulo(p)}: a escala precisa ter no máximo ${parametros.escala_amplitude_max} pontos de diferença entre o início e o fim, com o fim maior que o início.` });
        }
        if (p.tipo === 'foto' && p.max_fotos > parametros.max_fotos_por_pergunta) {
            erros.push({ codigo: 'FOTOS_ACIMA_DO_LIMITE', pergunta_id: p.id, mensagem: `${rotulo(p)} aceita ${p.max_fotos} fotos; o limite do tenant é ${parametros.max_fotos_por_pergunta}. Reduza o máximo de fotos.` });
        }
        if (p.tipo === 'texto' && (p.max_caracteres ?? 0) > parametros.texto_max_caracteres) {
            erros.push({ codigo: 'TEXTO_ACIMA_DO_LIMITE', pergunta_id: p.id, mensagem: `${rotulo(p)} aceita ${p.max_caracteres} caracteres; o limite do tenant é ${parametros.texto_max_caracteres}. Reduza o máximo.` });
        }
    }
    const { inicio, fim } = versao.vigencia;
    if (fim !== null && instanteMs(fim) < instanteMs(inicio))
        erros.push({ codigo: 'VIGENCIA_INVALIDA', mensagem: 'O fim da vigência não pode ser anterior ao início. Ajuste as datas.' });
    const p = versao.publico_alvo;
    const semCriterio = [p.perfis, p.equipes, p.segmentos, p.regioes, p.canais, p.clientes].every((l) => l.length === 0);
    if (semCriterio)
        avisos.push({ codigo: 'PUBLICO_ABERTO', mensagem: 'Nenhum público-alvo definido: a pesquisa vale para todos os perfis de campo do tenant.' });
    const regras = validarRegras(perguntas, versao.regras);
    erros.push(...regras.erros);
    avisos.push(...regras.avisos);
    return { erros, avisos };
}
/** RN-PES-01: publica o rascunho — valida, grava quem/quando e congela. A API audita (RN-AUD-01). */
export function publicarVersao(versao, a) {
    const p = podeAlterarVersao(versao);
    if (!p.ok)
        return p;
    const maisNova = (a.outras_versoes ?? []).find((v) => v.status === 'publicada' && v.numero > versao.numero);
    if (maisNova)
        return falha('VERSAO_ANTIGA', `Já existe a versão ${maisNova.numero} publicada, mais nova que esta (${versao.numero}). Edite a versão mais recente.`);
    const { erros } = validarVersao(versao, a.parametros ?? PARAMETROS_PADRAO);
    if (versao.vigencia.fim !== null && instanteMs(versao.vigencia.fim) < instanteMs(a.agora)) {
        erros.push({ codigo: 'VIGENCIA_ENCERRADA', mensagem: 'A vigência já terminou. Ajuste a data final para o futuro antes de publicar.' });
    }
    if (erros.length > 0)
        return falha('VERSAO_INVALIDA', `Corrija ${erros.length} problema(s) antes de publicar: ${erros[0].mensagem}`, erros);
    return ok(congelarProfundo({ ...profunda(versao), status: 'publicada', publicada_em: a.agora, publicada_por: a.publicado_por }));
}
