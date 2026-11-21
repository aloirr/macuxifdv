/**
 * RN-CORE-76 (T-0191): criar a rota do período por proximidade. Funções puras: a API de prévia e a de lote chamam a mesma conta.
 *
 * - Dias: a semana útil do tenant menos os feriados (nacionais e do tenant); domingo nunca entra, nem dia passado.
 * - Frequência (D1): a da Carteira (1, 2 ou 4 semanas); sem frequência = semanal. Cadência de `ehSemanaDeVisita` (agenda.ts).
 * - Dia da visita: o cliente com `dia_semana` fica nesse dia (se o dia não estiver livre, cai no dia que a proximidade escolher);
 *   os demais vão para o dia cujo grupo está mais perto (sementes espalhadas e agrupamento pelo centro do dia).
 * - Limite (D2): `visitas_dia` por dia; o excedente vai para `fora_limite`. Cliente sem coordenada vai para `fora_sem_coordenada`.
 * - Conflito (D4): `so_vazios` mantém todo dia que já tem rota; `substituir` troca o que não é protegido (visita feita ou em
 *   atendimento, ou `origem = erp`).
 * - Ordem de cada dia: `optimizeRoute` (vizinho mais próximo + 2-opt) a partir da base; sem base, o km conta do 1º cliente.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { ehSemanaDeVisita, segundaDa } from './agenda';
import { haversineKm, optimizeRoute, routeDistanceKm, type GeoPoint } from './route';

export interface ClienteParaRota {
  cliente_id: string;
  lat: number | null;
  lng: number | null;
  /** 1, 2 ou 4; ausente ou outro valor = semanal (D1). */
  frequencia_semanas?: number | null;
  /** 1 = segunda … 7 = domingo (ISO), como na Carteira. */
  dia_semana?: number | null;
  /** Vigência do vínculo na carteira (AAAA-MM-DD). */
  inicio?: string | null;
  fim?: string | null;
}

export interface RotaExistente {
  data: string;
  visitas: number;
  protegida: boolean;
}

export interface EntradaCriarRota {
  de: string;
  ate: string;
  /** Hoje no fuso do tenant: o dia de hoje entra, os anteriores não. */
  hoje: string;
  base: GeoPoint | null;
  clientes: readonly ClienteParaRota[];
  /** 0 = domingo … 6 = sábado (`metas.dias_uteis_semana`). */
  dias_uteis_semana: readonly number[];
  /** Feriados do tenant; os nacionais entram sempre. */
  feriados: readonly string[];
  /** Visitas por dia (inteiro ≥ 1). */
  limite: number;
  existentes: readonly RotaExistente[];
  modo: 'so_vazios' | 'substituir';
}

export interface DiaCriado {
  data: string;
  cliente_ids: string[];
  km: number;
}

export interface SaidaCriarRota {
  dias: DiaCriado[];
  fora_sem_coordenada: string[];
  fora_limite: string[];
  mantidas: Array<{ data: string; visitas: number; protegida: boolean }>;
  feriados: string[];
}

/** RN-CORE-76 (D4): a rota que nunca é substituída: do ERP ou com visita feita ou em atendimento no dia. */
export function rotaProtegida(r: { origem: string; com_visita: boolean }): boolean {
  return r.origem === 'erp' || r.com_visita;
}

/** RN-CORE-76 (D2): a meta `visitas_dia` está em décimos (110 = 11,0 visitas); o limite é o inteiro mais próximo, no mínimo 1. */
export function limiteVisitasPorDia(decimos: number): number {
  return Math.max(1, Math.round(decimos / 10));
}

const diaDaSemana = (data: string): number => new Date(`${data}T12:00:00Z`).getUTCDay();

/** RN-CORE-76: o predicado único do dia de rota: dia da semana útil do tenant, nunca domingo (feriado é outro estado). */
export function diaDeSemanaUtil(data: string, dias: readonly number[]): boolean {
  const dow = diaDaSemana(data);
  return dow !== 0 && dias.includes(dow);
}

