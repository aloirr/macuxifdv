# Parecer de marca · regra de filial (login e BKO), Catálogo na opção A e Sincronizar com a completa

## Veredito: liberado com ajustes
O Catálogo (01 a 08), o login sem filial (13) e o Sincronizar (01 a 04, com o `DialogoProgresso`) estão **liberados**: não há cor nova, a tipografia está certa, o laranja aparece só em gráfico e preenchimento, e todos os pares passam no contraste.
Falta **um ajuste médio na própria simulação do BKO** (MC-0089). As telas 14 e 15 desenham um menu lateral antigo: o símbolo com "Macuxi FDV" digitado ao lado no lugar do logo A negativo grafite, e o título do grupo em `#9AA3B0` em vez do Sol claro. O BKO do `main` já está certo. Como esses PNGs vão para o Alexandre aprovar, a imagem precisa mostrar a marca aprovada. A correção fica no CSS e no HTML da simulação, e a spec não muda.

> 2026-11-15, 09h31 (Manaus) · design-de-marca · pedidos R-20261115-093000-alexandre (regra definitiva de filial) e R-20261115-100000-alexandre (Catálogo na opção A e Sincronizar).
> **Base:** branch `nuvem/catalogo-campo-designer-ux`, commits `9e0da421` e `4d6de8de28a7ab5d924bd5d876329a4f50dbf285`. Delta: `docs/design/filial-cadastro-venda/` (spec, CSS, HTML e 3 PNGs), `docs/design/sync-completa/` (spec, CSS, HTML e 4 PNGs) e os 8 PNGs, o HTML e a spec de `docs/design/catalogo-campo-v2/`.
> **Comparado com:** `docs/marca/manual.md` v1 (§2.1 logo do menu do BKO, MC-0056; §3 paleta, Sol claro no título de grupo, MC-0054; §4 layout; §5 tipografia) e com o BKO do `main` (`apps/web/components/app-shell.tsx`, `Brand` e `TITULO_GRUPO`).
> **Como:** li os 15 PNGs, levantei os hex do CSS e dos HTML, contei os pixels por cor em cada PNG (PIL) e calculei o contraste WCAG dos pares novos.
> **Não repete:** o parecer anterior do tema (`nuvem/catalogo-campo-design-de-marca`, ce228611, liberado; MC-0086 fechada) e o do ícone `pacote` (`nuvem/catalogo-v2-estoque-design-de-marca`, 5b4114ea, liberado).
> **Numeração:** MC-0089. A MC-0088 é a última usada nos branches da marca e do designer-ux.

## Por tela
| Tela | Situação | Conferido |
|---|---|---|
| Catálogo 01 · grade, uma filial | **ok** | Faixa Azul noite com `Filial Boa Vista · 1.284 produtos` em `#C9CED5` (8,07:1). Não tem selo nem chip. `Estoque: N` em `#1D6B4F` no `#E2F1EA` (5,51:1). Os cinzas fora da paleta (`#B9C0C7`, `#3F464E`, `#7C8590`, `#9AA2AB`) são o desenho fictício das peças, ou seja, conteúdo da foto (como já registrado na MC-0086) |
| Catálogo 02 · como abre, três filiais | **ok** | O chip `Suas filiais (3)` sem ✕ é a `EtiquetaFiltro` (Azul noite no `#DFE2E6`, 9,83:1). O selo `1` fica no Sol laranja, com o branco a 4,60:1, como contador (§3). `Estoque: 17` usa a mesma tag |
| Catálogo 03 · ficha | **ok** | `Estoque: 17` no cartão de preço e `Por filial` em botão `outline` com o ícone `pacote` grafite. São os pares já liberados |
| Catálogo 04 e 05 · busca | **ok** | Não há cor nova. O laranja só aparece no selo (672 px) |
| Catálogo 06 · folha Filtrar | **ok** | O grupo Filial traz `Suas filiais (3)` e as filiais de venda, com `sua filial` em 13 `ink2`. Os rótulos de grupo são 13/600 `ink2`. `Limpar` é neutro e `Ver 1.284 produtos` é Azul noite. O resto é o `scrim` sobre a tela |
| Catálogo 07 · Estoque por filial | **ok** | A tabela Filial e Estoque tem cabeçalho na Névoa. O `0` em `#A8261B` (7,10:1) e o `12` e o `5` em `#1D6B4F` (6,43:1) no branco são situação, com o número como texto (§3) |
| Catálogo 08 · filial escolhida | **ok** | O chip `Filial Manaus ✕` é o mesmo da 02 |
| 13 · login sem filial | **ok** | O logo é o arquivo pronto `macuxi-logo-negativo-azul-noite.svg` na faixa Azul noite, e o formulário fica no Pérola (§4). O `Banner` de erro usa `#A8261B` no `#FDE8E6` (6,04:1) com o ícone `alerta`, e `Entrar` é Azul noite. A frase "Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial." diz o problema e a ação, no tom da marca |
| 14 · BKO › Usuários, sem filial | **ajuste (MC-0089)** | O conteúdo está conforme: Pérola, painel branco, `Novo usuário` Azul noite e o selo `Sem filial` em `#A8261B` no `#FDE8E6` (6,04:1, 11/700). O **menu lateral** está fora do manual (MC-0089) |
| 15 · BKO › Editar usuário | **ajuste (MC-0089)** | A gaveta está conforme. As caixas marcadas são Azul noite com o ✓ branco (12,77:1). A filial de cadastro travada usa a caixa em `#5B6673` com o ✓ branco (5,84:1), na linha Névoa, com `filial de cadastro` em `#4A5562` (6,53:1). A borda da caixa vazia é `#5B6673` no branco (5,84:1, acima de 3:1). O aviso usa `#7A4F00` no `#FFF1D6` (6,38:1). O menu lateral repete a MC-0089 |
| Sync 01 · repouso | **ok** | `Sincronizar` grafite `#16202A` com texto branco (16,48:1), o papel dele no §3. A situação e a dica estão em `#4A5562` no Pérola (7,03:1) |
| Sync 02 · toque normal | **ok** | O indicador branco fica no grafite, e `Atualizando pedidos e clientes` vai em `ink2` |
| Sync 03 · segurando | **ok** | O anel de progresso tem 22 dp, traço 3 e ponta redonda, em branco com o trilho branco a 30% sobre o grafite. É indicador, não ícone da família, e segue a ponta redonda do kit. `Continue segurando · 6 s` é direto |
| Sync 04 · popup (`DialogoProgresso`) | **ok** | É a janela branca de raio 20 sobre o `scrim`. O título está em Archivo ExtraBold 19 e a mensagem em 15 `ink2`. A barra repete o tema Pérola da tela de entrada, já aprovado (`entrada-sync.md` §4): trilho `#DFE2E6` e preenchimento `#C2540A` (4,60:1 no branco e 3,54:1 no trilho, ambos acima de 3:1 para gráfico). `Etapa 3 de 5 · Catálogo e preços` e `43%` aparecem em Azul noite no branco (12,77:1). O laranja só preenche e não vira texto (§3) |

