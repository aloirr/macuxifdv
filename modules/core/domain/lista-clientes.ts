/**
 * Linha da lista de Clientes (RN-CORE-41; T-0171): uma tag de situação e a última visita. Funções puras.
 */

export type SituacaoDoCliente = 'bloqueado' | 'devendo' | 'pre_cadastro' | 'em_dia';

export const ROTULO_SITUACAO_CLIENTE: Record<SituacaoDoCliente, string> = {
  bloqueado: 'Bloqueado',
  devendo: 'Devendo',
  pre_cadastro: 'Pré-Cadastro',
  em_dia: 'Em dia',
};

/** Pré-Cadastro = cliente sem código do ERP (ainda não voltou do ERP). */
export function semCodigoErp(externalId: string | null | undefined): boolean {
  return externalId === null || externalId === undefined || externalId.trim() === '';
}

/** RN-CORE-41: prioridade Bloqueado > Devendo > Pré-Cadastro > Em dia; mostra só o primeiro que valer. */
export function situacaoDoCliente(c: { bloqueado: boolean; vencidos_qtd: number; external_id: string | null | undefined }): SituacaoDoCliente {
  if (c.bloqueado) return 'bloqueado';
  if (c.vencidos_qtd > 0) return 'devendo';
  if (semCodigoErp(c.external_id)) return 'pre_cadastro';
  return 'em_dia';
}

const dias = (de: string, ate: string): number => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/**
 * RN-CORE-41: última visita pelo último check-in (data civil no fuso do tenant, `hoje` já nesse fuso).
 * Hoje (inclusive o atendimento em aberto), ontem, "há N dias" ou nunca.
 */
export function textoUltimaVisita(ultima: string | null | undefined, hoje: string): string {
  if (!ultima) return 'Nunca visitado';
  const n = dias(ultima, hoje);
  if (n <= 0) return 'Visitado hoje';
  if (n === 1) return 'Visitado ontem';
  return `Visitado há ${n} dias`;
}

/** A data mais recente entre o último check-in sincronizado (qualquer vendedor) e os do aparelho (fila e linhas locais). */
export function ultimaVisitaEntre(...datas: ReadonlyArray<string | null | undefined>): string | null {
  const v = datas.filter((d): d is string => !!d).sort();
  return v.length > 0 ? v[v.length - 1]! : null;
}
