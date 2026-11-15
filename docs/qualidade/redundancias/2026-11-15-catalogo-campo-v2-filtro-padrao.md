# Catálogo do Campo v2 e filtro padrão (Rota, Clientes e Performance) · simulação · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 7 achados, do RD-0496 ao RD-0502: 5 de gravidade média e 2 de gravidade baixa. Todos seguram o lote.
- **designer-ux** (simulação): RD-0496 a RD-0500;
- **modulo-core** (achados do diagnóstico, no mesmo lote): RD-0501 e RD-0502.

Corretor-redundancias, 15/11/2026 (Manaus). Conferi o branch `nuvem/catalogo-campo-designer-ux`, commit **4cecf05**:
- `docs/design/catalogo-campo-v2/` (spec e 6 PNGs);
- `docs/design/filtro-padrao-campo/` (spec e 5 PNGs).

Abri os 11 PNGs como imagem. Os pedidos são do dono do produto: R-20261115-071600-alexandre e R-20261115-072200-alexandre.

**Não contei como achado** o que é padrão aprovado de Pedidos (`pedidos-filtro-periodo.md`):
- o selo com a contagem no `BotaoFiltro` e os chips removíveis embaixo;
- a filial padrão do Catálogo virando chip, que é pedido do dono do produto.

## 1. O que foi pedido
| Ponto | Resultado |
|---|---|
| A linha de códigos do cartão repete a ficha | **Sem achado.** A grade e a ficha são telas diferentes. O vendedor copia o código pela grade sem abrir a ficha, e na ficha a linha aparece uma vez só, no cabeçalho, porque o "Copiar código" da caixa própria saiu. Na mesma tela, nenhum código aparece 2 vezes. |
| O chip da filial repete o cabeçalho | No Catálogo, não: o cabeçalho diz "Catálogo · 1.284 produtos", sem a filial. Na **Rota**, o subtítulo "4 de 12 visitas · 38 km · **Boa Vista**" repete o chip `Boa Vista ✕` (**RD-0499**). |
| A dica da busca repete o placeholder | Repete, sim (**RD-0496**). |
| Os chips de Clientes repetem a folha | **Sem achado** na folha: a linha de chips sai da tela e vai para o grupo "Situação", e na tela fica só a etiqueta do que está marcado (o padrão). O que repete é a etiqueta `Devendo` em todas as linhas da lista, junto com o chip `Devendo ✕` (**RD-0500**). |
| O "0 em estoque" repete outro selo | Na ficha, o rótulo "**Estoque** na filial Boa Vista" vem em cima da etiqueta "0 em **estoque**", e as outras filiais aparecem em outro formato ("Manaus 12") (**RD-0497**). Na grade, o selo é um só. |
| Diagnóstico: Clientes com a carteira vazia | **RD-0501** |
| Diagnóstico: "DU — de 23" na Performance | **RD-0502** |

Fora da lista pedida, saiu também o "Limpar" da folha do Catálogo (**RD-0498**).

## 2. Achados
### RD-0496 · média · texto · designer-ux
- **Onde:** `05-busca-dica.png`, `catalogo-campo-v2/spec.md` §5.
- **O que se repete:** com o campo em foco e vazio, o placeholder "Código, marca, descrição…" e a dica "Busque por **código, marca, descrição**, aplicação ou referência cruzada." aparecem juntos. A dica repete 3 dos 5 termos e o verbo do campo.
- **Proposta:** a dica diz só o que o placeholder não diz.
  - Antes: "Busque por código, marca, descrição, aplicação ou referência cruzada."
  - Depois: "**Também acha por aplicação e referência cruzada.**"

### RD-0497 · média · texto · indicador · designer-ux
- **Onde:** `03-ficha-referencia-cruzada.png`, cartão de preço e estoque, e `spec.md` §2: "Estoque na filial Boa Vista", depois a etiqueta "0 em estoque" e depois "Manaus 12".
- **O que se repete:** "estoque" aparece 2 vezes seguidas, no rótulo e na etiqueta. O mesmo indicador, estoque por filial, aparece em 2 formatos no mesmo cartão: etiqueta para Boa Vista e linha com número para Manaus.
- **Proposta:** uma linha por filial, no mesmo formato. A filial do vendedor vem primeiro, com a etiqueta colorida no lugar do número.
  ```
  Preço
  R$ 86,40
  Boa Vista              [0 em estoque]
  Manaus                             12
  Atualizado às 07:28
  ```
  O rótulo "Estoque na filial Boa Vista" sai.

### RD-0498 · baixa · layout · designer-ux
- **Onde:** `06-folha-filtro.png`, a folha "Filtrar" do Catálogo, e `spec.md` §4 ("`Limpar` volta para a filial do vendedor").
- **O que se repete:** o grupo só tem uma escolha, e o toque aplica e fecha. "Limpar" faz o mesmo que tocar em "Boa Vista · sua filial", que é a 1ª linha da mesma folha. São 2 controles para a mesma ação.
- **Proposta:** a folha do Catálogo fica sem "Limpar". A filial do vendedor já está na lista, marcada como "sua filial". O "Limpar" continua nas folhas com vários grupos (Rota e Clientes), em que desfaz várias escolhas de uma vez.

