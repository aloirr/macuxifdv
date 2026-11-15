/**
 * Parâmetros › Alertas › Produtividade do dia (T-0180, D1 e D6): catálogo de campos e regras de salvamento, funções puras.
 * O formato, os padrões D6 e as faixas são do contrato do Core (`@macuxi/core/contracts`, parâmetro `alertas.produtividade`);
 * aqui só ficam o que a tela mostra (nome, frase, rótulo, unidade) e a separação do que cada rota grava.
 *
 * D1 / RN-CORE-26: o "parado" (60 min) é `inicio.parado_min` do Core, um valor guardado num lugar só, gravado por
 * `PUT /core/parametros/parado-min`; aqui é só o campo que o edita.
 */
import {
  FAIXAS_ALERTAS_PRODUTIVIDADE as FAIXAS,
  PARADO_MIN_MAX,
  PARADO_MIN_MIN,
  PARADO_MIN_PADRAO,
  PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as PADRAO,
  type ChaveRegraProdutividade,
  type ParametrosAlertasProdutividade,
} from '@macuxi/core/contracts';
import { validarCampo } from './campos-regra';
import { minutoDoTextoHora } from '@macuxi/core/contracts';

export interface CampoProdutividade {
  /** Nome do campo no contrato do Core; `parado_min` é o de `inicio.parado_min`. */
  id: string;
  rotulo: string;
  /** Unidade escrita dentro do campo; o campo de hora não leva. */
  unidade: string;
  /** `hora`: o valor é o minuto do dia (padrão e faixa); a tela mostra `HH:MM`. */
  tipo: 'numero' | 'hora';
  min: number;
  max: number;
  padrao: number;
  /** `core_parado_min` = `inicio.parado_min` (D1); `produtividade` = parâmetro `alertas.produtividade`. */
  origem: 'produtividade' | 'core_parado_min';
}
const num = (id: string, rotulo: string, unidade: string, f: { min: number; max: number }, padrao: number): CampoProdutividade => ({ id, rotulo, unidade, tipo: 'numero', min: f.min, max: f.max, padrao, origem: 'produtividade' });
const hora = (id: string, rotulo: string, padrao: number): CampoProdutividade => ({ id, rotulo, unidade: '', tipo: 'hora', min: 0, max: 1439, padrao, origem: 'produtividade' });

export const CAMPOS_PRODUTIVIDADE: Readonly<Record<ChaveRegraProdutividade, readonly CampoProdutividade[]>> = {
  fim_almoco: [num('antecedencia_min', 'Antes do fim', 'min', FAIXAS.antecedencia_min, PADRAO.fim_almoco.antecedencia_min)],
  parado_entre_visitas: [
    { ...num('parado_min', 'Depois de', 'min', { min: PARADO_MIN_MIN, max: PARADO_MIN_MAX }, PARADO_MIN_PADRAO), origem: 'core_parado_min' },
    num('gestor_depois_min', 'Alerta ao gestor', 'min depois', FAIXAS.gestor_depois_min, PADRAO.parado_entre_visitas.gestor_depois_min),
  ],
  sem_checkin_inicio: [hora('ate_min', 'Até as', PADRAO.sem_checkin_inicio.ate_min)],
  rota_incompleta: [hora('as_min', 'Lembrete às', PADRAO.rota_incompleta.as_min)],
  visita_aberta: [num('apos_min', 'Depois de', 'min', FAIXAS.visita_aberta_min, PADRAO.visita_aberta.apos_min)],
  envio_pendente: [num('apos_h', 'Depois de', 'h', FAIXAS.envio_pendente_h, PADRAO.envio_pendente.apos_h)],
};

/** Frase curta: só o problema (R-20261110-192153). */
export const FRASE_PRODUTIVIDADE: Readonly<Record<ChaveRegraProdutividade, string>> = {
  fim_almoco: 'Lembra a volta do almoço.',
  parado_entre_visitas: 'Avisa quando passa do tempo sem check-in.',
  sem_checkin_inicio: 'Avisa quem não fez check-in até o horário.',
  rota_incompleta: 'Lembra os clientes da rota que faltam.',
  visita_aberta: 'Lembra o checkout da visita que ficou aberta.',
  envio_pendente: 'Lembra os registros sem enviar.',
};

/** Destinos que a regra tem (só Parado e Sem check-in têm dois). */
export const REGRAS_COM_DESTINOS: ReadonlySet<ChaveRegraProdutividade> = new Set<ChaveRegraProdutividade>(['parado_entre_visitas', 'sem_checkin_inicio']);

export interface RascunhoProdutividade {
  ativa: boolean;
  destinos: { vendedor?: boolean; gestor?: boolean };
  /** Número do campo; o campo de hora aceita `HH:MM`. */
  valores: Readonly<Record<string, number | string | null>>;
}
export type ResultadoProdutividade = { ok: true; parametros: ParametrosAlertasProdutividade | null; paradoMin: number | null } | { ok: false; erros: Record<string, string> };

/**
 * Separa o que vai para `PUT /core/parametros/alertas-produtividade` (o parâmetro inteiro, no formato do Core) do que vai para
 * `PUT /core/parametros/parado-min` (D1), só o que mudou. Valor inválido devolve o erro por campo e nada é enviado.
 */
export function montarSalvamentoProdutividade(chave: ChaveRegraProdutividade, r: RascunhoProdutividade, atual: { parametros: ParametrosAlertasProdutividade; paradoMin: number }): ResultadoProdutividade {
  const erros: Record<string, string> = {};
  const antes = atual.parametros[chave] as Record<string, unknown>;
  const depois: Record<string, unknown> = { ...antes, ativa: r.ativa };
  if (REGRAS_COM_DESTINOS.has(chave)) {
    depois.vendedor = r.destinos.vendedor ?? antes.vendedor;
    depois.gestor = r.destinos.gestor ?? antes.gestor;
  }
  let paradoMin: number | null = null;
  for (const c of CAMPOS_PRODUTIVIDADE[chave]) {
    const bruto = r.valores[c.id] ?? null;
    const n = c.tipo === 'hora' && typeof bruto === 'string' ? minutoDoTextoHora(bruto) : typeof bruto === 'number' ? bruto : null;
    const erro = c.tipo === 'hora' && n === null ? 'Use o horário em hh:mm.' : validarCampo(c, n);
    if (erro) erros[c.id] = erro;
    else if (c.origem === 'core_parado_min') paradoMin = n !== atual.paradoMin ? n : null;
    else depois[c.id] = n;
  }
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  const mudou = JSON.stringify(depois) !== JSON.stringify(antes);
  return { ok: true, parametros: mudou ? ({ ...atual.parametros, [chave]: depois } as ParametrosAlertasProdutividade) : null, paradoMin };
}

/** Teto de lembretes por pessoa por dia (faixa do Core). */
export function montarSalvamentoTeto(teto: number | null, atual: { parametros: ParametrosAlertasProdutividade }): { ok: true; parametros: ParametrosAlertasProdutividade | null } | { ok: false; erros: Record<string, string> } {
  const erro = validarCampo(FAIXAS.teto_lembretes_dia, teto);
  if (erro) return { ok: false, erros: { teto: erro } };
  return { ok: true, parametros: teto === atual.parametros.teto_lembretes_dia ? null : { ...atual.parametros, teto_lembretes_dia: teto! } };
}
