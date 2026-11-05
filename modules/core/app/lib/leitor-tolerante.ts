/**
 * Leitor tolerante de contratos @1 no aparelho (T-0076 C1): campo novo e aditivo na resposta do servidor não pode
 * derrubar um app mais antigo. Troca `.strict()` por `.strip()` em todos os objetos do schema (recursivo), de modo que
 * campos desconhecidos somem e os conhecidos seguem validados como no contrato.
 */
import { z } from 'zod';

export function tolerante<T extends z.ZodTypeAny>(schema: T): T {
  return converter(schema) as T;
}

function converter(s: z.ZodTypeAny): z.ZodTypeAny {
  // Por typeName (não instanceof): o contrato pode ter sido criado por outra cópia do zod no monorepo.
  const def = s._def as unknown as { typeName?: string; [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = Object.fromEntries(Object.entries((s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>).map(([k, v]) => [k, converter(v)]));
      return z.object(shape).strip();
    }
    case 'ZodArray':
      return z.array(converter(def.type));
    case 'ZodOptional':
      return converter(def.innerType).optional();
    case 'ZodNullable':
      return converter(def.innerType).nullable();
    case 'ZodDefault':
      return converter(def.innerType).default(def.defaultValue());
    case 'ZodEffects':
      return new z.ZodEffects({ ...def, schema: converter(def.schema) } as never);
    case 'ZodUnion':
      return z.union(def.options.map(converter) as [z.ZodTypeAny, z.ZodTypeAny]);
    case 'ZodRecord':
      return z.record(def.keyType, converter(def.valueType));
    default:
      return s;
  }
}