### RD-0499 · média · texto · designer-ux
- **Onde:** `01-rota.png`, faixa "Rota de hoje" com o subtítulo "4 de 12 visitas · 38 km · **Boa Vista**" e o chip `Boa Vista ✕` logo embaixo. Na `filtro-padrao-campo/spec.md` §1, a contagem passa a ir para o subtítulo.
- **O que se repete:** a cidade filtrada aparece no subtítulo e no chip. O chip é o lugar do filtro: dá para ver e tirar ali.
- **Proposta:** "4 de 12 visitas · 38 km". A cidade fica só no chip.

### RD-0500 · média · texto · designer-ux (simulação) · modulo-core (tela)
- **Onde:** `03-clientes.png`: com o chip `Devendo ✕`, as 5 linhas trazem a etiqueta "Devendo".
- **O que se repete:** a mesma etiqueta em todas as linhas repete o filtro. Pela regra do catálogo de 12/11 (R-20261112-180115), a etiqueta igual em todas as linhas, ou que repete o título ou o filtro, sai.
- **Proposta:** a etiqueta da situação filtrada não aparece nas linhas. Com "Devendo" marcado, a linha mostra só o nome, "Visitado há…" e o ›. Se a pessoa marcar 2 situações, a linha mostra a que a distingue. Para isso, entra uma frase na spec §3: "a etiqueta da situação marcada no filtro não se repete nas linhas".

### RD-0501 · média · texto · modulo-core
- **Onde:** tela Clientes (`modules/core/app/telas/clientes.tsx`), achado do diagnóstico, citado na spec §3. Com a carteira vazia, a tela diz "Nenhum cliente com esses filtros".
- **O que se repete ou sobra:** a frase fala de filtros que não existem e não diz o fato, a carteira vazia. Encaminho também ao testes, porque o rótulo não bate com o estado.
- **Proposta:** com a carteira vazia, uma frase só: "**Sua carteira está vazia.**" A frase de filtro, "Nenhum cliente com esses filtros.", fica só quando há filtro ou busca.

### RD-0502 · baixa · texto · modulo-core
- **Onde:** Performance, linha do período (achado do diagnóstico): fora do dia útil, mostra "DU — de 23".
- **O que se repete ou sobra:** o "—" ocupa o lugar do número e obriga a pessoa a entender o traço, e o "de 23" sozinho não ajuda a decidir.
- **Proposta (do diagnóstico, que confirmo):** fora do dia útil, "**Não é dia útil · 11 restantes**". Em dia útil, continua "DU 11 de 23 · 12 restantes".

## 3. Conferido sem achado (e observações)
- **Folhas** de Rota e Clientes: "Limpar" desfaz tudo, e "Ver 4 visitas"/"Ver 5 clientes" dá a contagem antes de fechar. Não repetem a tela.
- **Performance:** o `Segmentado` e o `BotaoFiltro` estão na mesma linha, e a linha do filtro saiu. Não sobra nada.
- **Grade:** o "Equivale a Freiomax CB 3401" (`04`) aparece uma vez por cartão, só na busca que achou pela referência.
- **Observação sem RD (layout que não mudou neste lote):** na Performance, cada cartão traz o valor, a barra e "54% da meta de …". São 3 representações do mesmo número, e o checklist pede no máximo 2. A tela não mudou nesta simulação; registro para o próximo lote da Performance.
- **Encaminhado ao testes, sem RD:** na Rota filtrada (`01`), a etiqueta "3 feitas" conta a rota inteira, enquanto a lista e o subtítulo contam as 4 visitas do filtro, das quais 2 estão feitas. O rótulo e o número não batem com o que a tela mostra.

## 4. Reteste (15/11/2026, commits 860b064 e a4b88ed do designer-ux)
**Veredito: COM ACHADO.** Os 6 RD pedidos estão corrigidos. O RD-0498 foi **encerrado** porque a decisão mudou. Há **1 achado novo** de gravidade baixa, o RD-0504, que segura o lote.

Conferi as specs (`catalogo-campo-v2/spec.md`, `filtro-padrao-campo/spec.md`) e abri os 12 PNGs regerados como imagem, entre eles o novo `06-clientes-carteira-vazia.png`. As decisões são do dono do produto: R-20261115-073000 e R-20261115-074500.

| RD | Situação | Evidência |
|---|---|---|
| RD-0496 | **corrigido** | No `05-busca-dica.png`, a dica agora é "Também acha por aplicação e referência cruzada." e não repete o placeholder. |
| RD-0497 | **corrigido** | No `03-ficha-…png`, há uma linha por filial ("Boa Vista [0 em estoque]", "Manaus 12") e "Atualizado às 07:28". O rótulo "Estoque na filial…" saiu, e "estoque" aparece uma vez só. |
| RD-0498 | **encerrado** (não vale mais) | A folha do Catálogo ganhou o grupo "Itens sem estoque" (Mostrar/Ocultar), por decisão do dono do produto. Agora "Limpar" desfaz 2 escolhas e não repete nenhuma opção (`06-folha-filtro.png`). Confirmado. |
| RD-0499 | **corrigido** | O subtítulo da Rota ficou "4 de 12 visitas · 38 km", e a cidade está só no chip. A spec §1 ganhou a regra "o que já está num chip não se repete no subtítulo". |
| RD-0500 | **corrigido** | No `03-clientes.png`, com `Devendo ✕`, as linhas trazem só o nome, "Visitado há…" e o ›. A spec §3 tem a regra. |
| RD-0501 | **corrigido** | No `06-clientes-carteira-vazia.png`, aparece uma frase só, "Sua carteira está vazia.", com o ícone. O subtítulo "0 na carteira" saiu, porque dizia o mesmo (ajuste extra, conferido). |
| RD-0502 | **corrigido** | No `05-performance.png`, a linha mostra "Não é dia útil · 11 restantes". |

