/**
 * O que o monitor do BKO mostra (RF-INT-04, RF-INT-06): saúde de cada Conector e os alertas, com a causa e a ação seguinte em
 * português. As consultas ficam na API; aqui só a classificação.
 */
import type { AlertaMonitor, Entidade, SaudeConector } from '../contracts';
import type { SituacaoVersaoConector } from './conector-versao';
import { PARAMETROS_PADRAO } from './parametros';

export interface ConectorParaSaude {
  /** `nuvem` = credencial de API (o ERP chama o Hub): não manda sinal de vida. Ausente = Conector instalado no cliente. */
  tipo?: 'conector' | 'nuvem' | 'arquivo';
  ativo: boolean;
  ultimo_sinal_em: string | null;
  parado_por_versao: boolean;
}

/**
 * Sinal de vida a cada 1 min: `ok` até [3 min]; `atrasado` de 3 a [15 min]; `sem_sinal` a partir de 15 min (alerta no BKO, doc 06).
 * Sem sinal vence "parado por versão" (o Conector nem está no ar).
 * RN-INT-10: a credencial de API (`tipo = 'nuvem'`) não tem sinal de vida; fica `ok` enquanto ativa e `desativado` quando revogada.
 */
export function avaliarSaudeConector(c: ConectorParaSaude, agora: string, opcoes: { atrasadoMin?: number; alertaMin?: number } = {}): SaudeConector {
  const atrasado = opcoes.atrasadoMin ?? PARAMETROS_PADRAO.sinalAtrasadoMin;
  const alerta = opcoes.alertaMin ?? PARAMETROS_PADRAO.sinalAlertaMin;
  if (!c.ativo) return 'desativado';
  if (c.tipo === 'nuvem') return 'ok';
  if (c.ultimo_sinal_em === null) return 'nunca_conectou';
  const minutos = (Date.parse(agora) - Date.parse(c.ultimo_sinal_em)) / 60_000;
  if (minutos >= alerta) return 'sem_sinal';
  if (c.parado_por_versao) return 'parado_por_versao';
  if (minutos >= atrasado) return 'atrasado';
  return 'ok';
}

export interface ConectorParaAlerta extends ConectorParaSaude {
  conector_id: string;
  situacao_versao: SituacaoVersaoConector;
  /** A chave anterior de uma rotação ainda é aceita (convivência em curso). */
  chave_anterior_em_uso?: boolean;
}

export interface EntradaAlertas {
  agora: string;
  conectores: readonly ConectorParaAlerta[];
  lotesFalhosUltimas24h: readonly { entidade: Entidade; conector_id: string }[];
  pendenciasInativacao: readonly { entidade: Entidade; conector_id: string; candidatos: number; percentual: number; estado: string }[];
  reconciliacoesDivergentes: readonly { entidade: Entidade; data_referencia: string; motivos: readonly string[] }[];
  pedidos: {
    presos: readonly string[];
    retidos: readonly string[];
    /** Subconjunto de `retidos` retido por cadastro (cliente/vendedor/produto sem external_id, ou dado fora do contrato), não por de-para (T-0032). */
    retidosPorCadastro?: readonly string[];
  };
  /**
   * P-4 (T-0031): erros de itens faturados descartados nas últimas 24 h (`ErroRetornoMonitor`, um por item). Opcional: ausente
   * = nenhum.
   */
  retornosComItensDescartados24h?: readonly { pedido_uuid: string; produto_external_id: string }[];
  /** ADR 0016: pedidos na fila que esperam um Conector mais novo (`pedidosAguardandoConector`). Opcional: ausente = nenhum. */
  pedidosAguardandoConector?: { pedidos: readonly string[]; exigida: string | null };
  /** T-0114: cancelamentos que o ERP recusou e que seguem sem desfecho (pedido ainda não cancelado). Opcional: ausente = nenhum. */
  cancelamentosRecusados?: readonly { pedido_uuid: string; numero_erp: string | null; motivo: string }[];
}

const PESO = { critico: 0, atencao: 1, info: 2 } as const;

