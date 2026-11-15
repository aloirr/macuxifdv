/**
 * Diagnóstico de carga e busca do SQLite no aparelho (T-0008, critérios 1 e 2; desenho T-0008 P7; T-0084, critério 5).
 * Lógica PURA, sem expo-sqlite: roda no Vitest com o driver `node:sqlite` e no aparelho com o driver Expo
 * (`@/services/sqlite-expo`).
 *
 * - Dados sintéticos determinísticos no formato do pull (`ProdutoSync`/`ClienteSync` do Core, `ProdutoAtributoSync`,
 *   `ProdutoConteudoSync` e `ProdutoReferenciaSync` do Catálogo): 20 mil SKUs (+ 2 atributos cada), 20 mil conteúdos com
 *   aplicação (90% perto de 2.000 caracteres, o teto da RN-CAT-11), ~16,7 mil referências cruzadas (RN-CAT-09) e 500
 *   clientes, gerados página a página (como chegam do servidor).
 * - Carga pelo adaptador do SDK (`criarArmazenamentoSqlite`, lotes de 500 por transação, páginas de 1.000) com as
 *   migrações e o índice de busca REAIS do shell (os do Catálogo vêm de `shell.migracoesAparelho`/`indicesBusca`).
 * - Reindexação completa pelo caminho real (T-0084: índice v3 recriado vazio com as linhas já no aparelho): esvazia o
 *   índice, reabre o banco (as migrações marcam o L-1) e mede o `finalizar` (documentos das linhas locais + `rebuild`).
 *   T-0088: com as opções do adaptador do APP (`opcoesDoAdaptador`, `buscaSemEsperarIndexacao`), a 1ª busca logo depois
 *   da reabertura responde `indexando` sem esperar (a tela varre) e a reindexação segue em segundo plano, como no motor
 *   do usuário; o tempo dessa 1ª busca e o motivo entram no relatório.
 * - ~200 buscas de produto (FTS5 + leitura dos 50 primeiros, o que a tela mostra), 60 buscas do Novo pedido pela
 *   consulta `catalogo.busca_produtos@1` (C9) de ponta a ponta (registro de consultas do shell, mesma implementação do
 *   aparelho, sobre este banco) e 100 de cliente (lista + filtro em memória, desenho T-0016 §8), com p50/p95/máximo.
 * - "Sem travar": o medidor de quadros (`criarMedidorQuadros`) recebe os carimbos do `requestAnimationFrame` da tela.
 * Nunca usa o banco do usuário: quem chama abre um arquivo próprio e temporário. Sem dado pessoal (tudo sintético).
 */
import { localIsoDate, formatHHMM } from '@macuxi/comum/fuso';
import {
  criarArmazenamentoSqlite,
  normalizarBusca,
  type ArmazenamentoSqlite,
  type ConsultaTexto,
  type DriverSqlite,
  type FontesConsultaAparelho,
  type IndiceBusca,
  type LinhaSync,
  type MigracaoAparelho,
  type ModuloId,
  type OpcoesArmazenamentoSqlite,
  type RegistroConsultasAparelho,
} from '@macuxi/platform-sdk';
import type { ClienteSync, ProdutoSync } from '@macuxi/core/contracts';
import { CONSULTA_BUSCA_PRODUTOS, type ProdutoAtributoSync, type ProdutoConteudoSync, type ProdutoReferenciaSync } from '@macuxi/catalogo/contracts';

import type { PerfilBuild } from './endereco-do-build';

// ---------- quem pode abrir ----------

/** A tela só existe no bundle de desenvolvimento (`expo start`); nunca em produção. */
export function diagnosticoDisponivel(perfil: PerfilBuild): boolean {
  return perfil === 'desenvolvimento';
}

/** Toques seguidos na versão (Perfil) para abrir a tela; toque depois de `janelaMs` recomeça a conta. */
export const TOQUES_PARA_ABRIR = 7;
export const JANELA_TOQUES_MS = 3000;

/** Conta os toques; `tocar` devolve `true` no 7º toque seguido (e zera). */
export function criarContadorToques(alvo = TOQUES_PARA_ABRIR, janelaMs = JANELA_TOQUES_MS) {
  let conta = 0;
  let ultimo = Number.NEGATIVE_INFINITY;
  return {
    tocar(agora: number): boolean {
      conta = agora - ultimo <= janelaMs ? conta + 1 : 1;
      ultimo = agora;
      if (conta >= alvo) {
        conta = 0;
        ultimo = Number.NEGATIVE_INFINITY;
        return true;
      }
      return false;
    },
    faltam(): number {
      return alvo - conta;
    },
  };
}

// ---------- gerador determinístico ----------

const NOMES = ['Rolamento', 'Pastilha de freio', 'Disco de freio', 'Óleo de motor', 'Filtro de ar', 'Correia dentada', 'Amortecedor', 'Vela de ignição', 'Junta do cabeçote', 'Bomba d’água', 'Lâmpada farol', 'Embreagem'];
const COMPLEMENTOS = ['dianteiro', 'traseiro', 'esquerdo', 'direito', 'reforçado', 'cerâmica', 'sintético 5W30', 'linha pesada', 'ação rápida', 'anti-ruído'];
const MARCAS = ['Bosch', 'NGK', 'Cofap', 'Fras-le', 'SKF', 'Mahle', 'Valeo', 'Gates', 'Nakata', 'Tecfil'];
const CATEGORIAS = ['Freios', 'Motor', 'Suspensão', 'Elétrica', 'Transmissão', 'Filtros', 'Arrefecimento', 'Iluminação'];
const CIDADES = ['Boa Vista', 'Manaus', 'Belém', 'Macapá', 'Santarém', 'Parintins'];
const APLICACOES = ['Gol', 'Onix', 'Hilux', 'Strada', 'HB20'];
const QUANDO = '2026-10-01T00:00:00.000Z';

/** UUID v4 válido e determinístico (prefixo separa produto, atributo e cliente). */
export const uuidSintetico = (prefixo: number, i: number) => `${String(prefixo).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`;

const de = <T>(lista: readonly T[], i: number): T => lista[i % lista.length]!;

