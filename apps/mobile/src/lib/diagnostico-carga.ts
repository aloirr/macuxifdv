/**
 * Diagnóstico de carga e busca do SQLite no aparelho (T-0008, critérios 1 e 2; desenho T-0008 P7). Lógica PURA, sem
 * expo-sqlite: roda no Vitest com o driver `node:sqlite` e no aparelho com o driver Expo (`@/services/sqlite-expo`).
 *
 * - Dados sintéticos determinísticos no formato do pull (`ProdutoSync`/`ClienteSync` do Core, `ProdutoAtributoSync` do
 *   Catálogo): 20 mil SKUs (+ 2 atributos cada) e 500 clientes, gerados página a página (como chegam do servidor).
 * - Carga pelo adaptador do SDK (`criarArmazenamentoSqlite`, lotes de 500 por transação, páginas de 1.000) com as
 *   migrações e o índice de busca REAIS do shell (os do Catálogo vêm de `shell.migracoesAparelho`/`indicesBusca`).
 * - ~200 buscas de produto (FTS5 + leitura dos 50 primeiros, o que a tela mostra) e 100 de cliente (lista + filtro em
 *   memória, desenho T-0016 §8), com p50/p95/máximo — mesmas consultas de `db/testes/aparelho-sqlite.test.ts`.
 * - "Sem travar": o medidor de quadros (`criarMedidorQuadros`) recebe os carimbos do `requestAnimationFrame` da tela.
 * Nunca usa o banco do usuário: quem chama abre um arquivo próprio e temporário. Sem dado pessoal (tudo sintético).
 */
import { localIsoDate, formatHHMM } from '@macuxi/comum/fuso';
import {
  criarArmazenamentoSqlite,
  normalizarBusca,
  type ConsultaTexto,
  type DriverSqlite,
  type IndiceBusca,
  type LinhaSync,
  type MigracaoAparelho,
  type ModuloId,
} from '@macuxi/platform-sdk';
import type { ClienteSync, ProdutoSync } from '@macuxi/core/contracts';
import type { ProdutoAtributoSync } from '@macuxi/catalogo/contracts';

import type { PerfilBuild } from './endereco-do-build';

// ---------- quem pode abrir ----------

/** A tela só existe nos builds de desenvolvimento e preview; nunca em produção (perfil vem do eas.json). */
export function diagnosticoDisponivel(perfil: PerfilBuild): boolean {
  return perfil === 'desenvolvimento' || perfil === 'preview';
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
}

export const CONFIG_PADRAO: ConfigDiagnostico = { produtos: 20_000, clientes: 500, buscasProduto: 200, buscasCliente: 100, pagina: 1000 };

export type FaseDiagnostico = 'abrindo' | 'produtos' | 'atributos' | 'clientes' | 'indice' | 'busca_produto' | 'busca_cliente' | 'pronto';

export const ROTULO_FASE: Readonly<Record<FaseDiagnostico, string>> = {
  abrindo: 'Abrindo o banco de teste',
  produtos: 'Gravando produtos',
  atributos: 'Gravando atributos',
  clientes: 'Gravando clientes',
  indice: 'Montando o índice de busca',
  busca_produto: 'Buscando produtos',
  busca_cliente: 'Buscando clientes',
  pronto: 'Pronto',
};

export interface ProgressoDiagnostico {
  fase: FaseDiagnostico;
  feito: number;
  total: number;
}

/** As 6 etapas que a barra percorre, na ordem (abrir e pronto ficam fora da contagem). */
export const ETAPAS_DIAGNOSTICO: readonly FaseDiagnostico[] = ['produtos', 'atributos', 'clientes', 'indice', 'busca_produto', 'busca_cliente'];

/** Etapa da fase (1 a 6) ou `null` fora delas (abrindo, pronto). */
export function etapaDaFase(fase: FaseDiagnostico): { numero: number; total: number } | null {
  const i = ETAPAS_DIAGNOSTICO.indexOf(fase);
  return i < 0 ? null : { numero: i + 1, total: ETAPAS_DIAGNOSTICO.length };
}

/** Título da barra de progresso: "Etapa 2 de 6 · Gravando atributos · 12.000 de 40.000" (a barra recomeça a cada etapa). */
export function tituloDoProgresso(p: ProgressoDiagnostico): string {
  const etapa = etapaDaFase(p.fase);
  const partes = [etapa ? `Etapa ${etapa.numero} de ${etapa.total}` : null, ROTULO_FASE[p.fase]].filter(Boolean).join(' · ');
  return p.total > 1 ? `${partes} · ${milhar(p.feito)} de ${milhar(p.total)}` : `${partes}…`;
}

