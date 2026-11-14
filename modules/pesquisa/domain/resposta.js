import { calcularVisiveis } from './condicional';
import { PARAMETROS_PADRAO } from './parametros';
import { avisarItem, itemRespondido, validarItem } from './resposta-item';
import { instanteMs } from './util';
/**
 * RN-PES-01: valida a resposta contra a versão que ela referencia (mesmo que exista uma mais nova).
 * RF-PES-01: tipo, limites, opções e obrigatoriedade; obrigatória OCULTA pelas regras condicionais não é exigida.
 */
export function validarResposta(versao, resposta, opcoes = {}) {
    const modo = opcoes.modo ?? 'final';
    const parametros = opcoes.parametros ?? PARAMETROS_PADRAO;
    const erros = [];
    const avisos = [];
    const falhar = (codigo, mensagem, pergunta_id = null) => erros.push({ codigo, pergunta_id, mensagem });
    if (resposta.versao_id !== versao.id || resposta.questionario_id !== versao.questionario_id) {
        falhar('VERSAO_INEXISTENTE', 'A resposta é de outra versão do questionário. Atualize o app e responda de novo.');
        return { valida: false, erros, avisos };
    }
    if (versao.status !== 'publicada') {
        falhar('VERSAO_NAO_PUBLICADA', 'Essa versão do questionário ainda não foi publicada, então não recebe respostas.');
        return { valida: false, erros, avisos };
    }
    const definicao = new Map(versao.perguntas.map((p) => [p.id, p]));
    const vistos = new Set();
    const unicos = [];
    for (const it of resposta.itens) {
        const p = definicao.get(it.pergunta_id);
        if (!p) {
            falhar('PERGUNTA_DESCONHECIDA', 'A resposta traz uma pergunta que não existe nesta versão do questionário. Atualize o app.', it.pergunta_id);
            continue;
        }
        if (vistos.has(it.pergunta_id)) {
            falhar('PERGUNTA_REPETIDA', `A pergunta "${p.enunciado}" foi respondida mais de uma vez. Mantenha só uma resposta.`, it.pergunta_id);
            continue;
        }
        vistos.add(it.pergunta_id);
        unicos.push(it);
    }
    const respondidos = unicos.filter(itemRespondido);
    const visiveis = new Set(calcularVisiveis(versao.perguntas, versao.regras, respondidos).filter((v) => v.visivel).map((v) => v.pergunta_id));
    for (const it of respondidos) {
        const p = definicao.get(it.pergunta_id);
        if (!visiveis.has(p.id)) {
            falhar('PERGUNTA_OCULTA', `A pergunta "${p.enunciado}" está oculta pelas respostas anteriores e não deve ser respondida. Apague essa resposta.`, p.id);
            continue;
        }
        erros.push(...validarItem(p, it, parametros));
        avisos.push(...avisarItem(p, it));
    }
    if (modo === 'final') {
        const feitas = new Set(respondidos.map((i) => i.pergunta_id));
        for (const p of versao.perguntas) {
            if (p.obrigatoria && visiveis.has(p.id) && !feitas.has(p.id))
                falhar('OBRIGATORIA', `Responda a pergunta obrigatória "${p.enunciado}".`, p.id);
        }
        if (respondidos.length === 0 && erros.length === 0)
            falhar('SEM_RESPOSTAS', 'Responda ao menos uma pergunta antes de enviar.');
    }
    return { valida: erros.length === 0, erros, avisos };
}
const HORA_MS = 3_600_000;
const TEXTO_SUSPEITA = {
    RELOGIO_ADIANTADO: 'A hora do aparelho estava adiantada em relação ao servidor.',
    ANTES_DA_VIGENCIA: 'A resposta foi feita antes de a pesquisa começar a valer.',
    APOS_A_VIGENCIA: 'A resposta foi feita depois do fim da vigência da pesquisa.',
};
/**
 * RN-PES-04: a resposta guarda a hora do aparelho e o servidor grava `recebido_em`. O prazo usa a hora do APARELHO
 * (resposta feita offline no prazo vale mesmo sincronizada depois), com tolerância de [24 h] nas duas pontas. Relógio
 * adiantado além da tolerância ou resposta fora da vigência: ACEITA e SINALIZADA (suspeita), nunca recusada.
 */
export function avaliarRecebimentoDaResposta(vigencia, horas, tolerancia_h) {
    const tol = tolerancia_h * HORA_MS;
    const feita = instanteMs(horas.respondida_em);
    const motivos = [];
    if (feita > instanteMs(horas.recebida_em) + tol)
        motivos.push('RELOGIO_ADIANTADO');
    if (feita < instanteMs(vigencia.inicio) - tol)
        motivos.push('ANTES_DA_VIGENCIA');
    else if (vigencia.fim !== null && feita > instanteMs(vigencia.fim) + tol)
        motivos.push('APOS_A_VIGENCIA');
    return { aceita: true, suspeita: motivos.length > 0, motivos, mensagem: motivos.length ? motivos.map((m) => TEXTO_SUSPEITA[m]).join(' ') : null };
}
