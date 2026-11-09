/**
 * Edição do rascunho no construtor do BKO (RF-PES-01/02): operações puras sobre perguntas, opções, regras, público e
 * vigência. Quem decide se pode publicar é o domain (`validarVersao`) — a tela mostra o retorno da API.
 */
import { instanteNoFuso, somarDiasCivis } from '@macuxi/comum/relogio';
import { zonedParts } from '@macuxi/comum/fuso';
import { OPERADORES_SEM_VALOR, type Operador, type Pergunta, type PublicoAlvo, type QuestionarioVersao, type RegraCondicional, type SalvarRascunhoRequest, type TipoPergunta, type Vigencia } from '../../contracts';

export const ROTULO_TIPO: Record<TipoPergunta, string> = {
  sim_nao: 'Sim / não',
  unica: 'Única escolha',
  multipla: 'Múltipla escolha',
  numero: 'Número',
  texto: 'Texto',
  escala: 'Escala',
  data: 'Data',
  foto: 'Foto',
  codigo_barras: 'Código de barras',
};

/** Pergunta nova do tipo, com padrões válidos (única/múltipla já com 2 opções). */
export function novaPergunta(tipo: TipoPergunta, novoId: () => string): Pergunta {
  const base = { id: novoId(), enunciado: 'Nova pergunta', obrigatoria: false };
  switch (tipo) {
    case 'unica':
    case 'multipla':
      return { ...base, tipo, opcoes: [{ id: novoId(), rotulo: 'Opção 1' }, { id: novoId(), rotulo: 'Opção 2' }] } as Pergunta;
    case 'escala':
      return { ...base, tipo, minimo: 1, maximo: 5 };
    case 'numero':
      return { ...base, tipo, inteiro: false };
    case 'foto':
      return { ...base, tipo, min_fotos: 1, max_fotos: 3 };
    default:
      return { ...base, tipo } as Pergunta;
  }
}

/** Troca o tipo mantendo id, enunciado, ajuda e obrigatoriedade (as regras que dependem dela são revistas pelo autor). */
export function mudarTipo(p: Pergunta, tipo: TipoPergunta, novoId: () => string): Pergunta {
  if (p.tipo === tipo) return p;
  const nova = novaPergunta(tipo, novoId);
  return { ...nova, id: p.id, enunciado: p.enunciado, obrigatoria: p.obrigatoria, ...(p.ajuda ? { ajuda: p.ajuda } : {}) } as Pergunta;
}

export function alterarPergunta(lista: readonly Pergunta[], id: string, patch: Partial<Pergunta>): Pergunta[] {
  return lista.map((p) => (p.id === id ? ({ ...p, ...patch } as Pergunta) : p));
}

/** Move a pergunta (`delta` −1 sobe, +1 desce); nas pontas não muda. */
export function moverPergunta(lista: readonly Pergunta[], id: string, delta: -1 | 1): Pergunta[] {
  const i = lista.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= lista.length) return [...lista];
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j]!, nova[i]!];
  return nova;
}

/** Remove a pergunta e as regras que a citam (como alvo ou origem). */
export function removerPergunta(perguntas: readonly Pergunta[], regras: readonly RegraCondicional[], id: string): { perguntas: Pergunta[]; regras: RegraCondicional[] } {
  return { perguntas: perguntas.filter((p) => p.id !== id), regras: regras.filter((r) => r.pergunta_id !== id && r.origem_id !== id) };
}

export function adicionarOpcao(p: Pergunta, novoId: () => string): Pergunta {
  if (p.tipo !== 'unica' && p.tipo !== 'multipla') return p;
  return { ...p, opcoes: [...p.opcoes, { id: novoId(), rotulo: `Opção ${p.opcoes.length + 1}` }] };
}

export function alterarOpcao(p: Pergunta, opcaoId: string, rotulo: string): Pergunta {
  if (p.tipo !== 'unica' && p.tipo !== 'multipla') return p;
  return { ...p, opcoes: p.opcoes.map((o) => (o.id === opcaoId ? { ...o, rotulo } : o)) };
}

