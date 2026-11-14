# Formulário com abas: pendências, saída e salvar com fila (T-0126)

> 2026-11-08 · designer-ux · teste de campo de domingo (R-20261108-101838-gerente-projetos, Frente C).
> Regras: **RN-CORE-36** (pendências de preenchimento), **RN-VEN-38** (sair do pedido), **RN-VEN-16** (frete FOB),
> **RN-VEN-30** (salvar → `na_fila`, somente leitura), **RN-VEN-13** (só orçamento), RN-VEN-18 (orçamento), RF-VEN-11 (Resumo).
> Vale para **o app inteiro**: hoje o Novo pedido; depois visita, pesquisa e cadastro. Os exemplos são do pedido; nos outros
> formulários, troque "pedido" pelo objeto ("Sair da pesquisa?", "Salvar pesquisa").
> Kit: `packages/ui/src/mobile/pendencias.ts` (puro, testado em `pendencias.test.ts`) e `pendencias-rn.tsx`
> (`FolhaSairDoFormulario`, `FolhaRetomarRascunho`); a marca do campo é a do §0.0 item 3.
> Telas: modulo-vendedor (T-0127 Frente D, T-0128 Frente E, T-0130 Frente G). Interceptação da saída: engenheiro-apps (T-0128).
> **Atualizado em 08/11 tarde (T-0133, Novo pedido v2):** o pedido tem 4 abas (**Venda · Itens (n) · Entrega · Resumo**);
> "aba Detalhes" virou **aba Venda** (forma, prazo, alertas) ou **aba Entrega** (endereço, frete, transportadora, observações);
> o Resumo tem 4 botões (Salvar e enviar pedido · Apenas salvar · Salvar como orçamento · Cancelar), sem a folha intermediária
> "Salvar pedido"; a folha "Sair do pedido?" usa os mesmos rótulos (§2.2). Padrão das abas, Resumo, detalhe e tags:
> `pedido-v2.md`.
> **Substitui**: o `PendenciasDoPedido` (Banner vermelho com os erros juntos + botão "Corrigir frete") e o `DialogoDescartar`
> solto do Cancelar. Atualiza `novo-pedido-itens.md` §1 ("as pendências do pedido ficam antes do Avançar" deixa de valer).

## 0.0 Falta no campo, só na tentativa (T-0166, 12/11; vale para o app inteiro)
> Pedido do dono do produto R-20261112-031457 e corretor R-20261112-033620 (pré-aprovado; RD-0170, RD-0179, RD-0182, RD-0184).
> **Substituiu** o bloco "Falta para salvar", a bolinha na aba e o salvar desligado por falta (saíram deste doc; o histórico
> fica no git). O §1 (o domain decide o que falta) e o §2 em diante (saída, retomada, fila) continuam.
> No Novo pedido, as medidas e os textos estão no `pedido-v4.md` §6.

1. **Antes de tentar**, campo vazio é estado normal: sem vermelho, sem bolinha, sem linha de falta, sem chip "Obrigatória" em
   vermelho. Formulário recém-aberto não mostra nenhuma falta.
2. **Tentativa** = o toque no botão que conclui (Salvar e enviar, Salvar como orçamento, Transformar, Concluir checkout,
   Enviar pesquisa) ou, no formulário com abas, sair da aba pelo Avançar (só as faltas daquela aba). O botão fica **sempre
   tocável**; com falta, o toque não conclui: marca os campos, leva ao 1º campo marcado e o TalkBack lê a 1ª falta.
3. **Marca do campo** (kit: `faltaVisivel`, `TextoDaFalta`, `bordaDaFalta`; o `CampoEscolha` já traz a prop `falta`): borda
   `danger` 2 dp e, embaixo, ícone `alerta` 14 + texto curto 12,5/600 `danger` ("Obrigatório", "CNPJ inválido"…). Valor
   inválido digitado aparece **ao sair do campo**, sem esperar a tentativa.
4. **Some sozinho** quando corrigido. Nenhum bloco de lista das faltas: no pedido, as faltas das outras abas vão para a
   área Alertas (só na tentativa; a da aba aberta fica só no campo, RD-0189); fora do pedido, a marca no campo basta.
