const normalizar = (g) => g.trim().toLowerCase();
export function decidirGeracao(guardada, recebida) {
    if (typeof recebida !== 'string' || recebida.trim() === '')
        return 'sem_marcador';
    if (guardada === null || guardada.trim() === '')
        return 'adotar';
    return normalizar(guardada) === normalizar(recebida) ? 'igual' : 'trocou';
}
/** Forma guardada da geração (comparação sem caixa e sem espaço). */
export function normalizarGeracao(g) {
    return normalizar(g);
}
/**
 * Fila depois da troca de geração (ADR 0021 §5.1): os aceitos ainda sobrepostos (D-3) voltam como `pendente` — a base nova
 * pode não os ter; o reenvio é idempotente pelo UUID do aparelho. Itens da fila ficam como estão (o `falhou` continua
 * visível ao usuário). Mesmo id nos dois (o app caiu entre as gravações) = vale o da fila. Ordem: criação (FIFO).
 */
export function filaNaTrocaDeGeracao(fila, aceitos) {
    const naFila = new Set(fila.map((i) => i.id));
    const voltam = aceitos
        .filter((a) => !naFila.has(a.id))
        .map(({ aceito_em: _aceitoEm, aceito_servidor_em: _aceitoServidorEm, ...resto }) => ({
        ...resto,
        situacao: 'pendente',
        codigo: null,
        ultimo_erro: '',
    }));
    // sort estável: no empate de `criado_em`, o que já estava antes (aceito) vem primeiro
    return [...voltam, ...fila].sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0));
}
