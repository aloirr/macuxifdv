/**
 * T-0149 (RN-CORE-39, RN-VEN-20) + T-0159 (cabeçalho com a filial de faturamento) — sem banco (local e CI):
 *   FB-1 filtro "Filial" da lista de Pedidos do BKO: URL → query da API → contrato `OrderListQuery` → SQL (`p.filial_id = $16`);
 *   FB-2 a linha do banco do pedido da Boa Vista vira `branch_id`/`branch_name` na lista (as opções do filtro vêm daí);
 *   FB-3 cadeia da filial de faturamento: Core (`Filial` com CNPJ/endereço/telefone) → retrato gravado no recebimento →
 *        detalhe da API (`paraDetalhe` → `OrderDetail`) → `pdfDoPedido` → cabeçalho do PDF do cliente; a marca do item idem;
 *   FB-4 RN-VEN-20: disponível = saldo da filial do pedido − reservas da mesma filial (oráculo com os números da seed da demo).
 * O filtro com banco (só os pedidos da filial) e o seed com as 2 filiais rodam no CI (tests/integracao/demo/filial-demo-t0149.test.ts).
 * Convenção: `it` = vale hoje; `it.fails` = defeito/lacuna aberta com recado ao dono (o agente testes volta para `it` na correção).
 * Matriz: docs/testes/T-0149-T-0147.md (seção "Filtro Filial e reserva").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { depositosDaFilial, saldoPorProdutoDaFilial } from '@macuxi/catalogo/contracts';
import { FilialSchema } from '@macuxi/core/contracts';
import { OrderDetail, OrderListQuery } from '@macuxi/vendedor/contracts';
import { describe, expect, it } from 'vitest';

import { paraDetalhe, paraOrder, type LinhaItem, type LinhaPedido } from '../../modules/vendedor/api/mapeamento';
import { retratoFilialDoPedido } from '../../modules/vendedor/domain/filial-pedido';
import { disponivel } from '../../modules/vendedor/domain/reserva-filial';
import { buildOrderPdfHtml, pdfDoPedido } from '../../modules/vendedor/domain/pdf-pedido';
import { FILTROS_VAZIOS, lerFiltros, paraBusca, paraQuery } from '../../modules/vendedor/web/lib/filtros-url';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

/**
 * Lê a consulta da lista de pedidos (a que termina em `limit $9`) e devolve a coluna comparada com o $16 e o 16º parâmetro.
 * Aceita o SQL e os parâmetros escritos na chamada ou em constantes (`${filtro}`, `valores`): confere a regra, não a forma.
 */
