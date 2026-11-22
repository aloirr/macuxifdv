/**
 * RN-CAT-22: filtro de veículo em cascata (montadora › modelo › ano › motor › versão), "compatível" e "conferir", "Leve também" e a
 * contagem dos chips da folha Filtrar. Funções puras sobre o `IndiceVeiculos` (`veiculo-indice.ts`): o mesmo resultado no aparelho
 * (sem sinal) e na API. Spec `docs/design/filtro-veiculo/spec.md` §4 a §7; desenho `docs/desenho/filtro-veiculo.md` §3.
 */
import type { CompatibilidadeVeiculo, GrupoFiltro, GruposFiltro, NivelVeiculo, OpcaoVeiculo, PassoTrilha, ResultadoVeiculoItem, RotulosVeiculo, TrechoBusca, VeiculoEscolhido, VeiculoParcial } from '../contracts';
import { normalizarTexto } from './texto';
import type { EntradaVeiculo, IndiceVeiculos } from './veiculo-indice';


/** RN-CAT-22 / D4 (pendente com o dono do produto): onde ficam os itens de conferir na lista com veículo. */
export type PoliticaConferir = 'fim' | 'esconder';
export const POLITICA_CONFERIR: PoliticaConferir = 'fim';

export const NIVEIS_VEICULO: readonly NivelVeiculo[] = ['montadora', 'modelo', 'ano', 'motor', 'versao'];
/** Quantos resultados a busca da folha mostra. */
export const MAXIMO_BUSCA_VEICULO = 30;
/** Teto do trecho "Serve em" do veículo (o mesmo do `SERVE_EM_MAX`, RN-CAT-12). */
const TRECHO_MAX = 90;

const chave = (s: string | null | undefined): string | null => (s === null || s === undefined || s.trim() === '' ? null : normalizarTexto(s));
const ptBr = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

interface Filtro {
  montadora: string | null;
  modelo: string | null;
  ano: number | null;
  motor: string | null;
  versao: string | null;
}

const filtroDe = (v: VeiculoParcial): Filtro => ({ montadora: chave(v.montadora), modelo: chave(v.modelo), ano: v.ano ?? null, motor: chave(v.motor), versao: chave(v.versao) });

const nomeDe = (i: IndiceVeiculos, c: string): string => i.nomes.get(c) ?? c;

/** Entradas do modelo escolhido (montadora igual ou não escrita). */
function entradasDoModelo(i: IndiceVeiculos, f: Filtro): readonly EntradaVeiculo[] {
  if (f.modelo === null) return [];
  return (i.doModelo.get(f.modelo) ?? []).filter((e) => f.montadora === null || e.montadora === null || e.montadora === f.montadora);
}

const comAno = (e: EntradaVeiculo, ano: number | null) => ano === null || e.anos.length === 0 || e.anos.includes(ano);
const comMotor = (e: EntradaVeiculo, motor: string | null) => motor === null || e.motores.length === 0 || e.motores.includes(motor);

/** Opções (chaves) de um nível, dado o que foi escolhido nos níveis ANTERIORES a ele. */
function opcoesDoNivel(i: IndiceVeiculos, nivel: NivelVeiculo, f: Filtro): string[] {
  switch (nivel) {
    case 'montadora':
      return [...i.modelosDaMontadora].filter(([, m]) => m.length > 0).map(([k]) => k).sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
    case 'modelo': {
      const modelos = f.montadora ? (i.modelosDaMontadora.get(f.montadora) ?? []) : [...i.doModelo.keys()];
      return [...modelos].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
    }
    case 'ano':
      return [...new Set(entradasDoModelo(i, f).flatMap((e) => e.anos))].sort((a, b) => b - a).map(String);
    case 'motor':
      return [...new Set(entradasDoModelo(i, f).filter((e) => comAno(e, f.ano)).flatMap((e) => e.motores))].sort((a, b) => Number(a) - Number(b));
    case 'versao':
      return [...new Set(entradasDoModelo(i, f).filter((e) => comAno(e, f.ano) && comMotor(e, f.motor)).flatMap((e) => e.versoes))].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
  }
}

