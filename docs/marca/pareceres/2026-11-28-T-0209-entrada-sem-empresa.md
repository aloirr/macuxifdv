# Parecer de marca — entrada sem a empresa e rodapé legal (T-0209 e T-0204, v1.0.44)

> 2026-11-28 · design-de-marca · simulação do designer-ux no branch `nuvem/v1044-designer-ux-entrada`, SHA
> `d879a348d4c11809f4da7e26574dd8c9148f4052`: `docs/design/v1044-entrada-sem-empresa.md` e os 18 PNGs de
> `docs/design/simulacoes/v1044-entrada/` (gerador `gerar.mjs`). Conferido contra `docs/marca/manual.md` (v1, com a
> tipografia de 15/11) e `decisoes.md`. Caixa de recados inacessível nesta sessão (HTTP 403), registrado no diário.

## Veredito: **ajustes**

A direção é boa e conforme a marca: logo pronto, negativo sobre o Azul noite, formulário no Pérola, um só botão principal Azul
noite, avisos sem prefixo com o tom pela cor e pelo ícone, verde fora do "enviado". Quatro ajustes médios impedem levar a
simulação ao Alexandre como está: ela mostraria uma fonte que ele tirou da marca em 15/11, bordas de campo fora da paleta e uma
cor de aviso "quase igual". Corrigidos os ajustes (só a simulação e o doc; nenhum ponto depende de decisão nova), o parecer
passa a **validado para levar ao Alexandre**, com as duas perguntas da seção 3.

## 1. Os três pontos pedidos

| Ponto | Parecer |
|---|---|
| (1) Rodapé legal "© 2026 Macuxi · Termos de uso · Política de privacidade", 12 px, só no Entrar | **Conforme.** 12 px é o mínimo da escala (§5.3); "© 2026 Macuxi" em `#4A5562` no Pérola **7,03:1** (o doc diz 7,1; MC-2095); links Azul noite `#1E3350`, 600, **11,82:1**; "·" em `#5B6673`, 5,41:1. "Macuxi" inteiro e com maiúscula (§2.4). Discreto e abaixo da faixa: não compete com o logo. Ano pelo relógio: certo. Fica só no Entrar: certo. |
| (2) Faixa do app com "Campo"/"Gestão" ao lado do logo | **Conforme na ideia** (repete a `MarcaNaFaixa` do BKO e do portal, já validada em 14/11; texto `#C9CED5` no Azul noite, 8,07:1), **com ajuste da área de proteção** (MC-2094): o logo do app está a 44 px de altura e o "M" mede ~27 px, mas o divisor está a 14 px do logo. |
| (3) Cor, tipografia, logo e layout nas quatro entradas, Esqueci e avisos | **Ajustes**: tipografia (MC-2091), borda dos campos (MC-2092) e texto do aviso de atenção (MC-2093). Logo e layout conformes ao §4 ("Login, splash e portal: logo negativo na faixa Azul noite, formulário no Pérola"). |

## 2. Achados

### MC-2091 · tipografia fora do manual · média
| Campo | Conteúdo |
|---|---|
| Onde | todos os PNGs; `gerar.mjs:3-4,14-24,58,60,66,114` (`'IBM Plex Sans'`, `Archivo`, `@font-face`); doc §5 item 7 |
| Tipo | tipografia |
| Fere | manual §5 e §5.1 (decisão de 15/11, R-20261115-110600): fonte do sistema em todas as superfícies; "saem a Archivo e a IBM Plex"; nenhuma fonte baixada (`@font-face`) |
| Correção | `font-family:'IBM Plex Sans',system-ui,sans-serif` → `system-ui,"Segoe UI",Roboto,-apple-system,sans-serif` no `body`; tirar `Archivo` de `h1`, `.app-faixa .area` e `.cad h2` (herdam a pilha, 700); apagar a função `fontes()` e a variável `FONTES`. No doc, item 7 da §5 → "Fonte do sistema (manual da marca §5)". Regerar os 18 PNGs. Para o print representar o Android, rodar com Roboto instalada no Chromium do gerador |
| Dono | designer-ux |

