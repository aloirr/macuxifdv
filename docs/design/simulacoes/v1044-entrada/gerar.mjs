// Simulação da entrada sem a empresa (T-0209) com o rodapé legal (T-0204). designer-ux, 28/11/2026.
// Spec: docs/design/v1044-entrada-sem-empresa.md. Tokens iguais a docs/design/telas/telas.css (packages/ui, marca v1).
// Uso: node docs/design/simulacoes/v1044-entrada/gerar.mjs. Fonte do sistema (manual da marca §5); para o print representar o
// Android, rode com a Roboto instalada. Saída: os PNGs nesta pasta (escala 2). Só dados fictícios.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..', '..', '..', '..');
const LOGO = readFileSync(join(RAIZ, 'docs/marca/ativos/2026-11-12-v1/macuxi-logo-negativo-azul-noite.svg'), 'utf8');

// ------------------------------------------------------------------------------------------------- textos (fonte única)
const ANO = 2026;
export const T = {
  entrar: 'Entrar',
  email: 'E-mail',
  senha: 'Senha',
  esqueci: 'Esqueci a senha',
  enviar: 'Enviar instruções',
  voltar: 'Voltar ao login',
  credenciais: 'E-mail ou senha inválidos.',
  suspensa: 'Sua empresa está suspensa. Fale com o administrador da Macuxi.',
  enviado: 'Se o e-mail estiver cadastrado, enviamos as instruções.',
  naoChegou: 'Não chegou? Confira o spam ou fale com o administrador da sua empresa.',
  emUso: 'Este e-mail já está em uso em outra empresa. Use outro e-mail.',
  bkoOrienta: 'Vendedores e promotores usam o app Macuxi Campo; supervisores, o Macuxi Gestão.',
  rodape: { copia: `© ${ANO} Macuxi`, termos: 'Termos de uso', privacidade: 'Política de privacidade' },
};
const EMAIL = 'ana.souza@exemplo.com.br';

// ------------------------------------------------------------------------------------------------------------- ícones
const ic = {
  olho: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  alerta: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
  enviar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
};

