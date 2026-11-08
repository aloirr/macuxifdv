/**
 * RF-VEN-11 / RN-VEN-38 (T-0137): quais botões o Resumo do Novo pedido mostra e em que estado. Função pura, sem React: a tela só
 * desenha. Spec: docs/design/pedido-v2.md §2.2 e §2.3.
 *   novo pedido      Salvar e enviar pedido (principal, com o destino) · Apenas salvar · Salvar como orçamento · Cancelar
 *   RN-VEN-13        Salvar como orçamento (principal, "Válido até dd/mm") · Apenas salvar · Cancelar
 *   editar orçamento Salvar orçamento (principal) · Transformar em pedido · Cancelar
 *   editar pedido    um botão só ("Salvar alterações") · Cancelar
 * Pendência (RN-CORE-36) desliga tudo o que valida; Apenas salvar grava `rascunho` e aceita pendências.
 */
import { motivoSoOrcamento, type SituacaoCliente } from './orcamento';
import type { NivelDePreco } from './preco-pedido';
import { avisoSoOrcamento } from './sair-do-pedido';

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
  /** AAAA-MM-DD da validade do orçamento novo */
  validade_data: string;
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
      enviar: OCULTO('Salvar e enviar pedido'),
      apenasSalvar: OCULTO('Apenas salvar'),
      orcamento: OCULTO('Salvar como orçamento'),
      salvarOrcamento: { visivel: true, habilitado: livre, rotulo: 'Salvar orçamento', destino: null },
      transformar: { visivel: !soOrcamento, habilitado: livre, rotulo: 'Transformar em pedido', destino: null },
      aviso: avisoSoOrcamento(e.cliente),
    };
  }
  if (e.editando === 'pedido') {
    return {
      ...comum,
      modo: 'editar_pedido',
      principal: 'enviar',
      enviar: { visivel: true, habilitado: livre, rotulo: 'Salvar alterações', destino: null },
      apenasSalvar: OCULTO('Apenas salvar'),
      orcamento: OCULTO('Salvar como orçamento'),
      salvarOrcamento: OCULTO('Salvar orçamento'),
      transformar: OCULTO('Transformar em pedido'),
      aviso: null,
    };
  }
  return {
    ...comum,
    modo: soOrcamento ? 'so_orcamento' : 'novo_pedido',
    principal: soOrcamento ? 'orcamento' : 'enviar',
    enviar: soOrcamento ? OCULTO('Salvar e enviar pedido') : { visivel: true, habilitado: livre, rotulo: 'Salvar e enviar pedido', destino: livre ? destinoDoEnvio(e.nivel) : null },
    apenasSalvar: { visivel: true, habilitado: true, rotulo: 'Apenas salvar', destino: null },
    orcamento: {
      visivel: e.pre_venda_ligada || soOrcamento,
      habilitado: livre,
      rotulo: 'Salvar como orçamento',
      destino: soOrcamento && livre ? `Válido até ${dataCurta(e.validade_data)}` : null,
    },
    salvarOrcamento: OCULTO('Salvar orçamento'),
    transformar: OCULTO('Transformar em pedido'),
    aviso: avisoSoOrcamento(e.cliente),
  };
}

function dataCurta(aaaaMmDd: string): string {
  const [, m, d] = aaaaMmDd.split('-');
  return `${d}/${m}`;
}