### Mudanças novas (decisões do dono do produto e ajustes do designer)
- **Cartão foto → nome → códigos** (`01`, `02`, `04`, `05`): "980 · Travex" fica em cima, e embaixo vem "PAF.1434" com o copiar. Cada código aparece uma vez no cartão, e o copiar fica ao lado do código que ele copia. A ficha repete a mesma linha numa linha só, mas é outra tela. **Sem achado.**
- **"Só com estoque"**: está descrito na spec §4 (o chip entra com `Ocultar`, e o selo soma 1), mas não há PNG desse estado. O chip e a opção da folha seguem o padrão (selo + chip). **Sem achado.** Confiro no print do aparelho na implementação.
- **"Ver 1.284 produtos"** na folha e "1.284 produtos" no cabeçalho: é o padrão das folhas de vários grupos, em que a contagem muda com a escolha antes de fechar. **Sem achado.**
- **Chips de Clientes dentro da folha** (decidido): a tela mostra só a etiqueta do que está marcado. **Sem achado.**
- **"Rota de ter, 18/11"**: o título troca "de hoje" pela data, e o chip `Ter, 18/11 ✕` continua. Título e chip dizem a mesma data, mas o título só muda quando ela não é hoje. Aceito como "manter?": o título diz de que dia é a rota, e o chip é o controle para voltar a hoje. **Sem achado.**
- **"2 feitas" na Rota filtrada**: a etiqueta conta as visitas do filtro (2 de 4), como o subtítulo, e não contradiz mais a lista. O encaminhamento ao testes do §3 fica resolvido na simulação.

### RD-0504 · baixa · layout · designer-ux (simulação) · modulo-core (tela)
- **Onde:** `06-clientes-carteira-vazia.png` (e a spec §3, carteira vazia): com a carteira vazia, a tela ainda mostra o `CampoBusca` "Nome, código, bairro ou CNPJ" e o `BotaoFiltro`.
- **O que sobra:** numa carteira vazia não há o que buscar nem filtrar. Os 2 controles não levam a nenhuma ação, e quem tocar só vai cair num 2º vazio ("Nenhum cliente com esses filtros").
- **Proposta:** com a carteira vazia, a tela fica só com a faixa ("Clientes" e a sincronização) e o `EstadoVazio` "Sua carteira está vazia.". A busca e o filtro aparecem quando houver ao menos um cliente. Na spec §3, acrescentar: "sem clientes na carteira, a linha da busca e do filtro não aparece".

## 5. Reteste final (15/11/2026, commit f7f3f4c do designer-ux)
**Veredito: LIMPO para a simulação inteira** (Catálogo v2 e filtro padrão).

| RD | Situação | Evidência |
|---|---|---|
| RD-0504 | **corrigido** | No `06-clientes-carteira-vazia.png` regerado, a tela tem só a faixa "Clientes", com a sincronização, e o `EstadoVazio` "Sua carteira está vazia.", sem busca e sem filtro. A spec §3 diz: "a linha de busca e o filtro também saem (RD-0504): não há o que buscar nem filtrar". O commit só mexe nesse PNG, no `.html` e nessa linha da spec, e não há achado novo. |

Situação final dos achados desta simulação:
- RD-0496, RD-0497 e RD-0499 a RD-0504: corrigidos;
- RD-0498: encerrado por decisão do dono do produto.

Nenhum achado em aberto. Os RD-0501 e RD-0502 são do modulo-core; na implementação, o reteste é no print do aparelho.

## 6. Parecer da versão aprovada (15/11/2026 ~08h20 de Manaus, commit fd17f346 do designer-ux)
**Veredito: COM ACHADO.** Há 1 achado de gravidade baixa em doc, o RD-0560, e ele segura o lote. A tela está limpa.

A decisão é do dono do produto (R-20261115-082500-alexandre): o rótulo passa a `Estoque: N` no cartão, na ficha e na busca, o zero fica `Estoque: 0` em vermelho e sai a variante de uma linha do cartão. Conferi o diff (`spec.md`, `catalogo-grade.md` §4, `.html`, `.css`) e abri como imagem os PNG 01 a 05 regerados.

### Tela: sem achado
- **Cartão** (`01`, `02`, `04`, `05`): a tag `Estoque: 12` / `Estoque: 0` é a única representação do estoque. "Estoque" aparece 1 vez por cartão, e a cor só reforça a faixa sem repetir o número. **Sem achado.**
- **Variante de uma linha**: saíram a tela, o CSS `.cods.uma`, o PNG e a pergunta da §7. Não sobrou nenhuma remissão a `card-1-linha` em `docs/design/catalogo-campo-v2/`. **Sem achado.**
- **Ficha** (`03`): `Boa Vista [Estoque: 0]` e, logo embaixo, `Manaus 12`. **Coerente, manter.** Explico em seguida.

