import { daysInMonth, type BusinessDays } from '@macuxi/comum';
import { situacaoDoPeriodo } from './apuracao';
import {
  computeIncentive,
  validateBands,
  validatePlanWeights,
  type IncentiveBand,
  type IncentivePlan,
  type KpiResultInput,
} from './incentive';

/** RN-CORE-29/30: plano de RV (nomes iguais ao contrato `plano-rv`). Indicadores = os da meta. */
export type IndicadorRv = 'venda_cents' | 'positivacao' | 'cobertura_pct' | 'visitas';
export type PerfilRv = 'vendedor' | 'promotor';

export interface FaixaRv {
  de_pct: number;
  modo: 'zero' | 'proporcional' | 'fixo';
  pagamento_pct: number;
}
export interface RegraRv {
  indicador: IndicadorRv;
  peso_pct: number;
  gatilho: boolean;
  faixas: FaixaRv[];
}
export interface PlanoRv {
  id: string;
  nome: string;
  /** AAAA-MM */
  vigencia_inicio: string;
  perfis: PerfilRv[];
  valor_maximo_cents: number;
  regras: RegraRv[];
}

export type SituacaoRv = 'parcial' | 'fechado';

const INDICADORES: IndicadorRv[] = ['venda_cents', 'positivacao', 'cobertura_pct', 'visitas'];
/** Venda e visitas seguem o ritmo dos dias úteis; positivação e cobertura pagam pelo realizado. */
const PROJETAVEL: Record<IndicadorRv, boolean> = { venda_cents: true, visitas: true, positivacao: false, cobertura_pct: false };
const MODO: Record<FaixaRv['modo'], IncentiveBand['mode']> = { zero: 'zero', proporcional: 'proportional', fixo: 'fixed' };

function faixasParaMotor(faixas: FaixaRv[]): IncentiveBand[] {
  return faixas.map((f) => ({ from_pct: f.de_pct, mode: MODO[f.modo], payout_pct: f.pagamento_pct }));
}

/** RN-CORE-30: erros em português (lista vazia = válido). */
export function validarPlanoRv(plano: PlanoRv): string[] {
  const erros: string[] = [];
  if (!Number.isInteger(plano.valor_maximo_cents) || plano.valor_maximo_cents <= 0) erros.push('O valor máximo da RV deve ser maior que zero.');
  if (plano.perfis.length === 0) erros.push('Informe ao menos um perfil para o plano.');
  if (plano.regras.length === 0) erros.push('Informe ao menos um indicador.');
  const vistos = new Set<string>();
  for (const r of plano.regras) {
    if (!INDICADORES.includes(r.indicador)) erros.push(`Indicador desconhecido: ${r.indicador}.`);
    if (vistos.has(r.indicador)) erros.push(`O indicador ${r.indicador} aparece mais de uma vez.`);
    vistos.add(r.indicador);
    if (r.gatilho) continue;
    const erroFaixas = validateBands(faixasParaMotor(r.faixas));
    if (erroFaixas) erros.push(`${r.indicador}: ${erroFaixas}`);
    for (const f of r.faixas) {
      if (f.de_pct < 0 || f.de_pct > 300 || f.pagamento_pct < 0 || f.pagamento_pct > 300) {
        erros.push(`${r.indicador}: faixas e pagamentos vão de 0% a 300%.`);
        break;
      }
    }
  }
  if (plano.regras.length > 0 && plano.regras.every((r) => r.gatilho)) erros.push('Informe ao menos um indicador que não seja gatilho.');
  const pesos = validatePlanWeights(plano.regras.map((r) => ({ weight_pct: r.peso_pct, is_trigger: r.gatilho })));
  if (!pesos.ok && plano.regras.some((r) => !r.gatilho)) erros.push(`Os pesos devem somar 100% (hoje somam ${pesos.sum}%).`);
  return erros;
}

/** Plano de maior início ≤ período para o perfil; o plano vale até o mês anterior ao próximo início. */
export function planoVigente(planos: PlanoRv[], periodo: string, perfil: PerfilRv): PlanoRv | null {
  let achado: PlanoRv | null = null;
  for (const p of planos) {
    if (!p.perfis.includes(perfil) || p.vigencia_inicio > periodo) continue;
    if (!achado || p.vigencia_inicio > achado.vigencia_inicio) achado = p;
  }
  return achado;
}

/** RN-CORE-30: o plano já valeu para algum mês fechado? (início ≤ mês fechado < início do próximo plano) */
export function planoJaValeuEmMesFechado(planos: PlanoRv[], plano: PlanoRv, mesesFechados: string[]): boolean {
  const proximos = planos.filter((p) => p.id !== plano.id && p.vigencia_inicio > plano.vigencia_inicio).map((p) => p.vigencia_inicio);
  const fim = proximos.length > 0 ? proximos.reduce((a, b) => (a < b ? a : b)) : null;
  return mesesFechados.some((m) => m >= plano.vigencia_inicio && (fim === null || m < fim));
}

/** RN-CORE-30: o plano `novo` passaria a valer sobre algum mês fechado que hoje já tem plano de um dos seus perfis? */
export function vigenciaReescreveMesFechado(planos: PlanoRv[], novo: PlanoRv, mesesFechados: string[]): boolean {
  const outros = planos.filter((p) => p.id !== novo.id);
  const proximos = outros.filter((p) => p.vigencia_inicio > novo.vigencia_inicio).map((p) => p.vigencia_inicio);
  const fim = proximos.length > 0 ? proximos.reduce((a, b) => (a < b ? a : b)) : null;
  return mesesFechados.some((m) => m >= novo.vigencia_inicio && (fim === null || m < fim) && novo.perfis.some((perfil) => planoVigente(outros, m, perfil) !== null));
}

