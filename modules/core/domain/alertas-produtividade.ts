/**
 * Parâmetros dos alertas de produtividade (T-0180, D4/D6; RN-CORE-26, RN-CORE-44). Funções puras: a API valida o PUT e lê o valor
 * efetivo; o app lê o mesmo valor do pull `parametro`. Ausente ou inválido = padrões D6.
 */
import { PARADO_MIN_MAX, PARADO_MIN_MIN, paradoMinValido } from '../contracts/inicio-parametros';
import {
  FAIXAS_ALERTAS_PRODUTIVIDADE as F,
  NOME_REGRA_PRODUTIVIDADE,
  PARAMETRO_ALERTAS_PRODUTIVIDADE,
  PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO,
  ParametrosAlertasProdutividadeSchema,
  type ErroParametroAlertas,
  type ParametrosAlertasProdutividade,
} from '../contracts/alertas-produtividade';

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/** Valor efetivo a partir das linhas do pull `parametro`: cópia dos padrões D6 quando ausente ou inválido. */
export function parametrosAlertasDasLinhas(linhas: readonly Linha[]): ParametrosAlertasProdutividade {
  const v = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_ALERTAS_PRODUTIVIDADE && !x.deleted_at)?.valor;
  const r = ParametrosAlertasProdutividadeSchema.safeParse(v);
  return structuredClone(r.success && validarParametrosAlertasProdutividade(r.data).ok ? r.data : PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO);
}

const faixa = (n: unknown, f: { min: number; max: number }) => typeof n === 'number' && Number.isInteger(n) && n >= f.min && n <= f.max;

/** RN-CORE-26 (D6): valida as faixas do PUT; as mensagens dizem a regra, o intervalo e a ação. */
export function validarParametrosAlertasProdutividade(p: ParametrosAlertasProdutividade): { ok: true; valores: ParametrosAlertasProdutividade } | { ok: false; erros: ErroParametroAlertas[] } {
  const erros: ErroParametroAlertas[] = [];
  const e = (campo: string, mensagem: string) => erros.push({ campo, mensagem });
  if (!faixa(p.fim_almoco.antecedencia_min, F.antecedencia_min)) e('fim_almoco', `${NOME_REGRA_PRODUTIVIDADE.fim_almoco}: avise de ${F.antecedencia_min.min} a ${F.antecedencia_min.max} minutos antes.`);
  if (!faixa(p.parado_entre_visitas.gestor_depois_min, F.gestor_depois_min)) e('parado_entre_visitas', `${NOME_REGRA_PRODUTIVIDADE.parado_entre_visitas}: o gestor é avisado de ${F.gestor_depois_min.min} a ${F.gestor_depois_min.max} minutos depois.`);
  if (!faixa(p.visita_aberta.apos_min, F.visita_aberta_min)) e('visita_aberta', `${NOME_REGRA_PRODUTIVIDADE.visita_aberta}: informe de ${F.visita_aberta_min.min} a ${F.visita_aberta_min.max} minutos.`);
  if (!faixa(p.envio_pendente.apos_h, F.envio_pendente_h)) e('envio_pendente', `${NOME_REGRA_PRODUTIVIDADE.envio_pendente}: informe de ${F.envio_pendente_h.min} a ${F.envio_pendente_h.max} horas.`);
  if (!faixa(p.teto_lembretes_dia, F.teto_lembretes_dia)) e('teto_lembretes_dia', `O teto de lembretes por dia vai de ${F.teto_lembretes_dia.min} a ${F.teto_lembretes_dia.max}.`);
  return erros.length > 0 ? { ok: false, erros } : { ok: true, valores: p };
}

/** RN-CORE-26: o "parado" é `inicio.parado_min`, inteiro de 15 a 480 minutos (único lugar do número). */
export function validarParadoMin(n: unknown): { ok: true; valor: number } | { ok: false; erros: ErroParametroAlertas[] } {
  return paradoMinValido(n)
    ? { ok: true, valor: n }
    : { ok: false, erros: [{ campo: 'parado_min', mensagem: `O tempo para considerar "parado" deve ser um número inteiro de ${PARADO_MIN_MIN} a ${PARADO_MIN_MAX} minutos.` }] };
}
