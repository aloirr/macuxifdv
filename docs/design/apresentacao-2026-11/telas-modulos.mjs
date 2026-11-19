// Pesquisa, Treinamento e Promotor, nas telas de hoje (modules/pesquisa/app, modules/treinamento/app, modules/promotor/app).
import { badge, barraAbas, cabecalho, COR, ic, seloSync, tela } from './base.mjs';
import { CLIENTE } from './dados.mjs';

const CSS_COMUM = `
.cartao-p{background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}
.h2s{font-size:18px;font-weight:700}
.barra-p{height:8px;border-radius:4px;background:${COR.lineSoft};overflow:hidden}
.barra-p i{display:block;height:100%;border-radius:4px;background:${COR.grafico}}
.ln{display:flex;align-items:center;justify-content:space-between;gap:8px}`;

/** Responder pesquisa (responder-screen.tsx + campo-pergunta.tsx): progresso, perguntas em cartões e os dois botões. */
function pesquisa() {
  const css = `${CSS_COMUM}
.op{min-height:48px;display:flex;align-items:center;gap:12px;padding:0 12px;border:1px solid ${COR.line};border-radius:12px;background:#fff;font-size:16px}
.op.on{border-color:#9AA3B0;background:${COR.accentSoft}}
.op .rd{width:20px;height:20px;border-radius:10px;border:2px solid ${COR.lineStrong};flex:none}
.op.on .rd{border-color:${COR.accent};background:${COR.accent};box-shadow:inset 0 0 0 3px ${COR.accentSoft}}
.metade{display:flex;gap:8px}.metade div{flex:1;min-height:48px;display:flex;align-items:center;justify-content:center;border:1px solid ${COR.line};border-radius:12px;font-size:16px;font-weight:600;background:#fff}
.metade div.on{border-color:#9AA3B0;background:${COR.accentSoft}}
.esc{display:flex;gap:8px}.esc div{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border:1px solid ${COR.line};border-radius:12px;font-size:16px;font-weight:600;background:#fff}
.esc div.on{border-color:#9AA3B0;background:${COR.accentSoft}}
.ent{min-height:48px;display:flex;align-items:center;padding:0 12px;border:1px solid ${COR.lineStrong};border-radius:12px;font-size:16px;background:#fff}
.q{font-size:16px;font-weight:600}`;
  const pergunta = (n, txt, corpo, obrig = true) => `<div class="cartao-p"><span class="q">${n}. ${txt}</span>${obrig ? badge('Obrigatória', 'neu') : ''}<div style="display:flex;flex-direction:column;gap:8px">${corpo}</div></div>`;
  return tela({
    hora: '09:55',
    estilo: css,
    cab: cabecalho({ titulo: 'Preços da concorrência', subtitulo: 'Arroz e feijão no varejo', voltar: 'Pesquisas' }),
    corpo: [
      `<div style="display:flex;flex-direction:column;gap:8px"><div class="barra-p"><i style="width:67%"></i></div><b style="font-size:16px;font-weight:600">2 de 3</b></div>`,
      pergunta(1, 'A loja vende arroz de outra marca?', '<div class="metade"><div class="on">Sim</div><div>Não</div></div>'),
      pergunta(2, 'Preço do arroz 5 kg da outra marca', '<div class="ent">24,90</div>'),
      pergunta(3, 'Como está a exposição da nossa marca?', `<div class="esc">${[1, 2, 3, 4, 5].map((n) => `<div>${n}</div>`).join('')}</div>`),
    ].join(''),
    barra: barraAbas('campo', 'mais'),
  });
}

