/**
 * RN-CORE-43 DU no Início (T-0170; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §5). "DU n de N" pela função única
 * `diasUteisDoPeriodo` de `@macuxi/comum`, no calendário do tenant (`metas.dias_uteis_semana`, `calendarioDoTenant`).
 * D3 aprovada (13/11/2026): os feriados nacionais contam. Por isso a lista de feriados vai SEMPRE informada (`[]` quando o
 * tenant não tem nenhum): lista omitida faria só a semana contar. A mesma troca no `feriadosDoCalendario` da Meta/dia
 * (`meta-do-dia.ts`) entra na costura, para o DU e a Meta/dia contarem igual.
 */
import { diasUteisDoPeriodo, ehDiaUtilDoTenant, yearMonthOf } from '@macuxi/comum/calendar';
import type { CalendarioTenant } from '../meta-do-dia';

export interface DuDoMes {
  /** Dias úteis do mês até hoje, contando hoje; `null` quando hoje não é dia útil ("Não é dia útil"). */
  atual: number | null;
  /** Dias úteis do mês. */
  total: number;
}

/** `hoje` = data civil AAAA-MM-DD no fuso do tenant. */
export function duDoMes(hoje: string, calendario: CalendarioTenant): DuDoMes {
  const feriados = calendario.feriados ?? [];
  const { total, elapsed } = diasUteisDoPeriodo(yearMonthOf(hoje), hoje, feriados, calendario.dias_uteis_semana);
  return { atual: ehDiaUtilDoTenant(hoje, feriados, calendario.dias_uteis_semana) ? elapsed + 1 : null, total };
}
