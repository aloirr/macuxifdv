/**
 * Resultados agregados (RF-PES-06): taxa de resposta sobre o público, contagem por opção, média/mínimo/máximo para
 * número e escala, filtrável por período (dia civil no fuso do tenant) e equipe. Por VERSÃO (RN-PES-01): respostas
 * de outras versões ficam de fora e aparecem em `ignoradas_outra_versao`. Percentuais com 2 casas; sem dados = null.
 */
import type { FiltroResultado, ItemResposta, Pergunta, QuestionarioVersao, ResultadoConsolidado, ResultadoPergunta, ResultadoPesquisa, RespostaPesquisa } from '../contracts';
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

/** RF-PES-06: a resposta entra no filtro (período em dia civil do fuso do tenant, inclusivo; equipe da resposta)? */
export function respostaDentroDoFiltro(r: Pick<RespostaPesquisa, 'respondida_em' | 'equipe_id'>, f: FiltroResultado, fuso: string): boolean {
  return dentroDoFiltro(r, f, fuso);
}

const dentroDoFiltro = (r: Pick<RespostaPesquisa, 'respondida_em' | 'equipe_id'>, f: FiltroResultado, fuso: string): boolean => {
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
    respostas_suspeitas: escolhidas.filter((r) => r.suspeita).length,
    base,
    respondentes_distintos: respondentes.size,
    publico_total: universo ? new Set(universo.map((a) => a.id)).size : null,
    taxa_resposta_pct: universo ? percentual(noUniverso, new Set(universo.map((a) => a.id)).size) : null,
    por_pergunta: versao.perguntas.map((p) => resumirPergunta(p, escolhidas)),
  };
}

export interface EntradaConsolidacao {
  versoes: readonly QuestionarioVersao[];
  respostas: readonly RespostaPesquisa[];
  filtro?: FiltroResultado;
  fuso?: string;
}

/** Pergunta "somada" das versões: opções em união (rótulo da mais recente) e escala pela união das pontas. */
function perguntaUnida(defs: readonly Pergunta[]): Pergunta {
  const ultima = defs[defs.length - 1]!;
  if (ultima.tipo === 'unica' || ultima.tipo === 'multipla') {
    const porId = new Map<string, { id: string; rotulo: string }>();
    for (const d of defs) for (const o of (d as typeof ultima).opcoes) porId.set(o.id, { ...(porId.get(o.id) ?? {}), ...o });
    return { ...ultima, opcoes: [...porId.values()] } as Pergunta;
  }
  if (ultima.tipo === 'escala') {
    const escalas = defs as Extract<Pergunta, { tipo: 'escala' }>[];
    return { ...ultima, minimo: Math.min(...escalas.map((e) => e.minimo)), maximo: Math.max(...escalas.map((e) => e.maximo)) };
  }
  return ultima;
}

/**
 * RN-PES-01: resultado entre versões. Só perguntas com o mesmo identificador estável (mesmo `id` e mesmo `tipo`) em
 * mais de uma versão publicada são consolidadas; as demais (nova, removida, ou com tipo alterado) aparecem por versão.
 * Nunca junta perguntas por texto do enunciado. Versões em rascunho ficam de fora; respostas de versão desconhecida
 * são ignoradas; o mesmo id de resposta conta uma vez.
 */
export function consolidarEntreVersoes(entrada: EntradaConsolidacao): ResultadoConsolidado {
  const filtro = entrada.filtro ?? {};
  const fuso = entrada.fuso ?? PARAMETROS_PADRAO.fuso;
  const versoes = entrada.versoes.filter((v) => v.status === 'publicada').slice().sort((a, b) => a.numero - b.numero);
  const ids = new Set(versoes.map((v) => v.id));
  const vistos = new Set<string>();
  const porVersao = new Map<string, RespostaPesquisa[]>(versoes.map((v) => [v.id, []]));
  for (const r of entrada.respostas) {
    if (!ids.has(r.versao_id) || vistos.has(r.id)) continue;
    vistos.add(r.id);
    if (dentroDoFiltro(r, filtro, fuso)) porVersao.get(r.versao_id)!.push(r);
  }

  // Grupos por (id, tipo) com 2+ versões.
  const grupos = new Map<string, { versao: QuestionarioVersao; pergunta: Pergunta }[]>();
  for (const v of versoes) for (const p of v.perguntas) grupos.set(`${p.id}|${p.tipo}`, [...(grupos.get(`${p.id}|${p.tipo}`) ?? []), { versao: v, pergunta: p }]);
  const consolidaveis = new Set([...grupos].filter(([, g]) => g.length > 1).map(([k]) => k));

  const consolidadas: ResultadoConsolidado['consolidadas'] = [];
  const emOrdem = new Set<string>();
  for (const v of versoes.slice().reverse()) {
    for (const p of v.perguntas) {
      const chave = `${p.id}|${p.tipo}`;
      if (!consolidaveis.has(chave) || emOrdem.has(chave)) continue;
      emOrdem.add(chave);
      const g = grupos.get(chave)!;
      const respostas = g.flatMap((x) => porVersao.get(x.versao.id)!);
      consolidadas.push({ pergunta: resumirPergunta(perguntaUnida(g.map((x) => x.pergunta)), respostas), versoes_ids: g.map((x) => x.versao.id), total_respostas: respostas.length });
    }
  }

  return {
    questionario_id: versoes[0]?.questionario_id ?? '00000000-0000-0000-0000-000000000000',
    filtro,
    versoes: versoes.map((v) => ({ versao_id: v.id, numero: v.numero, respostas: porVersao.get(v.id)!.length })),
    respostas_suspeitas: [...porVersao.values()].flat().filter((r) => r.suspeita).length,
    consolidadas,
    por_versao: versoes.map((v) => ({
      versao_id: v.id,
      numero: v.numero,
      perguntas: v.perguntas.filter((p) => !consolidaveis.has(`${p.id}|${p.tipo}`)).map((p) => resumirPergunta(p, porVersao.get(v.id)!)),
    })),
  };
}