/** Remove a opção (mínimo de 2 fica para o domain recusar ao publicar); regras com essa opção como valor saem. */
export function removerOpcao(p: Pergunta, regras: readonly RegraCondicional[], opcaoId: string): { pergunta: Pergunta; regras: RegraCondicional[] } {
  if (p.tipo !== 'unica' && p.tipo !== 'multipla') return { pergunta: p, regras: [...regras] };
  return { pergunta: { ...p, opcoes: p.opcoes.filter((o) => o.id !== opcaoId) }, regras: regras.filter((r) => !(r.origem_id === p.id && r.valor === opcaoId)) };
}

/** RF-PES-01 (domain/condicional): operadores aceitos pelo tipo da pergunta de origem. */
export function operadoresPara(tipo: TipoPergunta): Operador[] {
  const base: Operador[] = ['respondida', 'nao_respondida'];
  switch (tipo) {
    case 'sim_nao':
    case 'unica':
    case 'texto':
    case 'codigo_barras':
      return ['igual', 'diferente', ...base];
    case 'multipla':
      return ['contem', 'nao_contem', ...base];
    case 'numero':
    case 'escala':
    case 'data':
      return ['igual', 'diferente', 'maior_que', 'maior_ou_igual', 'menor_que', 'menor_ou_igual', ...base];
    case 'foto':
      return base;
  }
}

export const ROTULO_OPERADOR: Record<Operador, string> = {
  igual: 'é igual a',
  diferente: 'é diferente de',
  contem: 'contém',
  nao_contem: 'não contém',
  maior_que: 'é maior que',
  maior_ou_igual: 'é maior ou igual a',
  menor_que: 'é menor que',
  menor_ou_igual: 'é menor ou igual a',
  respondida: 'foi respondida',
  nao_respondida: 'não foi respondida',
};

/** Valor padrão da comparação para a origem (sim, 1ª opção, 0, data vazia…). */
export function valorPadrao(origem: Pergunta, operador: Operador): RegraCondicional['valor'] {
  if (OPERADORES_SEM_VALOR.includes(operador)) return undefined;
  switch (origem.tipo) {
    case 'sim_nao':
      return true;
    case 'unica':
    case 'multipla':
      return origem.opcoes[0]?.id ?? '';
    case 'numero':
      return origem.minimo ?? 0;
    case 'escala':
      return origem.minimo;
    default:
      return '';
  }
}

/** "Mostrar <alvo> se <origem> …": origem = a primeira pergunta anterior ao alvo. `null` se o alvo é a primeira. */
export function novaRegra(perguntas: readonly Pergunta[], alvoId: string, novoId: () => string): RegraCondicional | null {
  const i = perguntas.findIndex((p) => p.id === alvoId);
  if (i <= 0) return null;
  const origem = perguntas[i - 1]!;
  const operador = operadoresPara(origem.tipo)[0]!;
  const r: RegraCondicional = { id: novoId(), pergunta_id: alvoId, acao: 'mostrar', origem_id: origem.id, operador };
  const v = valorPadrao(origem, operador);
  return v === undefined ? r : { ...r, valor: v };
}

/** Ajusta a regra quando a origem ou o operador mudam (o valor volta ao padrão compatível). */
export function ajustarRegra(r: RegraCondicional, perguntas: readonly Pergunta[], patch: Partial<Pick<RegraCondicional, 'origem_id' | 'operador' | 'acao' | 'valor'>>): RegraCondicional {
  const nova = { ...r, ...patch };
  const origem = perguntas.find((p) => p.id === nova.origem_id);
  if (!origem) return nova;
  if (patch.origem_id !== undefined && !operadoresPara(origem.tipo).includes(nova.operador)) nova.operador = operadoresPara(origem.tipo)[0]!;
  if (patch.origem_id !== undefined || patch.operador !== undefined) {
    const v = valorPadrao(origem, nova.operador);
    if (v === undefined) delete nova.valor;
    else if (patch.valor === undefined) nova.valor = v;
  }
  return nova;
}

/** "Varejo, Atacado ; Farma" → ["Varejo", "Atacado", "Farma"] (sem vazios nem repetidos). */
export function listaDeTexto(texto: string): string[] {
  return [...new Set(texto.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))];
}