export function produtoSintetico(i: number): ProdutoSync {
  return {
    id: uuidSintetico(1, i),
    updated_at: QUANDO,
    deleted_at: null,
    external_id: `ERP-${i}`,
    sku: `${6000 + (i % 4000)}-${de(['2RS', 'ZZ', 'C3', 'XL', 'P'], i)}-${i}`,
    ean: i % 7 === 0 ? null : String(7890000000000 + i),
    nome: `${de(NOMES, i)} ${de(COMPLEMENTOS, i * 7)} ${i}`,
    marca: de(MARCAS, i * 3),
    categoria: de(CATEGORIAS, i),
    unidade: 'UN',
    ativo: true,
  };
}

export function atributosSinteticos(i: number): ProdutoAtributoSync[] {
  const base = { updated_at: QUANDO, deleted_at: null, external_id: null, produto_id: uuidSintetico(1, i) };
  return [
    { ...base, id: uuidSintetico(2, i * 2), nome: 'aplicação', valor: de(APLICACOES, i), ordem: 0 },
    { ...base, id: uuidSintetico(2, i * 2 + 1), nome: 'medida', valor: `${10 + (i % 40)}mm`, ordem: 1 },
  ];
}

export function clienteSintetico(i: number): ClienteSync {
  return {
    id: uuidSintetico(3, i),
    updated_at: QUANDO,
    deleted_at: null,
    external_id: `CLI-${i}`,
    documento: String(10_000_000_000_000 + i * 97).padStart(14, '0'),
    razao_social: `Auto Peças São ${de(['João', 'José', 'Sebastião', 'Pedro'], i)} ${i} Ltda`,
    nome_fantasia: `${de(['Ponto', 'Casa', 'Central', 'Mundo'], i)} das Peças ${i}`,
    segmento: 'Autopeças',
    telefone: null,
    email: null,
    logradouro: null,
    numero: null,
    bairro: null,
    cidade: de(CIDADES, i),
    uf: null,
    cep: null,
    latitude: null,
    longitude: null,
    ativo: true,
  };
}

// ---------- aplicação longa e referências (T-0084 critério 5; RN-CAT-11, RN-CAT-09) ----------

/** 40 veículos (marca, modelo), na ordem: as 5 versões de cada um ficam juntas no conjunto de trechos. */
const VEICULOS: readonly (readonly [string, string])[] = [
  ['Fiat', 'Uno'], ['Fiat', 'Palio'], ['Fiat', 'Strada'], ['Fiat', 'Siena'], ['Fiat', 'Mobi'], ['Fiat', 'Argo'],
  ['VW', 'Gol'], ['VW', 'Voyage'], ['VW', 'Fox'], ['VW', 'Saveiro'], ['VW', 'Polo'], ['VW', 'Up'],
  ['GM', 'Onix'], ['GM', 'Prisma'], ['GM', 'Celta'], ['GM', 'Corsa'], ['GM', 'Cobalt'], ['GM', 'S10'],
  ['Ford', 'Ka'], ['Ford', 'Fiesta'], ['Ford', 'EcoSport'], ['Ford', 'Ranger'],
  ['Renault', 'Sandero'], ['Renault', 'Logan'], ['Renault', 'Kwid'], ['Renault', 'Duster'],
  ['Hyundai', 'HB20'], ['Hyundai', 'Creta'], ['Toyota', 'Etios'], ['Toyota', 'Corolla'], ['Toyota', 'Hilux'],
  ['Honda', 'Fit'], ['Honda', 'City'], ['Honda', 'Civic'], ['Nissan', 'March'], ['Nissan', 'Versa'], ['Nissan', 'Frontier'],
  ['Peugeot', '208'], ['Citroën', 'C3'], ['Jeep', 'Renegade'],
];
const MOTORES = ['1.0', '1.4', '1.6', '1.8', '2.0'];
const POSICOES = ['dianteiro', 'traseiro'];
const COMBUSTIVEIS = ['flex', 'gasolina', 'diesel'];

interface TrechoSintetico {
  texto: string;
  modelo: string;
  anoInicio: number;
  anoFim: number;
}

/** 200 trechos ("Fiat Uno 1.4 2010–2014 dianteiro motor flex", ~45 caracteres), 5 por veículo. */
const TRECHOS: readonly TrechoSintetico[] = VEICULOS.flatMap(([marca, modelo], m) =>
  MOTORES.map((motor, v) => {
    const anoInicio = 1996 + ((m * 3 + v * 4) % 24);
    const anoFim = Math.min(2025, anoInicio + 2 + (v % 4));
    return { texto: `${marca} ${modelo} ${motor} ${anoInicio}–${anoFim} ${de(POSICOES, m + v)} motor ${de(COMBUSTIVEIS, m * 5 + v)}`, modelo, anoInicio, anoFim };
  }),
);

/** Teto da aplicação no cadastro (RN-CAT-11) e o tamanho das curtas (1 em cada 10 produtos). */
export const APLICACAO_MAXIMA = 2000;
export const APLICACAO_CURTA = 300;

/** Trechos da aplicação do produto `i`: uma janela de trechos seguidos (outra para cada produto) até o tamanho alvo. */
export function trechosDaAplicacao(i: number): TrechoSintetico[] {
  const alvo = i % 10 === 9 ? APLICACAO_CURTA : APLICACAO_MAXIMA;
  const inicio = (i * 37) % TRECHOS.length;
  const r: TrechoSintetico[] = [];
  let tamanho = 0;
  for (let k = 0; k < TRECHOS.length; k++) {
    const t = TRECHOS[(inicio + k) % TRECHOS.length]!;
    const novo = tamanho + (r.length > 0 ? 2 : 0) + t.texto.length;
    if (novo > alvo) break;
    r.push(t);
    tamanho = novo;
  }
  return r;
}

/** Texto da aplicação (trechos separados por "; "), sempre ≤ 2.000 caracteres. */
export const aplicacaoSintetica = (i: number) =>
  trechosDaAplicacao(i)
    .map((t) => t.texto)
    .join('; ');

export function conteudoSintetico(i: number): ProdutoConteudoSync {
  return {
    id: uuidSintetico(4, i),
    updated_at: QUANDO,
    deleted_at: null,
    external_id: null,
    produto_id: uuidSintetico(1, i),
    descricao: null,
    argumentos: [],
    faq: [],
    campanha: false,
    aplicacao: aplicacaoSintetica(i),
  };
}

