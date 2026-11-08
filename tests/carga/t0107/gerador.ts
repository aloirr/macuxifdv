/**
 * T-0107 (frente N14) — gerador DETERMINÍSTICO da base de carga: 20 mil produtos de autopeças (árvore sistema › grupo ›
 * linha, aplicação por veículo com faixas de anos e até 3 referências cruzadas por produto), 300 clientes na carteira de 3
 * vendedores, tabela de preço, estoque em 2 depósitos e o financeiro dos clientes, para UM tenant de teste.
 *
 * - Semente fixa (`SEMENTE_PADRAO`): a mesma semente gera exatamente as mesmas linhas, na mesma ordem, em qualquer máquina
 *   (PRNG mulberry32, sem `Math.random`, sem relógio). Ids = `idDeChave('t0107:<semente>:<entidade>:<n>')` (independem do
 *   tenant); o `tenantId` só entra na coluna `tenant_id`. O instante das linhas é o `instante` passado (os testes usam o
 *   relógio da fixture), nunca `new Date()` aqui.
 * - Nada de dado pessoal real: razão social e fantasia montadas de listas de palavras ("Auto Peças Rio Negro 0042 Ltda"),
 *   CNPJ fictício com dígito verificador válido na faixa 90.xxx.xxx/0001-xx, sem telefone e sem e-mail de cliente; os
 *   vendedores usam o domínio reservado exemplo.com.br. Marcas próprias e concorrentes são inventadas; montadoras e modelos
 *   de veículo são nomes comerciais públicos (não são dado pessoal), só para a aplicação ficar realista.
 * - Formato das linhas = colunas das tabelas (db/migrations 0002, 0006, 0008, 0013, 0018, 0033, 0034). Dinheiro em
 *   centavos (regra 4). Unidades só da lista que a 0018 semeia em todo tenant (UN, CX, LT, GL, PCT, KG, TB, DZ).
 * - `produto_busca` (documento de busca do SERVIDOR) leva a aplicação JÁ EXPANDIDA (`expandirAplicacao` do domain do
 *   Catálogo, RN-CAT-12) e as referências em código cru + compacto (`codigoCompacto`, RN-CAT-09), como a API grava; o
 *   tsvector é do gatilho do banco.
 *
 * Volumes (20 mil produtos, padrão): produto 20.000 · produto_unidade ~21.900 · catalogo_no 158 · produto_no 20.000 ·
 * produto_conteudo 20.000 · produto_atributo 40.000 · produto_referencia ~30.000 · produto_busca 20.000 ·
 * tabela_preco_item 20.000 · estoque_saldo 40.000 · cliente 300 · carteira 300 · cliente_financeiro 300.
 */
import { createHash } from 'node:crypto';
import { idDeChave } from '@macuxi/db/teste';
import { expandirAplicacao } from '../../../modules/catalogo/domain/aplicacao';
import { codigoCompacto } from '../../../modules/catalogo/domain/ranking';

export const SEMENTE_PADRAO = 0x0107_2026;
export const PRODUTOS_PADRAO = 20_000;
export const CLIENTES_PADRAO = 300;
/** Ano civil usado na expansão das faixas abertas ("2018 em diante"); fixo para a base não mudar com o relógio. */
export const ANO_DA_BASE = 2026;

export type Linha = Record<string, unknown>;

/** Ordem de gravação (FKs: medida/tenant antes do produto; nó pai antes do filho; tabela antes do item; cliente antes da carteira). */
export const ORDEM_TABELAS_CARGA = [
  'core.equipe',
  'core.usuario',
  'core.produto',
  'core.produto_unidade',
  'catalogo.catalogo_no',
  'catalogo.produto_no',
  'catalogo.produto_conteudo',
  'catalogo.produto_atributo',
  'catalogo.produto_referencia',
  'catalogo.sinonimo',
  'catalogo.produto_busca',
  'catalogo.tabela_preco',
  'catalogo.tabela_preco_item',
  'catalogo.deposito',
  'catalogo.estoque_saldo',
  'core.cliente',
  'core.carteira',
  'core.cliente_financeiro',
  'catalogo.cliente_tabela_preco',
] as const;
export type TabelaCarga = (typeof ORDEM_TABELAS_CARGA)[number];
export type BaseCarga = Record<TabelaCarga, Linha[]>;

export interface OpcoesBase {
  tenantId: string;
  /** Instante das linhas (created_at/updated_at e atualizado_erp_em), ISO UTC. */
  instante: string;
  /** Hash argon2id da senha dos vendedores (feito fora: o gerador é puro e rápido). */
  senhaHash: string;
  semente?: number;
  produtos?: number;
  clientes?: number;
}

