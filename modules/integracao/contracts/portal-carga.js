/**
 * Rotas que o portal de implantação (`config.`, T-0087) e o BKO usam em volta da carga por arquivo (aditivo na v1):
 *  - `GET  /v1/integracao/ordem-carga`                 -> `OrdemCargaResposta` (a lista dos cartões, sem lista própria no portal);
 *  - `POST /v1/integracao/cargas-arquivo/conferir`     -> `ConferenciaArquivo` (valida o arquivo e NÃO grava nada);
 *  - `GET  /v1/integracao/lotes/{id}/erros.csv`        -> arquivo `erros-<id>.csv` (text/csv; um erro por linha).
 */
import { z } from 'zod';
import { Entidade } from './entidades';
import { LinhaErro, ModoCarga } from './lote';
export const ItemOrdemCarga = z.object({
    entidade: Entidade,
    /** Posição na ordem de carga (1 = primeira). */
    posicao: z.number().int().positive(),
    /** Títulos e notas: a empresa pode começar sem eles. */
    opcional: z.boolean(),
    /** Entidades que precisam estar carregadas antes (referência obrigatória, RN-INT-04). */
    depende_de: z.array(Entidade),
});
export const OrdemCargaResposta = z.object({ itens: z.array(ItemOrdemCarga) });
/** Mesmo corpo da carga por arquivo, só o que a conferência precisa (sem chave de idempotência: nada é gravado). */
export const ConferirArquivoEntrada = z.object({
    entidade: z.string({ required_error: 'entidade é obrigatória' }).trim().min(1, 'entidade é obrigatória').max(40),
    modo: z.string().trim().max(20).optional(),
    conteudo: z.string({ required_error: 'conteudo é obrigatório' }).min(1, 'O arquivo está vazio.'),
    /** Linha, no arquivo original, do primeiro registro (parte de um arquivo dividido): os erros citam a linha original. */
    linha_inicial: z.number().int().min(2).max(10_000_000).optional(),
    /** Quantos erros listar (padrão 200, máximo 1000); o resto vem em `erros_omitidos`. */
    limite_erros: z.number().int().min(1).max(1000).optional(),
});
export const ConferenciaArquivo = z.object({
    entidade: Entidade,
    modo: ModoCarga,
    linhas_lidas: z.number().int().nonnegative(),
    linhas_validas: z.number().int().nonnegative(),
    linhas_com_erro: z.number().int().nonnegative(),
    /** Primeiros erros por linha ("Linha N do arquivo: ..."), sem o valor digitado. */
    erros: z.array(LinhaErro),
    erros_omitidos: z.number().int().nonnegative(),
    /** Verdade quando nenhuma linha tem erro de formato. Referências a outras entidades só são conferidas ao gravar. */
    pode_gravar: z.boolean(),
    /** Sempre `false`: a conferência não guarda o arquivo nem cria lote. */
    gravou: z.literal(false),
});
