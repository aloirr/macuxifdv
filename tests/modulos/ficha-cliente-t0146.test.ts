/**
 * T-0146 — ficha do cliente sem repetição: valor × regra e rótulo × valor do topo (Campo, Gestão e BKO), sem banco.
 *
 * O topo ficou com os indicadores de compra: Compra média/mês, Última compra, Ticket médio, Frequência média e Compras em
 * 12 meses; limite e vencidos só no Financeiro. Os ORÁCULOS abaixo são escritos a partir do texto da RN-CORE-40 (doc 03,
 * publicada em 10/11 a pedido do testes, R-20261110-073524), nunca chamando a função testada:
 *  - janela: os 12 meses que terminam no mês de `hoje`, inclusive (hoje no fuso do tenant);
 *  - Compra média/mês = total da janela ÷ 12, sempre (centavos, meia para cima);
 *  - Ticket médio = total da janela ÷ pedidos da janela (centavos, meia para cima);
 *  - Frequência média = dias do 1º dia do 1º mês com compra na janela até hoje ÷ pedidos, 1 casa (tela: "a cada N dias");
 *  - Última compra = maior data de compra da janela; dias = hoje − essa data;
 *  - sem compra na janela: "Sem compras em 12 meses" no lugar dos 4 indicadores, sem zeros.
 * Cenários: dia útil, dia não útil, virada de mês no fuso de Manaus (UTC−4) e o 13º mês que a janela do sync traz.
 * Defeitos ficam em `it.fails` (o agente testes volta para `it` no commit da correção; o D-1 virou em 10/11). Matriz: docs/testes/T-0146.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ClienteSync, HistoricoCompraSync } from '../../modules/core/contracts';
import { montarCliente360Local } from '../../modules/core/app/lib/cliente360-local';
import { resumoDoCliente } from '../../modules/core/app/lib/rota-local';
import { dataLocal } from '../../modules/core/domain';

const RAIZ = join(__dirname, '..', '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');
const FUSO = 'America/Manaus';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { updated_at: '2026-11-01T10:00:00.000000Z', deleted_at: null, external_id: null };

const CLIENTE = {
  ...base,
  id: id(1),
  documento: '00000000000001',
  razao_social: 'Atacadinho Cachoeirinha Ltda',
  nome_fantasia: 'Atacadinho Cachoeirinha',
  segmento: 'Mercearia',
  telefone: '(92) 3222-0001',
  email: null,
  logradouro: 'Rua A',
  numero: '10',
  bairro: 'Cachoeirinha',
  cidade: 'Manaus',
  uf: 'AM',
  cep: null,
  latitude: '-3.100000',
  longitude: '-60.000000',
  ativo: true,
} as ClienteSync;

let seq = 100;
const mes = (ano_mes: string, valor_cents: number, pedidos: number, ultima: string | null): HistoricoCompraSync => ({
  ...base,
  id: id(seq++),
  cliente_id: CLIENTE.id,
  ano_mes,
  valor_cents,
  pedidos,
  itens: pedidos * 3,
  ultima_compra_em: ultima,
  origem: 'erp',
});

const ficha = (historico: HistoricoCompraSync[], hoje: string, verPedidos = true) =>
  montarCliente360Local({ cliente: CLIENTE, contatos: [], financeiro: null, titulos: [], historico }, hoje, { verPedidos });

// ---------- oráculos ----------
const diasCivis = (de: string, ate: string) => Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 86_400_000);
function janela12(hoje: string): string[] {
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
function esperado(historico: HistoricoCompraSync[], hoje: string) {
  const meses = janela12(hoje);
  const dentro = historico.filter((h) => meses.includes(h.ano_mes));
  const total = dentro.reduce((s, h) => s + h.valor_cents, 0);
  const pedidos = dentro.reduce((s, h) => s + h.pedidos, 0);
  const comCompra = dentro.filter((h) => h.pedidos > 0).map((h) => h.ano_mes).sort();
  const ultima = dentro.map((h) => h.ultima_compra_em).filter((d): d is string => Boolean(d)).sort().at(-1) ?? null;
  const freq = pedidos > 0 && comCompra[0] ? diasCivis(`${comCompra[0]}-01`, hoje) / pedidos : null;
  return {
    total_12m_cents: total,
    media_mes_cents: Math.round(total / 12),
    ticket_medio_cents: pedidos > 0 ? Math.round(total / pedidos) : 0,
    frequencia_texto: freq === null ? '—' : `a cada ${Math.round(freq)} dias`,
    ultima_compra_em: ultima,
    dias_sem_compra: ultima ? diasCivis(ultima, hoje) : null,
  };
}
const textoFrequencia = (f: number | null) => (f === null ? '—' : `a cada ${Math.round(f)} dias`); // mesmo texto do cartão (cliente360.tsx)

// Atacadinho: 4 pedidos em 3 meses da janela
const HIST = () => [mes('2026-11', 120_000, 1, '2026-11-05'), mes('2026-09', 300_000, 2, '2026-09-20'), mes('2026-03', 80_000, 1, '2026-03-10')];

describe('T-0146 — valor × regra dos indicadores de compra do topo', () => {
  it('dia útil (ter 10/11/2026): ticket R$ 1.250, frequência "a cada 64 dias", última compra há 5 dias, 12 meses R$ 5.000', () => {
    const hoje = '2026-11-10';
    const f = ficha(HIST(), hoje);
    const e = esperado(HIST(), hoje);
    expect(e).toMatchObject({ total_12m_cents: 500_000, ticket_medio_cents: 125_000, frequencia_texto: 'a cada 64 dias', dias_sem_compra: 5 });
    expect(f.resumo_compras.total_12m_cents).toBe(e.total_12m_cents);
    expect(f.resumo_compras.ticket_medio_cents).toBe(e.ticket_medio_cents);
    expect(textoFrequencia(f.resumo_compras.frequencia_media_dias)).toBe(e.frequencia_texto);
    expect(f.resumo_compras.ultima_compra_em).toBe(e.ultima_compra_em);
    expect(f.resumo_compras.dias_sem_compra).toBe(e.dias_sem_compra);
  });

  it('dia não útil (dom 15/11/2026): mesma conta; só os dias correm (indicador de compra não usa calendário de dias úteis)', () => {
    const hoje = '2026-11-15';
    const f = ficha(HIST(), hoje);
    const e = esperado(HIST(), hoje);
    expect(f.resumo_compras.ticket_medio_cents).toBe(125_000);
    expect(textoFrequencia(f.resumo_compras.frequencia_media_dias)).toBe(e.frequencia_texto); // 259 ÷ 4 = 64,75 → 65
    expect(e.frequencia_texto).toBe('a cada 65 dias');
    expect(f.resumo_compras.dias_sem_compra).toBe(10);
  });

  it('virada de mês no fuso do tenant: 01/12 03h30 UTC ainda é 30/11 em Manaus (janela dez/2025–nov/2026); 04h30 UTC já é 01/12 (dez/2025 sai)', () => {
    const hist = [...HIST(), mes('2025-12', 100_000, 1, '2025-12-15')];
    const antes = dataLocal(new Date('2026-12-01T03:30:00Z'), FUSO);
    const depois = dataLocal(new Date('2026-12-01T04:30:00Z'), FUSO);
    expect([antes, depois]).toEqual(['2026-11-30', '2026-12-01']);
    // 30/11: dez/2025 ainda na janela (5 pedidos, R$ 6.000); 01/12: dez/2025 sai (4 pedidos, R$ 5.000)
    const fa = ficha(hist, antes);
    const fd = ficha(hist, depois);
    expect(fa.resumo_compras.total_12m_cents).toBe(esperado(hist, antes).total_12m_cents);
    expect(fa.resumo_compras.total_12m_cents).toBe(600_000);
    expect(fa.resumo_compras.ticket_medio_cents).toBe(120_000);
    expect(textoFrequencia(fa.resumo_compras.frequencia_media_dias)).toBe(esperado(hist, antes).frequencia_texto);
    expect(fd.resumo_compras.total_12m_cents).toBe(500_000);
    expect(fd.resumo_compras.ticket_medio_cents).toBe(125_000);
    expect(textoFrequencia(fd.resumo_compras.frequencia_media_dias)).toBe(esperado(hist, depois).frequencia_texto);
  });

  it('cliente sem compra: o resumo vem vazio (total 0, frequência e última compra nulas)', () => {
    const f = ficha([], '2026-11-10');
    expect(f.resumo_compras).toMatchObject({ ticket_medio_cents: 0, frequencia_media_dias: null, ultima_compra_em: null, dias_sem_compra: null, total_12m_cents: 0 });
  });

  it('RN-CORE-40 (D-1 corrigido): sem compra na janela, o topo mostra "Sem compras em 12 meses" no lugar dos 4 indicadores, sem zeros', () => {
    const topo = ler('modules/core/app/telas/cliente.tsx') + ler('modules/core/app/components/cliente360.tsx');
    expect(topo).toContain('Sem compras em 12 meses');
  });

  it('promotor sem ver pedidos (RN-PRO-01): nada de compra chega à ficha; o topo esconde média e última compra', () => {
    const f = ficha(HIST(), '2026-11-10', false);
    expect(f.historico).toEqual([]);
    expect(f.resumo_compras.total_12m_cents).toBe(0);
    const tela = ler('modules/core/app/telas/cliente.tsx');
    expect(tela).toMatch(/\{locais\.verPedidos \? <Stat label="Compra média\/mês"/);
    expect(tela).toMatch(/\{locais\.verPedidos \? \(\s*<Stat\s+label="Última compra"/);
  });

  it('RN-CORE-40 (D-1 corrigido): Compra média/mês (topo do Campo) = total da janela ÷ 12; R$ 5.000 ÷ 12 = R$ 416,67', () => {
    const hoje = '2026-11-10';
    expect(esperado(HIST(), hoje).media_mes_cents).toBe(41_667);
    // antes da correção: resumoDoCliente dividia pelos meses com linha (R$ 5.000 ÷ 3 = R$ 1.666,67)
    expect(resumoDoCliente(CLIENTE, null, [], HIST(), hoje).avg_monthly_cents).toBe(esperado(HIST(), hoje).media_mes_cents);
  });
});

describe('T-0146 — o 13º mês que o sync traz (janela do aparelho ≥ hoje − 12 meses, conta do topo em 12 meses)', () => {
  // hoje 10/11/2026: o sync guarda 2025-11 (janela do pull ≥ hoje − 12 meses); a ficha e a conta usam só 2025-12..2026-11 (D-1 corrigido)
  const hoje = '2026-11-10';
  const hist = () => [mes('2025-11', 1_000_000, 1, '2025-11-20'), mes('2026-11', 100_000, 1, '2026-11-05')];

  it('RN-CORE-40: a lista "Compras dos últimos 12 meses" (app) / "Histórico de compras (12 meses)" (BKO) soma o mesmo que o cartão "Compras em 12 meses"', () => {
    const f = ficha(hist(), hoje);
    // antes da correção: a lista trazia nov/2025 e nov/2026 (R$ 11.000) e o cartão mostrava R$ 1.000
    expect(f.historico.map((h) => h.ano_mes)).toEqual(['2026-11']);
    expect(f.historico.reduce((s, h) => s + h.valor_cents, 0)).toBe(f.resumo_compras.total_12m_cents);
  });

  it('RN-CORE-40: "Compra média/mês" (topo do Campo) nunca é maior que "Compras em 12 meses" no mesmo topo', () => {
    const r = resumoDoCliente(CLIENTE, null, [], hist(), hoje);
    // antes da correção: (R$ 10.000 + R$ 1.000) ÷ 2 linhas = R$ 5.500/mês, com R$ 1.000 em 12 meses ao lado
    expect(r.avg_monthly_cents).toBeLessThanOrEqual(ficha(hist(), hoje).resumo_compras.total_12m_cents);
  });

  it('RN-CORE-40: a única compra no 13º mês fica fora da lista E dos indicadores (a ficha diz "Sem compras em 12 meses"; antes a lista mostrava a compra ao lado de "Nunca comprou")', () => {
    const so13 = [mes('2025-11', 1_000_000, 1, '2025-11-20')];
    const f = ficha(so13, hoje);
    expect(f.historico).toEqual([]);
    expect(f.resumo_compras).toMatchObject({ ultima_compra_em: null, total_12m_cents: 0 });
    expect(resumoDoCliente(CLIENTE, null, [], so13, hoje)).toMatchObject({ avg_monthly_cents: 0, last_purchase_at: null, days_since_purchase: null });
  });
});

describe('T-0146 — rótulo × valor e topo sem limite/vencidos (fonte das telas)', () => {
  const tela = ler('modules/core/app/telas/cliente.tsx');
  const c360 = ler('modules/core/app/components/cliente360.tsx');
  const web = ler('modules/core/web/components/cliente360/cliente360-page.tsx');

  it('Campo/Gestão: cada rótulo do topo mostra o campo da regra', () => {
    expect(tela).toContain('<Stat label="Compra média/mês" value={formatBRL0(customer.avg_monthly_cents)} />');
    expect(c360).toContain('<Stat label="Ticket médio" value={formatBRL0(compras.ticket_medio_cents)} />');
    expect(c360).toContain("<Stat label=\"Frequência média\" value={compras.frequencia_media_dias === null ? '—' : `a cada ${Math.round(compras.frequencia_media_dias)} dias`} />");
    expect(c360).toContain('<Stat label="Compras em 12 meses" value={formatBRL0(compras.total_12m_cents)} />');
    // Última compra do topo vem da mesma janela da ficha (resumo_compras), não do resumo da rota
    expect(tela).toContain('const diasUltimaCompra = ficha ? ficha.resumo_compras.dias_sem_compra : customer.days_since_purchase;');
  });

  it('Campo/Gestão: a grade do topo não tem limite, crédito nem vencidos; o Financeiro tem cada um uma vez', () => {
    const topo = c360.slice(c360.indexOf('testID="cliente-360"'), c360.indexOf('<SectionHeader title="Contatos" />'));
    expect(topo).not.toMatch(/Limite|Crédito|Vencidos|vencidos/);
    expect(tela).not.toMatch(/available_credit_cents|overdue_count|overdue_cents/);
    const financeiro = c360.slice(c360.indexOf('testID="cliente-financeiro"'));
    for (const r of ['Limite', 'Crédito disponível', 'Vencidos']) expect(financeiro.match(new RegExp(`label="${r}"`, 'g'))).toHaveLength(1);
  });

  it('BKO: o topo (primeiro KpiGrid) só tem Última compra, Ticket médio (com a frequência) e Compras em 12 meses; Financeiro no painel', () => {
    const topo = web.slice(web.indexOf('<KpiGrid>'), web.indexOf('</KpiGrid>'));
    expect([...topo.matchAll(/label="([^"]+)"/g)].map((m) => m[1])).toEqual(['Última compra', 'Ticket médio', 'Compras em 12 meses']);
    expect(topo).toContain('value={formatBRL(compras.ticket_medio_cents)}');
    expect(topo).toContain('compra a cada ~${Math.round(compras.frequencia_media_dias)} dias');
    expect(topo).toContain('value={formatBRL(compras.total_12m_cents)}');
    const painel = web.slice(web.indexOf('<Panel title="Financeiro">'), web.indexOf('<Panel title="Contatos">'));
    expect(painel).toContain('value={formatBRL(fin.credito_disponivel_cents)}');
    expect(painel).toContain('value={formatBRL(fin.limite_cents)}');
  });
});

describe('T-0146 — RD-0075: o selo "Cadastro incompleto" saiu da ficha, a informação ficou uma vez (RN-CORE-17)', () => {
  // Oráculo do texto da RN-CORE-17: linha automática no topo das Observações, texto do ERP intacto abaixo; etiqueta só na carteira.
  const LINHA = 'Cadastro incompleto: falta CNPJ/CPF, CEP. Pedido só como orçamento até o cadastro ser completado no ERP.';

  it('ficha (Campo/Gestão e BKO): sem o selo, com a linha automática das Observações montada de cadastro_campos_faltantes', () => {
    for (const p of ['modules/core/app/components/cliente360.tsx', 'modules/core/web/components/cliente360/cliente360-page.tsx']) {
      const src = ler(p);
      expect(src, p).not.toContain('EtiquetaCadastroIncompleto');
      expect(src.match(/automatica=\{observacaoComCadastro\(null, (ficha\.)?cliente\.cadastro_campos_faltantes \?\? \[\]\)\}/g), p).toHaveLength(1);
    }
  });

  it('valor × regra: a linha que a ficha mostra é a da RN-CORE-17 e some com o cadastro completo', async () => {
    const { observacaoComCadastro } = await import('../../modules/core/domain');
    expect(observacaoComCadastro(null, ['documento', 'cep'])).toBe(LINHA);
    expect(observacaoComCadastro(null, [])).toBeNull();
  });

  it('carteira (app e BKO) mantém a etiqueta "Cadastro incompleto" (RN-CORE-17, fora da ficha)', () => {
    expect(ler('modules/core/app/telas/clientes.tsx')).toContain('EtiquetaCadastroIncompleto');
    expect(ler('modules/core/web/components/carteira/carteira-page.tsx')).toContain('EtiquetaCadastroIncompleto');
  });
});
