/**
 * Pré-cadastro de cliente (v1.0.28; RF-CORE-10; RN-CORE-78, RN-CORE-79 e RN-INT-22). O FDV só faz o pré-cadastro; quem aprova é o ERP.
 *  - Evento `core.cliente.pre_cadastrado@1`: só ids e o carimbo do recebimento; o Hub busca os dados pela consulta abaixo (sem dado pessoal na outbox/log).
 *  - Consulta `core.clientes_pre_cadastro_sem_erp@1`: pendentes sem `external_id`, com os campos canônicos do cadastro (RN-CORE-16).
 *  - Parâmetro `cliente.pre_cadastro.obrigatorios`: quais campos configuráveis a empresa exige (RN-CORE-79). Razão social e documento são sempre obrigatórios.
 *  - O código do ERP volta pelo evento de retorno do Hub (`integracao.cliente.retorno_erp@1`), não por consulta (ADR 0012 §5).
 *  - v1.0.30 (ADR 0069): o recusado é corrigido no mesmo cliente como revisão nova (`revisao_base`), com histórico de tentativas, lista
 *    de recusados do BKO e o evento `core.cliente.pre_cadastro_revisado@1`. Os obrigatórios passam a vir da lista única de Parâmetros ›
 *    Clientes (`cliente.campos_obrigatorios`, RN-CORE-16); a chave antiga fica só como espelho para o APK v1.0.28.
 */
import { definirEvento, definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CAMPOS_CADASTRO_FIXOS } from './cadastro';
/** Situação do pré-cadastro (o ERP aprova; v1.0.28, RN-CORE-78): fonte única do app, da API e do sync. */
export const StatusCadastroSchema = z.enum(['pendente', 'aprovado', 'recusado']);
const Uuid = z.string().uuid();
const Texto = z.string().max(200).nullable();
/** Revisão do pré-cadastro (RN-CORE-78, ADR 0069): 1 no primeiro recebimento; sobe 1 a cada reenvio do recusado. */
export const RevisaoCadastroSchema = z.number().int().min(1);
/** sha256 do `canonicalPreCadastro` (domain), em hexadecimal minúsculo. Nunca vai a log. */
export const HashPreCadastroSchema = z.string().regex(/^[0-9a-f]{64}$/);
/**
 * Código FDV do cliente (v1.0.30, ADR 0069 item 10, decisão 1 B; molde da RN-CORE-59): todo cliente vivo tem, qualquer que seja a
 * origem (pré-cadastro do Campo ou do BKO e cliente novo da carga do ERP). Gerado pelo banco no insert, em sequência por empresa, só
 * dígitos, no mínimo 5 (`00001`…; `100000` depois de `99999`), só de leitura e nunca reaproveitado; a carga repetida do ERP mantém o
 * código. Nos contratos fica `nullish` só para o aparelho antes do 1º sync e o emissor antigo. O Código ERP é o `external_id`.
 */
export const CodigoFdvClienteSchema = z.string().regex(/^\d{5,}$/);
export const OrigemTentativaSchema = z.enum(['campo', 'bko']);
export const ResultadoTentativaSchema = z.enum(['aguardando', 'aceito', 'recusado']);
/** Situação na lista de recusados do BKO (`situacaoDoRecusado`, domain). */
export const SituacaoRecusadoSchema = z.enum(['recusado', 'reenviado', 'aceito']);
/** Limite de erros por campo guardados por recusa (RN-CORE-78, RN-INT-22). */
export const ERROS_RECUSA_MAX = 50;
/** Tamanho máximo de cada texto do erro por campo (o domain corta por aqui). */
export const ERRO_CAMPO_LIMITES = { campo: 60, codigo: 60, mensagem: 300 };
/** Erro por campo devolvido pelo ERP (campo = nome canônico do ClienteParaErp ou o que o ERP mandou). */
export const ErroCampoCadastroSchema = z
    .object({
    campo: z.string().trim().min(1).max(ERRO_CAMPO_LIMITES.campo),
    codigo: z.string().trim().min(1).max(ERRO_CAMPO_LIMITES.codigo),
    mensagem: z.string().trim().min(1).max(ERRO_CAMPO_LIMITES.mensagem),
})
    .strict();
