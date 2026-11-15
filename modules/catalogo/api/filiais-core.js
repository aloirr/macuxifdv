import { CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { filialDoPreco } from '../domain/preco-filial';
/**
 * `core.filiais@1` dentro de uma CONSULTA da API (`precos_cliente@1`, `sugestoes_pedido@1`). O `ContextoConsulta` do SDK ainda não traz
 * `consultar` (pedido ao engenheiro-software, T-0149): quando trouxer, esta função passa a ser só `ctx.consultar`. Sem ele, falha
 * com mensagem clara (nunca devolve preço da filial errada).
 */
export function consultarDoContexto(ctx) {
    const consultar = ctx.consultar;
    if (!consultar)
        throw new Error('catalogo: a consulta core.filiais@1 não está disponível no contexto da consulta (SDK sem ContextoConsulta.consultar, T-0149).');
    return consultar;
}
export async function filialDoClienteNoCore(consultar, clienteId) {
    const r = await consultar(CONSULTA_FILIAIS, { cliente_ids: [clienteId], external_ids: [], escopo: 'tenant' });
    return {
        filialCliente: r.clientes.find((c) => c.cliente_id === clienteId)?.filial_id ?? r.padrao_id,
        filialPadrao: r.padrao_id,
        filiais: new Map(r.filiais.map((f) => [f.id, f])),
    };
}
export async function filiaisDaCarteiraNoCore(consultar) {
    const r = await consultar(CONSULTA_FILIAIS, { cliente_ids: [], external_ids: [], escopo: 'carteira' });
    return { filialPadrao: r.padrao_id, daCarteira: r.da_carteira === null ? null : [...r.da_carteira].sort(), filiais: new Map(r.filiais.map((f) => [f.id, f])) };
}
/** Nome da filial no estoque (`branch_name`): "Boa Vista"; filial desconhecida cai no código curto do id. */
export const nomeDaFilial = (filiais, id) => filiais.get(id)?.nome ?? `Filial ${id.slice(0, 8)}`;
/** RN-CORE-39: a tabela tem item vivo na filial? (uma consulta curta, índice `(tenant_id, tabela_preco_id, filial_id)`). */
export async function filialDaTabela(db, tabelaId, f) {
    if (f.filialCliente === f.filialPadrao)
        return filialDoPreco({ tabelaId, filialCliente: f.filialCliente, filialPadrao: f.filialPadrao, filiaisComItens: [] });
    const r = await db.query(`select exists (select 1 from catalogo.tabela_preco_item where tabela_preco_id = $1::uuid and filial_id = $2::uuid and deleted_at is null) as tem`, [tabelaId, f.filialCliente]);
    return filialDoPreco({ tabelaId, filialCliente: f.filialCliente, filialPadrao: f.filialPadrao, filiaisComItens: r.rows[0]?.tem ? [f.filialCliente] : [] });
}