const CSS = `
:root{--ground:#F8F6F1;--surface:#FFFFFF;--ink:#16202A;--ink2:#4A5562;--ink3:#5B6673;--line:#DFE2E6;--lineStrong:#7A8593;--field:#7A8593;
--accent:#1E3350;--accentInk:#1E3350;--accentSoft:#DFE2E6;--faixa:#1E3350;--faixaTexto:#C9CED5;
--danger:#A8261B;--dangerBg:#FDE8E6;--warningInk:#7A4F00;--warningBg:#FFF1D6;}
*{box-sizing:border-box}
html,body{margin:0;background:var(--ground);color:var(--ink);font-family:system-ui,"Segoe UI",Roboto,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.pagina{min-height:100vh;display:flex;flex-direction:column}
h1{margin:0;font-weight:700;color:var(--ink)}
/* ---------- app (Campo e Gestão) */
.app-status{height:24px;background:var(--faixa);color:#fff;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;padding:0 20px}
.app-faixa{background:var(--faixa);padding:28px 24px;display:flex;align-items:center;gap:14px}
/* área de proteção (manual §2.3): logo a 44 px, "M" ~27 px; folga logo→divisor de 28 px (14 do gap + 14 da margem) */
.app-faixa svg.logo{height:44px;width:auto;display:block;margin-right:14px}
.app-faixa .sep{width:1px;height:28px;background:rgba(201,206,213,.4)}
.app-faixa .area{font-weight:700;font-size:18px;color:var(--faixaTexto)}
.app-corpo{flex:1;width:100%;max-width:440px;margin:0 auto;padding:36px 20px 16px;display:flex;flex-direction:column;gap:16px}
.app-corpo h1{font-size:28px;letter-spacing:-.3px}
.app-corpo h1.menor{font-size:22px;line-height:28px}
.campo{display:flex;flex-direction:column;gap:6px}
.campo .rot{font-size:14px;font-weight:600;color:var(--ink)}
.campo .inp{height:52px;border:1px solid var(--lineStrong);border-radius:12px;background:var(--surface);display:flex;align-items:center;padding:0 14px;font-size:16px;color:var(--ink)}
.campo .inp.vazio{color:var(--ink3)}
.campo .inp.erro{border-color:var(--danger);border-width:2px}
.campo .inp .olho{margin-left:auto;width:44px;height:44px;margin-right:-10px;display:flex;align-items:center;justify-content:center;color:var(--ink2)}
.campo .msg{font-size:12px;color:var(--danger)}
.banner{display:flex;gap:8px;align-items:flex-start;padding:12px;border-radius:12px;font-size:14px;line-height:20px;font-weight:500}
.banner svg{flex:none;margin-top:1px}
.banner.perigo{background:var(--dangerBg);color:var(--danger)}
.banner.atencao{background:var(--warningBg);color:var(--warningInk)}
.banner.info{background:var(--accentSoft);color:var(--accentInk)}
.btn{height:52px;border-radius:14px;background:var(--accent);color:#fff;font-weight:600;font-size:16px;display:flex;align-items:center;justify-content:center}
.link{min-height:48px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--accentInk)}
.pequeno{font-size:12px;line-height:17px;color:var(--ink2)}
.mola{flex:1}
/* rodapé legal (T-0204): uma linha, 12 px, links com alvo de 44 px */
.rodape-legal{display:flex;justify-content:center;align-items:center;flex-wrap:wrap;gap:0 6px;font-size:12px;color:var(--ink2);min-height:44px}
.rodape-legal a{color:var(--accentInk);font-weight:600;text-decoration:none;min-height:44px;display:inline-flex;align-items:center;padding:0 2px}
.rodape-legal .p{color:var(--ink3)}
.app-rodape{padding:0 20px 18px;max-width:440px;margin:0 auto;width:100%}
/* ---------- web (BKO e config.) */
.web{padding:64px 16px 0;display:flex;flex-direction:column;align-items:center;flex:1}
.web.estreito{padding-top:40px}
.web .col{width:100%;max-width:400px;display:flex;flex-direction:column;gap:20px}
.web .col.portal{max-width:440px}
.marca{display:flex;align-items:center;gap:14px;background:var(--faixa);border-radius:12px;padding:14px}
.marca svg.logo{width:104px;height:auto;display:block}
.marca .sep{width:1px;height:24px;background:rgba(201,206,213,.4)}
.marca .area{font-size:15px;font-weight:700;color:var(--faixaTexto)}
.cartao{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:20px}
.form{display:flex;flex-direction:column;gap:20px}
.cartao .form{gap:16px}
.web h1{font-size:24px}
.web .campo{gap:4px}
.web .campo .rot{font-size:13px}
.web .campo .inp{height:44px;border-color:var(--field);font-size:15px;padding:0 12px}
.web .campo .inp .olho{width:40px;height:40px;margin-right:-8px}
.web .banner{border-radius:10px;padding:10px 12px;font-size:15px;line-height:21px;font-weight:400}
.web .btn{height:42px;border-radius:12px;font-size:15px}
.web .link{min-height:44px;justify-content:flex-start;font-size:15px;font-weight:600}
.web .grupo{display:flex;flex-direction:column;gap:4px}
.web-rodape{padding:24px 16px 12px}
/* ---------- cadastro (fragmento do Novo usuário) */
.cad h2{margin:0;font-size:20px;font-weight:700}
.cad .linha{display:flex;gap:16px}
.cad .linha>*{flex:1}
.cad .acoes{display:flex;gap:12px;justify-content:flex-end}
.cad .sec{height:42px;border-radius:12px;border:1px solid var(--field);background:#fff;padding:0 16px;display:flex;align-items:center;font-weight:600;font-size:15px}
.cad .btn{padding:0 18px;height:42px;border-radius:12px;font-size:15px}
.cad-moldura{flex:1;display:flex;flex-direction:column}
.cad-topo{height:56px;background:var(--faixa);display:flex;align-items:center;padding:0 24px;gap:14px}
.cad-topo svg.logo{width:96px;height:auto}
.cad-corpo{padding:32px 24px;display:flex;justify-content:center}
.cad-corpo .cartao{width:100%;max-width:640px;display:flex;flex-direction:column;gap:16px}
`;

