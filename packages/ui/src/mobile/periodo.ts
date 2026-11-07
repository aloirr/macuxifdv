/**
 * Parte PURA do filtro de período da lista de Pedidos (T-0090, modelo A aprovado; referência
 * docs/produto/referencias/R-20261106-064752-alexandre-filtro-periodo.png): botão de filtro com selo, etiqueta removível e
 * folha Período (atalhos e "Escolher dia, mês ou ano" com as abas Dia, Mês e Ano).
 * Só calendário de exibição (datas civis AAAA-MM-DD, AAAA-MM e AAAA já no fuso do tenant, que o módulo calcula). Sem
 * react-native e sem relógio: "hoje" chega por parâmetro. Qual pedido entra no período é regra do domain do módulo.
 */
import { MONTHS, WEEKDAYS } from '@macuxi/comum/fuso';

import { plural } from './text';

/** Escolha feita na parte "Escolher dia, mês ou ano" da folha. `valor`: AAAA-MM-DD, AAAA-MM ou AAAA. */
export type TipoEscolhaPeriodo = 'dia' | 'mes' | 'ano';
export interface EscolhaPeriodo {
  tipo: TipoEscolhaPeriodo;
  valor: string;
}

/** Iniciais da semana no cabeçalho do calendário, de domingo a sábado. */
export const INICIAIS_SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;
/** Meses abreviados da grade Mês. */
export const MESES_ABREVIADOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

function partesDoMes(mes: string): { ano: number; m: number } {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  return { ano: a, m };
}

