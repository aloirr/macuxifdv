/**
 * Exportação de resultados (RF-PES-06): CSV em UTF-8 com BOM e `;` — o Excel em pt-BR abre direto, com acentos.
 * Uma linha por resposta; uma coluna por pergunta (id estável, RN-PES-01: a mesma pergunta em várias versões vira uma
 * coluna só, com o enunciado da versão mais nova). Datas e horas no fuso do tenant; número com vírgula decimal.
 * Células que começam com `=`, `+`, `@`, `-`, tabulação ou retorno de carro (`protegerFormula` do comum) ganham `'` na frente (injeção de fórmula).
 */
import { BOM_CSV, protegerFormula } from '@macuxi/comum/csv';
import { zonedParts } from '@macuxi/comum/fuso';
import type { ItemResposta, Pergunta, QuestionarioVersao, RespostaPesquisa } from '../contracts';

const SEP = ';';
const FIM = '\r\n';

/**
 * Escapa uma célula: fórmula neutralizada, aspas dobradas, entre aspas se tiver separador, aspas ou quebra.
 * Fica local porque o `celulaCsv` do comum sempre põe aspas e mudaria a saída (RD-0051).
 */
export function celulaCsv(valor: string): string {
  let v = protegerFormula(valor);
  if (/[;"\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

const dois = (n: number) => String(n).padStart(2, '0');

function dataHoraLocal(instante: string, fuso: string): string {
  const p = zonedParts(instante, fuso);
  return `${dois(p.day)}/${dois(p.month)}/${p.year} ${dois(p.hour)}:${dois(p.minute)}`;
}

const dataCivilBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const numeroBr = (n: number) => String(n).replace('.', ',');

function valorDoItem(p: Pergunta | undefined, it: ItemResposta): string {
  const rotulo = (id: string) => (p && (p.tipo === 'unica' || p.tipo === 'multipla') ? (p.opcoes.find((o) => o.id === id)?.rotulo ?? id) : id);
  switch (it.tipo) {
    case 'sim_nao':
      return it.valor ? 'Sim' : 'Não';
    case 'unica':
      return rotulo(it.opcao_id);
    case 'multipla':
      return it.opcao_ids.map(rotulo).join(' | ');
    case 'numero':
      return numeroBr(it.numero);
    case 'escala':
      return String(it.valor);
    case 'texto':
      return it.texto.trim();
    case 'data':
      return dataCivilBr(it.data);
    case 'foto':
      return it.fotos.map((f) => f.id).join(' | ');
    case 'codigo_barras':
      return it.codigo.trim();
  }
}

export interface EntradaExportacao {
  versoes: readonly QuestionarioVersao[];
  respostas: readonly RespostaPesquisa[];
  fuso: string;
  /** "Respondida por" (T-0187): nome por usuario_id; sem nome, a célula fica vazia. */
  nomes?: ReadonlyMap<string, string>;
}

/** RF-PES-06: CSV das respostas (já filtradas pelo escopo e pelos filtros da tela). */
export function exportarRespostasCsv(e: EntradaExportacao): string {
  const versoes = e.versoes.slice().sort((a, b) => a.numero - b.numero);
  const numeroDa = new Map(versoes.map((v) => [v.id, v.numero] as const));
  // colunas: perguntas da versão mais nova primeiro, depois as que só existem em versões anteriores
  const colunas: { id: string; enunciado: string }[] = [];
  const vistas = new Set<string>();
  for (const v of versoes.slice().reverse()) {
    for (const p of v.perguntas) {
      if (vistas.has(p.id)) continue;
      vistas.add(p.id);
      colunas.push({ id: p.id, enunciado: p.enunciado });
    }
  }
  const definicao = (versaoId: string, perguntaId: string) => versoes.find((v) => v.id === versaoId)?.perguntas.find((p) => p.id === perguntaId);

  const cabecalho = ['resposta_id', 'versao', 'respondida_em', 'recebida_em', 'usuario_id', 'Respondida por', 'equipe_id', 'cliente_id', 'visita_id', 'suspeita', 'motivos_suspeita', ...colunas.map((c) => c.enunciado)];
  const linhas = [cabecalho.map(celulaCsv).join(SEP)];
  const ordenadas = e.respostas.slice().sort((a, b) => (a.respondida_em < b.respondida_em ? -1 : a.respondida_em > b.respondida_em ? 1 : a.id < b.id ? -1 : 1));
  for (const r of ordenadas) {
    const porPergunta = new Map(r.itens.map((i) => [i.pergunta_id, i] as const));
    const fixas = [
      r.id,
      String(numeroDa.get(r.versao_id) ?? ''),
      dataHoraLocal(r.respondida_em, e.fuso),
      dataHoraLocal(r.recebida_em, e.fuso),
      r.usuario_id,
      e.nomes?.get(r.usuario_id) ?? '',
      r.equipe_id ?? '',
      r.cliente_id ?? '',
      r.visita_id ?? '',
      r.suspeita ? 'sim' : 'não',
      r.motivos_suspeita.join(' | '),
    ];
    const respostas = colunas.map((c) => {
      const it = porPergunta.get(c.id);
      return it ? valorDoItem(definicao(r.versao_id, c.id), it) : '';
    });
    linhas.push([...fixas, ...respostas].map(celulaCsv).join(SEP));
  }
  return `${BOM_CSV}${linhas.join(FIM)}${FIM}`;
}

/** Nome do arquivo: `pesquisa-<titulo-sem-acento>-<dia no fuso>.csv`. */
export function nomeDoArquivoCsv(titulo: string, agora: string, fuso: string): string {
  const p = zonedParts(agora, fuso);
  const slug =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'resultado';
  return `pesquisa-${slug}-${p.year}-${dois(p.month)}-${dois(p.day)}.csv`;
}