function filtroDeFilialDaLista(fonte: string): { coluna: string | null; param: string | null } {
  const m = /db\.query<LinhaPedido>\(\s*`((?:(?!db\.query)[\s\S])*?order by p\.created_at desc, p\.id desc\s+limit \$9)`,\s*(\[|[A-Za-z_$][\w$]*)/.exec(fonte);
  if (!m) return { coluna: null, param: null };
  const constante = (nome: string, abre: string) => {
    const ini = new RegExp(`const ${nome.replace(/\$/g, '\\$')} = \\${abre}`).exec(fonte);
    return ini ? fonte.slice(ini.index + ini[0].length - 1) : null;
  };
  const sql = m[1]!.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (todo, nome: string) => {
    const corpo = constante(nome, '`');
    return corpo ? corpo.slice(1, corpo.indexOf('`', 1)) : todo;
  });
  const usos = [...sql.matchAll(/([\w.]+) = \$16\b/g)].map((u) => u[1]!);
  const coluna = usos.length === 1 && /\(\$16::uuid is null or [\w.]+ = \$16\)/.test(sql) ? usos[0]! : null;
  const ini = m[2] === '[' ? fonte.slice(m.index + m[0].length - 1) : constante(m[2]!, '[');
  if (!ini) return { coluna, param: null };
  let nivel = 0;
  let fim = 0;
  for (let i = 0; i < ini.length; i++) {
    if ('[('.includes(ini[i]!)) nivel++;
    else if ('])'.includes(ini[i]!) && --nivel === 0) {
      fim = i;
      break;
    }
  }
  const lista = ini.slice(1, fim).split(/,\s*(?![^(]*\))/).map((x) => x.trim());
  return { coluna, param: lista[15] ?? null };
}

const F_MAO = 'a1000000-0000-4000-8000-000000000001';
const F_BVB = 'a1000000-0000-4000-8000-000000000002';
const FILIAL_BV = FilialSchema.parse({
  id: F_BVB.toUpperCase(), // o Core pode devolver em maiúsculas; o retrato normaliza
  codigo: '0002',
  nome: 'Filial Boa Vista',
  cidade: 'Boa Vista',
  uf: 'RR',
  padrao: false,
  ativo: true,
  external_id: 'FIL-BVB',
  cnpj: '12345678000276',
  logradouro: 'Rua Cecília Brasil',
  numero: '450',
  complemento: null,
  bairro: 'Centro',
  cep: '69301380',
  telefone: '9532241000',
});

describe('T-0149 FB-1 — filtro "Filial" da lista de Pedidos do BKO', () => {
  it('FB-1: a filial vai da URL para a query da API e volta igual (link compartilhado); vazio = todas', () => {
    const f = lerFiltros(`?branch_id=${F_BVB}&status=approved`);
    expect(f.branch_id).toBe(F_BVB);
    expect(paraQuery(f)).toEqual({ status: 'approved', branch_id: F_BVB });
    expect(lerFiltros(paraBusca(f))).toEqual(f);
    expect(paraQuery(FILTROS_VAZIOS)).toEqual({});
  });

  it('FB-1: filial inválida na URL (link velho ou digitado) é ignorada, nunca vai à API', () => {
    for (const lixo of ['0002', 'boa-vista', `${F_BVB}x`, "'; drop table x; --"]) expect(lerFiltros(`?branch_id=${encodeURIComponent(lixo)}`).branch_id).toBe('');
  });

  it('FB-1: o contrato da lista aceita branch_id (UUID) e a API filtra pela filial GRAVADA no pedido (p.filial_id), não pela do vendedor', () => {
    expect(OrderListQuery.parse({ branch_id: F_BVB }).branch_id).toBe(F_BVB);
    const api = ler('modules/vendedor/api/pedidos.ts');
    // confere a REGRA (o filtro da lista usa a filial do pedido), aceitando SQL e parâmetros inline ou em constante (RD-0441)
    expect(filtroDeFilialDaLista(api)).toEqual({ coluna: 'p.filial_id', param: 'q.branch_id ?? null' });
    // UUID inválido na query = lista vazia (não 500 nem "todas")
    expect(api).toMatch(/q\.branch_id && !UUID\.test\(q\.branch_id\)\)[^\n]*return \{ itens: \[\], proximo_cursor: null \}/);
  });

  it('FB-1: a leitura do filtro recusa filtro por outra coluna (filial do vendedor ou do cliente), sem filtro e parâmetro trocado', () => {
    const consulta = (sql: string, params: string) =>
      `const { rows } = await db.query<LinhaPedido>(\n  \`select x from vendedor.pedido p\n    where p.deleted_at is null\n      ${sql}\n    order by p.created_at desc, p.id desc\n    limit $9\`,\n  ${params},\n);`;
    const p16 = (v: string) => `[${Array.from({ length: 15 }, (_, i) => `a${i}`).join(', ')}, ${v}]`;
    // as duas formas certas: inline (main até o #298) e em constantes (a7f25a42)
    expect(filtroDeFilialDaLista(consulta('and ($16::uuid is null or p.filial_id = $16)', p16('q.branch_id ?? null')))).toEqual({ coluna: 'p.filial_id', param: 'q.branch_id ?? null' });
    const emConstantes = `const valores = ${p16('q.branch_id ?? null')};\nconst filtro = \`and ($16::uuid is null or p.filial_id = $16)\`;\n${consulta('${filtro}', 'valores')}`;
    expect(filtroDeFilialDaLista(emConstantes)).toEqual({ coluna: 'p.filial_id', param: 'q.branch_id ?? null' });
    // as erradas
    expect(filtroDeFilialDaLista(consulta('and ($16::uuid is null or v.filial_id = $16)', p16('q.branch_id ?? null'))).coluna).toBe('v.filial_id');
    expect(filtroDeFilialDaLista(consulta('and ($16::uuid is null or p.cliente_filial_id = $16)', p16('q.branch_id ?? null'))).coluna).toBe('p.cliente_filial_id');
    expect(filtroDeFilialDaLista(consulta('and ($5::uuid is null or p.cliente_id = $5)', p16('q.branch_id ?? null'))).coluna).toBeNull();
    expect(filtroDeFilialDaLista(consulta('and ($16::uuid is null or p.filial_id = $16)', p16('q.seller_id ?? null'))).param).toBe('q.seller_id ?? null');
    // filtro certo só numa constante que a lista não usa = sem filtro
    const constanteSolta = `const filtro = \`and ($16::uuid is null or p.filial_id = $16)\`;\n${consulta('', p16('q.branch_id ?? null'))}`;
    expect(filtroDeFilialDaLista(constanteSolta).coluna).toBeNull();
  });

  it('FB-1: a tela tem o seletor "Filial" com "Todas" e o "Limpar filtros" zera a filial', () => {
    const tela = ler('modules/vendedor/web/components/orders/orders-page.tsx');
    expect(tela).toMatch(/<SelectField label="Filial" value=\{filtros\.branch_id\}.*data-testid="pedidos\.filtro-filial">\s*<option value="">Todas<\/option>/);
    expect(tela).toMatch(/mudar\(\{[^}]*branch_id: ''[^}]*\}\)[^\n]*pedidos\.limpar-filtros/);
  });
});

