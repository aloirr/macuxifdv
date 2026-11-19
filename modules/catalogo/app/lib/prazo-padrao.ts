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

/** Espelho mínimo de `vendedor.preco_prazo_padrao@1` (nome = chave de ligação): lista de valores em cents, mesma ordem na saída. */
export const CONSULTA_PRECO_PRAZO_PADRAO = definirConsulta({
  nome: 'vendedor.preco_prazo_padrao@1',
  entrada: z.object({ cliente_id: Id, cents: z.array(Cents).max(1000) }),
  saida: z.object({ cents: z.array(Cents) }),
});

type Consultar = (def: typeof CONSULTA_PRECO_PRAZO_PADRAO, entrada: z.input<typeof CONSULTA_PRECO_PRAZO_PADRAO.entrada>) => Promise<z.output<typeof CONSULTA_PRECO_PRAZO_PADRAO.saida>>;

const LOTE = 1000;

/** Uma chamada por lote de até 1000 valores; saída de tamanho diferente da entrada é erro (quem chama devolve a tabela pura). */
async function ajustar(consultar: Consultar, clienteId: string, valores: number[]): Promise<number[]> {
  const saida: number[] = [];
  for (let i = 0; i < valores.length; i += LOTE) {
    const lote = valores.slice(i, i + LOTE);
    const r = await consultar(CONSULTA_PRECO_PRAZO_PADRAO, { cliente_id: clienteId, cents: lote });
    if (r.cents.length !== lote.length) throw new Error('vendedor.preco_prazo_padrao@1: saída de tamanho diferente da entrada');
    saida.push(...r.cents);
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
  // um vetor só com price_cents e base_cents não nulos de todos os itens; o ajuste volta na mesma posição
  const vetor: number[] = [];
  for (const i of itens) {
    if (!i.price) continue;
    if (i.price.price_cents !== null) vetor.push(i.price.price_cents);
    if (i.price.base_cents !== null) vetor.push(i.price.base_cents);
  }
  if (vetor.length === 0) return itens;
  try {
    const ajustado = await ajustar(consultar, clienteId, vetor);
    let pos = 0;
    return itens.map((i) => {
      if (!i.price) return i;
      const price_cents = i.price.price_cents !== null ? (ajustado[pos++] as number) : null;
      const base_cents = i.price.base_cents !== null ? (ajustado[pos++] as number) : null;
      return price_cents === i.price.price_cents && base_cents === i.price.base_cents ? i : { ...i, price: { ...i.price, price_cents, base_cents } };
    });
  } catch {
    return itens;
  }
}
