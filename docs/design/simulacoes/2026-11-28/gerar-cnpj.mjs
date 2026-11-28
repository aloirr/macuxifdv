// Simulação da T-0203 (CNPJ no cadastro de cliente; RF-CORE-10, RN-CORE-16, RN-CORE-17, R-20261102-092329): cadastro no BKO
// (1366) e pré-cadastro no Campo (390), nos estados válido, inválido e vazio (cadastro incompleto). Dados fictícios.
// Uso, a partir da raiz do repositório: node docs/design/simulacoes/2026-11-28/gerar-cnpj.mjs
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PRONTO = `<script>document.body.dataset.info='{"conflitos":[]}';document.body.dataset.pronto='1'</script>`;
const VALIDO = '11.222.333/0001-81';
const INVALIDO = '11.222.333/0001-80';
const AUTO = 'Cadastro incompleto: falta CNPJ/CPF.';

// ---------- Campo (390) ----------
const CSS_CAMPO = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:390px;min-height:844px;display:flex;flex-direction:column}
.st{height:28px;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.fx{background:#1E3350;padding:6px 16px 16px;display:flex;flex-direction:column;gap:2px}
.fx .v{color:#C9CED5;font-size:14px;min-height:28px;display:flex;align-items:center}.fx h1{color:#fff;font-size:22px;font-weight:700}.fx .s{color:#C9CED5;font-size:14px}
.corpo{flex:1;padding:16px;display:flex;flex-direction:column;gap:14px}
.tit{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#4A5562;margin-top:4px}
.c{display:flex;flex-direction:column;gap:6px}
.c label{font-size:14px;font-weight:600}
.c label i{font-style:normal;font-weight:400;color:#34404D}
.in{height:52px;border:1px solid #7A8593;border-radius:12px;background:#fff;display:flex;align-items:center;padding:0 14px;font-size:16px;font-variant-numeric:tabular-nums}
.in.foco{border:2px solid #1E3350}
.in.erro{border:2px solid #A8261B}
.in .ph{color:#5B6673}
.falta{font-size:14px;color:#A8261B;font-weight:600}
.lin{display:flex;gap:10px}.lin .c:first-child{flex:2}.lin .c:last-child{flex:1}
.rod{padding:12px 16px 16px;background:#fff;border-top:1px solid #DFE2E6}
.bt{height:52px;border-radius:14px;background:#1E3350;color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:12px}
.tl{display:flex;justify-content:space-between;gap:8px;min-height:44px;align-items:center;padding:0 12px;font-size:14px;border-bottom:1px solid #ECEEF1}
.tl:last-child{border-bottom:0}.tl span:first-child{color:#4A5562}
.tag{align-self:flex-start;height:24px;border-radius:999px;padding:0 10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;background:#FFF1D6;color:#5C3B00}
.obs{padding:12px;font-size:14px;line-height:20px}
.obs b{font-weight:600;display:block}
.barra{height:56px;background:#fff;border-top:1px solid #DFE2E6;display:flex}
.barra span{flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#4A5562}
.barra span.on{color:#1E3350}`;

function formularioCampo(nome, doc, estado) {
  const cls = estado === 'erro' ? 'in erro' : estado === 'foco' ? 'in foco' : 'in';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0203 · Campo · ${nome}</title><style>${CSS_CAMPO}</style><body>
<div class="st"><span>09:40</span><span>4G</span></div>
<div class="fx"><span class="v">‹ Clientes</span><h1>Novo cliente</h1></div>
<div class="corpo">
<div class="c"><label>CPF/CNPJ</label><div class="${cls}">${doc}</div>${estado === 'erro' ? '<span class="falta">CNPJ inválido</span>' : ''}</div>
<div class="c"><label>Razão social</label><div class="in">Mercado Bom Preço Ltda</div></div>
<div class="c"><label>Nome fantasia <i>(opcional)</i></label><div class="in">Mercado Bom Preço</div></div>
<span class="tit">Endereço</span>
<div class="c"><label>CEP</label><div class="in">69000-000</div></div>
<div class="lin"><div class="c"><label>Logradouro</label><div class="in">Rua Exemplo</div></div><div class="c"><label>Número</label><div class="in">100</div></div></div>
</div>
<div class="rod"><span class="bt">Salvar</span></div>
${PRONTO}</body></html>`;
  return [html, 390, 844];
}

function fichaCampo() {
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0203 · Campo · sem CNPJ</title><style>${CSS_CAMPO}</style><body>
<div class="st"><span>09:42</span><span>4G</span></div>
<div class="fx"><span class="v">‹ Clientes</span><h1>Mercado Bom Preço</h1><span class="s">Mercado Bom Preço Ltda · Manaus/AM</span></div>
<div class="corpo">
<span class="tag">Cadastro incompleto</span>
<div class="cx"><div class="tl"><span>CPF/CNPJ</span><span>—</span></div><div class="tl"><span>Endereço</span><span>Rua Exemplo, 100 · Manaus/AM</span></div></div>
<span class="tit">Observações</span>
<div class="cx obs"><b>${AUTO}</b></div>
</div>
<div class="barra"><span>Início</span><span>Rota</span><span class="on">Clientes</span><span>Pedidos</span><span>Mais</span></div>
${PRONTO}</body></html>`;
  return [html, 390, 844];
}

// ---------- BKO (1366) ----------
const CSS_BKO = `*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex}
.menu{width:240px;background:#16202A;color:#C9CED5;padding:20px 12px;display:flex;flex-direction:column;gap:4px;font-size:15px;flex-shrink:0}
.menu b{color:#fff;font-size:17px;padding:0 10px 18px}
.menu .g{color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;padding:10px 10px 4px}
.menu span{padding:6px 10px 6px 20px;border-radius:8px}.menu span.on{background:#2B3743;color:#fff;font-weight:600}
main{flex:1;padding:28px 32px;display:flex;flex-direction:column;gap:20px;max-width:1126px}
.cab{display:flex;align-items:center;gap:12px}
.cab small{font-size:14px;color:#4A5562;display:block}
h1{font-size:24px;font-weight:700}
.tag{height:24px;border-radius:999px;padding:0 10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;background:#FFF1D6;color:#5C3B00}
.q{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:20px;display:flex;flex-direction:column;gap:16px}
h2{font-size:17px;font-weight:700}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px 24px}
.c{display:flex;flex-direction:column;gap:4px;font-size:15px;font-weight:600}
.in{height:44px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:400;display:flex;align-items:center;padding:0 12px;font-variant-numeric:tabular-nums}
.in.foco{border:2px solid #1E3350}.in.erro{border:2px solid #A8261B}
.ph{color:#5B6673}
.falta{font-size:13px;color:#A8261B;font-weight:600}
.obs{border:1px solid #C9CED5;border-radius:10px;padding:10px 12px;font-size:15px;font-weight:400;line-height:22px;min-height:88px}
.obs b{font-weight:600;display:block}
.acoes{display:flex;justify-content:flex-end;gap:8px}
.btn{height:44px;border-radius:10px;padding:0 20px;font-size:15px;font-weight:600;display:inline-flex;align-items:center}
.btn.p{background:#1E3350;color:#fff}.btn.s{border:1px solid #C9CED5;background:#fff;color:#16202A}`;

function bko(nome, doc, estado) {
  const incompleto = estado === 'vazio';
  const cls = estado === 'erro' ? 'in erro' : estado === 'foco' ? 'in foco' : 'in';
  const valorDoc = doc || '<span class="ph">00.000.000/0000-00</span>';
  const titulo = incompleto ? '<div><h1>Mercado Bom Preço</h1><small>Cliente · cód. FDV 000231</small></div><span class="tag">Cadastro incompleto</span>' : '<h1>Novo cliente</h1>';
  const obs = incompleto ? `<b>${AUTO}</b>Receber só pela manhã.` : '<span class="ph">Opcional</span>';
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0203 · BKO · ${nome}</title><style>${CSS_BKO}</style><body>
<nav class="menu"><b>Distribuidora Exemplo</b><span class="g">Vendas</span><span>Pedidos</span><span class="on">Clientes</span><span>Catálogo</span><span class="g">Equipe</span><span>Vendedores</span></nav>
<main><div class="cab">${titulo}</div>
<div class="q"><h2>Identificação</h2><div class="g3">
<div class="c">CPF/CNPJ<div class="${cls}">${valorDoc}</div>${estado === 'erro' ? '<span class="falta">CNPJ inválido</span>' : ''}</div>
<div class="c">Razão social<div class="in">Mercado Bom Preço Ltda</div></div>
<div class="c">Nome fantasia<div class="in">Mercado Bom Preço</div></div>
<div class="c">Inscrição estadual<div class="in">04.123.456-7</div></div>
<div class="c">Telefone<div class="in">(92) 3000-0000</div></div>
<div class="c">E-mail<div class="in">compras@exemplo.com.br</div></div></div></div>
<div class="q"><h2>Endereço</h2><div class="g3">
<div class="c">CEP<div class="in">69000-000</div></div>
<div class="c">Logradouro<div class="in">Rua Exemplo</div></div>
<div class="c">Número<div class="in">100</div></div>
<div class="c">Bairro<div class="in">Centro</div></div>
<div class="c">Cidade<div class="in">Manaus</div></div>
<div class="c">UF<div class="in">AM</div></div></div></div>
<div class="q"><h2>Observações</h2><div class="obs">${obs}</div></div>
<div class="acoes"><span class="btn s">Cancelar</span><span class="btn p">Salvar</span></div>
</main>${PRONTO}</body></html>`;
  return [html, 1366, 900];
}

await gerarPranchas(AQUI, {
  'cnpj-campo-1-valido-390': formularioCampo('válido', VALIDO, 'foco'),
  'cnpj-campo-2-invalido-390': formularioCampo('inválido', INVALIDO, 'erro'),
  'cnpj-campo-3-vazio-incompleto-390': fichaCampo(),
  'cnpj-bko-1-valido-1366': bko('válido', VALIDO, 'foco'),
  'cnpj-bko-2-invalido-1366': bko('inválido', INVALIDO, 'erro'),
  'cnpj-bko-3-vazio-incompleto-1366': bko('vazio, cadastro incompleto', '', 'vazio'),
});