### Ficha: o rótulo deve ser igual em todas as linhas?
**Não.** O formato atual é o certo para a regra "uma informação, um lugar":
1. As linhas ficam na mesma caixa, sem título. O `Estoque:` da primeira linha já diz o que é o número das outras. Escrever `Manaus  Estoque: 12` repetiria a palavra de contexto em todas as filiais, o que o checklist A não permite (no máximo 1 vez por cartão). Foi esse o motivo do RD-0497.
2. As duas formas não dizem a mesma coisa. A tag colorida marca a filial que vale para o preço e para o pedido do vendedor, e é ela que leva à decisão (vender ou fazer orçamento). As outras filiais são só consulta, por isso o número aparece sem cor. Se todas as linhas tivessem tag, todas teriam o mesmo peso, e a filial do vendedor deixaria de se destacar.
3. A filial do vendedor vem sempre primeiro (spec §2), então o rótulo fica logo acima dos números sem rótulo.

Na implementação, confiro no print do aparelho. Se a filial do vendedor não vier primeiro, ou se ela não tiver saldo e a linha sumir, o `Manaus 12` fica sem rótulo, e isso vira achado.

### RD-0560 · baixa · doc · designer-ux
- **Onde:** `docs/design/catalogo-campo-v2/spec.md` §3 e `docs/design/catalogo-grade.md` §4.
- **O que se repete:** a tabela das faixas (`Estoque: 84` sucesso · `Estoque: 6` aviso · `Estoque: 0` erro, "0, ou nenhum saldo recebido") está escrita duas vezes, com 3 linhas iguais. Este commit editou as duas, e cada doc aponta para o outro: a spec diz "o §4 já está com o rótulo novo", e o §4 diz "… `catalogo-campo-v2/spec.md` §3". Também o tenant que esconde a quantidade aparece com textos diferentes: a spec diz só `Sem estoque` ("premissa"), e o §4 diz `Em estoque`, `Pouco estoque`, `Sem estoque`.
- **Impacto:** manutenção. A próxima mudança de faixa ou de texto tem de ser feita nos dois lugares, e o caso do tenant que esconde a quantidade já diverge.
- **Proposta:** a fonte da verdade é o `catalogo-grade.md` §4, que é o doc permanente da tela.
  - Na spec §3, antes: frase + tabela + "Acaba o `Estoque sem informação` (…). Tenant que esconde a quantidade: `Sem estoque` (premissa; …)". Depois: "Rótulo `Estoque: N` em todo o Catálogo: cartão, ficha (filial do vendedor) e busca; sem saldo ou sem informação = `Estoque: 0`, vermelho (R-20261115-082500). Faixas e tenant que esconde a quantidade: `../catalogo-grade.md` §4. Acaba o `Estoque sem informação` (`modules/catalogo/app/lib/grade.ts:47` e `apresentacao.ts`, `rotuloEstoque`)."
  - No `catalogo-grade.md` §4, antes: "Rótulo `Estoque: N` e o fim do `Estoque sem informação`: `catalogo-campo-v2/spec.md` §3 (R-20261115-082500)." Depois: "Sem saldo recebido conta como 0; acaba o `Estoque sem informação` (R-20261115-082500)."

### Fora do escopo (sem RD)
- `docs/design/telas/T-0173-catalogo.html` ainda tem "120 em estoque". É a prancha histórica da T-0173, que não é a fonte desta tela. Não abri achado.
- `modules/catalogo/app/lib/grade.ts:51` (`… em estoque`) e o TalkBack de `:78` mudam na implementação do modulo-catalogo. Confiro no reteste do print.

## 7. Reteste do RD-0560 (15/11/2026 ~08h25 de Manaus, commit 251555dc do designer-ux)
**Veredito: COM ACHADO.** O RD-0560 está corrigido. Há 1 achado novo de gravidade baixa em doc, o RD-0561, e ele segura o lote.

| RD | Situação | Evidência |
|---|---|---|
| RD-0560 | **corrigido** | A tabela das faixas existe só no `catalogo-grade.md` §4. A spec §3 tem uma frase e a remissão ao §4, sem tabela e sem a linha do tenant. A spec não diz mais "o §4 já está com o rótulo novo", e o §4 não aponta mais para a spec. O tenant que esconde a quantidade está num lugar só (§4: `Em estoque`, `Pouco estoque`, `Sem estoque`). |

### RD-0561 · baixa · doc · designer-ux
- **Onde:** `docs/design/catalogo-campo-v2/spec.md` §3 e `docs/design/catalogo-grade.md` §4 (a frase depois da tabela).
- **O que se repete:** a regra "sem saldo = 0" aparece duas vezes em cada doc.
  - Na spec, o título "## 3. Estoque: sem saldo ou sem informação = 0" e logo depois a frase "sem saldo ou sem informação = `Estoque: 0`".
  - No §4, a linha da tabela "0, ou nenhum saldo recebido | `Estoque: 0`" e logo depois "Sem saldo recebido conta como 0".
  - Essa frase do §4 veio da minha proposta para o RD-0560, e a repetição passou no meu parecer (§6).
- **Impacto:** manutenção (pouco). O mesmo fato fica escrito duas vezes, a uma linha de distância.
- **Proposta:**
  - **Spec §3**, antes: "… e busca; sem saldo ou sem informação = `Estoque: 0`, vermelho (R-20261115-082500). …". Depois: "… e busca; o zero fica vermelho (R-20261115-082500). …". O título continua igual.
  - **`catalogo-grade.md` §4**, antes: "Sem saldo recebido conta como 0; acaba o `Estoque sem informação` (R-20261115-082500).". Depois: "Acaba o `Estoque sem informação` (R-20261115-082500).".