export interface VendedorCarga {
  id: string;
  email: string;
  nome: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// PRNG (mulberry32): 32 bits, rápido, determinístico em qualquer motor JS
// ---------------------------------------------------------------------------------------------------------------------
export function criarPrng(semente: number) {
  let s = semente >>> 0;
  const proximo = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    proximo,
    /** Inteiro em [min, max] (inclusivo). */
    inteiro: (min: number, max: number) => min + Math.floor(proximo() * (max - min + 1)),
    escolher: <T>(lista: readonly T[]): T => lista[Math.floor(proximo() * lista.length)]!,
    chance: (p: number) => proximo() < p,
  };
}
export type Prng = ReturnType<typeof criarPrng>;

// ---------------------------------------------------------------------------------------------------------------------
// Dicionários (inventados; montadoras/modelos são nomes comerciais públicos)
// ---------------------------------------------------------------------------------------------------------------------
type Uso = 'moto' | 'carro' | 'ambos';
/** [nome do grupo, item (nome do produto), linhas, preço base em centavos, unidade, uso] */
type Grupo = readonly [string, string, readonly string[], number, string, Uso];
/** Sistema (nível 1) › grupo (nível 2) › linha (nível 3; o produto fica na folha). */
export const ARVORE_SISTEMAS: readonly (readonly [string, readonly Grupo[]])[] = [
  ['Freios', [
    ['Pastilhas', 'Pastilha de freio', ['Dianteira', 'Traseira', 'Cerâmica'], 4_500, 'UN', 'ambos'],
    ['Discos', 'Disco de freio', ['Ventilado', 'Sólido', 'Flutuante'], 18_000, 'UN', 'ambos'],
    ['Lonas e sapatas', 'Sapata de freio', ['Moto', 'Leve'], 3_200, 'UN', 'ambos'],
    ['Cilindros', 'Cilindro de freio', ['Mestre', 'De roda'], 9_800, 'UN', 'carro'],
    ['Cabos e manetes', 'Cabo de freio', ['Dianteiro', 'Traseiro'], 1_900, 'UN', 'moto'],
  ]],
  ['Suspensão', [
    ['Amortecedores', 'Amortecedor', ['Dianteiro', 'Traseiro', 'Monoshock'], 21_000, 'UN', 'ambos'],
    ['Molas', 'Mola', ['Helicoidal', 'Esportiva'], 12_000, 'UN', 'carro'],
    ['Bandejas', 'Bandeja de suspensão', ['Inferior', 'Superior'], 24_000, 'UN', 'carro'],
    ['Buchas', 'Bucha', ['Bandeja', 'Estabilizadora', 'Balança'], 1_500, 'UN', 'ambos'],
    ['Retentores de bengala', 'Retentor de bengala', ['Par', 'Com guarda-pó'], 2_800, 'UN', 'moto'],
  ]],
  ['Motor', [
    ['Juntas', 'Junta', ['Cabeçote', 'Tampa de válvulas', 'Cárter', 'Completa'], 2_400, 'UN', 'ambos'],
    ['Pistões e anéis', 'Kit pistão com anéis', ['Standard', 'Sobremedida 0,50', 'Sobremedida 1,00'], 16_000, 'UN', 'moto'],
    ['Correias', 'Correia', ['Dentada', 'Poli-V', 'Variador'], 7_500, 'UN', 'ambos'],
    ['Válvulas', 'Válvula', ['Admissão', 'Escape'], 2_100, 'UN', 'ambos'],
    ['Bombas', 'Bomba', ['De óleo', 'D\'água'], 13_500, 'UN', 'ambos'],
  ]],
  ['Filtros', [
    ['Filtro de óleo', 'Filtro de óleo', ['Rosca', 'Refil'], 1_800, 'UN', 'ambos'],
    ['Filtro de ar', 'Filtro de ar', ['Motor', 'Cabine'], 2_900, 'UN', 'ambos'],
    ['Filtro de combustível', 'Filtro de combustível', ['Linha', 'Tanque'], 2_200, 'UN', 'ambos'],
  ]],
  ['Elétrica', [
    ['Ignição', 'Ignição', ['Vela', 'Bobina', 'Cabo de vela', 'CDI'], 2_600, 'UN', 'ambos'],
    ['Baterias', 'Bateria', ['Selada', 'Convencional'], 26_000, 'UN', 'ambos'],
    ['Partida e carga', 'Componente de partida', ['Motor de partida', 'Retificador', 'Estator'], 19_000, 'UN', 'ambos'],
    ['Sensores', 'Sensor', ['Rotação', 'Temperatura', 'Oxigênio'], 8_900, 'UN', 'ambos'],
  ]],
  ['Iluminação', [
    ['Lâmpadas', 'Lâmpada', ['Farol', 'Lanterna', 'Pisca'], 900, 'CX', 'ambos'],
    ['Faróis', 'Farol', ['Principal', 'Auxiliar'], 15_500, 'UN', 'ambos'],
    ['Lanternas', 'Lanterna', ['Traseira', 'De placa'], 6_400, 'UN', 'ambos'],
  ]],
  ['Transmissão', [
    ['Embreagem', 'Embreagem', ['Kit', 'Disco', 'Platô', 'Cabo'], 9_900, 'UN', 'ambos'],
    ['Relação', 'Kit relação', ['Aço 1045', 'Retentor', 'Reforçada'], 14_500, 'UN', 'moto'],
    ['Câmbio', 'Peça de câmbio', ['Retentor', 'Rolamento', 'Garfo'], 4_300, 'UN', 'ambos'],
  ]],
  ['Arrefecimento', [
    ['Radiadores', 'Radiador', ['Alumínio', 'Cobre'], 32_000, 'UN', 'carro'],
    ['Mangueiras', 'Mangueira', ['Superior', 'Inferior'], 3_600, 'UN', 'carro'],
    ['Aditivos', 'Aditivo de radiador', ['Concentrado', 'Pronto uso'], 2_300, 'GL', 'ambos'],
  ]],
  ['Alimentação', [
    ['Injeção', 'Bico injetor', ['Moto', 'Flex'], 11_000, 'UN', 'ambos'],
    ['Bombas de combustível', 'Bomba de combustível', ['Elétrica', 'Refil'], 16_500, 'UN', 'ambos'],
    ['Carburação', 'Carburador', ['Completo', 'Kit reparo'], 8_700, 'UN', 'moto'],
  ]],
  ['Escapamento', [
    ['Silenciosos', 'Silencioso', ['Traseiro', 'Intermediário', 'Esportivo'], 19_500, 'UN', 'ambos'],
    ['Coletores', 'Coletor de escape', ['Com junta', 'Inox'], 11_500, 'UN', 'ambos'],
  ]],
  ['Direção', [
    ['Terminais', 'Terminal de direção', ['Esquerdo', 'Direito'], 4_600, 'UN', 'carro'],
    ['Barras', 'Barra axial', ['Esquerda', 'Direita'], 5_300, 'UN', 'carro'],
    ['Caixas de direção', 'Caixa de direção', ['Cônica', 'Esferas'], 3_900, 'UN', 'moto'],
  ]],
  ['Lubrificantes', [
    ['Óleo de motor', 'Óleo de motor', ['4T 20W50', '4T 10W30', 'Sintético 5W30', 'Semissintético 15W40'], 3_100, 'LT', 'ambos'],
    ['Graxas', 'Graxa', ['Rolamento', 'Chassi'], 2_700, 'KG', 'ambos'],
    ['Fluidos de freio', 'Fluido de freio', ['DOT 3', 'DOT 4'], 2_000, 'TB', 'ambos'],
  ]],
];

