/**
 * RF-VEN-11 / RN-VEN-38 (T-0137): quais botões o Resumo mostra e em que estado. Função pura, sem React: a tela só desenha.
 * Spec: docs/design/pedido-v2.md §2.2 e §2.3.
 *   novo pedido      Salvar (abre Orçamento ou Pedido) · Cancelar  (`botoesDoSalvarNovo`, R-20261124-114951)
 *   editar orçamento Salvar orçamento (principal) · Converter em pedido · Cancelar  (`botoesDaEdicao`)
 *   editar pedido    um botão só ("Salvar alterações") · Cancelar  (`botoesDaEdicao`)
 * O salvar é sempre tocável: a falta de preenchimento (RN-CORE-36) aparece no campo, na tentativa (a tela valida). Desligam só os
 * motivos de "só orçamento" por item (RN-VEN-11, RN-VEN-11a, RN-VEN-20), e só para enviar ou transformar.
 */
import { motivoSoOrcamento, type SituacaoCliente } from './orcamento';
import { mensagemAcimaDoMaximo, type NivelDePreco } from './preco-pedido';

/** RN-VEN-38 (RD-0036): os rótulos da edição de pedido e de orçamento, num mapa só (botões do Resumo, folha de saída e detalhe). */
export const ROTULOS_DA_EDICAO = {
  salvarOrcamento: 'Salvar orçamento',
  transformar: 'Converter em pedido',
  alteracoes: 'Salvar alterações',
  alteracoesNoAparelho: 'Salvar alterações no aparelho',
} as const;

/** RN-VEN-10 (T-0165, RD-0142): a alçada está na área Alertas (uma linha); a pergunta ao salvar só confirma o envio, sem repetir o fato. */
export const PERGUNTA_DA_ALCADA = { titulo: 'Enviar para aprovação?', enviar: 'Enviar', voltar: 'Voltar' } as const;

/** RN-VEN-10: só o pedido com desconto efetivo acima da alçada do autor pergunta; orçamento não tem alçada (RN-VEN-18). */
export function perguntaDaAlcada(e: { tipo: 'pedido' | 'orcamento'; nivel: NivelDePreco | null }): typeof PERGUNTA_DA_ALCADA | null {
  return e.tipo === 'pedido' && e.nivel !== null ? PERGUNTA_DA_ALCADA : null;
}

/**
 * RN-VEN-10 / RN-VEN-48: o "Enviar pedido" da aba Pedidos pergunta antes de enfileirar quando o nível (desconto + crédito) passa da alçada do autor;
 * dentro da alçada, envia direto. Quem já confirmou a pergunta nem chama esta função.
 */
export function precisaPerguntarAlcadaNoEnvioSalvo(e: { nivel: NivelDePreco | null }): boolean {
  return perguntaDaAlcada({ tipo: 'pedido', nivel: e.nivel }) !== null;
}

/** RN-VEN-11 (T-0151): o motivo numa linha, "AGU-1500 acima do desconto máximo". `null` = nenhum item acima do máximo. */
export function motivoDoMaximo(codigos: readonly string[] | undefined): string | null {
  return codigos && codigos.length > 0 ? mensagemAcimaDoMaximo(codigos) : null;
}

export interface ItensSoOrcamento {
  /** RN-VEN-11 (T-0151): códigos dos itens com desconto acima do máximo do produto; bloqueiam enviar e transformar (só orçamento) */
  itens_acima_do_maximo?: readonly string[];
  /** RN-VEN-11a (T-0168): o desconto efetivo passa do limite do pedido; só orçamento */
  acima_do_limite?: boolean;
  /** RN-VEN-20 (T-0150, 10/11): códigos dos itens sem estoque; entram no pedido, mas o pedido só sai como orçamento (igual ao máximo) */
  itens_sem_estoque?: readonly string[];
}

/**
 * RN-VEN-11/11a/20: o motivo, numa linha, de um item impedir ENVIAR como pedido. `null` = nenhum item impede. Os três testes moram aqui.
 * Com pré-venda o fim é "Edite o item ou salve como orçamento."; sem pré-venda (sem orçamento) a ação possível: ajustar ou retirar o item.
 */
