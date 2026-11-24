// Monta jornada.html (fonte) e ../jornada-am2808-fdv-erp.pdf a partir de dados/*.json e telas/*.png. Uso: node scripts/montar-pdf.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const AQUI = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)(process.env.MACUXI_PLAYWRIGHT ?? '/opt/node-tools/node_modules/playwright');
const dado = (n) => JSON.parse(readFileSync(join(AQUI, 'dados', `${n}.json`), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const manaus = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const VERSAO = process.env.MACUXI_VERSAO_MAIN ?? execSync('git log -1 --format=%h origin/main', { cwd: AQUI }).toString().trim();
const GERADO = process.env.MACUXI_GERADO_EM ?? new Date().toISOString();
const TELAS = new Set(readdirSync(join(AQUI, 'telas')).filter((f) => f.endsWith('.png')));
const usadas = new Set();
let n = 0;
const fig = (arq, legenda, tipo = 'bko') => {
  if (!TELAS.has(`${arq}.png`)) throw new Error(`tela ausente: ${arq}`);
  usadas.add(`${arq}.png`);
  n += 1;
  return `<figure class="${tipo}"><img src="telas/${arq}.png"><figcaption>Tela ${n} — ${esc(legenda)} <span class="arq">(${arq}.png)</span></figcaption></figure>`;
};
const campo = (...pares) => `<div class="par">${pares.map(([a, l]) => fig(a, l, 'campo')).join('')}</div>`;
const passo = (titulo, fazer, esperado, obtido, corpo = '') => `<section class="passo"><h2>${titulo}</h2><table class="fe"><tr><th>O que fazer</th><td>${fazer}</td></tr><tr><th>Resultado esperado</th><td>${esperado}</td></tr><tr><th>Resultado obtido</th><td>${obtido}</td></tr></table>${corpo}</section>`;
const json = (o) => `<pre>${esc(JSON.stringify(o, null, 2))}</pre>`;

const carga = dado('carga').lotes;
const sinal = dado('sinal');
const pend = dado('pendentes');
const integ = dado('retorno-integrado');
const fat = dado('retorno-faturado');
const ped = pend.json.pedidos[0];
const ROT = { filial: 'Filiais', vendedor: 'Vendedores', forma_pagamento: 'Formas de pagamento', prazo_pagamento: 'Prazos de pagamento', produto: 'Produtos', preco: 'Preços', estoque: 'Estoque', cliente: 'Clientes', titulo: 'Títulos' };
const tabelaLotes = `<table class="dados"><tr><th>#</th><th>Entidade</th><th>Registros</th><th>POST /lotes</th><th>Situação</th><th>Novas</th><th>Com erro</th><th>Avisos</th><th>Recebido (Manaus)</th><th>Concluído (Manaus)</th><th>Cursor</th></tr>${carga
  .map((l, i) => `<tr><td>${i + 1}</td><td>${ROT[l.entidade] ?? l.entidade} <code>${l.entidade}</code></td><td>${l.registros}</td><td>${l.http_aceito}</td><td class="ok">${l.resultado.status}</td><td>${l.resultado.contagens.novas}</td><td>${l.resultado.contagens.com_erro}</td><td>${l.resultado.avisos.length}</td><td>${manaus(l.resultado.recebido_em)}</td><td>${manaus(l.resultado.concluido_em)}</td><td><code>${esc(l.resultado.cursor?.external_id ?? '—')}</code></td></tr>`)
  .join('')}</table>`;

const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const conferencias = [
  ['Preço no app = preço do lote do ERP (RN-CAT-06: preço do cliente pela tabela do ERP)', 'P001 2490, P002 589, P003 899 centavos', 'R$ 24,90 · R$ 5,89 · R$ 8,99 (Tela do catálogo do cliente)', true],
  ['Estoque no app = saldo do lote de estoque', '240 · 500 · 80', 'Estoque: 240 · 500 · 80', true],
  ['Crédito disponível = limite − saldo dos títulos em aberto (o baixado não conta)', '5.000,00 − 1.250,00 = 3.750,00', 'BKO "Crédito disponível R$ 3.750,00"; app "Saldo disponível"/"Disponível R$ 3.750,00"', true],
  ['Total do item = quantidade × preço de tabela − desconto', '10 × 24,90 = 249,00; 20 × 5,89 = 117,80', '249,00 e 117,80 (app, BKO e JSON do ERP)', true],
  ['Total do pedido = soma dos itens', `249,00 + 117,80 = 366,80`, `${brl(ped.total_cents)} no JSON (total_cents ${ped.total_cents}); R$ 366,80 no app e no BKO`, true],
  ['Nota do faturamento = total do pedido', '36680', `nota.total_cents ${fat.enviado.nota.total_cents}; BKO "Faturado R$ 366,80 (NF 000004521)"`, true],
  ['Hora em UTC no banco e no fuso do tenant (Manaus, UTC−4) na tela', `carga ${carga[0].resultado.recebido_em} UTC`, 'BKO "24/11 às 06:21"; histórico do pedido 06:34/06:35', true],
  ['Rótulo × valor: "Itens 2 · 30 un." no BKO', '2 itens, 10 + 20 unidades', '2 · 30 un.', true],
];

const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Jornada AM2808 — FDV → ERP</title>
<style>
@page{size:A4;margin:14mm 12mm}
body{font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#1b2533;font-size:10.5pt;line-height:1.4}
h1{font-size:22pt;margin:0 0 4mm;color:#1f3350}h2{font-size:14pt;color:#1f3350;border-bottom:2px solid #e0a060;padding-bottom:1mm;margin-top:6mm}h3{font-size:11.5pt;margin:4mm 0 2mm}
.capa{page-break-after:always;padding-top:4mm}.capa .sub{font-size:13pt;color:#475569}.aviso{background:#fff4dd;border:1px solid #e0a060;border-radius:6px;padding:3mm 4mm;margin:6mm 0}
table{border-collapse:collapse;width:100%;margin:2mm 0 4mm}th,td{border:1px solid #d6dbe3;padding:1.4mm 2mm;text-align:left;vertical-align:top;font-size:9pt}th{background:#f1f4f8}
table.fe th{width:32mm}.ok{color:#17663a;font-weight:600}.nok{color:#b42318;font-weight:600}
figure{margin:3mm 0 5mm;page-break-inside:avoid;text-align:center}figure img{max-width:100%;max-height:228mm;border:1px solid #d6dbe3;border-radius:4px}
figcaption{font-size:8.5pt;color:#475569;margin-top:1mm}.arq{color:#94a3b8}
.par{display:flex;gap:6mm;justify-content:center;flex-wrap:wrap;page-break-inside:avoid}.par figure.campo{width:78mm}.par figure.campo img{max-height:200mm}
pre{background:#0f1b2b;color:#e6edf6;font-size:7.6pt;padding:3mm;border-radius:4px;white-space:pre-wrap;page-break-inside:auto}
code{font-family:'IBM Plex Mono',Menlo,monospace;font-size:8.6pt}
.passo{page-break-before:always}.def td:first-child{white-space:nowrap;font-weight:600}
</style><body>
<div class="capa">
<h1>Jornada de teste AM2808<br>Integração dos dados → pedido no app Campo → faturamento no ERP e nota</h1>
<p class="sub">Cliente da jornada: empresa de teste "Thathyany Teste" (código AM2808) · parte do FDV (Macuxi)</p>
<div class="aviso"><b>Reprodução local com dados de teste fictícios, sem acesso à produção.</b> Postgres, API (porta 8100) com o worker da outbox e BKO (<code>next dev</code>) numa sessão da nuvem; o ERP é <b>simulado por script</b> (<code>erp.mjs</code>) que fala com o Hub <code>/integracao/v1</code> com a credencial tipo nuvem <code>macuxierp</code>, como o Conector. CNPJs, nomes, e-mails, produtos, títulos, número do pedido no ERP, nota e chave de acesso são inventados. A chave da credencial não aparece em nenhum print (mascarada) nem neste PDF. A emissão real da NF-e em homologação é do gerente do ERP e não está aqui.</div>
<table><tr><th>Versão do código</th><td><code>main</code> em <code>${esc(VERSAO)}</code></td></tr>
<tr><th>Gerado em</th><td>${manaus(GERADO)} (horário de Manaus)</td></tr>
<tr><th>Ambiente</th><td>Tenant local <code>AM2808</code>, fuso America/Manaus, 8 módulos licenciados; admin, super-admin do portal e vendedor com senhas de teste.</td></tr>
<tr><th>Fonte</th><td><code>docs/testes/jornada-am2808/</code>: <code>erp.mjs</code> (ERP simulado), <code>scripts/</code> (prints do portal e do BKO, montagem deste PDF), <code>app-campo/</code> (telas do Campo), <code>dados/</code> (respostas do Hub) e <code>telas/</code> (PNGs).</td></tr></table>
<h3>Resultado</h3>
<table><tr><th>Etapa</th><th>Resultado</th></tr>
<tr><td>1. ERP envia filial (com CNPJ), vendedor, formas e prazos, produtos, preços, estoque, clientes e títulos</td><td class="ok">9 lotes, 19 registros, todos <code>concluido</code>, 0 erro</td></tr>
<tr><td>2. Dados no BKO (monitor, clientes com Código FDV e ERP, catálogo, preços) e no portal</td><td class="ok">OK</td></tr>
<tr><td>3. Mesmos dados no app Campo depois do sync do vendedor</td><td class="ok">OK (telas reais em react-native-web, ver "Como foi feito")</td></tr>
<tr><td>4. Pedido no app Campo e sync</td><td class="ok">Pedido 000001 aprovado na hora (R$ 366,80)</td></tr>
<tr><td>5. Pedido em <code>GET /pedidos/pendentes</code></td><td class="ok">OK, sem dado pessoal</td></tr>
<tr><td>6. Retorno integrado e faturado com a nota</td><td class="ok">Pedido muda para Integrado e Faturado no BKO e no app</td></tr>
<tr><td>Chave de acesso da NF-e (44 dígitos)</td><td class="nok">Não chega ao FDV: o contrato v1 não tem o campo (D3)</td></tr>
<tr><td>Liberar o acesso do vendedor que veio do ERP, sem e-mail configurado</td><td class="nok">Beco sem saída na tela (D1); feito pela API</td></tr>
<tr><td>7. Pré-cadastro de cliente (opcional)</td><td>Fora desta rodada</td></tr></table>
</div>

${passo('Passo 1 — O ERP ganha a credencial e envia os cadastros',
  'No portal de implantação (<code>config.localhost:3000</code>, super-admin) abra a empresa → aba <b>Integração</b> → <b>Integração via API</b>: identificador <code>macuxierp</code>, nome, todas as bases e "Envia os pedidos aprovados ao ERP"; <b>Gerar credencial</b>. Guarde a chave fora do repositório (<code>/home/user/jornada/credencial.json</code>). Depois rode <code>node erp.mjs sinal</code> e <code>node erp.mjs carga</code>: um lote <code>delta</code> por entidade, na ordem de <code>ORDEM_CARGA_ENTIDADES</code>, com <code>Idempotency-Key</code> = SHA-256 do conteúdo, e o script espera cada <code>GET /lotes/{id}</code> terminar.',
  'Credencial ativa com "Pedidos: Sim"; chave exibida uma vez. Cada lote responde 202 e termina <code>concluido</code> sem erro.',
  `Credencial <code>macuxierp</code> ativa. Sinal 200 (política de versão mínima ${esc(sinal.json.politica_versao.versao_minima)}). 9 lotes 202 → <code>concluido</code>, 0 erro, 0 aviso. Observação: a primeira chave apareceu num print sem máscara; o print foi apagado antes de qualquer commit e a chave foi trocada em "Gerar nova chave" (a Tela 3 é a da chave nova, mascarada).`,
  fig('01a-portal-empresas', 'Portal: lista de empresas (super-admin)') + fig('01b-portal-integracao-antes', 'Portal → empresa → Integração: credencial tipo nuvem preenchida, antes de gerar') + fig('01c-portal-credencial-gerada', 'Credencial macuxierp ativa; a chave (mostrada uma vez) está mascarada no print') +
  `<h3>Lotes enviados pelo ERP e resultado de cada um (<code>GET /integracao/v1/lotes/{id}</code>)</h3>${tabelaLotes}<p>Conteúdo: filial F01 "Matriz Teste" (CNPJ 11.222.333/0001-81, Manaus/AM); vendedor V001; formas BOL e DIN; prazos "28 dias" e "À vista"; produtos P001 Café Torrado Teste 500 g, P002 Açúcar Cristal Teste 1 kg, P003 Farinha de Mandioca Teste 1 kg; tabela T01 (24,90 · 5,89 · 8,99); depósito D01 (240 · 500 · 80); clientes C001 Mercadinho Teste (limite 5.000,00, tabela T01) e C002 Comercial Exemplo; títulos 1001/1 em aberto (1.250,00) e 950/1 baixado (800,00) do C001. Os corpos estão em <code>erp.mjs</code>.</p>`)}

${passo('Passo 2 — Os dados no BKO e no portal',
  'Entre no BKO (admin, código da empresa AM2808). (a) <b>Acesso → Usuários</b>: o vendedor V001 veio do ERP sem senha; libere o acesso. (b) <b>Sistema → Integração ERP</b>, <b>Cadastros → Filiais / Clientes</b> (abra a ficha), <b>Produtos → Catálogo / Tabelas de preço</b>, <b>Cadastros → Formas de pagamento e prazos</b>. (c) No portal, a aba Integração da empresa depois da carga.',
  'Vendedor com Código FDV e filial do ERP; acesso liberado. Monitor com as 9 entidades em dia; cliente com "ERP C001 · FDV 00001"; 3 produtos; tabela com 3 preços; formas e prazos do ERP.',
  'Tudo como esperado, menos (a): sem o envio de e-mail configurado, "Enviar acesso" falha e manda usar "Redefinir senha", que não existe para quem nunca teve senha (D1). A senha de teste foi definida pela mesma rota da tela, <code>PUT /v1/core/usuarios/{id}/senha</code> com <code>{senha}</code>, e trocada no primeiro acesso (<code>POST /v1/auth/senha/trocar</code>).',
  fig('02a-bko-usuarios-vendedor-do-erp', 'Usuários: "Vendedor Teste" veio do ERP (filial Matriz Teste, Código FDV 00002)') + fig('02c-bko-enviar-acesso-dialogo', '⋯ → "Enviar acesso" (único item de senha para quem não tem senha)') + fig('02d-bko-enviar-acesso-resultado', 'Sem e-mail configurado: "Use Redefinir senha", que o menu não oferece (D1)') +
  fig('03a-bko-integracao-monitor', 'Sistema → Integração ERP: macuxierp v1.5.0, 9 entidades "Em dia", linhas integradas = enviadas; horário de Manaus') + fig('03b-bko-filiais', 'Cadastros → Filiais: a filial 01 do ERP') + fig('03c-bko-clientes', 'Cadastros → Clientes: os 2 clientes do ERP na carteira do Vendedor Teste') + fig('03d-bko-cliente-ficha', 'Ficha do cliente: "ERP C001 · FDV 00001", limite 5.000,00, crédito disponível 3.750,00, títulos 950/1 liquidado e 1001/1 a vencer') +
  fig('03e-bko-catalogo', 'Produtos → Catálogo: P001, P002, P003') + fig('03f-bko-tabelas-preco', 'Produtos → Tabelas de preço: "Tabela Teste" do ERP') + fig('03g-bko-formas-pagamento', 'Cadastros → Formas de pagamento e prazos vindos do ERP') + fig('03h-portal-integracao-depois-da-carga', 'Portal → empresa → Integração depois da carga: Conector em dia, cargas recentes e "Dados no Hub" por entidade'))}

${passo('Passo 3 — Os mesmos dados no app Campo depois do sync do vendedor',
  'Entre no app Campo como o vendedor (AM2808, vendedor@thathyany-teste.com.br) e sincronize. Abra Clientes, a ficha do Mercadinho Teste e o Catálogo (geral e do cliente).',
  'Os 2 clientes na carteira; ficha com os códigos ERP e FDV, limite e disponível iguais aos do BKO; catálogo com os 3 produtos, preço da tabela do cliente e estoque do ERP.',
  'Como esperado (valores conferidos na tabela "Valor × regra"). Ver em "Como foi feito" como as telas foram abertas no navegador.',
  campo(['04a-campo-carteira', 'Clientes: 2 na carteira'], ['04b-campo-ficha-cliente', 'Ficha: ERP C001 · FDV 00001, limite e saldo disponível']) + campo(['04c-campo-catalogo', 'Catálogo geral'], ['04d-campo-catalogo-do-cliente', 'Catálogo do Mercadinho Teste: preço e estoque do ERP']))}

${passo('Passo 4 — O vendedor faz o pedido no app e sincroniza',
  'Na ficha, <b>Novo pedido</b>: aba Venda (Boleto · 28 dias, vindos do ERP) → Itens: busque "Café", P001 quantidade 10; "Açúcar", P002 quantidade 20 → Entrega (CIF, endereço do cadastro) → Resumo → <b>Salvar e enviar pedido</b>. O app sincroniza.',
  'Resumo com 249,00 + 117,80 = R$ 366,80; sem desconto, dentro da alçada: aprovado na hora; o pedido aparece na lista e entra na fila do ERP.',
  'Pedido <b>000001</b> feito <b>na tela real do Novo pedido</b> (cliques no navegador), enviado pelo motor de sync real; o servidor aprovou na hora (histórico "Enviado" e "Aprovado" às 06:34) e o pedido entrou na fila do ERP como <code>pendente</code>, sem retenção de mapeamento.',
  campo(['05a-campo-novo-pedido', 'Novo pedido, aba Venda: forma e prazo do ERP, crédito do cliente'], ['05b-campo-novo-pedido-item', 'Item P001: quantidade 10 a R$ 24,90']) + campo(['05c-campo-novo-pedido-itens', 'Aba Itens com os 2 itens'], ['05d-campo-novo-pedido-resumo', 'Resumo: R$ 366,80 e "Salvar e enviar pedido"']) + campo(['05e-campo-pedidos-aprovado', 'Pedidos: 000001 aprovado'], ['05f-campo-pedido-detalhe-aprovado', 'Detalhe: itens "Não faturado", histórico Enviado/Aprovado']))}

${passo('Passo 5 — O pedido sai em GET /integracao/v1/pedidos/pendentes',
  'No ERP simulado: <code>node erp.mjs pendentes</code> (credencial <code>macuxierp</code>, que recebe pedidos).',
  '200 com o pedido aprovado, chaves do ERP (cliente C001, vendedor V001, produtos P001/P002, filial F01, forma FP-BOL, prazo PZ-BOL-28), itens com sequência e total = soma dos itens; o pedido passa a "entregue ao Conector".',
  `200 com 1 pedido, <code>tentativa: 1</code>, total ${ped.total_cents} centavos. O JSON não tem dado pessoal (nem nome, nem documento, nem e-mail: só códigos do ERP), então não houve o que mascarar.`,
  `<h3>Resposta (íntegra)</h3>${json(pend)}`)}

${passo('Passo 6 — O ERP devolve integrado e depois faturado, com a nota',
  '<code>node erp.mjs retorno &lt;pedido_uuid&gt; integrado</code> (número PV-000123) e depois <code>node erp.mjs retorno &lt;pedido_uuid&gt; faturado</code>: <code>faturado_total</code> com a nota fictícia nº 000004521, série 1, total 366,80, a chave de acesso fictícia <code>13261111222333000181550010000045211000045210</code> (44 dígitos) e os itens faturados. Abra o pedido no BKO (Operação → Pedidos) e no app depois de cada retorno.',
  'Integrado: BKO e app mostram o número do ERP e "Integrado"/"Recebido no ERP". Faturado: BKO mostra a nota; app mostra os itens faturados e "Faturado". A chave de acesso da nota fica guardada e visível.',
  'Os dois retornos: 200, <code>repetido: false</code>. Pedido Integrado (ERP PV-000123) e depois Faturado no BKO (NF 000004521/1, R$ 366,80, 30 un.) e no app (histórico "Recebido no ERP" e "Faturado", itens "Faturado"). <b>A chave de acesso não é guardada nem mostrada</b>: <code>NotaRetorno</code> (v1) só tem número, série, data e total, e o Hub descarta o campo extra sem avisar (D3).',
  `<h3>Retorno integrado</h3>${json(integ)}<h3>Retorno faturado</h3>${json(fat)}` +
  fig('06-bko-pedidos-b-integrado', 'BKO → Pedidos com o pedido integrado') + fig('06-bko-pedido-detalhe-b-integrado', 'BKO, detalhe: Integrado · ERP PV-000123; "Faturamento e devolução" ainda vazio') +
  campo(['06-campo-pedido-detalhe-b-integrado', 'App: Nº no ERP PV-000123, "Recebido no ERP"'], ['06-campo-pedido-detalhe-c-faturado', 'App: itens "Faturado", histórico "Faturado · 24/11 06:35"']) +
  fig('06-bko-pedidos-c-faturado', 'BKO → Pedidos depois do faturamento') + fig('06-bko-pedido-detalhe-c-faturado', 'BKO, detalhe: Faturado, NF 000004521/1 R$ 366,80; histórico com Recebido no ERP e Faturado') + campo(['06-campo-pedidos-c-faturado', 'App: lista de pedidos depois do faturamento']))}

<section class="passo"><h2>Passo 7 (opcional) — Pré-cadastro de cliente</h2><p>Fora desta rodada, para não atrasar a entrega. O roteiro fica: app → Clientes → "Novo cliente" → sync → <code>GET /integracao/v1/clientes/pendentes</code> (traz <code>codigo_fdv</code>, <code>revisao</code> e <code>hash</code>) → <code>node erp.mjs cliente-retorno &lt;cliente_uuid&gt; &lt;codigo&gt;</code> (<code>status: vinculado</code>) → o cliente ganha o Código ERP no BKO e no app.</p>

<h2>Valor × regra (conferido)</h2><table><tr><th>Regra</th><th>Esperado pela regra</th><th>Exibido</th><th></th></tr>${conferencias.map(([r, e, o, ok]) => `<tr><td>${esc(r)}</td><td>${esc(e)}</td><td>${esc(o)}</td><td class="${ok ? 'ok' : 'nok'}">${ok ? 'OK' : 'diverge'}</td></tr>`).join('')}</table>
<p>Não coberto nesta jornada: dia não útil e virada de mês (a jornada roda num dia só, terça 24/11).</p>

<h2>Defeitos e observações</h2>
<table class="def"><tr><th>Id</th><th>O quê, passo e evidência</th><th>Dono provável</th></tr>
<tr><td>D1</td><td><b>Vendedor vindo do ERP fica sem acesso quando o e-mail não está configurado.</b> Usuários → ⋯ do vendedor (sem senha) → "Enviar acesso" → "Enviar acesso": erro "Não conseguimos enviar o e-mail. Use "Redefinir senha" para definir uma senha e passá-la à pessoa." Mas para quem não tem senha o menu só oferece "Enviar acesso", sem campo de senha (<code>acaoDeSenha</code> em <code>modules/core/web/lib/usuarios.ts</code>; diálogo em <code>usuarios-page.tsx</code>). A API aceita a senha informada (<code>PUT /v1/core/usuarios/{id}/senha</code>). Telas 5 e 6.</td><td>modulo-core</td></tr>
<tr><td>D2</td><td><b>Ficha do cliente no app: "Endereços — Nenhum endereço cadastrado" com o cliente tendo endereço.</b> O C001 veio do ERP com <code>endereco</code> (Rua Fictícia, 10, Centro, Manaus/AM, 69005-010); o cabeçalho mostra "Centro · Manaus/AM", mas a seção diz que não há endereço (rótulo × valor). Tela da ficha no app (Passo 3). Provável: a seção lista só <code>cliente_endereco</code> (entrega) e ignora o principal.</td><td>modulo-core</td></tr>
<tr><td>D3</td><td><b>A chave de acesso da NF-e não tem lugar no retorno do ERP.</b> <code>NotaRetorno</code> (<code>modules/integracao/contracts/pedido.ts</code>) só tem <code>numero</code>, <code>serie</code>, <code>emitida_em</code>, <code>total_cents</code>; o retorno com <code>nota.chave_acesso</code> responde 200 e o campo some (nem <code>vendedor.pedido_faturamento</code>, nem evento). Sem ela o FDV não mostra nem leva ao PDF a chave da nota. Mudança aditiva no v1 (RN-INT-09) precisa de decisão do dono do produto.</td><td>modulo-integracao / engenheiro-software (contrato), modulo-vendedor (tela)</td></tr>
<tr><td>O1</td><td>Login do BKO e do app aceitam só código no formato UF + 4 dígitos (o campo corta em 6 caracteres); o tenant do ambiente tinha o código legado <code>thathyany-teste</code> e não entrava no BKO (o formulário até caía no envio nativo por GET com a senha na URL antes da hidratação). O código foi trocado para <code>AM2808</code> no banco local. O servidor aceita o legado.</td><td>modulo-core (a confirmar se há tenant legado em produção)</td></tr>
<tr><td>O2</td><td>Mesma filial com dois nomes: "01 · Manaus/AM" (ficha do cliente no BKO e no app) × "01 · Matriz Teste/AM" (pedido no app).</td><td>modulo-core / modulo-vendedor (corretor-redundancias)</td></tr>
<tr><td>O3</td><td>"Crédito disponível" (BKO) × "Saldo disponível" (ficha no app) × "Disponível" (Novo pedido) para o mesmo número.</td><td>designer-ux</td></tr>
<tr><td>O4</td><td>Coluna "Valor tabela" no Resumo e no detalhe do pedido no app mostra o total do item a preço de tabela (249,00), não o preço unitário (24,90); o BKO chama "Tabela" o unitário. Rótulo ambíguo.</td><td>modulo-vendedor / designer-ux</td></tr>
<tr><td>O5</td><td>BKO, detalhe do pedido em 1366 px: a última coluna das tabelas "Itens" e "Faturamento e devolução" fica cortada na gaveta; "Faturamento e devolução" aparece vazia (só o título) antes do faturamento.</td><td>modulo-vendedor (a confirmar em tela real)</td></tr>
<tr><td>O6</td><td>Títulos na ficha do cliente no BKO com data em ISO ("2026-10-25") em vez de dd/mm/aaaa.</td><td>modulo-core</td></tr>
<tr><td>O7</td><td>O número da NF não aparece no detalhe do pedido no app (só "Faturado"); no BKO aparece.</td><td>modulo-vendedor (decisão de produto)</td></tr>
<tr><td>O8</td><td>Portal, monitor: o Conector aparece "Em dia" antes de qualquer sinal (versão e último sinal "—").</td><td>modulo-integracao</td></tr>
<tr><td>O9</td><td>No sync do Campo a API respondeu 404 a <code>GET /v1/goals/me</code> e <code>GET /v1/orders</code> (rotas da Fase M); o sync terminou bem. A confirmar no aparelho se o app real também chama.</td><td>engenheiro-apps</td></tr>
</table>

<h2>Como foi feito (e o que muda do aparelho)</h2>
<ul>
<li><b>Portal e BKO</b>: Playwright (Chromium), 1366 × 860, escala 2, fuso America/Manaus. O BKO foi aberto em <code>localhost:3000</code> (em <code>127.0.0.1</code> o <code>next dev</code> não hidrata a página).</li>
<li><b>App Campo</b>: o app inteiro no navegador não montou: <code>expo export --platform web</code> falha em <code>expo-sqlite</code> (<code>wa-sqlite.wasm</code> sem resolver no Metro). Então as <b>telas reais</b> do Campo (<code>modules/core/app/telas/clientes.tsx</code> e <code>cliente.tsx</code>, <code>modules/catalogo/app/telas/catalogo.tsx</code>, <code>modules/vendedor/app/screens/new-order-screen.tsx</code>, <code>orders-screen.tsx</code>, <code>order-detail-screen.tsx</code>) foram empacotadas com esbuild + react-native-web, com o <b>motor de sync real</b> (<code>criarMotorSync</code>, <code>shellDaVariante('campo')</code> com o registro, as etapas e as consultas do shell, <code>transporteV1</code> e <code>ApiClient</code> do app) falando com a API local pelo login do vendedor. Diferenças: armazenamento em memória no lugar do SQLite (cada tela sincroniza do zero), módulos nativos (ícones, câmera, GPS, arquivos) como dublês vazios — por isso <b>os ícones não aparecem</b> e alguns botões ficam em branco —, <code>expo-router</code> como dublê e a fonte Inter no lugar de Archivo/IBM Plex (não instaladas na sessão). O pedido foi feito pelos cliques na tela real do Novo pedido; o envio é o do app (fila do motor → <code>POST /v1/sync/push</code>).</li>
<li><b>ERP</b>: <code>erp.mjs</code> chama o Hub como o Conector (cabeçalhos <code>Authorization</code>, <code>X-Macuxi-Conector-Id</code>, <code>X-Macuxi-Conector-Versao</code> 1.5.0, <code>Idempotency-Key</code>). Corpos conferidos com <code>modules/integracao/contracts</code> (lote, entidades, pedido, cliente-erp) e <code>docs/modulos/integracao/hub-api.md</code>.</li>
</ul>
<h2>O que pede teste manual</h2>
<ul><li>Aparelho Android real (APK Campo): repetir os passos 3, 4 e 6 com ícones, SQLite e sync de verdade; conferir D2, O4 e O7 no aparelho.</li>
<li>NF-e real em homologação no ERP (gerente do ERP): número, série e chave reais; conferir D3.</li>
<li>Envio de e-mail configurado: "Enviar acesso" ao vendedor do ERP (o caminho feliz de D1).</li></ul>
<p style="color:#94a3b8;font-size:8pt">${n} telas. Gerado por docs/testes/jornada-am2808/scripts/montar-pdf.mjs.</p>
</section></body></html>`;

const sobra = [...TELAS].filter((t) => !usadas.has(t));
if (sobra.length) console.log('telas fora do PDF:', sobra.join(', '));
writeFileSync(join(AQUI, 'jornada.html'), html);
const nav = await chromium.launch();
const p = await nav.newPage();
await p.goto(`file://${join(AQUI, 'jornada.html')}`, { waitUntil: 'load' });
await p.pdf({ path: join(AQUI, '..', 'jornada-am2808-fdv-erp.pdf'), format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:7pt;color:#94a3b8;width:100%;text-align:center">Jornada AM2808 · reprodução local, dados fictícios · <span class="pageNumber"></span>/<span class="totalPages"></span></div>', margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' } });
await nav.close();
console.log('telas no PDF:', n);