const rotuloDaOpcao = (i: IndiceVeiculos, nivel: NivelVeiculo, c: string): string => (nivel === 'ano' || nivel === 'motor' ? c : nomeDe(i, c));

export function rotulosDoVeiculo(v: VeiculoParcial): RotulosVeiculo | null {
  if (!v.modelo) return null;
  const junta = (xs: (string | number | null | undefined)[]) => xs.filter((x) => x !== null && x !== undefined && x !== '').join(' ');
  return { curto: junta([v.modelo, v.ano, v.motor, v.versao]), completo: junta([v.montadora, v.modelo, v.ano, v.motor, v.versao]) };
}

export interface NavegacaoVeiculo {
  trilha: PassoTrilha[];
  nivel: NivelVeiculo | null;
  opcoes: OpcaoVeiculo[];
  ultimo: boolean;
  escolha: VeiculoParcial;
  rotulos: RotulosVeiculo | null;
  busca: OpcaoVeiculo[] | null;
}

/** Busca da folha: modelo e montadora pelo nome e pelos apelidos (RN-CAT-15). Montadora primeiro, depois os modelos. */
function buscarNaCascata(i: IndiceVeiculos, texto: string, apelidos: ReadonlyMap<string, string>): OpcaoVeiculo[] {
  const q = normalizarTexto(texto);
  if (q === '') return [];
  const casa = (c: string) => c.startsWith(q) || c.split(' ').some((p) => p.startsWith(q));
  const montadoras = new Set<string>();
  for (const k of i.modelosDaMontadora.keys()) if (casa(k)) montadoras.add(k);
  for (const [apelido, nomeCompleto] of apelidos) {
    const k = normalizarTexto(nomeCompleto);
    if (i.modelosDaMontadora.has(k) && (apelido === q || apelido.startsWith(q))) montadoras.add(k);
  }
  const saida: OpcaoVeiculo[] = [...montadoras].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b))).map((k) => ({ valor: nomeDe(i, k), rotulo: nomeDe(i, k), apoio: null, nivel: 'montadora' as const }));
  const montadoraDe = new Map<string, string | null>();
  for (const e of i.entradas) if (!montadoraDe.has(e.modelo)) montadoraDe.set(e.modelo, e.montadora);
  const modelos = [...i.doModelo.keys()].filter(casa).sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
  for (const m of modelos) {
    const mont = montadoraDe.get(m) ?? null;
    saida.push({ valor: nomeDe(i, m), rotulo: nomeDe(i, m), apoio: mont ? nomeDe(i, mont) : null, nivel: 'modelo' });
  }
  return saida.slice(0, MAXIMO_BUSCA_VEICULO);
}

/**
 * RN-CAT-22: a cascata. Só mostra opções que existem nas aplicações; nível com uma opção só se preenche sozinho (`automatico` na
 * trilha); nível sem opção é pulado; ano do mais novo ao mais velho e o resto em ordem alfabética. `apelidos` (chave → nome da montadora)
 * vem do chamador porque é a lista padrão do domínio mais os sinônimos do tenant.
 */
