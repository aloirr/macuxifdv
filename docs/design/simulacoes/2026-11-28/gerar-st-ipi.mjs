// Simulação da T-0208 (ST e IPI vindos do ERP, ADR 0077): pedido no Campo (390), no BKO (1366) e no PDF (A4 paisagem numa
// prancha de 1366). Dados fictícios. Uso, a partir da raiz do repositório: node docs/design/simulacoes/2026-11-28/gerar-st-ipi.mjs
// Regra do valor (contrato do ERP): 0 = "R$ 0,00"; campo ausente no item = "não informado"; total ausente (falta regra em algum
// item) = total "não informado", sem somar os itens; pedido sem resposta do ERP = "calculado pelo ERP".
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

const brl = (c) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rs = (c) => `R$ ${brl(c)}`;
const NI = 'não informado';
const ERP = 'calculado pelo ERP';

const ITENS = [
  { cod: 'ACU-1K', desc: 'Açúcar cristal 1 kg', marca: 'Doce Vale', emb: 'FD c/ 10', qtd: 1, tab: 3600, aj: '+10,0%', liq: 3960, tot: 3960 },
  { cod: 'AGU-1500', desc: 'Água mineral 1,5 L', marca: 'Fonte Clara', emb: 'FD c/ 6', qtd: 2, tab: 1505, aj: '−15,0%', liq: 1279, tot: 2558 },
  { cod: 'CAF-500', desc: 'Café torrado e moído 500 g', marca: 'Serra Alta', emb: 'UN', qtd: 4, tab: 1340, aj: '0,0%', liq: 1340, tot: 5360 },
];
// Três cenários: completo (todos com regra), falta (o item 2 sem regra de ST) e aguardando (sem resposta do ERP).
const CEN = {
  completo: { itens: [{ st: 238, ipi: 0 }, { st: 154, ipi: 128 }, { st: 322, ipi: 0 }], st: 714, ipi: 128 },
  falta: { itens: [{ st: 238, ipi: 0 }, { st: null, ipi: 128 }, { st: 322, ipi: 0 }], st: null, ipi: 128 },
  aguardando: null,
};
const vItem = (v) => (v == null ? `<span class="ni">${NI}</span>` : brl(v));
const vTot = (c, k) => (c == null ? `<span class="ni">${ERP}</span>` : c[k] == null ? `<span class="ni">${NI}</span>` : rs(c[k]));
const PRONTO = `<script>document.body.dataset.info='{"conflitos":[]}';document.body.dataset.pronto='1'</script>`;

