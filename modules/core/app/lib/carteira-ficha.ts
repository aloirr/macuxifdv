/**
 * Tabela Carteira da ficha no Gestão (T-0186, spec §3.5; RN-CORE-04): quem tem o cliente na carteira hoje, montada só com as linhas do
 * aparelho (`carteira` e `usuario` do pull). Nome e telefone vêm do `usuario`; quem não está no aparelho (fora da equipe visível) aparece
 * pelo papel e sem Ligar e WhatsApp. Sem telefone, os botões ficam desligados. Pura.
 */
import type { CarteiraSync, UsuarioSync } from '../../contracts';
import { telUrl, whatsappUrl } from './route';

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

export function pessoasDaCarteira(clienteId: string, carteiras: readonly CarteiraSync[], usuarios: readonly UsuarioSync[], hoje: string): PessoaDaCarteira[] {
  const porId = new Map(usuarios.filter((u) => u.deleted_at === null).map((u) => [u.id, u]));
  return carteiras
    .filter((c) => c.cliente_id === clienteId && c.deleted_at === null && vigente(c, hoje))
    .map((c) => {
      const u = porId.get(c.usuario_id);
      const digitos = (u?.telefone ?? '').replace(/\D/g, '');
      const comTelefone = digitos.length >= 8;
      return {
        papel: c.papel,
        pessoa: { id: c.usuario_id, nome: u?.nome?.trim() || ROTULO_PAPEL[c.papel], tel: comTelefone ? telUrl(u!.telefone!) : null, whatsapp_url: comTelefone ? whatsappUrl(u!.telefone!) : null },
      };
    })
    .sort((a, b) => ORDEM_PAPEL[a.papel] - ORDEM_PAPEL[b.papel] || a.pessoa.nome.localeCompare(b.pessoa.nome, 'pt-BR'))
    .map((x) => x.pessoa);
}
