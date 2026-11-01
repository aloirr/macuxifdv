/**
 * Rota do dia (desenho T-0016 §4): status das paradas, agenda por frequência e cópia de rota.
 * Funções puras sobre as linhas locais (`rota_parada` ⊕ `visita` já com a sobreposição da fila).
 */
import { diffDays } from '@macuxi/comum';
import { autoCheckoutAt } from './visit';

export type StatusDaParada = 'feita' | 'em_atendimento' | 'proxima' | 'pendente';

export interface ParadaLike {
  id: string;
  cliente_id: string;
  sequencia: number;
  data: string;
}

export interface VisitaDaParada {
  id: string;
  cliente_id: string;
  rota_parada_id?: string | null;
  data_local: string;
  checkin_em: string;
  checkout_em?: string | null;
}

/**
 * Lista + mapa: ordena pela sequência e dá o status de cada parada.
 * - visita da parada (pelo id da parada ou, na falta, pelo cliente no mesmo dia) com checkout → `feita`;
 * - check-in aberto → `em_atendimento`; se a virada do dia (RN-CORE-11) já passou, o atendimento foi fechado
 *   sozinho e a parada conta como `feita`;
 * - a primeira parada sem visita é a `proxima`; as demais, `pendente`.
 * A visita do aparelho (fila) prevalece: passe as linhas já sobrepostas por `aplicarPendentesVisita`.
 */
export function statusDasParadas<P extends ParadaLike>(
  paradas: P[],
  visitas: VisitaDaParada[],
  agora: Date,
  fuso: string,
): Array<P & { status: StatusDaParada; visita_id: string | null }> {
  const porParada = new Map<string, VisitaDaParada>();
  const porClienteDia = new Map<string, VisitaDaParada>();
  for (const v of [...visitas].sort((a, b) => a.checkin_em.localeCompare(b.checkin_em))) {
    if (v.rota_parada_id) porParada.set(v.rota_parada_id, v);
    // por cliente+dia só a visita SEM parada (visita extra): a ligada a outra parada não marca esta
    else porClienteDia.set(`${v.cliente_id}|${v.data_local}`, v);
  }
  let proximaAtribuida = false;
  return [...paradas]
    .sort((a, b) => a.sequencia - b.sequencia)
    .map((p) => {
      const v = porParada.get(p.id) ?? porClienteDia.get(`${p.cliente_id}|${p.data}`);
      let status: StatusDaParada;
      if (v) {
        const aberta = !v.checkout_em && agora.getTime() < Date.parse(autoCheckoutAt(v.checkin_em, fuso));
        status = aberta ? 'em_atendimento' : 'feita';
      } else if (!proximaAtribuida) {
        status = 'proxima';
        proximaAtribuida = true;
      } else status = 'pendente';
      return { ...p, status, visita_id: v?.id ?? null };
    });
}

export interface CarteiraAgendaLike {
  cliente_id: string;
  usuario_id: string;
  inicio?: string | null;
  fim?: string | null;
  frequencia_semanas?: number | null;
  /** 1 = segunda … 7 = domingo (ISO). */
  dia_semana?: number | null;
}

function somarDias(isoDate: string, dias: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de uma data. */
function segundaDa(isoDate: string): string {
  const dow = new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return somarDias(isoDate, -((dow + 6) % 7));
}

/**
 * Agenda por frequência (RF-CORE-05): paradas da `semana` (data de uma segunda-feira) de cada vínculo da carteira
 * com frequência (1, 2 ou 4 semanas) e dia da semana. A cadência de 2 e 4 semanas conta a partir da semana do
 * `inicio` da vigência (sem `inicio`, de uma âncora fixa). Fora da vigência não gera parada.
 */
export function gerarParadasPorFrequencia(carteira: CarteiraAgendaLike[], semana: string): Array<{ usuario_id: string; cliente_id: string; data: string }> {
  const segunda = segundaDa(semana);
  const ancora = '1970-01-05'; // uma segunda-feira
  const gerar = carteira.flatMap((c) => {
    const freq = c.frequencia_semanas;
    const dia = c.dia_semana;
    if (!freq || !dia || dia < 1 || dia > 7) return [];
    const data = somarDias(segunda, dia - 1);
    if (c.inicio && data < c.inicio) return [];
    if (c.fim && data > c.fim) return [];
    const semanas = Math.floor(diffDays(segundaDa(c.inicio ?? ancora), segunda) / 7);
    if (semanas < 0 || semanas % freq !== 0) return [];
    return [{ usuario_id: c.usuario_id, cliente_id: c.cliente_id, data }];
  });
  // ordem estável: usuário, data; a ordem recebida desempata
  return gerar.map((g, i) => ({ g, i })).sort((a, b) => a.g.usuario_id.localeCompare(b.g.usuario_id) || a.g.data.localeCompare(b.g.data) || a.i - b.i).map((x) => x.g);
}

export interface ParadaCopiavel {
  cliente_id: string;
  sequencia: number;
  janela_inicio?: string | null;
  janela_fim?: string | null;
}

/** Copia as paradas para outras datas; onde já há visita feita a rota não é substituída (devolve em `ignoradas`). */
export function copiarRota(
  paradas: ParadaCopiavel[],
  datas: string[],
  datasComVisita: ReadonlySet<string> = new Set(),
): { copiadas: Array<{ data: string; paradas: ParadaCopiavel[] }>; ignoradas: string[] } {
  const copiadas: Array<{ data: string; paradas: ParadaCopiavel[] }> = [];
  const ignoradas: string[] = [];
  const ordenadas = [...paradas].sort((a, b) => a.sequencia - b.sequencia);
  for (const data of new Set(datas)) {
    if (datasComVisita.has(data)) ignoradas.push(data);
    else copiadas.push({ data, paradas: ordenadas.map((p, i) => ({ ...p, sequencia: i + 1 })) });
  }
  return { copiadas, ignoradas };
}
