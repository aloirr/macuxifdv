# Simulação da carga com aviso e frases, e cadastro no portal `config.` · parecer do corretor-redundancias

**Veredito: COM ACHADO (não liberado para ir ao dono do produto).** São 9 achados, do RD-0468 ao RD-0476: 3 de gravidade média e 6 de gravidade baixa. Todos estão na simulação (`docs/design/carga-aviso-frases/`, dono **designer-ux**) e cabem em 20 min.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o branch `nuvem/carga-frases-designer-ux`, commit **01b1231**:
- `spec.md` e `frases.md`;
- os 4 PNGs, abertos como imagem: `carga-campo.png`, `carga-gestao.png`, `config-frases.png` e `config-editar.png`;
- os `.html` e o `app.css` de origem.

O pedido é a R-20261115-070000-alexandre. Para comparar, li a `docs/design/entrada-sync.md` no `main` 0650504.

**Não contei como achado:**
- O texto do aviso, que é do dono do produto: "Baixando os dados do servidor. Isso pode demorar alguns minutos. Não saia desta tela!". Nada na tela repete o aviso: a linha da barra diz a etapa, e a frase sorteada fala de outro assunto.
- "Etapa 3 de 5", "43%" e a barra: já estavam na tela aprovada da v1.0.9 e não mudaram nesta simulação.
- O cabeçalho do portal (a sessão e o "Sair") e o par menu "Frases da carga" × título da página: é o padrão das telas que já existem no portal.
- As premissas da §4 da spec. A coluna "Para" não repete nada: sem ela, o promotor veria frase de pedido. A lista única para todas as empresas e a frase embaixo do "Olá" também não geram redundância. A mudança na `entrada-sync.md` §2 gera: está no RD-0476.

## 1. Telas conferidas
| Tela | Conferência |
|---|---|
| Carga · Campo (`carga-campo.png`) | Cada informação aparece uma vez: logo, "Olá, Lucas", a frase em até 2 linhas, o aviso e a linha da barra. **RD-0468** (ícone de alerta) |
| Carga · Gestão (`carga-gestao.png`) | A tela é igual à do Campo. A frase sorteada é de Gestão. **RD-0468** |
| Portal · Frases da carga (`config-frases.png`) | Os chips somam certo (30 = 27 + 3), e há 3 linhas com "Inativa" (26, 27 e 30). **RD-0469**, **RD-0470** |
| Portal · Editar frase (`config-editar.png`) | O contador mostra "68 de 90", e a frase 7 tem mesmo 68 caracteres. **RD-0471**, **RD-0472** |
| 30 frases (`frases.md`) | A maior tem 73 caracteres (a 25) e cabe em 2 linhas de 280 dp. Nenhuma explica o que o sistema faz por trás. **RD-0473**, **RD-0474**, **RD-0475** (duplicidade de sentido). A mudança de regra está no **RD-0476** |

## 2. Achados
### RD-0468 · baixa · layout · designer-ux
- **Onde:** o aviso, nos dois PNGs de carga (`spec.md` §1 item 4; `carga-*.html`, o `svg` dentro de `.aviso`).
- **O que se repete:** o mesmo alerta é marcado 4 vezes: a caixa com borda, o ícone de círculo com "!", o "!" do texto e o negrito em "Não saia desta tela!". O ícone repete o "!" do próprio texto do dono do produto.
- **Proposta:** tirar o ícone. A caixa e o negrito do texto do dono já destacam o aviso.
  - Antes: `[ⓘ!] Baixando os dados do servidor. Isso pode demorar alguns minutos. **Não saia desta tela!**`
  - Depois: `Baixando os dados do servidor. Isso pode demorar alguns minutos. **Não saia desta tela!**` (só a caixa)

### RD-0469 · baixa · layout · designer-ux
- **Onde:** a lista do portal, nas linhas 26, 27 e 30 (`spec.md` §3, "a inativa também tem o texto da frase em `ink-2`"; `config-frases.html`, regra `tr.inativa td.t`).
- **O que se repete:** a frase inativa aparece de 3 jeitos na mesma linha: o selo "Inativa", o texto em cinza e o link "Ativar".
- **Proposta:** tirar o cinza do texto. Ficam o selo, que diz a situação, e o link, que é a ação. Na spec, apagar "a inativa também tem o texto da frase em `ink-2`".

