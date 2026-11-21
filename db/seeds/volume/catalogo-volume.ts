/** Gerador puro e determinístico da massa de volume do Catálogo (T-0192). Uso: db/seeds/volume/LEIA-ME.md. */
import { idDeterministico, idFilialPadrao } from '../../src/ids';
import { criarPrng, ean13 } from './massa';

export type LinhaVolume = Record<string, string | number | boolean | null>;

export interface OpcoesCatalogoVolume {
  /** Semente do gerador (inteiro). Mesma semente = mesma massa. */
  semente: number;
  /** Tenant da massa. Padrão: um tenant próprio, derivado da semente (ver `tenant` no retorno). */
  tenantId?: string;
  /** Filial dos preços e depósitos. Padrão: a filial padrão do tenant (0056, idFilialPadrao). */
  filialId?: string;
  /** Quantidade de produtos (padrão 20.000). Preços ≈ 4× e saldos ≈ 2× (as contagens exatas saem em `contagens`). */
  produtos?: number;
  /** Instante dos carimbos (created_at, updated_at, atualizado_erp_em, erp_alterado_em). Padrão 2026-11-21T12:00:00.000Z. */
  agora?: string;
}

export interface MassaCatalogoVolume {
  semente: number;
  /** Linha de plataforma.tenant (o carregador só a grava se o tenant não existir). */
  tenant: { id: string; codigo: string; nome: string };
  filialId: string;
  nos: LinhaVolume[];
  produtos: LinhaVolume[];
  produtoNos: LinhaVolume[];
  tabelasPreco: LinhaVolume[];
  precos: LinhaVolume[];
  depositos: LinhaVolume[];
  saldos: LinhaVolume[];
  contagens: {
    produtos: number;
    precos: number;
    precosPorTabela: Record<string, number>;
    saldos: number;
    saldosPorDeposito: Record<string, number>;
    nos: number;
    nosPorNivel: Record<number, number>;
  };
}

export const PADRAO_VOLUME = { produtos: 20_000, agora: '2026-11-21T12:00:00.000Z' } as const; // hora-fixa-ok: carimbo da massa, não o relógio

/** Tabelas de preço: [código, nome, cobertura dos produtos, fator sobre o preço de venda]. Soma das coberturas = 4,0. */
const TABELAS: ReadonlyArray<readonly [string, string, number, number]> = [
  ['VOL-TAB-BASE', 'Tabela base', 1.0, 1.0],
  ['VOL-TAB-ATAC', 'Atacado', 0.9, 0.93],
  ['VOL-TAB-VARE', 'Varejo', 0.8, 1.08],
  ['VOL-TAB-ESPE', 'Especial', 0.7, 0.88],
  ['VOL-TAB-INTE', 'Interior', 0.6, 1.12],
];

/** Depósitos: [código, nome, cobertura dos produtos]. Soma = 2,0. */
const DEPOSITOS: ReadonlyArray<readonly [string, string, number]> = [
  ['VOL-CD', 'CD Manaus', 1.0],
  ['VOL-LJ1', 'Loja Centro', 0.6],
  ['VOL-LJ2', 'Loja Boa Vista', 0.4],
];

