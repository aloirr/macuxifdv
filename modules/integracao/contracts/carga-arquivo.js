/**
 * Carga por arquivo (RF-INT-03): `POST /v1/integracao/cargas-arquivo` (BKO, JWT, ação `carga.arquivo`: admin e analista).
 * O CSV vai como TEXTO no corpo JSON (`conteudo`) — a plataforma só lê JSON nas rotas de módulo. O arquivo vira o envelope canônico
 * de um lote do Conector do tipo `arquivo` e segue o pipeline do Hub (staging → aplicação → eventos). Colunas = campos de
 * `SCHEMA_REGISTRO[entidade]` (ver `docs/modulos/integracao/carga-arquivo.md`).
 */
import { z } from 'zod';
import { Uuid, DataHoraUtc } from './base';
import { EstadoLote, InativacaoLote, LoteAceito, ModoCarga } from './lote';
import { Entidade } from './entidades';
export const CargaArquivoEntrada = z.object({
    /** Entidade do contrato canônico (`cliente`, `produto`…). Conferida no módulo (422 `entidade_desconhecida` lista as válidas). */
    entidade: z.string({ required_error: 'entidade é obrigatória' }).trim().min(1, 'entidade é obrigatória').max(40),
    /** `delta` (padrão) ou `completo`. Conferido no módulo (422 `modo_invalido`). */
    modo: z.string().trim().max(20).optional(),
    /** Texto do CSV (UTF-8, com ou sem BOM). Limite de linhas e de bytes iguais aos do lote. */
    conteudo: z.string({ required_error: 'conteudo é obrigatório' }).min(1, 'O arquivo está vazio.'),
    /**
     * RN-INT-12: a `Idempotency-Key` desta carga (16 a 128 caracteres seguros). Obrigatória — conferida no módulo (422
     * `chave_idempotencia_invalida`) com a mesma regra do `POST /lotes`; vai no corpo porque a rota de usuário não expõe cabeçalhos.
     */
    chave_idempotencia: z.string().max(200).optional(),
    /** Identificador do Conector do tipo arquivo; omitido = o único Conector arquivo ativo que recebe a entidade. */
    conector_id: z.string().trim().min(1).max(100).optional(),
    /**
     * Arquivo grande em partes da MESMA sessão de carga completa (a tela do BKO divide sozinha): `sessao_id`, `parte` e `total_partes`
     * vêm os três ou nenhum (422 `partes_incompletas`); a `chave_idempotencia` é a MESMA em todas as partes. `parte` de 1 a
     * `total_partes` (até 1000) é conferida no módulo. Só a última parte aplicada fecha a sessão e inativa o que sumiu (RN-INT-06).
     */
    sessao_id: Uuid.optional(),
    parte: z.number().int().optional(),
    total_partes: z.number().int().optional(),
    /** Linha, no arquivo ORIGINAL, do primeiro registro da parte (2 ou mais): os erros citam a linha do arquivo original. */
    linha_inicial: z.number().int().min(2).optional(),
});
/** 202: o lote foi recebido e será aplicado em segundo plano; acompanhe em `consulta` (resultado e erros por linha do arquivo). */
export const CargaArquivoAceita = LoteAceito.extend({
    /** Identificador do Conector arquivo dono do lote. */
    conector_id: z.string(),
    /** Linhas de dados lidas do arquivo (válidas + com erro de leitura). */
    linhas_lidas: z.number().int().positive(),
    /** Linhas que já nasceram inválidas na leitura (valor que não converte etc.): aparecem como erro, com a linha do arquivo, quando o lote é aplicado. */
    linhas_invalidas_leitura: z.number().int().nonnegative(),
    /** Só quando o envio é uma parte: a sessão e onde acompanhar o progresso de todas as partes. */
    sessao: z
        .object({
        id: Uuid,
        parte: z.number().int().positive(),
        total_partes: z.number().int().positive(),
        /** `/v1/integracao/cargas-arquivo/sessoes/{id}` */
        consulta: z.string(),
    })
        .optional(),
});
/** `GET /v1/integracao/cargas-arquivo/sessoes/{sessao_id}`. */
export const ParamsSessaoArquivo = z.object({ sessao_id: Uuid });
const ContagensParte = z.object({
    recebidas: z.number().int().nonnegative(),
    com_erro: z.number().int().nonnegative(),
    novas: z.number().int().nonnegative(),
    atualizadas: z.number().int().nonnegative(),
    inalteradas: z.number().int().nonnegative(),
    obsoletas: z.number().int().nonnegative(),
});
/** Progresso de um arquivo enviado em partes (monitor.ver): quantas partes chegaram, foram aplicadas, o que falta e a inativação. */
export const ProgressoSessaoArquivo = z.object({
    sessao_id: Uuid,
    entidade: Entidade,
    modo: ModoCarga,
    total_partes: z.number().int().positive(),
    /** `expirada`: passou o prazo (`expira_em`) com parte faltando; nada foi inativado. */
    situacao: z.enum(['aberta', 'completa', 'expirada']),
    partes_recebidas: z.number().int().nonnegative(),
    /** Partes `concluido` ou `concluido_com_erros`. */
    partes_aplicadas: z.number().int().nonnegative(),
    partes_com_falha: z.number().int().nonnegative(),
    partes_faltando: z.array(z.number().int().positive()),
    partes: z.array(ContagensParte.extend({ parte: z.number().int().positive(), lote_id: Uuid, status: EstadoLote })),
    /** Contagens somadas das partes. */
    contagens: ContagensParte,
    /** Soma dos erros por linha de todas as partes (detalhe em `GET lotes/{id}/erros` de cada parte). */
    erros_total: z.number().int().nonnegative(),
    /** Só no modo completo, com a sessão fechada. */
    inativacao: InativacaoLote.optional(),
    aviso: z.object({ codigo: z.string(), mensagem: z.string() }).optional(),
    iniciada_em: DataHoraUtc,
    expira_em: DataHoraUtc,
});
