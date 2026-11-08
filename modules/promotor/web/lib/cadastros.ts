/**
 * Apoio puro da tela de cadastros de trade (T-0069, RF-PRO-11): abas na URL, formulário ↔ corpo da API, validação com o
 * mesmo domain da API e exportação CSV. Sem React: roda em Node nos testes. A proteção real é a API; aqui só se evita
 * ida e volta ao servidor e se mostra o erro em português.
 */
import { EDICAO_CADASTRO, type CadastroBko } from '../../contracts';
import { paraCsv } from './csv';

export const ABAS_CADASTRO = ['checklists', 'categorias', 'metas', 'mix', 'concorrentes'] as const;
export type AbaCadastro = (typeof ABAS_CADASTRO)[number];

export const ROTULO_ABA: Readonly<Record<AbaCadastro, string>> = {
  checklists: 'Checklists de visita',
  categorias: 'Categorias',
  metas: 'Metas de share',
  mix: 'Mix de ruptura',
  concorrentes: 'Produtos do concorrente',
};

/** Cadastros de cada aba (a de concorrentes mostra o aviso das marcas, que são do Catálogo, e edita os produtos). */
export const CADASTROS_DA_ABA: Readonly<Record<AbaCadastro, readonly CadastroBko[]>> = {
  checklists: ['checklist_loja'],
  categorias: ['categoria_gondola'],
  metas: ['meta_share'],
  mix: ['mix_obrigatorio'],
  concorrentes: ['concorrente', 'produto_concorrente'],
};

