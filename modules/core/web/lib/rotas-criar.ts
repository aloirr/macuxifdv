/**
 * Criar rota por proximidade no BKO (T-0191; RN-CORE-76; spec docs/design/rotas-criar/spec.md §3 e §4): estados do diálogo,
 * textos dos alertas, linhas da lista de dias da prévia e corpo do lote. Puro: sem React nem rede.
 */
import type { EnderecoBase, ModoConflitoRota, PreviaRotaResposta, RotasLista, RouteDay, SalvarRotasLote } from '../../contracts';
import { CALENDARIO_PADRAO, classificarDias, rotaProtegida, routeDistanceKm, totaisDaPrevia, type GeoPoint, type RotaExistente } from '../../domain';
import { diaPendente } from './rotas-api';
import { type CalendarioDaTela, type DraftStop, type PeriodRange } from './routes';

/** As rotas que o período já tem, no formato do domínio: protegida = origem ERP ou visita feita ou em atendimento (RN-CORE-76, D4). */
export function existentesDoPeriodo(itens: RotasLista['itens']): RotaExistente[] {
  return itens
    .filter((i) => i.rota !== null)
    .map((i) => ({
      data: i.data,
      visitas: i.paradas.length,
      protegida: rotaProtegida({ origem: i.rota!.origem, com_visita: i.paradas.some((p) => p.status === 'feita' || p.status === 'em_atendimento') }),
    }));
}

export type EstadoDoDialogo =
  | { tipo: 'carregando' }
  | { tipo: 'sem_base' }
  | { tipo: 'carteira_vazia' }
  | { tipo: 'passado' }
  | { tipo: 'pronto'; conflito: null }
  | { tipo: 'pronto'; conflito: { total: number; substituiveis: number } };

/** Estado do diálogo "Criar rota" (spec §3.1), na ordem em que o que bloqueia aparece. */
export function estadoDoDialogo(e: {
  carteira: number | null;
  base: EnderecoBase | null | undefined;
  existentes: readonly RotaExistente[] | null;
  calendario: CalendarioDaTela | null;
  range: PeriodRange;
  hoje: string;
}): EstadoDoDialogo {
  if (e.carteira === null || e.base === undefined || e.existentes === null) return { tipo: 'carregando' };
  if (e.range.to < e.hoje) return { tipo: 'passado' };
  if (e.carteira === 0) return { tipo: 'carteira_vazia' };
  if (e.base === null) return { tipo: 'sem_base' };
  const futuras = e.existentes.filter((r) => r.data >= e.hoje && r.data >= e.range.from && r.data <= e.range.to);
  if (futuras.length === 0) return { tipo: 'pronto', conflito: null };
  const { substituidas } = classificarDias({
    de: e.range.from,
    ate: e.range.to,
    hoje: e.hoje,
    dias_uteis_semana: e.calendario?.dias_uteis_semana ?? CALENDARIO_PADRAO.dias_uteis_semana,
    feriados: e.calendario?.feriados ?? [],
    existentes: futuras,
    modo: 'substituir',
  });
  return { tipo: 'pronto', conflito: { total: futuras.length, substituiveis: substituidas } };
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/** Textos do conflito (spec §3.1): no modo Dia o texto fala do dia; no resto, de quantos dias. */
export function textosDoConflito(modeDia: boolean, c: { total: number; substituiveis: number }) {
  if (modeDia) return { aviso: 'Este dia já tem rota.', manter: 'Manter a rota', substituir: 'Substituir a rota', apoio: null as string | null };
  const ficam = c.total - c.substituiveis;
  return {
    aviso: `Já tem rota em ${c.total} ${plural(c.total, 'dia', 'dias')}.`,
    manter: 'Criar só nos dias sem rota',
    substituir: `Substituir ${c.substituiveis} ${plural(c.substituiveis, 'rota', 'rotas')}`,
    apoio: ficam > 0 ? `${ficam} com visita feita ou do ERP ${plural(ficam, 'fica', 'ficam')}.` : null,
  };
}

export const textoForaSemCoordenada = (n: number) => (n === 1 ? '1 cliente ficou fora: sem coordenada.' : `${n} clientes ficaram fora: sem coordenada.`);
export const textoForaLimite = (n: number) => (n === 1 ? '1 cliente não coube no limite do dia.' : `${n} clientes não couberam no limite do dia.`);

/** "19 rotas · 209 visitas · 988 km" do cabeçalho da prévia. */
export function resumoDaPrevia(t: { rotas: number; visitas: number; km: number }): string {
  return `${t.rotas} ${plural(t.rotas, 'rota', 'rotas')} · ${t.visitas} ${plural(t.visitas, 'visita', 'visitas')} · ${Math.round(t.km).toLocaleString('pt-BR')} km`;
}

/** Totais do cabeçalho: os que a API devolveu; depois que o editor mexe num dia, refeitos pela mesma função do domain (`totaisDaPrevia`). */
export function totaisDaPreviaAberta(totaisDaApi: PreviaRotaResposta['totais'], dias: readonly RouteDay[], editado: boolean): PreviaRotaResposta['totais'] {
  return editado ? totaisDaPrevia(dias.map((d) => ({ visitas: d.stops.length, km: d.total_km }))) : totaisDaApi;
}

export type LinhaDaPrevia = { tipo: 'dia'; data: string } | { tipo: 'mantida'; data: string; visitas: number } | { tipo: 'feriado'; data: string };

/** A lista de dias do quadro da direita: dias com rota, mantidos e feriados, em ordem de data (mantida e feriado não abrem o editor). */
export function linhasDaPrevia(dias: readonly RouteDay[], p: Pick<PreviaRotaResposta, 'mantidas' | 'feriados'>): LinhaDaPrevia[] {
  const linhas: LinhaDaPrevia[] = [
    ...dias.map((d) => ({ tipo: 'dia' as const, data: d.date })),
    ...p.mantidas.map((m) => ({ tipo: 'mantida' as const, data: m.data, visitas: m.visitas })),
    ...p.feriados.map((data) => ({ tipo: 'feriado' as const, data })),
  ];
  return linhas.sort((a, b) => a.data.localeCompare(b.data));
}

/** Dia da prévia depois do editor: as paradas do rascunho, na ordem, com o km refeito a partir da base. */
export function diaComRascunho(dia: RouteDay, rascunho: readonly DraftStop[], inicio: GeoPoint): RouteDay {
  const paradas = rascunho.map((s) => ({ id: s.key, customer: s.customer, window_start: s.window_start, window_end: s.window_end }));
  return diaPendente(dia, paradas, routeDistanceKm(inicio, rascunho.map((s) => ({ lat: s.customer.lat, lng: s.customer.lng }))));
}

/** Corpo do `POST rotas/lote`: um id por dia (gerado uma vez, para o reenvio não duplicar) e só os dias que ficaram com paradas. */
export function corpoDoLote(usuarioId: string, modo: ModoConflitoRota, dias: readonly RouteDay[], ids: Record<string, string>): SalvarRotasLote {
  return {
    usuario_id: usuarioId,
    modo,
    rotas: dias
      .filter((d) => d.stops.length > 0)
      .map((d) => ({
        id: ids[d.date]!,
        data: d.date,
        paradas: d.stops.map((s) => ({ cliente_id: s.customer.id, janela_inicio: s.window_start || null, janela_fim: s.window_end || null })),
      })),
  };
}
