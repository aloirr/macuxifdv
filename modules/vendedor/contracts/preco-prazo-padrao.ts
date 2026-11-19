/**
 * Consulta `vendedor.preco_prazo_padrao@1` (RN-VEN-43; PR do Catálogo #503): o Catálogo pede os valores de tabela ajustados pelo
 * prazo padrão do cliente. Mesmo tamanho e ordem da entrada; sem prazo padrão ou sem percentual, valores iguais. A regra é a de
 * `ajustarCentsPeloPrazoPadrao` (prazo-ajuste.ts), a mesma no aparelho e na API.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const PrecoPrazoPadraoEntradaSchema = z.object({ cliente_id: z.string().uuid(), cents: z.array(z.number().int().min(0)).max(1000) });
export const PrecoPrazoPadraoSaidaSchema = z.object({ cents: z.array(z.number().int().min(0)) });
export const CONSULTA_PRECO_PRAZO_PADRAO = definirConsulta({
  nome: 'vendedor.preco_prazo_padrao@1',
  entrada: PrecoPrazoPadraoEntradaSchema,
  saida: PrecoPrazoPadraoSaidaSchema,
});