### RD-0470 · baixa · layout · designer-ux
- **Onde:** os chips "Todas 30 · Ativas 27 · Inativas 3" (`spec.md` §3; `config-frases.png`).
- **O que se repete:** a coluna Situação já separa as ativas das inativas, e a lista de 30 linhas cabe numa rolagem. Os chips repetem a coluna. As contagens também se repetem entre si: "Todas 30" é a soma das outras duas.
- **Proposta:** tirar os chips. Se o time Macuxi precisar achar as inativas, basta pôr as inativas no fim da lista, sem outro controle.
  - Antes: `[Todas 30] [Ativas 27] [Inativas 3]` + tabela
  - Depois: só a tabela

### RD-0471 · média · layout · designer-ux
- **Onde:** o diálogo Incluir/Editar, chave **Ativa** (`spec.md` §3; `config-editar.png`).
- **O que se repete:** a frase pode ser ativada ou desativada em 2 lugares: o link "Ativar"/"Desativar" da linha e a chave do diálogo. Isso fere a regra "uma informação, um lugar".
- **Proposta:** tirar a chave do diálogo. Ao incluir, a frase já nasce ativa, como a spec previa. A situação muda só pelo link da linha.
  - Depois, no diálogo: `Frase` · `Para` · "Cancelar" e "Salvar".

### RD-0472 · baixa · texto · designer-ux
- **Onde:** o campo Frase (`spec.md` §3: "contador 'n de 90', não passa de 90" e o erro "Use até 90 caracteres.").
- **O que se repete:** o limite de 90 aparece em 3 lugares: o contador, a trava do campo e a mensagem de erro. Como o campo não aceita mais de 90 caracteres, o erro nunca aparece.
- **Proposta:** tirar o erro "Use até 90 caracteres." da spec. O contador e a trava bastam. Os erros ficam "Escreva a frase." e "Essa frase já está na lista."

### RD-0473 · baixa · texto · designer-ux
- **Onde:** `frases.md`, frases 2 e 21.
- **O que se repete:** as duas têm o mesmo sentido, ouvir antes de oferecer.
  - 2: "Antes de oferecer, pergunte como o produto girou desde a última visita."
  - 21: "Escute primeiro. O cliente diz o que precisa quando tem espaço."

  A frase 2 também repete "última visita" da frase 1.
- **Proposta:** trocar a 2 por uma dica que ainda não está na lista. A 21 fica.
  - Depois (2): "Confira o limite de crédito do cliente antes de montar o pedido." (65 caracteres)

### RD-0474 · média · texto · designer-ux
- **Onde:** `frases.md`, frases 8, 23, 26 e 27.
- **O que se repete:** as 4 frases dizem a mesma coisa, voltar ao cliente.
  - 8: "…é visita marcada"
  - 23: "Combine a próxima visita…"
  - 26: "Visite, ouça e volte."
  - 27: "O cliente lembra de quem aparece. Apareça."

  A 26 também repete a 21 ("ouça"). Hoje, a 26 e a 27 já estão inativas na simulação.
- **Proposta:** ficam a 8 e a 23, e a 26 e a 27 são trocadas por assuntos novos:
  - 26: "Organize a rota do dia antes de sair de casa." (45 caracteres)
  - 27: "Chegue no horário combinado. Pontualidade também vende." (57 caracteres)

### RD-0475 · baixa · texto · designer-ux
- **Onde:** `frases.md`, frases 12, 13 e 14 (Promotor).
- **O que se repete:** "Avise a loja" aparece 3 vezes em 6 frases de promotor. A 12 e a 14 também têm o mesmo sentido: produto que falta vende menos, ou é "venda perdida".
  - 12: "Produto sem preço na gôndola vende menos. Avise a loja."
  - 14: "Ruptura é venda perdida. Registre e avise a loja na hora."
- **Proposta:** a 12 passa a falar só da etiqueta. A 13 e a 14 ficam.
  - Depois (12): "Confira se a etiqueta de preço bate com o produto da frente." (61 caracteres)

