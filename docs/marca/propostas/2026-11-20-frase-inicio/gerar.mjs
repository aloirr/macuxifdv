// Simulação da frase do Início do Campo em negrito e em outra cor da paleta (pedido R-20261120-055304, item 1).
// Gera frase-inicio.html e frase-inicio.png (3 telas 390 x 844, escala 2). Dados fictícios.
// Uso: node docs/marca/propostas/2026-11-20-frase-inicio/gerar.mjs
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPranchas } from '../../../design/_comum/navegador.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const FONTE = 'system-ui, "Segoe UI", Roboto, -apple-system, sans-serif';
const FRASE = 'Planejar a rota é ganhar tempo na rua.';

const telas = [
  { rot: 'Antes (v1.0.16)', sub: 'faixaSub #C9CED5 · 400 itálico · 8,07:1', cor: '#C9CED5', peso: 400 },
  { rot: 'Proposta · Sol claro', sub: 'solClaro #F59A52 · 700 itálico · 5,85:1', cor: '#F59A52', peso: 700 },
  { rot: 'Alternativa · Branco', sub: 'faixaTitulo #FFFFFF · 700 itálico · 12,77:1', cor: '#FFFFFF', peso: 700 },
];

const card = (l, p, r, m, w) =>
  `<div class="card"><div class="lab"><span>${l}</span><span>${p}</span></div><div><span class="real">${r}</span> <span class="meta">${m}</span></div><div class="barra"><i style="width:${w}%"></i></div></div>`;

const sino = (extra) =>
  `<div class="sino${extra}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="bolinha"></span></div>`;

// Antes: sino na linha da saudação (ajuste da v1.0.16).
// Proposta e Alternativa: sino à direita da linha do topo, centralizado na altura da foto (72), como na Rota (spec campo-v1017 §1); sem o "· DU 14 de 21" e com ponto na saudação (R-20261120-055304, itens 3 e 4).
const tela = ({ rot, sub, cor, peso }, i) => `<div class="col"><div class="rot"><b>${rot}</b><br><span>${sub}</span></div>
<div class="tel"><div class="painel"><div class="status"><span>20:40</span><span>●●● 78%</span></div>
<div style="padding:12px 20px 16px;display:flex;gap:12px;align-items:center">
  <div class="av">LA</div>
  <div style="flex:1;display:flex;flex-direction:column;gap:2px;min-width:0">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:700;font-size:22px;line-height:28px;color:#FFFFFF">Boa noite, Lucas${i === 0 ? '' : '.'}</div>
      ${i === 0 ? sino(' sino-v1016') : ''}
    </div>
    <div style="font-size:14px;line-height:18px;color:#C9CED5">Sexta, 20 de novembro${i === 0 ? ' <span style="white-space:nowrap">· DU 14 de 21</span>' : ''}</div>
    <div class="frase" style="font-size:14px;line-height:18px;font-style:italic;font-weight:${peso};color:${cor}">“${FRASE}”</div>
  </div>${i === 0 ? '' : sino('')}</div></div>
<div class="meio"><div class="h2">Metas do mês</div><div class="grade">
${card('Vendas', '54%', 'R$ 48.320', 'de R$ 90.000', 54)}${card('Positivação', '63%', '38', 'de 60 clientes', 63)}
${card('Mix', '80%', '7,2', 'de 9 itens', 80)}${card('Ticket médio', '85%', 'R$ 1.271', 'de R$ 1.500', 85)}
</div><div class="h2">Produtividade</div><div class="prod">
<div>Visitas<b>9 de 12</b></div><div>Pedidos<b>6</b></div><div>Conversão<b>67%</b></div>
<div>Sem compra<b>3</b></div><div>Fora de rota<b>1</b></div><div>Itens/pedido<b>8,4</b></div></div></div>
<div class="sinc"><div class="btn">Sincronizar</div><div class="ult">Últ. sincronização<br>20:31</div></div>
<div class="abas"><span>Início</span><span>Rota</span><span>Pedidos</span><span>Clientes</span><span>Mais</span></div></div></div>`;

const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#d9dce1;font-family:${FONTE};color:#16202A;padding:28px;width:max-content}
h1{font-weight:700;font-size:24px;margin-bottom:6px}.nota{font-size:15px;color:#4A5562;margin-bottom:22px;max-width:1220px}
.linha{display:flex;gap:28px;align-items:flex-start}.col{display:flex;flex-direction:column;gap:10px}
.rot{font-size:14px;color:#4A5562}.rot b{font-size:15px;color:#16202A}
.tel{width:390px;height:844px;background:#F8F6F1;border-radius:28px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,.18);display:flex;flex-direction:column}
.painel{background:#1E3350}.status{height:24px;display:flex;justify-content:space-between;align-items:center;padding:0 20px;color:#fff;font-weight:600;font-size:12px}
.av{width:72px;height:72px;border-radius:16px;background:#ECEEF1;color:#1E3350;font-weight:700;font-size:24px;display:flex;align-items:center;justify-content:center;flex:none}
.sino{width:48px;height:48px;border:1px solid #3A4D68;border-radius:12px;display:flex;align-items:center;justify-content:center;position:relative;flex:none}
.sino-v1016{margin:-10px -12px 0 0}
.bolinha{position:absolute;top:10px;right:10px;width:12px;height:12px;border-radius:6px;background:#F59A52;border:2px solid #1E3350}
.meio{padding:10px 20px;display:flex;flex-direction:column;gap:8px;flex:1}.h2{font-weight:700;font-size:18px;margin-top:4px}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{background:#fff;border:1px solid #DFE2E6;border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.lab{font-weight:600;font-size:12px;color:#4A5562;display:flex;justify-content:space-between}
.real{font-weight:700;font-size:16px}.meta{font-size:12px;color:#4A5562}
.barra{height:6px;border-radius:3px;background:#DFE2E6}.barra i{display:block;height:6px;border-radius:3px;background:#C2540A}
.prod{background:#fff;border:1px solid #DFE2E6;border-radius:14px;padding:12px;display:grid;grid-template-columns:1fr 1fr 1fr;row-gap:10px}
.prod div{font-size:12px;color:#4A5562}.prod b{display:block;font-size:16px;color:#16202A}
.sinc{padding:8px 20px 12px;display:flex;align-items:center;gap:12px}
.btn{flex:1;height:52px;border-radius:14px;background:#16202A;color:#fff;font-weight:600;font-size:16px;display:flex;align-items:center;justify-content:center}
.ult{font-size:12px;color:#4A5562;text-align:right}
.abas{height:64px;background:#fff;border-top:1px solid #DFE2E6;display:flex;justify-content:space-around;align-items:center;font-size:12px;color:#4A5562}
.abas span:first-child{color:#1E3350;font-weight:600}
</style><body><h1>Início do Campo · frase em negrito e em outra cor</h1>
<div class="nota">Pedido R-20261120-055304, item 1. Telas 390 x 844, fonte do sistema, cabeçalho Azul noite #1E3350. Só muda a frase: peso 700 e a cor; tamanho 14, itálico e aspas ficam. Dados fictícios.</div>
<div class="linha">${telas.map(tela).join('')}</div>
<script>
const conflitos=[];document.querySelectorAll('.frase').forEach((f,i)=>{if(f.getBoundingClientRect().height>18*2+1)conflitos.push('frase '+i+' passou de 2 linhas')});
document.body.dataset.info=JSON.stringify({conflitos});document.body.dataset.pronto='1';
</script></body></html>`;

await gerarPranchas(aqui, { 'frase-inicio': [html, 1300, 980] });