export const ErrosCampoCadastroSchema = z.array(ErroCampoCadastroSchema).max(ERROS_RECUSA_MAX);
/** Códigos de erro da criação e da correção do pré-cadastro (RN-CORE-78/79); também o código do item `rejeitado` no push. */
/** Código FDV no corpo (cliente RN-CORE-78 e usuário RN-CORE-59): código único da recusa. */
export const CODIGO_FDV_SOMENTE_LEITURA = 'CODIGO_FDV_SOMENTE_LEITURA';
export const CODIGOS_ERRO_PRE_CADASTRO = ['CAMPOS_OBRIGATORIOS', 'CADASTRO_NAO_RECUSADO', 'REVISAO_DESATUALIZADA', 'DOCUMENTO_JA_CADASTRADO', 'CADASTRO_INDISPONIVEL', 'NAO_ENCONTRADO', CODIGO_FDV_SOMENTE_LEITURA];
/** HTTP de cada código (a API responde; o receptor do push usa só o código). */
export const HTTP_ERRO_PRE_CADASTRO = {
    CAMPOS_OBRIGATORIOS: 422,
    CADASTRO_NAO_RECUSADO: 422,
    REVISAO_DESATUALIZADA: 409,
    DOCUMENTO_JA_CADASTRADO: 409,
    CADASTRO_INDISPONIVEL: 409,
    NAO_ENCONTRADO: 404,
    CODIGO_FDV_SOMENTE_LEITURA: 422,
};
/** Código FDV no corpo (cliente RN-CORE-78 e usuário RN-CORE-59): texto único da recusa. */
export const MENSAGEM_CODIGO_FDV_SOMENTE_LEITURA = 'O Código FDV é gerado pelo sistema e não pode ser alterado. Tire o campo e salve de novo.';
/** Texto em português de cada erro, com a ação seguinte (fonte única: API, receptor do push, app e BKO). */
export const MENSAGENS_ERRO_PRE_CADASTRO = {
    CADASTRO_NAO_RECUSADO: 'Este cadastro não está recusado pelo ERP. Atualize a tela para ver a situação atual.',
    REVISAO_DESATUALIZADA: 'Este cadastro foi corrigido por outra pessoa. Recarregue para ver a versão atual e corrija de novo.',
    DOCUMENTO_JA_CADASTRADO: 'Já existe um cliente com este CPF/CNPJ. Procure-o na lista de clientes.',
    CADASTRO_INDISPONIVEL: 'Não foi possível gravar este cadastro. Abra um novo cadastro e tente de novo.',
    NAO_ENCONTRADO: 'Cadastro não encontrado. Atualize a lista e tente de novo.',
    CODIGO_FDV_SOMENTE_LEITURA: MENSAGEM_CODIGO_FDV_SOMENTE_LEITURA,
};
/** Campos sempre obrigatórios (travados; mínimo para o ERP identificar o cliente): a mesma lista do cadastro (RN-CORE-16). */
export const CAMPOS_PRE_CADASTRO_SEMPRE = CAMPOS_CADASTRO_FIXOS;
/**
 * Campos que a empresa podia marcar como obrigatórios na chave antiga (v1.0.28). Padrão: nenhum.
 * @deprecated v1.0.30 (ADR 0069): só para o espelho legado do APK v1.0.28 (`projecaoLegadaObrigatorios`); sai com a versão mínima > 1.0.28.
 */
