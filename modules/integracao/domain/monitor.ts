/**
 * O que o monitor do BKO mostra (RF-INT-04, RF-INT-06): saúde de cada Conector e os alertas, com a causa e a ação seguinte em
 * português. As consultas ficam na API; aqui só a classificação.
 */
import type { AlertaMonitor, Entidade, SaudeConector } from '../contracts';
import type { SituacaoVersaoConector } from './conector-versao';
import { PARAMETROS_PADRAO } from './parametros';

export interface ConectorParaSaude {
  ativo: boolean;
  ultimo_sinal_em: string | null;
  parado_por_versao: boolean;
}

/**
 * Sinal de vida a cada 1 min: `ok` até [3 min]; `atrasado` de 3 a [15 min]; `sem_sinal` a partir de 15 min (alerta no BKO, doc 06).
 * Sem sinal vence "parado por versão" (o Conector nem está no ar).
 */
export function avaliarSaudeConector(c: ConectorParaSaude, agora: string, opcoes: { atrasadoMin?: number; alertaMin?: number } = {}): SaudeConector {
  const atrasado = opcoes.atrasadoMin ?? PARAMETROS_PADRAO.sinalAtrasadoMin;
  const alerta = opcoes.alertaMin ?? PARAMETROS_PADRAO.sinalAlertaMin;
  if (!c.ativo) return 'desativado';
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
  pedidos: { presos: readonly string[]; retidos: readonly string[] };
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
    novo({ codigo: 'pedido_retido_sem_mapeamento', severidade: 'atencao', conector_id: null, entidade: null, mensagem: `${retidos} pedido${retidos > 1 ? 's' : ''} aprovado${retidos > 1 ? 's' : ''} retido${retidos > 1 ? 's' : ''} por falta de mapeamento (ex.: condição de pagamento). Cadastre em Integração ERP > Mapeamento; os pedidos seguem sozinhos.` });
  }

  return a.map((x, i) => ({ x, i })).sort((p, q) => PESO[p.x.severidade] - PESO[q.x.severidade] || p.i - q.i).map(({ x }) => x);
}
