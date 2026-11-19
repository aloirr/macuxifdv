/**
 * Tabela "Carteira" da ficha do cliente no app Gestão (T-0186 v2, spec §6; RN-CORE-04, T-0168). Funções puras, sem banco.
 * - Só perfis de gestão veem quem atende o cliente (nome e telefone não vão ao aparelho do vendedor e do promotor).
 * - Uma linha por pessoa vigente na carteira do cliente; com mais de uma, o cabeçalho da coluna vira "Pessoa".
 * - Ligar e WhatsApp saem como link com DDI 55; pessoa sem telefone fica com os dois nulos (ação desligada).
 */
import { linksDeContato } from './cliente360';

export const PERFIS_VEEM_CARTEIRA_DO_CLIENTE = ['supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;

export function perfilVeCarteiraDoCliente(perfil: string): boolean {
  return (PERFIS_VEEM_CARTEIRA_DO_CLIENTE as readonly string[]).includes(perfil);
}

export interface VinculoDaCarteira {
  usuario_id: string;
  nome: string;
  telefone: string | null;
}

export interface LinhaCarteiraCliente {
  usuario_id: string;
  nome: string;
  tel: string | null;
  whatsapp: string | null;
}

export function rotuloColunaCarteira(pessoas: number): 'Vendedora' | 'Pessoa' {
  return pessoas > 1 ? 'Pessoa' : 'Vendedora';
}

/** Uma linha por pessoa (a mesma pessoa em dois vínculos conta uma vez), em ordem alfabética. */
export function montarCarteiraDoCliente(vinculos: readonly VinculoDaCarteira[]): { rotulo_coluna: 'Vendedora' | 'Pessoa'; itens: LinhaCarteiraCliente[] } {
  const porPessoa = new Map<string, VinculoDaCarteira>();
  for (const v of vinculos) if (!porPessoa.has(v.usuario_id)) porPessoa.set(v.usuario_id, v);
  const itens = [...porPessoa.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.usuario_id.localeCompare(b.usuario_id))
    .map<LinhaCarteiraCliente>((v) => {
      const l = linksDeContato({ telefone: v.telefone, whatsapp: v.telefone });
      return { usuario_id: v.usuario_id, nome: v.nome, tel: l.tel, whatsapp: l.whatsapp };
    });
  return { rotulo_coluna: rotuloColunaCarteira(itens.length), itens };
}