export const CAMPOS_PRE_CADASTRO_CONFIGURAVEIS = ['nome_fantasia', 'inscricao_estadual', 'telefone', 'email', 'endereco'];
/** Rótulos dos campos (fonte única: app e BKO). */
export const ROTULOS_CAMPOS_PRE_CADASTRO = {
    razao_social: 'Razão social',
    documento: 'CPF/CNPJ',
    nome_fantasia: 'Nome fantasia',
    inscricao_estadual: 'Inscrição estadual',
    telefone: 'Telefone',
    email: 'E-mail',
    endereco: 'Endereço',
};
/** Colunas do pré-cadastro que formam o campo `endereco` (vale o grupo todo: logradouro, número, bairro, cidade, UF e CEP). */
export const COLUNAS_ENDERECO_PRE_CADASTRO = ['logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'];
/** Colunas do pré-cadastro que cada campo cobre (`endereco` é o grupo; os demais são a própria coluna). */
export const COLUNAS_DO_CAMPO_PRE_CADASTRO = {
    razao_social: ['razao_social'],
    documento: ['documento'],
    nome_fantasia: ['nome_fantasia'],
    inscricao_estadual: ['inscricao_estadual'],
    telefone: ['telefone'],
    email: ['email'],
    endereco: COLUNAS_ENDERECO_PRE_CADASTRO,
};
/**
 * Chave em `plataforma.parametro` (modulo `core`); valor = array de campos configuráveis, sem repetição.
 * @deprecated v1.0.30 (ADR 0069): espelho legado para o APK v1.0.28; a lista única é `PARAMETRO_CAMPOS_OBRIGATORIOS` (contracts/cadastro).
 */
export const PARAMETRO_PRE_CADASTRO_OBRIGATORIOS = 'cliente.pre_cadastro.obrigatorios';
export const CampoPreCadastroConfiguravelSchema = z.enum(CAMPOS_PRE_CADASTRO_CONFIGURAVEIS);
/** @deprecated v1.0.30 (ADR 0069): só para o espelho legado do APK v1.0.28. */
export const ObrigatoriosPreCadastroSchema = z
    .array(CampoPreCadastroConfiguravelSchema)
    .max(CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.length)
    .refine((v) => new Set(v).size === v.length, 'Campo repetido na lista de obrigatórios.');
/**
 * Obrigatórios efetivos a partir das linhas da entidade de sync `parametro` (`motor.linhas('parametro')`): sem linha viva do módulo
 * `core`, ou valor inválido, vale o padrão (nenhum configurável). Mesmo molde de `paradoMinDasLinhas`.
 * @deprecated v1.0.30 (ADR 0069): o app lê `camposExigidosDasLinhas` (domain/cadastro); fica até a versão mínima > 1.0.28.
 */
export function obrigatoriosPreCadastroDasLinhas(linhas) {
    const l = linhas.find((x) => x.modulo === 'core' && x.chave === PARAMETRO_PRE_CADASTRO_OBRIGATORIOS && !x.deleted_at);
    const r = ObrigatoriosPreCadastroSchema.safeParse(l?.valor);
    return r.success ? r.data : [];
}
/**
 * `GET|PUT /v1/core/parametros/pre-cadastro` (ação `parametro.pre_cadastro`).
 * @deprecated v1.0.30 (ADR 0069): a rota sai, trocada por `parametros/campos-obrigatorios` (`ParametroCamposObrigatoriosClienteSchema`).
 */
export const ParametroPreCadastroSchema = z.object({ obrigatorios: ObrigatoriosPreCadastroSchema }).strict();
/** Mensagem do 422 por campo faltante (única fonte: a API junta as mensagens; nunca valores). */
export const MENSAGENS_CAMPO_FALTANTE = {
    razao_social: 'Preencha a razão social.',
    documento: 'Preencha o CPF/CNPJ.',
    nome_fantasia: 'Preencha o nome fantasia.',
    inscricao_estadual: 'Preencha a inscrição estadual.',
    telefone: 'Preencha o telefone.',
    email: 'Preencha o e-mail.',
    endereco: 'Preencha o endereço.',
};
export const ClientePreCadastradoSchema = z.object({
    cliente_id: Uuid,
    recebido_em: z.string().datetime(),
});
export const EVENTO_CLIENTE_PRE_CADASTRADO = definirEvento('core.cliente.pre_cadastrado@1', ClientePreCadastradoSchema);
export const ClientePreCadastroParaErpSchema = z.object({
    cliente_id: Uuid,
    recebido_em: z.string().datetime(),
    razao_social: z.string().min(1).max(200),
    nome_fantasia: Texto,
    documento: Texto,
    inscricao_estadual: Texto,
    telefone: Texto,
    email: Texto,
    logradouro: Texto,
    numero: Texto,
    complemento: Texto,
    bairro: Texto,
    cidade: Texto,
    uf: Texto,
    cep: Texto,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    /** Código da filial no ERP (external_id da filial), quando houver. */
    filial_external_id: Texto,
    /** v1.0.30 (ADR 0069, aditivo): revisão atual e hash dos dados dela. Ausente = emissor antigo. */
    revisao: RevisaoCadastroSchema.optional(),
    hash: HashPreCadastroSchema.optional(),
    /** v1.0.30 (ADR 0069 item 10, aditivo): Código FDV, para o ERP guardar a referência do FDV. Fora do hash. */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
    /** v1.0.34 (aditivo): código no ERP do vendedor que fez o pré-cadastro: o autor da primeira tentativa (`corrigido_por`, perfil vendedor), não a carteira atual; nulo se o autor não for vendedor ou não tiver código. Fora do hash. */
    vendedor_external_id: Texto.optional(),
});
export const ClientesPreCadastroSemErpEntradaSchema = z
    .object({ limite: z.number().int().min(1).max(500).default(100), depois_de: Uuid.nullable().default(null) })
    .strict();