export function motivoDoItemSoOrcamento(e: ItensSoOrcamento, pre_venda_ligada = true): string | null {
  const fim = (acao: string) => (pre_venda_ligada ? 'Edite o item ou salve como orçamento.' : acao);
  const max = motivoDoMaximo(e.itens_acima_do_maximo);
  if (max) return `${max}. ${fim('Ajuste o item para enviar.')}`;
  if (e.acima_do_limite === true) return `Pedido acima do desconto máximo. ${fim('Ajuste o item para enviar.')}`;
  const semEstoque = e.itens_sem_estoque ?? [];
  if (semEstoque.length > 0) return `${semEstoque.join(', ')} sem estoque. ${fim('Retire o item para enviar.')}`;
  return null;
}

/** RN-VEN-11/11a/20: algum item impede ENVIAR como pedido (só orçamento). Para o Resumo da edição e o Enviar da lista; o Salvar do Novo pedido não usa. */
export function soOrcamentoPorItem(e: ItensSoOrcamento): boolean {
  return motivoDoItemSoOrcamento(e) !== null;
}

/**
 * RN-VEN-48: o "Enviar pedido" da aba Pedidos revalida com as mesmas regras do envio (cliente RN-VEN-13, itens RN-VEN-11/11a/20).
 * `null` = pode entrar na fila; senão, o motivo numa linha (o pedido salvo continua salvo).
 */
export function motivoDeNaoEnviarOSalvo(e: ItensSoOrcamento & { cliente: SituacaoCliente; pre_venda_ligada: boolean; pendencias_de_preenchimento?: readonly string[] }): string | null {
  const cliente = motivoSoOrcamento(e.cliente);
  if (cliente) {
    if (e.pre_venda_ligada) return `${cliente} Só orçamento.`;
    // sem pré-venda: só o cadastro incompleto tem ação possível (bloqueado e inativo ficam sem ação)
    return e.cliente.ativo && !e.cliente.bloqueado && e.cliente.cadastro_incompleto ? `${cliente} Complete o cadastro para enviar.` : cliente;
  }
  // RN-CORE-36: o pedido do Campo grava com pendência, mas só entra na fila com tudo preenchido (textos de `pendenciasDePreenchimento`)
  const falta = e.pendencias_de_preenchimento ?? [];
  if (falta.length > 0) return `Falta preencher ${falta.join(', ')}. Edite o pedido para enviar.`;
  return motivoDoItemSoOrcamento(e, e.pre_venda_ligada);
}

export type ModoDaEdicao = 'editar_orcamento' | 'editar_pedido';

export interface BotaoDoResumo {
  visivel: boolean;
  habilitado: boolean;
  rotulo: string;
}

export type EntradaDaEdicao = ItensSoOrcamento & { cliente: SituacaoCliente; editando: 'pedido' | 'orcamento'; editando_no_servidor?: boolean };

/** Os botões da EDIÇÃO de pedido ou orçamento existente (o Novo pedido tem `botoesDoSalvarNovo`). */
export interface BotoesDaEdicao {
  modo: ModoDaEdicao;
  /** o botão de largura total e nível principal */
  principal: 'salvar_alteracoes' | 'salvar_orcamento';
  salvarAlteracoes: BotaoDoResumo;
  salvarOrcamento: BotaoDoResumo;
  transformar: BotaoDoResumo;
  cancelar: true;
}

const OCULTO = (rotulo: string): BotaoDoResumo => ({ visivel: false, habilitado: false, rotulo });

export function botoesDaEdicao(e: EntradaDaEdicao): BotoesDaEdicao {
  // RN-VEN-11 (T-0151): desconto acima do máximo do produto não passa nem com aprovação; só o orçamento salva
  const podeEnviar = !soOrcamentoPorItem(e);
  if (e.editando === 'orcamento') {
    return {
      cancelar: true,
      modo: 'editar_orcamento',
      principal: 'salvar_orcamento',
      salvarAlteracoes: OCULTO(ROTULOS_DA_EDICAO.alteracoes),
      salvarOrcamento: { visivel: true, habilitado: true, rotulo: ROTULOS_DA_EDICAO.salvarOrcamento },
      transformar: { visivel: motivoSoOrcamento(e.cliente) === null, habilitado: podeEnviar, rotulo: ROTULOS_DA_EDICAO.transformar },
    };
  }
  return {
    cancelar: true,
    modo: 'editar_pedido',
    principal: 'salvar_alteracoes',
    // RN-VEN-38: o rótulo do botão único da edição de pedido; a alçada não aparece no botão (RN-VEN-10, T-0151)
    salvarAlteracoes: { visivel: true, habilitado: podeEnviar, rotulo: e.editando_no_servidor === false ? ROTULOS_DA_EDICAO.alteracoesNoAparelho : ROTULOS_DA_EDICAO.alteracoes },
    salvarOrcamento: OCULTO(ROTULOS_DA_EDICAO.salvarOrcamento),
    transformar: OCULTO(ROTULOS_DA_EDICAO.transformar),
  };
}