// ---------- linha do banco do pedido da Boa Vista (o que o recebimento grava) ----------
const agora = '2026-11-10T14:00:00.000Z';
const retrato = retratoFilialDoPedido(FILIAL_BV);
function linhaPedido(over: Partial<LinhaPedido> = {}): LinhaPedido {
  return {
    id: 'b1000000-0000-4000-8000-000000000001',
    numero: '000014',
    vendedor_id: 'b2000000-0000-4000-8000-000000000001',
    vendedor_nome: 'Lucas Fictício',
    cliente_id: 'b3000000-0000-4000-8000-000000000001',
    cliente_nome: 'Padaria Trigo Fino',
    cliente_resumo: null,
    tabela_preco_id: null,
    condicao_pagamento: '28 dias',
    condicao_pagamento_descricao: '28 dias',
    status: 'approved',
    desconto_pct: 0,
    total_tabela_cents: 5_180,
    total_cents: 5_180,
    nivel_aprovacao: null,
    motivos_aprovacao: null,
    motivo_rejeicao: null,
    numero_erp: null,
    criado_no_aparelho_em: agora,
    recebido_em: agora,
    created_at: agora,
    updated_at: agora,
    itens: 1,
    unidades: 2,
    filial_id: retrato.filial_id,
    filial: retrato.filial as unknown as Record<string, unknown>,
    ...over,
  };
}
const ITEM: LinhaItem = { id: 'b4000000-0000-4000-8000-000000000001', produto_id: 'b5000000-0000-4000-8000-000000000001', produto_sku: 'CAF-500', produto_nome: 'Café 500 g', quantidade: 2, preco_tabela_cents: 2_590, desconto_pct: 0, total_cents: 5_180, unidade: 'UN', fator: 1, marca: 'Serra Alta' };

describe('T-0149 FB-2 — a lista do BKO mostra a filial gravada (as opções do filtro)', () => {
  it('FB-2: pedido da Boa Vista → branch_id em minúsculas e branch_name "0002 · Filial Boa Vista/RR"; pedido anterior à filial → nulos', () => {
    const o = paraOrder(linhaPedido(), {});
    expect([o.branch_id, o.branch_name]).toEqual([F_BVB, '0002 · Filial Boa Vista/RR']);
    const antigo = paraOrder(linhaPedido({ filial_id: null, filial: null }), {});
    expect([antigo.branch_id, antigo.branch_name ?? null]).toEqual([null, null]);
  });
});