### Ícones
O delta dos dois commits não altera `packages/ui/src/mobile/icon.tsx`, `packages/ui/src/web/icons.tsx` nem `docs/design/telas/icones.js`. A única mudança de ícone no branch é o `pacote` (d4d41718), já liberado no parecer de 15/11 (`2026-11-15-catalogo-v2-estoque.md`). As telas novas usam só ícones do kit (`alerta`, `check`, `fechar`, `clipboard`, `sino`, `sync`, `pacote`, `copiar`) pelo `icones.js`, com grade 24, traço 2 e ponta e junção redondas. O ✓ dentro da caixa de marcar (14 px, traço 3) é o glifo do controle, não ícone de linha.

### Tipografia e tom
- Os títulos e números usam Archivo: `Usuários` 800/28, `Editar usuário` 800/20, `Entrar` 800/26 e o título do popup 800/19. O texto usa IBM Plex Sans. Não há família nem peso fora do §5.
- Os textos novos são curtos e de quem conhece o campo: `Segure 10 s para a sincronização completa`, `Solte antes para atualizar só pedidos e clientes`, `Aguarde e não saia desta tela.` e `2 usuários sem filial de cadastro não entram no app.`. O título `Realizando a sincronização completa` é o texto literal do Alexandre (R-20261115-100000).

