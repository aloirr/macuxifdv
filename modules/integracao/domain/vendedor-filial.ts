/**
 * RN-CORE-39 (decisão de 15/11/2026): o vendedor tem exatamente UMA filial, obrigatória. Vendedor sem filial NÃO é linha com erro:
 * entra normalmente e a linha ganha o aviso `vendedor_sem_filial`; o bloqueio do vendedor até informar a filial é do Core.
 */
import type { AvisoLinha, LinhaErro } from '../contracts';
import { erroReferenciaAusente } from './erros';

export function avisoVendedorSemFilial(registro: { external_id: string; filial_external_id?: string | null }): Omit<AvisoLinha, 'indice'> | null {
  if ((registro.filial_external_id ?? '').trim() !== '') return null;
  return {
    external_id: registro.external_id,
    codigo: 'vendedor_sem_filial',
    mensagem: 'Vendedor sem filial: bloqueado até informar a filial (na carga ou no Backoffice).',
  };
}

/**
 * RN-CORE-39: `filial_external_id` do vendedor tem de existir entre as filiais do tenant (`core.filiais@1`). Inexistente = linha com erro
 * `referencia_ausente` (reprocessável: some quando a filial é carregada ou cadastrada), com o campo `filial_external_id`; sem isso o
 * Core só registraria um warn e o vendedor ficaria bloqueado sem filial. `existentes === null` = não deu para conferir: ninguém é recusado.
 */
export function verificarFilialDoVendedor<L extends { indice: number; external_id: string; registro: unknown }>(
  linhas: readonly L[],
  existentes: ReadonlySet<string> | null,
): { aceitas: L[]; erros: LinhaErro[] } {
  const aceitas: L[] = [];
  const erros: LinhaErro[] = [];
  for (const l of linhas) {
    const f = ((l.registro as { filial_external_id?: string | null } | null)?.filial_external_id ?? '').trim();
    if (f === '' || existentes === null || existentes.has(f)) {
      aceitas.push(l);
      continue;
    }
    erros.push({
      ...erroReferenciaAusente(l.indice, l.external_id, 'filial_external_id', 'filial'),
      mensagem: `Filial '${f}' não cadastrada (campo filial_external_id). Envie a filial ou cadastre no Backoffice e reprocesse.`,
    });
  }
  return { aceitas, erros };
}