/** RN-CORE-76: o que cada dia do período é (livre para criar, mantido, feriado) e quantas rotas o modo troca. */
export function classificarDias(e: Pick<EntradaCriarRota, 'de' | 'ate' | 'hoje' | 'dias_uteis_semana' | 'feriados' | 'existentes' | 'modo'>) {
  const existentes = new Map(e.existentes.map((r) => [r.data, r]));
  const livres: string[] = [];
  const mantidas: SaidaCriarRota['mantidas'] = [];
  const feriados: string[] = [];
  let substituidas = 0;
  const inicio = e.de > e.hoje ? e.de : e.hoje;
  for (let d = inicio; d <= e.ate; d = somarDiasCivis(d, 1)) {
    const existente = existentes.get(d);
    const util = diaDeSemanaUtil(d, e.dias_uteis_semana);
    const feriado = util && ehFeriado(d, e.feriados);
    if (existente) {
      if (e.modo === 'substituir' && !existente.protegida && util && !feriado) {
        livres.push(d);
        substituidas += 1;
      } else mantidas.push({ data: d, visitas: existente.visitas, protegida: existente.protegida });
    } else if (feriado) feriados.push(d);
    else if (util) livres.push(d);
  }
  return { livres, mantidas, feriados, substituidas };
}

const temPonto = (c: GeoPoint): c is { lat: number; lng: number } => c.lat !== null && c.lng !== null;

/** Média dos pontos que têm coordenada; `null` sem nenhum. */
export function centroDosPontos(pontos: readonly GeoPoint[]): GeoPoint | null {
  const p = pontos.filter(temPonto);
  if (p.length === 0) return null;
  return { lat: p.reduce((s, x) => s + x.lat, 0) / p.length, lng: p.reduce((s, x) => s + x.lng, 0) / p.length };
}

const menorDistancia = (p: GeoPoint, centros: readonly GeoPoint[]): number => centros.reduce((m, c) => Math.min(m, haversineKm(p, c)), Infinity);

/** Distribui os clientes de uma semana pelos dias livres dela (dia fixo primeiro, depois a proximidade) respeitando o limite. */
function distribuirSemana(dias: readonly string[], segunda: string, clientes: readonly ClienteParaRota[], base: GeoPoint | null, limite: number): { porDia: Map<string, ClienteParaRota[]>; excedente: ClienteParaRota[] } {
  const porDia = new Map<string, ClienteParaRota[]>(dias.map((d) => [d, []]));
  const excedente: ClienteParaRota[] = [];
  const livres: ClienteParaRota[] = [];
  const dist = (c: GeoPoint) => (base ? haversineKm(base, c) : 0);
  // dia fixo (Carteira): fica nele se o dia estiver livre; senão a proximidade escolhe
  const fixos = [...clientes].sort((a, b) => dist(a) - dist(b) || a.cliente_id.localeCompare(b.cliente_id));
  for (const c of fixos) {
    const dia = c.dia_semana && c.dia_semana >= 1 && c.dia_semana <= 7 ? somarDiasCivis(segunda, c.dia_semana - 1) : null;
    const lista = dia ? porDia.get(dia) : undefined;
    if (!lista) livres.push(c);
    else if (lista.length < limite) lista.push(c);
    else excedente.push(c);
  }
  // sementes: cada dia ainda vazio recebe o cliente mais distante dos centros já formados
  let pool = livres;
  for (const d of dias) {
    if (pool.length === 0) break;
    if (porDia.get(d)!.length > 0) continue;
    const centros = dias.map((x) => centroDosPontos(porDia.get(x)!)).filter((x): x is GeoPoint => x !== null);
    const ref = centros.length ? centros : base ? [base] : [];
    const escolhido = pool.reduce((m, c) => {
      const dm = ref.length ? menorDistancia(c, ref) : 0;
      return dm > m.dm + 1e-9 ? { c, dm } : m;
    }, { c: pool[0]!, dm: ref.length ? menorDistancia(pool[0]!, ref) : 0 }).c;
    porDia.get(d)!.push(escolhido);
    pool = pool.filter((c) => c !== escolhido);
  }
  // o resto vai, do mais perto ao mais longe de algum dia, para o dia mais próximo com vaga
  while (pool.length > 0) {
    const centros = dias.map((d) => ({ d, c: centroDosPontos(porDia.get(d)!) }));
    let melhor: { cli: ClienteParaRota; dia: string; dm: number } | null = null;
    for (const cli of pool) {
      for (const { d, c } of centros) {
        if (porDia.get(d)!.length >= limite) continue;
        const dm = c ? haversineKm(cli, c) : Infinity;
        if (!melhor || dm < melhor.dm - 1e-9) melhor = { cli, dia: d, dm };
      }
    }
    if (!melhor) {
      excedente.push(...pool);
      break;
    }
    porDia.get(melhor.dia)!.push(melhor.cli);
    pool = pool.filter((c) => c !== melhor!.cli);
  }
  return { porDia, excedente };
}