## 8. Reteste do RD-0561 (15/11/2026 ~08h30 de Manaus, commit f78ea0af do designer-ux)
**Veredito: COM ACHADO.** O RD-0561 está corrigido. O RD-0562 é novo, de gravidade baixa, em doc, e segura o lote até sair 1 linha.

| RD | Situação | Evidência |
|---|---|---|
| RD-0561 | **corrigido** | A spec §3 ficou com "…e busca; o zero fica vermelho (R-20261115-082500)". No §4 saiu "Sem saldo recebido conta como 0". O "sem saldo = 0" aparece uma vez em cada doc: no título da spec e na linha da tabela do §4. |

### RD-0562 · baixa · doc · designer-ux
- **Onde:** `docs/design/catalogo-grade.md` §4, linha 76, logo abaixo da tabela, e `docs/design/catalogo-campo-v2/spec.md` §3.
- **O que se repete:** a frase "Acaba o `Estoque sem informação`" está nos dois docs. Na spec, ela vem com os lugares do código. No §4, vem só o fato.
- **Decisão: o §4 perde a frase, e a spec fica com ela.**
  - "Acaba o X" descreve uma mudança, e não o estado da tela. A mudança é da spec, e é lá que o modulo-catalogo encontra o que mudar (`grade.ts:47`, `apresentacao.ts`).
  - O §4 é o doc permanente e já diz a regra na própria tabela ("0, ou nenhum saldo recebido | `Estoque: 0`"). Citar um rótulo que deixou de existir é só histórico.
- **Texto exato:**
  - No `catalogo-grade.md` §4, apagar a linha `Acaba o \`Estoque sem informação\` (R-20261115-082500).` e a linha em branco que vem depois dela. A tabela fica seguida direto do item "- Tenant que não mostra a quantidade …".
  - A spec §3 fica como está.
- **Fechamento:** o achado fecha quando eu conferir esse diff, sem mais nada a pedir.

## 9. Reteste do RD-0562 (15/11/2026 ~08h35 de Manaus, commit f41b0217 do designer-ux)
**Veredito: LIMPO.** RD-0562 **corrigido**: `git diff f78ea0af f41b0217` só apaga a linha "Acaba o `Estoque sem informação`" e a linha em branco do `catalogo-grade.md` §4; o item do tenant vem logo depois da tabela, com uma linha em branco; a frase fica só na spec §3. RD-0560 a RD-0562 corrigidos; nenhum achado em aberto no Catálogo v2.

## 10. Parecer do estoque na hora e por filial (15/11/2026 ~08h45 de Manaus, `git diff f41b0217 d4d41718`, designer-ux)
**Veredito: COM ACHADO.** 5 achados, RD-0571 a RD-0575 (2 médios e 3 baixos), todos do designer-ux. Todos seguram o lote: o RD-0575 está no corpo do teste, e não só no título, então a exceção de R-20261111-190159 não vale.

Decisões do dono do produto: R-20261115-083000, R-20261115-083600 e R-20261115-084600. Conferi o diff (`spec.md`, `catalogo-grade.md`, `.html`, `.css`, `icones.js`, `packages/ui` mobile e web, `icon.test.ts`) e abri como imagem os 4 PNG (vendedor com `Estoque: 0`, supervisor com 3 filiais e `Estoque: 17`, ficha e folha).

### Tela: o que está limpo
- **Cartão** (A, B): `Estoque: N` e o botão só com ícone `pacote` na mesma linha. "Estoque" aparece 1 vez por cartão, e o botão não tem texto, então não repete o chip. **Sem achado.**
- **Ficha** (C): `Estoque: 0` e `Por filial` se completam ("estoque" + "por filial"), sem repetir palavra. As linhas por filial e o `Atualizado às` saíram da ficha e estão só na folha. **Sem achado.**
- **Chip `Suas filiais (3) ✕` com o selo `1`**: segue o padrão já aceito (§4, selo + etiqueta). **Sem achado.**
- **Promotor sem número e sem botão** (spec §3): é o que pede a RN-CAT-05, sem resto na tela. **Sem achado.**
- **Laranja**: saiu do CSS (`.ce.av`) e da tabela do §4. **Sem achado de tela.** O texto dos docs está no RD-0572.

### Observações sem RD (`manter?`)
- **Subtítulo da folha `PAF.1434 · Atualizado às 07:28`**: o código também aparece na faixa da ficha, escurecida atrás da folha. Pela grade, porém, a folha cobre o cartão, e o código diz de qual produto é a tabela. A hora só está ali. Manter.
- **`docs/design/telas/icones.js`**: tem `caixa` (dos mockups antigos da T-0142) e agora `pacote`, dois desenhos de caixa parecidos. É só a biblioteca das simulações e não entra no app. Manter. Se um dia unificar, `pacote` é o do kit.

