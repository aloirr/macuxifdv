// Simulação de Parâmetros › Alertas e dos alertas de produtividade (pedido do Alexandre R-20261115-112500, 15/11/2026).
// Gera os HTMLs e os PNGs desta pasta. Uso, a partir da raiz do repositório: node docs/design/alertas-parametros/gerar.mjs
// Base visual: docs/design/menu-parametros/gerar.mjs (branch nuvem/menu-parametros-designer-ux). Dados fictícios.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const MARCA = '../../marca/ativos/2026-11-12-v1';
const LOGO = `${MARCA}/macuxi-logo-negativo-grafite.svg`;

// Menu final de docs/design/menu-parametros/spec.md §2 (D1, D4, D9, D11; perfil Administrador, módulos licenciados).
// `null` = item direto (sem sanfona). Parâmetros é uma página só, com a lista de seções à esquerda (D3/D10).
const MENU = [
  ['Acesso', ['Aparelhos', 'Usuários']],
  ['Análise', ['Indicadores', 'Metas', 'Painel da equipe', 'Ranking']],
  ['Cadastros', ['Carteira', 'Clientes', 'Coordenadas sugeridas', 'Filiais', 'Formas de pagamento e prazos', 'Transportadoras']],
  ['Comunicação', ['Alertas', 'Recados']],
  ['Operação', ['Aprovações', 'Pedidos', 'Rotas', 'Visitas']],
  ['Pesquisa', null],
  ['Produtos', ['Catálogo', 'Marcas concorrentes', 'Preço e custo', 'Tabelas de preço']],
  ['Trade', ['Cadastros', 'Indicadores']],
  ['Treinamento', null],
  ['Parâmetros', null],
  ['Sistema', ['Auditoria', 'Carga por arquivo', 'Integração ERP']],
];
const SECOES = ['Acesso', 'Alertas', 'Calendário', 'Clientes', 'Início', 'Metas e RV', 'Pedidos', 'Pesquisa', 'Produtos', 'Trade', 'Treinamento', 'Visitas'];

const seta = (aberto) =>
  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${aberto ? 90 : 0}deg)"><path d="M9 6l6 6-6 6"/></svg>`;
