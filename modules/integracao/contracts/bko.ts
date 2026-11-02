/**
 * Contratos das rotas do BKO do módulo Integracao (T-0025): cadastro/rotação/revogação de chave por Conector, política de versão,
 * monitor, reprocessamento, confirmação da trava de inativação e mapeamento de-para.
 *
 * Diferente do Hub (`hub.ts`, chave de API do Conector), estas rotas são `/v1/integracao/*` com o JWT do usuário do BKO,
 * perfil por ação do manifesto, licença do módulo e `tenant_id` do token (ADR 0004/0006).
 */
import { z } from 'zod';
import { DataHoraUtc, Uuid } from './base';
import { PoliticaVersaoConector } from './conector';
import { ConectorIdentificador } from './hub';
import { ENTIDADES, Entidade } from './entidades';
import { EstadoLote, LinhaErro } from './lote';
import { EstadoPedidoErp } from './pedido';

export const TIPOS_CONECTOR = ['conector', 'nuvem', 'arquivo'] as const;
export const TipoConector = z.enum(TIPOS_CONECTOR);
export type TipoConector = z.infer<typeof TipoConector>;

/** Saúde do Conector no monitor (`avaliarSaudeConector`): sem sinal há 15 min ou mais é alerta (doc 06). */
export const SAUDES_CONECTOR = ['ok', 'atrasado', 'sem_sinal', 'parado_por_versao', 'nunca_conectou', 'desativado'] as const;
export const SaudeConector = z.enum(SAUDES_CONECTOR);
export type SaudeConector = z.infer<typeof SaudeConector>;

export const SITUACOES_VERSAO_CONECTOR = ['sem_politica', 'versao_ilegivel', 'em_dia', 'desatualizado', 'abaixo_da_minima'] as const;
export const SituacaoVersaoConectorSchema = z.enum(SITUACOES_VERSAO_CONECTOR);

/** Entidades de um Conector: ao menos uma, sem repetição (P-6). */
export const ListaEntidadesConector = z
  .array(Entidade)
  .min(1, 'escolha ao menos uma entidade para o Conector')
  .refine((l) => new Set(l).size === l.length, 'entidade repetida na lista do Conector');

export const ConectorCriar = z.object({
  /** Identificador que vai no arquivo do Conector (`hub.conectorId`) e no cabeçalho `X-Macuxi-Conector-Id`. */
  conector_id: ConectorIdentificador,
  nome: z.string().trim().min(1).max(120),
  tipo: TipoConector.default('conector'),
  /** Só Conectores com `recebe_pedidos` recebem os pedidos aprovados (um por empresa em v1, P-7; padrão `true`). */
  recebe_pedidos: z.boolean().default(true),
  /**
   * Entidades que ESTE Conector alimenta (T-0027, P-6/RN-INT-13: um Conector por entidade por empresa na v1). Padrão: as 8.
   * O Hub recusa o cadastro que repete entidade de outro Conector ativo (`verificarTopologiaConectores`) e o lote de entidade
   * que não é dele (`entidade_de_outro_conector`). Filial com ERP próprio vira outra empresa (outro tenant).
   */
  entidades: ListaEntidadesConector.default([...ENTIDADES]),
  /** Lista de IPs/CIDRs de saída permitidos (opcional; vazio = qualquer IP com chave válida). */
  ips_permitidos: z.array(z.string().trim().min(2).max(60)).max(20).default([]),
});
export type ConectorCriar = z.infer<typeof ConectorCriar>;

/**
 * Corpo do 409 `topologia_conflitante` em `POST /conectores` e `PATCH /conectores/:id` (P-6/P-7, RN-INT-13; T-0031). `mensagem`
 * diz qual Conector já recebe cada entidade e pede a lista de entidades do Conector em cadastro; `detalhes.conflitos[]` detalha;
 * `detalhes.entidades_livres` são as pedidas que nenhum outro Conector ativo recebe (sugestão para a tela). Rota de usuário: o corpo é
 * o `ErroApi` da plataforma (ADR 0008), por isso o detalhe fica em `detalhes` (R-20261101-155028, 🟡 2).
 */
export const RecusaTopologiaConector = z.object({
  codigo: z.literal('topologia_conflitante'),
  mensagem: z.string().min(1),
  /** Erro padrão da plataforma (`ErroApi`, ADR 0008): o detalhe do conflito vai em `detalhes`. */
  detalhes: z.object({
    conflitos: z
      .array(
        z.object({
          codigo: z.enum(['entidade_em_outro_conector', 'pedidos_em_outro_conector']),
          entidade: Entidade.optional(),
          conector_id: ConectorIdentificador,
          mensagem: z.string().min(1),
        }),
      )
      .min(1),
    entidades_livres: z.array(Entidade),
  }),
  requisicao_id: z.string().nullish(),
});
export type RecusaTopologiaConector = z.infer<typeof RecusaTopologiaConector>;