export function montarAlertasMonitor(e: EntradaAlertas): AlertaMonitor[] {
  const a: AlertaMonitor[] = [];
  const novo = (x: AlertaMonitor) => a.push(x);

  for (const c of e.conectores) {
    if (!c.ativo) continue;
    const saude = avaliarSaudeConector(c, e.agora);
    if (saude === 'sem_sinal') {
      novo({ codigo: 'conector_sem_sinal', severidade: 'critico', conector_id: c.conector_id, entidade: null, mensagem: `O Conector ${c.conector_id} está há ${PARAMETROS_PADRAO.sinalAlertaMin} minutos ou mais sem sinal de vida. Verifique se o serviço "Macuxi Conector" está em execução no servidor do cliente e se há saída HTTPS para o Hub.` });
    } else if (saude === 'nunca_conectou') {
      novo({ codigo: 'conector_nunca_conectou', severidade: 'atencao', conector_id: c.conector_id, entidade: null, mensagem: `O Conector ${c.conector_id} foi cadastrado e ainda não enviou nenhum sinal. Conclua a instalação no servidor do cliente e grave a chave de API (conector segredo definir hub_chave).` });
    } else if (saude === 'parado_por_versao' || c.situacao_versao === 'abaixo_da_minima') {
      novo({ codigo: 'conector_parado_por_versao', severidade: 'critico', conector_id: c.conector_id, entidade: null, mensagem: `O Conector ${c.conector_id} está abaixo da versão mínima exigida e parou de enviar dados (a fila local guarda tudo). Instale o pacote da versão recomendada no servidor do cliente.` });
    }
    if (saude !== 'sem_sinal' && saude !== 'nunca_conectou' && c.situacao_versao === 'desatualizado') {
      novo({ codigo: 'conector_desatualizado', severidade: 'atencao', conector_id: c.conector_id, entidade: null, mensagem: `O Conector ${c.conector_id} tem uma versão mais nova disponível. Ele segue funcionando; planeje a atualização.` });
    }
    if (c.chave_anterior_em_uso) {
      novo({ codigo: 'chave_em_convivencia', severidade: 'info', conector_id: c.conector_id, entidade: null, mensagem: `O Conector ${c.conector_id} ainda usa a chave anterior (rotação em andamento). Grave a chave nova no Conector e revogue a antiga em Integração ERP > Conectores.` });
    }
  }

  const falhos = new Map<string, { entidade: Entidade; conector_id: string; n: number }>();
  for (const l of e.lotesFalhosUltimas24h) {
    const k = `${l.entidade}|${l.conector_id}`;
    const atual = falhos.get(k);
    falhos.set(k, { entidade: l.entidade, conector_id: l.conector_id, n: (atual?.n ?? 0) + 1 });
  }
  for (const f of falhos.values()) {
    novo({ codigo: 'lotes_falhos', severidade: 'atencao', conector_id: f.conector_id, entidade: f.entidade, mensagem: `${f.n} lote${f.n > 1 ? 's' : ''} de ${f.entidade} falhou nas últimas 24 h. Abra o lote no monitor, veja o motivo e use "Reprocessar" ou corrija no ERP.` });
  }

  for (const p of e.pendenciasInativacao) {
    if (p.estado !== 'aguardando') continue;
    novo({ codigo: 'inativacao_aguardando_confirmacao', severidade: 'atencao', conector_id: p.conector_id, entidade: p.entidade, mensagem: `A carga completa de ${p.entidade} inativaria ${p.candidatos} registro(s) (${p.percentual}% dos ativos) e está aguardando confirmação. Confira a lista no monitor e confirme ou recuse.` });
  }

  for (const r of e.reconciliacoesDivergentes) {
    novo({ codigo: 'reconciliacao_divergente', severidade: 'critico', conector_id: null, entidade: r.entidade, mensagem: `A reconciliação de ${r.entidade} em ${r.data_referencia} divergiu do ERP (${r.motivos.join(', ')}). Confira os lotes recentes; se persistir, peça uma carga completa da entidade.` });
  }

  const presos = e.pedidos.presos.length;
  if (presos > 0) {
    novo({ codigo: 'pedido_preso', severidade: 'atencao', conector_id: null, entidade: null, mensagem: `${presos} pedido${presos > 1 ? 's' : ''} entregue${presos > 1 ? 's' : ''} ao Conector sem confirmação do ERP depois de várias tentativas. Verifique o Conector e o ERP (conector status).` });
  }
  const retidos = e.pedidos.retidos.length;
  if (retidos > 0) {
    const porChave = new Set(e.pedidos.retidosPorCadastro ?? []);
    const nChave = e.pedidos.retidos.filter((p) => porChave.has(p)).length;
    const nMapa = retidos - nChave;
    const pl = (n: number) => `${n} pedido${n > 1 ? 's' : ''} aprovado${n > 1 ? 's' : ''} retido${n > 1 ? 's' : ''}`;
    const partes: string[] = [];
    if (nMapa > 0) partes.push(`${pl(nMapa)} por falta de mapeamento (ex.: condição de pagamento). Cadastre em Integração ERP > Mapeamento; os pedidos seguem sozinhos.`);
    if (nChave > 0) partes.push(`${pl(nChave)} por cadastro incompleto (faltam as chaves do ERP: cliente, vendedor ou produto sem código do ERP; ou dado fora do contrato). Complete o cadastro e, para cada pedido, cancele-o e refaça-o (duplique): o pedido retido não segue sozinho.`);
    novo({ codigo: 'pedido_retido_sem_mapeamento', severidade: 'atencao', conector_id: null, entidade: null, mensagem: partes.join(' ') });
  }

  const aguardando = e.pedidosAguardandoConector?.pedidos.length ?? 0;
  if (aguardando > 0) {
    const versao = e.pedidosAguardandoConector?.exigida ?? '1.3.0';
    novo({ codigo: 'pedido_aguardando_conector', severidade: 'atencao', conector_id: null, entidade: null, mensagem: `${aguardando} pedido${aguardando > 1 ? 's' : ''} ${aguardando > 1 ? 'esperam' : 'espera'} o Conector ${versao} ou mais novo (venda por embalagem, acréscimo, frete FOB ou endereço de entrega). Nada se perdeu: atualize o Conector no servidor do cliente e ${aguardando > 1 ? 'os pedidos saem' : 'o pedido sai'} na próxima consulta.` });
  }

  const descartes = e.retornosComItensDescartados24h ?? [];
  if (descartes.length > 0) {
    const pedidos = new Set(descartes.map((d) => d.pedido_uuid)).size;
    const itens = descartes.length;
    novo({ codigo: 'retorno_com_itens_descartados', severidade: 'atencao', conector_id: null, entidade: null, mensagem: `${itens} ${itens > 1 ? 'itens' : 'item'} faturado${itens > 1 ? 's' : ''} de ${pedidos} pedido${pedidos > 1 ? 's' : ''} ${itens > 1 ? 'ficaram' : 'ficou'} de fora do retorno do ERP nas últimas 24 h (sequência, produto ou quantidade não batem com o pedido enviado). O status dos pedidos foi atualizado. Abra Integração ERP > Pedidos > Erros de retorno, confira a consulta de itens da nota no Conector e o pedido no ERP.` });
  }

  const recusados = e.cancelamentosRecusados ?? [];
  if (recusados.length > 0) {
    const MOSTRAR = 3;
    const nomes = recusados.slice(0, MOSTRAR).map((r) => `${r.numero_erp ?? r.pedido_uuid} (${r.motivo})`).join('; ');
    const mais = recusados.length > MOSTRAR ? ` e mais ${recusados.length - MOSTRAR}` : '';
    const pl = recusados.length > 1;
    // RD-0026: uma frase só; o UUID aparece apenas quando falta o número do ERP
    novo({ codigo: 'cancelamento_recusado', severidade: 'atencao', conector_id: null, entidade: null, mensagem: `${recusados.length} pedido${pl ? 's seguem ativos' : ' segue ativo'}: ${nomes}${mais}. Cancele no ERP ou avise o vendedor. O alerta some quando o cancelamento chegar.` });
  }

  return a.map((x, i) => ({ x, i })).sort((p, q) => PESO[p.x.severidade] - PESO[q.x.severidade] || p.i - q.i).map(({ x }) => x);
}
