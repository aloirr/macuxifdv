/**
 * Formulários do BKO de conteúdo (RF-CAT-07), puros e testáveis: texto da tela ↔ contrato. A API revalida tudo
 * (Zod + domain); aqui só a conversão com mensagem em português.
 */
import { SalvarConteudo, SalvarSinonimo, type FichaProduto, type ItemVitrine, type Sinonimo } from '../../contracts';

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
