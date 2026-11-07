/**
 * Filtro de período da lista de Pedidos, modelo A (T-0090, RF-VEN-05): atalhos Hoje · Ontem · Esta semana · Este mês (padrão)
 * · Mês passado · Este ano, mais "Escolher dia, mês ou ano". Aqui só a regra: qual período cada atalho vale, qual atalho está
 * em vigor, a etiqueta, a contagem do selo e quando a folha avisa que a consulta vai ao servidor. Funções puras, sem relógio:
 * "agora" e o fuso chegam por parâmetro. A folha e o comportamento dos toques são do kit (`@macuxi/ui/mobile`).
 */
import { deslocarPeriodo, nomeDoMes, periodoDe, periodoForaDaJanela, periodoParcialNaJanela, rotuloDoPeriodo, type Periodo } from './busca-periodo';

export type AtalhoDePeriodo = 'hoje' | 'ontem' | 'esta_semana' | 'este_mes' | 'mes_passado' | 'este_ano';

/** Ordem e rótulos da folha (ids sem `mes`/`ano`, que colidem com os testIDs das abas). */
export const ATALHOS_DE_PERIODO: ReadonlyArray<{ id: AtalhoDePeriodo; rotulo: string }> = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'ontem', rotulo: 'Ontem' },
  { id: 'esta_semana', rotulo: 'Esta semana' },
  { id: 'este_mes', rotulo: 'Este mês' },
  { id: 'mes_passado', rotulo: 'Mês passado' },
  { id: 'este_ano', rotulo: 'Este ano' },
];

/** O padrão da tela e o que "Limpar" restaura. */
export const ATALHO_PADRAO: AtalhoDePeriodo = 'este_mes';

export function ehAtalhoDePeriodo(id: string): id is AtalhoDePeriodo {
  return ATALHOS_DE_PERIODO.some((a) => a.id === id);
}

/** O período que o atalho vale hoje, no fuso do tenant. */
export function periodoDoAtalho(id: AtalhoDePeriodo, agora: string | Date, tz: string): Periodo {
  switch (id) {
    case 'hoje':
      return periodoDe('dia', agora, tz);
    case 'ontem':
      return deslocarPeriodo(periodoDe('dia', agora, tz), -1);
    case 'esta_semana':
      return periodoDe('semana', agora, tz);
    case 'este_mes':
      return periodoDe('mes', agora, tz);
    case 'mes_passado':
      return deslocarPeriodo(periodoDe('mes', agora, tz), -1);
    case 'este_ano':
      return periodoDe('ano', agora, tz);
  }
}

/** O atalho em vigor (com ✓ na folha); null quando vale um dia, mês ou ano que não é nenhum atalho. */
export function atalhoEmVigor(p: Periodo, agora: string | Date, tz: string): AtalhoDePeriodo | null {
  return ATALHOS_DE_PERIODO.find((a) => {
    const v = periodoDoAtalho(a.id, agora, tz);
    return v.tipo === p.tipo && v.valor === p.valor;
  })?.id ?? null;
}

/** A escolha de dia, mês ou ano em vigor (a folha abre direto na aba dela); null quando vale um atalho. */
export function escolhaEmVigor(p: Periodo, agora: string | Date, tz: string): { tipo: 'dia' | 'mes' | 'ano'; valor: string } | null {
  if (p.tipo === 'semana' || atalhoEmVigor(p, agora, tz)) return null;
  return { tipo: p.tipo, valor: p.valor };
}

/** Dia, mês ou ano tocado na folha vira período. */
export function periodoDaEscolha(e: { tipo: 'dia' | 'mes' | 'ano'; valor: string }): Periodo {
  return { tipo: e.tipo, valor: e.valor };
}

/** O período em vigor é o padrão (Este mês): não conta como filtro. */
export function ehPeriodoPadrao(p: Periodo, agora: string | Date, tz: string): boolean {
  return atalhoEmVigor(p, agora, tz) === ATALHO_PADRAO;
}

/** Texto da etiqueta removível: o atalho ("Ontem"), "Seg, 02/11/2026", "Setembro de 2026" ou "2025". */
export function textoDaEtiquetaDoPeriodo(p: Periodo, agora: string | Date, tz: string): string {
  const atalho = atalhoEmVigor(p, agora, tz);
  if (atalho) return ATALHOS_DE_PERIODO.find((a) => a.id === atalho)!.rotulo;
  if (p.tipo === 'mes') {
    const [a, m] = p.valor.split('-').map(Number) as [number, number];
    return `${nomeDoMes(m)} de ${a}`;
  }
  return rotuloDoPeriodo(p);
}

/** Número do selo do botão: período fora do padrão e vendedor escolhido (Gestão). */
export function contarFiltros(o: { periodo: Periodo; agora: string | Date; tz: string; vendedorEscolhido: boolean }): number {
  return (ehPeriodoPadrao(o.periodo, o.agora, o.tz) ? 0 : 1) + (o.vendedorEscolhido ? 1 : 0);
}

export const AJUDA_FORA_DA_JANELA = 'Fora dos 90 dias do aparelho: busca no servidor, precisa de sinal';

/**
 * O aviso dos 90 dias só existe quando o período sai da janela do aparelho (inteiro ou em parte): aí a consulta vai ao
 * servidor, com sinal. Dentro da janela, nada é mostrado.
 */
export function ajudaDaJanela(p: Periodo, agora: string | Date, tz: string): string | null {
  return periodoForaDaJanela(p, agora, tz) || periodoParcialNaJanela(p, agora, tz) ? AJUDA_FORA_DA_JANELA : null;
}