### RD-0476 · média · doc · designer-ux
- **Onde:** `spec.md` (cabeçalho: "Esta spec muda o item 'Fora da tela' da §2 dela") × `docs/design/entrada-sync.md:43-45`.
- **O que se repete:** os 2 docs dão a regra da mesma tela em sentidos opostos:
  - `entrada-sync.md`: "Fora da tela: frase que se alterna, **dica**, texto sobre o que o app faz por trás…";
  - `spec.md`: a frase sorteada (dica) passa a entrar.

  Se a mudança ficar só na spec nova, a tela de carga passa a ter 2 fontes da verdade.
- **Proposta:** a fonte da verdade continua sendo a `entrada-sync.md` §2. Quando o dono do produto aprovar:
  - tirar "dica" do "Fora da tela";
  - acrescentar à lista da tela: "frase sorteada, uma por carga, parada (`carga-aviso-frases/spec.md` §1–§2)".

  A `spec.md` só remete à `entrada-sync.md` e não repete a regra.

## 3. Conferido sem achado
- Nenhuma frase explica o que o sistema faz por trás. A 9 ("Confira o pedido…"), a 10 ("Visita sem pedido também se registra…") e a 29 ("Sincronize no fim do dia…") pedem uma ação do usuário.
- A 29 aparece durante a carga e também fala de sincronizar. Ela não repete o aviso: o aviso diz "não saia agora", e a frase diz "sincronize no fim do dia".
- Nenhuma frase passa de 90 caracteres. A maior tem 73 (a 25) e cabe em 2 linhas.
- A 4 ("fim do mês") e a 24 ("meta do mês") pedem ações diferentes: um item a mais no pedido e mais visitas.
- A coluna Nº é o número do título "Editar frase 7" e a referência na conversa. Ela fica.
- O "Incluir frase" é a única ação primária da tela. "Editar" e "Ativar"/"Desativar" ficam na linha, sem repetir nada.

## 4. Reteste (15/11/2026, commit ed7b6bc do designer-ux)
**Veredito: LIMPO no layout** (aviso, respiro, tela 640 e portal). Não há achado novo. Ficam `corrigido` os 6 RD de layout e de doc: RD-0468 a RD-0472 e RD-0476.

**Mudança de escopo (coordenador, 15/11):** o Alexandre mudou o tema das 30 frases, que agora são sobre a história e o folclore de Roraima:
- pelo menos 24 sobre o povo Macuxi, o Monte Roraima e Makunaimã;
- 6 sobre outros aspectos de Roraima.

A lista de vendas vai ser refeita. Por isso, os RD das frases (RD-0473, RD-0474 e RD-0475) ficam **encerrados por substituição** e não passam por reteste. A lista nova terá parecer próprio, com a checagem de sentido repetido e de tamanho. As linhas das frases na tabela abaixo e as observações sobre as frases 20 e 25, sobre "Confira" e sobre a anotação "(A/B a decidir)" ficam só como registro e não valem como parecer. Conferi o branch `nuvem/carga-frases-designer-ux`, commit **ed7b6bc**: o `spec.md`, o `frases.md`, os `.html`, o `app.css` e os 5 PNGs, abertos como imagem. Entre eles está o novo `carga-campo-640.png`.

| RD | Evidência do fechamento |
|---|---|
| RD-0468 | Os `.html` não têm mais o `svg` do aviso, e o `app.css` perdeu a regra `.aviso svg`. A `spec.md` §1 item 4 diz "Sem ícone". Os PNGs mostram só a caixa e o negrito. |
| RD-0469 | O `config-frases.html` perdeu a regra `tr.inativa td.t`. No PNG, as linhas 26, 27 e 30 têm o texto na cor normal; a situação fica no selo e o link faz a ação. |
| RD-0470 | Os chips saíram do `.html`, do PNG e da spec §3. As inativas vão para o fim da lista (`ORDEM`): no PNG, a ordem é 1–25, 28, 29, depois 26, 27 e 30. |
| RD-0471 | A chave "Ativa" saiu do diálogo (`config-editar.png`). A spec §3 diz: "A frase incluída nasce ativa" e "a situação muda só por esse link". |
| RD-0472 | A spec §3 tem só os erros "Escreva a frase." e "Essa frase já está na lista."; o contador "68 de 90" fica. |
| RD-0473 | A frase 2 virou "Confira o limite de crédito do cliente antes de montar o pedido.", e "última visita" ficou só na 1. |
| RD-0474 | A 26 virou "Organize a rota do dia antes de sair de casa." e a 27 virou "Chegue no horário combinado. Pontualidade também vende.". O sentido de voltar ao cliente ficou só na 8 e na 23. |
| RD-0475 | A 12 virou "Confira se a etiqueta de preço bate com o produto da frente.", e "avise a loja" ficou na 13 e na 14 (2 de 6), com assuntos diferentes. |
| RD-0476 | O cabeçalho da spec diz que a `entrada-sync.md` "continua a fonte da verdade", e a spec descreve só o que entra. A mudança do "Fora da tela" está na §5 "Na aprovação". A `entrada-sync.md` não mudou neste commit, como combinado. |