/** Treinar (treinar-screen.tsx): nível, sequência, XP, medalhas e as trilhas com o próximo passo. */
function treinamento() {
  const css = `${CSS_COMUM}
.nivel{background:${COR.ink};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px}
.nivel .ln b{font-size:18px;font-weight:700;color:#fff}.nivel .ln span{font-size:16px;font-weight:600;color:${COR.faixaSub}}
.nivel .barra-p{background:#34404D}.nivel .barra-p i{background:${COR.graficoEscuro}}
.nivel small{font-size:12px;color:${COR.faixaSub}}
.kpis{display:flex;gap:10px}.kpis .cartao-p{flex:1;gap:4px}
.kpis small{font-size:12px;color:${COR.ink2}}.kpis label{font-size:12px;font-weight:600;color:${COR.ink2}}
.kpis b{font-size:18px;font-weight:600}
.med{display:flex;flex-wrap:wrap;gap:6px}

.tr{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.tr>div{padding:14px;display:flex;flex-direction:column;gap:10px}
.tr>div+div{border-top:1px solid ${COR.lineSoft}}
.tr b{font-size:16px;font-weight:600;flex:1}.tr small{font-size:12px;color:${COR.ink2}}`;
  const trilha = (nome, chip, pct, lic, botao) => `<div><div class="ln"><b>${nome}</b>${chip}</div><div class="barra-p"><i style="width:${pct}%"></i></div><small>${lic}</small>${botao}</div>`;
  return tela({
    hora: '12:40',
    estilo: css,
    cab: cabecalho({ titulo: 'Treinar', subtitulo: '1 obrigatória pendente', direita: seloSync('12:10') }),
    corpo: [
      `<div class="nivel"><div class="ln"><b>Nível 4</b><span>1.240 XP</span></div><div class="barra-p"><i style="width:68%"></i></div><small>Faltam 260 XP para o nível 5</small></div>`,
      `<div class="kpis"><div class="cartao-p"><label>Sequência</label><b>6 dias</b><small>Hoje já conta</small></div><div class="cartao-p"><label>XP de hoje</label><b>40</b><small>Recorde: 12 dias</small></div></div>`,
      `<div class="med">${badge(`${ic('check', 14, COR.success, 2.4)}Primeira trilha`, 'suc')}${badge(`${ic('check', 14, COR.success, 2.4)}Semana cheia`, 'suc')}${badge(`${ic('lock', 14, COR.neutralInk)}Mestre do mix · a conquistar`, 'neu')}</div>`,
      `<div class="ln"><span class="h2s">Trilhas</span><span class="bt neu">${ic('target', 18, COR.ink)}Ranking</span></div>`,
      `<div class="tr">${trilha('Negociação de prazo e desconto', badge('Até 25/11', 'des'), 40, '2 de 5 lições', `<span class="bt pri">Continuar${ic('chevron', 18, '#fff')}</span>`)}${trilha('Mix de mercearia', badge('Em andamento', 'av'), 25, '1 de 4 lições', `<span class="bt sec">Continuar${ic('chevron', 18, COR.ink)}</span>`)}</div>`,
    ].join(''),
    barra: barraAbas('campo', 'mais'),
  });
}

/** Loja do promotor (modules/promotor/app/telas/tela-loja.tsx), no mesmo Mercado Bom Preço: checklist e share de gôndola. */
function promotor() {
  const css = `${CSS_COMUM}
.lj{background:#fff;border:1px solid ${COR.line};border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:6px}
.lj b{font-size:18px;font-weight:700}.lj span{font-size:14px;color:${COR.ink2}}
.it{display:flex;align-items:center;gap:10px;min-height:48px;font-size:16px}
.it span:first-child{flex:1}
.cartao-p small{font-size:12px;color:${COR.ink2}}
.chips-l{display:flex;flex-wrap:wrap;gap:8px}
.duas{display:flex;gap:10px}.duas>div{flex:1;display:flex;flex-direction:column;gap:4px}
.duas label{font-size:12px;font-weight:600;color:${COR.ink2}}
.duas .ent{min-height:48px;display:flex;align-items:center;padding:0 12px;border:1px solid ${COR.lineStrong};border-radius:12px;font-size:16px;background:#fff}`;
  const feito = `<span class="badge t-suc">${ic('check', 14, COR.success, 2.4)}Feito</span>`;
  return tela({
    hora: '10:20',
    estilo: css,
    cab: cabecalho({ titulo: 'Loja' }),
    corpo: [
      `<div class="lj"><b>${CLIENTE.fantasia}</b><span>Desde 10:05 · 3 registros</span></div>`,
      `<div class="cartao-p"><span class="h2s">Checklist · Abertura de loja</span><div class="barra-p"><i style="width:67%"></i></div>
<div class="it"><span>Conferir validade na gôndola *</span>${feito}</div><div class="it"><span>Organizar frentes do arroz *</span>${feito}</div><div class="it"><span>Repor ponta de gôndola</span><span class="bt sec">Feito</span></div><small>* obrigatória para encerrar</small></div>`,
      `<div class="cartao-p"><span class="h2s">Share de gôndola</span><div class="chips-l"><span class="chip on">Arroz</span><span class="chip">Feijão</span><span class="chip">Café</span><span class="chip">Óleo</span></div><div class="duas"><div><label>Frentes nossas</label><span class="ent">12</span></div><div><label>Frentes total</label><span class="ent">30</span></div></div><span class="bt sec">Salvar share</span></div>`,
    ].join(''),
    barra: barraAbas('promotor', 'loja'),
  });
}

export const TELAS_MODULOS = {
  '23-pesquisa': pesquisa(),
  '24-treinamento': treinamento(),
  '25-promotor': promotor(),
};
