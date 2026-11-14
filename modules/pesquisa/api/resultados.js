import { ParamsQuestionario, ResultadoQuery } from '../contracts';
import { agregarResultados, consolidarEntreVersoes, exportarRespostasCsv, nomeDoArquivoCsv, respostaDentroDoFiltro, respostasNoEscopo, versaoVigente } from '../domain';
import { comRepositorio, naoEncontrado, parametrosDaRota, recusar } from './comum';
/** Carrega o questionário, as respostas no escopo do usuário e aplica os filtros da URL (período, equipe, versão). */
async function recortar(ctx, fabrica) {
    const { id } = ctx.params;
    const q = ctx.query;
    const fuso = parametrosDaRota(ctx).fuso;
    const visiveis = await ctx.usuariosVisiveis();
    const { carregado, todas } = await comRepositorio(ctx, fabrica, async (repo) => {
        const c = await repo.carregar(id);
        return { carregado: c, todas: c ? await repo.listarRespostas(id) : [] };
    });
    if (!carregado)
        return naoEncontrado();
    const versoes = carregado.versoes.filter((v) => v.status === 'publicada');
    const versao = q.versao ? (versoes.find((v) => v.id === q.versao) ?? null) : null;
    if (q.versao && !versao)
        recusar('VERSAO_INEXISTENTE', 'Essa versão não existe neste questionário (ou ainda é rascunho). Escolha outra versão no filtro.');
    const filtro = { ...(q.de ? { de: q.de } : {}), ...(q.ate ? { ate: q.ate } : {}), ...(q.equipes ? { equipe_ids: q.equipes } : {}) };
    const respostas = respostasNoEscopo(todas, visiveis).filter((r) => respostaDentroDoFiltro(r, filtro, fuso) && (versao === null || r.versao_id === versao.id));
    const base = versaoVigente({ arquivado_em: null }, versoes) ?? carregado.versoes[carregado.versoes.length - 1];
    return { versoes, titulo: base?.titulo ?? 'pesquisa', respostas, filtro, versao, fuso };
}
export function rotasDeResultados(fabrica) {
    /** RF-PES-06 / RN-PES-01: com `versao`, apuração da versão; sem, consolidado entre versões pelo id estável. */
    const resultado = {
        metodo: 'GET',
        caminho: 'questionarios/:id/resultado',
        acao: 'resultado.ver',
        carteira: 'filtrar_no_dominio',
        params: ParamsQuestionario,
        query: ResultadoQuery,
        async executar(ctx) {
            const r = await recortar(ctx, fabrica);
            if (r.versao)
                return { tipo: 'versao', resultado: agregarResultados({ versao: r.versao, respostas: r.respostas, filtro: r.filtro, fuso: r.fuso }) };
            return { tipo: 'consolidado', resultado: consolidarEntreVersoes({ versoes: r.versoes, respostas: r.respostas, filtro: r.filtro, fuso: r.fuso }) };
        },
    };
    /** RF-PES-06: respostas individuais (texto aberto e conferência), mais recentes primeiro, no escopo. */
    const respostas = {
        metodo: 'GET',
        caminho: 'questionarios/:id/respostas',
        acao: 'resultado.ver',
        carteira: 'filtrar_no_dominio',
        params: ParamsQuestionario,
        query: ResultadoQuery,
        async executar(ctx) {
            const r = await recortar(ctx, fabrica);
            const numero = new Map(r.versoes.map((v) => [v.id, v.numero]));
            const itens = r.respostas
                .slice()
                .sort((a, b) => (a.respondida_em < b.respondida_em ? 1 : a.respondida_em > b.respondida_em ? -1 : 0))
                .slice(0, 500)
                .map((x) => ({
                id: x.id,
                versao_id: x.versao_id,
                versao_numero: numero.get(x.versao_id) ?? 1,
                usuario_id: x.usuario_id,
                equipe_id: x.equipe_id,
                cliente_id: x.cliente_id,
                visita_id: x.visita_id,
                respondida_em: x.respondida_em,
                recebida_em: x.recebida_em,
                suspeita: x.suspeita,
                motivos_suspeita: [...x.motivos_suspeita],
                itens: x.itens,
            }));
            return { itens, total: r.respostas.length };
        },
    };
    /** RF-PES-06: galeria de fotos (o binário vem de `GET /v1/arquivos/:id`, ADR 0010, que checa a carteira de novo). */
    const galeria = {
        metodo: 'GET',
        caminho: 'questionarios/:id/galeria',
        acao: 'resultado.ver',
        carteira: 'filtrar_no_dominio',
        params: ParamsQuestionario,
        query: ResultadoQuery,
        async executar(ctx) {
            const r = await recortar(ctx, fabrica);
            const enunciado = new Map();
            for (const v of r.versoes)
                for (const p of v.perguntas)
                    enunciado.set(p.id, p.enunciado);
            const itens = r.respostas.flatMap((x) => x.itens.flatMap((i) => i.tipo === 'foto'
                ? i.fotos.map((f) => ({ foto_id: f.id, resposta_id: x.id, pergunta_id: i.pergunta_id, enunciado: enunciado.get(i.pergunta_id) ?? '', cliente_id: x.cliente_id, usuario_id: x.usuario_id, capturada_em: f.capturada_em }))
                : []));
            itens.sort((a, b) => (a.capturada_em < b.capturada_em ? 1 : a.capturada_em > b.capturada_em ? -1 : 0));
            return { itens: itens.slice(0, 500) };
        },
    };
    /** RF-PES-06: exportação CSV (Excel pt-BR) das respostas no escopo e nos filtros. */
    const exportar = {
        metodo: 'GET',
        caminho: 'questionarios/:id/exportar',
        acao: 'resultado.exportar',
        carteira: 'filtrar_no_dominio',
        params: ParamsQuestionario,
        query: ResultadoQuery,
        async executar(ctx) {
            const r = await recortar(ctx, fabrica);
            const versoes = r.versao ? [r.versao] : r.versoes;
            ctx.log.info({ respostas: r.respostas.length }, 'pesquisa: exportação de resultados');
            return { nome_arquivo: nomeDoArquivoCsv(r.titulo, ctx.agora().toISOString(), r.fuso), tipo: 'text/csv', conteudo: exportarRespostasCsv({ versoes, respostas: r.respostas, fuso: r.fuso }) };
        },
    };
    return [resultado, respostas, galeria, exportar];
}
