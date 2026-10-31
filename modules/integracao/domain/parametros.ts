/**
 * Parâmetros do Hub com seus padrões (docs/produto/03, seção 9). Nenhuma regra os "enterra":
 * cada função do domain recebe o valor como argumento opcional e usa estes padrões quando omitido.
 * A API lê os valores do tenant (`plataforma.parametro`) e repassa.
 */
import { LIMITE_REGISTROS_LOTE, VERSAO_CONTRATO } from '../contracts';

export interface ParametrosHub {
  /** RN-INT-01: registros por lote. */
  limiteRegistrosLote: number;
  /** RN-INT-09: versões de contrato aceitas. */
  versoesSuportadas: readonly string[];
  /** RN-INT-07: diferença absoluta de contagem aceita. */
  toleranciaContagem: number;
  /** RN-INT-07: diferença percentual da soma aceita (0,5 = 0,5%). */
  toleranciaSomaPct: number;
  /** RN-INT-08: minutos até um pedido `enviado` sem confirmação voltar a `pendente`. */
  timeoutEnvioMin: number;
  /** RN-INT-09: meses de convivência da versão anterior. */
  janelaVersaoAnteriorMeses: number;
  /** RN-INT-06: minutos até uma sessão de carga completa sem fechar expirar. */
  ttlSessaoMin: number;
  /** RN-INT-06: % de ativos que a carga completa pode inativar sem confirmação do operador. */
  limiteInativacaoPct: number;
}

export const PARAMETROS_PADRAO: Readonly<ParametrosHub> = Object.freeze({
  limiteRegistrosLote: LIMITE_REGISTROS_LOTE,
  versoesSuportadas: Object.freeze([VERSAO_CONTRATO]),
  toleranciaContagem: 0,
  toleranciaSomaPct: 0.5,
  timeoutEnvioMin: 10,
  janelaVersaoAnteriorMeses: 6,
  ttlSessaoMin: 24 * 60,
  limiteInativacaoPct: 30,
});