const logo = LOGO.replace('<svg ', '<svg class="logo" ');

// ------------------------------------------------------------------------------------------------------------ peças
const campo = (rotulo, valor, { senha = false, erro = null } = {}) => `
  <div class="campo"><span class="rot">${rotulo}</span>
    <div class="inp${valor ? '' : ' vazio'}${erro ? ' erro' : ''}">${senha ? (valor ? '••••••••' : '') : valor}${senha ? `<span class="olho" aria-label="Mostrar senha">${ic.olho}</span>` : ''}</div>
    ${erro ? `<span class="msg">${erro.replace(/e-mail/g, 'e\u2011mail')}</span>` : ''}
  </div>`;
const banner = (tom, texto) => `<div class="banner ${tom}">${tom === 'info' ? ic.enviar : ic.alerta}<span>${texto}</span></div>`;
const rodapeLegal = () =>
  `<div class="rodape-legal"><span>${T.rodape.copia}</span><span class="p">·</span><a>${T.rodape.termos}</a><span class="p">·</span><a>${T.rodape.privacidade}</a></div>`;

// app: Campo e Gestão
function app(area, corpo, { comRodape = false } = {}) {
  return `<div class="pagina">
    <div class="app-status"><span>9:41</span><span>4G ▮▮▮ 82%</span></div>
    <div class="app-faixa">${logo}<span class="sep"></span><span class="area">${area}</span></div>
    <div class="app-corpo">${corpo}</div>
    ${comRodape ? `<div class="app-rodape">${rodapeLegal()}</div>` : ''}
  </div>`;
}
const appEntrar = (area, { email = '', senha = '', aviso = null } = {}) =>
  app(
    area,
    `<h1>${T.entrar}</h1>
     ${campo(T.email, email)}
     ${campo(T.senha, senha, { senha: true })}
     ${aviso ? banner(aviso[0], aviso[1]) : ''}
     <div class="btn">${T.entrar}</div>
     <div class="link">${T.esqueci}</div>`,
    { comRodape: true },
  );
const appEsqueci = (area, enviado) =>
  app(
    area,
    enviado
      ? `<h1 class="menor">${T.esqueci}</h1>${banner('info', T.enviado)}<span class="pequeno">${T.naoChegou}</span><div class="btn">${T.voltar}</div>`
      : `<h1 class="menor">${T.esqueci}</h1>${campo(T.email, EMAIL)}<div class="btn">${T.enviar}</div><div class="link">${T.voltar}</div>`,
  );

// web: BKO (sem cartão) e config. (com cartão)
function web(area, corpo, { portal = false, comRodape = true, estreito = false } = {}) {
  const miolo = portal ? `<div class="cartao">${corpo}</div>` : corpo;
  return `<div class="pagina">
    <div class="web${estreito ? ' estreito' : ''}"><div class="col${portal ? ' portal' : ''}">
      <div class="marca">${logo}<span class="sep"></span><span class="area">${area}</span></div>
      ${miolo}
    </div></div>
    ${comRodape ? `<div class="web-rodape">${rodapeLegal()}</div>` : ''}
  </div>`;
}
const webEntrar = (area, { portal = false, email = '', senha = '', aviso = null, estreito = false } = {}) =>
  web(
    area,
    `<div class="form">
      <h1>${T.entrar}</h1>
      ${aviso ? banner(aviso[0], aviso[1]) : ''}
      ${campo(T.email, email)}
      ${campo(T.senha, senha, { senha: true })}
      <div class="grupo"><div class="btn">${T.entrar}</div><div class="link">${T.esqueci}</div></div>
      ${portal ? '' : `<span class="pequeno">${T.bkoOrienta}</span>`}
    </div>`,
    { portal, estreito },
  );