### RD-0571 · média · doc · designer-ux: a regra do N está escrita em 3 lugares e partida
- **Onde:** `docs/design/catalogo-campo-v2/spec.md` §3 ("Valor de N", a fonte) e §4 (linha 105, "O ✕ do chip mostra **Todas as filiais**: estoque somado"), e `docs/design/catalogo-grade.md` §4 ("Valor de N (filial do vendedor, soma das filiais do multi-filial, filial do filtro)").
- **O que se repete:** a soma de "Todas as filiais" aparece na spec §3 e na spec §4. O resumo das 3 regras aparece entre parênteses no §4 do grade. Além disso, um pedaço da regra ("Com cliente, a filial dele (RN-CORE-39)") está **só** no grade §4 e falta na lista da spec §3. Quem implementar pela spec não vê esse caso.
- **Proposta, texto exato:**
  - **Spec §3, "Valor de N":** acrescentar, depois de "vendedor: o estoque da filial dele;", a linha `  - com cliente: a filial do cliente (RN-CORE-39);`.
  - **Spec §4, linha 105.** Antes: "O ✕ do chip mostra **Todas as filiais**: estoque somado; o preço continua…". Depois: "O ✕ do chip mostra **Todas as filiais** (N no §3); o preço continua o da tabela da filial do vendedor (RN-VEN-01)."
  - **Grade §4, item do número.** Depois: "- O número é inteiro, na unidade base. Valor de N, o botão `Estoque por filial` e o `999+`: `catalogo-campo-v2/spec.md` §3. Sem hora no cartão." Saem o parêntese e o "Com cliente, a filial dele (RN-CORE-39)", que passa para a spec.

### RD-0572 · média · doc · designer-ux: as cores estão em 3 lugares, e uma frase ficou falsa
- **Onde:** `catalogo-grade.md` §4 (tabela, a fonte), spec §3 ("Cor, só duas": repete tons e contrastes) e spec §2.1 ("cor da quantidade" e "Só verde e vermelho: aqui não há o laranja de 1 a 9 da tag do cartão").
- **O que se repete:** a regra "acima de 0 verde, 0 ou negativo vermelho" está escrita 3 vezes. A frase da §2.1 diz que a tag do cartão tem o laranja, mas o laranja saiu do cartão neste mesmo diff. Foi a cópia que deixou a frase velha.
- **Proposta, texto exato:**
  - **Spec §3.** Antes: o item "**Cor, só duas** (…) … O "Risco de ruptura" da folha do item do pedido não muda.". Depois: "- **Cor:** a do `../catalogo-grade.md` §4, no chip e na tabela da folha (§2.1). O "Risco de ruptura" da folha do item do pedido não muda."
  - **Spec §2.1.** Antes: o item "**cor da quantidade** (R-20261115-083000): **acima de 0** em `success` … Negativo com o sinal de menos (`−2`).". Depois: "- **cor da quantidade**: a do §3, só no texto, sobre branco (`success` #1D6B4F, 6,4:1; `danger` #A8261B, 7,1:1). O número sempre aparece, e a cor nunca está sozinha. Negativo com o sinal de menos (`−2`)."
  - **Spec §2.1:** apagar o item "Só verde e vermelho: aqui não há o laranja de 1 a 9 da tag do cartão (`../catalogo-grade.md` §4)."

### RD-0573 · baixa · doc · designer-ux: "o estoque por filial fica na folha" aparece 2 vezes no grade
- **Onde:** `catalogo-grade.md` §2, no item "Uma informação por linha" ("o estoque por filial, na folha `Estoque por filial` (§4)"), e no último item do §4 ("Na ficha, o estoque de cada filial fica na folha `Estoque por filial`: `catalogo-campo-v2/spec.md` §2.1").
- **Proposta, texto exato:**
  - **Grade §4:** apagar o último item.
  - **Grade §2.** Antes: "…; o estoque por filial, na folha `Estoque por filial` (§4).". Depois: "…; o estoque por filial, na folha `Estoque por filial` (`catalogo-campo-v2/spec.md` §2.1)."

### RD-0574 · baixa · texto · designer-ux: o cabeçalho da tabela repete o título da folha
- **Onde:** `07-estoque-por-filial.png` / D: o título é "Estoque por filial", e logo abaixo vem o cabeçalho cinza "Filial | Estoque". Isso está na spec §2.1, no `.html` e no `.css` (`.tab-est .cab`).
- **O que se repete:** "Estoque" e "Filial", 2 vezes cada, a uma linha de distância. Uma faixa de 36 dp não acrescenta nada: o nome à esquerda é claramente a filial, e o número à direita é o estoque que o título anuncia. A própria spec admite isso para o leitor de tela: "O cabeçalho da tabela não é lido (cada linha já diz 'estoque')".
- **Proposta:**
  - **Tabela:** sai o cabeçalho, e a tabela começa direto na primeira filial, com as linhas de 48 dp, os números à direita e a divisória.
  - **Spec §2.1:** apagar o item "cabeçalho `Filial` (à esquerda) e `Estoque` (à direita), …, 36 dp" e a frase "O cabeçalho da tabela não é lido (cada linha já diz "estoque")".
  - **PNG 07 na tabela da spec.** Antes: "tabela Filial \| Estoque, sua filial primeiro…". Depois: "uma linha por filial, sua filial primeiro, uma filial em 0 e uma negativa".
  - **Se o dono do produto pediu o cabeçalho de colunas** junto com a "tabela" (R-20261115-083000), o achado fecha por decisão dele.

