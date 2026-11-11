/** Apoio dos testes de banco (T-0149): resposta simulada de `core.filiais@1` — duas filiais; cliente par → Boa Vista (0002), demais → padrão (0001). */
import { CONSULTA_FILIAIS } from '@macuxi/core/contracts';

export const FILIAL_PADRAO_TESTE = { id: '0F490000-0000-4000-8000-000000000001', codigo: '0001', nome: 'Manaus', cidade: 'Manaus', uf: 'AM', padrao: true, ativo: true, external_id: 'FIL-01' };
export const FILIAL_BV_TESTE = { id: '0F490000-0000-4000-8000-000000000002', codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true, external_id: 'FIL-02' };

/** Sempre em maiúsculas de propósito: o Vendedor é quem normaliza o id do retrato para minúsculas (CHECK pedido_filial_coerente). */
export function responderFiliais(entrada: unknown, filialDoCliente: (clienteId: string) => typeof FILIAL_PADRAO_TESTE = () => FILIAL_PADRAO_TESTE) {
  const ent = CONSULTA_FILIAIS.entrada.parse(entrada);
  return {
    padrao_id: FILIAL_PADRAO_TESTE.id.toLowerCase(),
    filiais: [FILIAL_PADRAO_TESTE, FILIAL_BV_TESTE].map((f) => ({ ...f, id: f.id.toLowerCase() })),
    clientes: ent.cliente_ids.map((c) => ({ cliente_id: c, filial_id: filialDoCliente(c).id.toLowerCase() })),
    por_external_id: [],
    da_carteira: null,
  };
}