describe('T-0149/T-0159 FB-3 — filial de faturamento e marca do Core até o PDF', () => {
  it('FB-3: o retrato gravado leva CNPJ, endereço e telefone da filial (a data do pedido manda, não o cadastro de depois)', () => {
    expect(retrato.filial).toMatchObject({ id: F_BVB, codigo: '0002', cnpj: '12345678000276', logradouro: 'Rua Cecília Brasil', numero: '450', bairro: 'Centro', telefone: '9532241000' });
  });

  const ctxPdf = { tenant_name: 'Distribuidora Exemplo Norte', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: agora };
  const pdfsDaApi = () => {
    const det = OrderDetail.parse(paraDetalhe(linhaPedido(), [ITEM], [], 'analista', {}));
    return (['customer', 'bko'] as const).map((v) => buildOrderPdfHtml(pdfDoPedido(det), v, ctxPdf));
  };
  const emit = (h: string) => [...h.matchAll(/class="emit">([\s\S]*?)<\/div>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, '').trim());

  it('FB-3: detalhe da API (OrderDetail) → cabeçalho das 2 versões com CNPJ, telefone e endereço com CEP da Boa Vista; sem a célula "Filial"; marca do item', () => {
    for (const h of pdfsDaApi()) {
      const [l1, l2] = emit(h);
      expect(l1).toContain('CNPJ 12.345.678/0002-76 · (95) 3224-1000');
      expect(l2).toBe('Rua Cecília Brasil, 450 · Centro · Boa Vista/RR · CEP 69301-380');
      expect(h).not.toMatch(/>\s*Filial\s*</);
      expect(h).toMatch(/<td[^>]*>Serra Alta<\/td>/);
    }
  });

  // D-T0159-3 corrigido (era it.fails; o vendedor passou o `branch_name` ao cabeçalho): pelo caminho real o nome da filial chega à
  // linha 1 e aparece uma vez só. O formato exato do nome ("Filial Boa Vista", sem "0002 ·" nem "/RR") é o D-T0159-5, no PDF-4.
  it('FB-3 D-T0159-3 corrigido: pelo caminho real (API) a linha 1 do cabeçalho traz o nome da filial, uma vez só no HTML', () => {
    for (const h of pdfsDaApi()) {
      expect(emit(h)[0]).toMatch(/^.*Filial Boa Vista.* · CNPJ 12\.345\.678\/0002-76 · \(95\) 3224-1000$/);
      expect(h.match(/Filial Boa Vista/g)).toHaveLength(1);
    }
  });

  // D-T0159-5 de ponta (v1.0.4; decisão do designer-ux R-20261111-062125): pelo caminho real (retrato gravado → paraDetalhe → OrderDetail →
  // pdfDoPedido) a linha 1 é exatamente o nome do retrato, sem o código "0002" nem "/RR"; o rótulo da lista do BKO continua no branch_name.
  it('FB-3 D-T0159-5: pelo caminho real a linha 1 é "Filial Boa Vista · CNPJ … · (95) 3224-1000" e o branch_name da lista não muda', () => {
    for (const h of pdfsDaApi()) expect(emit(h)[0]).toBe('Filial Boa Vista · CNPJ 12.345.678/0002-76 · (95) 3224-1000');
    const det = OrderDetail.parse(paraDetalhe(linhaPedido(), [ITEM], [], 'analista', {}));
    expect(det.branch_name).toBe('0002 · Filial Boa Vista/RR');
  });

  it('FB-3: pedido anterior à filial (sem retrato) → o PDF do cliente sai sem a linha, nada da matriz inventado', () => {
    const det = OrderDetail.parse(paraDetalhe(linhaPedido({ filial_id: null, filial: null }), [{ ...ITEM, marca: null }], [], 'analista', {}));
    const cliente = buildOrderPdfHtml(pdfDoPedido(det), 'customer', { tenant_name: 'X', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: agora });
    expect(cliente).not.toContain('class="emit"');
    expect(cliente).not.toContain('CNPJ 12.');
  });
});