/** [montadora, modelo, primeiro ano, último ano (null = em linha), tipo] */
const VEICULOS: readonly (readonly [string, string, number, number | null, 'moto' | 'carro'])[] = [
  ['Honda', 'CG 150 Titan', 2004, 2015, 'moto'], ['Honda', 'CG 160 Fan', 2016, null, 'moto'], ['Honda', 'Biz 125', 2006, null, 'moto'],
  ['Honda', 'Pop 110i', 2016, null, 'moto'], ['Honda', 'CB 300F Twister', 2022, null, 'moto'], ['Honda', 'XRE 300', 2009, null, 'moto'],
  ['Honda', 'NXR 160 Bros', 2015, null, 'moto'], ['Honda', 'PCX 160', 2023, null, 'moto'], ['Yamaha', 'YBR 125 Factor', 2009, 2016, 'moto'],
  ['Yamaha', 'Factor 150', 2016, null, 'moto'], ['Yamaha', 'Fazer 250', 2006, 2017, 'moto'], ['Yamaha', 'Crosser 150', 2014, null, 'moto'],
  ['Yamaha', 'NMax 160', 2016, null, 'moto'], ['Yamaha', 'Lander 250', 2007, null, 'moto'], ['Suzuki', 'Yes 125', 2005, 2014, 'moto'],
  ['Shineray', 'Jet 50', 2012, null, 'moto'], ['Dafra', 'Speed 150', 2008, 2016, 'moto'], ['Haojue', 'DK 150', 2018, null, 'moto'],
  ['Volkswagen', 'Gol 1.0', 2008, 2023, 'carro'], ['Volkswagen', 'Fox 1.6', 2010, 2021, 'carro'], ['Volkswagen', 'Saveiro 1.6', 2010, null, 'carro'],
  ['Volkswagen', 'Polo 1.0 TSI', 2018, null, 'carro'], ['Fiat', 'Uno 1.0', 2011, 2021, 'carro'], ['Fiat', 'Palio 1.0', 2004, 2017, 'carro'],
  ['Fiat', 'Strada 1.4', 2013, 2020, 'carro'], ['Fiat', 'Argo 1.0', 2018, null, 'carro'], ['Fiat', 'Mobi 1.0', 2017, null, 'carro'],
  ['Chevrolet', 'Onix 1.0', 2013, null, 'carro'], ['Chevrolet', 'Prisma 1.4', 2013, 2019, 'carro'], ['Chevrolet', 'Celta 1.0', 2006, 2015, 'carro'],
  ['Chevrolet', 'S10 2.8 Diesel', 2012, null, 'carro'], ['Ford', 'Ka 1.0', 2015, 2021, 'carro'], ['Ford', 'Fiesta 1.6', 2011, 2019, 'carro'],
  ['Ford', 'Ranger 3.2', 2013, 2022, 'carro'], ['Renault', 'Sandero 1.0', 2015, 2022, 'carro'], ['Renault', 'Kwid 1.0', 2018, null, 'carro'],
  ['Toyota', 'Corolla 2.0', 2015, null, 'carro'], ['Toyota', 'Hilux 2.8', 2016, null, 'carro'], ['Hyundai', 'HB20 1.0', 2013, null, 'carro'],
  ['Nissan', 'Kicks 1.6', 2017, null, 'carro'],
];

