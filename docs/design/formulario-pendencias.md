# Formulário com abas: pendências, saída e salvar com fila (T-0126)

> 2026-11-08 · designer-ux · teste de campo de domingo (R-20261108-101838-gerente-projetos, Frente C).
> Regras: **RN-CORE-36** (pendências de preenchimento), **RN-VEN-38** (sair do pedido), **RN-VEN-16** (frete FOB),
> **RN-VEN-30** (salvar → `na_fila`, somente leitura), **RN-VEN-13** (só orçamento), RN-VEN-18 (orçamento), RF-VEN-11 (Resumo).
> Vale para **o app inteiro**: hoje o Novo pedido; depois visita, pesquisa e cadastro. Os exemplos são do pedido; nos outros
> formulários, troque "pedido" pelo objeto ("Sair da pesquisa?", "Salvar pesquisa").
> Kit: `packages/ui/src/mobile/pendencias.ts` (puro, testado em `pendencias.test.ts`) e `pendencias-rn.tsx`
> (`BlocoPendencias`, `FolhaSairDoFormulario`, `FolhaRetomarRascunho`); a bolinha é a do `Abas` (`formulario.tsx`).
> Telas: modulo-vendedor (T-0127 Frente D, T-0128 Frente E, T-0130 Frente G). Interceptação da saída: engenheiro-apps (T-0128).
> **Atualizado em 08/11 tarde (T-0133, Novo pedido v2):** o pedido tem 4 abas (**Venda · Itens (n) · Entrega · Resumo**);
> "aba Detalhes" virou **aba Venda** (forma, prazo, alertas) ou **aba Entrega** (endereço, frete, transportadora, observações);
> o Resumo tem 4 botões (Salvar e enviar pedido · Apenas salvar · Salvar como orçamento · Cancelar), sem a folha intermediária
> "Salvar pedido"; a folha "Sair do pedido?" usa os mesmos rótulos (§2.2). Padrão das abas, Resumo, detalhe e tags:
> `pedido-v2.md`.
> **Substitui**: o `PendenciasDoPedido` (Banner vermelho com os erros juntos + botão "Corrigir frete") e o `DialogoDescartar`
> solto do Cancelar. Atualiza `novo-pedido-itens.md` §1 ("as pendências do pedido ficam antes do Avançar" deixa de valer).

## 0. Princípios
1. **Um lugar só para o que falta.** As pendências moram no fim do formulário, onde a pessoa vai salvar. Nas outras abas, nada
   de alerta, faixa vermelha, borda vermelha no campo ou botão "Corrigir": só a bolinha na aba.
2. **Falta não é erro.** Pedido começando sempre tem pendência (sem item, sem prazo). Por isso o bloco é **âmbar** (aviso), não
   vermelho. Vermelho fica para o que deu errado de fato: crédito vencido (RN-VEN-13) e pedido não aceito (§4.3).
3. **Nada some sem escolha.** Toda saída de formulário alterado pergunta; o rascunho está sempre no aparelho.
4. **Salvar é instantâneo.** A tela fecha na hora; o envio é da fila, em segundo plano, com ou sem sinal.

## 1. Pendências de preenchimento (RN-CORE-36)

### 1.1 Quem decide o quê
- O **`domain` do módulo** lista as pendências (função pura, teste antes), cada uma com `{ id, texto, aba, campo? }`
  (`PendenciaPreenchimento`). Ex. do pedido: forma de pagamento, prazo, frete FOB sem transportadora, nenhum item.
- O **kit** ordena, escreve a linha, monta a leitura do TalkBack e diz que abas têm bolinha (`ordenarPendencias`,
  `linhaDaPendencia`, `leituraDaPendencia`, `abasComPendencia`, `leituraDoSalvar`). A tela só liga as peças.

### 1.2 Texto de cada pendência (o `texto` que o domain manda)
Substantivo do que falta, inicial maiúscula, sem verbo de ordem, sem ponto final. O kit acrescenta " — aba X".