### MC-2092 · borda dos campos fora do papel · média
| Campo | Conteúdo |
|---|---|
| Onde | app: `campo-*-390.png`, `campo-entrar-1366.png`, `gestao-*` (`gerar.mjs:54` `--lineStrong:#C9CED5`, usado na `.campo .inp`); web: `bko-*`, `config-*`, `cadastro-*` (`gerar.mjs:54,106,118` `--field:#8B96A3`) |
| Tipo | cor |
| Fere | manual §3: borda de componente no fundo claro = Campo `#7A8593` (3,75:1 no branco). `#C9CED5` no branco dá **1,58:1** (campo quase invisível ao sol) e é cor de texto na faixa; `#8B96A3` é o cinza de série de gráfico e desabilitado |
| Correção | `--lineStrong:#C9CED5` → `#7A8593` (é o valor do token `lineStrong` em `packages/ui/src/mobile/tokens.ts:31`); `--field:#8B96A3` → `#7A8593` (`--color-field` de `apps/web/app/globals.css:17`). O que hoje usa `lineStrong` como linha do cartão (`.cartao`) continua em `--line` `#DFE2E6` |
| Dono | designer-ux |

### MC-2093 · aviso de atenção em cor "quase igual" · média
| Campo | Conteúdo |
|---|---|
| Onde | `campo-empresa-suspensa-390.png`, `bko-empresa-suspensa-1366.png` (`gerar.mjs:56` `--warningInk:#5C3B00`) |
| Tipo | cor |
| Fere | manual §3 (aviso `#7A4F00` no `#FFF1D6`; "cor quase igual" é combinação proibida). Mesmo ponto da MA-24 da revisão geral de 24/11, ainda aberto no token do app |
| Correção | `--warningInk:#5C3B00` → `#7A4F00` (6,38:1 no `#FFF1D6`, o `--color-warning` da web). Na etapa 5, o `Banner` do app passa a usar `colors.warning`, não `warningInk` |
| Dono | designer-ux |

### MC-2094 · faixa do app sem a área de proteção do logo · média
| Campo | Conteúdo |
|---|---|
| Onde | `campo-entrar-*`, `gestao-entrar-*`, `campo-esqueci-*`, `campo-erro-*`, `campo-empresa-suspensa-390.png` (`gerar.mjs:63-66`) |
| Tipo | logo |
| Fere | manual §2.3: nenhum elemento numa margem igual à altura do "M". Logo a 44 px de altura → "M" com ~27 px (62% da altura no SVG); o divisor está a 14 px e o topo e a base da faixa a 26 px |
| Correção | `.app-faixa` `gap:14px` → logo, **28 px**, divisor, 14 px, área (ex.: `margin-right:14px` no `svg.logo` além do `gap`); `padding:26px 24px` → `28px 24px`. Cabe em 390 px (24 + 204 + 28 + 1 + 14 + ~80 = ~351). A alternativa, se o designer-ux preferir a faixa mais baixa, é o logo a 32 px de altura (M ~20 px) com 20 px de folga. Na web, a `MarcaNaFaixa` (104 px, 14 px, MC-0022) está conforme |
| Dono | designer-ux (simulação e spec) · engenheiro-apps (tela) |

### MC-2095 · contraste citado errado no doc · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `docs/design/v1044-entrada-sem-empresa.md` §2 |
| Tipo | cor (documentação) |
| Fere | manual §3, tabela de contraste |
| Correção | "`ink2` (#4A5562, 7,1:1 no Pérola)" → "7,03:1"; "`accentInk` (#1E3350, 11,8:1)" → "11,82:1" |
| Dono | designer-ux |

## 3. O que vai ao Alexandre (depois dos ajustes)
1. **Rodapé legal:** "© 2026 Macuxi · Termos de uso · Política de privacidade". Recomendação: aprovar como está. A alternativa
   "© 2026 Macuxi FDV" casa com a assinatura do e-mail (§7), mas repete o que o logo já diz; "Macuxi" basta. Os links dependem das
   páginas, que ainda não existem (premissa 1 do designer-ux): sem endereço, recomendo publicar o rodapé só com "© 2026 Macuxi".
