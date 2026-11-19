// Rastreamento no expediente (v1.0.15, T-0156; pranchas aprovadas de docs/design/tracking/ no branch nuvem/v1015-designer-ux):
// termo de ciência, notificação fixa do Android, pausa no Perfil e "Meu trajeto", no dia da Carla Lima.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cabecalho, COR, ic, pagina, tela } from './base.mjs';
import { EMPRESA, VENDEDORA } from './dados.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ICONE_NOTIFICACAO = `data:image/png;base64,${readFileSync(join(AQUI, '../../marca/ativos/2026-11-12-v1/icone-notificacao-96.png')).toString('base64')}`;

/** Termo de ciência na 1ª abertura sem aceite (depois do login e da carga), com os dois botões fixos no rodapé. */
function termo() {
  const css = `
.corpo.termo{gap:12px;padding:16px 20px 0;position:relative}
.termo p,.termo li{font-size:16px;line-height:24px}
.termo ul{display:flex;flex-direction:column;gap:10px;padding-left:20px}
.corpo.termo::after{content:'';position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(rgba(248,246,241,0),${COR.ground})}
.rolagem{position:absolute;right:3px;top:6px;width:4px;height:120px;border-radius:2px;background:${COR.lineStrong}}
.rod{flex:none;padding:12px 20px 16px;background:#fff;border-top:1px solid ${COR.line};display:flex;flex-direction:column;gap:8px}`;
  return tela({
    hora: '08:02',
    estilo: css,
    cab: cabecalho({ titulo: 'Localização no expediente', subtitulo: 'Termo de ciência · versão 1 · 16/11/2026', semSino: true }),
    classeCorpo: 'termo',
    corpo: `<p>A ${EMPRESA} registra a sua localização <b>só durante o expediente</b> (seg. a sex., 08:00 às 18:00; sáb., 08:00 às 12:00). Serve para comprovar as visitas, planejar a rota e calcular o km do dia.</p>
<ul><li>Fora do expediente, em feriado, folga, férias ou afastamento, <b>nada é registrado</b>. Quando está registrando, o Android mostra a notificação "localização ativa no expediente".</li>
<li>Veem o seu trajeto: você, o seu supervisor, o gerente da sua área e o administrador da ${EMPRESA}. Os colegas não veem.</li>
<li>O trajeto fica 90 dias. O resumo do dia (km, visitas, tempo em cliente) fica 5 anos, para metas e remuneração variável.</li>
<li>O trajeto não é usado sozinho para punição ou desligamento: sempre há revisão de uma pessoa.</li></ul><i class="rolagem"></i>`,
    barra: '<div class="rod"><span class="bt pri">Li e estou ciente</span><span class="bt neu">Agora não</span></div>',
  });
}

