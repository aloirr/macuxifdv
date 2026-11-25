/**
 * Regras do checkout (RN-CORE-12 e RN-CORE-14). Função pura, igual no app (offline) e na API.
 *
 * - RN-CORE-12: etapas obrigatórias dos módulos ativos precisam estar cumpridas; sem pedido exige motivo.
 * - RN-CORE-14: cliente fechado (`loja_fechada`, `acesso_negado`) exige foto da fachada e DISPENSA todas as etapas obrigatórias.
 * Os literais espelham `MOTIVOS_NAO_ATENDIMENTO` de `contracts` (o domain não importa contracts).
 */
export const MOTIVOS_CLIENTE_FECHADO = ['loja_fechada', 'acesso_negado'];
export function ehClienteFechado(motivo) {
    return motivo != null && MOTIVOS_CLIENTE_FECHADO.includes(motivo);
}
export function avaliarCheckout(e) {
    if (e.resultado === null)
        return { pode: false, pendencias: ['resultado'], etapasDispensadas: false };
    const fechado = e.resultado === 'no_order' && ehClienteFechado(e.motivo);
    if (fechado) {
        const pendencias = e.fotoFachada ? [] : ['foto_fachada'];
        return { pode: pendencias.length === 0, pendencias, etapasDispensadas: true };
    }
    const pendencias = [];
    if (e.resultado === 'no_order' && !e.motivo)
        pendencias.push('motivo');
    for (const et of e.etapas)
        if (et.obrigatoria && !et.concluida)
            pendencias.push(et.rotulo);
    return { pode: pendencias.length === 0, pendencias, etapasDispensadas: false };
}
/**
 * Checkout da visita com o `resultado` do contrato novo (`CheckoutVisitaSchema`):
 * - RN-CORE-12: com Vendedor efetivo o resultado é `pedido` ou `sem_pedido` (esta exige motivo); sem Vendedor (promotor) é `atendido`;
 *   etapas obrigatórias dos módulos ativos precisam estar cumpridas.
 * - RN-CORE-14: `cliente_fechado` exige motivo da lista fechada + foto da fachada e DISPENSA as etapas obrigatórias.
 * Pendências: 'resultado', 'motivo', 'pedido', 'foto_fachada' ou o rótulo da etapa.
 */
export function avaliarCheckoutVisita(e) {
    if (e.resultado === null)
        return { pode: false, pendencias: ['resultado'], etapasDispensadas: false };
    if (e.resultado === 'cliente_fechado') {
        const pendencias = [];
        if (!e.motivoClienteFechado)
            pendencias.push('motivo');
        if (!e.fotoFachada)
            pendencias.push('foto_fachada');
        return { pode: pendencias.length === 0, pendencias, etapasDispensadas: true };
    }
    const pendencias = [];
    if (e.vendedorEfetivo) {
        if (e.resultado === 'atendido')
            pendencias.push('resultado');
        if (e.resultado === 'pedido' && !e.temPedido)
            pendencias.push('pedido');
        if (e.resultado === 'sem_pedido' && !e.temMotivo)
            pendencias.push('motivo');
    }
    else if (e.resultado === 'pedido' || e.resultado === 'sem_pedido') {
        pendencias.push('resultado'); // sem Vendedor efetivo não há pedido a registrar
    }
    for (const et of e.etapas)
        if (et.obrigatoria && !et.concluida)
            pendencias.push(et.rotulo);
    return { pode: pendencias.length === 0, pendencias, etapasDispensadas: false };
}
/**
 * RN-CORE-12 de ponta a ponta para a folha de checkout (função pura, sem I/O e sem relógio):
 * converte a escolha + o motivo no `resultado` do contrato, avalia com `avaliarCheckoutVisita`
 * e devolve as etapas pendentes e o registro das etapas (para o payload).
 * - Motivo do tipo `cliente_fechado` vence a escolha e vira `cliente_fechado` (RN-CORE-14), para vendedor e promotor.
 * - Com Vendedor efetivo: `pedido` exige o pedido da visita; `sem_pedido` exige motivo; `atendido` não vale.
 * - Sem Vendedor efetivo: só `atendido` (ou cliente fechado).
 * - Etapas obrigatórias dos módulos ativos bloqueiam, exceto quando dispensadas por cliente fechado.
 */
export function prepararCheckoutVisita(e) {
    const clienteFechado = e.motivo?.tipo === 'cliente_fechado';
    const resultado = clienteFechado ? 'cliente_fechado' : e.escolha;
    const avaliacao = avaliarCheckoutVisita({
        resultado,
        vendedorEfetivo: e.vendedorEfetivo,
        temMotivo: e.motivo !== null,
        motivoClienteFechado: clienteFechado,
        fotoFachada: e.fotoFachada,
        temPedido: e.temPedido,
        etapas: e.etapas.map(({ rotulo, obrigatoria, concluida }) => ({ rotulo, obrigatoria, concluida })),
    });
    const etapasPendentes = clienteFechado ? [] : e.etapas.filter((et) => et.obrigatoria && !et.concluida);
    const etapasRegistro = [];
    for (const et of e.etapas) {
        if (et.concluida)
            etapasRegistro.push({ modulo: et.modulo, etapa: et.id, situacao: 'concluida' });
        else if (clienteFechado && et.obrigatoria)
            etapasRegistro.push({ modulo: et.modulo, etapa: et.id, situacao: 'dispensada' });
    }
    return { ...avaliacao, resultado, clienteFechado, etapasPendentes, etapasRegistro };
}
