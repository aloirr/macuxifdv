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