// ---------- Campo (390) ----------
const CSS_CAMPO = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:390px}
.st{height:28px;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.fx{background:#1E3350;padding:6px 16px 16px;display:flex;flex-direction:column;gap:2px}
.fx .v{color:#C9CED5;font-size:14px;min-height:28px;display:flex;align-items:center}.fx h1{color:#fff;font-size:22px;font-weight:700}.fx .s{color:#C9CED5;font-size:14px}
.corpo{padding:14px 16px 20px;display:flex;flex-direction:column;gap:10px}
.tit{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#4A5562;margin-top:6px}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:12px;overflow:hidden}
.tl{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:40px;padding:0 12px;font-size:14px;border-bottom:1px solid #ECEEF1}
.tl:last-child{border-bottom:0}
.tl span:first-child{color:#4A5562}
.tl span:last-child{font-variant-numeric:tabular-nums;text-align:right}
.tl.f{min-height:52px}.tl.f span:first-child{font-size:16px;font-weight:600;color:#16202A}.tl.f span:last-child{font-size:22px;font-weight:600}
.tl.imp{background:#FAFAF8}
.tl.imp span:first-child{color:#16202A;font-weight:600}
.ni{color:#4A5562;font-weight:400}
table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
th{font-size:11px;font-weight:600;color:#4A5562;text-align:right;padding:8px 6px;line-height:14px;vertical-align:bottom;border-bottom:1px solid #DFE2E6}
th:first-child,td:first-child{text-align:left;padding-left:12px}
th:last-child,td:last-child{padding-right:12px}
td{text-align:right;padding:10px 6px 2px}
td.c{white-space:nowrap;font-family:monospace;font-size:13px;color:#1E3350;font-weight:600}
td.t{font-weight:600}
tr.imp td{padding:0 12px 10px;text-align:left;font-size:13px;color:#34404D;border-bottom:1px solid #ECEEF1}
tr.imp td b{font-weight:600;color:#16202A}
tr.ult td{border-bottom:0}
tr.sem td{padding-bottom:10px;border-bottom:1px solid #ECEEF1}
.hist{display:flex;flex-wrap:wrap;gap:6px}
.tag{height:24px;border-radius:999px;padding:0 10px;font-size:12px;display:inline-flex;align-items:center;background:#ECEEF1;color:#34404D;font-weight:600}
.tag.at{background:#DFE2E6;color:#1E3350}
.rod{display:flex;gap:8px;padding:12px 16px 16px;background:#fff;border-top:1px solid #DFE2E6}
.bt{flex:1;height:44px;border-radius:12px;border:1px solid #C9CED5;background:#fff;color:#1E3350;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center}
.barra{height:56px;background:#fff;border-top:1px solid #DFE2E6;display:flex}
.barra span{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#4A5562}
.barra span.on{color:#1E3350}`;

function campo(nome, cen) {
  const c = CEN[cen];
  const linhas = ITENS.map((it, i) => {
    const ult = i === ITENS.length - 1 ? ' ult' : '';
    const base = `<tr${c ? '' : ` class="sem${ult}"`}><td class="c">${it.cod}</td><td>${it.emb.split(' ')[0]}</td><td>${it.qtd}</td><td>${brl(it.tab)}</td><td>${it.aj}</td><td class="t">${brl(it.tot)}</td></tr>`;
    if (!c) return base;
    const x = c.itens[i];
    return `${base}<tr class="imp${ult}"><td colspan="6">ST <b>${vItem(x.st)}</b> · IPI <b>${vItem(x.ipi)}</b></td></tr>`;
  }).join('');
  const titulo = c ? 'Pedido 000014' : 'Pedido';
  const hist = c ? '<span class="tag">Salvo · 28/11 08:40</span><span class="tag">Enviado · 28/11 08:41</span><span class="tag at">Aprovado · 28/11 08:55</span>' : '<span class="tag at">Salvo · 28/11 08:40</span>';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0208 · Campo · ${nome}</title><style>${CSS_CAMPO}</style><body>
<div class="st"><span>09:12</span><span>${c ? '4G' : 'Sem sinal'}</span></div>
<div class="fx"><span class="v">‹ Pedidos</span><h1>${titulo}</h1><span class="s">Mercado Bom Preço · cód. C5007</span></div>
<div class="corpo">
<div class="cx"><div class="tl"><span>Pagamento</span><span>Boleto · 28/56 dias</span></div><div class="tl"><span>Entrega</span><span>CIF · Rua Pará, 137 · Manaus/AM</span></div></div>
<span class="tit">Itens (3)</span>
<div class="cx"><table><thead><tr><th>Código</th><th>Emb.</th><th>Qtd</th><th>Valor tabela</th><th>Desc./ Acrésc.</th><th>Total</th></tr></thead><tbody>${linhas}</tbody></table></div>
<span class="tit">Totais</span>
<div class="cx"><div class="tl"><span>Valor de tabela</span><span>R$ 119,70</span></div><div class="tl"><span>Desconto (%)</span><span>0,8%</span></div><div class="tl"><span>Desconto (R$)</span><span>− R$ 0,92</span></div><div class="tl f"><span>Valor final</span><span>R$ 118,78</span></div>
<div class="tl imp"><span>ST</span><span>${vTot(c, 'st')}</span></div><div class="tl imp"><span>IPI</span><span>${vTot(c, 'ipi')}</span></div></div>
<span class="tit">Histórico</span><div class="hist">${hist}</div>
</div>
<div class="rod"><span class="bt">PDF</span><span class="bt">Duplicar</span></div>
<div class="barra"><span>Início</span><span>Rota</span><span>Clientes</span><span class="on">Pedidos</span><span>Mais</span></div>
${PRONTO}</body></html>`;
  return [html, 390, 844];
}

// ---------- BKO (1366): detalhe do pedido na gaveta, sobre a lista ----------
const CSS_BKO = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:860px;display:flex;position:relative}
.menu{width:240px;background:#16202A;color:#C9CED5;padding:20px 12px;display:flex;flex-direction:column;gap:4px;font-size:15px;flex-shrink:0}
.menu b{color:#fff;font-size:17px;padding:0 10px 18px}
.menu .g{color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:10px 10px 4px}
.menu span{padding:6px 10px 6px 20px;border-radius:8px}.menu span.on{background:#2B3743;color:#fff;font-weight:600}
main{flex:1;padding:28px 32px;display:flex;flex-direction:column;gap:16px}
h1{font-size:24px;font-weight:700}
.lista{background:#fff;border:1px solid #DFE2E6;border-radius:16px;height:520px}
.veu{position:absolute;inset:0;background:rgba(15,20,25,.35)}
.gav{position:absolute;top:0;right:0;bottom:0;width:900px;background:#F8F6F1;padding:24px 28px;display:flex;flex-direction:column;gap:14px;box-shadow:-8px 0 24px rgba(22,32,42,.18)}
.topo{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.topo h2{font-size:22px;font-weight:700}.topo small{display:block;font-size:15px;color:#4A5562;margin-top:2px}
.bts{display:flex;gap:8px}
.btn{height:38px;border-radius:10px;padding:0 14px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;border:1px solid #C9CED5;background:#fff;color:#16202A;white-space:nowrap}
.q{background:#fff;border:1px solid #DFE2E6;border-radius:12px;padding:16px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.f small{display:block;font-size:13px;color:#4A5562}.f{font-size:15px}
.tot{display:flex;flex-direction:column;gap:6px;font-size:15px;font-variant-numeric:tabular-nums}
.tot div{display:flex;justify-content:space-between}
.tot .r{color:#4A5562}
.tot .fin{border-top:1px solid #ECEEF1;padding-top:6px;font-size:20px;font-weight:600}
.tot .imp{border-top:1px solid #ECEEF1;padding-top:6px}
.tot .imp + .imp{border-top:0;padding-top:0}
.tot .imp .r{color:#16202A;font-weight:600}
.ni{color:#4A5562;font-weight:400}
h3{font-size:17px;font-weight:700;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th{text-align:left;font-size:13px;font-weight:600;color:#4A5562;padding:6px 8px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 8px;height:44px;border-bottom:1px solid #ECEEF1;white-space:nowrap}
td.d{white-space:normal}
tr:last-child td{border-bottom:0}
.n{text-align:right}
.mono{font-family:monospace;color:#1E3350;font-weight:600}`;

function bko(nome, cen) {
  const c = CEN[cen];
  const linhas = ITENS.map((it, i) => {
    const x = c?.itens[i];
    const imp = (k) => (c ? (x[k] == null ? `<span class="ni">${NI}</span>` : brl(x[k])) : '');
    return `<tr><td class="mono">${it.cod}</td><td class="d">${it.desc}</td><td>${it.emb}</td><td class="n">${it.qtd}</td><td class="n">${brl(it.tab)}</td><td class="n">${it.aj}</td><td class="n"><b>${brl(it.tot)}</b></td>${c ? `<td class="n">${imp('st')}</td><td class="n">${imp('ipi')}</td>` : ''}</tr>`;
  }).join('');
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0208 · BKO · ${nome}</title><style>${CSS_BKO}</style><body>
<nav class="menu"><b>Distribuidora Exemplo</b><span class="g">Vendas</span><span class="on">Pedidos</span><span>Clientes</span><span>Catálogo</span><span class="g">Equipe</span><span>Vendedores</span></nav>
<main><h1>Pedidos</h1><div class="lista"></div></main><div class="veu"></div>
<aside class="gav">
<div class="topo"><div><h2>Pedido 000014</h2><small>Mercado Bom Preço · cód. C5007 · Lucas Andrade</small></div><div class="bts"><span class="btn">PDF do cliente</span><span class="btn">PDF interno</span></div></div>
<div class="q grade"><div class="f"><small>Condição</small>Boleto · 28/56 dias</div><div class="f"><small>Recebido</small>28/11/2026 08:41</div><div class="f"><small>Itens</small>3 · 7 un.</div><div class="f"><small>Tabela de preço</small>Varejo Manaus</div></div>
<div class="q tot"><div><span class="r">Subtotal</span><span>R$ 119,70</span></div><div><span class="r">Desconto (0,8%)</span><span>− R$ 0,92</span></div><div class="fin"><span>Total</span><span>R$ 118,78</span></div>
<div class="imp"><span class="r">ST</span><span>${vTot(c, 'st')}</span></div><div class="imp"><span class="r">IPI</span><span>${vTot(c, 'ipi')}</span></div></div>
<div class="q"><h3>Itens</h3><table><thead><tr><th>Código</th><th>Descrição</th><th>Medida</th><th class="n">Qtd</th><th class="n">Tabela</th><th class="n">Desc./Acr.</th><th class="n">Total</th>${c ? '<th class="n">ST</th><th class="n">IPI</th>' : ''}</tr></thead><tbody>${linhas}</tbody></table></div>
</aside>${PRONTO}</body></html>`;
  return [html, 1366, 860];
}

// ---------- PDF (A4 paisagem, 1123 × 794, numa prancha de 1366) ----------
const CSS_PDF = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#C9CED5;width:1366px;padding:32px 0;display:flex;justify-content:center}
.pag{width:1123px;min-height:794px;background:#fff;padding:40px 40px;color:#16202A;display:flex;flex-direction:column;gap:22px;box-shadow:0 4px 16px rgba(22,32,42,.2)}
.cab{display:flex;justify-content:space-between;align-items:flex-start}
.emp{display:flex;gap:14px;align-items:center}
.logo{width:54px;height:54px;border-radius:12px;background:#1E3350}
.emp b{font-size:22px;font-weight:700;display:block}.emp small{display:block;font-size:13px;color:#4A5562;line-height:18px}
.num{text-align:right}.num span{font-size:13px;letter-spacing:.12em;color:#C2540A;font-weight:600;margin-right:10px}.num b{font-size:28px;font-weight:700}.num small{display:block;font-size:13px;color:#4A5562}
.ficha{display:grid;grid-template-columns:2fr 1fr 1fr;border:1px solid #16202A;border-radius:6px;background:#F2F3F1}
.ficha div{padding:10px 12px;font-size:14px;border-right:1px solid #C9CED5}.ficha div:last-child{border-right:0}
.ficha small{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#4A5562;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
th{background:#00843D;color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;text-align:left;padding:10px 8px;white-space:nowrap}
td{padding:9px 8px;white-space:nowrap}
tbody tr:nth-child(even) td{background:#F2F3F1}
tbody tr:last-child td{border-bottom:2px solid #16202A}
.n{text-align:right}.mono{font-family:monospace;color:#34404D}
.ni{color:#4A5562}
.rod{display:flex;justify-content:space-between;gap:24px;align-items:flex-start}
.obs small{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#4A5562;font-weight:600;margin-top:8px}.obs b{font-size:14px}
.obs .nota{font-size:12px;color:#4A5562;margin-top:14px}
.box{border:2px solid #16202A;border-radius:6px;background:#F2F3F1;padding:12px 16px;width:330px;display:flex;flex-direction:column;gap:6px;font-size:14px;font-variant-numeric:tabular-nums;flex-shrink:0}
.box div{display:flex;justify-content:space-between}
.box .fin{font-size:16px;font-weight:600;align-items:baseline}.box .fin span:last-child{font-size:26px;font-weight:700}
.box .imp{border-top:1px solid #C9CED5;padding-top:6px}.box .imp + .imp{border-top:0;padding-top:0}`;

function pdf(nome, cen, escritorio) {
  const c = CEN[cen];
  const imp = (x, k) => (x[k] == null ? `<span class="ni">${NI}</span>` : brl(x[k]));
  const linhas = ITENS.map((it, i) => {
    const x = c?.itens[i];
    const meio = escritorio
      ? `<td class="n">${brl(it.tab)}</td><td class="n">${it.aj}</td><td class="n">${brl(it.liq)}</td>`
      : `<td class="n">${brl(it.liq)}</td>`;
    return `<tr><td class="n">${i + 1}</td><td class="mono">${it.cod}</td><td>${it.desc}</td><td>${it.marca}</td><td>${it.emb}</td><td class="n">${it.qtd}</td>${meio}<td class="n"><b>${brl(it.tot)}</b></td>${c ? `<td class="n">${imp(x, 'st')}</td><td class="n">${imp(x, 'ipi')}</td>` : ''}</tr>`;
  }).join('');
  const cab = escritorio
    ? '<th class="n">Item</th><th>Código</th><th>Descrição</th><th>Marca</th><th>Emb.</th><th class="n">Qtd</th><th class="n">Tabela</th><th class="n">Desc./Acr.</th><th class="n">Líquido</th><th class="n">Total</th>'
    : '<th class="n">Item</th><th>Código</th><th>Descrição</th><th>Marca</th><th>Emb.</th><th class="n">Qtd</th><th class="n">Preço unit. R$</th><th class="n">Total R$</th>';
  const caixa = escritorio
    ? '<div><span>Valor de tabela</span><span>R$ 119,70</span></div><div><span>Desconto (%)</span><span>0,8%</span></div><div><span>Desconto (R$)</span><span>− R$ 0,92</span></div><div class="fin"><span>Valor final</span><span>R$ 118,78</span></div>'
    : '<div class="fin"><span>Valor final</span><span>R$ 118,78</span></div>';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0208 · PDF · ${nome}</title><style>${CSS_PDF}</style><body><div class="pag">
<div class="cab"><div class="emp"><span class="logo"></span><div><b>Distribuidora Exemplo</b><small>Matriz Manaus · CNPJ 12.345.678/0001-90 · (92) 3234-5678</small><small>Av. Exemplo, 1200 · Centro · Manaus/AM · CEP 69000-000</small></div></div>
<div class="num"><span>${escritorio ? 'PEDIDO · USO INTERNO' : 'PEDIDO'}</span>${c ? '<b>000014</b>' : ''}<small>28/11/2026</small></div></div>
<div class="ficha"><div><small>Cliente</small><b>Mercado Bom Preço Ltda</b> · Mercado Bom Preço</div><div><small>${escritorio ? 'CNPJ · código' : 'CNPJ'}</small>11.222.333/0001-81${escritorio ? ' · C5007' : ''}</div><div><small>Vendedor</small>Lucas Andrade</div></div>
<table><thead><tr>${cab}${c ? '<th class="n">ST R$</th><th class="n">IPI R$</th>' : ''}</tr></thead><tbody>${linhas}</tbody></table>
<div class="rod"><div class="obs"><small>Observação do pedido</small><b>Entregar junto com o pedido 000012.</b><small>Observação da entrega</small><b>Descarga pela lateral, das 7h às 11h.</b>${escritorio ? '' : '<div class="nota">Valor final sem ST e IPI. Preço e estoque confirmados no faturamento.</div>'}</div>
<div class="box">${caixa}<div class="imp"><span>ST</span><span>${vTot(c, 'st')}</span></div><div class="imp"><span>IPI</span><span>${vTot(c, 'ipi')}</span></div></div></div>
</div>${PRONTO}</body></html>`;
  return [html, 1366, 860];
}

await gerarPranchas(AQUI, {
  'st-ipi-campo-1-completo-390': campo('completo', 'completo'),
  'st-ipi-campo-2-falta-regra-390': campo('falta regra', 'falta'),
  'st-ipi-campo-3-offline-390': campo('offline', 'aguardando'),
  'st-ipi-bko-1-completo-1366': bko('completo', 'completo'),
  'st-ipi-bko-2-falta-regra-1366': bko('falta regra', 'falta'),
  'st-ipi-bko-3-aguardando-erp-1366': bko('aguardando o ERP', 'aguardando'),
  'st-ipi-pdf-1-cliente-falta-regra-1366': pdf('cliente, falta regra', 'falta', false),
  'st-ipi-pdf-2-escritorio-falta-regra-1366': pdf('escritório, falta regra', 'falta', true),
  'st-ipi-pdf-3-cliente-aguardando-erp-1366': pdf('cliente, aguardando o ERP', 'aguardando', false),
});
