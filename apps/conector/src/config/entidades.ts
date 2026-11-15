/** Entidades do contrato do Hub na ordem de carga (RN-INT-04) e utilidades sobre o schema. */
import { ENTIDADES, SCHEMA_REGISTRO, type Entidade } from '@macuxi/integracao/contracts';
import { z } from 'zod';

export { ENTIDADES };
export type { Entidade };

/** filial → vendedor → cliente → (rota, título, nota); produto → (preço, estoque). Ordem estável usada pelo laço de execução. */
export const ORDEM_CARGA: readonly Entidade[] = ['filial', 'vendedor', 'catalogo_no', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'cliente', 'cliente_endereco', 'preco', 'tabela_escalonada', 'estoque', 'rota', 'titulo', 'nota'];

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
  forma_pagamento: 3600,
  prazo_pagamento: 3600,
  tabela_escalonada: 3600,
  filial: 3600,
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

/**
 * O campo (caminho com ponto, ex. `endereco.cidade`) aceita `null` no contrato? Base do opt-in `nulo: limpa` (T-0099): `external_id`
 * e `alterado_em` nunca (são o cursor). Caminho que não se resolve no schema conta como "não aceita" (lado seguro).
 */
export function campoAceitaNulo(entidade: Entidade, caminho: string): boolean {
  if (caminho === 'external_id' || caminho === 'alterado_em') return false;
  let atual: z.ZodTypeAny = SCHEMA_REGISTRO[entidade];
  const partes = caminho.split('.');
  for (const [i, parte] of partes.entries()) {
    const obj = desembrulhar(atual);
    if (!(obj instanceof z.ZodObject)) return false;
    const filho = (obj.shape as Record<string, z.ZodTypeAny>)[parte];
    if (!filho) return false;
    if (i === partes.length - 1) return filho.safeParse(null).success;
    atual = filho;
  }
  return false;
}

export function ehEntidade(x: string): x is Entidade {
  return (ENTIDADES as readonly string[]).includes(x);
}