| Situação (pedido) | `texto` | Aba | Linha no bloco |
|---|---|---|---|
| sem item | `Pelo menos 1 item` | Itens | Pelo menos 1 item — aba Itens |
| sem forma de pagamento | `Forma de pagamento` | Venda | Forma de pagamento — aba Venda |
| forma escolhida, sem prazo (ou o prazo saiu da forma) | `Prazo de pagamento` | Venda | Prazo de pagamento — aba Venda |
| FOB sem transportadora (RN-VEN-16) | `Transportadora do frete FOB` | Entrega | Transportadora do frete FOB — aba Entrega |
| FOB com transportadora digitada sem CNPJ | `CNPJ da transportadora` | Entrega | CNPJ da transportadora — aba Entrega |
| item com quantidade fora do múltiplo (RN-VEN-21) | `Quantidade de <código> em múltiplos de <n>` | Itens | Quantidade de AGU-1500 em múltiplos de 6 — aba Itens |

O que **não** é pendência de preenchimento e **não** entra no bloco: desconto acima da alçada (não impede salvar: vai para o
supervisor, e o Resumo já diz "Vai para o supervisor"), cliente da RN-VEN-13 (muda as opções do salvar, §2.3), crédito vencido
(aviso do cartão Crédito, RN-VEN-13). Texto novo de pendência passa pela revisão do designer-ux.

### 1.3 Bloco "Falta para salvar" (`BlocoPendencias`)
- **Onde:** só na **última aba** (no pedido, o Resumo), **logo acima** dos botões de salvar, no fim do conteúdo (rola junto).
- **Sem pendência:** o bloco não aparece (nem vazio, nem "Tudo certo").
- **Visual:** fundo `warningBg` `#FFF1D6`, raio 14, sem borda. Cabeçalho com ícone `alert` e o rótulo **FALTA PARA SALVAR**
  (12/600, maiúsculas, `warningInk`). Uma linha por pendência, 48 dp no mínimo: marcador redondo de 6 dp, **o que falta**
  (14/600 `ink`) + **" — aba Entrega"** (14 `ink2`) e a seta `chevron` (`warningInk`) à direita. O texto quebra em quantas
  linhas precisar (fonte grande do sistema); nada é cortado.
- **Ordem:** a das abas (Venda → Itens → Entrega → Resumo), que é a ordem em que se preenche; dentro da aba, a ordem dos campos na tela
  (a que o domain mandar). Ex.:
  ```
  ⚠ FALTA PARA SALVAR
  •  Prazo de pagamento — aba Venda                       ›
  •  Transportadora do frete FOB — aba Entrega            ›
  [ Salvar e enviar pedido ]                 ← desabilitado
  [ Apenas salvar ] [ Salvar como orçamento ] ← Apenas salvar habilitado
  Cancelar
  ```
- **Pendência da própria última aba** (raro): a linha não diz a aba ("Motivo do desconto"); o toque rola até o campo.

### 1.4 Tocar na linha leva à aba (decisão)
**Sim: a linha inteira é um atalho para a aba** (e a tela rola até o `campo`, se houver). Não há botão "Corrigir" nem outro
elemento na linha. Por quê:
- O que o dono do produto tirou foi o **botão de correção nas outras abas** ("Corrigir frete" na aba Itens, que apontava para
  o lugar errado e competia com o Avançar). A linha do bloco não acrescenta nada à tela: é o mesmo texto, que já diz a aba.
- Sem o atalho, a pessoa lê "aba Entrega", sobe até as abas e toca. Com ele, é **1 toque** do Resumo até o campo, o que mantém
  a regra dos 3 toques e ajuda no sol e na pressa.
- Quem não percebe que a linha é tocável não perde nada: o texto continua dizendo onde corrigir.
- A seta `›` é o sinal visual (o mesmo da `LinhaAtalho` e das listas), sem cor de link e sem palavra de ordem.
- TalkBack: a linha é lida "Falta: Transportadora do frete FOB, na aba Entrega", com a dica "Abre a aba Entrega".

Ao chegar na aba pelo atalho: a aba muda sem animação (como o toque na aba), a tela rola até o campo deixando-o no terço de cima
e o foco do TalkBack vai para o campo. **Nenhuma marca** no campo (sem borda vermelha, sem texto de erro): o campo vazio já
mostra o placeholder ("Escolha", "Escolha a transportadora"). Voltar ao Resumo é pelo Avançar ou pela aba.
Se o dono do produto preferir as linhas sem toque, o kit já aceita: sem `onIr`, a linha só lê (premissa a confirmar na revisão).

### 1.5 Bolinha na aba (`Abas`, prop `pendente`)
- Ponto de **8 dp** à direita do rótulo, na cor `danger` (`#A8261B`, 6,4:1 no fundo; gráfico ≥ 3:1). É o ponto que o `Abas`
  já desenha; não muda. Vermelho e não laranja porque a bolinha laranja já quer dizer "novo" (Recados, Início).