export const ClientesPreCadastroSemErpSaidaSchema = z.object({ clientes: z.array(ClientePreCadastroParaErpSchema).max(500), proximo: Uuid.nullable() });
export const CONSULTA_CLIENTES_PRE_CADASTRO_SEM_ERP = definirConsulta({
    nome: 'core.clientes_pre_cadastro_sem_erp@1',
    entrada: ClientesPreCadastroSemErpEntradaSchema,
    saida: ClientesPreCadastroSemErpSaidaSchema,
});
/** Pré-cadastro (campo ou BKO): o `id` nasce no aparelho/tela e torna a escrita idempotente. Sem `complemento`: o cliente não tem a coluna. */
const TextoOpc = z.string().trim().max(200).nullish();
export const PreCadastroClienteSchema = z
    .object({
    id: Uuid,
    origem: z.enum(['campo', 'bko']),
    razao_social: z.string().trim().min(1).max(200),
    nome_fantasia: TextoOpc,
    /** Sempre obrigatório (RN-CORE-79). */
    documento: z
        .string({ required_error: 'Informe o CPF ou CNPJ.' })
        .transform((v) => v.replace(/\D/g, ''))
        .pipe(z.string().regex(/^(\d{11}|\d{14})$/, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).')),
    inscricao_estadual: TextoOpc,
    telefone: TextoOpc,
    email: TextoOpc,
    logradouro: TextoOpc,
    numero: TextoOpc,
    bairro: TextoOpc,
    cidade: TextoOpc,
    uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Informe a UF com 2 letras.').nullish(),
    cep: TextoOpc,
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    filial_id: Uuid.nullish(),
    /** v1.0.30 (RN-CORE-78): revisão que a pessoa viu ao corrigir o recusado. Ausente = criação (o APK v1.0.28 nunca manda). */
    revisao_base: RevisaoCadastroSchema.nullish(),
    /** Só de leitura (ADR 0069 item 10): aceito no schema só para a API recusar com 422 `CODIGO_FDV_SOMENTE_LEITURA` (o `.strict()` daria 400). */
    codigo_fdv: z.unknown().optional(),
})
    .strict();
/** Correção do BKO: `PUT /v1/core/clientes/:id/pre-cadastro` (o id vem do caminho; origem = 'bko'). */
export const CorrecaoPreCadastroSchema = PreCadastroClienteSchema.omit({ id: true, origem: true, revisao_base: true })
    .extend({ revisao_base: RevisaoCadastroSchema })
    .strict();
/** Resposta da criação e da correção (o mesmo schema serve as duas; `revisao` = a do cliente depois da escrita). */
export const PreCadastroClienteSaidaSchema = z.object({
    id: Uuid,
    status_cadastro: StatusCadastroSchema,
    revisao: RevisaoCadastroSchema,
    ja_existia: z.boolean(),
    /** v1.0.30 (ADR 0069 item 10, aditivo): Código FDV gerado pelo banco; nulo só se a migração não entrou. */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
});
/** Uma tentativa (revisão) do pré-cadastro: só nomes de campo, nunca valores. */
export const TentativaPreCadastroSchema = z.object({
    revisao: RevisaoCadastroSchema,
    /** Nulo = tentativa anterior à v1.0.30 (carga da migração). */
    hash: HashPreCadastroSchema.nullable(),
    origem: OrigemTentativaSchema,
    corrigido_por: z.object({ id: Uuid, nome: z.string(), perfil: z.string() }).nullable(),
    enviado_em: z.string().datetime(),
    campos_alterados: z.array(z.string()).max(20),
    resultado: ResultadoTentativaSchema,
    respondido_em: z.string().datetime().nullable(),
    motivo: z.string().max(500).nullable(),
    erros: ErrosCampoCadastroSchema,
    /** Id do recusado substituído pelo APK v1.0.28 (`id` novo com o mesmo CPF/CNPJ). */
    cliente_id_original: Uuid.nullable(),
    /**
     * v1.0.30 (aditivo): Código ERP com que a tentativa foi aceita. A tentativa não guarda o código: vem o `external_id` atual do cliente
     * quando `resultado = 'aceito'` (o vínculo com o ERP não muda depois de gravado: código diferente é conflito, `decidirVinculoErp`);
     * nulo nas demais e no aceito sem código.
     */
    external_id: z.string().nullish(),
});
/** `GET /v1/core/clientes/:id/pre-cadastro/historico`. */
export const HistoricoPreCadastroSchema = z.object({ cliente_id: Uuid, revisao_atual: RevisaoCadastroSchema, tentativas: z.array(TentativaPreCadastroSchema) });
/** `GET /v1/core/clientes/pre-cadastro/recusados` (BKO; filtros vão na URL). */
export const RecusadosEntradaSchema = z
    .object({
    situacao: SituacaoRecusadoSchema.default('recusado'),
    /** Razão social (contém) ou dígitos do documento (prefixo). */
    busca: z.string().trim().max(60).optional(),
    limite: z.coerce.number().int().min(1).max(200).default(50),
    /** Opaco: (recusado_em, id) da última linha. */
    cursor: z.string().max(200).optional(),
})
    .strict();
export const RecusadoItemSchema = z.object({
    cliente_id: Uuid,
    revisao: RevisaoCadastroSchema,
    /** `mascararDocumentoDoFarol` (domain/farol); nulo se o documento não for CPF nem CNPJ. */
    documento_mascarado: z.string().nullable(),
    razao_social: z.string(),
    /** Papel 'vendedor' da carteira. */
    vendedor: z.object({ id: Uuid, nome: z.string() }).nullable(),
    /** `respondido_em` da última tentativa recusada. */
    recusado_em: z.string().datetime(),
    motivo: z.string().max(500).nullable(),
    erros: ErrosCampoCadastroSchema,
    situacao: SituacaoRecusadoSchema,
    /** v1.0.30 (ADR 0069 item 10, aditivos): Código FDV e Código ERP (`external_id`, o atual do cliente; nulo antes do aceito). */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
    external_id: z.string().nullish(),
});
export const RecusadosSaidaSchema = z.object({ itens: z.array(RecusadoItemSchema).max(200), proximo_cursor: z.string().nullable() });
/** `GET /v1/core/clientes/:id/pre-cadastro`: dados atuais para o formulário de correção (documento completo: quem corrige precisa). */
export const PreCadastroAtualSchema = CorrecaoPreCadastroSchema.omit({ revisao_base: true, codigo_fdv: true }).extend({
    id: Uuid,
    /** v1.0.30 (ADR 0069 item 10, aditivos): os dois códigos do cliente (FDV e ERP), só de leitura. */
    codigo_fdv: CodigoFdvClienteSchema.nullish(),
    external_id: z.string().nullish(),
    revisao: RevisaoCadastroSchema,
    status_cadastro: StatusCadastroSchema,
    motivo: z.string().max(500).nullable(),
    erros: ErrosCampoCadastroSchema,
});
/** Evento da revisão nova do recusado (RN-CORE-78): só ids, a revisão e a origem (sem dado pessoal na outbox). Consumidor: Integração. */
export const ClientePreCadastroRevisadoSchema = z.object({
    cliente_id: Uuid,
    revisao: RevisaoCadastroSchema,
    origem: OrigemTentativaSchema,
    revisado_em: z.string().datetime(),
});
export const EVENTO_CLIENTE_PRE_CADASTRO_REVISADO = definirEvento('core.cliente.pre_cadastro_revisado@1', ClientePreCadastroRevisadoSchema);