/** RN-CORE-30: validação de criar/editar. `atual` = versão gravada (null se for novo). */
export function validarEdicaoPlanoRv(planos: PlanoRv[], atual: PlanoRv | null, novo: PlanoRv, mesesFechados: string[]): string[] {
  const erros = validarPlanoRv(novo);
  if (planos.some((p) => p.id !== novo.id && p.vigencia_inicio === novo.vigencia_inicio)) {
    erros.push('Já existe um plano com esse mês de início.');
  }
  if ((!atual || atual.vigencia_inicio !== novo.vigencia_inicio) && vigenciaReescreveMesFechado(planos, novo, mesesFechados)) {
    erros.push('Essa vigência mudaria um mês já fechado. Escolha o mês aberto ou um mês futuro como início.');
  }
  if (atual && planoJaValeuEmMesFechado(planos, atual, mesesFechados) && JSON.stringify(atual) !== JSON.stringify(novo)) {
    erros.push('Este plano já valeu para um mês fechado e não pode mudar. Crie uma versão nova com vigência a partir do mês aberto.');
  }
  return erros;
}

export interface LinhaRv {
  indicador: IndicadorRv;
  meta: number | null;
  realizado: number;
  atingimento_pct: number;
  projetado_pct: number;
  pagamento_pct: number;
  valor_cents: number;
  gatilho: boolean;
  /** null quando não é gatilho ou o gatilho está sem meta */
  gatilho_ok: boolean | null;
  sem_meta: boolean;
}
export interface RvDaPessoa {
  rv_cents: number;
  rv_bruta_cents: number;
  bloqueada_por: IndicadorRv[];
  indicadores: LinhaRv[];
}

/**
 * RN-CORE-29: RV de uma pessoa no mês. `parcial` paga pela projeção em dias úteis (venda e visitas);
 * `fechado` paga pelo realizado. Meta ausente ou ≤ 0 = sem meta (comum paga 0; gatilho não bloqueia).
 */
export function calcularRvDaPessoa(
  plano: PlanoRv,
  metas: Partial<Record<IndicadorRv, number>>,
  realizados: Partial<Record<IndicadorRv, number>>,
  dias: BusinessDays,
  situacao: SituacaoRv,
): RvDaPessoa {
  const incentivo: IncentivePlan = {
    max_amount_cents: plano.valor_maximo_cents,
    rules: plano.regras.map((r) => ({
      kpi_code: r.indicador,
      weight_pct: r.peso_pct,
      is_trigger: r.gatilho,
      bands: faixasParaMotor(r.faixas),
    })),
  };
  const entradas: KpiResultInput[] = [];
  for (const r of plano.regras) {
    const meta = metas[r.indicador];
    if (meta === undefined || meta <= 0) continue;
    entradas.push({
      kpi_code: r.indicador,
      direction: 'higher_is_better',
      target: meta,
      actual: realizados[r.indicador] ?? 0,
      projectable: PROJETAVEL[r.indicador],
    });
  }
  const res = computeIncentive(incentivo, entradas, dias, situacao === 'parcial' ? 'projected' : 'actual');
  const porCodigo = new Map(res.kpis.map((k) => [k.kpi_code, k]));
  const indicadores: LinhaRv[] = plano.regras.map((r) => {
    const k = porCodigo.get(r.indicador);
    const realizado = realizados[r.indicador] ?? 0;
    if (!k) {
      return {
        indicador: r.indicador, meta: null, realizado, atingimento_pct: 0, projetado_pct: 0,
        pagamento_pct: 0, valor_cents: 0, gatilho: r.gatilho, gatilho_ok: null, sem_meta: true,
      };
    }
    return {
      indicador: r.indicador, meta: k.target, realizado, atingimento_pct: k.achievement_pct, projetado_pct: k.projected_pct,
      pagamento_pct: k.payout_pct, valor_cents: k.incentive_cents, gatilho: r.gatilho, gatilho_ok: k.trigger_ok, sem_meta: false,
    };
  });
  return {
    rv_cents: res.incentive_cents,
    rv_bruta_cents: res.gross_incentive_cents,
    bloqueada_por: res.blocked_by as IndicadorRv[],
    indicadores,
  };
}

/** RN-CORE-29: dias úteis do mês pelo calendário do tenant (`metas.dias_uteis_semana`, 0 = domingo); encerrados = úteis antes de `hoje`. */
export function diasUteisDoMes(periodo: string, hoje: string, diasUteisSemana: readonly number[]): BusinessDays {
  const uteis = daysInMonth(periodo).filter((d) => diasUteisSemana.includes(new Date(`${d}T12:00:00Z`).getUTCDay()));
  const elapsed = uteis.filter((d) => d < hoje).length;
  return { total: uteis.length, elapsed, remaining: uteis.length - elapsed };
}

/** RN-CORE-21/30: meses fechados (2º dia útil do mês seguinte já passou) de `primeiro` até o mês de `hoje`, em ordem. */
export function mesesFechadosDesde(primeiro: string, hoje: string): string[] {
  const fim = hoje.slice(0, 7);
  const saida: string[] = [];
  let [ano, mes] = [Number(primeiro.slice(0, 4)), Number(primeiro.slice(5, 7))];
  while (`${ano}-${String(mes).padStart(2, '0')}` <= fim) {
    const ym = `${ano}-${String(mes).padStart(2, '0')}`;
    if (situacaoDoPeriodo(ym, hoje) === 'fechado') saida.push(ym);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return saida;
}
