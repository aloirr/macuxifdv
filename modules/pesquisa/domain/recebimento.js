import { decidirInsercao } from './idempotencia';
import { resolverParametros } from './parametros';
import { perfilNoPublico } from './publico';
import { versaoDaResposta } from './questionario';
import { avaliarRecebimentoDaResposta, validarResposta } from './resposta';
import { falha, ok } from './util';
/** RF-PES-04 / RN-PES-04: decide o que fazer com a resposta recebida. Nunca recusa por relógio, vigência ou arquivamento. */
export function receberResposta(e) {
    const parametros = resolverParametros(e.parametros);
    if (e.existente) {
        const d = decidirInsercao(e.existente, e.envio);
        if (d.resultado === 'duplicada')
            return ok({ resultado: 'duplicada', resposta: e.existente });
        if (d.resultado === 'conflito')
            return falha(d.codigo, d.mensagem);
    }
    const v = versaoDaResposta(e.versoes, e.envio);
    if (!v.ok)
        return v;
    const versao = v.valor;
    if (!perfilNoPublico(versao.publico_alvo, e.usuario)) {
        return falha('PERFIL_FORA_DO_PUBLICO', 'Esta pesquisa não é para o seu perfil. Atualize o app para ver as pesquisas disponíveis para você.');
    }
    const validacao = validarResposta(versao, e.envio, { modo: 'final', parametros });
    if (!validacao.valida) {
        return falha('RESPOSTA_INVALIDA', `A resposta tem ${validacao.erros.length} problema(s): ${validacao.erros[0].mensagem}`, validacao.erros);
    }
    const aval = avaliarRecebimentoDaResposta(versao.vigencia, { respondida_em: e.envio.respondida_em, recebida_em: e.recebida_em }, parametros.tolerancia_vigencia_h);
    const resposta = {
        ...e.envio,
        tenant_id: e.tenant_id,
        usuario_id: e.usuario.id,
        equipe_id: e.usuario.equipe_id,
        recebida_em: e.recebida_em,
        suspeita: aval.suspeita,
        motivos_suspeita: aval.motivos,
    };
    const evento = {
        resposta_id: resposta.id,
        tenant_id: e.tenant_id,
        questionario_id: resposta.questionario_id,
        versao_id: resposta.versao_id,
        usuario_id: resposta.usuario_id,
        equipe_id: resposta.equipe_id,
        cliente_id: resposta.cliente_id,
        visita_id: resposta.visita_id,
        modo: versao.modo,
        respondida_em: resposta.respondida_em,
        recebida_em: resposta.recebida_em,
        total_itens: resposta.itens.length,
        suspeita: aval.suspeita,
    };
    return ok({ resultado: 'inserir', resposta, evento, avisos: validacao.avisos });
}
