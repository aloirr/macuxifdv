/**
 * Parâmetros › Alertas › Produtividade do dia (T-0180, D1 e D6). Catálogo e regras de salvamento, funções puras.
 *
 * ADAPTADOR TEMPORÁRIO: o tipo e o padrão de `ParametrosAlertasProdutividade` abaixo ESPELHAM o combinado com o modulo-core
 * (`parametrosAlertasProdutividadeSchema`, `PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO`, `PARAMETRO_ALERTAS_PRODUTIVIDADE`, em
 * `@macuxi/core/contracts`). Trocar pelo contrato do core quando o PR do modulo-core entrar (T-0180).
 *
 * D1 / RN-CORE-26: o "parado" (60 min) é `inicio.parado_min` do core, um valor guardado num lugar só; aqui é só o campo que o edita.
 */
import { PARADO_MIN_MAX, PARADO_MIN_MIN, PARADO_MIN_PADRAO } from '@macuxi/core/contracts';

export const REGRAS_PRODUTIVIDADE = ['fim_almoco', 'parado_entre_visitas', 'sem_checkin_inicio', 'rota_incompleta', 'visita_aberta', 'envio_pendente'] as const;
export type RegraProdutividade = (typeof REGRAS_PRODUTIVIDADE)[number];

/** Espelho do contrato do core (trocar quando o PR do modulo-core entrar). */
export interface ParametrosAlertasProdutividade {
  teto_lembretes_dia: number;
  regras: {
    fim_almoco: { ativa: boolean; aviso_antes_min: number };
    parado_entre_visitas: { ativa: boolean; vendedor: boolean; gestor: boolean; gestor_depois_min: number };
    sem_checkin_inicio: { ativa: boolean; vendedor: boolean; gestor: boolean; ate: string };
    rota_incompleta: { ativa: boolean; lembrete_as: string };
    visita_aberta: { ativa: boolean; depois_min: number };
    envio_pendente: { ativa: boolean; depois_horas: number };
  };
}

/** D6: padrões. */
export const PARAMETROS_PRODUTIVIDADE_PADRAO: Readonly<ParametrosAlertasProdutividade> = Object.freeze({
  teto_lembretes_dia: 4,
  regras: {
    fim_almoco: { ativa: true, aviso_antes_min: 10 },
    parado_entre_visitas: { ativa: true, vendedor: true, gestor: true, gestor_depois_min: 30 },
    sem_checkin_inicio: { ativa: true, vendedor: true, gestor: true, ate: '10:00' },
    rota_incompleta: { ativa: true, lembrete_as: '16:00' },
    visita_aberta: { ativa: true, depois_min: 120 },
    envio_pendente: { ativa: true, depois_horas: 4 },
  },
});
export const PARADO_MIN_PADRAO_CORE = PARADO_MIN_PADRAO;
export const TETO_LEMBRETES_MIN = 1;
export const TETO_LEMBRETES_MAX = 10;

export interface CampoProdutividade {
  id: string;
  rotulo: string;
  unidade: string;
  tipo: 'numero' | 'hora';
  min: number;
  max: number;
  padrao: number | string;
  /** `core_parado_min` = `inicio.parado_min` (D1); `produtividade` = parâmetro `alertas.produtividade`. */
  origem: 'produtividade' | 'core_parado_min';
}
const num = (id: string, rotulo: string, unidade: string, min: number, max: number, padrao: number, origem: CampoProdutividade['origem'] = 'produtividade'): CampoProdutividade => ({ id, rotulo, unidade, tipo: 'numero', min, max, padrao, origem });
const hora = (id: string, rotulo: string, padrao: string): CampoProdutividade => ({ id, rotulo, unidade: '', tipo: 'hora', min: 0, max: 0, padrao, origem: 'produtividade' });

const R = PARAMETROS_PRODUTIVIDADE_PADRAO.regras;
export const CAMPOS_PRODUTIVIDADE: Readonly<Record<RegraProdutividade, readonly CampoProdutividade[]>> = {
  fim_almoco: [num('aviso_antes_min', 'Antes do fim', 'min', 5, 30, R.fim_almoco.aviso_antes_min)],
  parado_entre_visitas: [
    num('parado_min', 'Depois de', 'min', PARADO_MIN_MIN, PARADO_MIN_MAX, PARADO_MIN_PADRAO, 'core_parado_min'),
    num('gestor_depois_min', 'Alerta ao gestor depois de', 'min', 5, 240, R.parado_entre_visitas.gestor_depois_min),
  ],
  sem_checkin_inicio: [hora('ate', 'Até as', R.sem_checkin_inicio.ate)],
  rota_incompleta: [hora('lembrete_as', 'Lembrete às', R.rota_incompleta.lembrete_as)],
  visita_aberta: [num('depois_min', 'Depois de', 'min', 30, 480, R.visita_aberta.depois_min)],
  envio_pendente: [num('depois_horas', 'Depois de', 'h', 1, 12, R.envio_pendente.depois_horas)],
};