export function navegarCascata(indice: IndiceVeiculos, escolha: VeiculoParcial, busca?: string, apelidos: ReadonlyMap<string, string> = new Map()): NavegacaoVeiculo {
  const f = filtroDe(escolha);
  const autos = new Set<NivelVeiculo>();
  let nivel: NivelVeiculo | null = null;
  let opcoes: string[] = [];
  for (const n of NIVEIS_VEICULO) {
    if (n === 'montadora' ? f.montadora !== null || f.modelo !== null : n === 'modelo' ? f.modelo !== null : f[n] !== null) continue;
    const o = opcoesDoNivel(indice, n, f);
    if (o.length === 0) continue;
    if (o.length === 1) {
      if (n === 'ano') f.ano = Number(o[0]);
      else f[n] = o[0]!;
      autos.add(n);
      continue;
    }
    nivel = n;
    opcoes = o;
    break;
  }
  const valorDe = (n: NivelVeiculo, c: string | number | null): string | null => (c === null ? null : n === 'ano' || n === 'motor' ? String(c) : nomeDe(indice, c as string));
  const trilha: PassoTrilha[] = [];
  for (const n of NIVEIS_VEICULO) {
    const c = f[n];
    const v = valorDe(n, c);
    if (v !== null) trilha.push({ nivel: n, valor: v, rotulo: v, automatico: autos.has(n) });
  }
  const sai: VeiculoParcial = {
    montadora: valorDe('montadora', f.montadora),
    modelo: valorDe('modelo', f.modelo),
    ano: f.ano,
    motor: valorDe('motor', f.motor),
    versao: valorDe('versao', f.versao),
  };
  // `ultimo`: depois deste nível nenhum outro tem opção (para qualquer escolha dele)
  let ultimo = nivel !== null;
  if (nivel !== null) {
    const depois = NIVEIS_VEICULO.slice(NIVEIS_VEICULO.indexOf(nivel) + 1);
    const base: Filtro = { ...f };
    for (const n of depois) {
      if (n === 'montadora' || n === 'modelo') continue;
      if (opcoesDoNivel(indice, n, { ...base, ano: nivel === 'ano' ? null : base.ano, motor: nivel === 'motor' ? null : base.motor }).length > 0) ultimo = false;
    }
    if (nivel === 'montadora' || nivel === 'modelo') ultimo = false;
  }
  return {
    trilha,
    nivel,
    opcoes: opcoes.map((c) => ({ valor: valorDe(nivel!, c)!, rotulo: rotuloDaOpcao(indice, nivel!, c), apoio: null })),
    ultimo,
    escolha: sai,
    rotulos: rotulosDoVeiculo(sai),
    busca: busca !== undefined && busca.trim() !== '' ? buscarNaCascata(indice, busca, apelidos) : null,
  };
}

// ---------- compatível, conferir, não serve ----------
export type SituacaoVeiculo = 'compativel' | 'conferir' | 'nao_serve' | 'universal';

export interface Compatibilidade {
  situacao: SituacaoVeiculo;
  /** O trecho da aplicação que decidiu (o primeiro de conferir; o compatível não precisa dele). */
  segmento: EntradaVeiculo | null;
  serve_em: TrechoBusca | null;
}

interface ContextoCompat {
  indice: IndiceVeiculos;
  f: Filtro;
  motores: readonly string[];
  versoes: readonly string[];
}

function contextoCompat(indice: IndiceVeiculos, v: VeiculoEscolhido): ContextoCompat {
  const f = filtroDe(v);
  return {
    indice,
    f,
    motores: opcoesDoNivel(indice, 'motor', { ...f, motor: null, versao: null }),
    versoes: opcoesDoNivel(indice, 'versao', { ...f, versao: null }),
  };
}

const cobre = (restricao: readonly string[], opcoes: readonly string[]) => restricao.length === 0 || opcoes.every((o) => restricao.includes(o));

function situacaoDaEntrada(c: ContextoCompat, e: EntradaVeiculo): 'compativel' | 'conferir' | 'nao_serve' {
  const { f } = c;
  if (f.ano !== null && e.anos.length > 0 && !e.anos.includes(f.ano)) return 'nao_serve';
  if (f.motor !== null && e.motores.length > 0 && !e.motores.includes(f.motor)) return 'nao_serve';
  if (f.versao !== null && e.versoes.length > 0 && !e.versoes.includes(f.versao)) return 'nao_serve';
  if (f.ano === null || e.anos.length === 0) return 'conferir';
  if (f.motor === null && !cobre(e.motores, c.motores)) return 'conferir';
  if (f.versao === null && !cobre(e.versoes, c.versoes)) return 'conferir';
  return 'compativel';
}