5. **Checkout da visita** (`rota-catalogo-perfil.md` §2; RD-0182): antes da tentativa, a etapa obrigatória não feita tem o selo
   **`Obrigatória` neutro** (`neutralBg`/`neutralInk`). Ao tocar em **Concluir checkout** com etapa pendente, a etapa troca
   para o selo **`Falta`** (erro) com borda `danger` na linha, e a folha rola até a 1ª etapa marcada. A linha "Falta concluir:
   …" continua fora (RD-0094: a etapa marcada já diz).
6. **Pesquisa** (RD-0184): saem os chips `Falta 1 obrigatória`, `Pronta para enviar` e `Salvo no aparelho` (fica o "3 de 5").
   Ao tocar em Enviar com obrigatória vazia, a pergunta ganha a marca do campo ("Obrigatória") e a tela rola até a 1ª marcada.
   A faixa vermelha fica só para erro que não é de pergunta. Sai o subtítulo da folha Enviar ("Vai quando houver sinal.").
7. **Kit (RD-0179):** saíram o `BlocoPendencias`, o `abasComPendencia` e as funções do bloco (`ordenarPendencias`,
   `linhaDaPendencia`, `leituraDaPendencia`, `dicaDaPendencia`, `leituraDoBloco`). O `leituraDoSalvar` também saiu
   (RD-0235): o salvar é sempre tocável e lê só o rótulo.

## 0. Princípios
1. **Nada some sem escolha.** Toda saída de formulário alterado pergunta; o rascunho está sempre no aparelho.
2. **Salvar é instantâneo.** A tela fecha na hora; o envio é da fila, em segundo plano, com ou sem sinal.

## 1. Pendências de preenchimento (RN-CORE-36)

### 1.1 Quem decide o quê
- O **`domain` do módulo** lista as pendências (função pura, teste antes), cada uma com `{ id, texto, aba, campo? }`
  (`PendenciaPreenchimento`). Ex. do pedido: forma de pagamento, prazo, frete FOB sem transportadora, nenhum item.
- O kit só desenha a marca do campo (§0.0 item 3); a tela liga as peças.

### 1.2 Texto de cada pendência (o `texto` que o domain manda)
Substantivo do que falta, inicial maiúscula, sem verbo de ordem, sem ponto final. A linha em Alertas do pedido segue o
`pedido-v4.md` §6.1.

| Situação (pedido) | `texto` | Aba |
|---|---|---|
| sem item | `Pelo menos 1 item` | Itens |
| sem forma de pagamento | `Forma de pagamento` | Venda |
| forma escolhida, sem prazo (ou o prazo saiu da forma) | `Prazo de pagamento` | Venda |
| FOB sem transportadora (RN-VEN-16) | `Transportadora do frete FOB` | Entrega |
| FOB com transportadora digitada sem CNPJ | `CNPJ da transportadora` | Entrega |
| item com quantidade fora do múltiplo (RN-VEN-21) | `Quantidade de <código> em múltiplos de <n>` | Itens |

O que **não** é pendência de preenchimento: desconto acima da alçada (não impede salvar: vai para o supervisor), cliente da
RN-VEN-13 (muda as opções do salvar, §2.3), crédito vencido
(aviso do cartão Crédito, RN-VEN-13). Texto novo de pendência passa pela revisão do designer-ux.

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

| Opção | Prop do kit | Ícone / tom | O que faz |
|---|---|---|---|
| **Salvar e enviar pedido** | `salvar` | `send` · destaque | valida; sem falta, segue o §4.1 (fecha na hora); com falta, fecha a folha e faz a tentativa (§0.0 item 2) |
| **Apenas salvar** | `apenasSalvar` | `file` · neutro | grava `rascunho` **com ou sem falta** e segue para a saída pedida; aviso "Pedido salvo" |
| **Salvar como orçamento** | `salvarAlternativo` | `edit` · neutro | valida como o Resumo; com falta, fecha a folha e faz a tentativa (§0.0 item 2); sem, salva (RN-VEN-18) e abre o orçamento |
| **Descartar** | `descartar` | `trash` · perigo | abre a confirmação (§2.4) |
| Continuar editando | `continuar` | rodapé de texto | fecha a folha e fica no formulário |

Sem subtítulo nas opções (RD-0193): cada uma mostra só o rótulo.

- Com falta, os dois botões continuam tocáveis: o toque é a tentativa.
- A saída pedida (ex.: aba Pedidos) é **cancelada** quando a pessoa salva com falta (Salvar e enviar pedido ou Salvar como
  orçamento) ou escolhe Continuar editando; segue depois de Apenas salvar, de salvar sem falta ou de descartar.
