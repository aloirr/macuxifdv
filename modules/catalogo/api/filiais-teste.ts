/**
 * Apoio dos testes de banco do Catálogo (T-0149): simula `core.filiais@1` (o Catálogo nunca lê `core.filial`; na produção a
 * consulta é do Core). A filial padrão é a do tenant da transação (semeada pela migração 0056); `clientes` leva cliente → filial
 * efetiva (o que não estiver nele cai na padrão) e `filiais` os nomes. Só para testes: não é importado pelo código de produção.
 */
import type { ClientBase } from 'pg';

export interface FiliaisDeTeste {
  /** cliente_id → filial_id efetiva; cliente fora do mapa = padrão. */
  clientes?: Record<string, string>;
  /** Filiais além da padrão (id → nome). */
  outras?: Record<string, string>;
  /** `da_carteira` devolvido para `escopo: 'carteira'`; `undefined` = a padrão + as filiais dos clientes de `clientes`; `null` = todas. */
  daCarteira?: string[] | null;
}

export function consultarFiliaisDeTeste(c: ClientBase, cfg: FiliaisDeTeste = {}) {
  return async (def: { nome: string }, entrada: { cliente_ids?: string[]; external_ids?: string[]; escopo?: 'tenant' | 'carteira' }) => {
    if (def.nome !== 'core.filiais@1') throw new Error(`consulta não simulada no teste: ${def.nome}`);
    const padrao = (await c.query<{ id: string }>('select core.filial_padrao_id(plataforma.tenant_atual()) as id')).rows[0]!.id;
    const filial = (id: string, nome: string, padraoDoTenant: boolean) => ({ id, codigo: id.slice(-4), nome, cidade: null, uf: null, padrao: padraoDoTenant, ativo: true, external_id: null });
    const filiais = [filial(padrao, 'Filial padrão', true), ...Object.entries(cfg.outras ?? {}).map(([id, nome]) => filial(id, nome, false))];
    const efetiva = (cliente: string) => cfg.clientes?.[cliente] ?? padrao;
    return {
      padrao_id: padrao,
      filiais,
      clientes: (entrada.cliente_ids ?? []).map((cliente_id) => ({ cliente_id, filial_id: efetiva(cliente_id) })),
      por_external_id: [],
      da_carteira: entrada.escopo === 'carteira' ? (cfg.daCarteira === undefined ? [...new Set([padrao, ...Object.values(cfg.clientes ?? {})])] : cfg.daCarteira) : null,
    };
  };
}
