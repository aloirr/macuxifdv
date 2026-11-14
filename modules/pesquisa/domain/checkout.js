import { pesquisaAplicavel } from './publico';
import { versaoVigente } from './questionario';
/** RN-PES-03: quais pesquisas obrigatórias faltam nesta visita e se o checkout está bloqueado. */
export function avaliarEtapaCheckout(entrada) {
    const itens = [];
    for (const { questionario, versoes } of entrada.pesquisas) {
        const vigente = versaoVigente(questionario, versoes);
        if (!vigente || vigente.modo !== 'checkout_obrigatoria')
            continue;
        const base = { questionario_id: questionario.id, versao_id: vigente.id, titulo: vigente.titulo };
        const jaRespondida = entrada.respostas.some((r) => r.questionario_id === questionario.id && r.visita_id === entrada.visita_id);
        if (jaRespondida) {
            itens.push({ ...base, estado: 'concluida' });
            continue;
        }
        const ap = pesquisaAplicavel(questionario, versoes, {
            usuario: entrada.usuario,
            cliente: entrada.cliente,
            agora: entrada.agora,
            visita_id: entrada.visita_id,
            respostas_anteriores: entrada.respostas,
            fuso: entrada.fuso,
        });
        if (!ap.aplicavel)
            continue;
        itens.push({ ...base, estado: entrada.cliente_fechado ? 'dispensada' : 'pendente' });
    }
    const pendentes = itens.filter((i) => i.estado === 'pendente');
    const bloqueia_checkout = pendentes.length > 0;
    const mensagem = bloqueia_checkout
        ? pendentes.length === 1
            ? `Responda a pesquisa "${pendentes[0].titulo}" para concluir o checkout.`
            : `Responda as ${pendentes.length} pesquisas obrigatórias (${pendentes.map((p) => `"${p.titulo}"`).join(', ')}) para concluir o checkout.`
        : null;
    return { itens, pendentes, bloqueia_checkout, concluida: !bloqueia_checkout, mensagem };
}
/**
 * RN-PES-03 / RN-CORE-14: visita sem atendimento por cliente fechado (`loja_fechada` ou `acesso_negado`) dispensa a
 * pesquisa obrigatória. Usado na entrada `cliente_fechado` de `avaliarEtapaCheckout` e no `concluida()` da etapa.
 */
export function clienteFechadoNoContexto(ctx) {
    return ctx.clienteFechado === true || ctx.motivoClienteFechado === 'loja_fechada' || ctx.motivoClienteFechado === 'acesso_negado';
}
/** Id da etapa agregada; igual ao `ETAPA_PESQUISA_OBRIGATORIA` dos contracts. */
const ID_ETAPA = 'pesquisa.obrigatoria';
const LIMITE_ROTULO = 120;
const cortar = (s) => (s.length <= LIMITE_ROTULO ? s : `${s.slice(0, LIMITE_ROTULO - 1)}…`);
/**
 * RN-PES-03 / RN-CORE-12 no servidor (`pesquisa.etapas_checkout@1`): a resposta só conta se foi registrada no servidor para
 * ESTA visita e ESTE cliente. Devolve no máximo uma etapa agregada (`pesquisa.obrigatoria`); nenhuma pesquisa obrigatória
 * aplicável = lista vazia. Cliente fechado (RN-CORE-14) dispensa: a etapa deixa de ser obrigatória (o Core também dispensa).
 */
export function verificarEtapasCheckoutServidor(entrada) {
    const doCliente = entrada.respostas.filter((r) => r.visita_id === entrada.visita_id && (r.cliente_id === null || entrada.cliente === null || r.cliente_id === entrada.cliente.id));
    const r = avaliarEtapaCheckout({ ...entrada, respostas: doCliente });
    if (r.itens.length === 0)
        return [];
    const pend = r.pendentes;
    const rotulo = pend.length === 0
        ? 'Pesquisa obrigatória'
        : pend.length === 1
            ? cortar(`Pesquisa obrigatória: "${pend[0].titulo}"`)
            : `Pesquisas obrigatórias pendentes: ${pend.length}`;
    return [{ etapa: ID_ETAPA, rotulo, obrigatoria: r.itens.some((i) => i.estado !== 'dispensada'), concluida: !r.bloqueia_checkout }];
}
