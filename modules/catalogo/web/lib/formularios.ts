/**
 * Formulários do BKO de conteúdo (RF-CAT-07), puros e testáveis: texto da tela ↔ contrato. A API revalida tudo
 * (Zod + domain); aqui só a conversão com mensagem em português.
 */
import { SalvarCadastroCatalogo, SalvarConteudo, SalvarSinonimo, type FichaProduto, type ItemVitrine, type Sinonimo } from '../../contracts';
import { LIMITES_CADASTRO_CATALOGO, validarCadastroCatalogo } from '../../domain/cadastro-catalogo';

export interface FormConteudo {
  descricao: string;
  /** Um argumento de venda por linha. */
  argumentos: string;
  /** Uma pergunta por bloco: "P: ..." e "R: ..." em linhas seguidas. */
  faq: string;
  /** Um atributo por linha: "Nome: valor". */
  atributos: string;
}

const linhas = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export function formDaFicha(f: Pick<FichaProduto, 'content' | 'attributes'>): FormConteudo {
  return {
    descricao: f.content.description ?? '',
    argumentos: f.content.selling_points.join('\n'),
    faq: f.content.faq.map((q) => `P: ${q.question}\nR: ${q.answer}`).join('\n'),
    atributos: f.attributes.map((a) => `${a.name}: ${a.value}`).join('\n'),
  };
}

export type ResultadoForm<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Formulário → corpo do `PUT produtos/:id/conteudo`. */
export function conteudoDoForm(f: FormConteudo): ResultadoForm<SalvarConteudo> {
  const attributes: { name: string; value: string }[] = [];
  for (const l of linhas(f.atributos)) {
    const i = l.indexOf(':');
    if (i <= 0 || !l.slice(i + 1).trim()) return { ok: false, erro: `Atributo "${l}": use o formato "Nome: valor", um por linha.` };
    attributes.push({ name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() });
  }
  const faq: { question: string; answer: string }[] = [];
  let pergunta: string | null = null;
  for (const l of linhas(f.faq)) {
    const m = /^([PpRr])\s*:\s*(.*)$/.exec(l);
    if (!m) return { ok: false, erro: `FAQ: comece cada linha com "P:" (pergunta) ou "R:" (resposta). Linha: "${l}".` };
    if (m[1]!.toUpperCase() === 'P') {
      if (pergunta !== null) return { ok: false, erro: `FAQ: a pergunta "${pergunta}" está sem resposta.` };
      pergunta = m[2]!.trim();
    } else {
      if (pergunta === null) return { ok: false, erro: 'FAQ: há uma resposta sem pergunta antes.' };
      faq.push({ question: pergunta, answer: m[2]!.trim() });
      pergunta = null;
    }
  }
  if (pergunta !== null) return { ok: false, erro: `FAQ: a pergunta "${pergunta}" está sem resposta.` };
  const r = SalvarConteudo.safeParse({ description: f.descricao.trim() || null, selling_points: linhas(f.argumentos), faq, attributes });
  if (!r.success) {
    const i = r.error.issues[0]!;
    return { ok: false, erro: `Confira o campo ${i.path.join('.')}: ${i.message}` };
  }
  return { ok: true, valor: r.data };
}

// ---------- seção Catálogo do cadastro do produto (T-0085 K9; RN-CAT-09, RN-CAT-11) ----------
export interface FormCadastroCatalogo {
  aplicacao: string;
  /** Códigos ERP dos produtos de "Oferece junto", um por linha (até 5). */
  ofereceJunto: string;
  /** Uma linha por referência (até 3): marca escolhida da lista + código. */
  referencias: { marca_id: string; codigo: string }[];
  /** Separadas por vírgula (até 4, de até 20 caracteres). */
  etiquetas: string;
}

/** As 3 linhas de referência sempre aparecem; as sem marca e sem código ficam de fora ao salvar. */
export function formCadastroDaFicha(f: Pick<FichaProduto, 'catalogo'>): FormCadastroCatalogo {
  const c = f.catalogo;
  const refs = (c?.referencias ?? []).map((r) => ({ marca_id: r.marca_id, codigo: r.codigo }));
  while (refs.length < LIMITES_CADASTRO_CATALOGO.referencias) refs.push({ marca_id: '', codigo: '' });
  return { aplicacao: c?.aplicacao ?? '', ofereceJunto: (c?.oferece_junto ?? []).map((o) => o.erp_code).join('\n'), referencias: refs, etiquetas: (c?.etiquetas ?? []).join(', ') };
}

