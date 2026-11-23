/**
 * Busca na API do ERP (Conector tipo `nuvem`; ADR 0066; desenho `docs/desenho/integracao-modelos-erp.md` §2 e §3; RN-INT-17 a RN-INT-20).
 * O Macuxi chama a API do ERP, converte para o contrato canônico e aplica pelo mesmo caminho do lote.
 *
 * Segredo (RN-INT-18): a credencial do ERP existe SÓ no esquema de ESCRITA (`CredencialErpEntrada`). Nenhum esquema de leitura
 * tem campo de segredo (o teste confere), e `parametros` não aceita chave com cara de segredo (espelho do CHECK
 * `integracao.parametros_sem_segredo` da migração 0094).
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk/eventos';
import { DataHoraUtc, Uuid } from './base';
import { ENTIDADES, Entidade } from './entidades';
import { ModoCarga } from './lote';

/** ERPs com busca por API (CHECK `conector_api_erp_valido`). WinThor é só Conector com views (desenho §3.2). */
export const MODELOS_ERP = ['protheus', 'sap_b1', 'sankhya', 'senior'] as const;
export const ModeloErp = z.enum(MODELOS_ERP, { errorMap: () => ({ message: 'ERP inválido: use protheus, sap_b1, sankhya ou senior' }) });
export type ModeloErp = z.infer<typeof ModeloErp>;

/** D9: todo modelo fica "beta" até o primeiro cliente daquele ERP confirmar os itens [C] do desenho §3. */
export const SITUACOES_MODELO = ['beta', 'estavel'] as const;
export type SituacaoModelo = (typeof SITUACOES_MODELO)[number];

export const ORIGENS_COLETA = ['agendada', 'buscar_agora', 'recarregar'] as const;
export const OrigemColeta = z.enum(ORIGENS_COLETA);
export type OrigemColeta = z.infer<typeof OrigemColeta>;

export const ESTADOS_COLETA = ['solicitada', 'executando', 'concluida', 'falhou'] as const;
export type EstadoColeta = (typeof ESTADOS_COLETA)[number];

/** RN-INT-20: classes de falha da coleta (CHECK `coleta_execucao_falha_classe_valida`). */
export const CLASSES_FALHA_COLETA = ['credencial_recusada', 'transitoria', 'formato_mudou'] as const;
export const ClasseFalhaColeta = z.enum(CLASSES_FALHA_COLETA);
export type ClasseFalhaColeta = z.infer<typeof ClasseFalhaColeta>;

// ---------- configuração não secreta ----------

/** Mesma regra do CHECK `parametros_sem_segredo` (0094) e de `CAMPOS_SEGREDO_LOG` do SDK: a chave não pode parecer segredo. */
export const CHAVE_COM_CARA_DE_SEGREDO = /(senha|password|passwd|pwd|secret|segredo|token|chave|appkey|key|authorization|cookie|sessao|session)/i;

/** Mesma regra do CHECK `conector_api_url_https`: só https, sem usuário, senha, query nem fragmento; até 500 caracteres. */
export const UrlBaseApiErp = z
  .string()
  .trim()
  .max(500, 'a URL aceita até 500 caracteres')
  .regex(/^https:\/\/[A-Za-z0-9.:[\]-]+(\/[^\s?#@]*)?$/, 'informe a URL da API em https, sem usuário, senha, parâmetros (?) nem âncora (#)');

/** Parâmetros não secretos do modelo (ex.: `company_db` do SAP B1, `top_pedido` da Sankhya). Até 20 chaves; valores simples. */
export const ParametrosApiErp = z
  .record(z.union([z.string().max(200), z.number().finite(), z.boolean()]))
  .superRefine((p, ctx) => {
    const chaves = Object.keys(p);
    if (chaves.length > 20) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'aceita até 20 parâmetros' });
    for (const c of chaves) {
      if (!/^[a-z][a-z0-9_]{0,59}$/.test(c)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [c], message: 'nome do parâmetro: minúsculas, dígitos e _ (até 60)' });
      if (CHAVE_COM_CARA_DE_SEGREDO.test(c)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [c], message: 'o segredo não vai em parâmetro: use o campo de credencial, que é cifrado' });
    }
  });
export type ParametrosApiErp = z.infer<typeof ParametrosApiErp>;