export interface DependenciasDiagnostico {
  /** Driver de um banco TEMPORÁRIO (nunca o do usuário). O diagnóstico fecha o adaptador; quem abriu apaga o arquivo. */
  driver: DriverSqlite;
  /** Do shell da variante: `shell.migracoesAparelho`, `registroSync.entidadesAtivas(MODULOS)` e `shell.indicesBusca`. */
  migracoesModulos: Partial<Record<ModuloId, readonly MigracaoAparelho[]>>;
  entidades: ReadonlyArray<{ nome: string; modulo: ModuloId }>;
  indicesBusca: readonly IndiceBusca[];
  /** Relógio de alta resolução (`performance.now`). */
  agora: () => number;
  aoProgresso?: (p: ProgressoDiagnostico) => void;
  /** `true` = parar no próximo ponto seguro (o usuário saiu da tela). */
  cancelado?: () => boolean;
  /** Cede o loop para a tela desenhar (padrão: `setTimeout` 0). */
  ceder?: () => Promise<void>;
}

export interface ResultadoDiagnostico {
  sqlite: { versao: string; fts5: boolean };
  config: ConfigDiagnostico;
  linhas: { produto: number; produto_atributo: number; cliente: number };
  carga: { produtosMs: number; atributosMs: number; clientesMs: number; totalMs: number; indiceMs: number };
  buscaProduto: ResumoTempos & { comResultado: number; p95PorTipo: Record<TipoBuscaProduto, number> };
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

export async function rodarDiagnosticoCarga(dep: DependenciasDiagnostico, config: ConfigDiagnostico = CONFIG_PADRAO): Promise<ResultadoDiagnostico> {
  const { driver, agora } = dep;
  const ceder = dep.ceder ?? cederPadrao;
  const aviso = (p: ProgressoDiagnostico) => dep.aoProgresso?.(p);
  const conferir = () => {
    if (dep.cancelado?.()) throw new DiagnosticoCancelado();
  };
  const indice = dep.indicesBusca.find((i) => i.modulo === 'catalogo' && i.fontes.includes('produto'));
  if (!indice) throw new Error('Índice de busca do Catálogo não registrado no shell');

  aviso({ fase: 'abrindo', feito: 0, total: 1 });
  const a = criarArmazenamentoSqlite(driver, {
    migracoesModulos: dep.migracoesModulos,
    entidades: dep.entidades,
    indicesBusca: dep.indicesBusca,
  });
  try {
    await a.pronto;
    if (a.modulosIndisponiveis().includes('catalogo')) throw new Error('Migrações do Catálogo falharam no SQLite deste aparelho (FTS5 ausente?)');
    const versao = (await driver.primeira<{ v: string }>('SELECT sqlite_version() AS v'))?.v ?? '?';
    const fts5 = (await driver.primeira<{ ok: number }>("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS ok"))?.ok === 1;

    /** Grava `total` linhas em páginas (gerando cada página fora do tempo medido). */
    const puxar = async (fase: FaseDiagnostico, entidade: string, total: number, gerar: (inicio: number, fim: number) => LinhaSync[]) => {
      let gasto = 0;
      for (let inicio = 0; inicio < total; inicio += config.pagina) {
        conferir();
        const pagina = gerar(inicio, Math.min(total, inicio + config.pagina));
        const ultima = pagina.at(-1)!;
        const t = agora();
        await a.linhas.aplicar(entidade, pagina, `${ultima.updated_at}|${ultima.id}`);
        gasto += agora() - t;
        aviso({ fase, feito: Math.min(total, inicio + config.pagina), total });
        await ceder();
      }
      return gasto;
    };
    const faixa = <T>(inicio: number, fim: number, f: (i: number) => T) => Array.from({ length: fim - inicio }, (_, k) => f(inicio + k));

    const t0 = agora();
    const produtosMs = await puxar('produtos', 'produto', config.produtos, (i, f) => faixa(i, f, produtoSintetico));
    // 2 atributos por produto: a página do pull carrega `pagina` linhas = pagina/2 produtos
    const atributosMs = await puxar('atributos', 'produto_atributo', config.produtos * 2, (i, f) => faixa(i, f, (k) => atributosSinteticos(Math.floor(k / 2))[k % 2]!));
    const clientesMs = await puxar('clientes', 'cliente', config.clientes, (i, f) => faixa(i, f, clienteSintetico));
    const totalMs = agora() - t0;

    conferir();
    aviso({ fase: 'indice', feito: 0, total: 1 });
    const t1 = agora();
    await a.busca.finalizar?.();
    const indiceMs = agora() - t1;
    aviso({ fase: 'indice', feito: 1, total: 1 });

    const linhas = {
      produto: await a.linhas.contar('produto'),
      produto_atributo: await a.linhas.contar('produto_atributo'),
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
      carga: { produtosMs, atributosMs, clientesMs, totalMs, indiceMs },
      buscaProduto: {
        ...resumirTempos(temposProduto),
        comResultado: produtoComResultado,
        p95PorTipo: Object.fromEntries([...porTipo].map(([x, v]) => [x, percentil(v, 95)])) as Record<TipoBuscaProduto, number>,
      },
      buscaCliente: { ...resumirTempos(temposCliente), comResultado: clienteComResultado },
      skuExatoPrimeiro: exato[0]?.chave === alvo.id,
    };
  } finally {
    await a.fechar().catch(() => {});
  }
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
}

export function veredito(r: ResultadoDiagnostico, q: ResultadoQuadros): Veredito {
  return { criterio1: q.acimaDoLimite === 0, criterio2: r.buscaProduto.p95 < META_BUSCA_MS && r.buscaCliente.p95 < META_BUSCA_MS };
}

export const okOuNao = (ok: boolean) => (ok ? 'OK' : 'NÃO ATENDE');

/** As duas linhas do veredito para o topo do resultado (o rótulo sempre com texto, nunca só a cor). */
export function linhasDoVeredito(v: Veredito): { id: 'criterio1' | 'criterio2'; texto: string; ok: boolean; rotulo: string }[] {
  return [
    { id: 'criterio1', texto: `Critério 1 · carga sem travar a tela (nenhum quadro > ${LIMITE_QUADRO_MS} ms)`, ok: v.criterio1, rotulo: okOuNao(v.criterio1) },
    { id: 'criterio2', texto: `Critério 2 · busca p95 < ${META_BUSCA_MS} ms`, ok: v.criterio2, rotulo: okOuNao(v.criterio2) },
  ];
}

export function textoDoRelatorio(r: ResultadoDiagnostico, q: ResultadoQuadros, c: ContextoRelatorio): string {
  const v = veredito(r, q);
  const gb = c.memoriaBytes ? `${(c.memoriaBytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : 'RAM ?';
  const t = r.buscaProduto.p95PorTipo;
  return [
    'Macuxi — diagnóstico de carga e busca (T-0008, critérios 1 e 2)',
    `Quando: ${localIsoDate(c.quando, c.fuso)} ${formatHHMM(c.quando, c.fuso)} (${c.fuso})`,
    `App: ${c.app} ${c.versao} · perfil ${c.perfil}`,
    `Aparelho: ${c.aparelho} · ${c.sistema} · ${gb}`,
    `SQLite: ${r.sqlite.versao} · FTS5 ${r.sqlite.fts5 ? 'sim' : 'não'}`,
    '',
    `Carga: ${milhar(r.linhas.produto)} SKUs + ${milhar(r.linhas.produto_atributo)} atributos + ${milhar(r.linhas.cliente)} clientes em ${formatarMs(r.carga.totalMs)}`,
    `  gravação: produtos ${formatarMs(r.carga.produtosMs)} · atributos ${formatarMs(r.carga.atributosMs)} · clientes ${formatarMs(r.carga.clientesMs)}`,
    `  índice de busca (rebuild): ${formatarMs(r.carga.indiceMs)}`,
    `Tela durante o teste: ${milhar(q.quadros)} quadros · maior ${formatarMs(q.maiorMs)} · acima de ${LIMITE_QUADRO_MS} ms: ${q.acimaDoLimite}`,
    '',
    `Busca de produto (${r.buscaProduto.n}): p50 ${formatarMs(r.buscaProduto.p50)} · p95 ${formatarMs(r.buscaProduto.p95)} · máx ${formatarMs(r.buscaProduto.max)} · com resultado ${r.buscaProduto.comResultado}`,
    `  p95 por tipo: ${TIPOS_BUSCA_PRODUTO.map((x) => `${x} ${formatarMs(t[x])}`).join(' · ')}`,
    `  SKU exato em 1º: ${r.skuExatoPrimeiro ? 'sim' : 'não'}`,
    `Busca de cliente (${r.buscaCliente.n}): p50 ${formatarMs(r.buscaCliente.p50)} · p95 ${formatarMs(r.buscaCliente.p95)} · máx ${formatarMs(r.buscaCliente.max)} · com resultado ${r.buscaCliente.comResultado}`,
    '',
    `Critério 1 (carga sem travar a tela, nenhum quadro > ${LIMITE_QUADRO_MS} ms): ${okOuNao(v.criterio1)}`,
    `Critério 2 (busca offline p95 < ${META_BUSCA_MS} ms): ${okOuNao(v.criterio2)}`,
  ].join('\n');
}