### RD-0575 · baixa · teste · designer-ux: o teste do ícone repete dois testes que já existem
- **Onde:** `packages/ui/src/mobile/icon.test.ts:34-45`, no teste "tem o pacote do estoque, com o mesmo desenho do IconPacote da web".
- **O que se repete:**
  - `expect(nomesDoTipo()).toContain('pacote')` faz a mesma conferência do teste "tem câmera e caixa de entrada" (`:22`).
  - `toContain('{...c}')` e `not.toMatch(/stroke=|strokeWidth=|fill=|#…/)` copiam o corpo do laço de "câmera e caixa de entrada seguem o padrão" (`:26-32`), com a mesma regex.
  - Só a comparação dos traços mobile × web é nova.
- **Impacto:** manutenção. Uma mudança na regra do padrão de traço passa a ter de ser feita em 2 lugares.
- **Proposta, texto exato:**
  - `:22`: título `'tem câmera, caixa de entrada e pacote (R-20261104-231124, T-0072, R-20261115-084600)'`, com `expect.arrayContaining(['camera', 'inbox', 'pacote'])`.
  - `:26`: título `'câmera, caixa de entrada e pacote seguem o padrão: traço comum, sem cor nem espessura própria'`, com `for (const nome of ['camera', 'inbox', 'pacote'])`.
  - O teste novo fica só com o que é dele:
```ts
  it('o pacote tem o mesmo desenho no kit mobile e no web (R-20261115-084600)', () => {
    const bloco = /case 'pacote':([\s\S]*?)\);\n/.exec(fonte)?.[1] ?? '';
    const web = readFileSync(new URL('../web/icons.tsx', import.meta.url), 'utf8');
    const blocoWeb = /export const IconPacote[\s\S]*?<\/Svg>/.exec(web)?.[0] ?? '';
    const tracos = (t: string) => [...t.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
    expect(tracos(bloco)).toHaveLength(4);
    expect(tracos(blocoWeb)).toEqual(tracos(bloco));
  });
```

Os RD-0576 a RD-0579 não foram usados.

## 11. Reteste dos RD-0571 a RD-0575 e parecer das filiais por perfil (15/11/2026 ~08h50 de Manaus, `git diff d4d41718 ad6e5537`, designer-ux)
**Veredito: COM ACHADO.** Dos 5 achados do §10, 4 estão corrigidos e o RD-0574 foi encerrado por decisão do dono do produto. Há 2 achados novos, RD-0576 (média) e RD-0577 (baixa), os dois em doc e do designer-ux, e os dois seguram o lote.

Abri como imagem o `08-grade-multi-filial.png` regerado. O chip `Suas filiais (3)` está sem ✕, e o `Estoque: 17` e o botão continuam. **A tela não tem achado.**

| RD | Situação | Evidência |
|---|---|---|
| RD-0571 | **corrigido** | A lista "Valor de N" da spec §3 ganhou "com cliente: a filial do cliente (RN-CORE-39)". A spec §4 diz "(N no §3)". O §4 do grade só remete à spec ("Valor de N, o botão … e o `999+`: … §3"). |
| RD-0572 | **corrigido** | A spec §3 diz "**Cor:** a do `../catalogo-grade.md` §4", e a §2.1 diz "a do §3, só no texto, sobre branco (…)". A frase do laranja saiu. |
| RD-0573 | **corrigido** | O último item do grade §4 saiu. O §2 remete à spec §2.1. |
| RD-0574 | **encerrado** por decisão do dono do produto | O cabeçalho `Filial \| Estoque` foi pedido em R-20261115-083000 ("tabelado: Coluna Filial… Coluna Estoque"), e a spec §2.1 registra isso. |
| RD-0575 | **corrigido** | `icon.test.ts`: `'pacote'` entrou nas listas de `:22` e `:26`, e o teste novo ficou só com a comparação mobile × web, com o texto proposto. |

### RD-0576 · média · doc · designer-ux: "só as filiais deles" está em 5 lugares
A pergunta foi se a regra de R-20261115-090000 está num lugar só: promotor, supervisor e gerente veem só as filiais deles, e o chip fica sem ✕. **Não está.** O lugar certo é a spec §4, o filtro, que diz quais filiais cada perfil vê. Ali a regra está completa: "Promotor, supervisor e gerente veem só as filiais deles", com os três casos do chip e a exceção do vendedor. Ela também aparece em:
1. a spec §2.1, na ordem da folha: "promotor, supervisor e gerente veem **só as filiais deles**, sem marca (todas seriam "sua")";
2. a spec §3, no "Valor de N": "Eles veem só as filiais deles (R-20261115-090000)";
3. a spec §3, no mesmo item: "`Todas as filiais`, que só o vendedor tem";
4. a spec §3, no item Promotor: "vê `Estoque: N`, o botão e a folha, **das filiais dele**";
5. o `catalogo-grade.md` §2, no item Promotor: "A tag e o botão de estoque aparecem, **das filiais dele**".

