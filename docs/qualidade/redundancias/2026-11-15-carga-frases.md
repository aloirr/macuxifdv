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
