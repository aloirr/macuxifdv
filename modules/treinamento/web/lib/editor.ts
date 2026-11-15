/**
 * Estado do editor de trilha no BKO (RF-TRE-01) e a conversão de/para `TrilhaEdicao` (contrato da API). Funções puras e
 * imutáveis (testadas): a página só liga os campos. Nenhuma regra de publicação aqui — o que impede publicar vem da API
 * (`problemas_para_publicar`, domain `problemasParaPublicar`); aqui só a forma do formulário.
 */
import { TrilhaEdicao, type PublicoAlvoContrato, type TipoLicao, type Trilha, type TrilhaEdicaoEntrada } from '../../contracts';

export type PerfilDoPublico = PublicoAlvoContrato['perfis'][number];

export interface AlternativaForm {
  id: string;
  texto: string;
  correta: boolean;
}

export interface QuestaoForm {
  id: string;
  enunciado: string;
  alternativas: AlternativaForm[];
}

export interface LicaoForm {
  id: string;
  titulo: string;
  tipo: TipoLicao;
  texto: string;
  midia_url: string;
  /** Duração estimada em minutos, como digitada (vírgula ou ponto); vazio = sem duração. */
  duracao_min: string;
  /** Pré-requisitos explícitos vindos da API (o editor não os altera; some o que apontar para lição removida). */
  pre_requisitos: string[];
  quiz: { id: string; questoes: QuestaoForm[] } | null;
}

export interface ModuloForm {
  id: string;
  titulo: string;
  pre_requisitos: string[];
  licoes: LicaoForm[];
}

export interface EditorTrilha {
  id: string;
  titulo: string;
  descricao: string;
  obrigatoria: boolean;
  sequencial: boolean;
  /** AAAA-MM-DD ou vazio */
  prazo: string;
  perfis: PerfilDoPublico[];
  /** Ids de equipe separados por vírgula, espaço ou linha (premissa até existir o seletor de equipes do Core). */
  equipes: string;
  modulos: ModuloForm[];
}

/** Perfis que estudam no app (doc 03 §2; público-alvo da trilha, RN-TRE-07). */
export const PERFIS_DO_PUBLICO: readonly { id: PerfilDoPublico; rotulo: string }[] = [
  { id: 'vendedor', rotulo: 'Vendedor' },
  { id: 'promotor', rotulo: 'Promotor' },
  { id: 'supervisor', rotulo: 'Supervisor' },
  { id: 'gerente', rotulo: 'Gerente' },
];

export const TIPOS_DE_LICAO: readonly { id: TipoLicao; rotulo: string }[] = [
  { id: 'texto', rotulo: 'Texto' },
  { id: 'video', rotulo: 'Vídeo curto' },
  { id: 'pdf', rotulo: 'PDF' },
  { id: 'link', rotulo: 'Link' },
];

export type GerarId = () => string;

// ---------- minutos ↔ segundos (RN-TRE-04: a duração é a base do tempo mínimo) ----------

/** "2,5" → 150; vazio, inválido ou ≤ 0 → null (lição sem duração vale só o piso de 30 s). */
export function minutosParaSegundos(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  const s = Math.round(Number(t) * 60);
  return s > 0 ? s : null;
}

/** 150 → "2,5"; null → "". */
export function segundosParaMinutos(seg: number | null): string {
  if (seg === null || seg <= 0) return '';
  const min = Math.round((seg / 60) * 100) / 100;
  return String(min).replace('.', ',');
}