/** Notificação fixa do Android no expediente (canal "Localização no expediente", silenciosa, sem ação). */
function notificacao() {
  const css = `
.and{width:360px;height:760px;background:#F1F3F8;display:flex;flex-direction:column}
.and .asb{height:28px;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:13px;font-weight:600;color:#1B1C1F}
.and .asb span{display:flex;gap:6px;align-items:center}
.and .asb img{width:14px;height:14px;filter:brightness(0)}
.and .rel{padding:12px 20px 4px;font-size:28px;color:#1B1C1F}
.and .dt{padding:0 20px 12px;font-size:14px;color:#44474F}
.and .rap{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 14px}
.and .rap div{height:56px;border-radius:28px;background:#DDE1EA;display:flex;align-items:center;gap:10px;padding:0 16px;font-size:14px;font-weight:500;color:#1B1C1F}
.and .rap div.on{background:#D6E3FF}
.and .grupo{font-size:13px;font-weight:600;color:#44474F;padding:6px 24px}
.not{margin:0 12px;background:#fff;border-radius:20px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.not .pi{width:32px;height:32px;flex:none;border-radius:16px;background:${COR.faixa};display:flex;align-items:center;justify-content:center}
.not .pi img{width:22px;height:22px}
.not .tx{flex:1;display:flex;flex-direction:column;gap:2px}
.not .ap{font-size:12px;color:#44474F}
.not b{font-size:15px;font-weight:600;color:#1B1C1F}
.and .ger{display:flex;justify-content:flex-end;padding:12px 20px;font-size:14px;font-weight:600;color:#44474F}`;
  const rapidos = [['Wi-Fi', true], ['Dados móveis', true], ['Localização', true], ['Não perturbe', false]];
  const local = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1B1C1F"><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
  return pagina(`<div class="and"><div class="asb"><span>09:41</span><span><img src="${ICONE_NOTIFICACAO}" alt="">${local}4G</span></div>
<div class="rel">09:41</div><div class="dt">qui., 19 de nov.</div>
<div class="rap">${rapidos.map(([r, on]) => `<div${on ? ' class="on"' : ''}>${r}</div>`).join('')}</div>
<span class="grupo">Silenciosas</span>
<div class="not"><span class="pi"><img src="${ICONE_NOTIFICACAO}" alt=""></span><span class="tx"><span class="ap">Macuxi Campo · agora</span><b>Localização ativa no expediente</b></span>${ic('abaixo', 18, '#44474F')}</div>
<span class="ger">Gerenciar</span></div>`, css);
}

/** Perfil (apps/mobile/src/app/profile.tsx, fora das abas) com a seção Localização da T-0156: pausa de 60 min no almoço. */
function pausa() {
  const css = `
.who{display:flex;gap:14px;align-items:center}
.who .av{width:56px;height:56px;border-radius:28px;background:${COR.ink};color:#fff;font-size:18px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
.who div{display:flex;flex-direction:column;gap:2px;min-width:0}
.who b{font-size:22px;font-weight:700;line-height:28px}
.who span{font-size:14px;color:${COR.ink2}}.who small{font-size:12px;color:${COR.ink2}}
.sec{display:flex;flex-direction:column;gap:8px}
.h2s{font-size:18px;font-weight:700}
.cx{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.lin{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 14px}
.lin+.lin,.bx+.lin{border-top:1px solid ${COR.lineSoft}}
.lin.at{min-height:48px}
.lin b{flex:1;font-size:16px;font-weight:600}
.bx{padding:4px 14px 12px}
.ult{display:flex;justify-content:space-between;align-items:center;padding:14px;font-size:14px;color:${COR.ink2}}
.ult b{font-size:16px;font-weight:600;color:${COR.ink}}`;
  return tela({
    hora: '12:32',
    estilo: css,
    cab: cabecalho({ titulo: 'Perfil', voltar: 'Início', semSino: true }),
    corpo: [
      `<div class="who"><span class="av">CL</span><div><b>${VENDEDORA.nome}</b><span>Vendedor de campo · Equipe Norte · alçada 5%</span><small>carla.lima@distnorte.com.br · ${EMPRESA}</small></div></div>`,
      `<div class="sec"><span class="h2s">Localização</span><div class="cx"><div class="lin">${ic('pin', 20, COR.accent)}<b>Volta em 42 min</b><span class="badge t-av" style="min-height:28px">Pausada</span></div><div class="bx"><span class="bt sec">Retomar</span></div><div class="lin at">${ic('map', 20, COR.accent)}<b>Meu trajeto</b>${ic('chevron', 16, COR.ink2)}</div><div class="lin at">${ic('file', 20, COR.accent)}<b>Termo de ciência</b>${ic('chevron', 16, COR.ink2)}</div></div></div>`,
      `<div class="sec"><span class="h2s">Conta</span><div class="cx"><div class="lin at">${ic('lock', 20, COR.accent)}<b>Trocar senha</b>${ic('chevron', 16, COR.ink2)}</div></div></div>`,
      `<div class="sec"><span class="h2s">Sincronização</span><div class="cx"><div class="ult"><span>Última sincronização</span><b>hoje às 12:10</b></div></div></div>`,
    ].join(''),
  });
}

