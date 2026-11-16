/**
 * Aplicação dos lotes do staging em ordem de dependência (RN-INT-04).
 *
 * O worker pega o próximo lote com `ordenarFilaAplicacao`: vendedor antes de cliente, cliente antes de rota/título/nota, produto
 * antes de preço/estoque, para que quase nenhuma linha caia em `referencia_ausente`. A espera é limitada: dependência travada
 * não prende o dependente para sempre (a linha vira `referencia_ausente`, reprocessável). Um lote por vez por (Conector, entidade),
 * na ordem de chegada, para o cursor (RN-INT-05) e o comparador de hash (RN-INT-02) não competirem.
 */
import { ENTIDADES, type Entidade, type EstadoLoteBko } from '../contracts';
import { DEPENDENCIAS, ordenarCarga } from './ordem';
import { PARAMETROS_PADRAO } from './parametros';

export interface LoteNaFila {
  lote_id: string;
  conector_id: string;
  entidade: Entidade;
  status: EstadoLoteBko;
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
