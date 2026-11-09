/**
 * T-0130 (Frente G, v1.0.1) — 🟡 do designer-ux (R-20261108-202829): a linha "Salvo" da lista Pedidos mostrava R$ 0,00
 * (`rascunhosSalvosComoPedidos` com `total_cents: 0`) e o resumo do topo ("N pedidos · R$ …") somava esse zero.
 * Valor × regra (RN-VEN-30, RN-VEN-38): a linha "Salvo" mostra o total do rascunho pelo MESMO cálculo do Resumo do pedido
 * (`calcularPedido`, modules/vendedor/app/lib/novo-pedido.ts); sem tabela de preços no aparelho, "—" e fora da soma; nunca
 * "R$ 0,00". Sem banco: roda local e no CI. Matriz em docs/testes/T-0124.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { formatBRL, formatBRL0 } from '@macuxi/comum';

import { calcularPedido, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { rascunhoVazio, type PedidoDaLista, type Rascunho } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { clienteDoRascunho, rascunhosSalvosComoPedidos, totalDaLinhaSalva } from '../../modules/vendedor/app/lib/salvar-na-fila';
import { resumoDaSituacao, type ItemDaBusca } from '../../modules/vendedor/domain/busca-periodo';

const RAIZ = join(__dirname, '..', '..');
const P = (id: string, preco: number): Product =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as Product;
const CATALOGO = [P('p1', 1_250), P('p2', 4_990)];
const UNIDADES: UnidadeDaTela[] = [];
const nome = () => 'Mercadinho São Jorge';
const rascunho = (o: Partial<Rascunho> = {}): Rascunho => ({ ...rascunhoVazio('c1'), lines: { p1: 4, p2: 2 }, updated_at: '2026-11-08T10:00:00Z', salvo_em: '2026-11-08T10:05:00Z', ...o });

/** O total que o Resumo do pedido mostra para o rascunho (mesma chamada do new-order-screen e do use-vendedor). */
const totalDoResumo = (r: Rascunho) =>
  calcularPedido({ lines: r.lines, ajustes: r.ajustes ?? {}, desconto_pct: r.discount_pct, acrescimo_pct: r.acrescimo_pct ?? 0, catalogo: CATALOGO, unidades: UNIDADES, politica: politicaApi({}), vendedor_id: 'v1' }).total_cents;
/** Lista → itens da tela (orders-screen.tsx mapeia `total_cents` direto). */
const itens = (l: PedidoDaLista[]): ItemDaBusca[] => l.map((o) => ({ id: o.id, numero: o.number, nome_fantasia: o.customer_name, razao_social: '', tipo: o.tipo, status: o.status, local: o.local, total_cents: o.total_cents, emitido_em: o.received_at }));
const pedidoNoServidor = { id: 'srv-1', number: '000011', customer_name: 'Bar do Zé', status: 'approved', local: false, total_cents: 5_000, received_at: '2026-11-08T09:00:00Z' } as PedidoDaLista;

describe('T-0130 / 🟡 R-20261108-202829 — linha "Salvo" da lista Pedidos (RN-VEN-30, RN-VEN-38)', () => {
  it('S1. valor × regra: com a tabela no aparelho, a linha mostra o total do Resumo (4 × R$ 12,50 + 2 × R$ 49,90 = R$ 149,80), não R$ 0,00', () => {
    const r = rascunho();
    expect(totalDoResumo(r)).toBe(4 * 1_250 + 2 * 4_990); // oráculo: quantidade × preço, sem desconto
    const [linha] = rascunhosSalvosComoPedidos({ c1: r }, nome, totalDoResumo);
    expect(clienteDoRascunho(linha!.id)).toBe('c1');
    expect(linha!.total_cents).toBe(totalDoResumo(r));
    const texto = totalDaLinhaSalva(linha!, formatBRL).replace(/\u00a0/g, ' ');
    expect(texto).toBe(formatBRL(14_980).replace(/\u00a0/g, ' '));
    expect(texto).not.toMatch(/R\$\s*0,00/);
  });

  it('S2. sem tabela de preços no aparelho (total nulo): a linha mostra "—" e o resumo do topo não soma o rascunho', () => {
    const [linha] = rascunhosSalvosComoPedidos({ c1: rascunho() }, nome, () => null);
    expect(totalDaLinhaSalva(linha!, formatBRL)).toBe('—');
    const resumo = resumoDaSituacao(itens([linha!, pedidoNoServidor]), 'todos');
    expect(resumo.total_cents).toBe(5_000);
    expect(formatBRL0(resumo.total_cents)).toBe(formatBRL0(5_000));
  });

  it('S3. com o total: o resumo do topo soma o total do Resumo (R$ 149,80 + R$ 50,00)', () => {
    const [linha] = rascunhosSalvosComoPedidos({ c1: rascunho() }, nome, totalDoResumo);
    expect(resumoDaSituacao(itens([linha!, pedidoNoServidor]), 'todos').total_cents).toBe(14_980 + 5_000);
  });

  it('S4. ligação na tela: a linha do rascunho usa totalDaLinhaSalva (orders-screen.tsx) e o estado passa o total pelo calcularPedido (use-vendedor.ts)', () => {
    const tela = readFileSync(join(RAIZ, 'modules/vendedor/app/screens/orders-screen.tsx'), 'utf8');
    expect(tela).toMatch(/clienteDoRascunho\(o\.id\)\s*\?\s*totalDaLinhaSalva\(o,/);
    const estado = readFileSync(join(RAIZ, 'modules/vendedor/app/state/use-vendedor.ts'), 'utf8');
    // RN-VEN-39 (T-0141): o relógio vem depois do total (o rascunho de mais de 24 h sai da lista)
    expect(estado).toMatch(/rascunhosSalvosComoPedidos\([^;]*totalDoRascunho(, new Date\(\))?\)/);
    expect(estado).toMatch(/const totalDoRascunho[\s\S]{0,800}calcularPedido\(/);
  });
});
