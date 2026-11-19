// Simulação da T-0156 (tracking no expediente, desenho docs/desenho/tracking.md §11 item 5): tela do termo de ciência,
// pausa no Perfil, "Meu trajeto" e notificação fixa do Android no Campo. Gera os HTMLs e os PNGs desta pasta.
// Uso, a partir da raiz do repositório: node docs/design/tracking/gerar.mjs
// Mesmo aparelho (360×760) e mesma conferência de sobreposição de docs/design/pedido-aprovacao/gerar.mjs.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { abrirNavegador } from '../_comum/navegador.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

// Cores: packages/ui/src/mobile/tokens.ts (marca v1). Fonte do sistema; escala 12 · 14 · 16 · 18 · 22 · 28.
const CSS = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#ECEEF1;color:#16202A;display:flex;gap:28px;padding:28px;align-items:flex-start;width:max-content}
.col{display:flex;flex-direction:column;gap:10px;width:360px}
.leg{font-size:14px;font-weight:600;min-height:40px}
.tel{width:360px;height:760px;background:#F8F6F1;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;position:relative;box-shadow:0 0 0 1px #C9CED5}
.st{height:24px;flex:none;background:#1E3350;color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 16px}
.st .ic{display:flex;gap:6px;align-items:center}
.fx{flex:none;background:#1E3350;padding:6px 20px 14px;display:flex;flex-direction:column;gap:2px}
.fx .v{color:#C9CED5;font-size:14px;min-height:20px}.fx h1{color:#fff;font-size:22px;font-weight:700;line-height:28px}.fx .s{color:#C9CED5;font-size:14px}
.corpo{flex:1;min-height:0;padding:14px 20px;display:flex;flex-direction:column;gap:14px;overflow:hidden;position:relative}
.corpo.rola{gap:12px}
.corpo.fim{justify-content:flex-end}
.corpo.rola:not(.fim)::after{content:'';position:absolute;left:0;right:0;bottom:0;height:28px;background:linear-gradient(rgba(248,246,241,0),#F8F6F1)}
.rolagem{position:absolute;right:3px;width:4px;height:120px;border-radius:2px;background:#C9CED5}
.tit{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#4A5562}
.tit.al{color:#A8261B}
.sec{display:flex;flex-direction:column;gap:8px}
.cx{background:#fff;border:1px solid #DFE2E6;border-radius:14px}
.who{display:flex;gap:12px;align-items:center}
.av{width:48px;height:48px;flex:none;border-radius:24px;background:#ECEEF1;color:#1E3350;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center}
.who b{font-size:18px;font-weight:700;display:block}.who span{font-size:14px;color:#4A5562}
.lin{display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 12px;border-bottom:1px solid #ECEEF1}
.lin:last-child{border-bottom:0}
.lin .tx{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.lin .tx b{font-size:16px;font-weight:600}
.lin .tx small{font-size:14px;color:#4A5562}
.lin svg{flex:none}
.lin.at{min-height:48px}
.acao{font-size:14px;font-weight:600;color:#1E3350;min-height:44px;min-width:48px;display:inline-flex;align-items:center;justify-content:flex-end}
.al-l{display:flex;gap:10px;align-items:center;min-height:48px;padding:0 12px;font-size:14px}
.al-l span:not(.acao){flex:1}
.al-l svg{color:#A8261B;flex:none}
.ce{height:28px;flex:none;border-radius:999px;padding:0 10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;white-space:nowrap}
.ce.ok{background:#E2F1EA;color:#1D6B4F}.ce.pa{background:#FFF1D6;color:#5C3B00}.ce.ne{background:#ECEEF1;color:#34404D}
.bx{padding:4px 12px 12px;border-bottom:1px solid #ECEEF1}
.b2{height:44px;border-radius:12px;border:1.5px solid #16202A;background:#fff;color:#16202A;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px}
.bt{height:52px;flex:none;border-radius:14px;background:#1E3350;color:#fff;font-size:16px;font-weight:600;display:flex;align-items:center;justify-content:center}
.bt.off{background:#ECEEF1;color:#5B6673}
.bn{height:44px;flex:none;border-radius:12px;background:#ECEEF1;color:#16202A;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center}
.rod{flex:none;padding:12px 20px 16px;background:#fff;border-top:1px solid #DFE2E6;display:flex;flex-direction:column;gap:8px}
.termo p,.termo li{font-size:16px;line-height:24px}
.termo ul{display:flex;flex-direction:column;gap:10px;padding-left:20px}
.termo a{color:#1E3350;font-weight:600;text-decoration:underline}
.aviso{position:absolute;left:12px;right:12px;bottom:12px;min-height:52px;background:#16202A;color:#fff;border-radius:14px;display:flex;align-items:center;gap:12px;padding:8px 8px 8px 14px;font-size:14px;box-shadow:0 4px 10px rgba(15,20,25,.2)}
.aviso span{flex:1}
.aviso svg{color:#7FD1A8;flex:none}
.aviso .ac{color:#F59A52;font-weight:600;height:36px;padding:0 12px;display:flex;align-items:center}
.dia{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dia .seta{width:48px;height:48px;border-radius:12px;background:#fff;border:1px solid #DFE2E6;display:flex;align-items:center;justify-content:center;color:#1E3350}
.dia .seta.off{color:#C9CED5;background:#F8F6F1}
.dia b{font-size:16px;font-weight:600;text-align:center;flex:1}
.mapa{height:220px;flex:none;border-radius:18px;overflow:hidden;background:#ECEEF1;border:1px solid #C9CED5;position:relative}
.mapa svg{position:absolute;inset:0}
.km{display:flex;justify-content:space-between;align-items:baseline;padding:12px;border-bottom:1px solid #ECEEF1}
.km span{font-size:14px;color:#4A5562}.km b{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums}
.ev{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;font-size:16px;border-bottom:1px solid #ECEEF1}
.ev:last-child{border-bottom:0}
.ev span{flex:1}.ev em{font-style:normal;font-variant-numeric:tabular-nums;font-weight:600}
.ev svg{flex:none}
.vazio{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:#4A5562;font-size:14px;padding:0 24px}
.vazio b{font-size:18px;color:#16202A}
.vazio svg{color:#5B6673}
.scrim{position:absolute;inset:0;background:rgba(15,20,25,.45)}
.folha{position:absolute;left:0;right:0;bottom:0;background:#fff;border-radius:22px 22px 0 0;padding:8px 20px 16px;display:flex;flex-direction:column;gap:14px}
.folha .pega{width:40px;height:4px;border-radius:2px;background:#C9CED5;align-self:center}
.folha .cab{display:flex;align-items:center;justify-content:space-between}
.folha h2{font-size:22px;font-weight:700}
.folha .x{width:48px;height:48px;display:flex;align-items:center;justify-content:center;color:#4A5562}
.folha label{font-size:14px;font-weight:600;color:#4A5562;display:flex;flex-direction:column;gap:6px}
.area{height:112px;border:2px solid #1E3350;border-radius:12px;background:#fff;padding:10px 12px;font-size:16px;font-weight:400;color:#16202A;line-height:24px}
.teclado{height:200px;flex:none;background:#DFE2E6;border-radius:0;margin:0 -20px -16px;display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:10px 6px}
.teclado i{background:#fff;border-radius:6px;height:40px}
/* Android: barra de notificações (tema claro do sistema; não é tela do app). */
.and{background:#F1F3F8;flex:1;display:flex;flex-direction:column}
.and .sb{height:28px;flex:none;display:flex;justify-content:space-between;align-items:center;padding:0 16px;font-size:13px;font-weight:600;color:#1B1C1F}
.and .sb .ic{display:flex;gap:6px;align-items:center}
.and .rel{padding:12px 20px 8px;font-size:28px;font-weight:400;color:#1B1C1F}
.and .rapidos{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 14px}
.and .rapidos i{height:56px;border-radius:28px;background:#DDE1EA}
.and .grupo{font-size:13px;font-weight:600;color:#44474F;padding:6px 24px}
.not{margin:0 12px;background:#fff;border-radius:20px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.not .pi{width:32px;height:32px;flex:none;border-radius:16px;background:#1E3350;display:flex;align-items:center;justify-content:center}
.not .pi img{width:22px;height:22px}
.not .txt{flex:1;display:flex;flex-direction:column;gap:2px;min-width:0}
.not .ap{font-size:12px;color:#44474F}
.not b{font-size:15px;font-weight:600;color:#1B1C1F}
.not .chev{color:#44474F;flex:none}
.and .gerir{display:flex;justify-content:flex-end;padding:12px 20px;font-size:14px;font-weight:600;color:#44474F}
.and .nada{text-align:center;font-size:14px;color:#44474F;padding:24px}
.sbi{width:14px;height:14px;display:inline-flex}
.nota{font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #C9CED5;border-radius:8px;padding:8px 12px}
</style>`;

// Ícones no traço do kit (packages/ui/src/mobile/icon.tsx).
const svg = (d, t = 20, extra = '') => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${d}</svg>`;
const I = {
  alerta: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>', 18),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 20, ' style="color:#1E3350"'),
  mapa: svg('<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', 20, ' style="color:#1E3350"'),
  arquivo: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>', 20, ' style="color:#1E3350"'),
  chev: svg('<path d="M9 6l6 6-6 6"/>', 16, ' style="color:#4A5562"'),
  esq: svg('<path d="M15 6l-6 6 6 6"/>', 22),
  dir: svg('<path d="M9 6l6 6-6 6"/>', 22),
  pausa: svg('<path d="M9 5v14M15 5v14"/>', 18),
  play: svg('<path d="M7 5l12 7-12 7z"/>', 18),
  check: svg('<path d="M5 12l5 5 9-10"/>', 18),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>', 22),
  semSinal: svg('<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0M12 19h.01"/><path d="M3 3l18 18"/>', 40),
  pinG: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', 40),
};
// Marcadores do trajeto: os mesmos desenhos no mapa e na lista (a lista é a legenda).
const M = {
  inicio: '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="6.5" fill="#fff" stroke="#1E3350" stroke-width="3"/></svg>',
  fim: '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="#1E3350"/></svg>',
  agora: '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8.5" fill="#DFE2E6"/><circle cx="9" cy="9" r="5" fill="#1E3350"/></svg>',
  pausa: '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 9h16" stroke="#5B6673" stroke-width="3" stroke-dasharray="3 3"/></svg>',
};

const st = (hora, extra = '') => `<div class="st"><span>${hora}</span><span class="ic">${extra}<span>4G</span></span></div>`;
const fx = (titulo, voltar = '', sub = '') => `<div class="fx"><span class="v">${voltar ? `‹ ${voltar}` : ''}</span><h1>${titulo}</h1>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;

// ---------- 01 · Termo ----------
// Texto: modelo de docs/desenho/T-0156-legal-termo-de-ciencia.md com os campos da empresa preenchidos (exemplo).
const termo = (linkTrajeto) => `<div class="termo sec"><p>A Distribuidora Norte registra a sua localização <b>só durante o expediente</b> (seg. a sex., 08:00 às 18:00; sáb., 08:00 às 12:00). Serve para comprovar as visitas, planejar a rota e calcular o km do dia.</p>
<ul><li>Fora do expediente, em feriado, folga, férias ou afastamento, <b>nada é registrado</b>. Quando está registrando, o Android mostra a notificação "localização ativa no expediente".</li>
<li>Veem o seu trajeto: você, o seu supervisor, o gerente da sua área e o administrador da Distribuidora Norte. Os colegas não veem.</li>
<li>O trajeto fica 90 dias. O resumo do dia (km, visitas, tempo em cliente) fica 5 anos, para metas e remuneração variável.</li>
<li>O trajeto não é usado sozinho para punição ou desligamento: sempre há revisão de uma pessoa.</li>
<li>Em ${linkTrajeto ? '<a>Meu trajeto</a>' : '"Meu trajeto"'} você vê o seu trajeto e contesta um dia. Dúvidas: fale com a pessoa responsável pelos dados na Distribuidora Norte, privacidade@distnorte.com.br.</li>
<li>A Distribuidora Norte é a responsável por estes dados. O Macuxi só os usa por ordem dela.</li></ul></div>`;
const RODAPE_TERMO = '<div class="rod"><span class="bt">Li e estou ciente</span><span class="bn">Agora não</span></div>';
const TERMO_TOPO = `<div class="tel">${st('08:02')}${fx('Localização no expediente', '', 'Termo de ciência · versão 1 · 16/11/2026')}
<div class="corpo rola">${termo(false)}<i class="rolagem" style="top:6px"></i></div>${RODAPE_TERMO}</div>`;
const TERMO_FIM = `<div class="tel">${st('08:02')}${fx('Localização no expediente', '', 'Termo de ciência · versão 1 · 16/11/2026')}
<div class="corpo rola fim">${termo(false)}<i class="rolagem" style="bottom:6px"></i></div>${RODAPE_TERMO}</div>`;
const TERMO_LEITURA = `<div class="tel">${st('10:15')}${fx('Localização no expediente', 'Perfil', 'Versão 1 · ciente em 17/11/2026 08:03')}
<div class="corpo rola fim">${termo(true)}<i class="rolagem" style="bottom:6px"></i></div></div>`;

// ---------- 02 · Perfil (seção Localização) ----------
const quem = '<div class="who"><span class="av" aria-hidden="true">CL</span><div><b>Carla Lima</b><span>Vendedor de campo · Equipe Norte</span></div></div>';
const atalhos = `<div class="lin at">${I.mapa}<span class="tx"><b>Meu trajeto</b></span>${I.chev}</div><div class="lin at">${I.arquivo}<span class="tx"><b>Termo de ciência</b></span>${I.chev}</div>`;
const local = (estado, botao = '') => `<div class="sec"><span class="tit">Localização no expediente</span><div class="cx">${estado}${botao ? `<div class="bx">${botao}</div>` : ''}${atalhos}</div></div>`;
const linhaEstado = (sub, chip) => `<div class="lin">${I.pin}<span class="tx"><b>Localização</b>${sub ? `<small>${sub}</small>` : ''}</span>${chip}</div>`;
const conta = `<div class="sec"><span class="tit">Conta</span><div class="cx"><div class="lin at"><span class="tx"><b>Trocar senha</b></span>${I.chev}</div></div></div>`;
const sinc = `<div class="sec"><span class="tit">Sincronização</span><div class="cx"><div class="lin"><span class="tx"><small>Última sincronização</small></span><b style="font-size:16px">Hoje 09:40</b></div></div></div>`;
const perfil = (hora, meio, aviso = '') => `<div class="tel">${st(hora)}${fx('Perfil', 'Início')}<div class="corpo">${quem}${meio}</div>${aviso}</div>`;
const aviso = (txt, acao = '') => `<div class="aviso" role="status">${I.check}<span>${txt}</span>${acao ? `<span class="ac">${acao}</span>` : ''}</div>`;

const P_SEM_ACEITE = perfil('08:30', `<div class="sec"><span class="tit al">Alertas</span><div class="cx"><div class="al-l">${I.alerta}<span>Termo de localização para confirmar</span><span class="acao" role="button">Ler</span></div></div></div>${conta}${sinc}`);
const P_ATIVA = perfil('09:41', local(linhaEstado('Expediente hoje 08:00–18:00', '<span class="ce ok">Ativa</span>'), `<span class="b2">${I.pausa}Pausar por 60 min</span>`) + conta + sinc);
const P_PAUSADA = perfil('09:59', local(linhaEstado('Volta em 42 min', '<span class="ce pa">Pausada</span>'), `<span class="b2">${I.play}Retomar</span>`) + conta + sinc);
const P_RETOMADA = perfil('10:05', local(linhaEstado('Expediente hoje 08:00–18:00', '<span class="ce ok">Ativa</span>'), `<span class="b2">${I.pausa}Pausar por 60 min</span>`) + conta + sinc, aviso('Localização retomada'));
const P_SEM_EXP = perfil('09:10', local(linhaEstado('', '<span class="ce ne">Sem expediente hoje</span>')) + conta + sinc);

// ---------- 03 · Meu trajeto ----------
// Mapa em SVG como a Rota de hoje (modules/core/app/telas/rota.tsx): ruas brancas no fundo Névoa, sem provedor de mapa.
const RUAS = `<path d="M-10 60 C80 40 140 90 220 70 S330 30 370 50" stroke="#fff" stroke-width="10" fill="none"/>
<path d="M40 -10 C60 70 30 140 70 230" stroke="#fff" stroke-width="8" fill="none"/>
<path d="M-10 170 C90 150 180 190 260 160 S340 140 370 150" stroke="#fff" stroke-width="8" fill="none"/>
<path d="M250 -10 C240 60 280 120 250 230" stroke="#fff" stroke-width="6" fill="none"/>
<path d="M150 -10 L170 230" stroke="#fff" stroke-width="5" fill="none"/>`;
const linha = (pts) => `<polyline points="${pts}" stroke="#1E3350" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const tracejado = (pts) => `<polyline points="${pts}" stroke="#5B6673" stroke-width="3" stroke-dasharray="6 6" stroke-linecap="round" fill="none"/>`;
const mk = (tipo, x, y) =>
  ({
    inicio: `<circle cx="${x}" cy="${y}" r="7" fill="#fff" stroke="#1E3350" stroke-width="3"/>`,
    fim: `<circle cx="${x}" cy="${y}" r="8" fill="#1E3350"/>`,
    agora: `<circle cx="${x}" cy="${y}" r="12" fill="#1E3350" fill-opacity=".18"/><circle cx="${x}" cy="${y}" r="6" fill="#1E3350"/>`,
  })[tipo];
const mapa = (rotulo, desenho) => `<div class="mapa" role="img" aria-label="${rotulo}"><svg width="320" height="220" viewBox="0 0 320 220" preserveAspectRatio="none">${RUAS}</svg><svg width="320" height="220" viewBox="0 0 320 220">${desenho}</svg></div>`;
const dia = (txt, proximo = true) => `<div class="dia"><span class="seta" role="button" aria-label="Dia anterior">${I.esq}</span><b>${txt}</b><span class="seta${proximo ? '' : ' off'}" role="button" aria-label="Próximo dia">${I.dir}</span></div>`;
const ev = (m, txt, hora) => `<div class="ev">${M[m]}<span>${txt}</span><em>${hora}</em></div>`;
const trajeto = (hora, meio, depois = '') => `<div class="tel">${st(hora)}${fx('Meu trajeto', 'Perfil')}<div class="corpo">${meio}</div>${depois}</div>`;

const T_HOJE = trajeto(
  '10:15',
  dia('Hoje · qua 19/11', false) +
    mapa(
      'Trajeto de hoje: 18,6 km até agora, início 08:04, pausa de 09:12 a 09:40, último ponto 10:12',
      linha('38,190 60,150 52,118 96,92 140,78') + tracejado('140,78 178,96') + linha('178,96 214,72 236,40 262,58 284,110') + mk('inicio', 38, 190) + mk('agora', 284, 110),
    ) +
    `<div class="cx"><div class="km"><span>Km até agora</span><b>18,6 km</b></div>${ev('inicio', 'Início', '08:04')}${ev('pausa', 'Pausa', '09:12–09:40')}${ev('agora', 'Último ponto', '10:12')}</div>`,
);
const T_ONTEM = trajeto(
  '10:16',
  dia('Ontem · ter 18/11') +
    mapa(
      'Trajeto de 18/11: 42,3 km, início 08:01, pausa de 12:02 a 12:58, fim 17:52',
      linha('30,60 70,40 120,70 150,120 120,170') + tracejado('120,170 168,182') + linha('168,182 220,160 256,120 290,150 300,196') + mk('inicio', 30, 60) + mk('fim', 300, 196),
    ) +
    `<div class="cx"><div class="km"><span>Km do dia</span><b>42,3 km</b></div>${ev('inicio', 'Início', '08:01')}${ev('pausa', 'Pausa', '12:02–12:58')}${ev('fim', 'Fim', '17:52')}</div>` +
    '<span class="b2">Contestar este dia</span>',
);
const T_CONTESTAR = trajeto(
  '10:17',
  dia('Ontem · ter 18/11') + mapa('Trajeto de 18/11', linha('30,60 70,40 120,70 150,120 120,170') + mk('inicio', 30, 60)),
  `<div class="scrim"></div><div class="folha" role="dialog" aria-label="Contestar 18/11"><i class="pega"></i><div class="cab"><h2>Contestar 18/11</h2><span class="x" role="button" aria-label="Fechar">${I.x}</span></div>
<label>O que não confere?<span class="area">Das 14:00 às 15:30 eu estava no Atacadão Norte, não na estrada.</span></label><span class="bt">Enviar</span><div class="teclado" aria-hidden="true">${'<i></i>'.repeat(30)}</div></div>`,
);
const T_NADA = trajeto('10:18', dia('dom 16/11') + `<div class="vazio">${I.pinG}<b>Nada registrado neste dia</b></div>`);
const T_SEM_SINAL = trajeto('10:19', dia('Ontem · ter 18/11') + `<div class="vazio">${I.semSinal}<b>Sem sinal</b><span>Os dias anteriores aparecem com sinal. O de hoje está no aparelho.</span></div>`);

// ---------- 04 · Notificação fixa ----------
const ICONE_NOT = '../../marca/ativos/2026-11-12-v1/icone-notificacao-96.png';
const sbIcone = `<img class="sbi" src="${ICONE_NOT}" alt="" style="filter:brightness(0)">`;
const sbLocal = '<svg class="sbi" viewBox="0 0 24 24" fill="#1B1C1F" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5.3 7 13 7 13s7-7.7 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
const android = (hora, icones, notif) => `<div class="tel"><div class="and"><div class="sb"><span>${hora}</span><span class="ic">${icones}<span>4G</span></span></div>
<div class="rel">${hora}</div><div class="rapidos" aria-hidden="true"><i></i><i></i><i></i><i></i></div>${notif}</div></div>`;
const N_ATIVA = android(
  '09:41',
  sbIcone + sbLocal,
  `<span class="grupo">Silenciosas</span><div class="not" role="listitem"><span class="pi"><img src="${ICONE_NOT}" alt=""></span><span class="txt"><span class="ap">Macuxi Campo · agora</span><b>Localização ativa no expediente</b></span><span class="chev">${svg('<path d="M6 9l6 6 6-6"/>', 18)}</span></div><span class="gerir">Gerenciar</span>`,
);
const N_PAUSADA = android('10:00', '', '<div class="nada">Nenhuma notificação</div>');

// Conferência de sobreposição (padrão de docs/design/pedido-aprovacao/gerar.mjs): a legenda e a nota não cobrem o aparelho,
// nada sai do aparelho, nada fica cortado na largura e, fora das telas com rolagem simulada (.rola), nada passa do corpo.
const CONFERIR = `<script>window.addEventListener('load',()=>{const conflitos=[];
for(const col of document.querySelectorAll('.col')){const tel=col.querySelector('.tel').getBoundingClientRect();
const sobre=[...col.querySelectorAll('.leg,.nota')].map(e=>[e.className,e.getBoundingClientRect()]);
for(const el of col.querySelectorAll('.tel *')){if(el.closest('svg')&&el.tagName!=='svg')continue;
if(el.children.length&&!el.matches('.ce,.b2,.bt,.bn,.acao,h1,h2,b,li,p,small,.ap,em'))continue;
const rola=el.closest('.rola');let r=el.getBoundingClientRect();
if(rola){const c=rola.getBoundingClientRect();const top=Math.max(r.top,c.top),bottom=Math.min(r.bottom,c.bottom);if(bottom<=top)continue;r={left:r.left,right:r.right,top,bottom,width:r.width,height:bottom-top};}
if(!r.width||!r.height)continue;const t=el.className.baseVal??el.className;const nome=t+': '+el.textContent.trim().slice(0,30);
for(const [n,s] of sobre){if(r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top)conflitos.push(n+' cobre '+nome);}
if((r.left<tel.left-1||r.right>tel.right+1||r.top<tel.top-1||r.bottom>tel.bottom+1))conflitos.push('fora do aparelho: '+nome);
const corpo=el.closest('.corpo');if(corpo&&!rola&&!el.closest('.aviso,.folha')){const c=corpo.getBoundingClientRect();if(r.bottom>c.bottom+1||r.right>c.right+1)conflitos.push('cortado no corpo: '+nome);}
if(el.scrollWidth>el.clientWidth+1&&getComputedStyle(el).overflow!=='visible')conflitos.push('cortado: '+nome);}}
document.body.dataset.info=JSON.stringify({conflitos});document.body.dataset.pronto='1';})</script>`;

const prancha = (titulo, cols) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>T-0156 · ${titulo}</title>${CSS}<body>${cols
  .map(([leg, tel, nota]) => `<div class="col"><span class="leg">${leg}</span>${tel}${nota ? `<div class="nota">${nota}</div>` : ''}</div>`)
  .join('')}${CONFERIR}</body></html>`;

const PRANCHAS = {
  '01-termo': prancha('termo de ciência', [
    ['Campo · 1ª abertura sem aceite: o termo, depois do login e da carga', TERMO_TOPO],
    ['Campo · O mesmo termo rolado até o fim; os botões ficam fixos', TERMO_FIM, '"Agora não" fecha e o app segue usável sem gravar trajeto. A tela volta na próxima abertura.'],
    ['Campo · Perfil › Termo de ciência: só leitura, "Meu trajeto" vira link', TERMO_LEITURA],
  ]),
  '02-perfil-pausa': prancha('Perfil e pausa', [
    ['Perfil · Sem aceite: só a linha em Alertas; a seção Localização não aparece', P_SEM_ACEITE],
    ['Perfil · Ativa: estado, pausa de 60 min e os dois atalhos', P_ATIVA, 'Ao tocar "Pausar por 60 min": aviso no rodapé "Localização pausada" com Desfazer.'],
    ['Perfil · Pausada: contagem até voltar sozinha e "Retomar"', P_PAUSADA],
    ['Perfil · Retomada: volta ao estado ativo, com o aviso no rodapé', P_RETOMADA],
    ['Perfil · Sem expediente hoje (domingo, feriado ou ausência): sem pausa', P_SEM_EXP],
  ]),
  '03-meu-trajeto': prancha('Meu trajeto', [
    ['Meu trajeto · Hoje: km até agora, com a pausa tracejada', T_HOJE],
    ['Meu trajeto · Dia anterior: km do dia, início, pausa e fim (P1 A: Contestar)', T_ONTEM],
    ['Meu trajeto · Contestar (P1 A): folha com o texto livre', T_CONTESTAR],
    ['Meu trajeto · Dia sem registro', T_NADA],
    ['Meu trajeto · Sem sinal num dia anterior; hoje abre normal', T_SEM_SINAL],
  ]),
  '04-notificacao': prancha('notificação fixa', [
    ['Android · Expediente com localização ativa: a fixa em "Silenciosas"', N_ATIVA, 'Canal "Localização no expediente", prioridade baixa, sem som e sem ação. Ícone monocromático da marca; o sistema pinta.'],
    ['Android · Pausada, fora do expediente ou sem aceite: a notificação some', N_PAUSADA],
  ]),
};

const browser = await abrirNavegador();
let falhou = false;
for (const [nome, html] of Object.entries(PRANCHAS)) {
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  const page = await browser.newPage({ viewport: { width: 800, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(arq).href);
  await page.waitForSelector('body[data-pronto="1"]');
  const info = JSON.parse(await page.evaluate(() => document.body.dataset.info));
  if (info.conflitos.length) falhou = true;
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  console.log(nome, JSON.stringify({ conflitos: info.conflitos }));
  await page.close();
}
await browser.close();
if (falhou) process.exit(1);
