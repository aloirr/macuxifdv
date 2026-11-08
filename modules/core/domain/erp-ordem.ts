/**
 * Guarda de ordem e de desligamento nos consumidores do ERP (T-0095; RN-INT-02/04). Funções puras.
 * - Ordem: a outbox pode reentregar uma versão antiga depois da nova; a versão com `alterado_em` menor que a já aplicada não sobrescreve.
 * - Desligamento: o que o admin desligou no BKO não volta sozinho com a próxima carga; o consumidor avisa em vez de reativar.
 */

export type DecisaoOrdemErp = 'aplicar' | 'ignorar_antigo';

/** Igual reaplica (idempotente). Sem versão aplicada, sem data ou data ilegível: aplica (não há como provar que é antiga). */
export function decidirOrdemErp(aplicadoAlteradoEm: string | null | undefined, recebidoAlteradoEm: string | null | undefined): DecisaoOrdemErp {
  if (!aplicadoAlteradoEm || !recebidoAlteradoEm) return 'aplicar';
  const a = Date.parse(aplicadoAlteradoEm);
  const r = Date.parse(recebidoAlteradoEm);
  if (Number.isNaN(a) || Number.isNaN(r)) return 'aplicar';
  return r < a ? 'ignorar_antigo' : 'aplicar';
}

/**
 * A versão recebida é MAIS NOVA que a aplicada (estritamente)? É o que separa uma carga nova do ERP (o registro mudou) da
 * reentrega ou da carga completa repetida do mesmo registro (mesmo alterado_em): só a primeira merece aviso (T-0095, 🟡 3).
 * Sem versão aplicada, qualquer data legível é nova; sem data recebida ou ilegível, não é (não há como provar).
 */
export function ehVersaoNovaDoErp(aplicadoAlteradoEm: string | null | undefined, recebidoAlteradoEm: string | null | undefined): boolean {
  if (!recebidoAlteradoEm) return false;
  const r = Date.parse(recebidoAlteradoEm);
  if (Number.isNaN(r)) return false;
  if (!aplicadoAlteradoEm) return true;
  const a = Date.parse(aplicadoAlteradoEm);
  return Number.isNaN(a) ? true : r > a;
}

export interface EntradaReativacaoErp {
  /** core.usuario.desligado_no_bko_em: preenchido quando o admin desativou pelo BKO. */
  desligadoNoBkoEm: string | null;
  ativoNoErp: boolean;
  /** ehVersaoNovaDoErp; sem informar (padrão true) o aviso se repetiria a cada carga do mesmo registro. */
  versaoNova?: boolean;
}

/** O ativo a gravar e se os admins recebem aviso (o ERP quis reativar o que o BKO desligou; uma vez por versão do registro). */
export function decidirReativacaoDoErp(e: EntradaReativacaoErp): { ativo: boolean; avisar: boolean } {
  if (e.desligadoNoBkoEm) return { ativo: false, avisar: e.ativoNoErp && (e.versaoNova ?? true) };
  return { ativo: e.ativoNoErp, avisar: false };
}