const webEsqueci = (enviado, estreito) =>
  web(
    'Backoffice',
    enviado
      ? `<div class="form"><h1>${T.esqueci}</h1>${banner('info', T.enviado)}<span class="pequeno">${T.naoChegou}</span><div class="btn">${T.voltar}</div></div>`
      : `<div class="form"><h1>${T.esqueci}</h1>${campo(T.email, EMAIL)}<div class="grupo"><div class="btn">${T.enviar}</div><div class="link">${T.voltar}</div></div></div>`,
    { comRodape: false, estreito },
  );
const cadastro = (estreito) => `<div class="pagina cad-moldura cad">
  <div class="cad-topo">${logo}</div>
  <div class="cad-corpo" style="${estreito ? 'padding:20px 16px' : ''}"><div class="cartao">
    <h2>Novo usuário</h2>
    <div class="linha" style="${estreito ? 'flex-direction:column' : ''}">${campo('Nome', 'Ana Souza')}${campo('Perfil', 'Vendedor')}</div>
    ${campo(T.email, EMAIL, { erro: T.emUso })}
    <div class="acoes"><div class="sec">Cancelar</div><div class="btn">Salvar</div></div>
  </div></div></div>`;

// ------------------------------------------------------------------------------------------------------------- telas
const M = { w: 390, h: 844 };
const D = { w: 1366, h: 768 };
const err = ['perigo', T.credenciais];
const susp = ['atencao', T.suspensa];
export const TELAS = [
  ['campo-entrar-390', M, appEntrar('Campo')],
  ['campo-entrar-1366', D, appEntrar('Campo')],
  ['gestao-entrar-390', M, appEntrar('Gestão')],
  ['gestao-entrar-1366', D, appEntrar('Gestão')],
  ['bko-entrar-390', M, webEntrar('Backoffice', { estreito: true })],
  ['bko-entrar-1366', D, webEntrar('Backoffice')],
  ['config-entrar-390', M, webEntrar('Portal de implantação', { portal: true, estreito: true })],
  ['config-entrar-1366', D, webEntrar('Portal de implantação', { portal: true })],
  ['campo-esqueci-390', M, appEsqueci('Campo', false)],
  ['campo-esqueci-enviado-390', M, appEsqueci('Campo', true)],
  ['bko-esqueci-1366', D, webEsqueci(false)],
  ['bko-esqueci-enviado-1366', D, webEsqueci(true)],
  ['campo-erro-credenciais-390', M, appEntrar('Campo', { email: EMAIL, aviso: err })],
  ['campo-empresa-suspensa-390', M, appEntrar('Campo', { email: EMAIL, aviso: susp })],
  ['bko-erro-credenciais-1366', D, webEntrar('Backoffice', { email: EMAIL, aviso: err })],
  ['bko-empresa-suspensa-1366', D, webEntrar('Backoffice', { email: EMAIL, aviso: susp })],
  ['cadastro-email-em-uso-390', M, cadastro(true)],
  ['cadastro-email-em-uso-1366', D, cadastro(false)],
];

const pagina = (corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${CSS}</style></head><body>${corpo}</body></html>`;

if (process.argv[2] !== '--so-html') {
  const navegador = await chromium.launch();
  for (const [nome, tam, corpo] of TELAS) {
    const ctx = await navegador.newContext({ viewport: { width: tam.w, height: tam.h }, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    await p.setContent(pagina(corpo), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(AQUI, `${nome}.png`) });
    await ctx.close();
    console.log(nome);
  }
  await navegador.close();
}
