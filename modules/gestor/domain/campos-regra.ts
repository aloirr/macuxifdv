/**
 * Parâmetros › Alertas (T-0180): os campos que cada regra da equipe usa, com rótulo, unidade escrita, faixa e padrão.
 * Funções puras; a API revalida (contrato `AjusteRegraAlerta` + `ParametrosAlertasEquipe`) e a tela só desenha.
 *  - RN-GES-01/02: tolerância, sem frequência e carência do cliente novo ficam na regra "Cliente sem visita";
 *  - RN-GES-03: o prazo da aprovação fica na regra "Pedido parado na aprovação" e é o MESMO da fila (um valor, um lugar);
 *  - RN-PRO-07: a permanência mínima é do Promotor e não se edita aqui; "Visita curta" mostra só a janela;
 *  - RN-CORE-03: sem o módulo de origem, a regra não aparece.
 */
import { FAIXAS_PARAMETROS_ALERTAS, TIPOS_REGRA_EQUIPE, type ChaveParametroAlerta, type ParametrosAlertasEquipe, type RegraAlerta, type Severidade, type TipoRegraEquipe } from '../contracts';
import { MODULO_DO_ALERTA, REGRAS_PADRAO } from './alertas';
import { PARAMETROS_PADRAO } from './parametros';

type CampoDaRegra = 'limiar' | 'janela_dias' | 'amostra_min';

export interface CampoRegra {
  id: string;
  rotulo: string;
  /** Unidade escrita dentro do campo. */
  unidade: string;
  min: number;
  max: number;
  padrao: number;
  origem: { tipo: 'regra'; campo: CampoDaRegra } | { tipo: 'parametro'; chave: ChaveParametroAlerta };
}

const par = (chave: ChaveParametroAlerta, rotulo: string, unidade: string): CampoRegra => ({
  id: chave,
  rotulo,
  unidade,
  ...FAIXAS_PARAMETROS_ALERTAS[chave],
  padrao: PARAMETROS_PADRAO[chave],
  origem: { tipo: 'parametro', chave },
});
const reg = (tipo: TipoRegraEquipe, campo: CampoDaRegra, rotulo: string, unidade: string, min: number, max: number): CampoRegra => ({
  id: campo,
  rotulo,
  unidade,
  min,
  max,
  padrao: REGRAS_PADRAO[tipo][campo] as number,
  origem: { tipo: 'regra', campo },
});

export const CAMPOS_REGRA: Readonly<Record<TipoRegraEquipe, readonly CampoRegra[]>> = {
  cliente_sem_visita: [
    par('pct_tolerancia_frequencia', 'Tolerância', '% da frequência'),
    par('dias_sem_visita_padrao', 'Sem frequência', 'dias'),
    par('dias_carencia_cliente_novo', 'Carência do cliente novo', 'dias'),
  ],
  ritmo_abaixo_meta: [reg('ritmo_abaixo_meta', 'limiar', 'Ritmo mínimo', '% da meta', 1, 100), reg('ritmo_abaixo_meta', 'amostra_min', 'A partir do', 'º dia útil', 0, 31)],
  pedido_aguardando_aprovacao: [par('prazo_aprovacao_dias_uteis', 'Prazo', 'dias úteis')],
  ruptura_recorrente: [reg('ruptura_recorrente', 'limiar', 'Ruptura em', 'visitas', 1, 30), reg('ruptura_recorrente', 'janela_dias', 'No período de', 'dias', 1, 90)],
  visita_curta: [reg('visita_curta', 'janela_dias', 'Nos últimos', 'dias', 1, 30)],
  fotos_sem_gps: [
    reg('fotos_sem_gps', 'limiar', 'Máximo sem GPS', '%', 0, 100),
    reg('fotos_sem_gps', 'janela_dias', 'No período de', 'dias', 1, 90),
    reg('fotos_sem_gps', 'amostra_min', 'A partir de', 'fotos', 1, 1000),
  ],
};

