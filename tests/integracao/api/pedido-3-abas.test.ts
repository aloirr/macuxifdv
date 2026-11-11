/**
 * T-0061 (PR #72) — roteiro de 5 passos do novo pedido em 3 abas pela API REAL (createApp × Postgres × fixture
 * dois-tenants), na ordem que o dono do produto vai testar:
 *   1) novo pedido com item em CX (RN-VEN-15: CX = UN × fator; quantidade base no banco e no aprovado@1); 1b) 2 CX na
 *      faixa da tabela escalonada da fixture (RN-VEN-23: preço da faixa por UN × fator);
 *   2) 30% no item e 5% no pedido (RN-VEN-02/03/10: alçada pelo desconto EFETIVO, sem frete);
 *   3) FOB com transportadora digitada (RN-VEN-16: nome + CNPJ válido; fica só no pedido e aparece para o BKO cadastrar);
 *   4) escolher o endereço de entrega e enviar (RN-VEN-17; endereço de outro cliente é recusado);
 *   5) abrir no BKO e gerar o PDF (OrderDetail + gerador puro do PDF: medida, frete, transportadora, endereço).
 * Mais: reenvio idempotente (RN-VEN-33), promotor nunca cria pedido (regra 7, RN-PRO-01) e o tenant B não vê o pedido.
 *
 * Diferente de modules/vendedor/api/novo-pedido.db.test.ts (consultas do Core e do Catálogo SIMULADAS), aqui as unidades
 * vêm de core.produto_unidade, os endereços de core.cliente_endereco e o preço do catalogo.precos_cliente@1 reais.
 * Fixture: ALFA-001 (100.000 cents; UN fator 1 padrão e CX fator 10), c1 com endereço principal "Rua Um" e de entrega
 * "Av. do Depósito". Para o caso exato "30% no item → 5% efetivo" o teste grava um preço vigente para ALFA-002 (50.000).
 *
 * O #72/#75 está no main (45d8447): o roteiro roda sempre que houver Postgres (pula só sem banco; com MACUXI_PG_EXIGIR=1, erro).
 * Só no aparelho (roteiro manual, docs/testes/T-0061.md): as 3 abas e o rodapé fixo, toque de 48 dp, UN/CX em 2 toques,
 * offline (avião) → reconexão, o PDF renderizado/compartilhado (expo-print) e a gaveta do BKO no navegador.
 */
import { formatarDocumento, formatBRL } from '@macuxi/comum';
import { semBanco } from '@macuxi/db/teste/estado';
import type { ResultadoItemPush } from '@macuxi/platform-sdk';
import { OrderDetail } from '@macuxi/vendedor/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildOrderPdfHtml, pdfDoPedido } from '../../../modules/vendedor/app/lib/order-pdf';
import { A, B, subirApi, type ApiDeTeste } from '../apoio/api';
import { garantirSaldoNaFilial, SALDO_REFERENCIA } from '../apoio/demo';


const id = (n: number) => `0f610000-0000-4000-8000-a${String(n).padStart(11, '0')}`;
const PED = { lixo1: id(90), lixo2: id(91), cx: id(1), efetivo5: id(2), item30pedido5: id(3), fobDigitada: id(4), fobRuim: id(5), endereco: id(6), enderecoRuim: id(7), promotor: id(8), cxFaixa: id(9) };
const CNPJ_DIGITADA = '55566677000183';
const CNPJ_RUIM = '55566677000184';
const NOME_DIGITADA = 'T0061 Fluvial Teste';

/** Campos novos do #72 no detalhe (lidos soltos para compilar também antes do merge). */
interface DetalheNovo {
  number: string | null;
  total_cents: number;
  effective_discount_pct?: number | null;
  freight?: { modality: string; carrier_name: string | null; carrier_document: string | null; carrier_typed: boolean } | null;
  delivery_address?: { logradouro: string; cidade: string; principal?: boolean } | null;
  items: Array<Record<string, unknown>>;
}