/** Marcas PRÓPRIAS dos produtos (inventadas). */
const MARCAS = [
  'Norfreio', 'FiltraMax', 'Voltrix', 'Rodaforte', 'Amazopeças', 'Tarumã', 'Solimões Parts', 'Caburaí', 'Uirapuru', 'Vitória-Régia',
  'Mavalle', 'Torque Norte', 'Bravamoto', 'Igarapé', 'Ventura', 'Pirarucu', 'Monte Roraima', 'Ribeira', 'Tucumã', 'Açaí Motors',
  'Brasa', 'Tapajós', 'Jauaperi', 'Rio Branco Peças', 'Parima', 'Anavilhanas', 'Cupuaçu', 'Macuxi Line', 'Pacaraima', 'Uraricoera',
] as const;

/** Marcas CONCORRENTES das referências cruzadas (inventadas) e o padrão do código de cada uma. */
const CONCORRENTES: readonly (readonly [string, string])[] = [
  ['Freiomax', 'FM-####'], ['Rotafix', 'RT ####'], ['Nortec', 'NT.####'], ['Vialume', 'VL####'], ['Motopar', 'MP-###-#'],
  ['Trilha Peças', 'TP ###'], ['Cobrax', 'CB ####'], ['Duraforte', 'DF-####'], ['Ignis', 'IG####'], ['Serrapeças', 'SP/####'],
];

const ARGUMENTOS = [
  'Alta durabilidade e encaixe original.',
  'Item de giro: reposição semanal na maioria das lojas.',
  'Garantia de fábrica contra defeitos de fabricação.',
  'Produto homologado, com nota fiscal e rastreio de lote.',
  'Embalagem com instruções de montagem.',
  'Melhor custo-benefício da linha.',
] as const;

const BAIRROS = [
  'Centro', 'Aparecida', 'Cachoeirinha', 'Petrópolis', 'Japiim', 'Cidade Nova', 'Compensa', 'Flores', 'Alvorada', 'Educandos',
  'São Francisco', 'Coroado', 'Armando Mendes', 'Zumbi', 'Novo Aleixo', 'Santa Etelvina', 'Tarumã', 'Ponta Negra', 'Redenção', 'Dom Pedro',
] as const;
const RUAS = ['Avenida Rio Negro', 'Rua das Oficinas', 'Avenida Torquato Tapajós', 'Rua do Comércio', 'Avenida Constantino Nery', 'Rua Uirapuru', 'Rua Pará', 'Avenida Djalma Batista'] as const;
const RAMOS = ['Auto Peças', 'Moto Peças', 'Comercial de Peças', 'Distribuidora', 'Oficina e Peças', 'Centro Automotivo', 'Moto Center', 'Casa do Mecânico'] as const;
const NOMES_LOJA = ['Rio Negro', 'Encontro das Águas', 'Ponta Negra', 'Boa Vista', 'Amazonas', 'Tarumã', 'Caburaí', 'Uirapuru', 'Solimões', 'Madeira', 'Purus', 'Negro e Branco'] as const;
const SEGMENTOS = ['Auto peças', 'Moto peças', 'Oficina', 'Revenda'] as const;

/** Depósitos (código, nome). */
export const DEPOSITOS_CARGA = [
  ['T107-MAO', 'CD Manaus (carga)'],
  ['T107-BVB', 'Filial Boa Vista (carga)'],
] as const;

/**
 * Sinônimos do tenant (busca): os mesmos termos que um analista cadastraria. O termo é único por tenant
 * (`sinonimo_termo_uk`, lower(termo)) e a fixture dois-tenants já tem `pastilha` em A: nenhum termo daqui repete os dela.
 */
const SINONIMOS: readonly (readonly [string, readonly string[]])[] = [
  ['moto', ['motocicleta', 'motoca']],
  ['cc', ['cilindradas']],
  ['disco', ['discos', 'rotor de freio']],
  ['amortecedor', ['amortecedores', 'shock']],
  ['oleo', ['óleo', 'lubrificante']],
  ['relacao', ['kit relação', 'coroa pinhão']],
];