export const ConectorAtualizar = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  ips_permitidos: z.array(z.string().trim().min(2).max(60)).max(20).optional(),
  recebe_pedidos: z.boolean().optional(),
  /** Troca as entidades do Conector (P-6; o Hub confere conflito com os outros Conectores ativos). */
  entidades: ListaEntidadesConector.optional(),
  /** `false` desativa o Conector e revoga as chaves (RN-INT-10). */
  ativo: z.boolean().optional(),
});
export type ConectorAtualizar = z.infer<typeof ConectorAtualizar>;

export const ChaveResumo = z.object({
  prefixo: z.string(),
  criada_em: DataHoraUtc,
  /** Chave anterior ainda aceita durante a convivência da rotação. */
  anterior_prefixo: z.string().nullable(),
  anterior_valida_ate: DataHoraUtc.nullable(),
  expira_em: DataHoraUtc.nullable(),
});
export type ChaveResumo = z.infer<typeof ChaveResumo>;

export const ConectorResumo = z.object({
  id: Uuid,
  conector_id: ConectorIdentificador,
  nome: z.string(),
  tipo: TipoConector,
  ativo: z.boolean(),
  recebe_pedidos: z.boolean(),
  /** Entidades que este Conector alimenta (P-6). */
  entidades: z.array(Entidade),
  ips_permitidos: z.array(z.string()),
  versao_conector: z.string().nullable(),
  situacao_versao: SituacaoVersaoConectorSchema,
  ultimo_sinal_em: DataHoraUtc.nullable(),
  saude: SaudeConector,
  /** `null` = nunca teve chave ou todas revogadas. */
  chave: ChaveResumo.nullable(),
  criado_em: DataHoraUtc,
});
export type ConectorResumo = z.infer<typeof ConectorResumo>;

/** Criar Conector devolve o resumo e a chave em claro (uma única vez). */
export const ConectorCriado = z.object({
  conector: ConectorResumo,
  chave: z.object({
    conector_id: ConectorIdentificador,
    escopo: z.literal('integracao.v1'),
    chave: z.string().min(32),
    prefixo: z.string().min(4).max(12),
    criada_em: DataHoraUtc,
    anterior_valida_ate: DataHoraUtc.nullish(),
  }),
});
export type ConectorCriado = z.infer<typeof ConectorCriado>;

/** `POST /v1/integracao/conectores/{id}/chave/rotacionar`: a resposta é `ChaveConectorCriada` (conector.ts). */
export const RotacionarChaveEntrada = z.object({
  /** Minutos em que a chave anterior continua valendo (0 = revoga na hora). Padrão: 1440 (24 h); máximo 10080 (7 dias). */
  convivencia_min: z.number().int().min(0).max(10_080).optional(),
});
export type RotacionarChaveEntrada = z.infer<typeof RotacionarChaveEntrada>;

export const RevogarChaveEntrada = z.object({
  alvo: z.enum(['atual', 'anterior', 'todas']).default('todas'),
  motivo: z.string().trim().max(200).optional(),
});
export type RevogarChaveEntrada = z.infer<typeof RevogarChaveEntrada>;

/** `PUT /v1/integracao/politica-versao` (por tenant). Invariante `versao_minima <= versao_recomendada` validada no domain (422). */
export const PoliticaVersaoEntrada = PoliticaVersaoConector;
export type PoliticaVersaoEntrada = z.infer<typeof PoliticaVersaoEntrada>;

export const LoteListagemQuery = z.object({
  conector_id: ConectorIdentificador.optional(),
  entidade: Entidade.optional(),
  status: EstadoLote.optional(),
  /** Só lotes com erro por linha. */
  com_erro: z.coerce.boolean().optional(),
  de: DataHoraUtc.optional(),
  ate: DataHoraUtc.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(200).default(50),
});
export type LoteListagemQuery = z.infer<typeof LoteListagemQuery>;

export const LoteListagemItem = z.object({
  lote_id: Uuid,
  conector_id: ConectorIdentificador,
  entidade: Entidade,
  modo: z.enum(['completo', 'delta']),
  status: EstadoLote,
  recebidas: z.number().int().nonnegative(),
  com_erro: z.number().int().nonnegative(),
  novas: z.number().int().nonnegative(),
  atualizadas: z.number().int().nonnegative(),
  inalteradas: z.number().int().nonnegative(),
  obsoletas: z.number().int().nonnegative().default(0),
  inativadas: z.number().int().nonnegative(),
  recebido_em: DataHoraUtc,
  concluido_em: DataHoraUtc.nullable(),
});
export type LoteListagemItem = z.infer<typeof LoteListagemItem>;

