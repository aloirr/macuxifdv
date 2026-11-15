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
