/**
 * T-0130 (Frente G) → T-0141 F (pranchas aprovadas, R-20261109-121700; docs/design/pedido-v3.md F.1): o rascunho saiu da lista
 * Pedidos e mora só na tela **Rascunhos** (recado R-20261109-140227 do modulo-vendedor). O que este teste guardava (o total do
 * rascunho nunca "R$ 0,00", 🟡 R-20261108-202829) passa a valer na tela Rascunhos.
 * Valor × regra (RN-VEN-39: a lista mostra cliente, total e a hora da última alteração e some 24 h depois da última
 * alteração; RN-VEN-30 para o total): o total da linha é o MESMO cálculo do Resumo do pedido (`calcularPedido`); sem tabela de
 * preços no aparelho, sem total (nunca R$ 0,00); o selo "Some em" segue as 24 h; a hora sai no fuso do tenant.
 * Sem banco: roda local e no CI. Matriz em docs/testes/T-0124.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Product } from '@macuxi/catalogo/contracts';
import { formatBRL } from '@macuxi/comum';

import { calcularPedido, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { rascunhoVazio, type Rascunho } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { linhasDosRascunhos } from '../../modules/vendedor/app/lib/rascunhos-lista';

const RAIZ = join(__dirname, '..', '..');
const TZ = 'America/Manaus';
const P = (id: string, preco: number): Product =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as Product;
const CATALOGO = [P('p1', 1_250), P('p2', 4_990)];
const UNIDADES: UnidadeDaTela[] = [];
const CLIENTES = [{ id: 'c1', trade_name: 'Mercadinho São Jorge', erp_code: '1234' }];
/** Alterado às 10:00 UTC de 08/11 = 06:00 em Manaus. */
const ALTERADO = '2026-11-08T10:00:00Z';
const rascunho = (o: Partial<Rascunho> = {}): Rascunho => ({ ...rascunhoVazio('c1'), lines: { p1: 4, p2: 2 }, updated_at: ALTERADO, ...o });
const depois = (horas: number) => new Date(Date.parse(ALTERADO) + horas * 3_600_000);

/** O total que o Resumo do pedido mostra para o rascunho (mesma chamada do new-order-screen e do use-vendedor). */
const totalDoResumo = (r: Rascunho) =>
  calcularPedido({ lines: r.lines, ajustes: r.ajustes ?? {}, desconto_pct: r.discount_pct, acrescimo_pct: r.acrescimo_pct ?? 0, catalogo: CATALOGO, unidades: UNIDADES, politica: politicaApi({}), vendedor_id: 'v1' }).total_cents;
const linhas = (r: Rascunho, total: (r: Rascunho) => number | null, agora = depois(1)) =>
  linhasDosRascunhos({ rascunhos: { c1: r }, clientes: CLIENTES, pedidos: [], totalDoRascunho: total, agora, tz: TZ });
const semNbsp = (s: string) => s.replace(/\u00a0/g, ' ');

describe('T-0141 F — tela Rascunhos: total, hora e "Some em" (RN-VEN-39, RN-VEN-30)', () => {
  it('R1. valor × regra: com a tabela no aparelho, a linha mostra o total do Resumo (4 × R$ 12,50 + 2 × R$ 49,90 = R$ 149,80), não R$ 0,00', () => {
    const r = rascunho();
    expect(totalDoResumo(r)).toBe(4 * 1_250 + 2 * 4_990); // oráculo: quantidade × preço, sem desconto
    const [l] = linhas(r, totalDoResumo);
    expect(l!.total_cents).toBe(14_980);
    expect(semNbsp(formatBRL(l!.total_cents!))).toBe(semNbsp(formatBRL(14_980)));
    expect(semNbsp(formatBRL(l!.total_cents!))).not.toMatch(/R\$\s*0,00/);
    expect(l).toMatchObject({ cliente: 'Mercadinho São Jorge', fato: 'Alterado hoje às 06:00', foraDaCarteira: false });
  });

  it('R2. sem tabela de preços no aparelho: total nulo (a tela não mostra valor nenhum), nunca zero', () => {
    const [l] = linhas(rascunho(), () => null);
    expect(l!.total_cents).toBeNull();
  });

  it('R3. hora da última alteração no fuso do tenant (10:00 UTC = 06:00 em Manaus); no dia seguinte, "ontem"', () => {
    expect(linhas(rascunho(), totalDoResumo, depois(1))[0]!.fato).toBe('Alterado hoje às 06:00');
    expect(linhas(rascunho(), totalDoResumo, depois(20))[0]!.fato).toBe('Alterado ontem às 06:00');
  });

  it('R4. "Some em" pelas 24 h desde a última alteração: nada com 3 h ou mais; "Some em 2 h"; "Some em 40 min"; some com 24 h', () => {
    expect(linhas(rascunho(), totalDoResumo, depois(20))[0]!.someEm).toBeNull(); // faltam 4 h
    expect(linhas(rascunho(), totalDoResumo, depois(22))[0]!.someEm).toBe('Some em 2 h');
    expect(linhas(rascunho(), totalDoResumo, depois(23 + 20 / 60))[0]!.someEm).toBe('Some em 40 min');
    expect(linhas(rascunho(), totalDoResumo, depois(24))).toEqual([]);
  });

  it('R5. ligação: o estado passa o total da linha pelo calcularPedido (use-vendedor.ts) e a tela mostra o total só quando ele existe', () => {
    const estado = readFileSync(join(RAIZ, 'modules/vendedor/app/state/use-vendedor.ts'), 'utf8');
    expect(estado).toMatch(/linhasDosRascunhos\(\{[^}]*totalDoRascunho/);
    expect(estado).toMatch(/const rascunhosDaLista[\s\S]{0,1500}calcularPedido\(/);
    const tela = readFileSync(join(RAIZ, 'modules/vendedor/app/screens/rascunhos-screen.tsx'), 'utf8');
    expect(tela).toMatch(/total_cents !== null \? <Text[^>]*>\{formatBRL\(l\.total_cents\)\}/);
  });
});
