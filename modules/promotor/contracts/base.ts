/**
 * Tipos básicos dos contratos do Promotor. Mais estritos que os da Fase M do Core: ids são UUID gerados
 * no aparelho (escrita idempotente), instantes são ISO 8601 em UTC (`...Z`), dinheiro em centavos inteiros.
 */
import { z } from 'zod';

export { IsoDate } from '@macuxi/core/contracts';

/** UUID gerado no aparelho; reenvio com o mesmo id não duplica. */
export const Uuid = z.string().uuid();
/** Instante em UTC (`2026-10-31T13:00:00Z`); a exibição usa o fuso do tenant. */
export const InstanteUtc = z.string().datetime();
/** Dinheiro em centavos, inteiro, > 0 (preço de prateleira). */
export const PrecoCents = z.number().int().positive();
export const PctNumero = z.number().finite();
export const Latitude = z.number().min(-90).max(90);
export const Longitude = z.number().min(-180).max(180);
export const TextoCurto = z.string().trim().min(1).max(500);

/**
 * Produto referenciado pelo cadastro base do Core (`core.produto`, ADR-0005) por `produto_id`.
 * PREMISSA: o Core ainda não exporta `Produto` em contracts (T-0007); quando exportar, o Promotor passa a
 * importar de `@macuxi/core/contracts` e só a referência por id permanece aqui.
 */
export const ProdutoId = Uuid;
/** Loja = cliente da carteira (Core). */
export const ClienteId = Uuid;
