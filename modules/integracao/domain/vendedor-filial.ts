/**
 * RN-CORE-39 (decisão de 15/11/2026): o vendedor tem exatamente UMA filial, obrigatória. Vendedor sem filial NÃO é linha com erro:
 * entra normalmente e a linha ganha o aviso `vendedor_sem_filial`; o bloqueio do vendedor até informar a filial é do Core.
 */
import type { AvisoLinha } from '../contracts';

export function avisoVendedorSemFilial(registro: { external_id: string; filial_external_id?: string | null }): Omit<AvisoLinha, 'indice'> | null {
  if ((registro.filial_external_id ?? '').trim() !== '') return null;
  return {
    external_id: registro.external_id,
    codigo: 'vendedor_sem_filial',
    mensagem: 'Vendedor sem filial: bloqueado até informar a filial (na carga ou no Backoffice).',
  };
}
