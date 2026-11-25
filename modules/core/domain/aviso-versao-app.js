/**
 * RN-CORE-80 (T-0195, ADR 0070 §D7): o que o Core faz quando o app chama `POST /v1/core/app/aviso-versao`. Função pura: a rota
 * lê o perfil, o cabeçalho (`ctx.versaoApp.doCliente`), a versão publicada e a hora, e só grava o aviso que esta devolve.
 */
import { situacaoDaVersao, varianteDoPerfil } from '@macuxi/platform-sdk';
import { CORPO_AVISO_VERSAO_APP, tituloAvisoVersaoApp } from '../contracts';
/** RN-CORE-80: uma notificação por (usuário, variante, versão publicada); o usuário entra pela linha (`usuario_id`). */
export const chaveDoAvisoDeVersaoApp = (variante, versao) => `${variante}|${versao}`;
/**
 * RN-CORE-80:
 * - perfil sem app Android → `perfil_sem_app`; cabeçalho de outra variante → `variante_diferente` (a rota recusa com 403);
 * - sem cabeçalho → `atual`, nada a criar;
 * - senão a situação de `situacaoDaVersao`; só em `aviso` devolve a notificação a criar.
 */
export function avisoDeVersaoApp(e) {
    const variante = varianteDoPerfil(e.perfil);
    if (!variante)
        return { tipo: 'perfil_sem_app' };
    if (!e.doCliente)
        return { tipo: 'situacao', resposta: { variante, situacao: 'atual', versao_publicada: null, prazo_ate: null }, aviso: null };
    if (e.doCliente.variante !== variante)
        return { tipo: 'variante_diferente', variante };
    const { situacao, prazoAte } = situacaoDaVersao({ atual: e.doCliente.versao, publicada: e.publicada?.versao ?? null, publicadaEm: e.publicada?.publicada_em ?? null, agora: e.agora });
    const resposta = { variante, situacao, versao_publicada: e.publicada?.versao ?? null, prazo_ate: prazoAte };
    if (situacao !== 'aviso' || !e.publicada)
        return { tipo: 'situacao', resposta, aviso: null };
    const versao = e.publicada.versao;
    return {
        tipo: 'situacao',
        resposta,
        aviso: { chave: chaveDoAvisoDeVersaoApp(variante, versao), titulo: tituloAvisoVersaoApp(versao), corpo: CORPO_AVISO_VERSAO_APP, expira_em: prazoAte },
    };
}