/** `?aba=metas`; valor desconhecido cai na primeira aba. Os filtros ficam na URL (compartilháveis). */
export function lerAbaCadastro(search: string): AbaCadastro {
  const a = new URLSearchParams(search).get('aba');
  return (ABAS_CADASTRO as readonly string[]).includes(a ?? '') ? (a as AbaCadastro) : 'checklists';
}
export function paraBuscaAba(aba: AbaCadastro, incluirRemovidos: boolean): string {
  const p = new URLSearchParams();
  if (aba !== 'checklists') p.set('aba', aba);
  if (incluirRemovidos) p.set('desativados', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}
export const lerIncluirDesativados = (search: string): boolean => new URLSearchParams(search).get('desativados') === '1';

export const TIPOS_ETAPA: Readonly<Record<string, string>> = {
  marcar: 'Marcar como feito',
  texto: 'Texto livre',
  foto: 'Foto',
  gondola: 'Gôndola antes/depois',
  share: 'Share de gôndola',
  preco: 'Preço',
  ruptura: 'Ruptura do mix',
  validade: 'Validade e avarias',
  ponto_extra: 'Pontos extras',
  concorrencia: 'Ações da concorrência',
};

export interface EtapaForm {
  id: string;
  rotulo: string;
  tipo: string;
  obrigatoria: boolean;
}

/** Estado do formulário (tudo texto, como nos campos); cada cadastro usa o seu subconjunto. */
export interface FormCadastro {
  nome: string;
  ordem: string;
  ativo: boolean;
  concorrente_id: string;
  produto_id: string;
  categoria_gondola_id: string;
  meta_pct: string;
  alvo_tipo: 'todas' | 'loja' | 'segmento';
  alvo_valor: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  etapas: EtapaForm[];
}

export function formVazio(hoje: string, novoId: () => string): FormCadastro {
  return { nome: '', ordem: '0', ativo: true, concorrente_id: '', produto_id: '', categoria_gondola_id: '', meta_pct: '', alvo_tipo: 'todas', alvo_valor: '', vigencia_inicio: hoje, vigencia_fim: '', etapas: [{ id: novoId(), rotulo: '', tipo: 'marcar', obrigatoria: true }] };
}

type Linha = Record<string, unknown>;
const txt = (v: unknown) => (typeof v === 'string' ? v : '');

export function formDaLinha(l: Linha): FormCadastro {
  const itens = Array.isArray(l.itens) ? (l.itens as { id: string; rotulo: string; tipo: string; obrigatoria: boolean; ordem: number }[]) : [];
  return {
    nome: txt(l.nome),
    ordem: String(l.ordem ?? 0),
    ativo: l.ativo !== false,
    concorrente_id: txt(l.concorrente_id),
    produto_id: txt(l.produto_id),
    categoria_gondola_id: txt(l.categoria_gondola_id),
    meta_pct: l.meta_pct === undefined ? '' : String(l.meta_pct).replace('.', ','),
    alvo_tipo: typeof l.cliente_id === 'string' ? 'loja' : typeof l.segmento === 'string' ? 'segmento' : 'todas',
    alvo_valor: txt(l.cliente_id) || txt(l.segmento),
    vigencia_inicio: txt(l.vigencia_inicio),
    vigencia_fim: txt(l.vigencia_fim),
    etapas: [...itens].sort((a, b) => a.ordem - b.ordem).map((i) => ({ id: i.id, rotulo: i.rotulo, tipo: i.tipo, obrigatoria: i.obrigatoria })),
  };
}

const idOuNulo = (s: string) => (s.trim() === '' ? null : s.trim());

/** "40,5" ou "40.5" → 40.5; vazio ou texto → NaN (a validação do domain recusa). */
export function lerPercentual(s: string): number {
  const t = s.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}

/** Corpo da API (contrato `*Edicao`) a partir do formulário. `id` é o UUID gerado no cliente (escrita idempotente). */
export function corpoDoForm(c: CadastroBko, f: FormCadastro, id: string): Record<string, unknown> {
  const alvo = { cliente_id: f.alvo_tipo === 'loja' ? f.alvo_valor.trim() : null, segmento: f.alvo_tipo === 'segmento' ? f.alvo_valor.trim() : null };
  const vigencia = { vigencia_inicio: f.vigencia_inicio, vigencia_fim: idOuNulo(f.vigencia_fim) };
  switch (c) {
    case 'categoria_gondola':
      return { id, nome: f.nome.trim(), ordem: Number(f.ordem), ativo: f.ativo };
    case 'concorrente':
      return { id, nome: f.nome.trim(), ativo: f.ativo };
    case 'produto_concorrente':
      return { id, concorrente_id: f.concorrente_id, nome: f.nome.trim(), produto_id: idOuNulo(f.produto_id), categoria_gondola_id: idOuNulo(f.categoria_gondola_id), ativo: f.ativo };
    case 'meta_share':
      return { id, categoria_gondola_id: f.categoria_gondola_id, meta_pct: lerPercentual(f.meta_pct), ...alvo, ...vigencia };
    case 'mix_obrigatorio':
      return { id, produto_id: f.produto_id.trim(), categoria_gondola_id: idOuNulo(f.categoria_gondola_id), ...alvo, ...vigencia };
    case 'checklist_loja':
      return { id, nome: f.nome.trim(), ...alvo, ...vigencia, itens: f.etapas.map((e, i) => ({ id: e.id, rotulo: e.rotulo.trim(), tipo: e.tipo, obrigatoria: e.obrigatoria, ordem: i + 1, categoria_gondola_id: null })) };
  }
}

/** Problemas do corpo em português, pelo MESMO contrato (e domain) que a API usa; lista vazia = pode enviar. */
export function problemasDoForm(c: CadastroBko, f: FormCadastro, id: string): string[] {
  const r = EDICAO_CADASTRO[c].safeParse(corpoDoForm(c, f, id));
  if (r.success) return [];
  return [...new Set(r.error.issues.map((i) => (i.code === 'custom' ? i.message : mensagemDoCampo(i.path.map(String)))))];
}

const ROTULO_CAMPO: Readonly<Record<string, string>> = {
  nome: 'o nome',
  ordem: 'a ordem',
  meta_pct: 'a meta de share (de 0 a 100)',
  categoria_gondola_id: 'a categoria',
  concorrente_id: 'o concorrente',
  produto_id: 'o produto (use o identificador do cadastro de produtos)',
  cliente_id: 'a loja (use o identificador do cadastro de clientes)',
  segmento: 'o segmento',
  vigencia_inicio: 'o início da vigência',
  vigencia_fim: 'o fim da vigência',
  itens: 'as etapas',
};
function mensagemDoCampo(path: string[]): string {
  return `Revise ${ROTULO_CAMPO[path[0] ?? ''] ?? 'os campos'}.`;
}

export const rotuloAlvo = (l: Linha): string => (typeof l.cliente_id === 'string' ? `Loja ${l.cliente_id.slice(0, 8)}…` : typeof l.segmento === 'string' ? `Segmento ${l.segmento}` : 'Todas as lojas');
export const rotuloVigencia = (l: Linha): string => {
  const br = (d: unknown) => String(d).split('-').reverse().join('/');
  return l.vigencia_fim ? `${br(l.vigencia_inicio)} a ${br(l.vigencia_fim)}` : `desde ${br(l.vigencia_inicio)}`;
};
export const pctBr = (n: unknown) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

/** CSV da lista de um cadastro (nomes de categoria/concorrente resolvidos pelo mapa; sem mapa mostra o id). */
export function cadastroCsv(c: CadastroBko, linhas: readonly Linha[], nomes: ReadonlyMap<string, string> = new Map()): string {
  const n = (id: unknown) => (typeof id === 'string' ? (nomes.get(id) ?? id) : '');
  const situacao = (l: Linha) => (l.deleted_at ? 'Desativado' : l.ativo === false ? 'Inativo' : 'Ativo');
  switch (c) {
    case 'categoria_gondola':
      return paraCsv([['Categoria', 'Ordem', 'Situação'], ...linhas.map((l) => [txt(l.nome), Number(l.ordem), situacao(l)])]);
    case 'concorrente':
      return paraCsv([['Concorrente', 'Situação'], ...linhas.map((l) => [txt(l.nome), situacao(l)])]);
    case 'produto_concorrente':
      return paraCsv([['Concorrente', 'Produto do concorrente', 'Produto nosso (id)', 'Categoria', 'Situação'], ...linhas.map((l) => [n(l.concorrente_id), txt(l.nome), txt(l.produto_id), n(l.categoria_gondola_id), situacao(l)])]);
    case 'meta_share':
      return paraCsv([['Categoria', 'Meta de share (%)', 'Alvo', 'Vigência', 'Situação'], ...linhas.map((l) => [n(l.categoria_gondola_id), Number(l.meta_pct), rotuloAlvo(l), rotuloVigencia(l), situacao(l)])]);
    case 'mix_obrigatorio':
      return paraCsv([['Produto (id)', 'Categoria', 'Alvo', 'Vigência', 'Situação'], ...linhas.map((l) => [txt(l.produto_id), n(l.categoria_gondola_id), rotuloAlvo(l), rotuloVigencia(l), situacao(l)])]);
    case 'checklist_loja':
      return paraCsv([
        ['Checklist', 'Etapas', 'Etapas obrigatórias', 'Alvo', 'Vigência', 'Situação'],
        ...linhas.map((l) => {
          const itens = (l.itens as { obrigatoria: boolean }[] | undefined) ?? [];
          return [txt(l.nome), itens.length, itens.filter((i) => i.obrigatoria).length, rotuloAlvo(l), rotuloVigencia(l), situacao(l)];
        }),
      ]);
  }
}
