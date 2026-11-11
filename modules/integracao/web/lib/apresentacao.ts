/**
 * Apresentação do monitor do Hub no BKO (T-0051; RF-INT-04, RF-INT-06): rótulos em português, tons dos selos, tempo desde o último
 * sinal e o que a tela permite fazer. Funções puras e testadas. As REGRAS vêm do domain (`autorizarAcaoIntegracao` — P-3;
 * `situacaoPendencia` — RN-INT-06): aqui só se compõe a resposta para a interface. A proteção real continua na API.
 */
import { PERFIS, type Perfil } from '@macuxi/platform-sdk';
import type { BadgeTone } from '@macuxi/ui/web';
import type {
  AlertaMonitor,
  AtualizacaoConector,
  Entidade,
  EstadoLote,
  EstadoPedidoErp,
  MonitorResumo,
  PendenciaInativacao,
  SaudeConector,
  SITUACOES_VERSAO_CONECTOR,
} from '../../contracts';
import { autorizarAcaoIntegracao, situacaoPendencia, type AcaoIntegracao } from '../../domain';

type SituacaoVersao = (typeof SITUACOES_VERSAO_CONECTOR)[number];
type EstadoCarga = MonitorResumo['cargas'][number]['estado'];

export const ROTULO_SAUDE: Record<SaudeConector, string> = {
  ok: 'No ar',
  atrasado: 'Sinal atrasado',
  sem_sinal: 'Sem sinal',
  parado_por_versao: 'Parado por versão',
  nunca_conectou: 'Nunca conectou',
  desativado: 'Desativado',
};

export const TOM_SAUDE: Record<SaudeConector, BadgeTone> = {
  ok: 'success',
  atrasado: 'warning',
  sem_sinal: 'danger',
  parado_por_versao: 'danger',
  nunca_conectou: 'warning',
  desativado: 'neutral',
};

export const ROTULO_SITUACAO_VERSAO: Record<SituacaoVersao, string> = {
  sem_politica: 'Sem política de versão',
  versao_ilegivel: 'Versão não informada',
  em_dia: 'Em dia',
  desatualizado: 'Desatualizado',
  abaixo_da_minima: 'Abaixo da mínima',
};

export const TOM_SITUACAO_VERSAO: Record<SituacaoVersao, BadgeTone> = {
  sem_politica: 'neutral',
  versao_ilegivel: 'neutral',
  em_dia: 'success',
  desatualizado: 'warning',
  abaixo_da_minima: 'danger',
};

export const ROTULO_STATUS_LOTE: Record<EstadoLote, string> = {
  recebido: 'Recebido',
  processando: 'Processando',
  concluido: 'Aplicado',
  concluido_com_erros: 'Aplicado com erros',
  falhou: 'Falhou',
};

export const TOM_STATUS_LOTE: Record<EstadoLote, BadgeTone> = {
  recebido: 'pending',
  processando: 'pending',
  concluido: 'success',
  concluido_com_erros: 'warning',
  falhou: 'danger',
};

export const ROTULO_ENTIDADE: Record<Entidade, string> = {
  vendedor: 'Vendedores',
  cliente: 'Clientes',
  produto: 'Produtos',
  preco: 'Preços',
  estoque: 'Estoque',
  titulo: 'Títulos',
  nota: 'Notas fiscais',
  rota: 'Rotas',
  catalogo_no: 'Árvore do catálogo',
  produto_unidade: 'Unidades do produto',
  cliente_endereco: 'Endereços de clientes',
  transportadora: 'Transportadoras',
  forma_pagamento: 'Formas de pagamento',
  prazo_pagamento: 'Prazos de pagamento',
  tabela_escalonada: 'Tabela escalonada',
  filial: 'Filiais',
};

export const ROTULO_AVISO_LINHA: Record<string, string> = {
  duplicado_no_lote: 'Repetido no lote',
  cadastro_incompleto: 'Cadastro incompleto',
  referencia_fraca_ausente: 'Produto sem nó do catálogo',
  aplicacao_cortada: 'Aplicação cortada em 2.000 caracteres',
  referencias_cortadas: 'Referências cortadas em 3',
  referencia_descartada: 'Referência sem marca ou com código inválido descartada',
  oferece_junto_cortado: 'Oferece junto cortado em 5',
  prazo_medio_divergente: 'Prazo médio diferente do calculado',
  marca_concorrente_desconhecida: 'Marca concorrente não cadastrada',
  avisos_omitidos: 'Outros avisos não mostrados',
};

export const ROTULO_TIPO_MAPEAMENTO: Record<'condicao_pagamento' | 'deposito' | 'status' | 'canal', string> = {
  condicao_pagamento: 'Condição de pagamento',
  deposito: 'Depósito',
  status: 'Status',
  canal: 'Canal do cliente',
};

export const ROTULO_ALERTA_PEDIDO_AGUARDANDO_CONECTOR = 'Pedido aguardando o Conector';