- Toque fora da folha e Voltar do Android com a folha aberta = **Continuar editando** (nunca descartam).
- Tenant sem orçamento (pré-venda desligada): sem a linha Salvar como orçamento.
- Com o "Salvar e enviar pedido" a folha tem um só destaque laranja (o ícone); não há botão principal dentro dela.
- Edição de pedido já salvo (não é Novo pedido): mesmo padrão com "Salvar alterações".
- Editar orçamento: **Salvar orçamento** · **Descartar** · **Continuar editando**, só com os rótulos (RD-0234).

### 2.3 Variante do cliente da RN-VEN-13 (bloqueado, inativo, cadastro incompleto)
A mesma folha **sem** Salvar e enviar pedido: só **Apenas salvar**, **Salvar como orçamento** e **Descartar** (+ Continuar
editando). **Sem linha de motivo** abaixo do título (T-0166, RD-0176): o motivo já está na área Alertas do pedido.

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
- **Descartar** (`trash` · perigo), com a mesma confirmação do §2.4 (sem subtítulo, RD-0234).
- Rodapé **"Agora não"**: guarda o rascunho e fecha. Toque fora e Voltar fazem o mesmo. O rascunho volta a ser oferecido na
  próxima abertura do app e, se a pessoa abrir um Novo pedido para o mesmo cliente, ele abre já com o rascunho.
- Mais de um rascunho interrompido: a folha oferece o mais recente; os outros, nas aberturas seguintes (um de cada vez).
- Quem dispara é o módulo dono do rascunho (Vendedor), pelo mesmo ponto de extensão do shell do §2.1.

### 2.6 TalkBack da folha
- A folha é anunciada pelo título ("Sair do pedido?"); cada opção lê só o rótulo.
- O diálogo é `alert`: lê o título e a mensagem; o foco começa em [Voltar].

## 3. Textos finais (copiar exatamente)
| Onde | Texto |
|---|---|
| folha | `Sair do pedido?` · `Salvar e enviar pedido` · `Apenas salvar` · `Salvar como orçamento` · `Descartar` · `Continuar editando` |
| confirmação | `Descartar este pedido?` · `Os itens e os dados deste pedido serão apagados do aparelho.` · `Voltar` · `Descartar` |
| retomada | `Pedido não terminado` · `Continuar pedido de <cliente>` / `<n> itens · R$ x · alterado às hh:mm` · `Descartar` · `Agora não` |
| salvo | `Pedido salvo · enviando` (§4) · `Pedido salvo` (Apenas salvar) |

## 4. Salvar e fila (RN-VEN-30, acréscimo de 08/11; RF-VEN-04, RN-CORE-23, RN-VEN-33)

### 4.1 O toque em "Salvar e enviar pedido" (Resumo ou folha Sair)
1. Valida no aparelho (offline). Com falta, faz a tentativa (§0.0 item 2).
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
- Desabilitado: texto `#5B6673` sobre `#ECEEF1` (5,03:1), sem transparência.

## 6. Componentes do kit a usar
| Peça | Componente | Observação |
|---|---|---|
| salvar | `Botao nivel="principal"` sempre tocável; secundários `Botao alto quebrarLinha` | um só principal; `pedido-v2.md` §2.2 |
| cancelar | texto 14/600 `ink2`, alvo 48 dp | abre a folha de saída se alterado |
| folha de saída | `FolhaSairDoFormulario` (`salvar`, `apenasSalvar`, `salvarAlternativo`, `descartar`) | sem `salvar` = variante RN-VEN-13 |
| retomada | `FolhaRetomarRascunho` | na 1ª tela depois de reabrir |
| detalhe na fila / não aceito | `ChipEstado`, `Banner` (`anunciar`), `Botao`, `AvisoRodape` | §4 |

## 7. Critérios de revisão (designer-ux, nas T-0127, T-0128 e T-0130)
1. Formulário recém-aberto sem nenhuma marca de falta; na tentativa, os campos marcados e o foco no 1º.
2. As 5 saídas abrem a folha com o formulário alterado; nenhuma apaga sem a confirmação.
3. Salvar fecha a tela em < 1 s, sem indicador girando; detalhe com "Pedido salvo · enviando" e nenhuma ação de edição.
4. Contraste do §5 (texto laranja só `accentInk`).