- **Impacto:** manutenção e decisão. A §4 diz que a restrição do vendedor ainda está em aberto ("Se o dono do produto quiser o vendedor também restrito…"). Se ela mudar, são 6 lugares para acertar.
- **Proposta, texto exato:** a spec §4 fica como está, e os outros lugares passam a remeter a ela.
  - **Spec §2.1, item da ordem.** Depois: "- **ordem** (R-20261115-083600): as filiais que o usuário vê (§4), as dele primeiro; o vendedor vê a dele com a marca `sua filial` (13 `ink2`, como no `Filtrar`); quem vê só as dele fica sem marca. Cada grupo em ordem alfabética;"
  - **Spec §3, "Valor de N".** Depois: "  - promotor, supervisor e gerente: a **soma** das filiais ligadas a ele (com uma só, a dela; o `modulo-core` expõe a lista);" e "  - filial escolhida no filtro (§4): só a daquela filial (R-20261115-084600); `Todas as filiais` (§4): a soma de todas."
  - **Spec §3, item Promotor.** Depois: "- **Promotor** (R-20261115-090000): vê `Estoque: N`, o botão e a folha. O preço segue a RN-CAT-05 de hoje (`promotor_ve_preco_estoque`); o modulo-catalogo ajusta a regra só para o estoque."
  - **Grade §2, item Promotor.** Depois: "- Promotor (RN-CAT-05, `promotor_ve_preco_estoque` = não): sem preço; a tag e o botão de estoque aparecem (`catalogo-campo-v2/spec.md` §3)."

### RD-0577 · baixa · doc · designer-ux: o TalkBack do cartão está em 2 docs, com textos diferentes
- **Onde:** `catalogo-grade.md` §2, que diz `"<nome>, <marca>, <preço>, <estoque>"` (ex.: "…, R$ 4,95, 6 em estoque", com o rótulo antigo), e a spec §3, que diz "TalkBack do cartão: `…, R$ 86,40, estoque 0`; depois, o botão". A linha da spec entrou no d4d41718, e eu não a vi no §10.
- **O que se repete:** a mesma regra, a leitura do cartão, em 2 lugares, e os exemplos já não batem ("6 em estoque" × "estoque 0").
- **Proposta, texto exato:** o grade §2 é a fonte (é onde o cartão é descrito).
  - **Grade §2.** Depois: "- TalkBack do cartão: `"<nome>, <marca>, <preço>, estoque <N>"` (ex.: "Açúcar cristal 1 kg, Doce Vale, R$ 4,95, estoque 6"); depois, o botão `Estoque por filial`."
  - **Spec §3, item "Botão no cartão":** apagar "TalkBack do cartão: `…, R$ 86,40, estoque 0`; depois, o botão." O resto fica.

### Observação sem RD
- **A restrição do vendedor ainda está em aberto.** Na spec §4, o vendedor continua vendo todas as filiais por decisão do designer, e R-20261115-090000 só cita promotor e supervisor. Isso é uma decisão de produto, não uma redundância. Deixo com o gerente, que deve confirmar com o dono do produto.

Os RD-0578 e RD-0579 não foram usados.

## 12. Reteste dos RD-0576 e RD-0577 (15/11/2026 ~08h55 de Manaus, `git diff ad6e5537 689b91b9`, designer-ux)
**Veredito: LIMPO.** Os dois achados estão corrigidos, e não há achado novo. O RD-0578 não foi usado.

| RD | Situação | Evidência |
|---|---|---|
| RD-0576 | **corrigido** | A regra "só as filiais deles" ficou só na spec §4. A §2.1 diz "as filiais que o usuário vê (§4)". O "Valor de N" da §3 perdeu "Eles veem só as filiais deles" e "que só o vendedor tem", e passou a remeter à §4. O item Promotor da §3 e o do grade §2 perderam "das filiais dele". Procurei "só as", "filiais d" e "que só o vendedor" na spec, no grade e no `.html`. Só sobram a lista das decisões no cabeçalho da spec e a legenda do PNG 08, que descrevem a origem e a imagem, e não a regra. |
| RD-0577 | **corrigido** | O TalkBack do cartão está só no grade §2: `"<nome>, <marca>, <preço>, estoque <N>"` (ex.: "…, R$ 4,95, estoque 6"), depois o botão `Estoque por filial`. Na spec §3 a frase saiu. |

- **Vendedor "em aberto"** (spec §4, R-20261115-090000): a decisão era do dono do produto e não contou como achado. Ela saiu no d6f194ac (abaixo).
- **R-20261115-090000 citado 2 vezes no item do vendedor**: o item foi reescrito no d6f194ac, e a dupla citação saiu.

### Linha nova da spec §4 (`git diff 689b91b9 d6f194ac`, decisão do dono do produto R-20261115-092000)
"**Vendedor vê todas as filiais da empresa** na folha "Estoque por filial"; o N do cartão e da ficha continua o da filial dele (§3)." **Sem achado:**
- O item substitui o "em aberto", a justificativa do designer e o "se o dono do produto quiser…". Ficam 2 linhas no lugar de 3, e a regra do vendedor continua só na §4.
- "O N … continua o da filial dele (§3)" não repete a regra do N. Ele separa o que a folha mostra (todas as filiais) do N do cartão (a filial dele) e remete à §3, que segue como fonte.
- O filtro do vendedor (a dele, as outras e `Todas as filiais`) continua só no 1º item da §4 e no grupo Filial da folha "Filtrar". A linha nova fala só da folha "Estoque por filial", sem repetir o filtro.
- A §2.1 ("as filiais que o usuário vê (§4)") passa a valer também para o vendedor, sem mudar o texto.

Situação do estoque do Catálogo v2: RD-0571, RD-0572, RD-0573, RD-0575, RD-0576 e RD-0577 corrigidos; RD-0574 encerrado por decisão do dono do produto. **Nenhum achado em aberto.**
