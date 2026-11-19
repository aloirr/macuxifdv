/**
 * Colunas do pedido gravadas igual no insert (primeiro envio) e no update (reenvio do devolvido, T-0184 §2).
 * Uma lista só: `[coluna, valor, cast?]`; os dois comandos nascem dela, na mesma ordem.
 */
export type ColunaPedido = readonly [coluna: string, valor: unknown, cast?: string];

const ref = (n: number, cast?: string): string => `$${n}${cast ? `::${cast}` : ''}`;

/** Reenvio: `where id = $1`, as colunas comuns em seguida e o ciclo; zera a decisão anterior. */
export function montarUpdatePedido(id: string, colunas: readonly ColunaPedido[], ciclo: number): { sql: string; valores: unknown[] } {
  const sets = colunas.map(([c, , cast], i) => `${c} = ${ref(i + 2, cast)}`);
  sets.push(`aprovacao_ciclo = $${colunas.length + 2}`, 'decidido_por_id = null', 'decidido_em = null', 'motivo_rejeicao = null');
  return { sql: `update vendedor.pedido set ${sets.join(', ')} where id = $1`, valores: [id, ...colunas.map((c) => c[1]), ciclo] };
}

/** Primeiro envio: id, tenant, cliente, vendedor, autor e número antes das colunas comuns; o id repetido não grava nada. */
export function montarInsertPedido(
  chaves: { id: string; cliente_id: string; vendedor_id: string; autor_id: string; numero: string },
  colunas: readonly ColunaPedido[],
): { sql: string; valores: unknown[] } {
  const nomes = ['id', 'tenant_id', 'cliente_id', 'vendedor_id', 'autor_id', 'numero', ...colunas.map((c) => c[0])];
  const marcas = ['$1', 'plataforma.tenant_atual()', '$2', '$3', '$4', '$5', ...colunas.map(([, , cast], i) => ref(i + 6, cast))];
  return {
    sql: `insert into vendedor.pedido (${nomes.join(', ')}) values (${marcas.join(', ')}) on conflict (id) do nothing returning id`,
    valores: [chaves.id, chaves.cliente_id, chaves.vendedor_id, chaves.autor_id, chaves.numero, ...colunas.map((c) => c[1])],
  };
}