/** RN-INT-17: minutos por entidade, inteiro e múltiplo de 15, de 15 a 1.440 (1 vez por dia). Entidade ausente = padrão do modelo. */
export const FrequenciasApiErp = z.record(
  Entidade,
  z
    .number()
    .int('a frequência é um número inteiro de minutos')
    .min(15, 'a frequência mínima é 15 minutos')
    .max(1440, 'a frequência máxima é 1 vez por dia (1.440 minutos)')
    .refine((m) => m % 15 === 0, 'a frequência precisa ser múltipla de 15 minutos'),
);
export type FrequenciasApiErp = Partial<Record<Entidade, number>>;

/**
 * Credencial do ERP: ESCRITA APENAS (RN-INT-18). Nunca devolvida por rota, log, auditoria, diagnóstico ou recado.
 * `senha` é o segredo principal (SAP B1: Password; Sankhya: password); `token` e `appkey` são os da Sankhya (gateway).
 */
export const CredencialErpEntrada = z
  .object({
    senha: z.string().min(1, 'informe a senha ou o segredo do ERP').max(500),
    token: z.string().min(1).max(2000).optional(),
    appkey: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type CredencialErpEntrada = z.infer<typeof CredencialErpEntrada>;

/** Corpo de `PUT /v1/integracao/conectores/:id/erp-api`. Sem `credencial`, a salva continua valendo (e a URL do host não pode mudar). */
export const ConfigApiErpEntrada = z
  .object({
    erp: ModeloErp,
    url_base: UrlBaseApiErp,
    usuario_erp: z.string().trim().min(1).max(200).nullish(),
    parametros: ParametrosApiErp.default({}),
    frequencias: FrequenciasApiErp.default({}),
    credencial: CredencialErpEntrada.optional(),
  })
  .strict();
export type ConfigApiErpEntrada = z.infer<typeof ConfigApiErpEntrada>;

/** Estado da credencial na leitura: só se existe e quando/por quem foi trocada. Nunca o valor, nem parte dele. */
export const EstadoCredencialErp = z
  .object({
    configurada: z.boolean(),
    atualizada_em: DataHoraUtc.nullable(),
    atualizada_por: Uuid.nullable(),
  })
  .strict();
export type EstadoCredencialErp = z.infer<typeof EstadoCredencialErp>;

export const ModeloErpResumo = z
  .object({
    erp: ModeloErp,
    situacao: z.enum(SITUACOES_MODELO),
    entidades_suportadas: z.array(Entidade),
    /** Entidades que a API do ERP não filtra por data de alteração: vão em leitura completa na frequência, sem inativar. */
    entidades_sem_data_de_alteracao: z.array(Entidade),
    /** Parâmetros não secretos que o modelo pede (nome e se é obrigatório). */
    parametros: z.array(z.object({ chave: z.string(), obrigatorio: z.boolean(), descricao: z.string() }).strict()),
    pedido_pela_api: z.boolean(),
  })
  .strict();
export type ModeloErpResumo = z.infer<typeof ModeloErpResumo>;

/** Leitura da configuração: NÃO tem campo de segredo (RN-INT-18). */
export const ConfigApiErpLeitura = z
  .object({
    conector_id: z.string(),
    erp: ModeloErp,
    url_base: z.string(),
    usuario_erp: z.string().nullable(),
    parametros: ParametrosApiErp,
    frequencias: FrequenciasApiErp,
    /** Frequência que vale por entidade (a do tenant ou o padrão do modelo), em minutos. */
    frequencias_efetivas: z.record(Entidade, z.number().int()),
    credencial: EstadoCredencialErp,
    /** RN-INT-20: preenchido quando o ERP recusou a credencial (401/403); as coletas ficam paradas até trocar. */
    coletas_paradas_em: DataHoraUtc.nullable(),
    /** A busca roda? Falso enquanto o interruptor global, o do tenant ou a chave-mestra faltarem (tudo nasce desligado). */
    busca_ligada: z.boolean(),
    modelo: ModeloErpResumo,
  })
  .strict();
export type ConfigApiErpLeitura = z.infer<typeof ConfigApiErpLeitura>;

export const MOTIVOS_TESTE_CONEXAO = [
  'credencial_recusada',
  'endpoint_nao_encontrado',
  'campo_do_modelo_ausente',
  'tempo_esgotado',
  'erp_indisponivel',
  'destino_bloqueado',
  'url_invalida',
  'parametro_ausente',
  'credencial_incompleta',
  'entidade_nao_suportada',
  'busca_desligada',
  'sem_credencial',
] as const;
export type MotivoTesteConexao = (typeof MOTIVOS_TESTE_CONEXAO)[number];

/** "Testar conexão": por entidade "OK, n registros" ou o motivo. NUNCA traz o dado lido (RN-INT-18). */
export const ResultadoTesteConexao = z
  .object({
    ok: z.boolean(),
    /** Falha antes de ler entidades (login, URL, parâmetro, destino). */
    motivo: z.enum(MOTIVOS_TESTE_CONEXAO).nullable(),
    mensagem: z.string().nullable(),
    /** Procura de pedido pelo campo do UUID (RN-INT-19), quando o campo está configurado; `null` = não configurado. */
    pedido: z.object({ ok: z.boolean(), motivo: z.enum(MOTIVOS_TESTE_CONEXAO).nullable(), mensagem: z.string().nullable() }).strict().nullable(),
    entidades: z.array(
      z
        .object({
          entidade: Entidade,
          ok: z.boolean(),
          registros: z.number().int().nonnegative().nullable(),
          motivo: z.enum(MOTIVOS_TESTE_CONEXAO).nullable(),
          mensagem: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type ResultadoTesteConexao = z.infer<typeof ResultadoTesteConexao>;

/** `POST …/erp-api/testar`: testa a credencial enviada (sem gravar) ou, sem corpo, a gravada. */
export const TestarConexaoEntrada = z.object({ credencial: CredencialErpEntrada.optional() }).strict();
export type TestarConexaoEntrada = z.infer<typeof TestarConexaoEntrada>;

/** `POST …/erp-api/buscar-agora`: uma entidade, várias ou (sem lista) todas as do Conector. `recarregar` pede carga completa. */
export const BuscarAgoraEntrada = z
  .object({
    entidades: z.array(Entidade).min(1).max(ENTIDADES.length).optional(),
    recarregar: z.boolean().default(false),
  })
  .strict();
export type BuscarAgoraEntrada = z.infer<typeof BuscarAgoraEntrada>;

export const BuscarAgoraResposta = z
  .object({
    solicitadas: z.array(z.object({ entidade: Entidade, modo: ModoCarga, coleta_id: Uuid }).strict()),
    /** Entidades que já tinham coleta em andamento (uma por entidade por vez). */
    ja_em_andamento: z.array(Entidade),
  })
  .strict();
export type BuscarAgoraResposta = z.infer<typeof BuscarAgoraResposta>;

// ---------- eventos internos (registro: .coord/contratos/eventos.md) ----------

/**
 * `integracao.coleta.solicitada@1` — interno: a tarefa `agendar_coletas`, "Buscar agora" e "Recarregar" pedem uma coleta; o trabalho
 * `coletar_erp` (ADR 0058) a executa. `coleta_id` é o alvo do trabalho (uma linha de `integracao.coleta_execucao`). Sem URL,
 * usuário nem segredo do ERP.
 */
export const ColetaSolicitadaEvento = z
  .object({
    coleta_id: Uuid,
    conector_id: Uuid,
    entidade: Entidade,
    modo: ModoCarga,
    origem: OrigemColeta,
    solicitado_por: Uuid.nullable(),
    solicitado_em: DataHoraUtc,
  })
  .strict();
export type ColetaSolicitadaEvento = z.infer<typeof ColetaSolicitadaEvento>;
export const EVENTO_COLETA_SOLICITADA = definirEvento('integracao.coleta.solicitada@1', ColetaSolicitadaEvento);

/**
 * `integracao.pedido.entrega_solicitada@1` — interno (RN-INT-19): o pedido entrou na fila e o Conector `nuvem` tem o campo do UUID
 * do Macuxi no ERP; o trabalho `entregar_pedido_erp` procura o pedido no ERP e só cria se não achar. O alvo é o `entrega_id`.
 */
export const EntregaPedidoSolicitadaEvento = z
  .object({
    /** Alvo do trabalho: uma entrega nova por tentativa de disparo (o trabalho concluído não se repete com o mesmo alvo). */
    entrega_id: Uuid,
    pedido_uuid: Uuid,
    conector_id: Uuid,
    solicitado_em: DataHoraUtc,
  })
  .strict();
export type EntregaPedidoSolicitadaEvento = z.infer<typeof EntregaPedidoSolicitadaEvento>;
export const EVENTO_ENTREGA_PEDIDO_SOLICITADA = definirEvento('integracao.pedido.entrega_solicitada@1', EntregaPedidoSolicitadaEvento);
