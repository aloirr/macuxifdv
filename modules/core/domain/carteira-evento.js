const FREQUENCIA = { 1: 'semanal', 2: 'quinzenal', 4: 'mensal' };
/** O dono da carteira de vendas é o vendedor mais recente da carteira; promotor não conta. */
export function carteiraParaEvento(linhas, ativo) {
    const vendedor = linhas.filter((l) => l.papel === 'vendedor').sort((a, b) => b.desde.localeCompare(a.desde))[0];
    return {
        vendedor_id: vendedor?.usuario_id ?? null,
        ativo,
        frequencia_visita: vendedor?.frequencia_semanas != null ? (FREQUENCIA[vendedor.frequencia_semanas] ?? null) : null,
        na_carteira_desde: vendedor?.desde ?? null,
    };
}
