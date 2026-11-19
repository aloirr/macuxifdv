/**
 * Filiais no Catálogo (T-0149, RN-CORE-39, ADR 0040). O cadastro de filial é do Core: aqui só se consulta `core.filiais@1`
 * (nunca `core.filial`) e se aplica a regra pura de `domain/preco-filial.ts`. O Catálogo guarda só o `filial_id` nos
 * depósitos e nos itens de preço (sem FK, fronteira de schema).
 */
import type { ClienteBanco, ContextoConsulta, TransacaoTenant } from '@macuxi/platform-sdk';
import { CONSULTA_FILIAIS, CONSULTA_FILIAIS_DO_USUARIO, type Filial } from '@macuxi/core/contracts';
import { nomeDaFilialOuCodigo } from '../domain/estoque';
import { lerFiliaisDoUsuario, type FiliaisDoUsuario } from '../domain/estoque-campo';
import { filialDoPreco, type FilialDoPreco } from '../domain/preco-filial';

type Consultar = TransacaoTenant['consultar'];

/**
 * `core.filiais@1` dentro de uma CONSULTA da API (`precos_cliente@1`, `sugestoes_pedido@1`). O `ContextoConsulta` do SDK ainda não traz
 * `consultar` (pedido ao engenheiro-software, T-0149): quando trouxer, esta função passa a ser só `ctx.consultar`. Sem ele, falha
 * com mensagem clara (nunca devolve preço da filial errada).
 */
export function consultarDoContexto(ctx: ContextoConsulta): Consultar {
  const consultar = (ctx as ContextoConsulta & { consultar?: Consultar }).consultar;
  if (!consultar) throw new Error('catalogo: a consulta core.filiais@1 não está disponível no contexto da consulta (SDK sem ContextoConsulta.consultar, T-0149).');
  return consultar;
}

export interface FilialDoCliente {
  /** Filial efetiva do cliente (sem informação, a padrão). */
  filialCliente: string;
  filialPadrao: string;
  filiais: ReadonlyMap<string, Filial>;
}

export async function filialDoClienteNoCore(consultar: Consultar, clienteId: string): Promise<FilialDoCliente> {
  const r = await consultar(CONSULTA_FILIAIS, { cliente_ids: [clienteId], external_ids: [], escopo: 'tenant' });
  return {
    filialCliente: r.clientes.find((c) => c.cliente_id === clienteId)?.filial_id ?? r.padrao_id,
    filialPadrao: r.padrao_id,
    filiais: new Map(r.filiais.map((f) => [f.id, f])),
  };
}

export interface FiliaisDaCarteira {
  filialPadrao: string;
  /** Filiais dos clientes visíveis + a padrão; `null` = carteira do tenant inteiro (todas). Filtro do pull e do estoque sem cliente. */
  daCarteira: readonly string[] | null;
  filiais: ReadonlyMap<string, Filial>;
}

export async function filiaisDaCarteiraNoCore(consultar: Consultar): Promise<FiliaisDaCarteira> {
  const r = await consultar(CONSULTA_FILIAIS, { cliente_ids: [], external_ids: [], escopo: 'carteira' });
  return { filialPadrao: r.padrao_id, daCarteira: r.da_carteira === null ? null : [...r.da_carteira].sort(), filiais: new Map(r.filiais.map((f) => [f.id, f])) };
}

/** Filiais do próprio usuário (`core.filiais_do_usuario@1`, T-0176, RN-CORE-39); saída fora do contrato = sem filial (nunca devolve filial que o contrato não deu). */
export async function filiaisDeVendaDoProprioUsuario(consultar: Consultar, usuarioId: string): Promise<FiliaisDoUsuario> {
  return lerFiliaisDoUsuario(await consultar(CONSULTA_FILIAIS_DO_USUARIO, { usuario_id: usuarioId })) ?? { filiaisVenda: [], filialCadastro: null, semFilial: true };
}

/** Nome da filial no estoque (`branch_name`): "Boa Vista"; filial desconhecida cai no código curto do id. */
export const nomeDaFilial = (filiais: ReadonlyMap<string, Filial>, id: string): string => nomeDaFilialOuCodigo(id, filiais.get(id)?.nome);

/** RN-CORE-39: a tabela tem item vivo na filial? (uma consulta curta, índice `(tenant_id, tabela_preco_id, filial_id)`). */
export async function filialDaTabela(db: ClienteBanco, tabelaId: string, f: Pick<FilialDoCliente, 'filialCliente' | 'filialPadrao'>): Promise<FilialDoPreco> {
  if (f.filialCliente === f.filialPadrao) return filialDoPreco({ tabelaId, filialCliente: f.filialCliente, filialPadrao: f.filialPadrao, filiaisComItens: [] });
  const r = await db.query<{ tem: boolean }>(
    `select exists (select 1 from catalogo.tabela_preco_item where tabela_preco_id = $1::uuid and filial_id = $2::uuid and deleted_at is null) as tem`,
    [tabelaId, f.filialCliente],
  );
  return filialDoPreco({ tabelaId, filialCliente: f.filialCliente, filialPadrao: f.filialPadrao, filiaisComItens: r.rows[0]?.tem ? [f.filialCliente] : [] });
}