export const LoteListagem = z.object({
  itens: z.array(LoteListagemItem),
  total: z.number().int().nonnegative(),
  pagina: z.number().int().positive(),
  por_pagina: z.number().int().positive(),
});
export type LoteListagem = z.infer<typeof LoteListagem>;

/** `GET /v1/integracao/lotes/{id}/erros`: paginado (CSV exporta tudo pelo mesmo filtro). */
export const ErrosLoteQuery = z.object({
  codigo: z.string().optional(),
  reprocessavel: z.coerce.boolean().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(500).default(100),
});
export type ErrosLoteQuery = z.infer<typeof ErrosLoteQuery>;

export const ErrosLoteResposta = z.object({ itens: z.array(LinhaErro), total: z.number().int().nonnegative() });
export type ErrosLoteResposta = z.infer<typeof ErrosLoteResposta>;

/** `POST /v1/integracao/lotes/{id}/reprocessar`: reaplica do staging as linhas reprocessáveis (referencia_ausente, falha_processamento). */
export const ReprocessarLoteEntrada = z.object({ codigos: z.array(z.enum(['referencia_ausente', 'falha_processamento'])).min(1).optional() });
export type ReprocessarLoteEntrada = z.infer<typeof ReprocessarLoteEntrada>;
export const ReprocessarLoteResposta = z.object({ lote_id: Uuid, reenfileiradas: z.number().int().nonnegative(), status: EstadoLote });
export type ReprocessarLoteResposta = z.infer<typeof ReprocessarLoteResposta>;

/** Trava de inativação em massa (RN-INT-06): a carga completa fica aguardando confirmação do operador no BKO. */
export const ESTADOS_PENDENCIA_INATIVACAO = ['aguardando', 'confirmada', 'recusada', 'expirada'] as const;
export const EstadoPendenciaInativacao = z.enum(ESTADOS_PENDENCIA_INATIVACAO);
export type EstadoPendenciaInativacao = z.infer<typeof EstadoPendenciaInativacao>;

export const PendenciaInativacao = z.object({
  id: Uuid,
  sessao_id: Uuid,
  entidade: Entidade,
  conector_id: ConectorIdentificador,
  lote_id: Uuid,
  estado: EstadoPendenciaInativacao,
  candidatos: z.number().int().nonnegative(),
  total_ativos: z.number().int().nonnegative(),
  percentual: z.number().nonnegative(),
  limite_pct: z.number().positive(),
  /** Até 50 `external_id` que seriam inativados (chaves do ERP; nunca CPF/CNPJ). A lista completa vai no CSV. */
  amostra: z.array(z.string()).max(50),
  criada_em: DataHoraUtc,
  expira_em: DataHoraUtc,
  decidida_em: DataHoraUtc.nullable(),
  /** P-3 (T-0031): quem decidiu (uuid do usuário) e com qual perfil (admin ou analista). Campos novos opcionais (RN-INT-09). */
  decidida_por: Uuid.nullish(),
  decidida_por_perfil: z.enum(['admin', 'analista']).nullish(),
  motivo_decisao: z.string().max(300).nullish(),
});
export type PendenciaInativacao = z.infer<typeof PendenciaInativacao>;

/**
 * P-3 (T-0031): trilha de auditoria de cada confirmação/recusa da inativação em massa — quem, quando, lote, quantidade. Gravada
 * na mesma transação da decisão; aparece no detalhe da pendência e no CSV do monitor. Sem dado pessoal (só uuid e perfil).
 */
export const AuditoriaInativacao = z.object({
  pendencia_id: Uuid,
  sessao_id: Uuid,
  lote_id: Uuid,
  entidade: Entidade,
  conector_id: ConectorIdentificador,
  acao: z.enum(['confirmar', 'recusar']),
  decidida_por: Uuid,
  perfil: z.enum(['admin', 'analista']),
  decidida_em: DataHoraUtc,
  /** Quantos registros a pendência inativaria quando foi decidida. */
  quantidade: z.number().int().nonnegative(),
  total_ativos: z.number().int().nonnegative(),
  percentual: z.number().nonnegative(),
  motivo: z.string().max(300).nullable(),
  /** Quantos registros foram de fato inativados ao confirmar (a reavaliação com os ativos de agora pode inativar menos que `quantidade`). Nulo/ausente na recusa. */
  inativadas: z.number().int().nonnegative().nullish(),
});
export type AuditoriaInativacao = z.infer<typeof AuditoriaInativacao>;