/** Frase curta de cada regra: só o problema (R-20261110-192153). */
export const FRASE_REGRA: Readonly<Record<TipoRegraEquipe, string>> = {
  cliente_sem_visita: 'Avisa quando o cliente passa do prazo de visita.',
  ritmo_abaixo_meta: 'Avisa quando o vendedor está abaixo do ritmo da meta.',
  pedido_aguardando_aprovacao: 'Avisa quando o pedido passa do prazo de aprovação.',
  ruptura_recorrente: 'Avisa quando a loja repete ruptura em várias visitas.',
  visita_curta: 'Avisa quando o promotor fica menos que o mínimo na loja.',
  fotos_sem_gps: 'Avisa quando muitas fotos chegam sem localização.',
};

/** RN-CORE-03: regras cujo módulo de origem está ativo (`core` sempre). */
export function regrasVisiveis(modulos: ReadonlySet<string>): TipoRegraEquipe[] {
  return TIPOS_REGRA_EQUIPE.filter((t) => MODULO_DO_ALERTA[t] === 'core' || modulos.has(MODULO_DO_ALERTA[t]));
}

/** Erro do campo em português com a ação seguinte, ou `null` quando vale. */
export function validarCampo(campo: Pick<CampoRegra, 'min' | 'max'>, valor: number | null): string | null {
  if (valor === null || Number.isNaN(valor)) return 'Informe um número.';
  if (!Number.isInteger(valor)) return 'Use um número inteiro.';
  if (valor < campo.min || valor > campo.max) return `Use um valor de ${campo.min} a ${campo.max}.`;
  return null;
}

export interface RascunhoRegra {
  ativa: boolean;
  severidade: Severidade;
  /** Valor de cada campo (`CampoRegra.id`); `null` = campo vazio. */
  valores: Readonly<Record<string, number | null>>;
}

export interface AjusteDaRegra {
  ativa?: boolean;
  severidade?: Severidade;
  limiar?: number;
  janela_dias?: number;
  amostra_min?: number;
}

export type ResultadoSalvamento = { ok: true; ajusteRegra: AjusteDaRegra | null; parametros: ParametrosAlertasEquipe | null } | { ok: false; erros: Record<string, string> };

/**
 * Separa o que a regra grava (`PUT alertas/regras/:tipo`) do que é parâmetro do tenant (`PUT parametros/alertas`), só com
 * o que mudou. Valor inválido devolve o erro por campo e nada é enviado.
 */
export function montarSalvamento(tipo: TipoRegraEquipe, rascunho: RascunhoRegra, atual: { regra: RegraAlerta; parametros: ParametrosAlertasEquipe }): ResultadoSalvamento {
  const erros: Record<string, string> = {};
  const ajuste: AjusteDaRegra = {};
  let parametros: ParametrosAlertasEquipe = { ...atual.parametros };
  let mudouParametro = false;
  if (rascunho.ativa !== atual.regra.ativa) ajuste.ativa = rascunho.ativa;
  if (rascunho.severidade !== atual.regra.severidade) ajuste.severidade = rascunho.severidade;
  for (const c of CAMPOS_REGRA[tipo]) {
    const v = rascunho.valores[c.id] ?? null;
    const erro = validarCampo(c, v);
    if (erro) {
      erros[c.id] = erro;
      continue;
    }
    if (c.origem.tipo === 'parametro') {
      if (v !== atual.parametros[c.origem.chave]) {
        parametros = { ...parametros, [c.origem.chave]: v };
        mudouParametro = true;
      }
    } else if (v !== atual.regra[c.origem.campo]) {
      ajuste[c.origem.campo] = v as number;
    }
  }
  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return { ok: true, ajusteRegra: Object.keys(ajuste).length > 0 ? ajuste : null, parametros: mudouParametro ? parametros : null };
}
