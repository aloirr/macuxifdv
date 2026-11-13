/**
 * Texto dos cards da Performance (T-0170; desenho §1.5, §1.6, §2 e §3; imagens `2026-11-12-T0170-final-performance-*.png`).
 * Puro: recebe o que `resultadosDoPeriodo` e `produtividadeDoPeriodo` devolvem (inteiros, nas unidades da §1.5) e devolve só
 * texto e o tom de cada peça. A tela não faz conta nem escolhe cor por regra; quem decide é esta função (testada).
 */
import { formatBRL0 } from '@macuxi/comum';
import { VALOR_SEM_DADO } from '@macuxi/ui/mobile/puro';

import {
  SENTIDO_PRODUTIVIDADE,
  UNIDADES_PRODUTIVIDADE,
  type CalendarioPeriodo,
  type IndicadorProdutividade,
  type IndicadorResultado,
  type ProdutividadeIndicador,
  type ResultadoIndicador,
} from '../../../contracts/performance';

// ---------- números ----------

const milhar = (n: number): string => String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
/** Uma casa, com vírgula, sem ",0" ("84,6", "180"). */
const umaCasa = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? milhar(r) : `${milhar(Math.trunc(r))},${Math.round(Math.abs(r * 10)) % 10}`;
};

/** Dinheiro (§1.5): "R$ 84,6 k" de R$ 10 mil para cima, "R$ 1,2 mi" de R$ 1 milhão; abaixo, "R$ 9.400". Sem "R$" na meta. */
export function dinheiro(cents: number, comMoeda = true): string {
  const reais = cents / 100;
  let texto: string;
  if (reais >= 1_000_000) texto = `${umaCasa(Math.round(reais / 100_000) / 10)} mi`;
  else if (reais >= 10_000) texto = `${umaCasa(Math.round(reais / 100) / 10)} k`;
  else return comMoeda ? formatBRL0(cents) : milhar(Math.round(reais));
  return comMoeda ? `R$ ${texto}` : texto;
}

/** Pontos-base com uma casa: 4700 → "47,0%" (o atingimento da barra). */
export const percentual = (pb: number): string => `${(pb / 100).toFixed(1).replace('.', ',')}%`;

/** Centésimos com uma casa: 640 → "6,4". */
const centesimos = (v: number): string => (Math.round(v / 10) / 10).toFixed(1).replace('.', ',');

function valorResultado(indicador: IndicadorResultado, v: number, comMoeda = true): string {
  if (indicador === 'venda_cents') return dinheiro(v, comMoeda);
  if (indicador === 'itens_por_pedido') return centesimos(v);
  return milhar(v);
}

// ---------- Resultados ----------

export interface ColunaResultado {
  rotulo: string;
  valor: string;
}

export interface CardResultado {
  indicador: IndicadorResultado;
  titulo: string;
  /** "R$ 84,6 k"; "—" sem dado. */
  real: string;
  /** "180 k"; null sem meta (a tela não mostra "/ …"). */
  meta: string | null;
  /** "47,0%"; null sem meta (sem barra). */
  atingimento: string | null;
  /** Preenchimento da barra, de 0 a 1 (para em 100%). */
  barra: number;
  /** `a_cumprir`: barra laranja e % em vermelho; `batida`: barra e % em azul noite. */
  tom: 'a_cumprir' | 'batida' | null;
  colunas: ColunaResultado[];
}

const TITULO_RESULTADO: Record<IndicadorResultado, string> = {
  venda_cents: 'Faturamento',
  positivacao: 'Positivação',
  visitas: 'Visitas',
  itens_por_pedido: 'Itens por pedido',
};

export interface ContextoResultados {
  /** D6: "Vendas" quando a meta do tenant é de pedido; "Faturamento" quando é de faturamento ou sem base ainda. */
  tipoMetaVenda: 'pedido' | 'faturamento' | null;
  /** Promotor só vê Visitas (RN-PRO-01, §2.4). */
  perfil: 'vendedor' | 'promotor';
  /** Período de um dia só: o Real/dia seria o próprio realizado e sai. */
  umDia: boolean;
}

/** Os cards de Resultados na ordem do contrato. O promotor só recebe Visitas. */
export function cardsDeResultados(itens: readonly ResultadoIndicador[], c: ContextoResultados): CardResultado[] {
  return itens
    .filter((r) => c.perfil === 'vendedor' || r.indicador === 'visitas')
    .map((r): CardResultado => {
      const titulo = r.indicador === 'venda_cents' && c.tipoMetaVenda === 'pedido' ? 'Vendas' : TITULO_RESULTADO[r.indicador];
      const base = { indicador: r.indicador, titulo };
      if (r.situacao === 'sem_dado' || r.realizado === null)
        return { ...base, real: VALOR_SEM_DADO, meta: null, atingimento: null, barra: 0, tom: null, colunas: [] };
      const itens = r.indicador === 'itens_por_pedido';
      const real = valorResultado(r.indicador, r.realizado);
      const colunaReal: ColunaResultado | null = itens
        ? null
        : c.umDia
          ? null
          : { rotulo: 'Real/dia', valor: r.real_dia === null ? VALOR_SEM_DADO : valorResultado(r.indicador, r.real_dia) };
      if (r.situacao === 'sem_meta' || r.meta === null)
        return { ...base, real, meta: null, atingimento: null, barra: 0, tom: null, colunas: colunaReal ? [colunaReal] : [] };
      const batida = r.situacao === 'batida';
      const colunas: ColunaResultado[] = [];
      if (!batida && r.gap !== null) colunas.push({ rotulo: 'Gap', valor: valorResultado(r.indicador, r.gap) });
      if (!batida && r.meta_dia !== null) colunas.push({ rotulo: itens ? 'Meta/pedido' : 'Meta/dia', valor: valorResultado(r.indicador, r.meta_dia) });
      if (itens) colunas.push({ rotulo: 'Real', valor: real });
      else if (colunaReal) colunas.push(colunaReal);
      // Itens por pedido: "Real" repete o número grande quando só ele sobra (meta batida).
      const semRepeticao = itens && colunas.length === 1 ? [] : colunas;
      const pb = r.atingimento_pb;
      return {
        ...base,
        real,
        meta: valorResultado(r.indicador, r.meta, false),
        atingimento: pb === null ? null : percentual(pb),
        barra: pb === null ? 0 : Math.min(1, pb / 10_000),
        tom: batida ? 'batida' : 'a_cumprir',
        colunas: semRepeticao,
      };
    });
}

