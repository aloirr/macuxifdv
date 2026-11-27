// Simulação v1.0.39 (spec §7.5): Parâmetros › Pedidos com Pedido mínimo, Crédito excedido e Estoque insuficiente, abaixo de
// Título vencido e Preço do orçamento. Usa o menu e o estilo de 02-parametros-calendario.html (gerado por gerar.mjs), troca a
// seção ativa para Pedidos e o conteúdo. Uso, a partir da raiz do repositório: node docs/design/menu-parametros/gerar-v1039-pedidos.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abrirNavegador } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const base = readFileSync(join(AQUI, '02-parametros-calendario.html'), 'utf8')
  .replace('<a class="item ativo" aria-current="page"><span>Calendário</span></a>', '<a class="item"><span>Calendário</span></a>')
  .replace('<a class="item"><span>Pedidos</span></a>', '<a class="item ativo" aria-current="page"><span>Pedidos</span></a>');
if (!base.includes('<a class="item ativo" aria-current="page"><span>Pedidos</span></a>')) throw new Error('menu: item Pedidos não encontrado');

const CSS = `<style>
.conteudo{max-width:760px}
.ajuda{font-size:13px;font-weight:400;color:#4A5562;line-height:1.35}
.linha{display:flex;align-items:center;gap:8px}
.num{width:260px;max-width:260px}
.un{font-size:13px;color:#4A5562;font-weight:400}
.grupo{display:flex;flex-direction:column;gap:8px}
.grupo > b{font-size:15px;font-weight:600}
.op{display:flex;align-items:center;gap:12px;min-height:52px;border:1px solid #C9CED5;border-radius:12px;background:#fff;padding:8px 16px}
.op.on{border-color:#16202A;box-shadow:inset 0 0 0 1px #16202A}
.bola{width:20px;height:20px;border-radius:999px;border:2px solid #4A5562;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.op.on .bola{border-color:#16202A}.op.on .bola:after{content:'';width:10px;height:10px;border-radius:999px;background:#16202A}
.op span{display:flex;flex-direction:column}.op span b{font-size:15px;font-weight:600}.op span small{font-size:13px;color:#4A5562}
.sub{margin:2px 0 0 32px;display:flex;flex-direction:column;gap:4px}
.input.erro{border:2px solid #B42318}
.msgerro{font-size:13px;font-weight:600;color:#B42318}
.acoes{display:flex;align-items:center;gap:12px}
.sucesso{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:8px;background:#E2F1EA;color:#1D6B4F;font-size:13px;font-weight:600}
</style>`;

const num = (rotulo, ajuda, valor, un) =>
  `<label class="campo">${rotulo}<span class="ajuda">${ajuda}</span><span class="linha"><span class="input num">${valor}<i></i></span><span class="un">${un}</span></span></label>`;
const op = (on, titulo, apoio) => `<div class="op${on ? ' on' : ''}" role="radio" aria-checked="${on}"><i class="bola"></i><span><b>${titulo}</b>${apoio ? `<small>${apoio}</small>` : ''}</span></div>`;
const salvar = (ativo, sucesso) => `<div class="acoes"><span class="btn ${ativo ? 'p' : 'd'}">Salvar</span>${sucesso ? `<span class="sucesso">✓ ${sucesso}</span>` : ''}</div>`;
const quadro = (titulo, corpo) => `<section class="quadro"><h2>${titulo}</h2>${corpo}</section>`;

const comuns = [
  quadro('Título vencido', num('Atraso tolerado', 'De 0 a 365 dias. Acima desse atraso, o pedido do cliente vai para aprovação.', '5', 'dias') + salvar(false)),
  quadro('Preço do orçamento', num('Preço vale por', 'De 1 a 90 dias corridos, contando o dia em que o orçamento é salvo. Depois, o orçamento vira pedido pelo preço do dia.', '7', 'dias') + salvar(false)),
].join('');

function minimo({ exigir = false, valor = '', erro = null, ativo = false } = {}) {
  const sub = exigir
    ? `<div class="sub"><label class="campo">Valor mínimo<span class="ajuda">Abaixo desse valor, o pedido só sai como orçamento.</span>${erro ? `<span class="msgerro">${erro}</span>` : ''}<span class="input num${erro ? ' erro' : ' editado'}" aria-invalid="${Boolean(erro)}"><span><i>R$ </i>${valor}</span><i></i></span></label></div>`
    : '';
  return quadro('Pedido mínimo', `<div class="grupo">${op(!exigir, 'Sem pedido mínimo')}${op(exigir, 'Exigir a partir de')}${sub}</div>` + salvar(ativo));
}
function credito(sel = 'aprovacao', { ativo = false, sucesso = null } = {}) {
  return quadro('Crédito excedido', `<div class="grupo" role="radiogroup"><b>Pedido a prazo acima do crédito disponível</b>${op(sel === 'aprovacao', 'Enviar para aprovação', 'Quem aprova está em Alçadas.')}${op(sel === 'orcamento', 'Só como orçamento', 'O vendedor não consegue enviar o pedido.')}${op(sel === 'avisar', 'Avisar e enviar', 'O pedido segue sem aprovação.')}</div>` + salvar(ativo, sucesso));
}
function estoque(sel = 'orcamento', { ativo = false, sucesso = null } = {}) {
  return quadro('Estoque insuficiente', `<div class="grupo" role="radiogroup"><b>Item com quantidade acima do estoque da filial</b>${op(sel === 'orcamento', 'Só como orçamento', 'O vendedor não consegue enviar o pedido.')}${op(sel === 'aprovacao', 'Enviar para aprovação', 'Quem aprova está em Alçadas.')}${op(sel === 'avisar', 'Avisar e enviar', 'O pedido segue com o item sem estoque.')}</div>` + salvar(ativo, sucesso));
}

const pagina = (conteudo) => {
  const i = base.indexOf('<main>');
  const j = base.indexOf('</main>');
  return base.slice(0, i).replace('</style>', '</style>' + CSS) + `<main><h1>Parâmetros</h1><div class="conteudo">${conteudo}</div></main>` + base.slice(j + 7);
};

const TELAS = {
  'v1039-pedidos-padrao': pagina(comuns + minimo() + credito() + estoque()),
  'v1039-pedidos-alterado-erro': pagina(
    comuns +
      minimo({ exigir: true, valor: '', erro: 'Use um valor de R$ 0,01 a R$ 100.000,00', ativo: true }) +
      credito('orcamento', { ativo: true }) +
      estoque('aprovacao', { sucesso: 'Estoque insuficiente salvo.' }),
  ),
};

const browser = await abrirNavegador();
for (const [nome, html] of Object.entries(TELAS)) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(arq).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  await page.close();
  console.log(`${nome}.png`);
}
await browser.close();
