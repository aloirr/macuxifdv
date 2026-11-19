/**
 * Tabela Carteira da ficha no Gestão (T-0186, spec §3.5; RN-CORE-04): quem tem o cliente na carteira hoje, montada só com a linha
 * `carteira` do aparelho. Sem dado pessoal no aparelho (T-0168, RN-VEN-11a: o pull de `usuario` não leva nome nem telefone): cada
 * linha mostra só o papel (Vendedor ou Promotor) e Ligar e WhatsApp ficam desligados. Pura.
 */
import type { CarteiraSync } from '../../contracts';

export interface PessoaDaCarteira {
  id: string;
  nome: string;
  tel: string | null;
  whatsapp_url: string | null;
}

const ROTULO_PAPEL = { vendedor: 'Vendedor', promotor: 'Promotor' } as const;
const ORDEM_PAPEL = { vendedor: 0, promotor: 1 } as const;

/** Vínculo vivo no dia: `inicio` já chegou e `fim` ainda não passou (ambos opcionais). */
const vigente = (c: Pick<CarteiraSync, 'inicio' | 'fim'>, hoje: string): boolean => (!c.inicio || c.inicio <= hoje) && (!c.fim || c.fim >= hoje);

export function pessoasDaCarteira(clienteId: string, carteiras: readonly CarteiraSync[], hoje: string): PessoaDaCarteira[] {
  return carteiras
    .filter((c) => c.cliente_id === clienteId && c.deleted_at === null && vigente(c, hoje))
    .sort((a, b) => ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.usuario_id.localeCompare(b.usuario_id))
    .map((c) => ({ id: c.usuario_id, nome: ROTULO_PAPEL[c.papel], tel: null, whatsapp_url: null }));
}