export const DecidirInativacaoEntrada = z.object({
  acao: z.enum(['confirmar', 'recusar']),
  motivo: z.string().trim().max(300).optional(),
});
export type DecidirInativacaoEntrada = z.infer<typeof DecidirInativacaoEntrada>;
export const DecidirInativacaoResposta = z.object({
  pendencia: PendenciaInativacao,
  /** Quantos registros foram inativados agora (0 se recusada). */
  inativadas: z.number().int().nonnegative(),
  /** P-3: o registro de auditoria gravado com a decisão. */
  auditoria: AuditoriaInativacao.optional(),
});
export type DecidirInativacaoResposta = z.infer<typeof DecidirInativacaoResposta>;

/** Mapeamento de-para (doc 06): código do ERP ↔ código do Macuxi. Único por (`tipo`, `codigo_erp`). */
export const TIPOS_MAPEAMENTO = ['condicao_pagamento', 'deposito', 'status'] as const;
export const TipoMapeamento = z.enum(TIPOS_MAPEAMENTO);
export type TipoMapeamento = z.infer<typeof TipoMapeamento>;
export const Mapeamento = z.object({
  tipo: TipoMapeamento,
  codigo_erp: z.string().trim().min(1).max(60),
  codigo_macuxi: z.string().trim().min(1).max(60),
  descricao: z.string().trim().max(200).nullish(),
  ativo: z.boolean().default(true),
});
export type Mapeamento = z.infer<typeof Mapeamento>;

/** Pedido na fila do ERP, para o monitor (sem itens nem dado do cliente). */
export const PedidoFilaItem = z.object({
  pedido_uuid: Uuid,
  estado: EstadoPedidoErp,
  tentativas: z.number().int().nonnegative(),
  numero_erp: z.string().nullable(),
  motivo: z.string().nullable(),
  /** Retido por falta de mapeamento (ex.: condição de pagamento sem de-para). */
  retencao: z.string().nullable(),
  aprovado_em: DataHoraUtc,
  enviado_em: DataHoraUtc.nullable(),
  ultimo_retorno_em: DataHoraUtc.nullable(),
});
export type PedidoFilaItem = z.infer<typeof PedidoFilaItem>;

export const SEVERIDADES_ALERTA = ['critico', 'atencao', 'info'] as const;
export const CODIGOS_ALERTA_MONITOR = [
  'conector_sem_sinal',
  'conector_parado_por_versao',
  'conector_desatualizado',
  'conector_nunca_conectou',
  'lotes_falhos',
  'inativacao_aguardando_confirmacao',
  'reconciliacao_divergente',
  'pedido_preso',
  'pedido_retido_sem_mapeamento',
  'chave_em_convivencia',
  // P-4 (T-0031): retornos do ERP aceitos com itens faturados descartados nas últimas 24 h
  'retorno_com_itens_descartados',
  // ADR 0016: pedidos que usam recurso novo (embalagem, acréscimo, FOB, endereço) esperam um Conector mais novo
  'pedido_aguardando_conector',
] as const;
export const AlertaMonitor = z.object({
  codigo: z.enum(CODIGOS_ALERTA_MONITOR),
  severidade: z.enum(SEVERIDADES_ALERTA),
  /** Texto em português com a causa e a ação seguinte. */
  mensagem: z.string(),
  conector_id: ConectorIdentificador.nullable(),
  entidade: z.enum(ENTIDADES).nullable(),
});
export type AlertaMonitor = z.infer<typeof AlertaMonitor>;

/** `GET /v1/integracao/monitor`: o que a tela inicial do monitor mostra (RF-INT-04, RF-INT-06). */
export const MonitorResumo = z.object({
  gerado_em: DataHoraUtc,
  conectores: z.array(ConectorResumo),
  alertas: z.array(AlertaMonitor),
  lotes_recentes: z.array(LoteListagemItem),
  /** Estado da carga por entidade, na ordem de dependência (carga inicial). */
  cargas: z.array(
    z.object({
      entidade: Entidade,
      estado: z.enum(['sem_lotes', 'pendente', 'em_andamento', 'concluida', 'concluida_com_erros', 'falhou']),
      lotes: z.number().int().nonnegative(),
      com_erro: z.number().int().nonnegative(),
      aguardando: z.array(Entidade),
    }),
  ),
  pendencias_inativacao: z.array(PendenciaInativacao),
  reconciliacoes: z.array(
    z.object({
      entidade: Entidade,
      data_referencia: z.string(),
      divergente: z.boolean(),
      motivos: z.array(z.string()),
      contagem_erp: z.number(),
      contagem_macuxi: z.number(),
    }),
  ),
  pedidos: z.object({
    por_estado: z.record(EstadoPedidoErp, z.number().int().nonnegative()),
    presos: z.number().int().nonnegative(),
    retidos: z.number().int().nonnegative(),
  }),
});
export type MonitorResumo = z.infer<typeof MonitorResumo>;