/** Mês ±n (AAAA-MM). */
export function deslocarMes(mes: string, passo: number): string {
  const { ano, m } = partesDoMes(mes);
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * Semanas do mês para o calendário (domingo a sábado): cada semana tem 7 posições, com `null` antes do dia 1 e depois do
 * último dia. 4 a 6 semanas.
 */
export function gradeDoMes(mes: string): Array<Array<string | null>> {
  const { ano, m } = partesDoMes(mes);
  const primeiro = new Date(Date.UTC(ano, m - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  const celulas: Array<string | null> = [...Array.from({ length: primeiro }, () => null), ...Array.from({ length: total }, (_, i) => `${mes}-${pad(i + 1)}`)];
  while (celulas.length % 7 !== 0) celulas.push(null);
  const semanas: Array<Array<string | null>> = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

/** Os 12 meses (AAAA-MM) do ano, para a grade Mês. */
export function mesesDoAno(ano: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${ano}-${pad(i + 1)}`);
}

/** Anos da aba Ano, do atual para trás (padrão: 5 anos). */
export function anosAte(anoAtual: string, quantos = 5): string[] {
  const a = Number(anoAtual);
  return Array.from({ length: Math.max(1, quantos) }, (_, i) => String(a - i));
}

/** O dia, mês ou ano é depois de hoje (fica desabilitado na folha). Datas civis: a comparação é de texto. */
export function depoisDeHoje(e: EscolhaPeriodo, hoje: string): boolean {
  if (e.tipo === 'dia') return e.valor > hoje;
  if (e.tipo === 'mes') return e.valor > hoje.slice(0, 7);
  return e.valor > hoje.slice(0, 4);
}

/** "Novembro 2026" (cabeçalho do calendário). */
export function tituloDoMes(mes: string): string {
  const { ano, m } = partesDoMes(mes);
  const nome = MONTHS[m - 1] ?? '';
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} ${ano}`;
}

/** Leitura do dia no TalkBack: "sexta, 6 de novembro de 2026". */
export function leituraDoDia(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number) as [number, number, number];
  const semana = WEEKDAYS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? '';
  return `${semana.toLowerCase()}, ${d} de ${MONTHS[m - 1] ?? ''} de ${a}`;
}

/** Leitura do mês no TalkBack: "novembro de 2026". */
export function leituraDoMes(mes: string): string {
  const { ano, m } = partesDoMes(mes);
  return `${MONTHS[m - 1] ?? ''} de ${ano}`;
}

/** Texto do selo do botão de filtro: null sem filtro; acima de 9, "9+". */
export function textoDoSelo(contagem: number): string | null {
  if (!Number.isFinite(contagem) || contagem <= 0) return null;
  return contagem > 9 ? '9+' : String(Math.trunc(contagem));
}

/** Leitura do botão de filtro: "Filtrar, 1 filtro ativo" · "Filtrar". */
export function leituraDoBotaoFiltro(rotulo: string, contagem: number): string {
  if (!Number.isFinite(contagem) || contagem <= 0) return rotulo;
  return `${rotulo}, ${plural(Math.trunc(contagem), 'filtro ativo', 'filtros ativos')}`;
}

/** Aba que a parte "Escolher dia, mês ou ano" abre: a da escolha atual; sem escolha, Mês. */
export function abaInicial(escolha: EscolhaPeriodo | null | undefined): TipoEscolhaPeriodo {
  return escolha?.tipo ?? 'mes';
}

/** Mês que o calendário (aba Dia) mostra ao abrir: o do dia escolhido; senão, o de hoje. */
export function mesInicial(escolha: EscolhaPeriodo | null | undefined, hoje: string): string {
  if (escolha?.tipo === 'dia' || escolha?.tipo === 'mes') return escolha.valor.slice(0, 7);
  return hoje.slice(0, 7);
}

/** Ano que a grade Mês mostra ao abrir: o da escolha; senão, o de hoje. */
export function anoInicial(escolha: EscolhaPeriodo | null | undefined, hoje: string): string {
  return (escolha?.valor ?? hoje).slice(0, 4);
}

/** A célula está marcada: o dia escolhido, o mês escolhido ou o ano escolhido. */
export function celulaMarcada(celula: EscolhaPeriodo, escolha: EscolhaPeriodo | null | undefined): boolean {
  return Boolean(escolha && escolha.tipo === celula.tipo && escolha.valor === celula.valor);
}

// ---------- comportamento da folha (puro; a `FolhaPeriodo` só executa o resultado) ----------

/** Parte visível da folha: a lista de atalhos ou "Escolher dia, mês ou ano" (abas Dia, Mês e Ano). */
export type ModoFolhaPeriodo = 'atalhos' | 'escolher';

export interface EstadoFolhaPeriodo {
  modo: ModoFolhaPeriodo;
  aba: TipoEscolhaPeriodo;
  /** Mês mostrado no calendário da aba Dia (AAAA-MM). */
  mesVisto: string;
  /** Ano mostrado na grade da aba Mês (AAAA). */
  anoVisto: string;
}

/** Estado ao abrir: com dia, mês ou ano em vigor, abre direto na aba dele; senão, nos atalhos. */
export function estadoAoAbrirFolha(escolha: EscolhaPeriodo | null | undefined, hoje: string): EstadoFolhaPeriodo {
  return { modo: escolha ? 'escolher' : 'atalhos', aba: abaInicial(escolha), mesVisto: mesInicial(escolha, hoje), anoVisto: anoInicial(escolha, hoje) };
}

export type EventoFolhaPeriodo =
  | { tipo: 'atalho'; id: string }
  | { tipo: 'abrirEscolha' }
  | { tipo: 'voltar' }
  | { tipo: 'aba'; aba: TipoEscolhaPeriodo }
  | { tipo: 'mesVisto'; passo: -1 | 1 }
  | { tipo: 'anoVisto'; passo: -1 | 1 }
  | { tipo: 'celula'; escolha: EscolhaPeriodo }
  | { tipo: 'limpar' };

export interface ResultadoFolhaPeriodo {
  estado: EstadoFolhaPeriodo;
  /** Atalho a aplicar (`onAtalho`). */
  atalho?: string;
  /** Dia, mês ou ano a aplicar (`onEscolher`). */
  escolha?: EscolhaPeriodo;
  /** Voltar ao padrão (`onLimpar`). */
  limpar?: boolean;
  /** Fechar a folha (`onFechar`) depois de aplicar. */
  fechar: boolean;
}

/**
 * O que cada toque na folha faz (T-0090, critério 2): atalho aplica e fecha; "Escolher dia, mês ou ano" abre as abas (na
 * do período em vigor; sem ele, Mês); dia/mês/ano aplica e fecha (o que é depois de hoje não aplica); "Limpar" volta ao
 * padrão e a folha fica aberta, nos atalhos. As setas não passam do mês/ano de hoje.
 */
export function eventoDaFolha(estado: EstadoFolhaPeriodo, evento: EventoFolhaPeriodo, hoje: string): ResultadoFolhaPeriodo {
  switch (evento.tipo) {
    case 'atalho':
      return { estado, atalho: evento.id, fechar: true };
    case 'abrirEscolha':
      return { estado: { ...estado, modo: 'escolher' }, fechar: false };
    case 'voltar':
      return { estado: { ...estado, modo: 'atalhos' }, fechar: false };
    case 'aba':
      return { estado: { ...estado, aba: evento.aba }, fechar: false };
    case 'mesVisto': {
      const novo = deslocarMes(estado.mesVisto, evento.passo);
      return { estado: novo > hoje.slice(0, 7) ? estado : { ...estado, mesVisto: novo }, fechar: false };
    }
    case 'anoVisto': {
      const novo = String(Number(estado.anoVisto) + evento.passo);
      return { estado: novo > hoje.slice(0, 4) ? estado : { ...estado, anoVisto: novo }, fechar: false };
    }
    case 'celula':
      if (depoisDeHoje(evento.escolha, hoje)) return { estado, fechar: false };
      return { estado, escolha: evento.escolha, fechar: true };
    case 'limpar':
      return { estado: { ...estado, modo: 'atalhos' }, limpar: true, fechar: false };
  }
}
