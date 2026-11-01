/**
 * Parâmetros do Hub com seus padrões (docs/produto/03, seção 9). Nenhuma regra os "enterra":
 * cada função do domain recebe o valor como argumento opcional e usa estes padrões quando omitido.
 * A API lê os valores do tenant (`plataforma.parametro`) e repassa.
 */
import { LIMITE_LINHAS_INVALIDAS_PADRAO, LIMITE_REGISTROS_LOTE, VERSAO_CONTRATO } from '../contracts';

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
  /** RN-INT-03: linhas inválidas do Conector detalhadas por lote (e entidade); o excedente só entra na contagem. */
  limiteLinhasInvalidas: number;
  /** RN-INT-12 (proposta): tamanho máximo do corpo de `POST /lotes` (o Conector envia até 4 MiB). */
  limiteCorpoLoteBytes: number;
  /** RN-INT-12 (proposta): tamanho máximo do corpo das demais rotas. */
  limiteCorpoGeralBytes: number;
  /** RN-INT-12 (proposta): balde de chamadas por Conector, por classe de rota (`lote` = POST /lotes; `geral` = o resto). */
  taxaPorConector: Readonly<{ lote: Readonly<{ capacidade: number; reposicaoPorMin: number }>; geral: Readonly<{ capacidade: number; reposicaoPorMin: number }> }>;
  /** RN-INT-10 (proposta): minutos em que a chave anterior continua valendo depois da rotação. */
  convivenciaChaveMin: number;
  /** RN-INT-10 (proposta): teto da convivência (7 dias). */
  convivenciaChaveMaxMin: number;
  /** RN-INT-06: dias até a confirmação da inativação em massa expirar. */
  ttlConfirmacaoInativacaoDias: number;
  /** RN-INT-08: pedidos entregues por consulta do Conector. */
  pedidosPorConsulta: number;
  /** RN-INT-08: entregas sem confirmação a partir das quais o monitor chama o pedido de "preso". */
  tentativasAlertaPedido: number;
  /** RN-INT-04: minutos que um lote espera a dependência antes de ser aplicado mesmo assim (vira `referencia_ausente`). */
  esperaMaxDependenciaMin: number;
  /** doc 06: minutos sem sinal de vida para o Conector ficar `atrasado`. */
  sinalAtrasadoMin: number;
  /** doc 06: minutos sem sinal de vida para o alerta no BKO. */
  sinalAlertaMin: number;
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
  limiteLinhasInvalidas: LIMITE_LINHAS_INVALIDAS_PADRAO,
  limiteCorpoLoteBytes: 8 * 1024 * 1024,
  limiteCorpoGeralBytes: 1024 * 1024,
  taxaPorConector: Object.freeze({
    lote: Object.freeze({ capacidade: 30, reposicaoPorMin: 20 }),
    geral: Object.freeze({ capacidade: 300, reposicaoPorMin: 300 }),
  }),
  convivenciaChaveMin: 24 * 60,
  convivenciaChaveMaxMin: 7 * 24 * 60,
  ttlConfirmacaoInativacaoDias: 7,
  pedidosPorConsulta: 50,
  tentativasAlertaPedido: 5,
  esperaMaxDependenciaMin: 30,
  sinalAtrasadoMin: 3,
  sinalAlertaMin: 15,
});