const pontos = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;
const chevron = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
const xis = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const visto = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>`;

function menu(grupoAberto, ativo) {
  const grupos = MENU.map(([g, itens]) => {
    if (!itens) return `<div class="grupo"><a class="titulo direto${g === grupoAberto ? ' ativo' : ''}"${g === grupoAberto ? ' aria-current="page"' : ''}><span>${g}</span></a></div>`;
    const aberto = g === grupoAberto;
    const lista = aberto ? itens.map((i) => `<a class="item${i === ativo ? ' ativo' : ''}">${i}</a>`).join('') : '';
    return `<div class="grupo"><div class="titulo${aberto ? ' aberto' : ''}"><span>${g}</span>${seta(aberto)}</div>${lista}</div>`;
  }).join('');
  return `<nav class="menu"><div class="brand"><img src="${LOGO}" height="28" alt="Macuxi Força de Vendas"><span>Distribuidora Exemplo</span></div><div class="lista">${grupos}</div><div class="rodape"><b>Ana Souza</b><span>Administrador</span><div class="sair">↪ Trocar perfil</div></div></nav>`;
}
/** Lista de seções da página Parâmetros (200 px, ordem alfabética). */
const secoes = (ativa) => `<nav class="secoes" aria-label="Seções de Parâmetros">${SECOES.map((s) => `<a class="sec${s === ativa ? ' ativo' : ''}"${s === ativa ? ' aria-current="page"' : ''}>${s}</a>`).join('')}</nav>`;

// Cores: só os tokens de apps/web/app/globals.css e packages/ui/src/mobile/tokens.ts (nenhuma cor nova).
const CSS = `
*{box-sizing:border-box;margin:0}
body{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;background:#F8F6F1;color:#16202A;width:1366px;min-height:768px;display:flex;position:relative}
.menu{width:240px;min-height:768px;background:#16202A;color:#fff;display:flex;flex-direction:column;padding:20px 12px 16px;flex-shrink:0}
.brand{display:flex;flex-direction:column;align-items:flex-start;padding:0 8px 16px}
.brand img{display:block;height:28px;width:auto}
.brand span{font-size:12px;line-height:16px;color:#C9CED5;margin-top:18px}
.lista{display:flex;flex-direction:column;gap:2px}
.titulo{display:flex;justify-content:space-between;align-items:center;height:30px;padding:0 10px;border-radius:8px;color:#F59A52;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase}
.item{display:flex;align-items:center;height:32px;padding:0 10px 0 20px;border-radius:8px;font-size:15px;color:#C9CED5;white-space:nowrap;position:relative}
.item.ativo{background:#2B3743;color:#fff;font-weight:600}
.item.ativo:before{content:'';position:absolute;left:8px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#F59A52}
.rodape{margin-top:auto;border-top:1px solid #2B3743;padding:12px 8px 0;display:flex;flex-direction:column}
.rodape b{font-size:15px}.rodape span{font-size:12px;color:#C9CED5}.sair{font-size:13px;font-weight:600;color:#C9CED5;margin-top:8px}
main{flex:1;min-width:0;padding:28px 32px 120px;display:flex;flex-direction:column;gap:20px}
.titulo.direto{text-decoration:none}
.titulo.direto.ativo{background:#2B3743;color:#fff}
.par{display:grid;grid-template-columns:200px minmax(0,1fr);gap:24px;align-items:start}
.secoes{display:flex;flex-direction:column;gap:2px;position:sticky;top:0}
.sec{display:flex;align-items:center;height:36px;padding:0 12px;border-radius:8px;font-size:15px;color:#34404D;position:relative}
.sec.ativo{background:#fff;color:#16202A;font-weight:600;box-shadow:inset 0 0 0 1px #DFE2E6}
.sec.ativo:before{content:'';position:absolute;left:4px;top:8px;bottom:8px;width:3px;border-radius:2px;background:#1E3350}
.conteudo{display:flex;flex-direction:column;gap:20px;min-width:0}
.cab{display:flex;flex-direction:column;gap:2px;min-height:42px;justify-content:center}
.cab.linha{flex-direction:row;align-items:center;justify-content:space-between}
.eyebrow{font-size:13px;color:#4A5562}
h1{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:24px;line-height:1.2}
h2{font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:17px}
.quadro{background:#fff;border:1px solid #DFE2E6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.quadro .topo{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}
.btn{height:44px;border-radius:10px;padding:0 18px;font-size:15px;font-weight:600;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.btn.p{background:#1E3350;color:#fff}
.btn.s{border:1px solid #C9CED5;background:#fff;color:#16202A}
.btn.d{background:#8B96A3;color:#fff}
.selo{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.ok{color:#1D6B4F;background:#E2F1EA}.ne{color:#34404D;background:#ECEEF1}.av{color:#7A4F00;background:#FFF1D6}.cr{color:#A8261B;background:#FDE8E6}
/* regra: uma linha por regra */
.regras{display:flex;flex-direction:column;gap:8px}
.regra{display:grid;gap:14px;align-items:end;padding:10px 14px;border:1px solid #ECEEF1;border-radius:12px}
.equipe .regra{grid-template-columns:minmax(0,1fr) 128px 84px;grid-template-areas:'cab cab cab' 'campos sev salvar'}
.prod .regra{grid-template-columns:minmax(0,1fr) 84px;grid-template-areas:'cab cab' 'campos salvar'}
.regra.off{background:#F8F6F1}
.regra.alterada{border-color:#1E3350}
.cabr{grid-area:cab;display:flex;align-items:center;gap:12px}
.regra>.campos{grid-area:campos;flex-wrap:wrap;row-gap:10px}
.regra>.f{grid-area:sev}
.regra>.salvar{grid-area:salvar}
.chave,.nome{align-self:center}
.nome{display:flex;flex-direction:column;gap:2px;min-width:0}
.nome b{font-size:15px;font-weight:600;line-height:20px}
.nome small{font-size:13px;line-height:17px;color:#4A5562}
.campos{display:flex;gap:12px;align-items:flex-end;min-width:0}
.sep{width:1px;align-self:stretch;background:#ECEEF1;margin:0 2px}
.f{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;white-space:nowrap;color:#16202A}
.input{height:44px;min-width:104px;border:1px solid #C9CED5;border-radius:10px;background:#fff;font-size:15px;font-weight:500;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;font-variant-numeric:tabular-nums;white-space:nowrap}
.input.editado{border:2px solid #1E3350}
.input.leitura{background:#F8F6F1;border-color:#DFE2E6}
.input i{font-style:normal;font-size:13px;font-weight:400;color:#4A5562}
.input.sel{color:#16202A}
.salvar{align-self:end}
.salvar .btn{width:84px;padding:0}
/* interruptor do kit (packages/ui/src/web/permissoes.tsx): trilho 40x24, ligado bg-ink, desligado bg-disabled */
.sw{display:inline-flex;align-items:center;gap:8px;height:44px;font-size:13px;font-weight:600;white-space:nowrap}
.trilho{position:relative;width:40px;height:24px;border-radius:999px;background:#8B96A3;flex-shrink:0}
.trilho:after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(22,32,42,.3)}
.sw.on .trilho{background:#16202A}.sw.on .trilho:after{left:19px}
.sw.trava .trilho{opacity:.5}
.nota{position:absolute;right:20px;bottom:16px;max-width:620px;font-size:12px;line-height:1.5;color:#34404D;background:#fff;border:1px solid #DFE2E6;border-left:4px solid #1D6B4F;border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(22,32,42,.08);z-index:9}
table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
th{text-align:left;font-size:13px;font-weight:600;color:#4A5562;padding:8px 10px;border-bottom:1px solid #DFE2E6;white-space:nowrap}
td{padding:0 10px;height:48px;border-bottom:1px solid #ECEEF1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
tr:last-child td{border-bottom:0}
.ac{width:52px;text-align:center;padding:0}
.dots{display:inline-flex;width:36px;height:36px;align-items:center;justify-content:center;border-radius:10px;color:#4A5562}
`;

const pagina = (titulo, grupo, ativo, corpo, nota, extra = '') =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${titulo}</title><style>${CSS}</style><body>${menu(grupo, ativo)}<main>${grupo === 'Parâmetros' ? `<div class="cab"><h1>Parâmetros</h1></div><div class="par">${secoes(ativo)}<div class="conteudo">${corpo}</div></div>` : corpo}</main>${extra}${nota ? `<div class="nota">${nota}</div>` : ''}</body></html>`;


/** Interruptor geral da regra (`Interruptor` com estadoEscrito="so-desligada"): ligada sem texto; desligada com o selo neutro. */
const chaveGeral = (ligada) =>
  `<div class="chave"><span class="sw${ligada ? ' on' : ''}" role="switch" aria-checked="${ligada}"><span class="trilho"></span>${ligada ? '' : '<span class="selo ne">Desligada</span>'}</span></div>`;
/** Interruptor do kit (Sim/Não) com rótulo em cima, como os campos. */
const chaveCampo = (rotulo, ligado, trava = false) =>
  `<div class="f">${rotulo}<span class="sw${ligado ? ' on' : ''}${trava ? ' trava' : ''}" role="switch" aria-checked="${ligado}"><span class="trilho"></span>${ligado ? 'Sim' : 'Não'}</span></div>`;
const campo = (rotulo, valor, unidade, estado = '') =>
  `<div class="f">${rotulo}<span class="input ${estado}">${valor}${unidade ? `<i>${unidade}</i>` : ''}</span></div>`;
const severidade = (s, estado = '') => `<div class="f">Severidade<span class="input sel ${estado}">${s}${chevron}</span></div>`;
const salvar = (ativo) => `<div class="salvar"><span class="btn ${ativo ? 'p' : 'd'}">Salvar</span></div>`;

// ---------- 01: Parâmetros › Alertas, seção Alertas da equipe ----------
// [nome, frase, campos [rótulo, valor, unidade, editado], severidade, ligada, alterada]
const EQUIPE = [
  ['Cliente sem visita', 'Avisa quando o cliente passa do prazo de visita.', [['Tolerância', '50', '% da frequência'], ['Sem frequência', '30', 'dias'], ['Carência do cliente novo', '15', 'dias']], 'Atenção', true],
  ['Ritmo abaixo da meta', 'Avisa quando o vendedor está abaixo do ritmo da meta.', [['Ritmo mínimo', '85', '% da meta', true], ['A partir do', '3º', 'dia útil']], 'Atenção', true, true],
  ['Pedido parado na aprovação', 'Avisa quando o pedido passa do prazo de aprovação.', [['Prazo', '1', 'dia útil']], 'Crítico', true],
  ['Ruptura recorrente', 'Avisa quando a loja repete ruptura em várias visitas.', [['Ruptura em', '3', 'visitas'], ['No período de', '14', 'dias']], 'Atenção', true],
  ['Visita curta', 'Avisa quando o promotor fica menos que o mínimo na loja.', [['Nos últimos', '3', 'dias']], 'Informativo', false],
  ['Fotos sem GPS', 'Avisa quando muitas fotos chegam sem localização.', [['Máximo sem GPS', '20', '%'], ['No período de', '7', 'dias'], ['A partir de', '10', 'fotos']], 'Atenção', true],
];
const linhaEquipe = ([nome, frase, campos, sev, ligada, alterada]) => {
  const est = ligada ? '' : 'leitura';
  return `<div class="regra${ligada ? '' : ' off'}${alterada ? ' alterada' : ''}"><div class="cabr">${chaveGeral(ligada)}<div class="nome"><b>${nome}</b><small>${frase}</small></div></div>
  <div class="campos">${campos.map(([r, v, u, ed]) => campo(r, v, u, ed ? 'editado' : est)).join('')}</div>${severidade(sev, est)}${salvar(!!alterada)}</div>`;
};
const html01 = pagina(
  'Parâmetros — Alertas',
  'Parâmetros',
  'Alertas',
  `<section class="quadro equipe"><div class="topo"><h2>Alertas da equipe</h2></div><div class="regras">${EQUIPE.map(linhaEquipe).join('')}</div></section>`,
  '<b>Simulação.</b> Sai de Comunicação › Regras de alerta. Cada regra salva sozinha: Salvar só fica ativo na regra alterada (aqui, Ritmo abaixo da meta). Desligada, a regra mantém os valores em só leitura. Sem o Promotor licenciado, Ruptura recorrente, Visita curta e Fotos sem GPS não aparecem.',
);

// ---------- 02: Parâmetros › Alertas, seção Produtividade do dia (aprovada, T-0180) ----------
// [nome, frase, destinos [[rótulo, ligado]] (só nas regras com dois), campos [rótulo, valor, unidade, sempreEditavel], ligada]
// D1: o "Depois de" do Parado entre visitas fica editável mesmo com a regra desligada (a Equipe agora usa o mesmo número).
const PROD = [
  ['Fim do almoço', 'Lembra a volta do almoço.', null, [['Antes do fim', '10', 'min']], true],
  ['Parado entre visitas', 'Avisa quando passa do tempo sem check-in.', [['Vendedor', true], ['Gestor', true]], [['Depois de', '60', 'min', true], ['Alerta ao gestor', '30', 'min depois']], false],
  ['Sem check-in no início do dia', 'Avisa quem não fez check-in até o horário.', [['Vendedor', true], ['Gestor', true]], [['Até as', '10:00', '']], true],
  ['Rota do dia incompleta', 'Lembra os clientes da rota que faltam.', null, [['Lembrete às', '16:00', '']], true],
  ['Visita aberta', 'Lembra o checkout da visita que ficou aberta.', null, [['Depois de', '120', 'min']], true],
  ['Envio pendente', 'Lembra os registros sem enviar.', null, [['Depois de', '4', 'h']], false],
];
const linhaProd = ([nome, frase, destinos, campos, ligada]) => {
  const est = ligada ? '' : 'leitura';
  const dest = destinos
    ? `<div class="campos" style="width:184px;flex-shrink:0">${destinos.map(([r, l]) => chaveCampo(r, l, !ligada)).join('')}</div><span class="sep"></span>`
    : '<div style="width:184px;flex-shrink:0"></div><span class="sep" style="visibility:hidden"></span>';
  const cs = campos.map(([r, v, u, sempre]) => campo(r, v, u, sempre ? '' : est)).join('');
  return `<div class="regra${ligada ? '' : ' off'}"><div class="cabr">${chaveGeral(ligada)}<div class="nome"><b>${nome}</b><small>${frase}</small></div></div>
  <div class="campos">${dest}${cs}</div>${salvar(false)}</div>`;
};
const html02 = pagina(
  'Parâmetros — Alertas (produtividade)',
  'Parâmetros',
  'Alertas',
  `<section class="quadro prod"><div class="topo"><h2>Produtividade do dia</h2>
  <div class="campos" style="align-items:center;gap:10px"><span class="f" style="flex-direction:row;align-items:center;gap:10px">Lembretes por pessoa<span class="input">4<i>por dia, no máximo</i></span></span>${salvar(false)}</div></div>
  <div class="regras">${PROD.map(linhaProd).join('')}</div></section>`,
  '<b>Simulação aprovada (T-0180).</b> Seção abaixo de Alertas da equipe, na mesma página. Destinos só nas regras com dois; as outras lembram só o vendedor (vale também para o promotor). Parado entre visitas aparece desligada com o "Depois de" editável (D1); Envio pendente, desligada em só leitura.',
);

// ---------- 03: Acesso › Usuários, gaveta do usuário com a seção Jornada ----------
const USUARIOS = [
  ['Ana Souza', 'ana.souza@exemplo.com.br', 'Administrador'],
  ['Bruno Costa', 'bruno.costa@exemplo.com.br', 'Promotor'],
  ['Carla Mendes', 'carla.mendes@exemplo.com.br', 'Vendedor'],
  ['João Silva', 'joao.silva@exemplo.com.br', 'Vendedor'],
  ['Maria Lima', 'maria.lima@exemplo.com.br', 'Supervisor'],
  ['Paulo Rocha', 'paulo.rocha@exemplo.com.br', 'Gerente'],
  ['Rita Alves', 'rita.alves@exemplo.com.br', 'Vendedor'],
];
const caixa = (marcada) =>
  `<span style="width:22px;height:22px;border-radius:6px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;${marcada ? 'background:#16202A' : 'border:2px solid #4A5562;background:#fff'}">${marcada ? visto : ''}</span>`;
const almoco = (padrao) =>
  `<div class="f" style="gap:8px">Horário de almoço
  <label style="display:flex;align-items:center;gap:10px;min-height:48px;padding:0 12px;border:1px solid #DFE2E6;border-radius:12px;background:#fff;font-size:15px;font-weight:600">${caixa(padrao)}Padrão da empresa (12:00 às 13:00)</label>
  ${padrao ? '' : `<div style="display:flex;gap:12px">${campo('Início', '12:00', '')}${campo('Fim', '13:00', '')}</div>`}</div>`;
const gfield = (r, v, sel = false) => `<div class="f" style="font-size:13px">${r}<span class="input" style="font-weight:400">${v}${sel ? chevron : ''}</span></div>`;
const gaveta = `<div style="position:absolute;inset:0;background:rgba(22,32,42,.35);z-index:5"></div>
<aside style="position:absolute;top:0;right:0;bottom:0;width:560px;background:#F8F6F1;z-index:6;display:flex;flex-direction:column;box-shadow:0 25px 50px -12px rgba(22,32,42,.25)">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;background:#fff;border-bottom:1px solid #DFE2E6;padding:16px 20px"><h2 style="font-size:20px;font-weight:700">Editar usuário</h2><span style="width:40px;height:40px;border:1px solid #C9CED5;border-radius:10px;display:flex;align-items:center;justify-content:center">${xis}</span></div>
  <div style="flex:1;padding:16px 20px;display:flex;flex-direction:column;gap:14px;overflow:hidden">
    ${gfield('Nome', 'João Silva')}${gfield('E-mail', 'joao.silva@exemplo.com.br')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${gfield('Perfil', 'Vendedor', true)}${gfield('Supervisor', 'Maria Lima', true)}</div>
    ${gfield('Código no ERP', 'V-0142')}
    <fieldset style="border:0;border-top:1px solid #DFE2E6;padding:14px 0 0;display:flex;flex-direction:column;gap:10px"><legend style="font-weight:600;font-size:13px;padding:0 8px 0 0">Jornada</legend>${almoco(true)}</fieldset>
  </div>
  <div style="display:flex;justify-content:flex-end;gap:8px;background:#fff;border-top:1px solid #DFE2E6;padding:12px 20px"><span class="btn s">Cancelar</span><span class="btn p">Salvar</span></div>
</aside>
<div style="position:absolute;right:584px;top:400px;width:380px;z-index:7;background:#F8F6F1;border:1px solid #DFE2E6;border-radius:16px;padding:14px 16px 16px;box-shadow:0 10px 24px rgba(22,32,42,.18);display:flex;flex-direction:column;gap:10px">
  <span class="eyebrow" style="font-weight:600">Mesmo campo, desmarcado</span>${almoco(false)}</div>`;
const html03 = pagina(
  'Acesso — Usuários — Jornada',
  'Acesso',
  'Usuários',
  `<div class="cab linha"><div><span class="eyebrow">Acesso</span><h1>Usuários</h1></div><span class="btn p">Novo usuário</span></div>
  <section class="quadro" style="padding:8px 16px"><table><colgroup><col style="width:24%"><col><col style="width:20%"><col style="width:52px"></colgroup>
  <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th class="ac"></th></tr></thead><tbody>
  ${USUARIOS.map(([n, e, p]) => `<tr><td>${n}</td><td>${e}</td><td>${p}</td><td class="ac"><span class="dots">${pontos}</span></td></tr>`).join('')}
  </tbody></table></section>`,
  '<b>Simulação.</b> Acesso › Usuários › Editar usuário, seção Jornada nova. Marcado, vale o padrão da empresa (Parâmetros › Calendário). À esquerda, o mesmo campo desmarcado: início e fim já vêm com o padrão para ajustar.',
  gaveta,
).replace('<div class="nota">', '<div class="nota" style="left:260px;right:auto;max-width:560px">');

// ---------- 04: lembretes do vendedor (bandeja do Android) e Alertas do Gestão ----------
const sb = (hora, escuro) =>
  `<div style="height:32px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;font-size:13px;font-weight:600;color:${escuro ? '#fff' : '#16202A'}"><span>${hora}</span><span style="display:flex;gap:6px;align-items:center"><span style="width:16px;height:10px;border:1.5px solid currentColor;border-radius:2px"></span><span style="width:22px;height:11px;border:1.5px solid currentColor;border-radius:3px;position:relative"><span style="position:absolute;inset:1.5px;right:5px;background:currentColor;border-radius:1px"></span></span></span></div>`;
// Ícone pequeno da notificação: o monocromático da marca (branco no transparente), pintado em Azul noite pelo Android (cor do expo-notifications).
const ICONE_NOTIF = `data:image/png;base64,${readFileSync(join(AQUI, MARCA, 'icone-notificacao-96.png')).toString('base64')}`;
const iconeNotif = `<span style="width:18px;height:18px;flex-shrink:0;background:#1E3350;-webkit-mask:url(${ICONE_NOTIF}) center/contain no-repeat;mask:url(${ICONE_NOTIF}) center/contain no-repeat"></span>`;
const notif = (hora, titulo, corpo) =>
  `<div style="display:flex;gap:12px;padding:14px 16px;border-top:1px solid #ECEEF1">
    <div style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="display:flex;align-items:center;gap:6px;font-size:12px;color:#4A5562">${iconeNotif}Macuxi Campo · ${hora}</span><b style="font-size:15px;font-weight:600;line-height:20px">${titulo}</b><span style="font-size:15px;line-height:19px;color:#34404D">${corpo}</span></div></div>`;
const bloco = (cor) => `<span style="width:52px;height:52px;border-radius:50%;background:${cor}"></span>`;
const campoTela = `<div class="fone" style="background:#16202A">
  ${sb('16:02', true)}
  <div style="padding:12px 24px 16px;color:#fff"><div style="font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:40px;line-height:1">16:02</div><div style="font-size:15px;color:#C9CED5;margin-top:6px">seg., 16 de nov.</div></div>
  <div style="display:flex;gap:18px;padding:4px 24px 20px">${bloco('#C9CED5')}${bloco('#2B3743')}${bloco('#C9CED5')}${bloco('#2B3743')}${bloco('#2B3743')}</div>
  <div style="margin:0 12px;background:#fff;border-radius:22px;overflow:hidden">
    <div style="padding:12px 16px 4px;font-size:13px;font-weight:600;color:#34404D">Notificações</div>
    ${notif('16:00', 'Faltam 3 clientes da rota', 'Próxima visita: Mercado Bom Preço.')}
    ${notif('14:15', 'Há 1 h sem visita', 'Próxima visita: Mercado Bom Preço.')}
    ${notif('12:50', 'Seu almoço termina às 13:00', 'Próxima visita: Mercado Bom Preço.')}
  </div></div>`;
const alerta = (titulo, msg, desde) =>
  `<div style="display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-bottom:1px solid #ECEEF1">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:16px;font-weight:600">${titulo}</b><span class="selo av">Atenção</span></div>
    <span style="font-size:16px;line-height:22px">${msg}</span><span style="font-size:14px;color:#4A5562">desde ${desde}</span>
    <span class="btn s" style="align-self:flex-start;height:44px;margin-top:4px">Dispensar</span></div>`;
const aba = (nome, ativa, d) =>
  `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding-top:8px;border-top:3px solid ${ativa ? '#1E3350' : 'transparent'};color:${ativa ? '#1E3350' : '#4A5562'};font-size:12px;font-weight:${ativa ? 600 : 500}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>${nome}</div>`;
const gestaoTela = `<div class="fone" style="background:#F8F6F1">
  <div style="background:#1E3350">${sb('11:42', true)}<div style="padding:10px 20px 18px;font-family:system-ui,'Segoe UI',Roboto,-apple-system,sans-serif;font-weight:700;font-size:22px;color:#fff">Alertas</div></div>
  <div style="padding:16px"><div style="background:#fff;border:1px solid #DFE2E6;border-radius:16px;overflow:hidden">
    ${alerta('Parado', 'João Silva: último checkout às 10:12.', '11:42')}
    ${alerta('Sem check-in', 'Carla Mendes', '10:00')}
  </div></div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:72px;background:#fff;border-top:1px solid #DFE2E6;display:flex">
    ${aba('Início', false, '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>')}
    ${aba('Equipe', false, '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.7 3 2.4 3.5 5.2"/>')}
    ${aba('Aprovações', false, '<path d="M5 12.5l4.5 4.5L19 7.5"/>')}
    ${aba('Alertas', true, '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>')}
  </div></div>`;
const html04 = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Lembretes e alertas no aparelho</title><style>${CSS}
body{width:1000px;height:1060px;display:block;padding:24px 44px}
.par{display:flex;gap:88px;justify-content:center;margin-top:16px}
.lado{display:flex;flex-direction:column;gap:10px;align-items:center}
.lado h2{font-size:15px}
.fone{position:relative;width:412px;height:915px;border-radius:28px;overflow:hidden;border:1px solid #C9CED5;box-shadow:0 10px 30px rgba(22,32,42,.15)}
.nota{position:static;max-width:none}
</style><body>
<div class="nota"><b>Simulação aprovada (T-0180).</b> À esquerda, os lembretes do vendedor no Campo: notificação local, só na bandeja, ícone monocromático em Azul noite. À direita, a área Alertas do Gestão com os alertas do gestor (sem push, D3). Dados fictícios.</div>
<div class="par"><div class="lado"><h2>Campo · bandeja de notificações</h2>${campoTela}</div><div class="lado"><h2>Gestão · Alertas</h2>${gestaoTela}</div></div>
</body></html>`;

const TELAS = [
  ['01-alertas-da-equipe', html01, { width: 1366, height: 768 }],
  ['02-produtividade-do-dia', html02, { width: 1366, height: 768 }],
  ['03-ficha-usuario-almoco', html03, { width: 1366, height: 768 }],
  ['04-push-no-aparelho', html04, { width: 1000, height: 1060 }],
];

// Playwright do repositório; se o navegador dele não estiver instalado, o Playwright global da sessão (sem instalar nada).
async function abrirNavegador() {
  try {
    return await require('playwright').chromium.launch();
  } catch {
    const global = join(execSync('npm root -g').toString().trim(), 'playwright');
    return await require(global).chromium.launch();
  }
}
const browser = await abrirNavegador();
for (const [nome, html, viewport] of TELAS) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const arq = join(AQUI, `${nome}.html`);
  writeFileSync(arq, html);
  await page.goto(pathToFileURL(arq).href);
  await page.evaluate(() => document.fonts.ready);
  // Conferência: texto cortado (conteúdo maior que a caixa) e o que passa da tela.
  const conf = await page.evaluate(() => {
    const W = innerWidth;
    const H = Math.max(innerHeight, document.documentElement.scrollHeight);
    const cortes = [];
    for (const el of document.querySelectorAll('main *, aside *, .fone *, .nota')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible' && el.tagName !== 'svg') cortes.push(`${el.className || el.tagName}:${el.textContent.slice(0, 30)}`);
      if (r.right > W + 1 || r.bottom > H + 1) cortes.push(`fora:${el.className || el.tagName}:${el.textContent.slice(0, 30)}`);
    }
    const nota = document.querySelector('.nota')?.getBoundingClientRect();
    const quadros = [...document.querySelectorAll('main .quadro')].map((q) => q.getBoundingClientRect());
    const fimConteudo = Math.round(Math.max(0, ...quadros.map((q) => q.bottom)));
    return { cortes: cortes.slice(0, 12), fimConteudo, inicioNota: nota ? Math.round(nota.top) : null };
  });
  await page.screenshot({ path: join(AQUI, `${nome}.png`), fullPage: true });
  await page.close();
  console.log(nome, JSON.stringify(conf));
}
await browser.close();
