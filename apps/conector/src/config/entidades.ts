/** Entidades do contrato do Hub na ordem de carga (RN-INT-04) e utilidades sobre o schema. */
import { ENTIDADES, SCHEMA_REGISTRO, type Entidade } from '@macuxi/integracao/contracts';
import { z } from 'zod';

export { ENTIDADES };
export type { Entidade };

/** vendedor → cliente → (rota, título, nota); produto → (preço, estoque). Ordem estável usada pelo laço de execução. */
export const ORDEM_CARGA: readonly Entidade[] = ['vendedor', 'catalogo_no', 'transportadora', 'produto', 'produto_unidade', 'cliente', 'cliente_endereco', 'preco', 'estoque', 'rota', 'titulo', 'nota'];

/** Frequência sugerida pelo doc 06 (segundos). */
export const PERIODICIDADE_PADRAO: Record<Entidade, number> = {
  vendedor: 3600,
  cliente: 3600,
  produto: 3600,
  preco: 900,
  estoque: 600,
  titulo: 3600,
  nota: 900,
  rota: 3600,
  catalogo_no: 3600,
  produto_unidade: 3600,
  cliente_endereco: 3600,
  transportadora: 3600,
};

function desembrulhar(s: z.ZodTypeAny): z.ZodTypeAny {
  let atual = s;
  for (let i = 0; i < 5; i++) {
    const d = atual._def as { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny };
    if (d.schema) atual = d.schema;
    else if (d.innerType) atual = d.innerType;
    else break;
  }
  return atual;
}

/** Campos de primeiro nível do registro canônico da entidade. */
export function camposDoContrato(entidade: Entidade): string[] {
  const s = desembrulhar(SCHEMA_REGISTRO[entidade]);
  return s instanceof z.ZodObject ? Object.keys(s.shape as Record<string, unknown>) : [];
}

export function ehEntidade(x: string): x is Entidade {
  return (ENTIDADES as readonly string[]).includes(x);
}
