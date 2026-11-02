/**
 * Carteira que acompanha `core.cliente.atualizado@1` (RN-CORE-04; consumida pelo Gestor em RN-GES-01/02).
 * Função pura: a API lê as linhas de `core.carteira` do cliente e monta o trecho do payload aqui.
 */
export interface LinhaCarteiraEvento {
  usuario_id: string;
  papel: 'vendedor' | 'promotor';
  /** `core.carteira.frequencia_semanas`: 1, 2 ou 4. */
  frequencia_semanas: number | null;
  /** Instante UTC (ISO) em que a linha entrou na carteira. */
  desde: string;
}

export interface CarteiraDoEvento {
  vendedor_id: string | null;
  ativo: boolean;
  frequencia_visita: 'semanal' | 'quinzenal' | 'mensal' | null;
  na_carteira_desde: string | null;
}

const FREQUENCIA: Record<number, 'semanal' | 'quinzenal' | 'mensal'> = { 1: 'semanal', 2: 'quinzenal', 4: 'mensal' };

/** O dono da carteira de vendas é o vendedor mais recente da carteira; promotor não conta. */
export function carteiraParaEvento(linhas: readonly LinhaCarteiraEvento[], ativo: boolean): CarteiraDoEvento {
  const vendedor = linhas.filter((l) => l.papel === 'vendedor').sort((a, b) => b.desde.localeCompare(a.desde))[0];
  return {
    vendedor_id: vendedor?.usuario_id ?? null,
    ativo,
    frequencia_visita: vendedor?.frequencia_semanas != null ? (FREQUENCIA[vendedor.frequencia_semanas] ?? null) : null,
    na_carteira_desde: vendedor?.desde ?? null,
  };
}