- Aparece em **toda aba com pendência menos a última** (`abasComPendencia`): a última já tem o bloco.
- Aparece desde a abertura do formulário (pedido novo: bolinhas em Venda e Itens) e some sozinha quando a pendência some, sem animação.
- TalkBack: `rotuloPendencia="com pendência"` (`LEITURA_ABA_COM_PENDENCIA`) → "Entrega, com pendência, aba, 3 de 4".
  O módulo troca o texto atual ("Pendência nesta aba") por este.
- A bolinha nunca vem com outro sinal na aba (sem número, sem ícone de alerta) e nunca fica na aba errada: a aba da bolinha é
  a `aba` da pendência que o domain mandou.

### 1.6 Botões de salvar (Resumo; hierarquia e estados completos em `pedido-v2.md` §2.2–2.3)
- Enquanto houver pendência, **[Salvar e enviar pedido] e [Salvar como orçamento] desabilitados** (`desligado`; cinza
  `#E6E9E2` com texto `#5B6673`, sem transparência). O motivo está logo acima, no bloco. **[Apenas salvar] continua habilitado**
  (grava o rascunho com pendência, RN-VEN-38) e Cancelar também.
- TalkBack: `rotuloAcessivel={leituraDoSalvar('Salvar e enviar pedido', n)}` → "Salvar e enviar pedido. Falta para salvar:
  2 pendências, na lista acima" (o "desativado" o TalkBack fala sozinho pelo `accessibilityState`).
- Sem pendência, [Salvar e enviar pedido] é o principal da tela (52 dp, `accent` com texto `onAccent`), com o destino embaixo
  ("Vai direto ao ERP" / "Vai para o supervisor"). **Não há mais a folha "Salvar pedido"**: os botões fazem direto o que dizem.

### 1.7 Anúncios (acessibilidade)
- O cabeçalho do bloco é região viva educada: quando a contagem muda, o TalkBack lê "Falta para salvar: 1 pendência".
- Quando a pessoa chega ao Resumo **vinda da folha de saída** com pendência (§2.2), a tela incrementa a prop `anuncio` e o bloco
  é lido inteiro: "Falta para salvar: 2 pendências. Falta: Prazo de pagamento, na aba Venda. Falta: Transportadora do frete FOB,
  na aba Entrega".
- Na troca normal de aba não há anúncio (seria ruído).

### 1.8 Estados da última aba
| Estado | Bloco | [Salvar e enviar pedido] | Bolinhas |
|---|---|---|---|
| pedido novo, nada preenchido | Forma de pagamento · Prazo de pagamento (aba Venda) · Pelo menos 1 item (aba Itens) | desabilitado (Apenas salvar habilitado) | Venda, Itens |
| itens e pagamento ok, FOB sem transportadora | Transportadora do frete FOB — aba Entrega | desabilitado (Apenas salvar habilitado) | Entrega |
| tudo preenchido | não aparece | principal habilitado | nenhuma |
| pedido `na_fila` ou enviado (só leitura, §4.2) | não aparece | não aparece | nenhuma (sem abas) |

## 2. Folha "Sair do pedido?" (RN-VEN-38) — padrão de saída de formulário alterado

### 2.1 Quando abre
Com o formulário **alterado** (pelo menos 1 item ou 1 campo mudado desde que abriu), **qualquer** saída abre a folha:
Voltar do cabeçalho (`BackLink`), gesto ou botão Voltar do Android, toque em Início/Rota/Clientes/Pedidos/Mais na barra
inferior e Cancelar do Resumo. Sem alteração, sai direto (nada a perguntar). Folha, diálogo e menu abertos fecham antes
(regra do §6.1 do `componentes.md`). A interceptação da barra inferior e do gesto é do **shell** (engenheiro-apps, T-0128), como
ponto de extensão reutilizável: o formulário diz "estou alterado" e recebe "a pessoa quer sair para X"; o shell só segue para X
depois que a tela liberar.

### 2.2 Conteúdo (`FolhaSairDoFormulario`)
Título **"Sair do pedido?"**. Opções (`OpcaoFolha`, 56 dp), nesta ordem, com os **mesmos rótulos dos botões do Resumo**
(T-0133, RN-VEN-38):