## Achado
### MC-0089 · menu lateral do BKO da simulação com o logo remontado e o título de grupo fora da cor · média
| Campo | Conteúdo |
|---|---|
| ID | MC-0089 |
| Onde | `docs/design/filial-cadastro-venda/filial.html`, `.marca-bko` nas telas 14 e 15 (`macuxi-simbolo-negativo.svg` + `<b>Macuxi FDV</b>` digitado), e `filial.css`, `.lateral .marca-bko`, `.lateral .grupo { color: #9AA3B0 }` e `.lateral .op.on`. Aparece em `14-bko-usuarios-sem-filial.png` e `15-bko-editar-usuario-filiais.png` |
| Tipo | logo · cor |
| Fere | §2.1: o logo do menu lateral do BKO é `macuxi-logo-negativo-grafite.svg` com cerca de 28 px, e o nome da distribuidora vai abaixo em `#C9CED5`, fora da área de proteção (MC-0056). Também fere a regra "Não remonte o logo com texto digitado" e o §2.4 (separar a escrita do símbolo). §3: o título de grupo do menu do BKO usa o Sol claro `#F59A52` (MC-0054). O BKO do `main` já faz isso (`app-shell.tsx`, `Brand` e `TITULO_GRUPO` com `text-nav-grupo`, além da barra de 3 px `bg-nav-grupo` na tela atual) |
| Gravidade | média: a marca está errada só na imagem que o Alexandre vai aprovar, não no produto |
| Correção | Em `filial.html`, nas duas telas: `<div class="marca-bko"><img class="m" src="…/macuxi-simbolo-negativo.svg" alt=""><div><b>Macuxi FDV</b><span>Distribuidora Norte</span></div></div>` → `<div class="marca-bko"><img src="../../marca/ativos/2026-11-12-v1/macuxi-logo-negativo-grafite.svg" alt="Macuxi Força de Vendas"><span>Distribuidora Norte</span></div>`. Em `filial.css`: `.lateral .marca-bko { display: flex; flex-direction: column; align-items: flex-start; padding: 0 8px 20px; }`, `.lateral .marca-bko img { height: 28px; display: block; }` e `.lateral .marca-bko span { margin-top: 18px; font-size: 12px; color: #C9CED5; }`. Apagar as regras `.m` e `b`. `.lateral .grupo { color: #9AA3B0 }` → `color: #F59A52` (7,56:1 no grafite). Em `.lateral .op.on`, acrescentar a barra da tela atual como no `main`: `position: relative` e `::before { content: ""; position: absolute; left: 8px; top: 8px; bottom: 8px; width: 3px; border-radius: 2px; background: #F59A52; }`. Depois, gerar de novo os PNGs 14 e 15. Melhor ainda: copiar o menu de uma prancha do BKO já liberada (`docs/design/telas/bko-revisao.md`, §M2 a §M4) |
| Dono | designer-ux |

## Para a implementação (sem achado; o reteste confere no print)
- **`DialogoProgresso`:** a barra usa os tokens de `TEMAS_ENTRADA.perola` (`trilho` e `preenchimento`), sem hex solto. O `sync.css` da simulação traz `#1E3350`, `#DFE2E6` e `#C2540A` direto, o que vale só na simulação.
- **Filial de cadastro travada no BKO:** a gaveta de hoje usa `input type="checkbox"` com `accent-accent` (`usuarios-page.tsx:537`). Desabilitado, o navegador clareia a caixa por conta própria e o contraste fica incerto. O travado deve sair como na simulação: caixa `#5B6673` (`ink3`) com o ✓ branco, 5,84:1. O teste confere no print do navegador.

## Fora deste parecer
- A ordem e os itens do menu da simulação (sem grupos, 220 px) são de UX, do `designer-ux` e do corretor. A correção da MC-0089 copiando o menu liberado resolve as duas coisas de uma vez.
- O que a sincronização completa baixa e a tela que não apaga são do `engenheiro-apps`.

## Para o Alexandre
Depois da MC-0089, a simulação segue para ele sem ressalva de marca. O Catálogo e o Sincronizar já podem ir como estão. Só ele aprova.

## Recados pendentes
O repositório de recados deu 403 nesta sessão, então os recados não foram enviados. Comandos para o gerente-projetos enviar, ou para a próxima sessão com acesso:

```bash
node scripts/coord.mjs enviar --de design-de-marca --para designer-ux --cc gerente-projetos --tipo pedido \
  --assunto "MC-0089: menu lateral do BKO nas telas 14 e 15 da simulação de filial" \
  --corpo "Parecer docs/marca/pareceres/2026-11-15-catalogo-filial-sync.md (branch nuvem/catalogo-filial-sync-design-de-marca). MC-0089 (média): em docs/design/filial-cadastro-venda/filial.html e filial.css, troque o símbolo com 'Macuxi FDV' digitado pelo arquivo macuxi-logo-negativo-grafite.svg a 28 px, com 'Distribuidora Norte' abaixo em #C9CED5 (margem de 18 px). O título de grupo passa de #9AA3B0 para #F59A52, e a tela atual ganha a barra de 3 px em #F59A52, como no app-shell.tsx do main. Gere de novo os PNGs 14 e 15. O Catálogo 01-08, o login 13 e o Sincronizar 01-04 estão liberados. Na implementação do DialogoProgresso, use os tokens de TEMAS_ENTRADA.perola, sem hex."

node scripts/coord.mjs enviar --de design-de-marca --para gerente-projetos --tipo entrega \
  --assunto "Marca: simulação de filial, Catálogo na opção A e Sincronizar, liberado com ajustes (MC-0089)" \
  --corpo "Branch nuvem/catalogo-filial-sync-design-de-marca, parecer docs/marca/pareceres/2026-11-15-catalogo-filial-sync.md, base 4d6de8de. Liberados: Catálogo 01-08, login 13, Sincronizar 01-04 e DialogoProgresso. Ajuste: MC-0089 (média, designer-ux), menu lateral do BKO nas telas 14 e 15 com o logo remontado e o título de grupo em #9AA3B0. Reteste no PNG depois da correção."
```
