/**
 * RF-VEN-11 / RN-VEN-38 (T-0137): quais botões o Resumo do Novo pedido mostra e em que estado. Função pura, sem React: a tela só
 * desenha. Spec: docs/design/pedido-v2.md §2.2 e §2.3.
 *   novo pedido      Salvar e enviar pedido (principal, com o destino) · Apenas salvar · Salvar como orçamento · Cancelar
 *   RN-VEN-13        Salvar como orçamento (principal, "Válido até dd/mm") · Apenas salvar · Cancelar
 *   editar orçamento Salvar orçamento (principal) · Transformar em pedido · Cancelar
 *   editar pedido    um botão só ("Salvar alterações", com o destino embaixo) · Cancelar
 * Pendência (RN-CORE-36) desliga tudo o que valida; Apenas salvar grava `rascunho` e aceita pendências.
 */
import { avisoSoOrcamento, motivoSoOrcamento, type SituacaoCliente } from './orcamento';
import type { NivelDePreco } from './preco-pedido';

/** RN-VEN-38 (RD-0036): os rótulos dos botões de salvar, num mapa só (botões do Resumo, folha de saída e tela). */
export const ROTULOS_DO_SALVAR = {
  enviar: 'Salvar e enviar pedido',
  apenasSalvar: 'Apenas salvar',
  orcamento: 'Salvar como orçamento',
  salvarOrcamento: 'Salvar orçamento',
  transformar: 'Transformar em pedido',
  alteracoes: 'Salvar alterações',
  alteracoesNoAparelho: 'Salvar alterações no aparelho',
  paraAprovacao: 'Salvar e enviar para aprovação',
} as const;

export const DESTINO_DIRETO_ERP = 'Vai direto ao ERP';
const DESTINO_POR_NIVEL = {
  supervisor: 'Vai para o supervisor',
  gerente: 'Vai para o gerente',
  analista: 'Vai para o analista',
} as const satisfies Record<NivelDePreco, string>;

/** RN-VEN-10: o destino escrito sob o botão principal. */
export function destinoDoEnvio(nivel: NivelDePreco | null): string {
  return nivel ? DESTINO_POR_NIVEL[nivel] : DESTINO_DIRETO_ERP;
}

export type ModoDoResumo = 'novo_pedido' | 'so_orcamento' | 'editar_orcamento' | 'editar_pedido';
export type QualBotao = 'enviar' | 'orcamento' | 'salvar_orcamento';

export interface BotaoDoResumo {
  visivel: boolean;
  habilitado: boolean;
  rotulo: string;
  /** texto sob o botão (destino ou validade); `null` = nada */
  destino: string | null;
}

export interface EntradaDosBotoes {
  cliente: SituacaoCliente;
  /** tenant com orçamento (pré-venda); o cliente da RN-VEN-13 sempre vê o orçamento */
  pre_venda_ligada: boolean;
  /** `null` = Novo pedido; senão, o tipo do documento em edição */
  editando: 'pedido' | 'orcamento' | null;
  pendencias: number;
  nivel: NivelDePreco | null;
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

const OCULTO = (rotulo: string): BotaoDoResumo => ({ visivel: false, habilitado: false, rotulo, destino: null });

export function botoesDoResumo(e: EntradaDosBotoes): BotoesDoResumo {
  const soOrcamento = motivoSoOrcamento(e.cliente) !== null;
  const livre = e.pendencias === 0;
  const comum = { cancelar: true as const, pendencias: e.pendencias };

  if (e.editando === 'orcamento') {
    return {
      ...comum,
      modo: 'editar_orcamento',
      principal: 'salvar_orcamento',
      enviar: OCULTO(ROTULOS_DO_SALVAR.enviar),
      apenasSalvar: OCULTO(ROTULOS_DO_SALVAR.apenasSalvar),
      orcamento: OCULTO(ROTULOS_DO_SALVAR.orcamento),
      salvarOrcamento: { visivel: true, habilitado: livre, rotulo: ROTULOS_DO_SALVAR.salvarOrcamento, destino: null },
      transformar: { visivel: !soOrcamento, habilitado: livre, rotulo: ROTULOS_DO_SALVAR.transformar, destino: null },
      aviso: avisoSoOrcamento(e.cliente),
    };
  }
  if (e.editando === 'pedido') {
    return {
      ...comum,
      modo: 'editar_pedido',
      principal: 'enviar',
      enviar: { visivel: true, habilitado: livre, rotulo: rotuloDaEdicao(e), destino: livre ? destinoDoEnvio(e.nivel) : null },
      apenasSalvar: OCULTO(ROTULOS_DO_SALVAR.apenasSalvar),
      orcamento: OCULTO(ROTULOS_DO_SALVAR.orcamento),
      salvarOrcamento: OCULTO(ROTULOS_DO_SALVAR.salvarOrcamento),
      transformar: OCULTO(ROTULOS_DO_SALVAR.transformar),
      aviso: null,
    };
  }
  return {
    ...comum,
    modo: soOrcamento ? 'so_orcamento' : 'novo_pedido',
    principal: soOrcamento ? 'orcamento' : 'enviar',
    enviar: soOrcamento ? OCULTO(ROTULOS_DO_SALVAR.enviar) : { visivel: true, habilitado: livre, rotulo: ROTULOS_DO_SALVAR.enviar, destino: livre ? destinoDoEnvio(e.nivel) : null },
    apenasSalvar: { visivel: true, habilitado: true, rotulo: ROTULOS_DO_SALVAR.apenasSalvar, destino: null },
    orcamento: {
      visivel: e.pre_venda_ligada || soOrcamento,
      habilitado: livre,
      rotulo: ROTULOS_DO_SALVAR.orcamento,
      destino: null,
    },
    salvarOrcamento: OCULTO(ROTULOS_DO_SALVAR.salvarOrcamento),
    transformar: OCULTO(ROTULOS_DO_SALVAR.transformar),
    aviso: avisoSoOrcamento(e.cliente),
  };
}

/** RN-VEN-38: o rótulo do botão único da edição de pedido (para onde as alterações vão). */
function rotuloDaEdicao(e: EntradaDosBotoes): string {
  if (e.editando_no_servidor === false) return ROTULOS_DO_SALVAR.alteracoesNoAparelho;
  return e.nivel !== null ? ROTULOS_DO_SALVAR.paraAprovacao : ROTULOS_DO_SALVAR.alteracoes;
}