const MARCAS_REFERENCIA = ['Freiomax', 'Rodaforte', 'Travex', 'Pastec', 'Duramil', 'Autorex'];

/** Referências cruzadas do produto `i`: 2 em cada 3 produtos têm a 1ª ("CB 1234"); 1 em cada 6, também a 2ª. */
export function referenciasSinteticas(i: number): ProdutoReferenciaSync[] {
  if (i % 3 === 2) return [];
  const base = { updated_at: QUANDO, deleted_at: null, external_id: null, produto_id: uuidSintetico(1, i) };
  const r: ProdutoReferenciaSync[] = [
    { ...base, id: uuidSintetico(6, i * 2), marca_id: uuidSintetico(5, i % MARCAS_REFERENCIA.length), marca_nome: de(MARCAS_REFERENCIA, i), codigo: `${de(['CB', 'FB', 'HQ', 'PD'], i)} ${1000 + i}`, ordem: 1 },
  ];
  if (i % 6 === 0)
    r.push({ ...base, id: uuidSintetico(6, i * 2 + 1), marca_id: uuidSintetico(5, (i + 1) % MARCAS_REFERENCIA.length), marca_nome: de(MARCAS_REFERENCIA, i + 1), codigo: `${de(['SY', 'JU'], i)}-${i}`, ordem: 2 });
  return r;
}

/** Forma compacta `[a-z0-9]` de um código, como o índice do Catálogo grava (`DET-5L` → `det5l`). */
const compacto = (s: string) => normalizarBusca(s).join('');

export const TIPOS_BUSCA_PRODUTO = ['prefixo_2', 'duas_palavras', 'sinonimos_or', 'sku_hifen', 'codigo_compacto', 'ean'] as const;
export type TipoBuscaProduto = (typeof TIPOS_BUSCA_PRODUTO)[number];

/** Consultas típicas da tela do Catálogo, alternando os 6 tipos (igual ao teste do banco-dados). */
export function consultasDeProduto(quantidade: number, totalProdutos: number): { tipo: TipoBuscaProduto; consulta: ConsultaTexto }[] {
  const r: { tipo: TipoBuscaProduto; consulta: ConsultaTexto }[] = [];
  for (let k = 0; k < quantidade; k++) {
    const p = produtoSintetico((k * 7919) % totalProdutos);
    const tipo = TIPOS_BUSCA_PRODUTO[k % TIPOS_BUSCA_PRODUTO.length]!;
    let consulta: ConsultaTexto;
    if (tipo === 'prefixo_2') consulta = { grupos: [[de(NOMES, k).slice(0, 2)]], prefixoNoUltimo: true, limite: 200 };
    else if (tipo === 'duas_palavras') consulta = { grupos: [['pastilha'], ['fre']], prefixoNoUltimo: true, limite: 200 };
    else if (tipo === 'sinonimos_or') consulta = { grupos: [['oleo', 'lubrificante'], ['motor', 'sintetico']], prefixoNoUltimo: false, limite: 200 };
    else if (tipo === 'sku_hifen') consulta = { grupos: [[p.sku]], prefixoNoUltimo: false, limite: 200 };
    else if (tipo === 'codigo_compacto') consulta = { grupos: [[compacto(p.sku).slice(0, 6)]], prefixoNoUltimo: true, limite: 200 };
    else consulta = { grupos: [[p.ean ?? p.sku]], prefixoNoUltimo: false, limite: 200 };
    r.push({ tipo, consulta });
  }
  return r;
}

/** Buscas do seletor do Novo pedido (C9): veículo e ano, só o veículo, referência, SKU, nome e com a lista do cliente. */
export const TIPOS_BUSCA_C9 = ['veiculo_ano', 'veiculo', 'referencia', 'sku', 'nome', 'com_ids'] as const;
export type TipoBuscaC9 = (typeof TIPOS_BUSCA_C9)[number];

/** Teto de `produto_ids` da C9 (`BuscaProdutosEntradaSchema`): o seletor manda os produtos da tabela do cliente. */
export const IDS_DO_SELETOR = 5000;

export interface ConsultaC9 {
  tipo: TipoBuscaC9;
  q: string;
  /** Quantos dos primeiros produtos vão em `produto_ids` (`com_ids`). */
  ids: number;
  /** Produto que a busca deve trazer (veículo e ano, referência e SKU). */
  alvo: string | null;
}

/** Primeira palavra do nome do produto, em minúsculas ("Pastilha de freio" → "pastilha"). */
const palavraDoNome = (i: number) => de(NOMES, i).split(' ')[0]!.toLowerCase();

/** "pastilha uno 2012": nome + modelo + um ano dentro da faixa de um trecho da aplicação do produto (RN-CAT-12). */
function consultaVeiculoAno(i: number): { q: string; alvo: string } {
  const trechos = trechosDaAplicacao(i);
  const t = trechos[(i * 3) % trechos.length]!;
  const ano = t.anoInicio + (i % (t.anoFim - t.anoInicio + 1));
  return { q: `${palavraDoNome(i)} ${t.modelo.toLowerCase()} ${ano}`, alvo: uuidSintetico(1, i) };
}

export function consultasC9(quantidade: number, totalProdutos: number): ConsultaC9[] {
  const r: ConsultaC9[] = [];
  for (let k = 0; k < quantidade; k++) {
    const tipo = TIPOS_BUSCA_C9[k % TIPOS_BUSCA_C9.length]!;
    // produto com referência (i % 3 !== 2) e com aplicação longa (i % 10 !== 9)
    let i = (k * 7919) % totalProdutos;
    while (i % 3 === 2 || i % 10 === 9) i = (i + 1) % totalProdutos;
    const p = produtoSintetico(i);
    if (tipo === 'veiculo_ano') r.push({ tipo, ...consultaVeiculoAno(i), ids: 0 });
    else if (tipo === 'veiculo') r.push({ tipo, q: de(VEICULOS, k)[1].toLowerCase(), ids: 0, alvo: null });
    else if (tipo === 'referencia') r.push({ tipo, q: referenciasSinteticas(i)[0]!.codigo, ids: 0, alvo: p.id });
    else if (tipo === 'sku') r.push({ tipo, q: p.sku, ids: 0, alvo: p.id });
    else if (tipo === 'nome') r.push({ tipo, q: `${palavraDoNome(k)} ${de(COMPLEMENTOS, k).split(' ')[0]!}`, ids: 0, alvo: null });
    else {
      const ids = Math.min(IDS_DO_SELETOR, totalProdutos);
      let j = (k * 7919) % ids;
      while (j % 10 === 9) j = (j + 1) % ids;
      r.push({ tipo, ...consultaVeiculoAno(j), ids });
    }
  }
  return r;
}