/**
 * Formulário → corpo do `PUT produtos/:id/cadastro-catalogo`. `idsPorCodigo` traduz o código ERP digitado em "Oferece junto"
 * para o id do produto (a lista de produtos da tela). A mesma `validarCadastroCatalogo` da API confere os limites.
 */
export function cadastroCatalogoDoForm(
  produtoId: string,
  f: FormCadastroCatalogo,
  opcoes: { idsPorCodigo: ReadonlyMap<string, string>; aplicacaoMax: number },
): ResultadoForm<SalvarCadastroCatalogo> {
  const oferece: string[] = [];
  for (const codigo of linhas(f.ofereceJunto)) {
    const id = opcoes.idsPorCodigo.get(codigo);
    if (!id) return { ok: false, erro: `Oferece junto: o código "${codigo}" não está na lista de produtos. Confira o código e tente de novo.` };
    oferece.push(id);
  }
  const referencias = f.referencias.filter((r) => r.marca_id !== '' || r.codigo.trim() !== '');
  for (const r of referencias) {
    if (r.marca_id === '') return { ok: false, erro: `Referência "${r.codigo.trim()}": escolha a marca concorrente da lista.` };
    if (r.codigo.trim() === '') return { ok: false, erro: 'Há uma marca sem código. Informe o código do concorrente ou tire a marca.' };
  }
  const corpo = SalvarCadastroCatalogo.safeParse({
    aplicacao: f.aplicacao.trim() === '' ? null : f.aplicacao.trim(),
    oferece_junto: oferece,
    referencias: referencias.map((r) => ({ marca_id: r.marca_id, codigo: r.codigo.trim() })),
    etiquetas: f.etiquetas.split(',').map((e) => e.trim()).filter(Boolean),
  });
  if (!corpo.success) return { ok: false, erro: `Confira o campo ${corpo.error.issues[0]!.path.join('.')}: ${corpo.error.issues[0]!.message}` };
  const erros = validarCadastroCatalogo(produtoId, corpo.data, { aplicacaoMax: opcoes.aplicacaoMax });
  if (erros.length > 0) return { ok: false, erro: erros[0]!.mensagem };
  return { ok: true, valor: corpo.data };
}

export interface FormSinonimo {
  termo: string;
  /** Separados por vírgula. */
  sinonimos: string;
  ativo: boolean;
}

export const formDoSinonimo = (s: Sinonimo): FormSinonimo => ({ termo: s.term, sinonimos: s.synonyms.join(', '), ativo: s.active });

/** Formulário → corpo do `PUT sinonimos/:id`. */
export function sinonimoDoForm(f: FormSinonimo): ResultadoForm<SalvarSinonimo> {
  const r = SalvarSinonimo.safeParse({ term: f.termo, synonyms: f.sinonimos.split(',').map((s) => s.trim()).filter(Boolean), active: f.ativo });
  if (!r.success) return { ok: false, erro: r.error.issues[0]!.message };
  return { ok: true, valor: r.data };
}

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
const BOM = '﻿';
const celula = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV dos produtos da tela (padrão do Excel brasileiro: `;`, CRLF e BOM). */
export function produtosParaCsv(itens: readonly ItemVitrine[]): string {
  const cab = ['Código', 'Produto', 'Marca', 'Categoria', 'Unidade', 'EAN', 'Destaque'];
  const corpo = itens.map((i) => [i.erp_code, i.description, i.brand, i.line, i.unit, i.ean ?? '', i.is_campaign ? 'Sim' : 'Não']);
  return BOM + [cab, ...corpo].map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';
}

export type AbaBko = 'produtos' | 'sinonimos' | 'sem-resultado';
export interface FiltrosBko {
  aba: AbaBko;
  q: string;
  linha: string;
}
const ABAS: readonly AbaBko[] = ['produtos', 'sinonimos', 'sem-resultado'];

/** Filtros na URL (`?aba=&q=&linha=`), para o link da tela abrir no mesmo lugar. */
export function lerFiltrosBko(busca: string): FiltrosBko {
  const p = new URLSearchParams(busca);
  const aba = p.get('aba') as AbaBko | null;
  return { aba: aba && ABAS.includes(aba) ? aba : 'produtos', q: p.get('q') ?? '', linha: p.get('linha') ?? '' };
}

export function buscaDosFiltros(f: FiltrosBko): string {
  const p = new URLSearchParams();
  if (f.aba !== 'produtos') p.set('aba', f.aba);
  if (f.q) p.set('q', f.q);
  if (f.linha) p.set('linha', f.linha);
  const s = p.toString();
  return s ? `?${s}` : '';
}