// ---------------------------------------------------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------------------------------------------------
/** EAN-13 com dígito verificador válido; prefixo 789 + empresa fictícia 99107 + item (4 dígitos). */
export function ean13(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error(`ean13: base inválida ${base12}`);
  const soma = [...base12].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base12 + String((10 - (soma % 10)) % 10);
}

/** CNPJ (14 dígitos) com DV válido a partir de uma raiz de 8 + filial de 4. */
export function cnpj(raiz8: string, filial4 = '0001'): string {
  const base = raiz8 + filial4;
  if (!/^\d{12}$/.test(base)) throw new Error('cnpj: base inválida');
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((acc, d, i) => acc + Number(d) * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv(base + d1);
  return `${base}${d1}${d2}`;
}

export function cnpjValido(doc: string): boolean {
  return /^\d{14}$/.test(doc) && cnpj(doc.slice(0, 8), doc.slice(8, 12)) === doc;
}

function codigoDoPadrao(padrao: string, r: Prng): string {
  return padrao.replace(/#/g, () => String(r.inteiro(0, 9)));
}

/** Aplicação de 1 a 4 veículos, com separadores variados (faixa fechada "–", " a ", "/" e aberta "em diante"). */
function aplicacaoDe(uso: Uso, r: Prng): string {
  const candidatos = VEICULOS.filter(([, , , , tipo]) => uso === 'ambos' || tipo === uso);
  const n = r.inteiro(1, 4);
  const escolhidos = new Set<number>();
  while (escolhidos.size < Math.min(n, candidatos.length)) escolhidos.add(r.inteiro(0, candidatos.length - 1));
  return [...escolhidos]
    .sort((x, y) => x - y)
    .map((i) => {
      const [montadora, modelo, de, ate] = candidatos[i]!;
      if (ate === null) return `${montadora} ${modelo} ${de} em diante`;
      const sep = r.escolher([' – ', ' a ', '/', '-']);
      return `${montadora} ${modelo} ${de}${sep}${ate}`;
    })
    .join('; ');
}

const pad = (n: number, tam: number) => String(n).padStart(tam, '0');

// ---------------------------------------------------------------------------------------------------------------------
// Gerador
// ---------------------------------------------------------------------------------------------------------------------
export interface ResumoBase {
  semente: number;
  produtos: number;
  clientes: number;
  vendedores: VendedorCarga[];
  /** id da tabela de preço única do tenant (todos os clientes nela). */
  tabelaPrecoId: string;
  /** SKUs e termos de busca de exemplo para os testes (determinísticos). */
  termosDeBusca: string[];
  /** Produtos com estoque positivo no CD principal (bons para pedido sem ruptura). */
  produtosComEstoque: { id: string; sku: string; preco_cents: number; unidade: string }[];
  clientesPorVendedor: Record<string, string[]>;
}

export function gerarBaseCarga(op: OpcoesBase): { base: BaseCarga; resumo: ResumoBase } {
  const semente = op.semente ?? SEMENTE_PADRAO;
  const nProdutos = op.produtos ?? PRODUTOS_PADRAO;
  const nClientes = op.clientes ?? CLIENTES_PADRAO;
  const r = criarPrng(semente);
  const T = op.tenantId;
  const id = (chave: string) => idDeChave(`t0107:${semente}:${chave}`);
  const comuns = { tenant_id: T, created_at: op.instante, updated_at: op.instante, deleted_at: null } as const;

  // ---- equipe e vendedores (3, cada um com 1/3 da carteira)
  const equipeId = id('equipe:1');
  const vendedores: VendedorCarga[] = [1, 2, 3].map((n) => ({ id: id(`usuario:vendedor:${n}`), email: `vendedor${n}.carga@exemplo.com.br`, nome: `Vendedor Carga ${n}` }));
  const equipe: Linha[] = [{ id: equipeId, nome: 'Equipe Carga', equipe_pai_id: null, responsavel_id: null, ativo: true, external_id: 'EQ-CARGA', ...comuns }];
  const usuarios: Linha[] = vendedores.map((v, i) => ({
    id: v.id, nome: v.nome, nome_curto: `Carga ${i + 1}`, email: v.email, perfil: 'vendedor', equipe_id: equipeId, senha_hash: op.senhaHash, ativo: true,
    bloqueado_em: null, ultimo_login_em: null, external_id: `VEND-${pad(i + 1, 3)}`, ...comuns,
  }));

  // ---- árvore sistema › grupo › linha
  const nos: Linha[] = [];
  const folhas: { noId: string; sistema: string; grupo: Grupo; linha: string; codigo: string }[] = [];
  ARVORE_SISTEMAS.forEach(([sistema, grupos], s) => {
    const codS = `T107-S${pad(s + 1, 2)}`;
    const idS = id(`no:${codS}`);
    nos.push({ id: idS, pai_id: null, nivel: 1, codigo: codS, nome: sistema, ordem: s + 1, ativo: true, external_id: codS, ...comuns });
    grupos.forEach((grupo, g) => {
      const codG = `${codS}.G${pad(g + 1, 2)}`;
      const idG = id(`no:${codG}`);
      nos.push({ id: idG, pai_id: idS, nivel: 2, codigo: codG, nome: grupo[0], ordem: g + 1, ativo: true, external_id: codG, ...comuns });
      grupo[2].forEach((linha, l) => {
        const codL = `${codG}.L${pad(l + 1, 2)}`;
        const idL = id(`no:${codL}`);
        nos.push({ id: idL, pai_id: idG, nivel: 3, codigo: codL, nome: linha, ordem: l + 1, ativo: true, external_id: codL, ...comuns });
        folhas.push({ noId: idL, sistema, grupo, linha, codigo: codL });
      });
    });
  });

  // ---- produtos
  const produtos: Linha[] = [];
  const unidades: Linha[] = [];
  const produtoNo: Linha[] = [];
  const conteudos: Linha[] = [];
  const atributos: Linha[] = [];
  const referencias: Linha[] = [];
  const busca: Linha[] = [];
  const precos: Linha[] = [];
  const estoques: Linha[] = [];
  const tabelaPrecoId = id('tabela_preco:PADRAO');
  const depositos = DEPOSITOS_CARGA.map(([codigo, nome]) => ({ id: id(`deposito:${codigo}`), codigo, nome }));
  const produtosComEstoque: ResumoBase['produtosComEstoque'] = [];
  const termos = new Set<string>();

  for (let n = 1; n <= nProdutos; n++) {
    const folha = folhas[(n - 1) % folhas.length]!;
    const [, item, , precoBase, unidade, uso] = folha.grupo;
    const marca = r.escolher(MARCAS);
    const sku = `${folha.codigo.replace(/^T107-/, '').replace(/\./g, '')}-${pad(n, 5)}`; // S01G01L01-00001
    const pid = id(`produto:${n}`);
    const temAplicacao = folha.sistema !== 'Lubrificantes' && !r.chance(0.08);
    const aplicacao = temAplicacao ? aplicacaoDe(uso, r) : null;
    const veiculoNome = aplicacao ? aplicacao.split(';')[0]!.replace(/\s\d{4}.*$/, '') : null;
    const nome = `${item} ${folha.linha.toLowerCase()}${veiculoNome ? ` ${veiculoNome}` : ''} ${marca}`.slice(0, 120);
    const preco = Math.max(150, Math.round((precoBase * (0.6 + r.proximo() * 1.4)) / 10) * 10);
    const custo = Math.round(preco * (0.6 + r.proximo() * 0.2));
    // EAN só nos 10 mil primeiros (o ERP de autopeças não tem EAN em todo item); base 12 dígitos única por produto
    const ean = n <= 10_000 && r.chance(0.85) ? ean13(`7899910${pad(n, 5)}`) : null;
    produtos.push({
      id: pid, sku, ean, nome, marca, categoria: folha.sistema, unidade, ativo: true, external_id: `ERP-${sku}`,
      custo_cents: custo, preco_venda_cents: preco, desconto_maximo_pct: r.chance(0.05) ? 5 : null, ...comuns,
    });
    unidades.push({ id: id(`produto_unidade:${n}:${unidade}`), produto_id: pid, unidade, fator: 1, ean: null, padrao: true, ativo: true, external_id: null, ...comuns });
    // caixa com 10 ou 12 em ~10% dos itens (não para quem já é CX)
    if (unidade !== 'CX' && r.chance(0.1)) {
      unidades.push({ id: id(`produto_unidade:${n}:CX`), produto_id: pid, unidade: 'CX', fator: r.escolher([10, 12]), ean: null, padrao: false, ativo: true, external_id: null, ...comuns });
    }
    produtoNo.push({ id: id(`produto_no:${n}`), produto_id: pid, no_id: folha.noId, external_id: null, ...comuns });

    const descricao = `${item} linha ${folha.linha.toLowerCase()} (${folha.grupo[0]} · ${folha.sistema}) da marca ${marca}.`;
    const argumentos = r.escolher(ARGUMENTOS);
    const etiquetas = [folha.linha.length <= 20 ? folha.linha : null, r.chance(0.03) ? 'Novo' : null].filter((x): x is string => x !== null);
    conteudos.push({
      id: id(`produto_conteudo:${n}`), produto_id: pid, descricao, aplicacoes: aplicacao, argumentos_venda: argumentos,
      faq: r.chance(0.02) ? [{ pergunta: 'Serve em outra versão do modelo?', resposta: 'Confira a aplicação e o código da peça original antes de vender.' }] : [],
      campanha: r.chance(0.01), destaque: r.chance(0.01), etiquetas, external_id: null, ...comuns,
    });
    const garantia = r.escolher([3, 6, 12]);
    const atr: [string, string, number | null, string | null][] = [
      ['Linha', folha.linha, null, null],
      ['Garantia', String(garantia), garantia, 'meses'],
    ];
    atr.forEach(([nomeA, valor, valor_num, un], i) =>
      atributos.push({ id: id(`produto_atributo:${n}:${nomeA}`), produto_id: pid, nome: nomeA, valor, valor_num, unidade: un, ordem: i + 1, external_id: null, ...comuns }),
    );

    // referências cruzadas: 0 a 3, marcas distintas
    const nRef = r.escolher([0, 1, 1, 2, 2, 3]);
    const marcasRef = new Set<number>();
    while (marcasRef.size < nRef) marcasRef.add(r.inteiro(0, CONCORRENTES.length - 1));
    const refsDoProduto = [...marcasRef].map((m, i) => {
      const [marcaNome, padrao] = CONCORRENTES[m]!;
      const codigo = codigoDoPadrao(padrao, r);
      return {
        id: id(`produto_referencia:${n}:${i + 1}`), produto_id: pid, marca_id: id(`concorrente:${marcaNome}`), marca_nome: marcaNome, codigo,
        codigo_compacto: codigoCompacto(codigo), ordem: i + 1, external_id: null, ...comuns,
      };
    });
    referencias.push(...refsDoProduto);

    busca.push({
      id: id(`produto_busca:${n}`), produto_id: pid, sku, ean, nome, marca, categoria: `${folha.sistema} ${folha.grupo[0]}`,
      atributos: atr.map(([a, v, , u]) => `${a} ${v}${u ? ` ${u}` : ''}`).join('; '), conteudo: `${descricao} ${argumentos}`, ativo: true,
      aplicacao: aplicacao ? expandirAplicacao(aplicacao, { anoAtual: ANO_DA_BASE }).textoIndice : null,
      referencias: refsDoProduto.length ? refsDoProduto.flatMap((x) => [x.codigo, x.codigo_compacto]).join(' ') : null,
      external_id: null, ...comuns,
    });

    precos.push({ id: id(`tabela_preco_item:${n}`), tabela_preco_id: tabelaPrecoId, produto_id: pid, preco_cents: preco, vigencia_inicio: null, vigencia_fim: null, external_id: null, ...comuns });
    const quantidades = depositos.map(() => (r.chance(0.06) ? 0 : r.inteiro(1, 400)));
    depositos.forEach((d, i) =>
      estoques.push({ id: id(`estoque_saldo:${d.codigo}:${n}`), deposito_id: d.id, produto_id: pid, quantidade: quantidades[i]!, atualizado_erp_em: op.instante, external_id: null, ...comuns }),
    );
    if (quantidades[0]! >= 50 && produtosComEstoque.length < 500) produtosComEstoque.push({ id: pid, sku, preco_cents: preco, unidade });
    if (n % 997 === 0) {
      termos.add(sku);
      if (veiculoNome) termos.add(`${item.toLowerCase()} ${veiculoNome.split(' ').slice(1, 3).join(' ')}`);
      if (refsDoProduto[0]) termos.add(refsDoProduto[0].codigo);
    }
  }

  // ---- clientes (CNPJ fictício 90.xxx.xxx/0001-xx, sem telefone/e-mail) e carteira
  const clientes: Linha[] = [];
  const carteira: Linha[] = [];
  const financeiro: Linha[] = [];
  const clienteTabela: Linha[] = [];
  const clientesPorVendedor: Record<string, string[]> = Object.fromEntries(vendedores.map((v) => [v.id, []]));
  for (let c = 1; c <= nClientes; c++) {
    const cid = id(`cliente:${c}`);
    const bairro = r.escolher(BAIRROS);
    const ramo = r.escolher(RAMOS);
    const nomeLoja = r.escolher(NOMES_LOJA);
    const lat = Number((-3.0 - r.proximo() * 0.15).toFixed(6));
    const lon = Number((-59.95 - r.proximo() * 0.15).toFixed(6));
    clientes.push({
      id: cid, documento: cnpj(`90${pad(c, 6)}`), razao_social: `${ramo} ${nomeLoja} ${pad(c, 4)} Ltda`,
      nome_fantasia: `${ramo} ${nomeLoja} ${pad(c, 4)}`, segmento: r.escolher(SEGMENTOS), telefone: null, email: null,
      logradouro: r.escolher(RUAS), numero: String(r.inteiro(10, 3999)), bairro, cidade: 'Manaus', uf: 'AM', cep: `690${pad(r.inteiro(0, 99_999), 5)}`,
      latitude: lat, longitude: lon, ativo: true, external_id: `CLI-${pad(c, 5)}`, ...comuns,
    });
    const vendedor = vendedores[(c - 1) % vendedores.length]!;
    clientesPorVendedor[vendedor.id]!.push(cid);
    carteira.push({ id: id(`carteira:${c}`), cliente_id: cid, usuario_id: vendedor.id, papel: 'vendedor', inicio: null, fim: null, external_id: null, ...comuns });
    // limite folgado: os 100 pedidos da carga não podem esbarrar no crédito (não é o que se mede)
    financeiro.push({
      id: id(`cliente_financeiro:${c}`), cliente_id: cid, limite_cents: 50_000_000, saldo_aberto_cents: r.inteiro(0, 500_000), credito_disponivel_cents: null,
      bloqueado: false, motivo_bloqueio: null, atualizado_erp_em: op.instante, external_id: null, ...comuns,
    });
    clienteTabela.push({ id: id(`cliente_tabela_preco:${c}`), cliente_id: cid, tabela_preco_id: tabelaPrecoId, external_id: null, ...comuns });
  }

  const base: BaseCarga = {
    'core.equipe': equipe,
    'core.usuario': usuarios,
    'core.produto': produtos,
    'core.produto_unidade': unidades,
    'catalogo.catalogo_no': nos,
    'catalogo.produto_no': produtoNo,
    'catalogo.produto_conteudo': conteudos,
    'catalogo.produto_atributo': atributos,
    'catalogo.produto_referencia': referencias,
    'catalogo.sinonimo': SINONIMOS.map(([termo, lista]) => ({ id: id(`sinonimo:${termo}`), termo, sinonimos: [...lista], ativo: true, external_id: null, ...comuns })),
    'catalogo.produto_busca': busca,
    'catalogo.tabela_preco': [{ id: tabelaPrecoId, codigo: 'T107-PADRAO', nome: 'Tabela padrão (carga)', ativo: true, external_id: 'TP-PADRAO', ...comuns }],
    'catalogo.tabela_preco_item': precos,
    'catalogo.deposito': depositos.map((d) => ({ id: d.id, codigo: d.codigo, nome: d.nome, ativo: true, external_id: d.codigo, ...comuns })),
    'catalogo.estoque_saldo': estoques,
    'core.cliente': clientes,
    'core.carteira': carteira,
    'core.cliente_financeiro': financeiro,
    'catalogo.cliente_tabela_preco': clienteTabela,
  };
  return {
    base,
    resumo: { semente, produtos: nProdutos, clientes: nClientes, vendedores, tabelaPrecoId, termosDeBusca: [...termos], produtosComEstoque, clientesPorVendedor },
  };
}

/** Impressão digital da base (sha256 de todas as linhas, na ordem de gravação): prova o determinismo. */
export function impressaoDigital(base: BaseCarga): string {
  const h = createHash('sha256');
  for (const t of ORDEM_TABELAS_CARGA) {
    h.update(t);
    for (const linha of base[t]) h.update(JSON.stringify(linha));
  }
  return h.digest('hex');
}

/**
 * Grava a base pela conexão de ADMINISTRAÇÃO (dona das tabelas; a RLS não se aplica ao dono/superusuário), em lotes de
 * `lote` linhas com `json_populate_recordset(null::<tabela>, $1)`: o Postgres converte cada coluna pelo tipo da própria
 * tabela (uuid, timestamptz, numeric, jsonb; array JSON de texto vira text[] — `etiquetas`, `sinonimos` — desde o PG 10),
 * sem SQL montado com valores. Os gatilhos rodam (o tsvector de produto_busca, updated_at). Colunas omitidas pegam o
 * default da tabela (ex.: `cadastro_incompleto`/`cadastro_campos_faltantes` do cliente). `on conflict do nothing` deixa a
 * gravação repetível na mesma base, mas ESCONDE colisão com a fixture: quem chama confere o devolvido (linhas gravadas por
 * tabela) contra o tamanho da base — o teste de carga faz isso.
 */
export async function gravarBaseCarga(
  admin: { query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }> },
  base: BaseCarga,
  lote = 5_000,
): Promise<Record<TabelaCarga, number>> {
  const total = {} as Record<TabelaCarga, number>;
  for (const tabela of ORDEM_TABELAS_CARGA) {
    const linhas = base[tabela];
    total[tabela] = 0;
    if (linhas.length === 0) continue;
    const colunas = Object.keys(linhas[0]!);
    for (const c of colunas) if (!/^[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`coluna inválida: ${c}`);
    const lista = colunas.join(', ');
    for (let i = 0; i < linhas.length; i += lote) {
      const r = await admin.query(
        `insert into ${tabela} (${lista}) select ${lista} from json_populate_recordset(null::${tabela}, $1::json) on conflict do nothing`,
        [JSON.stringify(linhas.slice(i, i + lote))],
      );
      total[tabela] += r.rowCount ?? 0;
    }
  }
  return total;
}
