/**
 * `GET /v1/core/cep?cep=69053000` (RN-CORE-75): pesquisa de CEP feita pelo servidor (BrasilAPI, com ViaCEP de reserva) para o endereço do
 * usuário no BKO. 200 com os campos; 404 `CEP_NAO_ENCONTRADO`; 422 `CEP_INVALIDO` (8 dígitos); 503 `CEP_SERVICO_INDISPONIVEL`.
 */
import { z } from 'zod';

/** Texto único do CEP sem 8 dígitos (formulário e API). */
export const ERRO_CEP_INVALIDO = 'CEP com 8 dígitos.';
/** 8 dígitos, mas recusado por `cepValido` (00000000): o Salvar não aceita. */
export const ERRO_CEP_RECUSADO = 'CEP inválido.';
/** Formato da pesquisa: 8 dígitos (com ou sem hífen). Ao lado de `cepValido` (packages/comum), que recusa 00000000: aqui 00000000 passa e a pesquisa é que responde "não encontrado". */
export const cepTemOitoDigitos = (cep: string): boolean => /^\d{8}$/.test(cep.replace(/\D/g, ''));

export const CepQuerySchema = z.object({ cep: z.string().max(20) }).strict();
export const CepEncontradoSchema = z
  .object({ logradouro: z.string(), bairro: z.string(), cidade: z.string(), uf: z.string().length(2) })
  .strict();
export type CepEncontrado = z.infer<typeof CepEncontradoSchema>;
export const CODIGOS_CEP = {
  invalido: 'CEP_INVALIDO',
  naoEncontrado: 'CEP_NAO_ENCONTRADO',
  indisponivel: 'CEP_SERVICO_INDISPONIVEL',
} as const;