export const NOME_PRODUTIVIDADE: Readonly<Record<RegraProdutividade, string>> = {
  fim_almoco: 'Fim do almoço',
  parado_entre_visitas: 'Parado entre visitas',
  sem_checkin_inicio: 'Sem check-in até as 10:00',
  rota_incompleta: 'Rota incompleta',
  visita_aberta: 'Visita aberta',
  envio_pendente: 'Envio pendente',
};

/** Frase curta: só o problema (R-20261110-192153). */
export const FRASE_PRODUTIVIDADE: Readonly<Record<RegraProdutividade, string>> = {
  fim_almoco: 'Lembra a volta do almoço.',
  parado_entre_visitas: 'Avisa quem está parado entre visitas.',
  sem_checkin_inicio: 'Avisa quando o dia começa sem visita.',
  rota_incompleta: 'Avisa quando sobram clientes da rota.',
  visita_aberta: 'Lembra o checkout da visita que ficou aberta.',
  envio_pendente: 'Avisa quando há registros sem enviar.',
};

/** Destinos que a regra tem (só Parado e Sem check-in têm dois). */
export const REGRAS_COM_DESTINOS: ReadonlySet<RegraProdutividade> = new Set<RegraProdutividade>(['parado_entre_visitas', 'sem_checkin_inicio']);

/** Hora local `HH:MM` (00:00 a 23:59). */
export function validarHora(v: string): string | null {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.trim()) ? null : 'Use o horário no formato HH:MM, por exemplo 10:00.';
}

function validarNumero(c: Pick<CampoProdutividade, 'min' | 'max'>, v: number | null): string | null {
  if (v === null || Number.isNaN(v)) return 'Informe um número.';
  if (!Number.isInteger(v)) return 'Use um número inteiro.';
  if (v < c.min || v > c.max) return `Use um valor de ${c.min} a ${c.max}.`;
  return null;
}

export interface RascunhoProdutividade {
  ativa: boolean;
  destinos: { vendedor?: boolean; gestor?: boolean };
  valores: Readonly<Record<string, number | string | null>>;
}
export type ResultadoProdutividade =
  | { ok: true; parametros: ParametrosAlertasProdutividade | null; paradoMin: number | null }
  | { ok: false; erros: Record<string, string> };

/**
 * Separa o que vai para o parâmetro `alertas.produtividade` do que vai para `inicio.parado_min` (D1), só o que mudou.
 * Valor inválido devolve o erro por campo e nada é enviado.
 */
export function montarSalvamentoProdutividade(chave: RegraProdutividade, r: RascunhoProdutividade, atual: { parametros: ParametrosAlertasProdutividade; paradoMin: number }): ResultadoProdutividade {
  const erros: Record<string, string> = {};
  const antes = atual.parametros.regras[chave] as Record<string, unknown>;
  const depois: Record<string, unknown> = { ...antes, ativa: r.ativa };
  if (REGRAS_COM_DESTINOS.has(chave)) {
    depois.vendedor = r.destinos.vendedor ?? antes.vendedor;
    depois.gestor = r.destinos.gestor ?? antes.gestor;
  }
  let paradoMin: number | null = null;
  for (const c of CAMPOS_PRODUTIVIDADE[chave]) {
    const v = r.valores[c.id] ?? null;
    if (c.tipo === 'hora') {
      const erro = typeof v === 'string' ? validarHora(v) : 'Informe o horário.';
      if (erro) erros[c.id] = erro;
      else depois[c.id] = (v as string).trim();
      continue;
    }
    const n = typeof v === 'number' ? v : null;
    const erro = validarNumero(c, n);
    if (erro) {
      erros[c.id] = erro;
      continue;
    }
    if (c.origem === 'core_parado_min') {
      if (n !== atual.paradoMin) paradoMin = n;
    } else depois[c.id] = n;
  }
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  const mudou = JSON.stringify(depois) !== JSON.stringify(antes);
  return { ok: true, parametros: mudou ? { ...atual.parametros, regras: { ...atual.parametros.regras, [chave]: depois } as ParametrosAlertasProdutividade['regras'] } : null, paradoMin };
}

/** Teto de lembretes por pessoa por dia (1 a 10). */
export function montarSalvamentoTeto(teto: number | null, atual: { parametros: ParametrosAlertasProdutividade }): { ok: true; parametros: ParametrosAlertasProdutividade | null } | { ok: false; erros: Record<string, string> } {
  const erro = validarNumero({ min: TETO_LEMBRETES_MIN, max: TETO_LEMBRETES_MAX }, teto);
  if (erro) return { ok: false, erros: { teto: erro } };
  return { ok: true, parametros: teto === atual.parametros.teto_lembretes_dia ? null : { ...atual.parametros, teto_lembretes_dia: teto! } };
}