/** "Meu trajeto" de hoje no fim do expediente: distância, início, a pausa tracejada e o último ponto. */
function meuTrajeto() {
  const css = `
.dia{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dia .seta{width:48px;height:48px;border-radius:12px;background:#fff;border:1px solid ${COR.line};display:flex;align-items:center;justify-content:center}
.dia .seta.off{background:${COR.ground}}
.dia b{font-size:16px;font-weight:600;text-align:center;flex:1}
.mapa{height:220px;border-radius:18px;overflow:hidden;background:${COR.neutralBg};border:1px solid ${COR.lineStrong};position:relative}
.mapa svg{position:absolute;inset:0}
.cx{background:#fff;border:1px solid ${COR.line};border-radius:14px;overflow:hidden}
.km{display:flex;justify-content:space-between;align-items:baseline;padding:12px;border-bottom:1px solid ${COR.lineSoft}}
.km span{font-size:14px;color:${COR.ink2}}.km b{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.ev{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;font-size:16px}
.ev+.ev{border-top:1px solid ${COR.lineSoft}}
.ev span{flex:1}.ev em{font-style:normal;font-variant-numeric:tabular-nums;font-weight:600}`;
  const M = {
    inicio: `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#fff" stroke="${COR.accent}" stroke-width="3"/></svg>`,
    agora: `<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8.5" fill="${COR.accentSoft}"/><circle cx="9" cy="9" r="5" fill="${COR.accent}"/></svg>`,
    pausa: `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 9h16" stroke="${COR.ink3}" stroke-width="3" stroke-dasharray="3 3"/></svg>`,
  };
  const ruas = '<path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke="#fff" stroke-width="10" fill="none"/><path d="M40 -10 C60 70 30 140 70 230" stroke="#fff" stroke-width="8" fill="none"/><path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke="#fff" stroke-width="8" fill="none"/><path d="M250 -10 C240 60 280 120 250 230" stroke="#fff" stroke-width="6" fill="none"/><path d="M150 -10 L170 230" stroke="#fff" stroke-width="5" fill="none"/>';
  const linha = (pts) => `<polyline points="${pts}" stroke="${COR.accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const desenho =
    linha('40,112 100,72 162,62 226,46') +
    `<polyline points="226,46 282,82" stroke="${COR.ink3}" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round" fill="none"/>` +
    linha('282,82 292,134 226,150 180,176') +
    `<circle cx="40" cy="112" r="7" fill="#fff" stroke="${COR.accent}" stroke-width="3"/><circle cx="180" cy="176" r="12" fill="${COR.accentSoft}"/><circle cx="180" cy="176" r="6" fill="${COR.accent}"/>`;
  return tela({
    hora: '17:45',
    estilo: css,
    cab: cabecalho({ titulo: 'Meu trajeto', voltar: 'Perfil', semSino: true }),
    corpo: [
      `<div class="dia"><span class="seta">${ic('back', 22, COR.accent)}</span><b>Hoje · qui 19/11</b><span class="seta off">${ic('chevron', 22, COR.lineStrong)}</span></div>`,
      `<div class="mapa"><svg width="320" height="220" viewBox="0 0 350 220" preserveAspectRatio="none">${ruas}</svg><svg width="320" height="220">${desenho}</svg></div>`,
      `<div class="cx"><div class="km"><span>Até agora</span><b>41,6 km</b></div><div class="ev">${M.inicio}<span>Início</span><em>08:04</em></div><div class="ev">${M.pausa}<span>Pausa</span><em>12:14–13:14</em></div><div class="ev">${M.agora}<span>Último ponto</span><em>17:40</em></div></div>`,
    ].join(''),
  });
}

export const TELAS_RASTREAMENTO = {
  '26-rastreamento-termo': termo(),
  '27-rastreamento-notificacao': notificacao(),
  '28-rastreamento-pausa': pausa(),
  '29-rastreamento-meu-trajeto': meuTrajeto(),
};
