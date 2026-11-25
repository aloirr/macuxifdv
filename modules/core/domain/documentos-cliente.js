/**
 * Documentação do Cliente 360 v2 (T-0186; decisões P5, P10, P11, P12, P15 e P16 de 19/11/2026). Funções puras, sem banco.
 * - A permissão é por TIPO e por PERFIL: "Não vê", "Vê" e "Vê e envia" ("Vê e envia" só nos tipos que o app captura, como Fotos do PDV).
 * - Administrador e Analista veem tudo. O tipo que o perfil não vê não aparece (P10).
 * - A exceção por documento só tira acesso do que o tipo libera (P11): a linha aparece com cadeado, "Sem permissão para abrir".
 * - O documento é só para ver (P15): a API devolve o arquivo do servidor; nada fica no aparelho. A API revalida tudo.
 */
import { diffDays } from '@macuxi/comum';
import { perfilRecebeHistoricoDeCompra } from './promotor-pedidos';
/** Perfis que veem tudo e não se configuram na matriz (spec §7). */
export const PERFIS_DOCUMENTO_VEEM_TUDO = ['admin', 'analista'];
const veTudo = (perfil) => PERFIS_DOCUMENTO_VEEM_TUDO.includes(perfil);
/** Nível do perfil no tipo. Admin e analista: sempre o máximo do tipo; sem linha na matriz = "Não vê". */
export function nivelDoTipo(matriz, tipo, perfil) {
    if (veTudo(perfil))
        return tipo.permite_envio ? 've_e_envia' : 've';
    const n = matriz.find((m) => m.tipo_id === tipo.id && m.perfil === perfil)?.nivel ?? 'nao_ve';
    return n === 've_e_envia' && !tipo.permite_envio ? 've' : n;
}
const ORDEM_NIVEL = { nao_ve: 0, ve: 1, ve_e_envia: 2 };
/**
 * Nível do USUÁRIO no tipo: o maior entre os perfis dele (basta um perfil ver; basta um enviar). `perfis` são os CÓDIGOS
 * (`plataforma.perfil.codigo`), os mesmos que a matriz guarda, inclusive de perfil personalizado. Sem perfil = "Não vê".
 */
export function nivelDoUsuario(matriz, tipo, perfis) {
    return perfis.map((p) => nivelDoTipo(matriz, tipo, p)).reduce((a, n) => (ORDEM_NIVEL[n] > ORDEM_NIVEL[a] ? n : a), 'nao_ve');
}
/** P11: a exceção do documento que pega QUALQUER perfil do usuário tira o acesso. Admin/analista (qualquer um dos perfis) não sofrem exceção. */
export function excecaoTiraAcesso(excecoes, documentoId, perfis) {
    if (perfis.some(veTudo))
        return false;
    return excecoes.some((e) => e.documento_id === documentoId && perfis.includes(e.perfil));
}
/**
 * RN-CORE-40: decisão única de abrir um documento, usada pela rota (`abrirDocumento`) e pela guarda do arquivo.
 * Tipo ausente, inativo ou "Não vê" = oculto (404); exceção do documento = sem permissão (403); senão liberado.
 */
export function decidirAbrirDocumento(e) {
    if (!e.tipo || !e.tipo.ativo || nivelDoUsuario(e.matriz, e.tipo, e.perfis) === 'nao_ve')
        return 'oculto';
    return excecaoTiraAcesso(e.excecoes, e.documentoId, e.perfis) ? 'sem_permissao' : 'liberado';
}
/**
 * RN-CORE-40: guarda do arquivo (`GET /v1/arquivos/:id`). `ehDocumento` = o arquivo é de um `core.documento_cliente`; se não,
 * `null` (não é do documento). Documento: precisa da licença do Core, do cliente na carteira e da decisão de abrir; senão `negado`.
 */
export function decidirLeituraArquivoDocumento(e) {
    if (!e.ehDocumento)
        return null;
    if (!e.licenciado || !e.naCarteira)
        return 'negado';
    return decidirAbrirDocumento(e) === 'liberado' ? 'liberado' : 'negado';
}
/** P10/P11: tipo "Não vê" = oculto; exceção por documento = bloqueado (cadeado); senão abre. */
export function acessoAoDocumento(nivelDoTipoNoPerfil, comExcecao) {
    if (nivelDoTipoNoPerfil === 'nao_ve')
        return 'oculto';
    return comExcecao ? 'bloqueado' : 'abrir';
}
/** P16: o vencimento aparece só na linha do documento. Vence hoje ainda vale. */
export function situacaoValidadeDocumento(validade, hoje) {
    if (!validade)
        return 'sem_validade';
    return diffDays(validade, hoje) > 0 ? 'vencido' : 'valido';
}
/** Lista da aba Documentação para os perfis do usuário: só tipos ativos que ele vê, por grupo e ordem do cadastro de tipos, depois por data (mais nova primeiro). */
export function documentosDaFicha(perfis, tipos, documentos, matriz, excecoes, hoje) {
    const porTipo = new Map(tipos.filter((t) => t.ativo).map((t) => [t.id, t]));
    const saida = [];
    for (const d of documentos) {
        const t = porTipo.get(d.tipo_id);
        if (!t)
            continue;
        const nivel = nivelDoUsuario(matriz, t, perfis);
        const comExcecao = excecaoTiraAcesso(excecoes, d.id, perfis);
        const acesso = acessoAoDocumento(nivel, comExcecao);
        if (acesso === 'oculto')
            continue;
        saida.push({ ...d, grupo: t.grupo, acesso, validade_situacao: situacaoValidadeDocumento(d.validade, hoje), pode_enviar: nivel === 've_e_envia', _ordem: t.ordem });
    }
    return saida.sort((a, b) => a._ordem - b._ordem || a.grupo.localeCompare(b.grupo) || b.data.localeCompare(a.data) || a.id.localeCompare(b.id)).map(({ _ordem, ...d }) => d);
}
/** Valida a matriz que o admin grava em BKO › Parâmetros › Documentos. */
export function validarMatrizDocumentos(tipos, linhas) {
    for (const l of linhas) {
        const t = tipos.find((x) => x.id === l.tipo_id);
        if (!t)
            return { ok: false, codigo: 'DOCUMENTO_TIPO_DESCONHECIDO', mensagem: 'Tipo de documento não encontrado. Atualize a página e tente de novo.' };
        if (veTudo(l.perfil))
            return { ok: false, codigo: 'DOCUMENTO_PERFIL_FIXO', mensagem: 'Administrador e Analista veem todos os documentos. Tire esse perfil da lista e salve de novo.' };
        if (l.nivel === 've_e_envia' && !t.permite_envio)
            return { ok: false, codigo: 'DOCUMENTO_NIVEL_INVALIDO', mensagem: `O tipo ${t.nome} não é enviado pelo app. Escolha "Vê" ou "Não vê".` };
    }
    return { ok: true };
}
/** P12: promotor sem `promotor_ve_pedidos` não vê o Histórico (nem o cartão de crédito do Resumo); fica com Resumo e Documentação. */
export function abasDaFicha(perfil, promotorVePedidos) {
    return perfilRecebeHistoricoDeCompra(perfil, promotorVePedidos) ? ['resumo', 'historico', 'documentacao'] : ['resumo', 'documentacao'];
}