/** Lista de ids digitada → ids sem repetição (vírgula, ponto e vírgula, espaço ou linha). */
export function lerListaDeIds(texto: string): string[] {
  return [...new Set(texto.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

// ---------- fábricas ----------

export const novaAlternativa = (gerarId: GerarId, correta = false): AlternativaForm => ({ id: gerarId(), texto: '', correta });
export const novaQuestao = (gerarId: GerarId): QuestaoForm => ({ id: gerarId(), enunciado: '', alternativas: [novaAlternativa(gerarId, true), novaAlternativa(gerarId)] });
export const novaLicao = (gerarId: GerarId): LicaoForm => ({ id: gerarId(), titulo: '', tipo: 'texto', texto: '', midia_url: '', duracao_min: '', pre_requisitos: [], quiz: null });
export const novoModulo = (gerarId: GerarId): ModuloForm => ({ id: gerarId(), titulo: '', pre_requisitos: [], licoes: [novaLicao(gerarId)] });

/** Trilha nova: padrões do contrato (sequencial, não obrigatória, público = todo o tenant) e um módulo com uma lição. */
export function novaTrilha(gerarId: GerarId): EditorTrilha {
  return { id: gerarId(), titulo: '', descricao: '', obrigatoria: false, sequencial: true, prazo: '', perfis: [], equipes: '', modulos: [novoModulo(gerarId)] };
}

// ---------- API → editor ----------

const porOrdem = <T extends { ordem: number }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => a.ordem - b.ordem);

export function deTrilha(t: Pick<Trilha, 'id' | 'titulo' | 'descricao' | 'obrigatoria' | 'sequencial' | 'prazo' | 'publico_alvo' | 'modulos'>): EditorTrilha {
  return {
    id: t.id,
    titulo: t.titulo,
    descricao: t.descricao ?? '',
    obrigatoria: t.obrigatoria,
    sequencial: t.sequencial,
    prazo: t.prazo ?? '',
    perfis: [...t.publico_alvo.perfis],
    equipes: t.publico_alvo.equipes.join(', '),
    modulos: porOrdem(t.modulos).map((m) => ({
      id: m.id,
      titulo: m.titulo,
      pre_requisitos: [...m.pre_requisitos],
      licoes: porOrdem(m.licoes).map((l) => ({
        id: l.id,
        titulo: l.titulo,
        tipo: l.tipo,
        texto: l.texto ?? '',
        midia_url: l.midia_url ?? '',
        duracao_min: segundosParaMinutos(l.duracao_estimada_seg),
        pre_requisitos: [...l.pre_requisitos],
        quiz: l.quiz
          ? {
              id: l.quiz.id,
              questoes: porOrdem(l.quiz.questoes).map((q) => ({ id: q.id, enunciado: q.enunciado, alternativas: q.alternativas.map((a) => ({ ...a })) })),
            }
          : null,
      })),
    })),
  };
}

// ---------- editor → API ----------

const vazioParaNulo = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/**
 * Corpo de `POST/PUT /bko/trilhas` (TrilhaEdicao): ordem = posição na tela, textos aparados, vazios viram null, minutos
 * viram segundos e pré-requisitos que apontam para lição/módulo removido são descartados.
 */
export function paraEdicao(e: EditorTrilha): TrilhaEdicaoEntrada {
  const idsModulos = new Set(e.modulos.map((m) => m.id));
  const idsLicoes = new Set(e.modulos.flatMap((m) => m.licoes.map((l) => l.id)));
  return {
    id: e.id,
    titulo: e.titulo.trim(),
    descricao: vazioParaNulo(e.descricao),
    obrigatoria: e.obrigatoria,
    sequencial: e.sequencial,
    prazo: vazioParaNulo(e.prazo),
    publico_alvo: { perfis: [...e.perfis], equipes: lerListaDeIds(e.equipes) },
    modulos: e.modulos.map((m, mi) => ({
      id: m.id,
      ordem: mi + 1,
      titulo: m.titulo.trim(),
      pre_requisitos: m.pre_requisitos.filter((p) => idsModulos.has(p)),
      licoes: m.licoes.map((l, li) => ({
        id: l.id,
        ordem: li + 1,
        titulo: l.titulo.trim(),
        tipo: l.tipo,
        texto: vazioParaNulo(l.texto),
        midia_url: vazioParaNulo(l.midia_url),
        duracao_estimada_seg: minutosParaSegundos(l.duracao_min),
        pre_requisitos: l.pre_requisitos.filter((p) => idsLicoes.has(p)),
        quiz: l.quiz
          ? {
              id: l.quiz.id,
              questoes: l.quiz.questoes.map((q, qi) => ({ id: q.id, ordem: qi + 1, enunciado: q.enunciado.trim(), alternativas: q.alternativas.map((a) => ({ id: a.id, texto: a.texto.trim(), correta: a.correta })) })),
            }
          : null,
      })),
    })),
  };
}

const ROTULO_CAMPO: Readonly<Record<string, string>> = {
  titulo: 'Título',
  enunciado: 'Enunciado',
  texto: 'Texto',
  midia_url: 'Endereço (URL)',
  prazo: 'Prazo',
  equipes: 'Equipes do público',
  duracao_estimada_seg: 'Duração',
};

/** Onde está o problema, em português: "Módulo 1 › Lição 2 › Título". */
function ondeEsta(caminho: readonly (string | number)[]): string {
  const partes: string[] = [];
  const ROTULO_LISTA: Readonly<Record<string, string>> = { modulos: 'Módulo', licoes: 'Lição', questoes: 'Questão', alternativas: 'Alternativa' };
  for (let i = 0; i < caminho.length; i++) {
    const k = caminho[i];
    const n = caminho[i + 1];
    if (typeof k === 'string' && ROTULO_LISTA[k] && typeof n === 'number') {
      partes.push(`${ROTULO_LISTA[k]} ${n + 1}`);
      i++;
    } else if (k === 'equipes') {
      partes.push(ROTULO_CAMPO.equipes!);
      break;
    } else if (typeof k === 'string' && ROTULO_CAMPO[k]) partes.push(ROTULO_CAMPO[k]);
  }
  return partes.join(' › ');
}

/** Mensagem do problema, com o texto que diz o que fazer quando o do contrato é técnico. */
function mensagemDoProblema(caminho: readonly PropertyKey[], codigo: string, mensagem: string): string {
  if (caminho.at(-2) === 'equipes' || caminho.at(-1) === 'equipes') return 'use ids de equipe válidos (UUID).';
  if (codigo === 'invalid_string' && caminho.at(-1) === 'midia_url') return 'informe um endereço completo (https://...).';
  return mensagem;
}

/** Confere o formulário com o contrato antes de enviar: lista de mensagens (vazia = pode salvar). A API revalida. */
export function problemasDoFormulario(e: EditorTrilha): string[] {
  const r = TrilhaEdicao.safeParse(paraEdicao(e));
  if (r.success) return [];
  return [...new Set(r.error.issues.map((i) => {
    const onde = ondeEsta(i.path);
    const msg = mensagemDoProblema(i.path, i.code, i.message);
    return onde ? `${onde}: ${msg}` : msg;
  }))];
}

/** Campos do editor que mostram o erro embaixo (revisão do BKO §P8): a chave é o caminho no contrato. */
const CAMPOS_COM_ERRO = new Set(['titulo', 'descricao', 'prazo', 'enunciado', 'texto', 'midia_url', 'duracao_estimada_seg']);

export interface ErrosDoFormulario {
  /** Erro de cada campo, pelo caminho no contrato ("titulo", "modulos.0.licoes.1.titulo"); o primeiro de cada campo. */
  campos: Readonly<Record<string, string>>;
  /** Problemas que não são de um campo só (ex.: quiz sem alternativa correta), com o lugar em português. */
  outros: string[];
}

/**
 * Erros do formulário para a tela (revisão do BKO §P8, regra 3): cada um embaixo do seu campo; o que não é de um campo
 * (lista vazia, quiz sem correta) vai numa lista só, com o lugar. As posições batem com as do editor (`paraEdicao` só
 * renumera a ordem).
 */
export function errosDoFormulario(e: EditorTrilha): ErrosDoFormulario {
  const r = TrilhaEdicao.safeParse(paraEdicao(e));
  if (r.success) return { campos: {}, outros: [] };
  const campos: Record<string, string> = {};
  const outros = new Set<string>();
  for (const i of r.error.issues) {
    const msg = mensagemDoProblema(i.path, i.code, i.message);
    const ultimo = i.path.at(-1);
    if (typeof ultimo === 'string' && CAMPOS_COM_ERRO.has(ultimo)) {
      const chave = i.path.join('.');
      campos[chave] ??= msg;
    } else {
      const onde = ondeEsta(i.path);
      outros.add(onde ? `${onde}: ${msg}` : msg);
    }
  }
  return { campos, outros: [...outros] };
}

// ---------- operações imutáveis ----------

/** Troca o item da posição `i` com o vizinho (`delta` −1 sobe, +1 desce); fora da lista não muda nada. */
export function mover<T>(lista: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return [...lista];
  const nova = [...lista];
  [nova[i], nova[j]] = [nova[j]!, nova[i]!];
  return nova;
}

export const remover = <T>(lista: readonly T[], i: number): T[] => lista.filter((_, k) => k !== i);

const trocar = <T>(lista: readonly T[], i: number, fn: (x: T) => T): T[] => lista.map((x, k) => (k === i ? fn(x) : x));

export function alterarModulo(e: EditorTrilha, mi: number, fn: (m: ModuloForm) => ModuloForm): EditorTrilha {
  return { ...e, modulos: trocar(e.modulos, mi, fn) };
}

export function alterarLicao(e: EditorTrilha, mi: number, li: number, fn: (l: LicaoForm) => LicaoForm): EditorTrilha {
  return alterarModulo(e, mi, (m) => ({ ...m, licoes: trocar(m.licoes, li, fn) }));
}

export function alterarQuestao(e: EditorTrilha, mi: number, li: number, qi: number, fn: (q: QuestaoForm) => QuestaoForm): EditorTrilha {
  return alterarLicao(e, mi, li, (l) => (l.quiz ? { ...l, quiz: { ...l.quiz, questoes: trocar(l.quiz.questoes, qi, fn) } } : l));
}

/** Liga o quiz da lição (com uma questão) ou desliga (o quiz some ao salvar). */
export function alternarQuiz(e: EditorTrilha, mi: number, li: number, gerarId: GerarId): EditorTrilha {
  return alterarLicao(e, mi, li, (l) => ({ ...l, quiz: l.quiz ? null : { id: gerarId(), questoes: [novaQuestao(gerarId)] } }));
}

export function adicionarQuestao(e: EditorTrilha, mi: number, li: number, gerarId: GerarId): EditorTrilha {
  return alterarLicao(e, mi, li, (l) => (l.quiz ? { ...l, quiz: { ...l.quiz, questoes: [...l.quiz.questoes, novaQuestao(gerarId)] } } : l));
}

export function removerQuestao(e: EditorTrilha, mi: number, li: number, qi: number): EditorTrilha {
  return alterarLicao(e, mi, li, (l) => (l.quiz ? { ...l, quiz: { ...l.quiz, questoes: remover(l.quiz.questoes, qi) } } : l));
}

/** RN-TRE-02: múltipla escolha é permitida — marcar/desmarcar não mexe nas outras alternativas. */
export function marcarCorreta(e: EditorTrilha, mi: number, li: number, qi: number, ai: number): EditorTrilha {
  return alterarQuestao(e, mi, li, qi, (q) => ({ ...q, alternativas: trocar(q.alternativas, ai, (a) => ({ ...a, correta: !a.correta })) }));
}

/** Status que abre o editor em modo de edição (o resto é só leitura; a API também barra: TRILHA_NAO_EDITAVEL). */
export const editavel = (status: string | null | undefined): boolean => !status || status === 'rascunho';