/** Grupos (nível 1) e subgrupos específicos (nível 2), com as peças que dão nome aos produtos. */
const GRUPOS: ReadonlyArray<{ codigo: string; nome: string; posicao?: true; subgrupos: ReadonlyArray<readonly [string, string]>; pecas: readonly string[] }> = [
  { codigo: 'FREIOS', nome: 'Freios', posicao: true, subgrupos: [['PASTILHA', 'Pastilhas'], ['DISCO', 'Discos'], ['LONA', 'Lonas e sapatas'], ['CILINDRO', 'Cilindros'], ['FLUIDO', 'Fluidos de freio']], pecas: ['Pastilha de freio', 'Disco de freio', 'Lona de freio', 'Cilindro mestre', 'Fluido de freio DOT 4'] },
  { codigo: 'FILTRACAO', nome: 'Filtração', subgrupos: [['OLEO', 'Filtros de óleo'], ['AR', 'Filtros de ar'], ['COMBUSTIVEL', 'Filtros de combustível'], ['CABINE', 'Filtros de cabine']], pecas: ['Filtro de óleo', 'Filtro de ar', 'Filtro de combustível', 'Filtro de cabine'] },
  { codigo: 'SUSPENSAO', nome: 'Suspensão', posicao: true, subgrupos: [['AMORTECEDOR', 'Amortecedores'], ['MOLA', 'Molas'], ['BANDEJA', 'Bandejas'], ['BUCHA', 'Buchas'], ['PIVO', 'Pivôs']], pecas: ['Amortecedor', 'Mola helicoidal', 'Bandeja de suspensão', 'Bucha da bandeja', 'Pivô de suspensão'] },
  { codigo: 'MOTOR', nome: 'Motor', subgrupos: [['CORREIA', 'Correias'], ['JUNTA', 'Juntas'], ['PISTAO', 'Pistões e anéis'], ['BOMBA_OLEO', 'Bombas de óleo'], ['VALVULA', 'Válvulas']], pecas: ['Correia dentada', 'Junta do cabeçote', 'Jogo de anéis', 'Bomba de óleo', 'Válvula de admissão'] },
  { codigo: 'ELETRICA', nome: 'Elétrica', subgrupos: [['BATERIA', 'Baterias'], ['VELA', 'Velas'], ['ALTERNADOR', 'Alternadores'], ['MOTOR_PARTIDA', 'Motores de partida']], pecas: ['Bateria 60 Ah', 'Vela de ignição', 'Alternador', 'Motor de partida'] },
  { codigo: 'ARREFECIMENTO', nome: 'Arrefecimento', subgrupos: [['RADIADOR', 'Radiadores'], ['BOMBA_AGUA', 'Bombas d’água'], ['VALVULA', 'Válvulas termostáticas'], ['ADITIVO', 'Aditivos']], pecas: ['Radiador', 'Bomba d’água', 'Válvula termostática', 'Aditivo de radiador'] },
  { codigo: 'TRANSMISSAO', nome: 'Transmissão', subgrupos: [['EMBREAGEM', 'Embreagens'], ['JUNTA', 'Juntas homocinéticas'], ['CABO', 'Cabos'], ['ROLAMENTO', 'Rolamentos']], pecas: ['Kit de embreagem', 'Junta homocinética', 'Cabo de embreagem', 'Rolamento de roda'] },
  { codigo: 'ILUMINACAO', nome: 'Iluminação', subgrupos: [['LAMPADA', 'Lâmpadas'], ['FAROL', 'Faróis'], ['LANTERNA', 'Lanternas']], pecas: ['Lâmpada H4', 'Farol principal', 'Lanterna traseira'] },
  { codigo: 'LUBRIFICANTES', nome: 'Lubrificantes', subgrupos: [['OLEO', 'Óleos de motor'], ['GRAXA', 'Graxas'], ['ADITIVO', 'Aditivos']], pecas: ['Óleo 5W30 sintético', 'Graxa de rolamento', 'Aditivo de combustível'] },
  { codigo: 'OUTROS', nome: 'Outros', subgrupos: [['OUTROS', 'Outros'], ['ACESSORIO', 'Acessórios']], pecas: ['Palheta do limpador', 'Tapete automotivo', 'Calota aro 14'] },
];
/** Linhas (nível 3) sob TODO subgrupo específico: o mesmo código em ramos diferentes (RN-CAT-18). */
const LINHAS: ReadonlyArray<readonly [string, string]> = [['LEVE', 'Linha leve'], ['PESADO', 'Linha pesada'], ['MOTO', 'Motos']];
/** Posição (nível 4) sob as linhas de Freios e Suspensão. */
const POSICOES: ReadonlyArray<readonly [string, string]> = [['DIANTEIRO', 'Dianteiro'], ['TRASEIRO', 'Traseiro']];

const MARCAS: ReadonlyArray<readonly [string, string]> = [
  ['Cobreq', '101'], ['Fremax', '102'], ['Tecfil', '103'], ['Bosch', '104'], ['NGK', '105'], ['Moura', '106'], ['Cofap', '107'],
  ['Gates', '108'], ['Nakata', '109'], ['Monroe', '110'], ['Valeo', '111'], ['SKF', '112'], ['Mahle', '113'], ['Osram', '114'],
];
const VEICULOS = ['Gol', 'Uno', 'Palio', 'Onix', 'HB20', 'Corolla', 'Civic', 'Strada', 'Saveiro', 'Hilux', 'S10', 'Ranger', 'Polo', 'Kwid', 'Sandero', 'Fiesta', 'Ka', 'Celta', 'CG 160', 'Biz 125'];
const UNIDADES = ['UN', 'UN', 'UN', 'UN', 'UN', 'UN', 'CX', 'PCT', 'KG', 'LT'] as const;

