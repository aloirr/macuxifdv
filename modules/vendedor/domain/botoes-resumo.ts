/**
 * RF-VEN-11 / RN-VEN-38 (T-0137): quais botões o Resumo do Novo pedido mostra e em que estado. Função pura, sem React: a tela só
 * desenha. Spec: docs/design/pedido-v2.md §2.2 e §2.3.
 *   novo pedido      Salvar e enviar pedido (principal) · Apenas salvar · Salvar como orçamento · Cancelar
 *   RN-VEN-13        Salvar como orçamento (principal, "Válido até dd/mm") · Apenas salvar · Cancelar
 *   editar orçamento Salvar orçamento (principal) · Transformar em pedido · Cancelar
 *   editar pedido    um botão só ("Salvar alterações") · Cancelar
 * Pendência (RN-CORE-36) desliga tudo o que valida; Apenas salvar grava `rascunho` e aceita pendências.
 */
import { avisoSoOrcamento, motivoSoOrcamento, type SituacaoCliente } from './orcamento';
import { mensagemAcimaDoMaximo, type NivelDePreco } from './preco-pedido';

/** RN-VEN-38 (RD-0036): os rótulos dos botões de salvar, num mapa só (botões do Resumo, folha de saída e tela). */
export const ROTULOS_DO_SALVAR = {
  enviar: 'Salvar e enviar pedido',
  apenasSalvar: 'Apenas salvar',
  orcamento: 'Salvar como orçamento',
  salvarOrcamento: 'Salvar orçamento',
  transformar: 'Transformar em pedido',
  alteracoes: 'Salvar alterações',
  alteracoesNoAparelho: 'Salvar alterações no aparelho',
} as const;

/** RN-VEN-10 (T-0151): a alçada só aparece ao salvar, numa pergunta; nunca escrita sob o botão nem nas telas. */
export const PERGUNTA_DA_ALCADA = { titulo: 'Desconto acima da sua alçada. Enviar para aprovação?', enviar: 'Enviar para aprovação', voltar: 'Voltar' } as const;

/** RN-VEN-10: só o pedido com desconto efetivo acima da alçada do autor pergunta; orçamento não tem alçada (RN-VEN-18). */
export function perguntaDaAlcada(e: { tipo: 'pedido' | 'orcamento'; nivel: NivelDePreco | null }): typeof PERGUNTA_DA_ALCADA | null {
  return e.tipo === 'pedido' && e.nivel !== null ? PERGUNTA_DA_ALCADA : null;
}

/** RN-VEN-11 (T-0151): o motivo numa linha, "AGU-1500 acima do desconto máximo". `null` = nenhum item acima do máximo. */
export function motivoDoMaximo(codigos: readonly string[] | undefined): string | null {
  return codigos && codigos.length > 0 ? mensagemAcimaDoMaximo(codigos) : null;
}

export type ModoDoResumo = 'novo_pedido' | 'so_orcamento' | 'editar_orcamento' | 'editar_pedido';
export type QualBotao = 'enviar' | 'orcamento' | 'salvar_orcamento';

export interface BotaoDoResumo {
  visivel: boolean;
  habilitado: boolean;
  rotulo: string;
}

export interface EntradaDosBotoes {
  cliente: SituacaoCliente;
  /** tenant com orçamento (pré-venda); o cliente da RN-VEN-13 sempre vê o orçamento */
  pre_venda_ligada: boolean;
  /** `null` = Novo pedido; senão, o tipo do documento em edição */
  editando: 'pedido' | 'orcamento' | null;
  pendencias: number;
  /** RN-VEN-11 (T-0151): códigos dos itens com desconto acima do máximo do produto; bloqueiam enviar e transformar (só orçamento) */
  itens_acima_do_maximo?: readonly string[];
  /** RN-VEN-20 (T-0150, 10/11): códigos dos itens sem estoque; entram no pedido, mas o pedido só sai como orçamento (igual ao máximo) */
  itens_sem_estoque?: readonly string[];
  /** AAAA-MM-DD: dia do preço do orçamento (hoje, no fuso do tenant); sai como "Preço de dd/mm" (RN-VEN-18) */
  preco_data: string;
  /** edição de pedido: `false` = documento só no aparelho (ainda não foi ao servidor); padrão `true` */
  editando_no_servidor?: boolean;
}