export const TERMOS_CLIENTE = ['sao jose', 'ponto', 'boa vista', 'pecas 12', 'central'] as const;

/** Filtro de cliente do Core no aparelho (500 clientes em memória, sem FTS: desenho T-0016 §8). */
export function filtrarClientes(clientes: readonly ClienteSync[], texto: string): ClienteSync[] {
  const termos = normalizarBusca(texto);
  return clientes.filter((c) => {
    const alvo = normalizarBusca(`${c.razao_social} ${c.nome_fantasia ?? ''} ${c.documento ?? ''} ${c.cidade ?? ''}`).join(' ');
    return termos.every((x) => alvo.includes(x));
  });
}

// ---------- estatística ----------

/** Percentil pelo posto mais próximo (o mesmo do teste do banco-dados). Lista vazia = 0. */
export function percentil(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor((p / 100) * o.length))]!;
}

export interface ResumoTempos {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

export function resumirTempos(xs: readonly number[]): ResumoTempos {
  return { n: xs.length, p50: percentil(xs, 50), p95: percentil(xs, 95), max: xs.length ? Math.max(...xs) : 0 };
}

/** Quadros de tela (carimbos do `requestAnimationFrame`): maior intervalo e quantos passaram do limite. */
export const LIMITE_QUADRO_MS = 100;

export interface ResultadoQuadros {
  quadros: number;
  maiorMs: number;
  acimaDoLimite: number;
}

export function criarMedidorQuadros(limiteMs = LIMITE_QUADRO_MS) {
  let anterior: number | null = null;
  let quadros = 0;
  let maiorMs = 0;
  let acimaDoLimite = 0;
  return {
    quadro(agora: number): void {
      if (anterior !== null) {
        const d = agora - anterior;
        quadros++;
        if (d > maiorMs) maiorMs = d;
        if (d > limiteMs) acimaDoLimite++;
      }
      anterior = agora;
    },
    resultado(): ResultadoQuadros {
      return { quadros, maiorMs, acimaDoLimite };
    },
  };
}

// ---------- execução ----------

export const META_BUSCA_MS = 300;

export interface ConfigDiagnostico {
  produtos: number;
  clientes: number;
  buscasProduto: number;
  buscasCliente: number;
  /** Linhas por página do pull (`TAMANHO_PAGINA_SYNC`). */
  pagina: number;
  /** Buscas do Novo pedido pela C9 (`catalogo.busca_produtos@1`); 0 = não mede. Padrão 60. */
  buscasC9?: number;
  /** Tempo máximo das buscas da C9: passou, para no fim da busca em curso e marca "interrompida". Padrão 90 s. */
  orcamentoC9Ms?: number;
}

export const CONFIG_PADRAO: ConfigDiagnostico = {
  produtos: 20_000,
  clientes: 500,
  buscasProduto: 200,
  buscasCliente: 100,
  pagina: 1000,
  buscasC9: 60,
  orcamentoC9Ms: 90_000,
};

export type FaseDiagnostico =
  | 'abrindo'
  | 'produtos'
  | 'atributos'
  | 'conteudos'
  | 'referencias'
  | 'clientes'
  | 'indice'
  | 'reindexacao'
  | 'busca_produto'
  | 'busca_c9'
  | 'busca_cliente'
  | 'pronto';

export const ROTULO_FASE: Readonly<Record<FaseDiagnostico, string>> = {
  abrindo: 'Abrindo o banco de teste',
  produtos: 'Gravando produtos',
  atributos: 'Gravando atributos',
  conteudos: 'Gravando aplicações',
  referencias: 'Gravando referências',
  clientes: 'Gravando clientes',
  indice: 'Montando o índice de busca',
  reindexacao: 'Reindexando a busca',
  busca_produto: 'Buscando produtos',
  busca_c9: 'Buscando no Novo pedido',
  busca_cliente: 'Buscando clientes',
  pronto: 'Pronto',
};

export interface ProgressoDiagnostico {
  fase: FaseDiagnostico;
  feito: number;
  total: number;
}

/** As 10 etapas que a barra percorre, na ordem (abrir e pronto ficam fora da contagem). */
export const ETAPAS_DIAGNOSTICO: readonly FaseDiagnostico[] = [
  'produtos',
  'atributos',
  'conteudos',
  'referencias',
  'clientes',
  'indice',
  'reindexacao',
  'busca_produto',
  'busca_c9',
  'busca_cliente',
];

/** Etapa da fase (1 a 10) ou `null` fora delas (abrindo, pronto). */
export function etapaDaFase(fase: FaseDiagnostico): { numero: number; total: number } | null {
  const i = ETAPAS_DIAGNOSTICO.indexOf(fase);
  return i < 0 ? null : { numero: i + 1, total: ETAPAS_DIAGNOSTICO.length };
}

/** Título da barra de progresso: "Etapa 2 de 10 · Gravando atributos · 12.000 de 40.000" (a barra recomeça a cada etapa). */
export function tituloDoProgresso(p: ProgressoDiagnostico): string {
  const etapa = etapaDaFase(p.fase);
  const partes = [etapa ? `Etapa ${etapa.numero} de ${etapa.total}` : null, ROTULO_FASE[p.fase]].filter(Boolean).join(' · ');
  return p.total > 1 ? `${partes} · ${milhar(p.feito)} de ${milhar(p.total)}` : `${partes}…`;
}

export interface DependenciasDiagnostico {
  /** Driver de um banco TEMPORÁRIO (nunca o do usuário). O diagnóstico fecha o adaptador; quem abriu apaga o arquivo. */
  driver: DriverSqlite;
  /**
   * Abre de novo o MESMO arquivo temporário (a reindexação completa reabre o banco, como o app depois da atualização).
   * Ausente (banco em memória) = a reindexação não é medida.
   */
  reabrir?: () => Promise<DriverSqlite>;
  /** Do shell da variante: `shell.migracoesAparelho`, `registroSync.entidadesAtivas(MODULOS)` e `shell.indicesBusca`. */
  migracoesModulos: Partial<Record<ModuloId, readonly MigracaoAparelho[]>>;
  entidades: ReadonlyArray<{ nome: string; modulo: ModuloId }>;
  indicesBusca: readonly IndiceBusca[];
  /**
   * T-0088: as opções do adaptador do motor do usuário (`opcoesDoAdaptador` do shell): a medição pelo caminho real.
   * Ausente = o adaptador sem elas (a 1ª busca depois da reabertura espera a reindexação).
   */
  opcoesAdaptador?: Pick<OpcoesArmazenamentoSqlite, 'buscaSemEsperarIndexacao' | 'registrarErro'>;
  /** `shell.consultas` (a C9 do aparelho). Ausente = a busca do Novo pedido não é medida. */
  consultas?: RegistroConsultasAparelho;
  /** Relógio de alta resolução (`performance.now`). */
  agora: () => number;
  aoProgresso?: (p: ProgressoDiagnostico) => void;
  /** `true` = parar no próximo ponto seguro (o usuário saiu da tela). */
  cancelado?: () => boolean;
  /** Cede o loop para a tela desenhar (padrão: `setTimeout` 0). */
  ceder?: () => Promise<void>;
}

export interface ResultadoC9 extends ResumoTempos {
  /** A 1ª busca (fria: monta o catálogo local e a memória do módulo). */
  primeiraMs: number;
  comResultado: number;
  /** Das buscas com produto esperado (veículo e ano, referência e SKU), quantas o trouxeram entre os resultados. */
  alvoAchado: number;
  comAlvo: number;
  p95PorTipo: Partial<Record<TipoBuscaC9, number>>;
  /** Buscas planejadas; `n < planejadas` = parou no orçamento de tempo. */
  planejadas: number;
  orcamentoMs: number;
}

export interface ResultadoDiagnostico {
  sqlite: { versao: string; fts5: boolean };
  config: ConfigDiagnostico;
  linhas: { produto: number; produto_atributo: number; produto_conteudo: number; produto_referencia: number; cliente: number };
  /** Tamanho médio da aplicação gravada, em caracteres. */
  aplicacaoMedia: number;
  carga: {
    produtosMs: number;
    atributosMs: number;
    conteudosMs: number;
    referenciasMs: number;
    clientesMs: number;
    totalMs: number;
    indiceMs: number;
    /**
     * Reabrir o banco com as migrações (marca o L-1) e reindexar tudo das linhas locais; `null` = não medida.
     * `primeiraBusca`: a busca feita logo depois da reabertura (T-0088: `indexando` sem esperar, com as opções do app).
     */
    reindexacao: { reaberturaMs: number; reindexMs: number; primeiraBusca: { buscou: boolean; motivo: string | null; ms: number } } | null;
  };
  buscaProduto: ResumoTempos & { comResultado: number; p95PorTipo: Record<TipoBuscaProduto, number> };
  /** `null` = sem o registro de consultas do shell. */
  buscaC9: ResultadoC9 | null;
  buscaCliente: ResumoTempos & { comResultado: number };
  /** A busca pelo SKU exato traz o produto certo em 1º. */
  skuExatoPrimeiro: boolean;
}

export class DiagnosticoCancelado extends Error {
  constructor() {
    super('Diagnóstico cancelado');
    this.name = 'DiagnosticoCancelado';
  }
}

const cederPadrao = () =>
  new Promise<void>((r) => (globalThis as unknown as { setTimeout(f: () => void, ms: number): unknown }).setTimeout(r, 0));

/**
 * Versão das linhas do banco de teste para a C9 (`versaoLinhas`): NEGATIVA e nova a cada medição. O motor só dá números
 * positivos crescentes, então a memória do Catálogo (chaveada pela versão, global no processo) nunca confunde o banco de
 * teste com o do usuário, e cada medição começa fria.
 */
let ultimaVersaoTeste = 0;
const novaVersaoTeste = () => --ultimaVersaoTeste;

/** Fontes da consulta do aparelho sobre o banco de teste (o que o motor entrega ao registro, sem fila nem sessão). */
export function fontesDoBancoDeTeste(
  a: ArmazenamentoSqlite,
  entidades: ReadonlyArray<{ nome: string; modulo: ModuloId }>,
  versao: number,
): FontesConsultaAparelho {
  const dono = new Map(entidades.map((e) => [e.nome, e.modulo]));
  const modulos = [...new Set(entidades.map((e) => e.modulo))];
  const porCampo = a.linhas.porCampo?.bind(a.linhas);
  return {
    modulosAtivos: () => modulos,
    donoDaEntidade: (e) => dono.get(e),
    linhas: (e) => a.linhas.listar(e) as never,
    linhasPorIds: (e, ids) => a.linhas.porIds(e, ids) as never,
    linhasPorCampo: async (e, campo, valores) => {
      if (porCampo) return (await porCampo(e, campo, valores)) as never;
      const alvo = new Set<unknown>(valores);
      return (await a.linhas.listar(e)).filter((l) => alvo.has((l as unknown as Record<string, unknown>)[campo])) as never;
    },
    versaoLinhas: () => versao,
    buscarComDesfecho: (indice, consulta) => a.busca.buscarComDesfecho(indice, consulta),
    agora: () => new Date(),
    usuario: () => null,
    parametros: () => ({}),
  };
}

export async function rodarDiagnosticoCarga(dep: DependenciasDiagnostico, config: ConfigDiagnostico = CONFIG_PADRAO): Promise<ResultadoDiagnostico> {
  const { agora } = dep;
  const ceder = dep.ceder ?? cederPadrao;
  const aviso = (p: ProgressoDiagnostico) => dep.aoProgresso?.(p);
  const conferir = () => {
    if (dep.cancelado?.()) throw new DiagnosticoCancelado();
  };
  const indice = dep.indicesBusca.find((i) => i.modulo === 'catalogo' && i.fontes.includes('produto'));
  if (!indice) throw new Error('Índice de busca do Catálogo não registrado no shell');
  const opcoes: OpcoesArmazenamentoSqlite = { ...dep.opcoesAdaptador, migracoesModulos: dep.migracoesModulos, entidades: dep.entidades, indicesBusca: dep.indicesBusca };

  aviso({ fase: 'abrindo', feito: 0, total: 1 });
  let driver = dep.driver;
  let a = criarArmazenamentoSqlite(driver, opcoes);
  try {
    await a.pronto;
    if (a.modulosIndisponiveis().includes('catalogo')) throw new Error('Migrações do Catálogo falharam no SQLite deste aparelho (FTS5 ausente?)');
    const versao = (await driver.primeira<{ v: string }>('SELECT sqlite_version() AS v'))?.v ?? '?';
    const fts5 = (await driver.primeira<{ ok: number }>("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok"))?.ok === 1;

    /**
     * Grava em páginas (cada página gerada fora do tempo medido): `unidades` contadas de `passo` em `passo`, `gerar`
     * devolve as linhas da faixa (vazia = pula). A barra conta as linhas gravadas de `totalLinhas`.
     */
    const puxar = async (fase: FaseDiagnostico, entidade: string, unidades: number, totalLinhas: number, gerar: (inicio: number, fim: number) => LinhaSync[]) => {
      let gasto = 0;
      let feito = 0;
      for (let inicio = 0; inicio < unidades; inicio += config.pagina) {
        conferir();
        const pagina = gerar(inicio, Math.min(unidades, inicio + config.pagina));
        if (pagina.length === 0) continue;
        const ultima = pagina.at(-1)!;
        const t = agora();
        await a.linhas.aplicar(entidade, pagina, `${ultima.updated_at}|${ultima.id}`);
        gasto += agora() - t;
        feito += pagina.length;
        aviso({ fase, feito, total: totalLinhas });
        await ceder();
      }
      return gasto;
    };
    const faixa = <T>(inicio: number, fim: number, f: (i: number) => T) => Array.from({ length: fim - inicio }, (_, k) => f(inicio + k));
    let totalReferencias = 0;
    let somaAplicacao = 0;
    for (let i = 0; i < config.produtos; i++) {
      totalReferencias += referenciasSinteticas(i).length;
      somaAplicacao += aplicacaoSintetica(i).length;
    }

    const t0 = agora();
    const produtosMs = await puxar('produtos', 'produto', config.produtos, config.produtos, (i, f) => faixa(i, f, produtoSintetico));
    // 2 atributos por produto: a página do pull carrega `pagina` linhas = pagina/2 produtos
    const atributosMs = await puxar('atributos', 'produto_atributo', config.produtos * 2, config.produtos * 2, (i, f) =>
      faixa(i, f, (k) => atributosSinteticos(Math.floor(k / 2))[k % 2]!),
    );
    const conteudosMs = await puxar('conteudos', 'produto_conteudo', config.produtos, config.produtos, (i, f) => faixa(i, f, conteudoSintetico));
    // referências: páginas de `pagina` produtos (0 a 2 referências cada)
    const referenciasMs = await puxar('referencias', 'produto_referencia', config.produtos, totalReferencias, (i, f) => faixa(i, f, referenciasSinteticas).flat());
    const clientesMs = await puxar('clientes', 'cliente', config.clientes, config.clientes, (i, f) => faixa(i, f, clienteSintetico));
    const totalMs = agora() - t0;

    conferir();
    aviso({ fase: 'indice', feito: 0, total: 1 });
    const t1 = agora();
    await a.busca.finalizar?.();
    const indiceMs = agora() - t1;
    aviso({ fase: 'indice', feito: 1, total: 1 });

    // reindexação completa pelo caminho real: índice v3 recriado vazio com as linhas já no aparelho (L-1 do SDK)
    let reindexacao: ResultadoDiagnostico['carga']['reindexacao'] = null;
    if (dep.reabrir) {
      conferir();
      aviso({ fase: 'reindexacao', feito: 0, total: 1 });
      await driver.rodar(`DELETE FROM ${indice.tabelaDoc}`);
      await driver.rodar(`INSERT INTO ${indice.tabelaFts} (${indice.tabelaFts}) VALUES ('delete-all')`);
      await a.fechar();
      const t2 = agora();
      driver = await dep.reabrir();
      a = criarArmazenamentoSqlite(driver, opcoes);
      await a.pronto;
      const reaberturaMs = agora() - t2;
      const t3 = agora();
      // a 1ª busca do usuário logo depois da abertura (Catálogo ou Novo pedido): no app ela não espera o L-1 (T-0088 §5)
      const d = await a.busca.buscarComDesfecho(indice.id, { grupos: [['filtro']], prefixoNoUltimo: true });
      const primeiraBusca = { buscou: d.buscou, motivo: d.buscou ? null : d.motivo, ms: agora() - t3 };
      await a.busca.finalizar?.();
      reindexacao = { reaberturaMs, reindexMs: agora() - t3, primeiraBusca };
      aviso({ fase: 'reindexacao', feito: 1, total: 1 });
      await ceder();
    }

    const linhas = {
      produto: await a.linhas.contar('produto'),
      produto_atributo: await a.linhas.contar('produto_atributo'),
      produto_conteudo: await a.linhas.contar('produto_conteudo'),
      produto_referencia: await a.linhas.contar('produto_referencia'),
      cliente: await a.linhas.contar('cliente'),
    };

    // buscas de produto: FTS5 + leitura dos 50 primeiros (o que a tela mostra)
    const consultas = consultasDeProduto(config.buscasProduto, config.produtos);
    const temposProduto: number[] = [];
    const porTipo = new Map<TipoBuscaProduto, number[]>(TIPOS_BUSCA_PRODUTO.map((x) => [x, []]));
    let produtoComResultado = 0;
    for (const [k, { tipo, consulta }] of consultas.entries()) {
      if (k % 10 === 0) {
        conferir();
        aviso({ fase: 'busca_produto', feito: k, total: consultas.length });
        await ceder();
      }
      const t = agora();
      const r = await a.busca.buscar(indice.id, consulta);
      await a.linhas.porIds('produto', r.slice(0, 50).map((x) => x.chave));
      const d = agora() - t;
      temposProduto.push(d);
      porTipo.get(tipo)!.push(d);
      if (r.length > 0) produtoComResultado++;
    }
    aviso({ fase: 'busca_produto', feito: consultas.length, total: consultas.length });

    const buscaC9 = dep.consultas ? await medirC9(a, dep.consultas, dep.entidades, config, { agora, aviso, conferir, ceder }) : null;

    // buscas de cliente: lista + filtro em memória
    const temposCliente: number[] = [];
    let clienteComResultado = 0;
    for (let k = 0; k < config.buscasCliente; k++) {
      if (k % 10 === 0) {
        conferir();
        aviso({ fase: 'busca_cliente', feito: k, total: config.buscasCliente });
        await ceder();
      }
      const t = agora();
      const todos = await a.linhas.listar<ClienteSync & LinhaSync>('cliente');
      const achados = filtrarClientes(todos, TERMOS_CLIENTE[k % TERMOS_CLIENTE.length]!);
      temposCliente.push(agora() - t);
      if (achados.length > 0) clienteComResultado++;
    }

    const alvo = produtoSintetico(Math.min(1234, config.produtos - 1));
    const exato = await a.busca.buscar(indice.id, { grupos: [[alvo.sku]], prefixoNoUltimo: false });
    aviso({ fase: 'pronto', feito: 1, total: 1 });

    return {
      sqlite: { versao, fts5 },
      config,
      linhas,
      aplicacaoMedia: config.produtos > 0 ? somaAplicacao / config.produtos : 0,
      carga: { produtosMs, atributosMs, conteudosMs, referenciasMs, clientesMs, totalMs, indiceMs, reindexacao },
      buscaProduto: {
        ...resumirTempos(temposProduto),
        comResultado: produtoComResultado,
        p95PorTipo: Object.fromEntries([...porTipo].map(([x, v]) => [x, percentil(v, 95)])) as Record<TipoBuscaProduto, number>,
      },
      buscaC9,
      buscaCliente: { ...resumirTempos(temposCliente), comResultado: clienteComResultado },
      skuExatoPrimeiro: exato[0]?.chave === alvo.id,
    };
  } finally {
    await a.fechar().catch(() => {});
  }
}

/**
 * C9 de ponta a ponta: `shell.consultas.consultar(catalogo.busca_produtos@1)` (validação Zod da entrada e da saída,
 * contexto com as leituras e a busca FTS do SDK, implementação do Catálogo) sobre o banco de teste. Para no orçamento
 * de tempo, no fim da busca em curso (uma busca lenta de 25 s não prende a tela por 25 min).
 */
async function medirC9(
  a: ArmazenamentoSqlite,
  registro: RegistroConsultasAparelho,
  entidades: ReadonlyArray<{ nome: string; modulo: ModuloId }>,
  config: ConfigDiagnostico,
  ctl: { agora: () => number; aviso: (p: ProgressoDiagnostico) => void; conferir: () => void; ceder: () => Promise<void> },
): Promise<ResultadoC9> {
  const planejadas = consultasC9(config.buscasC9 ?? CONFIG_PADRAO.buscasC9!, config.produtos);
  const orcamentoMs = config.orcamentoC9Ms ?? CONFIG_PADRAO.orcamentoC9Ms!;
  const fontes = fontesDoBancoDeTeste(a, entidades, novaVersaoTeste());
  const idsDoSeletor = Array.from({ length: Math.min(IDS_DO_SELETOR, config.produtos) }, (_, i) => uuidSintetico(1, i));
  const tempos: number[] = [];
  const porTipo = new Map<TipoBuscaC9, number[]>();
  let comResultado = 0;
  let comAlvo = 0;
  let alvoAchado = 0;
  const inicio = ctl.agora();
  for (const [k, c] of planejadas.entries()) {
    if (k > 0 && ctl.agora() - inicio > orcamentoMs) break;
    ctl.conferir();
    ctl.aviso({ fase: 'busca_c9', feito: k, total: planejadas.length });
    await ctl.ceder();
    const entrada = { q: c.q, limite: 100, ...(c.ids > 0 ? { produto_ids: idsDoSeletor.slice(0, c.ids) } : {}) };
    const t = ctl.agora();
    const r = await registro.consultar(CONSULTA_BUSCA_PRODUTOS, entrada, fontes);
    const d = ctl.agora() - t;
    tempos.push(d);
    porTipo.set(c.tipo, [...(porTipo.get(c.tipo) ?? []), d]);
    if (r.itens.length > 0) comResultado++;
    if (c.alvo) {
      comAlvo++;
      if (r.itens.some((x) => x.produto_id === c.alvo)) alvoAchado++;
    }
  }
  ctl.aviso({ fase: 'busca_c9', feito: tempos.length, total: planejadas.length });
  return {
    ...resumirTempos(tempos),
    primeiraMs: tempos[0] ?? 0,
    comResultado,
    alvoAchado,
    comAlvo,
    p95PorTipo: Object.fromEntries([...porTipo].map(([x, v]) => [x, percentil(v, 95)])),
    planejadas: planejadas.length,
    orcamentoMs,
  };
}

// ---------- relatório (texto para copiar e colar no recado) ----------

/** Milissegundos em pt-BR: 1 casa abaixo de 10 ms, inteiro acima, segundos a partir de 10 s. */
export function formatarMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  if (ms < 10) return `${ms.toFixed(1).replace('.', ',')} ms`;
  return `${milhar(Math.round(ms))} ms`;
}