// ---------- Produtividade ----------

const TITULO_PRODUTIVIDADE: Record<IndicadorProdutividade, string> = {
  primeiro_checkin: '1º check-in (média)',
  ultimo_checkin: 'Último check-in (média)',
  tma: 'TMA · atendimento',
  tmd: 'TMD · deslocamento',
  almoco: 'Almoço (média)',
  jornada_liquida: 'Jornada líquida',
  fora_rota: 'Fora de rota',
  visitas_dia: 'Visitas por dia',
  cobertura_rota: 'Cobertura de rota',
  raio_checkin: 'Raio médio do check-in',
  km_dia: 'Km por dia',
  km_cliente: 'Km por cliente',
};

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Valor na unidade do indicador (§1.5): "07:52", "27 min", "1h34", "14%", "10,7", "58 m", "88 km", "8,2 km". */
export function valorProdutividade(indicador: IndicadorProdutividade, v: number): string {
  switch (UNIDADES_PRODUTIVIDADE[indicador]) {
    case 'minuto_do_dia':
      return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
    case 'minutos':
      return v < 60 ? `${v} min` : `${Math.floor(v / 60)}h${pad2(v % 60)}`;
    case 'pontos_base':
      return `${Math.round(v / 100)}%`;
    case 'decimos':
      return umaCasa(v / 10);
    case 'metros':
      if (indicador === 'raio_checkin') return `${milhar(v)} m`;
      return v >= 10_000 ? `${milhar(Math.round(v / 1000))} km` : `${umaCasa(v / 1000)} km`;
  }
}

/** "meta até 08:00", "meta depois de 17:00", "meta 11", "meta 90%". */
export function textoDaMeta(indicador: IndicadorProdutividade, meta: number): string {
  const valor = valorProdutividade(indicador, meta);
  if (SENTIDO_PRODUTIVIDADE[indicador] === 'ate') return `meta até ${valor}`;
  return UNIDADES_PRODUTIVIDADE[indicador] === 'minuto_do_dia' ? `meta depois de ${valor}` : `meta ${valor}`;
}

export interface CardProdutividade {
  indicador: IndicadorProdutividade;
  titulo: string;
  /** "—" sem dado. */
  valor: string;
  /** Linha "meta …"; null sem meta. */
  meta: string | null;
  /** Ponto verde (dentro) ou laranja (fora); null sem dado ou sem meta. */
  ponto: 'dentro' | 'fora' | null;
}

/** Os 12 cards da Produtividade, na ordem do contrato. Km e raio sem dado: "—" sem ponto, com a meta visível (§5). */
export function cardsDeProdutividade(itens: readonly ProdutividadeIndicador[]): CardProdutividade[] {
  return itens.map((p) => ({
    indicador: p.indicador,
    titulo: TITULO_PRODUTIVIDADE[p.indicador],
    valor: p.situacao === 'sem_dado' || p.valor === null ? VALOR_SEM_DADO : valorProdutividade(p.indicador, p.valor),
    meta: p.meta === null ? null : textoDaMeta(p.indicador, p.meta),
    ponto: p.situacao === 'dentro' ? 'dentro' : p.situacao === 'fora' ? 'fora' : null,
  }));
}

/** Leitura do card no TalkBack: o ponto vira palavra ("dentro da meta", "fora da meta"). */
export function leituraDoCardProdutividade(c: CardProdutividade): string {
  const ponto = c.ponto === 'dentro' ? 'dentro da meta' : c.ponto === 'fora' ? 'fora da meta' : null;
  return [c.titulo, c.valor === VALOR_SEM_DADO ? 'sem dado' : c.valor, ponto, c.meta].filter(Boolean).join(', ');
}

// ---------- linha de cima ----------

/**
 * Dias úteis à direita da linha do período (RN-CORE-41, D1): "DU 9 de 20 · 12 restantes" com hoje dentro; "DU — de 20 · 11
 * restantes" em dia não útil; período encerrado ou futuro: "20 dias úteis".
 */
export function textoDosDiasUteis(cal: CalendarioPeriodo, i: { de: string; ate: string }, hoje: string): string {
  const dentro = i.de <= hoje && hoje <= i.ate;
  if (!dentro) return cal.du_total === 1 ? '1 dia útil' : `${cal.du_total} dias úteis`;
  const restantes = cal.du_restantes === 1 ? '1 restante' : `${cal.du_restantes} restantes`;
  return `DU ${cal.du_hoje ?? '—'} de ${cal.du_total} · ${restantes}`;
}