| Opção | Prop do kit | Ícone / tom | Subtítulo | O que faz |
|---|---|---|---|---|
| **Salvar e enviar pedido** | `salvar` | `send` · destaque | **Vai para a fila de envio** | valida; sem pendência, segue o §4.1 (fecha na hora); com pendência, fecha a folha e abre o Resumo com o bloco (§1.7) |
| **Apenas salvar** | `apenasSalvar` | `file` · neutro | **Guarda sem enviar** | grava `rascunho` **com ou sem pendência** e segue para a saída pedida; aviso "Pedido salvo" |
| **Salvar como orçamento** | `salvarAlternativo` | `edit` · neutro | **Válido até 15/11** (`validade_orcamento_dias`, dd/mm no fuso do tenant) | valida como o Resumo; com pendência, abre o Resumo com o bloco; sem, salva (RN-VEN-18) e abre o orçamento |
| **Descartar** | `descartar` | `trash` · perigo | **Apaga este pedido** | abre a confirmação (§2.4) |
| Continuar editando | `continuar` | rodapé de texto | — | fecha a folha e fica no formulário |

- Com pendência, Salvar e enviar pedido e Salvar como orçamento **não** ficam desabilitados na folha: o toque leva ao bloco,
  que diz o que falta. (Desabilitar aqui obrigaria a explicar duas vezes.) Apenas salvar nunca leva ao bloco.
- A saída pedida (ex.: aba Pedidos) é **cancelada** quando a pessoa salva com pendência (Salvar e enviar pedido ou Salvar como
  orçamento) ou escolhe Continuar editando; segue depois de Apenas salvar, de salvar sem pendência ou de descartar.
- Toque fora da folha e Voltar do Android com a folha aberta = **Continuar editando** (nunca descartam).
- Tenant sem orçamento (pré-venda desligada): sem a linha Salvar como orçamento.
- Com o "Salvar e enviar pedido" a folha tem um só destaque laranja (o ícone); não há botão principal dentro dela.
- Edição de pedido já salvo (não é Novo pedido): mesmo padrão com "Salvar alterações" · "Vai para a fila de envio".
- Editar orçamento: **Salvar orçamento** (`salvar`, ícone `edit`, sem subtítulo) · Descartar ("Descarta as alterações") ·
  Continuar editando.

### 2.3 Variante do cliente da RN-VEN-13 (bloqueado, inativo, cadastro incompleto)
A mesma folha **sem** Salvar e enviar pedido: só **Apenas salvar**, **Salvar como orçamento** e **Descartar** (+ Continuar
editando). Logo abaixo do título,
a linha `aviso` (13 `ink2`) com o motivo, para a falta da opção não parecer erro:
- bloqueado: **"Cliente bloqueado: só dá para salvar como orçamento"**
- inativo: **"Cliente inativo: só dá para salvar como orçamento"**
- cadastro incompleto: **"Cadastro do cliente incompleto: só dá para salvar como orçamento"**
O domain diz qual (o `motivo_so_orcamento` de hoje); o texto é este.

### 2.4 Confirmação do Descartar
`Dialogo` com `perigo` (mesmo do kit), aberto **no lugar** da folha (a folha fecha e o diálogo aparece; não empilha):
- Título **"Descartar este pedido?"**
- Mensagem **"Os itens e os dados deste pedido serão apagados do aparelho."**
- [Voltar] (neutro) volta **à folha**, não ao formulário · [Descartar] (vermelho) apaga o rascunho e segue para a saída pedida.
- Voltar do Android no diálogo = [Voltar]. Nada é apagado no 1º toque.
- Depois de descartar: sem aviso no rodapé (a pessoa acabou de confirmar; um "Desfazer" aqui contradiria o diálogo).

### 2.5 Retomada depois que o sistema fecha o app (`FolhaRetomarRascunho`)
O rascunho é gravado no aparelho a cada alteração, sem nada na tela. Se o Android fechar o app com um formulário alterado
aberto, na **primeira tela depois de reabrir** (o Início, ou a tela que o shell restaurar) sobe a folha:
- Título **"Pedido não terminado"**
- **Continuar pedido de Mercadinho São Jorge** (`edit` · destaque) — subtítulo **"2 itens · R$ 55,53 · alterado às 10h34"**
  (`tituloDaRetomada('pedido', cliente)`, `apoioDaRetomada([...])`; hora no fuso do tenant; "alterado ontem às 18h10" se for
  de outro dia). Abre o Novo pedido na aba em que estava.