export const ROTULO_ESTADO_CARGA: Record<EstadoCarga, string> = {
  sem_lotes: 'Sem lotes',
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  concluida_com_erros: 'Concluída com erros',
  falhou: 'Falhou',
};

export const TOM_ESTADO_CARGA: Record<EstadoCarga, BadgeTone> = {
  sem_lotes: 'neutral',
  pendente: 'neutral',
  em_andamento: 'pending',
  concluida: 'success',
  concluida_com_erros: 'warning',
  falhou: 'danger',
};

export const ROTULO_ESTADO_PEDIDO: Record<EstadoPedidoErp, string> = {
  pendente: 'Na fila',
  enviado: 'Entregue ao Conector',
  integrado: 'Integrado no ERP',
  rejeitado_erp: 'Rejeitado pelo ERP',
  faturado_parcial: 'Faturado parcial',
  faturado_total: 'Faturado',
  cancelado: 'Cancelado',
};

export const TOM_SEVERIDADE: Record<AlertaMonitor['severidade'], BadgeTone> = { critico: 'danger', atencao: 'warning', info: 'neutral' };
export const ROTULO_SEVERIDADE: Record<AlertaMonitor['severidade'], string> = { critico: 'Crítico', atencao: 'Atenção', info: 'Info' };

/** "há 16 min" desde o instante, contra o relógio injetado (nunca `Date.now()` direto: a tela passa o relógio). */
export function tempoDesde(iso: string | null | undefined, agora: Date): string {
  if (!iso) return 'nunca';
  const min = Math.floor((agora.getTime() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min) || min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

/** Perfil do login do Core (`useSession`), só se for um perfil conhecido. */
export function perfilDaSessao(p: string | null | undefined): Perfil | null {
  return (PERFIS as readonly string[]).includes(p ?? '') ? (p as Perfil) : null;
}

/** P-3: a ação aparece habilitada para o perfil? (mesma tabela do domain; a API revalida.) */
export function podeExecutar(acao: AcaoIntegracao, perfil: Perfil | null): boolean {
  return perfil !== null && autorizarAcaoIntegracao(acao, perfil).ok;
}

export type DecisaoNaTela = { pode: true } | { pode: false; motivo: string };

const ROTULO_DECIDIDA: Record<Exclude<PendenciaInativacao['estado'], 'aguardando' | 'expirada'>, string> = { confirmada: 'confirmada', recusada: 'recusada' };

/**
 * RN-INT-06 (P-3): confirmar ou recusar a inativação em massa só com perfil admin/analista (`autorizarAcaoIntegracao`), só a
 * pendência `aguardando` e dentro da validade (`situacaoPendencia` do domain, contra o relógio injetado).
 */
export function decisaoDaPendencia(p: PendenciaInativacao, perfil: Perfil | null, agora: Date): DecisaoNaTela {
  if (perfil === null) return { pode: false, motivo: 'Entre de novo no Backoffice para decidir a inativação.' };
  const auth = autorizarAcaoIntegracao('inativacao.decidir', perfil);
  if (!auth.ok) return { pode: false, motivo: auth.mensagem };
  const estado = situacaoPendencia(
    { ...p, decidida_por: p.decidida_por ?? null, decidida_por_perfil: p.decidida_por_perfil ?? null, motivo_decisao: p.motivo_decisao ?? null },
    agora.toISOString(),
  );
  if (estado === 'expirada') {
    return { pode: false, motivo: 'O prazo de confirmação venceu e nada foi inativado. Peça ao Conector uma nova carga completa desta entidade.' };
  }
  if (estado !== 'aguardando') return { pode: false, motivo: `Esta inativação já foi ${ROTULO_DECIDIDA[estado]}.` };
  return { pode: true };
}

export const ROTULO_ATUALIZACAO: Record<AtualizacaoConector['resultado'], string> = {
  atualizado: 'Atualizado',
  mantido: 'Versão mantida',
  revertido: 'Revertido',
};

export const TOM_ATUALIZACAO: Record<AtualizacaoConector['resultado'], BadgeTone> = {
  atualizado: 'success',
  mantido: 'neutral',
  revertido: 'danger',
};

/** Linha do monitor para a última atualização automática; sem informação (Conector antigo ou com a função desligada) é dito com todas as letras. */
export function resumoAtualizacao(a: AtualizacaoConector | null | undefined): { rotulo: string; tom: BadgeTone; detalhe: string } {
  if (!a) return { rotulo: 'Sem informação', tom: 'neutral', detalhe: 'O Conector ainda não informou atualização automática.' };
  const versoes = a.resultado === 'atualizado' && a.versao_de && a.versao_para ? ` ${a.versao_de} → ${a.versao_para}.` : '';
  return { rotulo: ROTULO_ATUALIZACAO[a.resultado], tom: TOM_ATUALIZACAO[a.resultado], detalhe: `${a.mensagem}${versoes}` };
}