2. **Faixa do app com "Campo"/"Gestão":** recomendação aprovar. É o mesmo padrão do BKO ("Backoffice") e do portal ("Portal de
   implantação"): a pessoa sabe em que porta está, e o Campo e o Gestão deixam de ter entradas idênticas.

## 4. Conforme
- Logo: arquivo pronto `macuxi-logo-negativo-azul-noite.svg`, sem deformação, sombra nem recoloração; acima do mínimo de 20 px
  (cadastro: 96 px de largura, ~21 px de altura).
- Botão principal Azul noite com texto branco (12,77:1); links Azul noite 600; aviso de erro `#A8261B` no `#FDE8E6` (6,04:1);
  "enviado" em Azul noite no Azul suave (9,83:1), sem verde; laranja só no sol do logo.
- Avisos sem prefixo, tom pela cor e pelo ícone; um aviso por vez.
- Nenhuma marca de terceiro; nenhum grafismo; dados fictícios.
- Escala: título 28 (app) e 24 (web) em 700; base 16/15; nada abaixo de 12.

## 5. Revalidação — SHA 9d74d1bb02cfb72c7e093aaf54bdef573be6a207 (28/11/2026)
Comparado com d879a348d: `gerar.mjs`, `docs/design/v1044-entrada-sem-empresa.md`, `docs/design/telas/rodape-legal.html` e os
PNGs `campo-entrar-390`, `campo-empresa-suspensa-390` e `bko-entrar-1366` (lidos), entre os 18 regerados.

| Achado | Situação |
|---|---|
| MC-2091 | **Fechado.** Sem `@font-face`, `FONTES`, Archivo nem Plex no gerador; `body` em `system-ui,"Segoe UI",Roboto,-apple-system,sans-serif`; doc §5 item 7 → "Fonte do sistema (manual da marca §5)". |
| MC-2092 | **Fechado.** `--lineStrong` e `--field` em `#7A8593`; nos PNGs a borda do campo aparece no app e na web. |
| MC-2093 | **Fechado.** `--warningInk:#7A4F00` no `#FFF1D6` (6,38:1); conferido no `campo-empresa-suspensa-390.png`. |
| MC-2094 | **Fechado.** Faixa `padding:28px 24px`, `margin-right:14px` no logo + `gap:14px` = 28 px até o divisor; no PNG, ~28 px acima do logo e ~27,5 px até o divisor. Cabe em 390 px. A regra vai junto para a etapa 5 (engenheiro-apps). |
| MC-2095 | **Fechado.** Doc com 7,03:1 e 11,82:1. |

`rodape-legal.html`: saiu o campo "Código da empresa" do app e da web; subtítulo do BKO "Use o seu e-mail e a sua senha.":
conforme (voz direta, sem jargão). Novo achado abaixo (MC-2096), que já estava no arquivo antes desta rodada.

### MC-2096 · Archivo no protótipo do rodapé legal · baixa
| Campo | Conteúdo |
|---|---|
| Onde | `docs/design/telas/rodape-legal.html:22,49,50` (`.cel h1`, `.mfaixa .area`, `.web h1`) |
| Tipo | tipografia |
| Fere | manual §5 e §5.1 (fonte do sistema; saem a Archivo e a IBM Plex) |
| Correção | apagar `font-family: Archivo, sans-serif;` nas três regras (herdam a pilha do sistema); peso 800 dos títulos → 700, como no `gerar.mjs` |
| Dono | designer-ux |

Não muda os PNGs da simulação (saem do `gerar.mjs`); corrige no mesmo PR, antes do lote.

### Premissa da fonte (sem Roboto na sessão)
Basta para levar a simulação ao dono do produto. O manual (§5) manda a fonte do sistema e o gerador já pede `Roboto` na pilha; o
que a sessão não tem é o arquivo da Roboto, então o Chromium caiu na sans padrão daqui. A simulação mostra layout, cores, logo e
texto, e isso não depende do desenho da letra; a diferença de largura entre as duas sans não quebra nenhuma linha (o rodapé cabe a
390 px com folga). **Ressalva obrigatória no recado:** "Simulação de layout e texto. A letra do print é a sans padrão do gerador;
no celular sai a Roboto do Android e, no navegador, a fonte do sistema." A conferência da letra fica para o print do aparelho na
etapa 5.

### Parecer da revalidação
**Liberado com ajustes** sobre 9d74d1bb0: a simulação está **validada para levar ao dono do produto** com a ressalva acima.
MC-2096 (baixa, doc) corrige antes do lote.
