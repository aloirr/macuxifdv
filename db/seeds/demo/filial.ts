/**
 * Base de DEMONSTRAÇÃO — filiais (migração 0056, T-0149; RN-CORE-39, ADR 0040; desenho docs/desenho/T-0149.md §3.5).
 * Dono: banco-dados. Arquivo próprio: o demo.ts chama `gravarDemoFilial(admin, { tenantId, dados })` na MESMA transação do
 * carregarDemo, depois do laço (clientes, preços, depósitos, estoque e pedidos já gravados).
 *
 * - 2 filiais: a PADRÃO '0001' (a que o gatilho tenant_semear_filial cria; o seed completa nome "Filial Manaus" e
 *   Manaus/AM, external_id FIL-MAO) e a '0002' "Filial Boa Vista" (Boa Vista/RR, external_id FIL-BVB).
 * - Clientes na Boa Vista (CLIENTES_BOA_VISTA_DEMO, índices do demo.ts): Padaria Trigo Fino (7, Varejo, rota de hoje do
 *   Lucas), Comercial Rio Negro (12, Atacado, Lucas), Supermercado Novo Horizonte (19, Atacado, rota de hoje da Camila) e
 *   Mini Mercado Buriti (24, Varejo, Camila). Nenhum deles tem pedido na base (os pedidos do seed seguem com o preço da
 *   Manaus). PREMISSA: o endereço desses clientes continua o de Manaus (a demo mostra a filial, não muda rota nem mapa).
 *   Os demais 26 ficam na padrão (Manaus).
 * - Preço por filial: as duas tabelas (Varejo e Atacado) ganham itens na Boa Vista com o preço da Manaus + 5%
 *   (arredondado ao centavo), mesmos produtos (o Atacado continua sem os 3 de SEM_PRECO_NO_ATACADO) e mesma vigência. Os
 *   itens da Manaus são os do demo.ts (sem filial no upsert: o gatilho grava a padrão).
 * - Estoque por filial: os 2 depósitos do demo.ts (CD Manaus e Loja Centro) ficam na Manaus; o depósito "CD Boa Vista"
 *   (CD-BVB) fica na Boa Vista, com o saldo do CD Manaus × 0,6 (arredondado para baixo) e o PRODUTO_SEM_SALDO_BOA_VISTA_DEMO
 *   (café 500 g) ZERADO lá e com saldo na Manaus (critério "estoque 0" da T-0149).
 * - Pedidos do seed: retrato da filial do cliente (todos na Manaus) em vendedor.pedido.filial_id/filial, como o servidor
 *   grava no recebimento.
 *
 * - CHAVE `SEED_BOA_VISTA_DEMO` (decisão do gerente R-20261110-111746): DESLIGADA na v1.0.3 — a recriação da demo grava só a
 *   padrão completada (Filial Manaus, Manaus/AM, FIL-MAO) e o retrato dela nos pedidos; TODOS os clientes ficam na padrão e
 *   nada da Boa Vista é gravado (a carga de antes que a tinha gravado é desfeita: clientes de volta à padrão; itens, depósito,
 *   saldos e a filial 0002 apagados logicamente). Volta LIGADA na v1.0.4, com o filtro do Catálogo no BKO, a gravação no
 *   Vendedor e o evento prontos. `dadosDemoFilial` monta sempre as linhas (o teste confere a forma).
 * Idempotente (upsert por id determinístico; cliente e pedido por UPDATE). Banco sem a 0056 = nada a fazer. Só tenant demo;
 * só Postgres local ou servidor da demo (exigirBancoDemo).
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO do demo.ts é importado.
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico, idFilialPadrao } from '../../src/ids';
import type { DadosDemo } from './demo';

const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null } as const;

/** Clientes (índices do demo.ts) na filial Boa Vista. */
export const CLIENTES_BOA_VISTA_DEMO = [7, 12, 19, 24] as const;
/** Acréscimo do preço da Boa Vista sobre o da Manaus (em %). */
export const ACRESCIMO_PRECO_BOA_VISTA_PCT = 5;
/** Produto com saldo na Manaus e SEM saldo na Boa Vista. */
export const PRODUTO_SEM_SALDO_BOA_VISTA_DEMO = 'CAF-500';
export const DEPOSITO_BOA_VISTA_DEMO = { codigo: 'CD-BVB', nome: 'CD Boa Vista' } as const;

