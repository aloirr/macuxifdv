/**
 * Início do Campo (T-0170; imagem `2026-11-12-T0170-final-inicio.png`; desenho `docs/desenho/inicio-frase-avatar-pedidos.md`
 * e `docs/desenho/performance-produtividade.md`). Puro, sem relógio: texto e tom de cada peça do painel do topo, das Metas do
 * mês, da Produtividade e do sino. As contas são as do domain (`resultadosDoPeriodo`, `produtividadeDoPeriodo`, `fraseDoDia`);
 * a tela não decide cor nem texto por regra.
 */
import { formatHHMM, MONTHS, WEEKDAYS } from '@macuxi/comum/fuso';
import { VALOR_SEM_DADO } from '@macuxi/ui/mobile/puro';

import type { CalendarioPeriodo, IndicadorProdutividade, ProdutividadeIndicador, ResultadoIndicador } from '../../../contracts/performance';
import { fraseDoDia, type FraseDoRodizio } from '../../../domain/frase-avatar/frase-do-dia';
import { FRASES_PADRAO } from '../../../domain/frase-avatar/frases-padrao';
import { cardsDeProdutividade, cardsDeResultados, type CardProdutividade, type ContextoResultados } from '../performance/cards-performance';

// ---------- painel do topo ----------

/** Espaço que não quebra a linha: "DU 9 de 20" e "Últ. sincronização" nunca se partem no meio. */
const NBSP = '\u00a0';
const semQuebra = (texto: string): string => texto.replace(/ /g, NBSP);

/**
 * RN-CORE-43: "Quinta, 12 de novembro · DU 9 de 20"; em dia não útil, só "Domingo, 15 de novembro" (sem o trecho do DU). O "·" e o
 * trecho depois dele não quebram: se não couberem na linha, descem juntos (o "·" não fica pendurado no fim).
 */
export function linhaDaData(hoje: string, du: Pick<CalendarioPeriodo, 'du_hoje' | 'du_total'>): string {
  const [, mes, dia] = hoje.split('-').map(Number);
  const semana = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const data = `${WEEKDAYS[semana]}, ${dia} de ${MONTHS[(mes ?? 1) - 1]}`;
  if (du.du_hoje === null) return data;
  return `${data} ${semQuebra(`· DU ${du.du_hoje} de ${du.du_total}`)}`;
}

/**
 * RN-CORE-41: a frase de hoje, igual para o tenant inteiro. Sem a entidade do tenant no aparelho (`null` ou vazia) vale o
 * rodízio das 30 padrão; com frases do tenant, o rodízio delas (todas inativas = `null`, a linha não aparece).
 */
export function fraseDoPainel(frasesDoTenant: readonly FraseDoRodizio[] | null, hoje: string): string | null {
  const base: readonly FraseDoRodizio[] =
    frasesDoTenant && frasesDoTenant.length > 0
      ? frasesDoTenant
      : FRASES_PADRAO.map((f, i) => ({ id: f.codigo, texto: f.texto, ativa: true, ordem: i + 1 }));
  return fraseDoDia(base, hoje)?.texto ?? null;
}

// ---------- Metas do mês ----------

export interface CardMetaInicio {
  indicador: ResultadoIndicador['indicador'];
  titulo: string;
  /** "R$ 84,6 k"; "—" sem dado. */
  real: string;
  /** "180 k"; null sem meta (a tela não mostra "/ …"). */
  meta: string | null;
  /** "47%" inteiro; null sem meta. */
  percentual: string | null;
  /** 0 a 1; para em 100%. */
  barra: number;
  /** `abaixo`: barra e % em vermelho; `batida`: Azul noite. */
  tom: 'abaixo' | 'batida' | null;
  /** "Meta/dia" ou "Meta/pedido" (itens); null com a meta batida ou sem meta. */
  rodape: { rotulo: string; valor: string } | null;
}

/** Os cards de "Metas do mês": os mesmos números da Performance, só com o Meta/dia (positivação e visitas já inteiras para cima). */
export function cardsDeMetasDoMes(itens: readonly ResultadoIndicador[], c: ContextoResultados | Omit<ContextoResultados, 'umDia'>): CardMetaInicio[] {
  const contexto: ContextoResultados = { umDia: false, ...c };
  return itens.flatMap((r) =>
    cardsDeResultados([r], contexto).map((card): CardMetaInicio => {
      const col = card.colunas.find((x) => x.rotulo === 'Meta/dia' || x.rotulo === 'Meta/pedido');
      return {
        indicador: card.indicador,
        titulo: card.indicador === 'itens_por_pedido' ? 'Itens/pedido' : card.titulo,
        real: card.real,
        meta: card.meta,
        percentual: r.atingimento_pb === null || card.atingimento === null ? null : `${Math.round(r.atingimento_pb / 100)}%`,
        barra: card.barra,
        tom: card.tom === 'batida' ? 'batida' : card.tom === 'a_cumprir' ? 'abaixo' : null,
        rodape: col ? { rotulo: col.rotulo, valor: col.valor } : null,
      };
    }),
  );
}

// ---------- Produtividade ----------

/** Os 6 do Início, na ordem da imagem aprovada (3 colunas × 2 linhas) e com o nome curto. */
const DO_INICIO: ReadonlyArray<{ indicador: IndicadorProdutividade; titulo: string }> = [
  { indicador: 'jornada_liquida', titulo: 'Jornada' },
  { indicador: 'primeiro_checkin', titulo: '1º check-in' },
  { indicador: 'almoco', titulo: 'Almoço' },
  { indicador: 'ultimo_checkin', titulo: 'Últ. check-in' },
  { indicador: 'fora_rota', titulo: 'Fora de rota' },
  { indicador: 'tma', titulo: 'TMA' },
];

export type IndicadorInicio = Pick<CardProdutividade, 'indicador' | 'valor' | 'ponto'> & { titulo: string };

/** Ponto verde (dentro) ou laranja (fora); sem dado: "—" e sem ponto. Indicador ausente da visão também vira "—". */
export function indicadoresDoInicio(itens: readonly ProdutividadeIndicador[]): IndicadorInicio[] {
  const cards = cardsDeProdutividade(itens);
  return DO_INICIO.map(({ indicador, titulo }) => {
    const c = cards.find((x) => x.indicador === indicador);
    return { indicador, titulo, valor: c?.valor ?? VALOR_SEM_DADO, ponto: c?.ponto ?? null };
  });
}

// ---------- sino e sincronização ----------

export interface ContagemSino {
  recados: number;
  tarefas: number;
  total: number;
}

type ItemParaContar = { tipo: 'recado'; notificacao: { lida_em?: string | null } } | { tipo: 'tarefa'; nova: boolean };

/** O número do sino: recados ainda não lidos + tarefas novas (aviso não lido e tarefa não feita). */
export function contarSino(itens: readonly ItemParaContar[]): ContagemSino {
  let recados = 0;
  let tarefas = 0;
  for (const i of itens) {
    if (i.tipo === 'recado' && !i.notificacao.lida_em) recados++;
    else if (i.tipo === 'tarefa' && i.nova) tarefas++;
  }
  return { recados, tarefas, total: recados + tarefas };
}

/** "Últ. sincronização" e, na linha de baixo, "20:22" no fuso do tenant (ao lado do Sincronizar, em 2 linhas); nunca sincronizou: null. */
export function textoUltimaSincronizacao(sincronizadoEm: string | null | undefined, fuso: string): string | null {
  return sincronizadoEm ? `${semQuebra('Últ. sincronização')}\n${formatHHMM(sincronizadoEm, fuso)}` : null;
}
