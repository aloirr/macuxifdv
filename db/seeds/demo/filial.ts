/**
 * Base de DEMONSTRAÇÃO — filiais (migração 0056, T-0149; RN-CORE-39, ADR 0040; desenho docs/desenho/T-0149.md §3.5).
 * Dono: banco-dados. Arquivo próprio: o demo.ts chama `gravarDemoFilial(admin, { tenantId, dados })` na MESMA transação do
 * carregarDemo, depois do laço (clientes, preços, depósitos, estoque e pedidos já gravados).
 *
 * - 2 filiais: a PADRÃO '0001' (a que o gatilho tenant_semear_filial cria; o seed completa nome "Filial Manaus" e
 *   Manaus/AM, external_id FIL-MAO) e a '0002' "Filial Boa Vista" (Boa Vista/RR, external_id FIL-BVB).
 * - Dados fiscais (0059, T-0159: cabeçalho do PDF pela filial de faturamento): CNPJ, endereço e telefone FICTÍCIOS
 *   (DADOS_FISCAIS_DEMO; CNPJ de exemplo 11.222.333/0001-81 e /0002-62, com dígito verificador válido). Banco sem a 0059 =
 *   as filiais vão sem eles.
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
 * - Pedidos do seed: retrato da filial do cliente (todos na Manaus) em vendedor.pedido.filial_id/filial, montado pela
 *   MESMA função do servidor no recebimento (retratoFilialDoPedido, domain do Vendedor; RD-0108).
 *
 * - Chave `SEED_BOA_VISTA_DEMO` (ver a constante): desligada, a recriação grava só a padrão completada (Filial Manaus,
 *   Manaus/AM, FIL-MAO) e o retrato dela nos pedidos; TODOS os clientes ficam na padrão e a Boa Vista de uma carga anterior é desfeita (clientes de volta à
 *   padrão; itens, depósito, saldos e a filial 0002 apagados logicamente). `dadosDemoFilial` monta sempre as linhas (o teste
 *   confere a forma).
 * Idempotente (upsert por id determinístico; cliente e pedido por UPDATE). Banco sem a 0056 = nada a fazer. Só tenant demo;
 * só Postgres local ou servidor da demo (exigirBancoDemo).
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO do demo.ts é importado.
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico, idFilialPadrao } from '../../src/ids';
import { retratoFilialDoPedido, type FilialOrigem } from '../../../modules/vendedor/domain/filial-pedido';
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

/** Colunas da 0059 (T-0159) em core.filial. */
export const COLUNAS_FISCAIS_FILIAL = ['cnpj', 'logradouro', 'numero', 'complemento', 'bairro', 'cep', 'telefone'] as const;

/** CNPJ, endereço e telefone FICTÍCIOS das filiais da demo (0059, T-0159), por código. CNPJ e CEP só dígitos. */
export const DADOS_FISCAIS_DEMO = {
  '0001': { cnpj: '11222333000181', logradouro: 'Av. Torquato Tapajós', numero: '5000', complemento: 'Galpão 3', bairro: 'Flores', cep: '69058830', telefone: '(92) 3000-1001' },
  '0002': { cnpj: '11222333000262', logradouro: 'Av. Ville Roy', numero: '1200', complemento: null, bairro: 'São Pedro', cep: '69306405', telefone: '(95) 3000-2002' },
} as const satisfies Record<string, Record<(typeof COLUNAS_FISCAIS_FILIAL)[number], string | null>>;

/**
 * Liga a parte Boa Vista da seed (2ª filial, 4 clientes, preço +5%, CD-BVB). LIGADA na build das 22h de 10/11
 * (R-20261110-182314: filial de ponta a ponta; o Vendedor grava a filial no pedido, R-20261110-194832, e o Catálogo filtra
 * preço/estoque por filial). Desligar = trocar para `false` aqui (um lugar só; a recarga desfaz a Boa Vista).
 */
export const SEED_BOA_VISTA_DEMO = true;

/** Preço da Boa Vista a partir do da Manaus (centavos). */
export const precoBoaVistaDemo = (precoManaus: number) => Math.round((precoManaus * (100 + ACRESCIMO_PRECO_BOA_VISTA_PCT)) / 100);

export interface DadosDemoFilial {
  filiais: Linha[];
  itensBoaVista: Linha[];
  deposito: Linha;
  saldosBoaVista: Linha[];
  clientesBoaVista: string[];
  retratoManaus: ReturnType<typeof retratoFilialDoPedido>['filial'];
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
    { id: padrao, tenant_id: T, codigo: '0001', nome: 'Filial Manaus', cidade: 'Manaus', uf: 'AM', ...DADOS_FISCAIS_DEMO['0001'], padrao: true, ativo: true, ...comuns, external_id: 'FIL-MAO' },
    { id: boaVista, tenant_id: T, codigo: '0002', nome: 'Filial Boa Vista', cidade: 'Boa Vista', uf: 'RR', ...DADOS_FISCAIS_DEMO['0002'], padrao: false, ativo: true, ...comuns, external_id: 'FIL-BVB' },
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
  const { filial: retratoManaus } = retratoFilialDoPedido(filiais[0] as unknown as FilialOrigem);
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
  // banco sem a 0059: as filiais vão sem os dados fiscais
  const fiscal = await admin.query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_schema = 'core' and table_name = 'filial' and column_name = 'cnpj') as ok",
  );
  const semFiscal = (f: Linha): Linha => Object.fromEntries(Object.entries(f).filter(([k]) => !(COLUNAS_FISCAIS_FILIAL as readonly string[]).includes(k)));
  const filiais = fiscal.rows[0]?.ok ? d.filiais : d.filiais.map(semFiscal);
  // sem a Boa Vista: só a padrão completada; todos os clientes nela
  n += await gravarLinhas(admin, 'core.filial', boaVista ? filiais : filiais.filter((f) => f.padrao === true));
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