export const idFilialBoaVistaDemo = () => id('filial:0002');

/**
 * Liga a parte Boa Vista da seed (2ª filial, 4 clientes, preço +5%, CD-BVB). DESLIGADA na v1.0.3 (R-20261110-111746): a filial
 * completa entra na v1.0.4. Ligar = trocar para `true` aqui (um lugar só).
 */
export const SEED_BOA_VISTA_DEMO = false;

/** Preço da Boa Vista a partir do da Manaus (centavos). */
export const precoBoaVistaDemo = (precoManaus: number) => Math.round((precoManaus * (100 + ACRESCIMO_PRECO_BOA_VISTA_PCT)) / 100);

export interface DadosDemoFilial {
  filiais: Linha[];
  itensBoaVista: Linha[];
  deposito: Linha;
  saldosBoaVista: Linha[];
  clientesBoaVista: string[];
  retratoManaus: Record<string, unknown>;
}

/** Linhas da filial (função pura; o teste do seed confere sem banco). */
export function dadosDemoFilial(p: {
  tenantId: string;
  dados: Pick<DadosDemo, 'core.cliente' | 'core.produto' | 'catalogo.tabela_preco_item' | 'catalogo.estoque_saldo' | 'catalogo.deposito'>;
}): DadosDemoFilial {
  const T = p.tenantId;
  const padrao = idFilialPadrao(T);
  const boaVista = idFilialBoaVistaDemo();
  const filiais: Linha[] = [
    { id: padrao, tenant_id: T, codigo: '0001', nome: 'Filial Manaus', cidade: 'Manaus', uf: 'AM', padrao: true, ativo: true, ...comuns, external_id: 'FIL-MAO' },
    { id: boaVista, tenant_id: T, codigo: '0002', nome: 'Filial Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true, ...comuns, external_id: 'FIL-BVB' },
  ];
  const itensBoaVista: Linha[] = p.dados['catalogo.tabela_preco_item'].map((i) => ({
    id: id(`tabela_preco_item:bvb:${String(i.id)}`), tenant_id: T, tabela_preco_id: i.tabela_preco_id, produto_id: i.produto_id,
    preco_cents: precoBoaVistaDemo(Number(i.preco_cents)), vigencia_inicio: i.vigencia_inicio, vigencia_fim: i.vigencia_fim, unidade: i.unidade ?? null,
    filial_id: boaVista, ...comuns, external_id: null,
  }));
  const deposito: Linha = {
    id: id(`deposito:${DEPOSITO_BOA_VISTA_DEMO.codigo}`), tenant_id: T, codigo: DEPOSITO_BOA_VISTA_DEMO.codigo, nome: DEPOSITO_BOA_VISTA_DEMO.nome,
    ativo: true, filial_id: boaVista, ...comuns, external_id: DEPOSITO_BOA_VISTA_DEMO.codigo,
  };
  const cdManaus = p.dados['catalogo.deposito'].find((d) => d.codigo === 'CD-MAO');
  if (!cdManaus) throw new Error('[db] seed demo: depósito CD-MAO fora da base');
  const semSaldo = p.dados['core.produto'].find((x) => x.sku === PRODUTO_SEM_SALDO_BOA_VISTA_DEMO);
  if (!semSaldo) throw new Error(`[db] seed demo: produto ${PRODUTO_SEM_SALDO_BOA_VISTA_DEMO} fora da base`);
  const saldosBoaVista: Linha[] = p.dados['catalogo.estoque_saldo']
    .filter((s) => s.deposito_id === cdManaus.id)
    .map((s) => ({
      id: id(`estoque_saldo:${DEPOSITO_BOA_VISTA_DEMO.codigo}:${String(s.produto_id)}`), tenant_id: T, deposito_id: deposito.id, produto_id: s.produto_id,
      quantidade: s.produto_id === semSaldo.id ? 0 : Math.floor(Number(s.quantidade) * 0.6), atualizado_erp_em: s.atualizado_erp_em, ...comuns, external_id: null,
    }));
  const clientesBoaVista = CLIENTES_BOA_VISTA_DEMO.map((n) => {
    const c = p.dados['core.cliente'][n];
    if (!c) throw new Error(`[db] seed demo: cliente ${n} fora da base`);
    return String(c.id);
  });
  const f = filiais[0]!;
  const retratoManaus = { id: f.id, codigo: f.codigo, nome: f.nome, cidade: f.cidade, uf: f.uf, external_id: f.external_id, padrao: true };
  return { filiais, itensBoaVista, deposito, saldosBoaVista, clientesBoaVista, retratoManaus };
}

/**
 * Grava as filiais da demo (dentro da transação do carregarDemo). Devolve quantas linhas gravou/atualizou (0 = banco sem a
 * 0056).
 */
export async function gravarDemoFilial(
  admin: ClientBase,
  p: { tenantId: string; dados: Pick<DadosDemo, 'core.cliente' | 'core.produto' | 'catalogo.tabela_preco_item' | 'catalogo.estoque_saldo' | 'catalogo.deposito' | 'vendedor.pedido'> },
  opcoes: { boaVista?: boolean } = {},
): Promise<number> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed das filiais da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('core.filial') is not null as ok");
  if (!existe.rows[0]?.ok) return 0;
  const T = p.tenantId;
  const d = dadosDemoFilial(p);
  const boaVista = opcoes.boaVista ?? SEED_BOA_VISTA_DEMO;
  let n = 0;
  // sem a Boa Vista: só a padrão completada; todos os clientes nela
  n += await gravarLinhas(admin, 'core.filial', boaVista ? d.filiais : d.filiais.filter((f) => f.padrao === true));
  const naBoaVista = boaVista ? d.clientesBoaVista : [];
  // clientes: os 4 na Boa Vista (com a chave ligada), os demais de volta à padrão (recarga depois de um ensaio que mudou a filial)
  if (boaVista) {
    n += (await admin.query('update core.cliente set filial_id = $3 where tenant_id = $1 and id = any($2::uuid[]) and filial_id <> $3', [T, naBoaVista, idFilialBoaVistaDemo()])).rowCount ?? 0;
  }
  n += (
    await admin.query('update core.cliente set filial_id = $3 where tenant_id = $1 and id = any($2::uuid[]) and id <> all($4::uuid[]) and filial_id <> $3', [
      T,
      p.dados['core.cliente'].map((c) => c.id),
      idFilialPadrao(T),
      naBoaVista,
    ])
  ).rowCount ?? 0;
  if (boaVista) {
    n += await gravarLinhas(admin, 'catalogo.tabela_preco_item', d.itensBoaVista);
    n += await gravarLinhas(admin, 'catalogo.deposito', [d.deposito]);
    n += await gravarLinhas(admin, 'catalogo.estoque_saldo', d.saldosBoaVista);
  } else {
    // desfaz a Boa Vista de uma carga anterior com a chave ligada (apagado lógico pelos ids determinísticos; nada a fazer se não houver)
    const vivo = 'tenant_id = $1 and id = any($2::uuid[]) and deleted_at is null';
    n += (await admin.query(`update catalogo.estoque_saldo set deleted_at = now() where ${vivo}`, [T, d.saldosBoaVista.map((x) => x.id)])).rowCount ?? 0;
    n += (await admin.query(`update catalogo.deposito set deleted_at = now() where ${vivo}`, [T, [d.deposito.id]])).rowCount ?? 0;
    n += (await admin.query(`update catalogo.tabela_preco_item set deleted_at = now() where ${vivo}`, [T, d.itensBoaVista.map((x) => x.id)])).rowCount ?? 0;
    n += (await admin.query(`update core.filial set deleted_at = now() where ${vivo} and not padrao`, [T, [idFilialBoaVistaDemo()]])).rowCount ?? 0;
  }
  // pedidos do seed: retrato da filial do cliente no recebimento (todos os clientes com pedido estão na Manaus)
  const comPedidoNaBoaVista = p.dados['vendedor.pedido'].filter((x) => d.clientesBoaVista.includes(String(x.cliente_id)));
  if (comPedidoNaBoaVista.length > 0) throw new Error('[db] seed demo: pedido do seed em cliente da Boa Vista (os preços do seed são da Manaus)');
  n += (
    await admin.query('update vendedor.pedido set filial_id = $3, filial = $4::jsonb where tenant_id = $1 and id = any($2::uuid[])', [
      T,
      p.dados['vendedor.pedido'].map((x) => x.id),
      idFilialPadrao(T),
      JSON.stringify(d.retratoManaus),
    ])
  ).rowCount ?? 0;
  return n;
}