describe('T-0149 FB-4 — RN-VEN-20: disponível por filial', () => {
  // seed da demo (R-20261110-202456-banco-dados): CD-BVB = floor(CD-MAO × 0,6); CAF-500 zerado na Boa Vista
  // RD-0127 (R-20261111-081128-modulo-vendedor): a regra única de saldo é a do Catálogo (`depositosDaFilial` + `saldoPorProdutoDaFilial`,
  // @macuxi/catalogo/contracts); o Vendedor só desconta a reserva (`disponivel`).
  const CD_MAO = 37;
  const P = 'b1000000-0000-4000-8000-000000000001';
  const D_MAO = 'd-mao';
  const D_LOJA = 'd-loja'; // Loja Centro (2º depósito da Manaus)
  const D_BVB = 'd-bvb';
  const depositos = [
    { id: D_MAO, filial_id: F_MAO },
    { id: D_LOJA, filial_id: F_MAO },
    { id: D_BVB, filial_id: F_BVB },
  ];
  const saldos = [
    { deposito_id: D_MAO, produto_id: P, quantidade: CD_MAO },
    { deposito_id: D_LOJA, produto_id: P, quantidade: 5 },
    { deposito_id: D_BVB, produto_id: P, quantidade: Math.floor(CD_MAO * 0.6) },
  ];
  const saldoNaFilial = (s: typeof saldos, filial: string) => saldoPorProdutoDaFilial([P], depositosDaFilial(depositos, filial), s)[0]?.quantidade_base;

  it('FB-4: Manaus soma os depósitos da filial (37 + 5); Boa Vista = floor(37 × 0,6) = 22; reserva de uma filial não mexe na outra', () => {
    expect(saldoNaFilial(saldos, F_MAO)).toBe(42);
    expect(saldoNaFilial(saldos, F_BVB)).toBe(22);
    expect(disponivel(saldoNaFilial(saldos, F_MAO)!, 10)).toBe(42 - 10);
    expect(disponivel(saldoNaFilial(saldos, F_BVB)!, 4)).toBe(22 - 4);
  });

  it('FB-4: sem saldo na filial (só na Manaus) = 0, nunca o saldo da Manaus; reserva acima do saldo = 0, nunca negativo', () => {
    expect(saldoNaFilial([{ deposito_id: D_MAO, produto_id: P, quantidade: 30 }], F_BVB)).toBe(0);
    expect(disponivel(saldoNaFilial(saldos, F_BVB)!, 99)).toBe(0);
  });

  // D-T0149-R1 corrigido (v1.0.4; era it.fails): a reserva por filial ficou ligada — a API confere no recebimento
  // (`faltaDeEstoqueNaFilial` com `catalogo.estoque_filial@1`) e o app desconta os pedidos aceitos da mesma filial
  // (`disponivelPorProduto` → `reservadoLocalNaFilial`). Os números ponta a ponta estão em reserva-filial-api-t0149.test.ts (RS-1..RS-6).
  it('FB-4 D-T0149-R1 corrigido: a reserva por filial está ligada na API (recebimento) e no app (pull do Vendedor)', () => {
    expect(ler('modules/vendedor/api/receber.ts')).toMatch(/faltaDeEstoqueNaFilial\(db, provedorSaldoDaFilial\(tx\)/);
    expect(ler('modules/vendedor/app/lib/pull.ts')).toMatch(/export function disponivelPorProduto\([\s\S]*?reservadoLocalNaFilial\(/);
  });
});

describe('T-0149/T-0159 FB-5 — aviso de filial incompleta no BKO (rótulo × valor)', () => {
  // D-T0149-A1 (encaminhado pelo corretor, R-20261111-003121; recado ao modulo-core): a API marca `incompleta` em QUALQUER filial sem
  // cidade/UF/CNPJ/endereço (modules/core/api/filiais.ts), mas a tela diz "Complete a filial padrão" para a primeira incompleta que achar
  // (filiais-page.tsx). Com a Boa Vista sem CNPJ e a Manaus completa, o BKO manda completar a padrão — que já está completa.
  it.fails('FB-5 D-T0149-A1: o aviso só fala da "filial padrão" quando a incompleta é a padrão (ou nomeia a filial incompleta)', () => {
    const api = ler('modules/core/api/filiais.ts');
    expect(api).toMatch(/incompleta: !l\.cidade \|\| !l\.uf \|\| !l\.cnpj/); // qualquer filial pode ficar incompleta
    const tela = ler('modules/core/web/components/filiais/filiais-page.tsx');
    const dizPadrao = /Complete a filial padrão/.test(tela);
    const procuraSoAPadrao = /itens\.find\(\(f\) => f\.incompleta && f\.padrao\)/.test(tela);
    expect(!dizPadrao || procuraSoAPadrao).toBe(true);
  });
});