**O que entrou de novo, sem redundância:**
- **Spec §1.1, aviso sem caixa quando não há 16 dp abaixo do "Olá":** no `carga-campo-640.png`, o aviso aparece uma vez só, como texto, com o negrito do dono do produto. Nada mais na tela repete o aviso: a linha da barra diz a etapa, e a frase saiu.
- **Spec §1.1, frase em 1 linha na tela de 800 dp com navegação:** a frase continua aparecendo uma vez só, e a regra não cria texto substituto nem reticências. Se a frase não cabe, sai. Esse caso não tem print e eu conferi pela spec; o print do aparelho volta ao corretor na implementação (spec §5).
- **Frase 20 nova** (marca, MC-0079): "Meta clara: cada vendedor sabe quanto falta e onde buscar." Ela não repete a 24 ("A meta do mês se faz um cliente por vez."): a 20 é para o supervisor e trata de deixar a meta clara; a 24 é para todos e trata de visitas.
- **Frase 25 em A/B** (MC-0080): é decisão do dono do produto e não repete outra frase.
- "Confira" abre a 2, a 9 e a 12 com assuntos diferentes (crédito, resumo do pedido e etiqueta). O sorteio mostra uma frase por carga, então não conto como achado.
- **Observação sem RD:** na linha 25 do `frases.md`, a coluna Frase leva a anotação "(A/B a decidir)", que só remete à spec §4. A spec §2 diz que o bundle usa o `frases.md`. Na implementação, a anotação não pode entrar no texto da frase: o portal da simulação já a mostra sem a anotação.

## 5. Texto das 30 frases novas (história e tradição de Roraima, commit ca98272 do designer-ux)
**Veredito: COM ACHADO.** São 3 achados novos, do RD-0482 ao RD-0484: 2 de gravidade média e 1 de gravidade baixa. O layout não entrou: o reteste dele está na §4.

Conferi `frases.md`, `spec.md` §2 a §4 e §6 (fontes) e os PNGs regerados (`carga-gestao.png` e `config-frases.png`). Mudou o tema (R-20261115-071500-alexandre), e conferi a distribuição pedida: 8 frases sobre os Macuxi, 8 sobre o Monte Roraima e 8 sobre Makunaimã (24 nos 3 temas) e 6 sobre o resto de Roraima. A conferência de cada fato na fonte não é minha.

**Como medi:**
- Cada frase foi quebrada por palavra a 280 dp, com a largura dos glifos da IBM Plex Sans Regular 14 (`apps/web/app/fonts/IBMPlexSans_400Regular.ttf`, sem kerning).
- Todas as 30 cabem em 2 linhas no cálculo. 5 delas passam do limite de cerca de 80 caracteres, e 4 têm uma linha a menos de 7 dp da borda (≥ 274 de 280 dp). No aparelho, o desenho do texto pode variar, e essas viram uma 3ª linha, que a spec §1.1 corta: a frase some naquela carga.
- Abaixo, a contagem é de caracteres.

| Nº | Caracteres | Linha mais larga (dp de 280) |
|---|---|---|
| 29 | 86 | 280 |
| 5 | 84 | 278 |
| 7 | 84 | 274 |
| 13 | 83 | 276 |
| 18 | 81 | 260 |
| 16 | 80 | 278 |
| 4 | 80 | 275 (o PNG do Gestão mostra 2 linhas) |

### RD-0482 · média · texto · designer-ux
- **Onde:** `frases.md`, frases 5, 7, 13, 16, 18 e 29.
- **O que se repete ou sobra:**
  - Seis frases passam de 80 caracteres ou ficam no limite dos 280 dp.
  - A 7 repete a Raposa Serra do Sol da 5 ("…nasceu na Maloca do Japó, **na Raposa Serra do Sol**").
  - Na 29, "Roraima" sobra depois de Uiramutã, porque todas as frases já são de Roraima, e "(IBGE)" também sobra (ver RD-0483).
