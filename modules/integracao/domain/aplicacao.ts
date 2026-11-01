/**
 * Aplicação dos lotes do staging em ordem de dependência (RN-INT-04) e resumo da carga por entidade (monitor).
 *
 * O worker pega o próximo lote com `ordenarFilaAplicacao`: vendedor antes de cliente, cliente antes de rota/título/nota, produto
 * antes de preço/estoque, para que quase nenhuma linha caia em `referencia_ausente`. A espera é limitada: dependência travada
 * não prende o dependente para sempre (a linha vira `referencia_ausente`, reprocessável). Um lote por vez por (Conector, entidade),
 * na ordem de chegada, para o cursor (RN-INT-05) e o comparador de hash (RN-INT-02) não competirem.
 */
import { ENTIDADES, type ContagensLote, type Entidade, type EstadoLote } from '../contracts';
import { DEPENDENCIAS, ordenarCarga } from './ordem';
import { PARAMETROS_PADRAO } from './parametros';

export interface LoteNaFila {
  lote_id: string;
  conector_id: string;
  entidade: Entidade;
  status: EstadoLote;
  recebido_em: string;
  /** Parte da sessão de carga completa; `null` no delta. */
  parte: number | null;
}

export interface LoteAguardando {
  lote: LoteNaFila;
  /** Entidades de que o lote depende e que ainda têm lote `recebido`/`processando`. */
  esperaPor: Entidade[];
  motivo: 'dependencia' | 'mesma_entidade_em_andamento';
}

export interface FilaOrdenada {
  /** Podem ser aplicados agora (em paralelo), na ordem de dependência e de chegada. */
  prontos: LoteNaFila[];
  aguardando: LoteAguardando[];
}

const ORDEM_ENTIDADES: readonly Entidade[] = (() => {
  const r = ordenarCarga<Entidade>(ENTIDADES);
  if (!r.ok) throw new Error(`Dependências de entidades com ciclo: ${r.ciclo.join(' → ')}`);
  return r.ordem;
})();

export function ordenarFilaAplicacao(fila: readonly LoteNaFila[], agora: string, opcoes: { esperaMaxDependenciaMin?: number } = {}): FilaOrdenada {
  const esperaMax = (opcoes.esperaMaxDependenciaMin ?? PARAMETROS_PADRAO.esperaMaxDependenciaMin) * 60_000;
  const emAberto = fila.filter((l) => l.status === 'recebido' || l.status === 'processando');
  const processando = new Set(fila.filter((l) => l.status === 'processando').map((l) => `${l.conector_id}|${l.entidade}`));
  const pendentes = fila
    .filter((l) => l.status === 'recebido')
    .sort(
      (a, b) =>
        ORDEM_ENTIDADES.indexOf(a.entidade) - ORDEM_ENTIDADES.indexOf(b.entidade) ||
        Date.parse(a.recebido_em) - Date.parse(b.recebido_em) ||
        (a.parte ?? 0) - (b.parte ?? 0) ||
        (a.lote_id < b.lote_id ? -1 : a.lote_id > b.lote_id ? 1 : 0),
    );

  const prontos: LoteNaFila[] = [];
  const aguardando: LoteAguardando[] = [];
  const vistos = new Set<string>();
  for (const l of pendentes) {
    const chave = `${l.conector_id}|${l.entidade}`;
    if (processando.has(chave) || vistos.has(chave)) {
      aguardando.push({ lote: l, esperaPor: [], motivo: 'mesma_entidade_em_andamento' });
      continue;
    }
    vistos.add(chave);
    const esperaPor = DEPENDENCIAS[l.entidade].filter((d) => emAberto.some((x) => x.entidade === d && x.lote_id !== l.lote_id));
    const esperouDemais = Date.parse(agora) - Date.parse(l.recebido_em) >= esperaMax;
    if (esperaPor.length > 0 && !esperouDemais) aguardando.push({ lote: l, esperaPor, motivo: 'dependencia' });
    else prontos.push(l);
  }
  return { prontos, aguardando };
}

/** Entidades que referenciam `entidade` (direto): ao concluir um lote dela, reprocessam-se as linhas `referencia_ausente` delas. */
export function dependentesDe(entidade: Entidade): Entidade[] {
  return ORDEM_ENTIDADES.filter((e) => DEPENDENCIAS[e].includes(entidade));
}

export type EstadoCargaEntidade = 'sem_lotes' | 'pendente' | 'em_andamento' | 'concluida' | 'concluida_com_erros' | 'falhou';

export interface LoteParaResumo {
  entidade: Entidade;
  status: EstadoLote;
  contagens: Pick<ContagensLote, 'recebidas' | 'com_erro' | 'novas' | 'atualizadas' | 'inalteradas'>;
}

export interface ResumoCargaEntidade {
  entidade: Entidade;
  estado: EstadoCargaEntidade;
  lotes: number;
  recebidas: number;
  com_erro: number;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  /** Dependências que ainda não terminaram (pendentes ou em andamento). */
  aguardando: Entidade[];
}

/** As 8 entidades na ordem de dependência, com o estado agregado dos lotes de cada uma (tela "carga inicial" do monitor). */
export function resumirCargaPorEntidade(lotes: readonly LoteParaResumo[]): ResumoCargaEntidade[] {
  const base = ORDEM_ENTIDADES.map((entidade): ResumoCargaEntidade => {
    const meus = lotes.filter((l) => l.entidade === entidade);
    const soma = (k: keyof LoteParaResumo['contagens']) => meus.reduce((a, l) => a + l.contagens[k], 0);
    let estado: EstadoCargaEntidade;
    if (meus.length === 0) estado = 'sem_lotes';
    else if (meus.some((l) => l.status === 'processando')) estado = 'em_andamento';
    else if (meus.some((l) => l.status === 'recebido')) estado = 'pendente';
    else if (meus.every((l) => l.status === 'falhou')) estado = 'falhou';
    else if (meus.some((l) => l.status === 'falhou' || l.status === 'concluido_com_erros' || l.contagens.com_erro > 0)) estado = 'concluida_com_erros';
    else estado = 'concluida';
    return { entidade, estado, lotes: meus.length, recebidas: soma('recebidas'), com_erro: soma('com_erro'), novas: soma('novas'), atualizadas: soma('atualizadas'), inalteradas: soma('inalteradas'), aguardando: [] };
  });
  const emAberto = new Set(base.filter((b) => b.estado === 'pendente' || b.estado === 'em_andamento').map((b) => b.entidade));
  return base.map((b) => ({ ...b, aguardando: DEPENDENCIAS[b.entidade].filter((d) => emAberto.has(d)) }));
}
