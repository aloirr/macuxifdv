/**
 * Resultados agregados (RF-PES-06): taxa de resposta sobre o público, contagem por opção, média/mínimo/máximo para
 * número e escala, filtrável por período (dia civil no fuso do tenant) e equipe. Por VERSÃO (RN-PES-01): respostas
 * de outras versões ficam de fora e aparecem em `ignoradas_outra_versao`. Percentuais com 2 casas; sem dados = null.
 */
import type { FiltroResultado, ItemResposta, Pergunta, QuestionarioVersao, ResultadoPergunta, ResultadoPesquisa, RespostaPesquisa } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';
import { itemRespondido } from './resposta-item';
import { arredondar, diaLocal, percentual } from './util';

export interface AlvoDoUniverso {
  /** Id do usuário ou do cliente, conforme `base`. */
  id: string;
  equipe_id: string | null;
}

export interface EntradaResultado {
  versao: QuestionarioVersao;
  respostas: readonly RespostaPesquisa[];
  filtro?: FiltroResultado;
  /** Quem deveria responder (usuários ou clientes do público). Sem isso não há taxa de resposta. */
  universo?: readonly AlvoDoUniverso[];
  /** O que o universo representa. Padrão: `usuario`. */
  base?: 'usuario' | 'cliente';
  fuso?: string;
}

const dentroDoFiltro = (r: RespostaPesquisa, f: FiltroResultado, fuso: string): boolean => {
  if (f.de !== undefined || f.ate !== undefined) {
    const dia = diaLocal(r.respondida_em, fuso);
    if (f.de !== undefined && dia < f.de) return false;
    if (f.ate !== undefined && dia > f.ate) return false;
  }
  if (f.equipe_ids !== undefined && (r.equipe_id === null || !f.equipe_ids.includes(r.equipe_id))) return false;
  return true;
};

/** Itens respondidos de uma pergunta nas respostas, um por resposta. */
function itensDa(pergunta: Pergunta, respostas: readonly RespostaPesquisa[]): ItemResposta[] {
  const saida: ItemResposta[] = [];
  for (const r of respostas) {
    const it = r.itens.find((i) => i.pergunta_id === pergunta.id && i.tipo === pergunta.tipo);
    if (it && itemRespondido(it)) saida.push(it);
  }
  return saida;
}

function resumirPergunta(p: Pergunta, respostas: readonly RespostaPesquisa[]): ResultadoPergunta {
  const itens = itensDa(p, respostas);
  const respondentes = itens.length;
  const comum = { pergunta_id: p.id, enunciado: p.enunciado, respondentes, pct_das_respostas: percentual(respondentes, respostas.length) };
  const contar = (opcoes: { id: string; rotulo: string }[], marcou: (i: ItemResposta, id: string) => boolean) =>
    opcoes.map((o) => {
      const contagem = itens.filter((i) => marcou(i, o.id)).length;
      return { opcao_id: o.id, rotulo: o.rotulo, contagem, pct: percentual(contagem, respondentes) };
    });

  switch (p.tipo) {
    case 'sim_nao':
      return { ...comum, tipo: 'sim_nao', opcoes: contar([{ id: 'sim', rotulo: 'Sim' }, { id: 'nao', rotulo: 'Não' }], (i, id) => i.tipo === 'sim_nao' && i.valor === (id === 'sim')) };
    case 'unica':
      return { ...comum, tipo: 'unica', opcoes: contar(p.opcoes, (i, id) => i.tipo === 'unica' && i.opcao_id === id) };
    case 'multipla':
      return { ...comum, tipo: 'multipla', opcoes: contar(p.opcoes, (i, id) => i.tipo === 'multipla' && i.opcao_ids.includes(id)) };
    case 'numero':
    case 'escala': {
      const valores = itens.map((i) => (i.tipo === 'numero' ? i.numero : i.tipo === 'escala' ? i.valor : 0));
      const base = {
        ...comum,
        media: valores.length ? arredondar(valores.reduce((a, b) => a + b, 0) / valores.length) : null,
        minimo: valores.length ? Math.min(...valores) : null,
        maximo: valores.length ? Math.max(...valores) : null,
      };
      if (p.tipo === 'numero') return { ...base, tipo: 'numero', distribuicao: [] };
      const distribuicao = [];
      for (let v = p.minimo; v <= p.maximo; v++) distribuicao.push({ valor: v, contagem: valores.filter((x) => x === v).length });
      return { ...base, tipo: 'escala', distribuicao };
    }
    case 'texto':
      return { ...comum, tipo: 'texto' };
    case 'data': {
      const datas = itens.flatMap((i) => (i.tipo === 'data' ? [i.data] : [])).sort();
      return { ...comum, tipo: 'data', mais_antiga: datas[0] ?? null, mais_recente: datas[datas.length - 1] ?? null };
    }
    case 'foto':
      return { ...comum, tipo: 'foto', total_fotos: itens.reduce((n, i) => n + (i.tipo === 'foto' ? i.fotos.length : 0), 0) };
    case 'codigo_barras':
      return { ...comum, tipo: 'codigo_barras', codigos_distintos: new Set(itens.flatMap((i) => (i.tipo === 'codigo_barras' ? [i.codigo.trim()] : []))).size };
  }
}

/** RF-PES-06: apuração de uma versão. */
export function agregarResultados(entrada: EntradaResultado): ResultadoPesquisa {
  const { versao } = entrada;
  const filtro = entrada.filtro ?? {};
  const fuso = entrada.fuso ?? PARAMETROS_PADRAO.fuso;
  const base = entrada.base ?? 'usuario';

  let ignoradas = 0;
  const vistos = new Set<string>();
  const escolhidas: RespostaPesquisa[] = [];
  for (const r of entrada.respostas) {
    if (r.versao_id !== versao.id) {
      ignoradas++;
      continue;
    }
    if (vistos.has(r.id)) continue; // RF-PES-04: o mesmo id é a mesma resposta
    vistos.add(r.id);
    if (dentroDoFiltro(r, filtro, fuso)) escolhidas.push(r);
  }

  const universo = entrada.universo
    ? entrada.universo.filter((a) => filtro.equipe_ids === undefined || (a.equipe_id !== null && filtro.equipe_ids.includes(a.equipe_id)))
    : null;
  const quem = (r: RespostaPesquisa) => (base === 'usuario' ? r.usuario_id : r.cliente_id);
  const respondentes = new Set<string>();
  for (const r of escolhidas) {
    const q = quem(r);
    if (q !== null) respondentes.add(q);
  }
  const noUniverso = universo ? universo.filter((a) => respondentes.has(a.id)).length : 0;

  return {
    questionario_id: versao.questionario_id,
    versao_id: versao.id,
    filtro,
    total_respostas: escolhidas.length,
    ignoradas_outra_versao: ignoradas,
    base,
    respondentes_distintos: respondentes.size,
    publico_total: universo ? new Set(universo.map((a) => a.id)).size : null,
    taxa_resposta_pct: universo ? percentual(noUniverso, new Set(universo.map((a) => a.id)).size) : null,
    por_pergunta: versao.perguntas.map((p) => resumirPergunta(p, escolhidas)),
  };
}