export interface BotoesDoResumo {
  modo: ModoDoResumo;
  /** o botão de largura total e nível principal */
  principal: QualBotao;
  enviar: BotaoDoResumo;
  apenasSalvar: BotaoDoResumo;
  orcamento: BotaoDoResumo;
  salvarOrcamento: BotaoDoResumo;
  transformar: BotaoDoResumo;
  cancelar: true;
  /** RN-VEN-13: a linha de erro acima dos botões */
  aviso: string | null;
  pendencias: number;
}

const OCULTO = (rotulo: string): BotaoDoResumo => ({ visivel: false, habilitado: false, rotulo });

export function botoesDoResumo(e: EntradaDosBotoes): BotoesDoResumo {
  const soOrcamento = motivoSoOrcamento(e.cliente) !== null;
  const livre = e.pendencias === 0;
  // RN-VEN-11 (T-0151): desconto acima do máximo do produto não passa nem com aprovação; só o orçamento salva
  const motivoMax = motivoDoMaximo(e.itens_acima_do_maximo);
  const soOrcamentoPorItem = motivoMax !== null || (e.itens_sem_estoque?.length ?? 0) > 0;
  const podeEnviar = livre && !soOrcamentoPorItem;
  const comum = { cancelar: true as const, pendencias: e.pendencias };

  if (e.editando === 'orcamento') {
    return {
      ...comum,
      modo: 'editar_orcamento',
      principal: 'salvar_orcamento',
      enviar: OCULTO(ROTULOS_DO_SALVAR.enviar),
      apenasSalvar: OCULTO(ROTULOS_DO_SALVAR.apenasSalvar),
      orcamento: OCULTO(ROTULOS_DO_SALVAR.orcamento),
      salvarOrcamento: { visivel: true, habilitado: livre, rotulo: ROTULOS_DO_SALVAR.salvarOrcamento },
      transformar: { visivel: !soOrcamento, habilitado: podeEnviar, rotulo: ROTULOS_DO_SALVAR.transformar },
      aviso: motivoMax ?? avisoSoOrcamento(e.cliente),
    };
  }
  if (e.editando === 'pedido') {
    return {
      ...comum,
      modo: 'editar_pedido',
      principal: 'enviar',
      enviar: { visivel: true, habilitado: podeEnviar, rotulo: rotuloDaEdicao(e) },
      apenasSalvar: OCULTO(ROTULOS_DO_SALVAR.apenasSalvar),
      orcamento: OCULTO(ROTULOS_DO_SALVAR.orcamento),
      salvarOrcamento: OCULTO(ROTULOS_DO_SALVAR.salvarOrcamento),
      transformar: OCULTO(ROTULOS_DO_SALVAR.transformar),
      aviso: motivoMax,
    };
  }
  return {
    ...comum,
    modo: soOrcamento ? 'so_orcamento' : 'novo_pedido',
    principal: soOrcamento || (soOrcamentoPorItem && e.pre_venda_ligada) ? 'orcamento' : 'enviar',
    enviar: soOrcamento ? OCULTO(ROTULOS_DO_SALVAR.enviar) : { visivel: true, habilitado: podeEnviar, rotulo: ROTULOS_DO_SALVAR.enviar },
    apenasSalvar: { visivel: true, habilitado: true, rotulo: ROTULOS_DO_SALVAR.apenasSalvar },
    orcamento: {
      visivel: e.pre_venda_ligada || soOrcamento,
      habilitado: livre,
      rotulo: ROTULOS_DO_SALVAR.orcamento,
    },
    salvarOrcamento: OCULTO(ROTULOS_DO_SALVAR.salvarOrcamento),
    transformar: OCULTO(ROTULOS_DO_SALVAR.transformar),
    aviso: motivoMax ?? avisoSoOrcamento(e.cliente),
  };
}

/** RN-VEN-38: o rótulo do botão único da edição de pedido; a alçada não aparece no botão (RN-VEN-10, T-0151). */
function rotuloDaEdicao(e: EntradaDosBotoes): string {
  if (e.editando_no_servidor === false) return ROTULOS_DO_SALVAR.alteracoesNoAparelho;
  return ROTULOS_DO_SALVAR.alteracoes;
}