export const PUBLICO_VAZIO: PublicoAlvo = { perfis: [], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] };

const dois = (n: number) => String(n).padStart(2, '0');

/** Data civil do instante no fuso do tenant (para o campo `<input type=date>`). */
export function diaNoFuso(instante: string, fuso: string): string {
  const p = zonedParts(instante, fuso);
  return `${p.year}-${dois(p.month)}-${dois(p.day)}`;
}

/** Vigência → campos do formulário (dias no fuso do tenant; fim vazio = sem prazo). */
export function vigenciaParaForm(v: Vigencia, fuso: string): { inicio: string; fim: string } {
  return { inicio: diaNoFuso(v.inicio, fuso), fim: v.fim ? diaNoFuso(v.fim, fuso) : '' };
}

/** RF-PES-02: dias do formulário → vigência em UTC: início 00:00 e fim 23:59:59 no fuso do tenant (inclusivos). */
export function vigenciaDoForm(f: { inicio: string; fim: string }, fuso: string): Vigencia {
  const inicio = instanteNoFuso(f.inicio, '00:00', fuso).toISOString();
  const fim = f.fim ? new Date(instanteNoFuso(somarDiasCivis(f.fim, 1), '00:00', fuso).getTime() - 1000).toISOString() : null;
  return { inicio: inicio.replace(/\.\d{3}Z$/, 'Z'), fim: fim ? fim.replace(/\.\d{3}Z$/, 'Z') : null };
}

// ---------- formulário do rascunho ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Estado editável do rascunho na tela (listas de texto como o usuário digita). */
export interface FormRascunho {
  titulo: string;
  descricao: string;
  modo: QuestionarioVersao['modo'];
  frequencia: QuestionarioVersao['frequencia'];
  perfis: PublicoAlvo['perfis'];
  equipes: string;
  segmentos: string;
  regioes: string;
  canais: string;
  clientes: string;
  inicio: string;
  fim: string;
  perguntas: Pergunta[];
  regras: RegraCondicional[];
}

export function formDaVersao(v: QuestionarioVersao, fuso: string): FormRascunho {
  const vig = vigenciaParaForm(v.vigencia, fuso);
  return {
    titulo: v.titulo,
    descricao: v.descricao ?? '',
    modo: v.modo,
    frequencia: v.frequencia,
    perfis: [...v.publico_alvo.perfis],
    equipes: v.publico_alvo.equipes.join('\n'),
    segmentos: v.publico_alvo.segmentos.join(', '),
    regioes: v.publico_alvo.regioes.join(', '),
    canais: v.publico_alvo.canais.join(', '),
    clientes: v.publico_alvo.clientes.join('\n'),
    inicio: vig.inicio,
    fim: vig.fim,
    perguntas: structuredClone(v.perguntas),
    regras: structuredClone(v.regras),
  };
}

/** Ids digitados que não são UUID (equipes/clientes): a tela avisa antes de salvar. */
export function idsInvalidos(texto: string): string[] {
  return listaDeTexto(texto).filter((x) => !UUID_RE.test(x));
}

/** Corpo do `PUT .../rascunho` a partir do formulário (ids inválidos ficam de fora; a tela já avisou). */
export function corpoDoForm(f: FormRascunho, fuso: string): SalvarRascunhoRequest {
  const ids = (t: string) => listaDeTexto(t).filter((x) => UUID_RE.test(x));
  const descricao = f.descricao.trim();
  return {
    titulo: f.titulo.trim(),
    ...(descricao ? { descricao } : {}),
    modo: f.modo,
    frequencia: f.frequencia,
    publico_alvo: { perfis: f.perfis, equipes: ids(f.equipes), segmentos: listaDeTexto(f.segmentos), regioes: listaDeTexto(f.regioes), canais: listaDeTexto(f.canais), clientes: ids(f.clientes) },
    vigencia: vigenciaDoForm({ inicio: f.inicio, fim: f.fim }, fuso),
    perguntas: f.perguntas,
    regras: f.regras,
  };
}