- **Proposta (texto final):**
  - 5: "A Raposa Serra do Sol, terra dos Macuxi e vizinhos, foi homologada em 2005." (75)
  - 7: "A pintora macuxi Carmézia Emiliano nasceu na Maloca do Japó." (60)
  - 13: "Um mapa de 1654 chama o Monte Roraima de \"montanha de cristais\"." (64). O autor do mapa fica na §6.
  - 16: "Ingarikó e Pemon formam um mesmo mundo cultural em torno do Monte Roraima." (74)
  - 18: "Segundo a tradição macuxi, Makunaimã e Enxikirang são irmãos, filhos do Sol." (76). O nome Wei sai. A marca confere se o nome deve ficar; se ficar, a frase precisa perder outra palavra.
  - 29: "O ponto mais ao norte do Brasil é a nascente do rio Ailã, em Uiramutã." (70)
  - A 4 (80, 275 dp) cabe no PNG e fica como está.

### RD-0483 · baixa · texto · designer-ux
- **Onde:** `frases.md`, as frases 3 ("Pelo Siasi/Sesai (2020), …"), 9 ("(IBGE, 2024)"), 28 ("(Embrapa)"), 29 ("(IBGE)") e 30 ("(Censo 2022)").
- **O que se repete:** a fonte de cada frase já está na tabela da `spec.md` §6. Repetir a fonte no texto da tela gasta espaço de 2 linhas, e quem lê não precisa dela para nada. O formato também muda de uma frase para outra: as frases 6, 12 e 26 também trazem números e não citam fonte.
- **Proposta:** na tela, a frase traz o fato e, quando o número depende do ano, o ano. A fonte fica só na §6.
  - 3: "Em 2020, o povo Macuxi somava 37.250 pessoas em Roraima." (56)
  - 9: "Com 2.734,9 m, o Monte Roraima é o 7º ponto mais alto do Brasil." (64)
  - 28: "O lavrado, a savana de Roraima, cobre cerca de 17% do estado." (61)
  - 29: o texto do RD-0482.
  - 30: "Uiramutã tem a maior proporção de indígenas do Brasil: 96,6% em 2022." (69)

### RD-0484 · média · layout · doc · designer-ux
- **Onde:** `config-frases.png` (coluna "Para", com "Todos" nas 30 linhas), o diálogo Incluir/Editar (campo **Para**), a `spec.md` §2 ("entre as ativas **do público do usuário**"), a §3 e a §4, que mantém a coluna "para uma frase futura de um perfil só".
- **O que se repete:** uma coluna com o mesmo valor em todas as linhas. A regra de 12/11 no catálogo diz que a etiqueta igual em todas as linhas sai. O campo do diálogo e o filtro do sorteio só servem a essa coluna, e nada pediu frase por perfil: o tema não depende do perfil.
- **Proposta:** concordo com a recomendação do designer-ux. Saem a coluna "Para" do portal, o campo **Para** do diálogo e o "do público do usuário" do sorteio (§2: "entre as **ativas**"). A §4 deixa de tratar o "Para". Se um dia o dono do produto pedir frase por perfil, a coluna volta junto com esse pedido.

**Conferido sem achado:**
- **Nenhum par de frases diz a mesma coisa.** Os pares que se tocam trazem fatos diferentes:
  - a 8 (Jaider Esbell ilustrou *Do Roraima ao Orinoco*) e a 23 (Koch-Grünberg registrou as narrativas, a obra que deu origem ao livro);
  - a 18 e a 21 (irmãos diferentes de Makunaimã, em tradições diferentes);
  - a 19 e a 22 (Wazacá e Wayaka: o monte e as plantas);
  - a 29 e a 30 (Uiramutã: o ponto mais ao norte e a proporção de indígenas);
  - a 1 e a 16 (os Pemon).
- **Nenhuma frase explica o funcionamento do app nem fala de venda.**
- **Nada na tela repete o aviso.** No PNG do Gestão, a frase 4 está entre o "Olá" e o aviso, sem repetir nenhum dos dois.