/** Inteiro com ponto de milhar (sem depender do Intl do Hermes). */
export function milhar(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export interface ContextoRelatorio {
  /** Instante UTC da medição. */
  quando: Date;
  fuso: string;
  app: string;
  versao: string;
  perfil: PerfilBuild;
  aparelho: string;
  sistema: string;
  memoriaBytes: number | null;
}

export interface Veredito {
  criterio1: boolean;
  criterio2: boolean;
  /** T-0084 critério 5: a C9 mediu todas as buscas planejadas com p95 < 300 ms; `null` = não medida. */
  c9: boolean | null;
}

export function veredito(r: ResultadoDiagnostico, q: ResultadoQuadros): Veredito {
  const c9 = r.buscaC9 ? r.buscaC9.n > 0 && r.buscaC9.n === r.buscaC9.planejadas && r.buscaC9.p95 < META_BUSCA_MS : null;
  return { criterio1: q.acimaDoLimite === 0, criterio2: r.buscaProduto.p95 < META_BUSCA_MS && r.buscaCliente.p95 < META_BUSCA_MS, c9 };
}

export const okOuNao = (ok: boolean | null) => (ok === null ? 'NÃO MEDIDO' : ok ? 'OK' : 'NÃO ATENDE');

export interface LinhaVeredito {
  id: 'criterio1' | 'criterio2' | 'c9';
  texto: string;
  ok: boolean;
  rotulo: string;
  tom: 'sucesso' | 'erro' | 'neutro';
}

const linha = (id: LinhaVeredito['id'], texto: string, ok: boolean | null): LinhaVeredito => ({
  id,
  texto,
  ok: ok === true,
  rotulo: okOuNao(ok),
  tom: ok === null ? 'neutro' : ok ? 'sucesso' : 'erro',
});

/** As linhas do veredito para o topo do resultado (o rótulo sempre com texto, nunca só a cor). */
export function linhasDoVeredito(v: Veredito): LinhaVeredito[] {
  return [
    linha('criterio1', `Critério 1 · carga sem travar a tela (nenhum quadro > ${LIMITE_QUADRO_MS} ms)`, v.criterio1),
    linha('criterio2', `Critério 2 · busca p95 < ${META_BUSCA_MS} ms`, v.criterio2),
    linha('c9', `Busca do Novo pedido p95 < ${META_BUSCA_MS} ms (T-0084, critério 5)`, v.c9),
  ];
}

/** Linhas da C9 no relatório (ou o motivo de não ter medido). */
function linhasC9(c: ResultadoC9 | null): string[] {
  if (!c) return ['Busca do Novo pedido (C9): não medida (sem o registro de consultas do shell)'];
  const tipos = TIPOS_BUSCA_C9.filter((x) => c.p95PorTipo[x] !== undefined)
    .map((x) => `${x} ${formatarMs(c.p95PorTipo[x]!)}`)
    .join(' · ');
  return [
    `Busca do Novo pedido (C9, ${c.n} de ${c.planejadas}): p50 ${formatarMs(c.p50)} · p95 ${formatarMs(c.p95)} · máx ${formatarMs(c.max)} · 1ª (fria) ${formatarMs(c.primeiraMs)} · com resultado ${c.comResultado}`,
    ...(tipos ? [`  p95 por tipo: ${tipos}`] : []),
    `  produto esperado achado: ${c.alvoAchado} de ${c.comAlvo}`,
    ...(c.n < c.planejadas ? [`  INTERROMPIDA: passou do limite de ${formatarMs(c.orcamentoMs)} com ${c.n} de ${c.planejadas} buscas`] : []),
  ];
}

export function textoDoRelatorio(r: ResultadoDiagnostico, q: ResultadoQuadros, c: ContextoRelatorio): string {
  const v = veredito(r, q);
  const gb = c.memoriaBytes ? `${(c.memoriaBytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : 'RAM ?';
  const t = r.buscaProduto.p95PorTipo;
  const ri = r.carga.reindexacao;
  return [
    'Macuxi — diagnóstico de carga e busca (T-0008, critérios 1 e 2; T-0084, critério 5)',
    `Quando: ${localIsoDate(c.quando, c.fuso)} ${formatHHMM(c.quando, c.fuso)} (${c.fuso})`,
    `App: ${c.app} ${c.versao} · perfil ${c.perfil}`,
    `Aparelho: ${c.aparelho} · ${c.sistema} · ${gb}`,
    `SQLite: ${r.sqlite.versao} · FTS5 ${r.sqlite.fts5 ? 'sim' : 'não'}`,
    '',
    `Carga: ${milhar(r.linhas.produto)} SKUs + ${milhar(r.linhas.produto_atributo)} atributos + ${milhar(r.linhas.produto_conteudo)} aplicações + ${milhar(r.linhas.produto_referencia)} referências + ${milhar(r.linhas.cliente)} clientes em ${formatarMs(r.carga.totalMs)}`,
    `  aplicação média: ${milhar(r.aplicacaoMedia)} caracteres`,
    `  gravação: produtos ${formatarMs(r.carga.produtosMs)} · atributos ${formatarMs(r.carga.atributosMs)} · aplicações ${formatarMs(r.carga.conteudosMs)} · referências ${formatarMs(r.carga.referenciasMs)} · clientes ${formatarMs(r.carga.clientesMs)}`,
    `  índice de busca (rebuild): ${formatarMs(r.carga.indiceMs)}`,
    ri
      ? `  reindexação completa (índice v3 vazio, das linhas locais): ${formatarMs(ri.reindexMs)} · reabertura ${formatarMs(ri.reaberturaMs)}`
      : '  reindexação completa: não medida (banco em memória)',
    ...(ri
      ? [
          `  1ª busca durante a reindexação: ${ri.primeiraBusca.buscou ? 'esperou o índice' : `respondeu ${ri.primeiraBusca.motivo ?? '?'} (a tela varre)`} em ${formatarMs(ri.primeiraBusca.ms)}`,
        ]
      : []),
    `Tela durante o teste: ${milhar(q.quadros)} quadros · maior ${formatarMs(q.maiorMs)} · acima de ${LIMITE_QUADRO_MS} ms: ${q.acimaDoLimite}`,
    '',
    `Busca de produto (${r.buscaProduto.n}): p50 ${formatarMs(r.buscaProduto.p50)} · p95 ${formatarMs(r.buscaProduto.p95)} · máx ${formatarMs(r.buscaProduto.max)} · com resultado ${r.buscaProduto.comResultado}`,
    `  p95 por tipo: ${TIPOS_BUSCA_PRODUTO.map((x) => `${x} ${formatarMs(t[x])}`).join(' · ')}`,
    `  SKU exato em 1º: ${r.skuExatoPrimeiro ? 'sim' : 'não'}`,
    ...linhasC9(r.buscaC9),
    `Busca de cliente (${r.buscaCliente.n}): p50 ${formatarMs(r.buscaCliente.p50)} · p95 ${formatarMs(r.buscaCliente.p95)} · máx ${formatarMs(r.buscaCliente.max)} · com resultado ${r.buscaCliente.comResultado}`,
    '',
    `Critério 1 (carga sem travar a tela, nenhum quadro > ${LIMITE_QUADRO_MS} ms): ${okOuNao(v.criterio1)}`,
    `Critério 2 (busca offline p95 < ${META_BUSCA_MS} ms): ${okOuNao(v.criterio2)}`,
    `T-0084 critério 5 (busca do Novo pedido offline, p95 < ${META_BUSCA_MS} ms): ${okOuNao(v.c9)}`,
  ].join('\n');
}
