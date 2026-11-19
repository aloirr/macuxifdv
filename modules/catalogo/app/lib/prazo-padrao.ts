/**
 * RN-VEN-43 (docs/design/prazo-ajuste/README.md §1.3): pela ficha do cliente (`?cliente=`), o preço do cartão e da ficha sai
 * na tabela ajustada pelo prazo padrão do cliente; pelo menu, sem cliente, a tabela pura. A regra do percentual é toda do
 * Vendedor (`precoDoCatalogoCents`); aqui só se pede o valor ajustado pela consulta OPCIONAL `vendedor.preco_prazo_padrao@1`
 * (ADR 0019; o Catálogo não importa o pacote do Vendedor, que já depende dele: evita ciclo). Mesmo padrão de `core/api/metas.ts`.
 */
import { definirConsulta } from '@macuxi/platform-sdk';
import { z } from 'zod';
import type { ItemVitrine } from '../../contracts';

const Id = z.string().uuid();
const Cents = z.number().int().min(0);

/** Espelho mínimo de `vendedor.preco_prazo_padrao@1` (nome = chave de ligação; saída tolerante a campos extras). */
export const CONSULTA_PRECO_PRAZO_PADRAO = definirConsulta({
  nome: 'vendedor.preco_prazo_padrao@1',
  entrada: z.object({ cliente_id: Id, precos: z.array(z.object({ produto_id: Id, cents: Cents })).max(500) }),
  saida: z.object({ precos: z.array(z.object({ produto_id: Id, cents: Cents })) }),
});

type Consultar = (def: typeof CONSULTA_PRECO_PRAZO_PADRAO, entrada: z.input<typeof CONSULTA_PRECO_PRAZO_PADRAO.entrada>) => Promise<z.output<typeof CONSULTA_PRECO_PRAZO_PADRAO.saida>>;

const LOTE = 500;

async function ajustar(consultar: Consultar, clienteId: string, valores: Map<string, number>): Promise<Map<string, number>> {
  const saida = new Map<string, number>();
  const todos = [...valores].map(([produto_id, cents]) => ({ produto_id, cents }));
  for (let i = 0; i < todos.length; i += LOTE) {
    const r = await consultar(CONSULTA_PRECO_PRAZO_PADRAO, { cliente_id: clienteId, precos: todos.slice(i, i + LOTE) });
    for (const p of r.precos) if (valores.has(p.produto_id)) saida.set(p.produto_id, p.cents);
  }
  return saida;
}

/**
 * RN-VEN-43: devolve os itens com `price_cents` e `base_cents` ajustados pelo prazo padrão do cliente. Sem cliente, itens iguais.
 * Consulta indisponível (Vendedor desligado, não instalado, APK sem a consulta) ou erro: itens iguais (tabela pura), sem aviso.
 * Só os dois valores em cents mudam; `sellable`, estoque e promoção ficam como vieram.
 */
export async function ajustarPeloPrazoPadrao(itens: ItemVitrine[], clienteId: string | null, consultar: Consultar | undefined): Promise<ItemVitrine[]> {
  if (!clienteId || !consultar) return itens;
  const precos = new Map<string, number>();
  const bases = new Map<string, number>();
  for (const i of itens) {
    if (!i.price) continue;
    if (i.price.price_cents !== null) precos.set(i.id, i.price.price_cents);
    if (i.price.base_cents !== null) bases.set(i.id, i.price.base_cents);
  }
  if (precos.size === 0 && bases.size === 0) return itens;
  try {
    const [p, b] = await Promise.all([ajustar(consultar, clienteId, precos), ajustar(consultar, clienteId, bases)]);
    return itens.map((i) => {
      if (!i.price) return i;
      const price_cents = p.get(i.id) ?? i.price.price_cents;
      const base_cents = b.get(i.id) ?? i.price.base_cents;
      return price_cents === i.price.price_cents && base_cents === i.price.base_cents ? i : { ...i, price: { ...i.price, price_cents, base_cents } };
    });
  } catch {
    return itens;
  }
}