describe.skipIf(semBanco())('T-0061 — roteiro de 5 passos do novo pedido em 3 abas (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  const tk = { vendedor: '', gerente: '', promotor: '', b: '' };
  let prod1 = '';
  let prod2 = '';
  let endEntrega = '';
  let endDeOutro = '';
  let precoProd2Id: string | null = null;
  let alcadaVendedor = 0;

  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []): Promise<T[]> => (await api.admin.query(sql, p)).rows as T[];
  const pedido = (pid: string, payload: Record<string, unknown>) => ({
    entidade: 'pedido',
    id: pid,
    operacao: 'upsert',
    payload: { id: pid, customer_id: A.clientes.c1, discount_pct: 0, ...payload },
  });
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const noBanco = async (pid: string) => {
    const [p] = await q('select * from vendedor.pedido where id = $1', [pid]);
    const it = await q('select * from vendedor.pedido_item where pedido_id = $1 order by sequencia', [pid]);
    return { p: p as Record<string, unknown> | undefined, it };
  };
  const eventos = (pid: string) =>
    q<{ nome: string; payload: Record<string, unknown> }>('select nome, payload from plataforma.evento where agregado_id = $1 order by ocorrido_em, created_at', [pid]);
  const detalhe = async (token: string, pid: string) => {
    const r = await api.chamar(token, { method: 'GET', url: `/v1/vendedor/pedidos/${pid}` });
    expect(r.statusCode, r.body).toBe(200);
    OrderDetail.parse(r.json());
    return r.json() as DetalheNovo;
  };

  beforeAll(async () => {
    api = await subirApi();
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.b = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [Object.values(PED)]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [Object.values(PED)]);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [Object.values(PED)]);
    prod1 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    prod2 = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-002'", [A.tenantId]))[0]!.id;
    // RN-VEN-20 (v1.0.4): a fixture tem 15 UN de ALFA-001 no CD1 e o roteiro pede 1 CX, 2 CX e 2 CX (fator 10) com preço e faixa
    // conferidos; o preparo completa o saldo da filial do c1 (a recusa fica ligada; ALFA-002 não tem saldo = sem controle)
    await garantirSaldoNaFilial(api.admin, A.clientes.c1, prod1, SALDO_REFERENCIA);
    endEntrega = (await q<{ id: string }>("select id from core.cliente_endereco where tenant_id = $1 and cliente_id = $2 and not principal and deleted_at is null", [A.tenantId, A.clientes.c1]))[0]!.id;
    endDeOutro = (await q<{ id: string }>('select id from core.cliente_endereco where tenant_id = $1 and cliente_id <> $2 limit 1', [B.tenantId, A.clientes.c1]))[0]?.id ?? '0f610000-0000-4000-8000-0000000000ee';
    // preço vigente de ALFA-002 só para o caso exato de 5% efetivo (o da fixture vence às 04h do dia)
    try {
      precoProd2Id = (
        await q<{ id: string }>(
          "insert into catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, preco_cents, vigencia_inicio, vigencia_fim, external_id) values ($1, $2, $3, 50000, now() - interval '1 minute', null, 'T0061-TESTES') returning id",
          [A.tenantId, A.tabelasPreco.padrao, prod2],
        )
      )[0]!.id;
    } catch {
      precoProd2Id = null; // vigência sobreposta recusada pelo banco: o caso 2a fica sem o preço e avisa
    }
    const al = await api.chamar(tk.vendedor, { method: 'GET', url: '/v1/vendedor/alcadas' });
    expect(al.statusCode, al.body).toBe(200);
    alcadaVendedor = (al.json() as { seller_pct: number }).seller_pct;
  }, 300_000);

  afterAll(async () => {
    if (!api) return;
    await api.admin.query('delete from vendedor.pedido_evento where pedido_id = any($1::uuid[])', [Object.values(PED)]);
    await api.admin.query('delete from vendedor.pedido_item where pedido_id = any($1::uuid[])', [Object.values(PED)]);
    await api.admin.query('delete from vendedor.pedido where id = any($1::uuid[])', [Object.values(PED)]);
    if (precoProd2Id) await api.admin.query('delete from catalogo.tabela_preco_item where id = $1', [precoProd2Id]);
    await api.fechar();
  });

  it('passo 1 — item em CX (RN-VEN-15): preço = UN × 10, quantidade base 10 no banco e no aprovado@1/pedido; FD/PCT recusados (unidade_invalida)', async () => {
    // 1 CX: abaixo do mínimo da faixa de CX da fixture (2 CX, RN-VEN-23), então vale só a RN-VEN-15 (UN 100.000 × 10)
    const [r] = await push(tk.vendedor, [pedido(PED.cx, { items: [{ product_id: prod1, quantity: 1, unidade: 'CX' }] })]);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
    const { p, it } = await noBanco(PED.cx);
    expect(it[0]).toMatchObject({ unidade: 'CX', fator: 10, quantidade: 1, quantidade_base: 10 });
    expect(Number(it[0]!.preco_tabela_cents)).toBe(1_000_000);
    expect(Number(p!.total_cents)).toBe(1_000_000);
    const [ruim] = await push(tk.vendedor, [pedido(PED.lixo1, { items: [{ product_id: prod1, quantity: 1, unidade: 'PCT' }] })]);
    expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'unidade_invalida' });
    const ev = (await eventos(PED.cx)).map((e) => e.nome);
    expect(ev).toContain('vendedor.pedido.criado@1');
    if (p!.status === 'approved') {
      const ap = (await eventos(PED.cx)).find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { itens: Array<Record<string, unknown>> };
      expect(ap.itens[0]).toMatchObject({ quantidade: 10, unidade: 'CX', fator: 10, quantidade_venda: 1 });
    }
  });

  it('passo 1b — 2 CX atinge a faixa da tabela escalonada (RN-VEN-23 × RN-VEN-15): R$ 900,00 por UN × 10 = 900.000 por CX, quantidade base 20', async () => {
    // fixture (PAGAMENTO_FIXTURE.A.faixas.cx2): ALFA-001, medida CX, mínimo 2, R$ 900,00 por unidade base, só na tabela Padrão
    // Alfa (a do c1). A faixa conta como preço de tabela (não entra na alçada) e a embalagem continua UN × fator
    const [r] = await push(tk.vendedor, [pedido(PED.cxFaixa, { items: [{ product_id: prod1, quantity: 2, unidade: 'CX' }] })]);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
    const { p, it } = await noBanco(PED.cxFaixa);
    expect(it[0]).toMatchObject({ unidade: 'CX', fator: 10, quantidade: 2, quantidade_base: 20 });
    expect(Number(it[0]!.preco_tabela_cents)).toBe(90_000 * 10);
    expect(Number(p!.total_cents)).toBe(1_800_000);
    expect(p!.status, 'preço da faixa com 0% de desconto não sobe de nível de alçada').not.toBe('rejected');
    if (p!.status === 'approved') {
      const ap = (await eventos(PED.cxFaixa)).find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as { itens: Array<Record<string, unknown>> };
      expect(ap.itens[0]).toMatchObject({ quantidade: 20, unidade: 'CX', fator: 10, quantidade_venda: 2 });
    }
  });

  it('passo 2a — 30% no item que dá 5% efetivo no pedido: a alçada olha o efetivo (RN-VEN-03/10), não os 30%', async () => {
    expect(precoProd2Id, 'sem preço vigente para ALFA-002 (vigência sobreposta): caso exato indisponível nesta fixture').not.toBeNull();
    // 1 × 100.000 com 30% = 70.000 ; 10 × 50.000 = 500.000 → tabela 600.000, final 570.000 → 5% efetivo
    const [r] = await push(tk.vendedor, [pedido(PED.efetivo5, { items: [{ product_id: prod1, quantity: 1, desconto_pct: 30 }, { product_id: prod2, quantity: 10 }] })]);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
    const { p, it } = await noBanco(PED.efetivo5);
    expect(Number(p!.total_cents)).toBe(570_000);
    expect(Number(p!.desconto_efetivo_pct)).toBe(5);
    expect(Number(it[0]!.desconto_pct)).toBe(30);
    expect(p!.status).toBe(5 <= alcadaVendedor ? 'approved' : 'pending_approval');
  });

  it('passo 2b — 30% no item E 5% no pedido: efetivo = 1 − 0,7 × 0,95 sobre o item; total e status coerentes com a alçada', async () => {
    const [r] = await push(tk.vendedor, [pedido(PED.item30pedido5, { discount_pct: 5, items: [{ product_id: prod1, quantity: 1, desconto_pct: 30 }] })]);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
    const { p } = await noBanco(PED.item30pedido5);
    expect(Number(p!.total_cents)).toBe(66_500); // 100.000 × 0,70 × 0,95
    expect(Number(p!.desconto_efetivo_pct)).toBeCloseTo(33.5, 2);
    expect(p!.status).toBe(33.5 <= alcadaVendedor ? 'approved' : 'pending_approval');
    if (p!.status === 'pending_approval') expect(p!.nivel_aprovacao).not.toBeNull();
    // desconto e acréscimo juntos: recusado (RN-VEN-02)
    const [junto] = await push(tk.vendedor, [pedido(PED.lixo2, { discount_pct: 5, acrescimo_pct: 5, items: [{ product_id: prod1, quantity: 1 }] })]);
    expect(junto).toMatchObject({ status: 'rejeitado', codigo: 'desconto_e_acrescimo' });
  });

  it('passo 3 — FOB com transportadora digitada (RN-VEN-16): retrato só no pedido, CNPJ inválido recusado, digitada aparece ao BKO', async () => {
    const digitada = { nome: NOME_DIGITADA, cnpj: CNPJ_DIGITADA, telefone: '92 99999-1111' };
    const [ok] = await push(tk.vendedor, [pedido(PED.fobDigitada, { frete: { modalidade: 'FOB', transportadora_digitada: digitada }, items: [{ product_id: prod1, quantity: 1 }] })]);
    expect(ok, JSON.stringify(ok)).toMatchObject({ status: 'aceito' });
    expect((await noBanco(PED.fobDigitada)).p).toMatchObject({ frete_modalidade: 'FOB', transportadora_id: null, transportadora_digitada: true, transportadora_nome: NOME_DIGITADA, transportadora_documento: CNPJ_DIGITADA });
    expect(await q("select 1 from vendedor.transportadora where documento = $1", [CNPJ_DIGITADA])).toHaveLength(0);
    const [ruim] = await push(tk.vendedor, [pedido(PED.fobRuim, { frete: { modalidade: 'FOB', transportadora_digitada: { ...digitada, cnpj: CNPJ_RUIM } }, items: [{ product_id: prod1, quantity: 1 }] })]);
    expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'transportadora_invalida' });
    const fila = await api.chamar(tk.gerente, { method: 'GET', url: '/v1/vendedor/transportadoras/digitadas' });
    expect(fila.statusCode, fila.body).toBe(200);
    expect(fila.body).toContain(CNPJ_DIGITADA);
    // frete não muda total nem efetivo (sem valor de frete)
    expect(Number((await noBanco(PED.fobDigitada)).p!.total_cents)).toBe(100_000);
  });

  it('passo 4 — escolher o endereço de entrega e enviar (RN-VEN-17): retrato gravado; endereço de outro cliente recusado; reenvio idempotente', async () => {
    const item = pedido(PED.endereco, { endereco_entrega_id: endEntrega, frete: { modalidade: 'CIF' }, items: [{ product_id: prod1, quantity: 2, unidade: 'CX', desconto_pct: 2 }] });
    const [r] = await push(tk.vendedor, [item]);
    expect(r, JSON.stringify(r)).toMatchObject({ status: 'aceito' });
    const { p, it } = await noBanco(PED.endereco);
    expect(p).toMatchObject({ endereco_entrega_id: endEntrega, frete_modalidade: 'CIF' });
    expect(p!.endereco_entrega).toMatchObject({ logradouro: 'Av. do Depósito', cidade: 'Manaus', principal: false });
    // RN-VEN-33: o mesmo push de novo não duplica; o mesmo id com outro conteúdo é conflito
    expect((await push(tk.vendedor, [item]))[0]!.status).toBe('aceito');
    expect((await noBanco(PED.endereco)).it).toHaveLength(it.length);
    const [conf] = await push(tk.vendedor, [pedido(PED.endereco, { items: [{ product_id: prod1, quantity: 1 }] })]);
    expect(conf!.status).toBe('conflito');
    const [ruim] = await push(tk.vendedor, [pedido(PED.enderecoRuim, { endereco_entrega_id: endDeOutro, items: [{ product_id: prod1, quantity: 1 }] })]);
    expect(ruim).toMatchObject({ status: 'rejeitado', codigo: 'endereco_invalido' });
    if (p!.status === 'approved') {
      const ap = (await eventos(PED.endereco)).find((e) => e.nome === 'vendedor.pedido.aprovado@1')!.payload as Record<string, unknown>;
      expect(ap.endereco_entrega).toMatchObject({ principal: false });
      expect(ap.frete).toEqual({ modalidade: 'CIF' });
    }
  });

  it('passo 5 — BKO abre o pedido (gerente) e gera o PDF: Emb. "CX" e Qtd (spec T-0159), frete, transportadora e endereço; versão do cliente sem %', async () => {
    const d = await detalhe(tk.gerente, PED.endereco);
    expect(d.items[0]).toMatchObject({ unit: 'CX', factor: 10, quantity: 2, discount_pct: 2 });
    expect(String(d.items[0]!.unit_label)).toContain('CX');
    expect(d.freight).toMatchObject({ modality: 'CIF', carrier_typed: false });
    expect(d.delivery_address).toMatchObject({ logradouro: 'Av. do Depósito', cidade: 'Manaus' });
    const ctx = { tenant_name: 'Distribuidora Alfa', product_name: 'Macuxi FDV', tz: 'America/Manaus', generated_at: new Date().toISOString() };
    const doc = pdfDoPedido(OrderDetail.parse(d));
    const cliente = buildOrderPdfHtml(doc, 'customer', ctx);
    const interno = buildOrderPdfHtml(doc, 'bko', ctx);
    // spec docs/design/pdf-pedido.md §3 (T-0159): "Emb." e "Qtd" separadas; some a coluna "Medida"; Qtd só o número
    expect(cliente).toContain('<th>Emb.</th>');
    expect(cliente).toMatch(/<th[^>]*>Qtd<\/th>/);
    expect(cliente).not.toMatch(/>Medida</);
    expect(cliente).toContain('CX');
    // spec docs/design/pdf-pedido.md (ficha "Entrega"): frete + endereço numa ficha só, sem "Frete:" nem "por conta de"
    expect(cliente).toMatch(/<div class="r">Entrega<\/div>CIF · [^<]*Av\. do Depósito/);
    expect(cliente).not.toContain('Frete:');
    expect(cliente).not.toContain('por conta');
    expect(cliente).toContain('Av. do Depósito');
    expect(cliente).toContain(formatBRL(d.total_cents));
    expect(cliente).not.toContain('%');
    expect(interno).toMatch(/2,0\s*%|2%/);
    // FOB digitada no PDF, ficha "Entrega": "FOB · transportadora (CNPJ ...)" (sem "Frete:" nem "por conta de")
    const fob = buildOrderPdfHtml(pdfDoPedido(OrderDetail.parse(await detalhe(tk.gerente, PED.fobDigitada))), 'customer', ctx);
    expect(fob).toContain(`<div class="r">Entrega</div>FOB · ${NOME_DIGITADA} (CNPJ ${formatarDocumento(CNPJ_DIGITADA)})`);
    expect(fob).not.toContain('Frete:');
    expect(fob).not.toContain('por conta');
  });

  it('regra 7 (RN-PRO-01): o promotor não cria o pedido novo, nem com os campos do #72; nada gravado', async () => {
    const r = await api.chamar(tk.promotor, { method: 'POST', url: '/v1/sync/push', payload: { itens: [pedido(PED.promotor, { frete: { modalidade: 'CIF' }, items: [{ product_id: prod1, quantity: 1, unidade: 'CX' }] })] } });
    if (r.statusCode === 200) expect((r.json() as { resultados: ResultadoItemPush[] }).resultados[0]!.status).toBe('rejeitado');
    else expect(r.statusCode).toBe(403);
    expect((await noBanco(PED.promotor)).p).toBeUndefined();
  });

  it('multi-tenant: o vendedor do tenant B não abre o pedido de A (404)', async () => {
    const r = await api.chamar(tk.b, { method: 'GET', url: `/v1/vendedor/pedidos/${PED.endereco}` });
    expect(r.statusCode).toBe(404);
  });
});