/** Posições do trecho sem a montadora, recortado em 90 caracteres, com o modelo marcado; nulo quando sobra só o nome do modelo. */
function trechoDoVeiculo(e: EntradaVeiculo, aplicacao: string): TrechoBusca | null {
  if (aplicacao.length < e.fim) return null;
  let texto = aplicacao.slice(e.inicio, e.fim);
  let ms = e.posModelo[0] - e.inicio;
  let me = e.posModelo[1] - e.inicio;
  if (e.posMontadora) {
    const a = e.posMontadora[0] - e.inicio;
    let b = e.posMontadora[1] - e.inicio;
    while (b < texto.length && /[\s\-–:/,]/.test(texto[b]!)) b++;
    texto = texto.slice(0, a) + texto.slice(b);
    if (ms >= b) {
      ms -= b - a;
      me -= b - a;
    }
  }
  const lead = /^[\s,\-–:/]+/.exec(texto)?.[0].length ?? 0;
  texto = texto.slice(lead);
  ms -= lead;
  me -= lead;
  if (ms < 0 || normalizarTexto(texto) === e.modelo) return null;
  if (texto.length <= TRECHO_MAX) return { texto, marcas: [[ms, me]], inclui_ano: null };
  let ini = Math.max(0, ms - 20);
  if (ini > 0 && texto[ini - 1] !== ' ') {
    const esp = texto.indexOf(' ', ini);
    if (esp >= 0 && esp + 1 <= ms) ini = esp + 1;
  }
  const orcamento = TRECHO_MAX - (ini > 0 ? 1 : 0);
  let fim = texto.length;
  if (texto.length - ini > orcamento) {
    const limite = ini + orcamento - 1;
    fim = limite;
    if (texto[limite] !== ' ') {
      const esp = texto.lastIndexOf(' ', limite);
      if (esp > ini) fim = esp;
    }
    while (fim > ini && texto[fim - 1] === ' ') fim--;
  }
  const prefixo = ini > 0 ? '…' : '';
  const sufixo = fim < texto.length ? '…' : '';
  const desloca = prefixo.length - ini;
  const dentro = ms >= ini && me <= fim;
  return { texto: `${prefixo}${texto.slice(ini, fim)}${sufixo}`, marcas: dentro ? [[ms + desloca, me + desloca]] : [], inclui_ano: null };
}

function compatibilidadeCom(c: ContextoCompat, produtoId: string, aplicacao: string | null | undefined): Compatibilidade {
  const entradas = c.indice.doProduto.get(produtoId);
  if (!entradas || entradas.length === 0) return { situacao: 'universal', segmento: null, serve_em: null };
  const doModelo = new Set(entradasDoModelo(c.indice, c.f));
  let conferir: EntradaVeiculo | null = null;
  for (const e of entradas) {
    if (!doModelo.has(e)) continue;
    const s = situacaoDaEntrada(c, e);
    if (s === 'compativel') return { situacao: 'compativel', segmento: e, serve_em: null };
    if (s === 'conferir' && conferir === null) conferir = e;
  }
  if (conferir === null) return { situacao: 'nao_serve', segmento: null, serve_em: null };
  return { situacao: 'conferir', segmento: conferir, serve_em: trechoDoVeiculo(conferir, aplicacao ?? '') };
}

/**
 * RN-CAT-22: o produto no veículo escolhido. `compativel` = um trecho tem o ano escolhido e serve em todas as opções dos níveis não
 * escolhidos; `conferir` = cita o modelo, mas sem ano ou restringindo um nível não escolhido; `nao_serve` = o trecho contradiz o que foi
 * escolhido (ou nenhum trecho cita o modelo); `universal` = aplicação vazia ou sem nome de veículo. O produto fica com o melhor dos trechos.
 */
export function compatibilidadeDoProduto(indice: IndiceVeiculos, produtoId: string, aplicacao: string | null | undefined, veiculo: VeiculoEscolhido): Compatibilidade {
  return compatibilidadeCom(contextoCompat(indice, veiculo), produtoId, aplicacao);
}

/**
 * RN-CAT-22: só os produtos que servem no veículo, compatíveis antes e os de conferir depois (ou sem eles, com `esconder`, D4), cada um
 * com o `veiculo` do contrato. A ordem de dentro de cada grupo é a que veio (a do ranking, ou a da vitrine). Produto universal e o que
 * não serve saem.
 */