/**
 * RN-CORE-76: a carteira distribuída pelos dias do período, cada dia ordenado a partir da base. O limite `visitas_dia` vale só aqui, na prévia:
 * o lote (`POST rotas/lote`) não o revalida, porque a edição manual do editor vale (a pessoa pode passar do limite de propósito).
 */
export function criarRotasPorProximidade(e: EntradaCriarRota): SaidaCriarRota {
  const { livres, mantidas, feriados } = classificarDias(e);
  const limite = Math.max(1, Math.floor(e.limite));
  const clientes = [...e.clientes].sort((a, b) => a.cliente_id.localeCompare(b.cliente_id));
  const fora_sem_coordenada = clientes.filter((c) => !temPonto(c)).map((c) => c.cliente_id);
  const comPonto = clientes.filter(temPonto);

  // sem `inicio`, a cadência de 2 e 4 semanas é espalhada pela posição do cliente, para não juntar todos na mesma semana
  const deslocamento = new Map<string, number>();
  const freqDe = (c: ClienteParaRota) => (c.frequencia_semanas === 2 || c.frequencia_semanas === 4 ? c.frequencia_semanas : 1);
  for (const f of [1, 2, 4]) comPonto.filter((c) => freqDe(c) === f && !c.inicio).forEach((c, i) => deslocamento.set(c.cliente_id, i % f));

  const semanas = new Map<string, string[]>();
  for (const d of livres) semanas.set(segundaDa(d), [...(semanas.get(segundaDa(d)) ?? []), d]);

  const dias = new Map<string, ClienteParaRota[]>();
  const fora = new Set<string>();
  for (const [segunda, diasDaSemana] of semanas) {
    const daSemana = comPonto.filter((c) => ehSemanaDeVisita(segunda, freqDe(c), c.inicio, deslocamento.get(c.cliente_id) ?? 0));
    // a vigência do vínculo vale por dia: o dia fixo fora dela não conta, e a proximidade só usa os dias dentro dela
    const { porDia, excedente } = distribuirSemana(diasDaSemana, segunda, daSemana, e.base, limite);
    for (const [d, lista] of porDia) {
      // RN-CORE-04 (vigência): o dia fixo que cai fora da vigência da carteira naquele dia não entra na rota, porque a API recusaria a rota
      // inteira (cliente fora da carteira vigente na data). Não some em silêncio: o cliente volta na prévia do período em que a vigência o cobre.
      const dentro = lista.filter((c) => (!c.inicio || c.inicio <= d) && (!c.fim || c.fim >= d));
      if (dentro.length) dias.set(d, dentro);
    }
    for (const c of excedente) fora.add(c.cliente_id);
  }

  const saida: DiaCriado[] = [...dias.keys()].sort().map((data) => {
    const ordenados = optimizeRoute<ClienteParaRota>(e.base ?? { lat: null, lng: null }, dias.get(data)!);
    return { data, cliente_ids: ordenados.map((c) => c.cliente_id), km: routeDistanceKm(e.base ?? { lat: null, lng: null }, ordenados) };
  });
  return { dias: saida, fora_sem_coordenada, fora_limite: [...fora], mantidas, feriados };
}

/** RN-CORE-76 (D2): os totais do cabeçalho da prévia. O km soma o inteiro que cada linha de dia mostra (cabeçalho = soma das linhas); é a única regra do km total. */
export function totaisDaPrevia(dias: ReadonlyArray<{ visitas: number; km: number }>): { rotas: number; visitas: number; km: number } {
  const comRota = dias.filter((d) => d.visitas > 0);
  return { rotas: comRota.length, visitas: comRota.reduce((s, d) => s + d.visitas, 0), km: comRota.reduce((s, d) => s + Math.round(d.km), 0) };
}
