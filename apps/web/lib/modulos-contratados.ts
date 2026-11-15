/**
 * ADR 0058: `modulos_contratados` de `GET /v1/me/modulos` (módulos ativos no tenant, sem o recorte do perfil), só para o BKO
 * mostrar a vitrine sem licença (Pesquisa, Trade, Treinamento com cadeado). Função pura, testável sem navegador.
 */
import { ModuloIdSchema } from '@macuxi/core/contracts';
import type { ModuloId } from '@macuxi/platform-sdk';

/**
 * Separa `modulos_contratados` do resto da resposta: lido à parte, de forma defensiva (o campo é novo, aditivo e só de
 * exibição; ausente ou inválido = `undefined`, nada aparece desativado), e tirado antes do `MeusModulosRespostaSchema`
 * (estrito), para a resposta valer com ou sem o campo no contrato.
 */
export function separarContratados(bruto: unknown): { resto: unknown; contratados: ModuloId[] | undefined } {
  if (typeof bruto !== 'object' || bruto === null || !('modulos_contratados' in bruto)) return { resto: bruto, contratados: undefined };
  const { modulos_contratados: campo, ...resto } = bruto as Record<string, unknown>;
  const lido = ModuloIdSchema.array().safeParse(campo);
  return { resto, contratados: lido.success ? lido.data : undefined };
}
