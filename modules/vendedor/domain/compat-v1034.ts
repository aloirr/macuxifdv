/**
 * TEMPORÁRIO (R-20261124-114951): só para o typecheck dos testes antigos entre o #758 e o #760; sai no PR seguinte do item 14.
 * Mantém os nomes que o Resumo antigo exportava. Nada daqui é usado pela produção (app, API); não muda comportamento.
 */
import { motivoSoOrcamento, type SituacaoCliente } from './orcamento';
import type { AlertaDoPedido } from './alertas-pedido';

export const ROTULOS_DO_SALVAR = {
  enviar: 'Salvar e enviar pedido',
  apenasSalvar: 'Apenas salvar',
  orcamento: 'Salvar como orçamento',
  salvarOrcamento: 'Salvar orçamento',
  transformar: 'Transformar em pedido',
  alteracoes: 'Salvar alterações',
  alteracoesNoAparelho: 'Salvar alterações no aparelho',
} as const;

export type ModoDoResumo = 'novo_pedido' | 'so_orcamento' | 'editar_orcamento' | 'editar_pedido';
export type QualBotao = 'enviar' | 'orcamento' | 'salvar_orcamento';

interface BotaoCompat {
  visivel: boolean;
  habilitado: boolean;
  rotulo: string;
}

export interface EntradaDosBotoes {
  cliente: SituacaoCliente;
  pre_venda_ligada: boolean;
  editando: 'pedido' | 'orcamento' | null;
  itens_acima_do_maximo?: readonly string[];
  acima_do_limite?: boolean;
  itens_sem_estoque?: readonly string[];
  preco_data: string;
  editando_no_servidor?: boolean;
}

export interface BotoesDoResumo {
  modo: ModoDoResumo;
  principal: QualBotao;
  enviar: BotaoCompat;
  apenasSalvar: BotaoCompat;
  orcamento: BotaoCompat;
  salvarOrcamento: BotaoCompat;
  transformar: BotaoCompat;
  cancelar: true;
}

const OCULTO = (rotulo: string): BotaoCompat => ({ visivel: false, habilitado: false, rotulo });

export function botoesDoResumo(e: EntradaDosBotoes): BotoesDoResumo {
  const soOrcamento = motivoSoOrcamento(e.cliente) !== null;
  const soOrcamentoPorItem =
    (e.itens_acima_do_maximo?.length ?? 0) > 0 || e.acima_do_limite === true || (e.itens_sem_estoque?.length ?? 0) > 0;
  const podeEnviar = !soOrcamentoPorItem;
  const R = ROTULOS_DO_SALVAR;
  if (e.editando === 'orcamento') {
    return {
      cancelar: true,
      modo: 'editar_orcamento',
      principal: 'salvar_orcamento',
      enviar: OCULTO(R.enviar),
      apenasSalvar: OCULTO(R.apenasSalvar),
      orcamento: OCULTO(R.orcamento),
      salvarOrcamento: { visivel: true, habilitado: true, rotulo: R.salvarOrcamento },
      transformar: { visivel: !soOrcamento, habilitado: podeEnviar, rotulo: R.transformar },
    };
  }
  if (e.editando === 'pedido') {
    return {
      cancelar: true,
      modo: 'editar_pedido',
      principal: 'enviar',
      enviar: { visivel: true, habilitado: podeEnviar, rotulo: e.editando_no_servidor === false ? R.alteracoesNoAparelho : R.alteracoes },
      apenasSalvar: OCULTO(R.apenasSalvar),
      orcamento: OCULTO(R.orcamento),
      salvarOrcamento: OCULTO(R.salvarOrcamento),
      transformar: OCULTO(R.transformar),
    };
  }
  return {
    cancelar: true,
    modo: soOrcamento ? 'so_orcamento' : 'novo_pedido',
    principal: soOrcamento || (soOrcamentoPorItem && e.pre_venda_ligada) ? 'orcamento' : 'enviar',
    enviar: soOrcamento ? OCULTO(R.enviar) : { visivel: true, habilitado: podeEnviar, rotulo: R.enviar },
    apenasSalvar: { visivel: true, habilitado: true, rotulo: R.apenasSalvar },
    orcamento: { visivel: e.pre_venda_ligada || soOrcamento, habilitado: true, rotulo: R.orcamento },
    salvarOrcamento: OCULTO(R.salvarOrcamento),
    transformar: OCULTO(R.transformar),
  };
}

/** Alerta que impede enviar (a regra antiga da tela). */
export function impedeEnviarPorAlertas(a: readonly AlertaDoPedido[]): boolean {
  return a.some((x) => x.impede_enviar);
}

/** Só tipo: o que os testes antigos de opcoesDaSaida passam e leem; ignorado pela regra atual. */
export interface EntradaDaSaidaCompat {
  preco_data?: string;
  alertas_impedem_enviar?: boolean;
}
export interface OpcoesDaSaidaCompat {
  salvar?: boolean;
  apenasSalvar?: boolean;
}