/**
 * RN-VEN-38 (R-20261124-114951): o Resumo do Novo pedido tem só "Salvar" e "Cancelar". O "Salvar" abre a escolha
 * Orçamento ou Pedido; o Pedido grava o pedido SALVO, sem enviar, no Campo e no Gestão
 * (o envio é da aba Pedidos, RN-VEN-48). Função pura.
 *  - Pedido aceita pendências e só some quando o cliente só permite orçamento (RN-VEN-13).
 *    Item só-orçamento (RN-VEN-11/11a/20) não impede salvar; impede ENVIAR (`motivoDeNaoEnviarOSalvo`, na aba Pedidos);
 *  - Orçamento aparece com a pré-venda ligada ou cliente só-orçamento (RN-VEN-13).
 * Com uma opção só tocável, o Salvar grava direto (`direto`), sem a folha.
 * T-0198 (R-20261125-215618): sem nenhum item o Salvar fica desligado, com o motivo; o primeiro item o liga.
 */
export const ROTULOS_DO_SALVAR_NOVO = { salvar: 'Salvar', cancelar: 'Cancelar', titulo: 'Salvar como', orcamento: 'Orçamento', pedido: 'Pedido', semItens: 'Adicione um item para salvar.' } as const;

export type QualSalvar = 'orcamento' | 'pedido';

/** Opção da folha do Salvar: aparece (tocável) ou não aparece; nunca fica desligada. */
export interface OpcaoDoSalvar {
  visivel: boolean;
  rotulo: string;
}

export interface BotoesDoSalvarNovo {
  /** `motivo` = por que está desligado (`null` quando liga) */
  salvar: { rotulo: string; habilitado: boolean; motivo: string | null };
  escolha: { titulo: string; orcamento: OpcaoDoSalvar; pedido: OpcaoDoSalvar };
  /** `null` = o Salvar abre a folha; senão grava direto neste tipo */
  direto: QualSalvar | null;
}

/**
 * `pre_venda_ligada`: tenant com orçamento (pré-venda); o cliente da RN-VEN-13 sempre vê o orçamento. `itens`: linhas com
 * quantidade (a tela sempre passa; ausente = quem só lê a escolha, como a folha de saída).
 */
export function botoesDoSalvarNovo(e: { cliente: SituacaoCliente; pre_venda_ligada: boolean; itens?: number }): BotoesDoSalvarNovo {
  const soOrcamento = motivoSoOrcamento(e.cliente) !== null;
  const comItem = (e.itens ?? 1) > 0;
  // o Pedido grava o pedido SALVO, sem enviar: o item só-orçamento não impede salvar (impede enviar, na aba Pedidos)
  const pedidoVisivel = !soOrcamento;
  const orcamentoVisivel = e.pre_venda_ligada || soOrcamento;
  const direto: QualSalvar | null = pedidoVisivel && orcamentoVisivel ? null : pedidoVisivel ? 'pedido' : 'orcamento';
  return {
    salvar: { rotulo: ROTULOS_DO_SALVAR_NOVO.salvar, habilitado: comItem, motivo: comItem ? null : ROTULOS_DO_SALVAR_NOVO.semItens },
    escolha: {
      titulo: ROTULOS_DO_SALVAR_NOVO.titulo,
      orcamento: { visivel: orcamentoVisivel, rotulo: ROTULOS_DO_SALVAR_NOVO.orcamento },
      pedido: { visivel: pedidoVisivel, rotulo: ROTULOS_DO_SALVAR_NOVO.pedido },
    },
    direto,
  };
}