export function filtrarPorVeiculo<T extends { produto_id: string; aplicacao?: string | null | undefined }>(
  itens: readonly T[],
  indice: IndiceVeiculos,
  veiculo: VeiculoEscolhido,
  politica: PoliticaConferir = POLITICA_CONFERIR,
): (T & { veiculo: ResultadoVeiculoItem })[] {
  const c = contextoCompat(indice, veiculo);
  const compativeis: (T & { veiculo: ResultadoVeiculoItem })[] = [];
  const conferir: (T & { veiculo: ResultadoVeiculoItem })[] = [];
  for (const item of itens) {
    const r = compatibilidadeCom(c, item.produto_id, item.aplicacao);
    if (r.situacao === 'compativel') compativeis.push({ ...item, veiculo: { compatibilidade: 'compativel' as CompatibilidadeVeiculo, serve_em: null } });
    else if (r.situacao === 'conferir' && politica === 'fim') conferir.push({ ...item, veiculo: { compatibilidade: 'conferir' as CompatibilidadeVeiculo, serve_em: r.serve_em } });
  }
  return [...compativeis, ...conferir];
}

/** Ids dos produtos que citam o modelo (o conjunto de partida da lista sem texto); o `filtrarPorVeiculo` decide o resto. */
export function produtosDoModelo(indice: IndiceVeiculos, veiculo: VeiculoParcial): Set<string> {
  return new Set(entradasDoModelo(indice, filtroDe(veiculo)).map((e) => e.produto));
}

/**
 * RN-CAT-22 / RN-CAT-11 (D3): "Leve também". Sem veículo, a lista de hoje; com veículo, só os compatíveis e os universais (os de conferir
 * ficam de fora, spec §7).
 */
export function leveTambemDoVeiculo<T extends { produto_id: string }>(ofereceJunto: readonly T[], indice: IndiceVeiculos, veiculo: VeiculoEscolhido | null): T[] {
  if (!veiculo) return [...ofereceJunto];
  const c = contextoCompat(indice, veiculo);
  return ofereceJunto.filter((o) => {
    const s = compatibilidadeCom(c, o.produto_id, '').situacao;
    return s === 'compativel' || s === 'universal';
  });
}

// ---------- folha Filtrar com contagem (D1) ----------
export interface GrupoDeClassificacao {
  grupo: GrupoFiltro;
  rotulo: string;
  opcoes: readonly { id: string; nome: string; produtos: ReadonlySet<string> }[];
}

/**
 * RN-CAT-22 (D1): os chips da folha Filtrar com a contagem. `produtos` = ids da lista de agora ANTES dos grupos (veículo, busca e
 * `Só com estoque` já aplicados); cada grupo conta aplicando os OUTROS grupos marcados. Chip com 0 sai, salvo o marcado; grupo com uma
 * opção só sai. `marcados` = grupo → id do chip marcado.
 * `cruzar: false` (grupos em cascata da árvore, cada um com as opções do que está marcado acima): o marcado de um grupo não corta a contagem dos
 * outros, senão o marcado mais fundo zeraria os irmãos dos grupos de cima e o grupo sumiria da folha.
 */
export function contarChipsFiltrar(produtos: Iterable<string>, classificacao: readonly GrupoDeClassificacao[], marcados: Partial<Record<GrupoFiltro, string | null>>, { cruzar = true }: { cruzar?: boolean } = {}): GruposFiltro {
  const base = [...produtos];
  const saida: GruposFiltro = [];
  for (const g of classificacao) {
    let lista = base;
    for (const outro of classificacao) {
      const id = marcados[outro.grupo];
      if (!cruzar || outro.grupo === g.grupo || !id) continue;
      const alvo = outro.opcoes.find((o) => o.id === id);
      if (alvo) lista = lista.filter((p) => alvo.produtos.has(p));
    }
    const chips = g.opcoes
      .map((o) => ({ grupo: g.grupo, id: o.id, nome: o.nome, contagem: lista.reduce((n, p) => n + (o.produtos.has(p) ? 1 : 0), 0), marcado: marcados[g.grupo] === o.id }))
      .filter((c) => c.contagem > 0 || c.marcado);
    if (chips.length >= 2) saida.push({ grupo: g.grupo, rotulo: g.rotulo, chips });
  }
  return saida;
}