- **Descartar** (`trash` · perigo) — **"Apaga este pedido"**, com a mesma confirmação do §2.4.
- Rodapé **"Agora não"**: guarda o rascunho e fecha. Toque fora e Voltar fazem o mesmo. O rascunho volta a ser oferecido na
  próxima abertura do app e, se a pessoa abrir um Novo pedido para o mesmo cliente, ele abre já com o rascunho.
- Mais de um rascunho interrompido: a folha oferece o mais recente; os outros, nas aberturas seguintes (um de cada vez).
- Quem dispara é o módulo dono do rascunho (Vendedor), pelo mesmo ponto de extensão do shell do §2.1.

### 2.6 TalkBack da folha
- A folha é anunciada pelo título ("Sair do pedido?"); cada opção lê título e subtítulo ("Salvar e enviar pedido. Vai para a
  fila de envio").
- O diálogo é `alert`: lê o título e a mensagem; o foco começa em [Voltar].
- Na variante da RN-VEN-13, a linha do motivo é lida logo depois do título.

## 3. Textos finais (copiar exatamente)
| Onde | Texto |
|---|---|
| bloco | `Falta para salvar` |
| linha | `<o que falta> — aba <Aba>` |
| aba com bolinha (TalkBack) | `com pendência` |
| salvar desabilitado (TalkBack) | `Salvar e enviar pedido. Falta para salvar: 2 pendências, na lista acima` |
| folha | `Sair do pedido?` · `Salvar e enviar pedido` / `Vai para a fila de envio` · `Apenas salvar` / `Guarda sem enviar` · `Salvar como orçamento` / `Válido até dd/mm` · `Descartar` / `Apaga este pedido` · `Continuar editando` |
| confirmação | `Descartar este pedido?` · `Os itens e os dados deste pedido serão apagados do aparelho.` · `Voltar` · `Descartar` |
| RN-VEN-13 | `Cliente bloqueado: só dá para salvar como orçamento` (e as variantes do §2.3) |
| retomada | `Pedido não terminado` · `Continuar pedido de <cliente>` / `<n> itens · R$ x · alterado às hh:mm` · `Descartar` / `Apaga este pedido` · `Agora não` |
| salvo | `Pedido salvo · enviando` (§4) · `Pedido salvo` (Apenas salvar) |

## 4. Salvar e fila (RN-VEN-30, acréscimo de 08/11; RF-VEN-04, RN-CORE-23, RN-VEN-33)

### 4.1 O toque em "Salvar e enviar pedido" (Resumo ou folha Sair)
1. Valida no aparelho (offline). Com pendência, volta ao Resumo com o bloco (§1.7).
2. Grava o pedido como `na_fila` e **fecha a tela em menos de 1 s**. Sem `ocupado` girando no [Salvar], sem esperar a rede.
   Vibração leve do principal no toque; transição de avançar (240 ms; sem animação com "reduzir movimento").
3. O editor sai da pilha (`replace`) e abre o **detalhe do pedido** (de lá, o voltar leva para onde o pedido começou, §6.1).
4. O envio sai pela fila comum, em segundo plano, com retentativa e o UUID do aparelho (reenvio não duplica).

### 4.2 Detalhe do pedido enquanto `na_fila` (somente leitura)
De cima para baixo: BackLink · título "Pedido 000013" · cliente · `ChipEstado` **`neutro` "Na fila"** · faixa · cartão do pedido.
- Faixa (`Banner`, ícone `sync`, `anunciar`), sem ponto final:
  - com sinal: **"Pedido salvo · enviando"**
  - sem sinal (`wifiOff`): **"Pedido salvo · vai quando houver sinal"**
- **Nenhuma ação de edição**: sem Editar, sem Excluir, sem campo editável; o ajuste do pedido aparece como `LinhaValor`
  (padrão de só leitura do `componentes.md` §7.1). PDF e Compartilhar continuam (não mudam o pedido).
- "Enviar agora" (com sinal) continua como `Botao` secundário, para quem não quer esperar a próxima tentativa.
- Na lista Pedidos, o mesmo chip "Na fila"; o contador da aba Pedidos (tom `aviso`) é o número na fila e some quando ela esvazia.
- Quando a fila entrega: o chip muda para o estado que voltou (os rótulos de hoje, ex.: `aviso` "Aguardando aprovação"), a
  faixa some. Se o detalhe estiver aberto, `AvisoRodape` **"Pedido 000013 enviado"** (2,5 s, sem Desfazer).

### 4.3 Pedido não aceito (recusa da API)
- `ChipEstado` **`erro` "Não aceito"** (na lista e no detalhe).
- `Banner tone="danger"` com o motivo, no padrão de texto que já existe (`textoNaoFoiAceito`): **"Não foi aceito: <motivo>"**
  e, na segunda frase, o que fazer: **"Corrija e salve de novo."** Motivos conhecidos (o módulo traduz o código; nunca mostra o
  código cru):
  | Código | Motivo na tela |
  |---|---|
  | `preco_abaixo_minimo` | `preço de AGU-1500 abaixo do mínimo` |
  | `cliente_bloqueado` | `cliente bloqueado no ERP` |
  | `item_inativo` | `AGU-1500 não está mais à venda` |
  | `estoque_insuficiente` | `estoque de AGU-1500 não atende a quantidade` |
  | outro | `o Macuxi recusou o pedido. Fale com seu supervisor` (sem "Corrija…") |
- Botão **principal "Corrigir pedido"**: reabre o editor com o pedido (volta a `rascunho`, RN-VEN-31) na aba do problema
  quando o motivo apontar uma (preço → Itens). Ao salvar, segue o §4.1 de novo. Um só principal na tela.
- Sem "Rejeitado" aqui: "Rejeitado" é decisão do supervisor (RN-VEN-30); "Não aceito" é a recusa do Macuxi.

## 5. Contraste (regra do `componentes.md` §1.1, vale para todas as peças acima)
- **Texto laranja sobre claro = `accentInk` `#8F3D06`** (6,7:1 no fundo, 7,4:1 no branco). Nenhum texto em `colors.accent`.
- **Sobre o laranja cheio = `onAccent`** (branco, 4,6:1): o [Salvar] principal e o contador da aba Pedidos.
- O `accent` é só preenchimento e gráfico: botão principal, borda da aba ativa, ícone da opção "Salvar e enviar pedido" no quadrado
  `accentSoft` (3,9:1, gráfico ≥ 3:1).
- Bloco âmbar: `ink` 15:1, `ink2` 6,8:1 e `warningInk` 9,0:1 sobre `warningBg`. Bolinha `danger` 6,4:1 no fundo das abas.
- Desabilitado: texto `#5B6673` sobre `#E6E9E2` (4,8:1), sem transparência.

## 6. Componentes do kit a usar
| Peça | Componente | Observação |
|---|---|---|
| abas do formulário | `Abas` (`pendente`, `rotuloPendencia="com pendência"`) | `pendente` = `abasComPendencia(...).has(id)` |
| bloco | `BlocoPendencias` (`pendencias`, `abas`, `onIr`, `anuncio`) | só na última aba, acima dos botões de salvar |
| salvar | `Botao nivel="principal"` com `desligado` e `rotuloAcessivel={leituraDoSalvar(...)}`; secundários `Botao alto quebrarLinha` | um só principal; `pedido-v2.md` §2.2 |
| cancelar | texto 14/600 `ink2`, alvo 48 dp | abre a folha de saída se alterado |
| folha de saída | `FolhaSairDoFormulario` (`salvar`, `apenasSalvar`, `salvarAlternativo`, `descartar`) | sem `salvar` = variante RN-VEN-13 |
| retomada | `FolhaRetomarRascunho` | na 1ª tela depois de reabrir |
| detalhe na fila / não aceito | `ChipEstado`, `Banner` (`anunciar`), `Botao`, `AvisoRodape` | §4 |

## 7. Critérios de revisão (designer-ux, nas T-0127, T-0128 e T-0130)
1. Nenhum alerta, faixa ou botão de correção nas abas que não são a última; bolinha só na aba certa.
2. Bloco só na última aba, acima dos botões de salvar, com os textos do §3; Salvar e enviar pedido desabilitado e com o motivo
   no TalkBack; Apenas salvar habilitado.
3. As 5 saídas abrem a folha com o formulário alterado; nenhuma apaga sem a confirmação.
4. Salvar fecha a tela em < 1 s, sem indicador girando; detalhe com "Pedido salvo · enviando" e nenhuma ação de edição.
5. Contraste do §5 (texto laranja só `accentInk`).