/** Fisher–Yates determinístico de 0..n-1. */
function embaralhar(n: number, aleatorio: () => number): number[] {
  const v = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [v[i], v[j]] = [v[j]!, v[i]!];
  }
  return v;
}

/** Tenant padrão da massa (sem `tenantId`): id e código derivados da semente. */
export function tenantDoVolume(semente: number): { id: string; codigo: string; nome: string } {
  return { id: idDeterministico(`volume:${semente}:tenant`), codigo: `volume-${semente >>> 0}`, nome: `Volume do Catálogo (semente ${semente >>> 0})` };
}

export function gerarCatalogoVolume(opcoes: OpcoesCatalogoVolume): MassaCatalogoVolume {
  const { semente } = opcoes;
  if (!Number.isInteger(semente)) throw new Error('gerarCatalogoVolume: semente precisa ser inteira');
  const totalProdutos = opcoes.produtos ?? PADRAO_VOLUME.produtos;
  if (!Number.isInteger(totalProdutos) || totalProdutos < 1 || totalProdutos > 999_999) throw new Error('gerarCatalogoVolume: produtos entre 1 e 999.999');
  const agora = opcoes.agora ?? PADRAO_VOLUME.agora;
  const tenant = opcoes.tenantId ? { id: opcoes.tenantId, codigo: '', nome: '' } : tenantDoVolume(semente);
  const t = tenant.id;
  const filialId = opcoes.filialId ?? idFilialPadrao(t);
  const id = (chave: string) => idDeterministico(`volume:${semente}:${t}:${chave}`);
  const comuns = { tenant_id: t, created_at: agora, updated_at: agora, deleted_at: null } as const;
  const aleatorio = criarPrng(semente).proximo;

  // Árvore: grupo › subgrupo › linha (› posição). external_id = caminho de códigos (único no tenant, como o do ERP).
  const nos: LinhaVolume[] = [];
  const folhas: { id: string; grupo: number }[] = [];
  const no = (pai: { id: string; caminho: string } | null, nivel: number, codigo: string, nome: string, ordem: number) => {
    const caminho = pai ? `${pai.caminho}.${codigo}` : codigo;
    const linha = { id: id(`no:${caminho}`), ...comuns, pai_id: pai?.id ?? null, nivel, codigo, nome, ordem, ativo: true, external_id: `NO-${caminho}` };
    nos.push(linha);
    return { id: linha.id, caminho };
  };
  GRUPOS.forEach((g, gi) => {
    const raiz = no(null, 1, g.codigo, g.nome, gi + 1);
    g.subgrupos.forEach(([sc, sn], si) => {
      const sub = no(raiz, 2, sc, sn, si + 1);
      if (g.codigo === 'OUTROS') return void folhas.push({ id: sub.id, grupo: gi });
      LINHAS.forEach(([lc, ln], li) => {
        const lin = no(sub, 3, lc, ln, li + 1);
        if (!g.posicao) return void folhas.push({ id: lin.id, grupo: gi });
        POSICOES.forEach(([pc, pn], pi) => folhas.push({ id: no(lin, 4, pc, pn, pi + 1).id, grupo: gi }));
      });
    });
    folhas.push({ id: no(raiz, 2, 'NAO_CLASSIFICADO', 'Não classificado', g.subgrupos.length + 1).id, grupo: gi });
  });

  // Produtos e vínculo com a folha
  const produtos: LinhaVolume[] = [];
  const produtoNos: LinhaVolume[] = [];
  const precoVenda: number[] = [];
  for (let n = 1; n <= totalProdutos; n++) {
    const folha = folhas[Math.floor(aleatorio() * folhas.length)]!;
    const g = GRUPOS[folha.grupo]!;
    const peca = g.pecas[Math.floor(aleatorio() * g.pecas.length)]!;
    const [marca, marcaCodigo] = MARCAS[Math.floor(aleatorio() * MARCAS.length)]!;
    const veiculo = VEICULOS[Math.floor(aleatorio() * VEICULOS.length)]!;
    const ano = 2005 + Math.floor(aleatorio() * 21);
    const custo = 500 + Math.floor(aleatorio() * 150_000); // R$ 5,00 a R$ 1.505,00, em centavos
    const venda = Math.round(custo * (1.3 + aleatorio() * 0.7));
    const unidade = UNIDADES[Math.floor(aleatorio() * UNIDADES.length)]!;
    const sku = `VOL-${String(n).padStart(7, '0')}`;
    const produtoId = id(`produto:${n}`);
    precoVenda.push(venda);
    produtos.push({
      id: produtoId, ...comuns, sku, ean: ean13(`789${String(n).padStart(9, '0')}`), nome: `${peca} ${marca} ${veiculo} ${ano}`, marca, marca_codigo: marcaCodigo,
      categoria: g.nome, unidade, ativo: aleatorio() >= 0.02, custo_cents: custo, preco_venda_cents: venda,
      desconto_maximo_pct: [0, 5, 10, 15][Math.floor(aleatorio() * 4)]!, erp_alterado_em: agora, external_id: `PRD-${sku}`,
    });
    produtoNos.push({ id: id(`produto_no:${n}`), ...comuns, produto_id: produtoId, no_id: folha.id, external_id: null });
  }

  // Tabelas de preço e preços (cobertura por tabela sobre uma ordem embaralhada dos produtos)
  const tabelasPreco: LinhaVolume[] = [];
  const precos: LinhaVolume[] = [];
  const precosPorTabela: Record<string, number> = {};
  for (const [codigo, nome, cobertura, fator] of TABELAS) {
    const tabelaId = id(`tabela_preco:${codigo}`);
    tabelasPreco.push({ id: tabelaId, ...comuns, codigo, nome, ativo: true, external_id: codigo });
    const qtd = Math.round(totalProdutos * cobertura);
    precosPorTabela[codigo] = qtd;
    for (const i of embaralhar(totalProdutos, aleatorio).slice(0, qtd)) {
      const n = i + 1;
      precos.push({
        id: id(`preco:${codigo}:${n}`), ...comuns, tabela_preco_id: tabelaId, produto_id: produtos[i]!.id as string, filial_id: filialId,
        preco_cents: Math.max(1, Math.round(precoVenda[i]! * fator)), unidade: null, vigencia_inicio: null, vigencia_fim: null,
        erp_alterado_em: agora, external_id: `${codigo}:${n}`,
      });
    }
  }

  // Depósitos e saldos
  const depositos: LinhaVolume[] = [];
  const saldos: LinhaVolume[] = [];
  const saldosPorDeposito: Record<string, number> = {};
  for (const [codigo, nome, cobertura] of DEPOSITOS) {
    const depositoId = id(`deposito:${codigo}`);
    depositos.push({ id: depositoId, ...comuns, codigo, nome, filial_id: filialId, ativo: true, external_id: codigo });
    const qtd = Math.round(totalProdutos * cobertura);
    saldosPorDeposito[codigo] = qtd;
    for (const i of embaralhar(totalProdutos, aleatorio).slice(0, qtd)) {
      const n = i + 1;
      const zerado = aleatorio() < 0.1;
      const quantidade = zerado ? 0 : (1 + Math.floor(aleatorio() * 500)) * (produtos[i]!.unidade === 'KG' ? 0.5 : 1);
      saldos.push({
        id: id(`saldo:${codigo}:${n}`), ...comuns, deposito_id: depositoId, produto_id: produtos[i]!.id as string, quantidade: quantidade.toFixed(3),
        atualizado_erp_em: agora, erp_alterado_em: agora, external_id: `${codigo}:${n}`,
      });
    }
  }

  const nosPorNivel: Record<number, number> = {};
  for (const x of nos) nosPorNivel[x.nivel as number] = (nosPorNivel[x.nivel as number] ?? 0) + 1;
  return {
    semente, tenant, filialId, nos, produtos, produtoNos, tabelasPreco, precos, depositos, saldos,
    contagens: { produtos: produtos.length, precos: precos.length, precosPorTabela, saldos: saldos.length, saldosPorDeposito, nos: nos.length, nosPorNivel },
  };
}

/** Ordem de gravação (FKs): tabela do Postgres e a lista da massa. */
export const TABELAS_VOLUME = [
  ['catalogo.catalogo_no', 'nos'],
  ['core.produto', 'produtos'],
  ['catalogo.produto_no', 'produtoNos'],
  ['catalogo.tabela_preco', 'tabelasPreco'],
  ['catalogo.tabela_preco_item', 'precos'],
  ['catalogo.deposito', 'depositos'],
  ['catalogo.estoque_saldo', 'saldos'],
] as const satisfies ReadonlyArray<readonly [string, keyof MassaCatalogoVolume]>;
