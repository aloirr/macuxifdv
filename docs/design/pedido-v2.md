# Novo pedido v2: 4 abas, Resumo completo, desconto compacto, detalhe e histórico em tags (T-0133)

> 2026-11-08 · designer-ux · Frente H do Novo pedido v2 (tarefa-mãe T-0131). Texto literal do dono do produto:
> R-20261108-131606-gerente-projetos (2ª rodada do teste de campo de domingo, prints das 12:43, 12:45 e 12:59).
> Regras: **RF-VEN-11** (4 abas, Resumo), **RF-VEN-05** (detalhe), **RN-VEN-30** (tags do histórico), **RN-VEN-18** (orçamento,
> preço congelado, desconto em R$ por unidade no item), **RN-VEN-38** (sair do pedido), **RN-CORE-36** (pendências),
> RN-VEN-12/13 (crédito, bloqueio), RN-VEN-16 (frete sem valor), RN-VEN-10 (alçada).
> Telas: modulo-vendedor (K T-0136, L T-0137, M T-0138). Gestão (pedido em nome) e BKO usam o mesmo cabeçalho e as mesmas tags.
> **Substitui**: as 3 abas Itens · Detalhes · Resumo de `novo-pedido-itens.md` (§1 e o cartão de forma/prazo na aba Itens), a
> folha intermediária "Salvar pedido → Enviar pedido / Salvar como orçamento" (`formulario-pendencias.md` §1.6) e o desconto do
> pedido com 4 botões grandes e campo −/+. Onde os textos da manhã dizem "aba Detalhes", vale **aba Venda** (forma, prazo, alertas)
> ou **aba Entrega** (endereço, frete, transportadora, observações).

> **2026-11-09 (T-0141):** partes desta spec foram substituídas por `pedido-v3.md`: §1.2 (crédito vira tabela), §1.3 (sai a
> árvore/"Catálogo" da aba Itens), §1.4 (sai a frase do frete; endereço editável só no pedido), §2.3 (sai "Válido até"), §4.1,
> §4.3 e §5.1 (orçamento sem validade: "Orçamento · preço de dd/mm", sem "vencido"), §8 (textos). Onde as duas divergem, vale a v3.

## 0. Princípios
1. **Informação antes de botão.** No detalhe, o que o pedido é ocupa a tela; as ações cabem num rodapé de 2 linhas.
2. **Um principal por tela**, sempre o próximo passo natural. As outras ações são secundárias ou ícone + rótulo curto.
3. **Uma linha para o desconto**, a mesma no item e no pedido.
4. **Histórico é estado, não frase.** Tag curta com data e hora; motivo só quando muda a decisão (Rejeitado, Cancelado).
5. **Nunca texto técnico** ("Recebido pelo servidor", código de status cru).

## 1. As 4 abas (RF-VEN-11)

### 1.1 Barra de abas
`Abas` do kit, logo abaixo do cabeçalho com o cliente, com 4 abas de largura igual (6": 80 dp cada):

| Aba | Rótulo (exato) | Bolinha de pendência (RN-CORE-36) |
|---|---|---|
| Venda | `Venda` | forma ou prazo faltando |
| Itens | `Itens (n)` (`rotuloComContador('Itens', n)`; `Itens (0)` no início) | nenhum item; múltiplo (RN-VEN-21) |
| Entrega | `Entrega` | FOB sem transportadora; transportadora digitada sem CNPJ |
| Resumo | `Resumo` | nunca (o bloco "Falta para salvar" está nela) |

- A tela **abre na aba Venda**. Toque na aba muda sem animação. Cada aba guarda a própria rolagem.
- **Sem título grande dentro da aba** (a aba já diz onde se está; poupa altura no 6"). As seções usam `RotuloSecao`.
- Rodapé fixo nas 3 primeiras abas: `RodapeTotal` **"Total do pedido" · R$ x · [Avançar ›]** (Venda → Itens → Entrega →
  Resumo). No Resumo, o rodapé fixo sai e os botões ficam no fim do conteúdo (§2.3).
- **Toques do pedido mais simples** (cliente sem alerta, CIF, 1 item): escolher forma e prazo, Avançar, incluir o item, tocar
  na aba Resumo (ou Avançar 2×), Salvar e enviar pedido = 3 toques de navegação/salvar, contra 4 na versão de 3 abas (a folha
  intermediária saiu). Nenhum toque a mais.

### 1.2 Aba Venda
De cima para baixo:
```
ALERTAS
⚠ Cliente inadimplente · 1 título vencido · R$ 3.400,00 · 12 dias
  Só à vista ou com aprovação
⛔ Cliente bloqueado · só orçamento                    ← quando houver
(sem alerta: ✓ Cliente liberado · sem título vencido)

FORMA DE PAGAMENTO        PRAZO
[Boleto ˅]                [28/56 dias ˅]

CRÉDITO DO CLIENTE          ← substituído (T-0141): tabela Limite · Disponível · Prazo médio, pedido-v3.md §A
⟳ Atualizado hoje às 10:27
```
- **Alertas** (`RotuloSecao "Alertas"` + uma `Faixa` por alerta, empilhadas com 6 dp):
  | Situação | Faixa | Texto (`texto` / `apoio`) |
  |---|---|---|
  | título vencido (RN-VEN-13) | `aviso` | `alertaInadimplencia({ titulos, valorCents, dias, consequencia: CONSEQUENCIA_VENCIDO })` → "Cliente inadimplente · 1 título vencido · R$ 3.400,00 · 12 dias" / "Só à vista ou com aprovação" |
  | bloqueado (RN-VEN-13) | `erro` | "Cliente bloqueado · só orçamento" |
  | inativo | `erro` | "Cliente inativo · só orçamento" |
  | cadastro incompleto | `erro` | "Cadastro incompleto · só orçamento" |
  | crédito excedido (RN-VEN-12) | `aviso` | "Limite excedido · disponível R$ 4.000,00" / "Vai para aprovação" |
  | nenhum | `ok` | `TEXTO_CLIENTE_LIBERADO` = "Cliente liberado · sem título vencido" (uma linha só; sem o rótulo ALERTAS) |
  Ordem: erro antes de aviso. Os textos da consequência vêm do domain do Vendedor (a regra é dele); estes são os aprovados.
- **Forma de pagamento** e **Prazo**: duas `ListaSuspensa` lado a lado (metade cada), rótulos `Forma de pagamento` e `Prazo`,
  placeholder `Escolha`. Forma indisponível com motivo (T-0129) e Prazo desligado até escolher a forma, como hoje.
- **Limite** e **Prazo médio do cliente**: `LinhaValor` ("Limite" · "R$ 10.000,00 · disponível R$ 4.000,00"; "Prazo médio do
  cliente" · "45 dias"). Disponível negativo: `tomValor="erro"`. Cliente sem dados financeiros: uma linha "Sem dados de crédito
  deste cliente".
- **Atualização**: ícone `sync` (sem sinal: `wifiOff`) + `textoAtualizacao(...)` ("Atualizado hoje às 10:27"), 12 `ink2`.
- Offline: tudo do aparelho; nada some sem sinal.

### 1.3 Aba Itens (n)
Igual à versão de hoje (`novo-pedido-itens.md`), **sem o cartão de forma/prazo**. No topo, "Total do pedido · n itens"; busca +
árvore do catálogo; itens com quantidade e **desconto compacto** (§3). No fim da aba: **Leve mais e pague menos**
(`CartaoLeveMais`) e **Combina com o pedido**, que vieram da aba Detalhes.

### 1.4 Aba Entrega
```
ENDEREÇO DE ENTREGA                                   Trocar
Rua Pará, 137 · São Geraldo · Manaus/AM

FRETE
[  CIF  ] [  FOB  ]
                                             ← sem frase (T-0141, pedido-v3.md §B)
TRANSPORTADORA  [Escolha a transportadora ˅]  ← só FOB (lista ou digitar)

OBSERVAÇÕES
[                                       ]
```
- Endereço: `RotuloSecao "Endereço de entrega"` com a ação **Trocar** (`accentInk`); texto 14 `ink`. Um endereço só: sem Trocar.
- Frete: `Segmentado` CIF | FOB (48 dp). Abaixo, **uma** frase, a da modalidade escolhida (13 `ink2`). **Sem campo de valor de
  frete** (RN-VEN-16): se um dia houver, é RN nova.
- FOB: a lista de transportadoras (ou digitar), como hoje. Sem transportadora, a bolinha fica na aba Entrega; nada vermelho aqui.
- Observações: campo de texto de várias linhas, placeholder "Observação para a entrega ou o pedido".

## 2. Resumo completo (RF-VEN-11, T-0137)

### 2.1 Conteúdo, nesta ordem (só leitura, menos o desconto do pedido)
```
Mercadinho São Jorge · cód. C5002
VENDA      Boleto · 28/56 dias
           ⚠ Vai para aprovação (título vencido)
ITENS      Água mineral 1,5 L (fardo 6) · 1 FD ........ R$ 19,90
ENTREGA    Rua Pará, 137 · São Geraldo · Manaus/AM · CIF
OBS.       —

DESCONTO DO PEDIDO   [Desc % ˅][   1,0 ]   −R$ 0,20

Tabela                                   R$ 19,90
Descontos                               −R$ 0,20
Total                                    R$ 19,70
✓ 1,0% · dentro da alçada

⚠ FALTA PARA SALVAR                               ← só quando houver
•  Transportadora do frete FOB — aba Entrega      ›

[        Salvar e enviar pedido        ]          ← principal, largura total
            Vai direto ao ERP
[ Apenas salvar ]  [ Salvar como orçamento ]      ← secundários, metade cada
               Cancelar                           ← texto, abre "Sair do pedido?"
```
- Cliente: 16 `title16` `ink`, "Nome · cód. C5002".
- Linhas VENDA, ITENS, ENTREGA, OBS.: `LinhaResumo` (rótulo de 64 dp à esquerda). VENDA leva o `alerta` (aviso ou erro) quando a
  aba Venda tem alerta que muda o destino ("Vai para aprovação (título vencido)", "Cliente bloqueado · só orçamento"). ITENS usa
  `linhas` (um `LinhaValor` por item: "nome · qtd medida" ··· total). ENTREGA: endereço · CIF, ou endereço · FOB · transportadora.
  OBS. vazia: "—". Nenhuma linha é tocável (para corrigir, a aba; o atalho é o do bloco de pendências).
- **Desconto do pedido**: `DescontoCompacto` com `rotulo="Desconto do pedido"` (§3). É o único campo editável do Resumo.
- Totais: `BlocoTotais` (Tabela, Descontos, Total) + `Faixa` da alçada (ok "1,0% · dentro da alçada"; aviso "6,0% · vai para o
  supervisor"; erro só se o domain bloquear).
- Bloco **Falta para salvar**: `BlocoPendencias`, logo acima dos botões (`formulario-pendencias.md` §1, com "aba Venda/Entrega").

### 2.2 Os 4 botões: hierarquia
| Botão | Nível | Tamanho | Texto embaixo |
|---|---|---|---|
| **Salvar e enviar pedido** | `Botao nivel="principal"` | 52 dp, largura total | destino, 12 `ink2` centralizado: "Vai direto ao ERP" ou "Vai para o supervisor" (RN-VEN-10/13) |
| **Apenas salvar** | `Botao nivel="secundario" alto quebrarLinha` | 52 dp, metade | — |
| **Salvar como orçamento** | `Botao nivel="secundario" alto quebrarLinha` | 52 dp, metade (quebra em 2 linhas no 6") | — |
| **Cancelar** | texto 14/600 `ink2`, centralizado, alvo 48 dp (o mesmo do rodapé da `Folha`) | — | — |

Cancelar não é laranja nem botão: é a saída, não uma ação do pedido. Vão de 8 dp entre os secundários e 10 dp entre as linhas.

### 2.3 Estados
| Estado | Salvar e enviar pedido | Apenas salvar | Salvar como orçamento | Outros |
|---|---|---|---|---|
| sem pendência | habilitado, com o destino | habilitado | habilitado | — |
| com pendência | `desligado`, sem o destino; TalkBack `leituraDoSalvar('Salvar e enviar pedido', n)` | **habilitado** (grava `rascunho` com pendência) | `desligado`; TalkBack `leituraDoSalvar('Salvar como orçamento', n)` | bloco acima |
| cliente da RN-VEN-13 | **não aparece** | secundário, largura total | **principal**, largura total, texto embaixo "Válido até 15/11" | `Faixa erro` acima dos botões: "Cliente bloqueado: só dá para salvar como orçamento" (e variantes de `formulario-pendencias.md` §2.3) |
| Editar orçamento | **Salvar orçamento** (principal, largura total) | — | — | **Transformar em pedido** (secundário, largura total) · Cancelar |
| Editar pedido (`rascunho`, rejeitado) | igual a "sem/com pendência" | igual | igual | — |
| `na_fila` ou depois | sem abas (detalhe só leitura, §4) | | | |

- Salvar e enviar pedido: segue a Frente G (grava `na_fila`, fecha a tela em < 1 s, sem indicador girando).
- Apenas salvar: grava `rascunho`, fecha a tela e mostra `AvisoRodape` **"Pedido salvo"** (sem Desfazer). Na lista Pedidos, tag
  **Salvo**; ao reabrir, o Resumo mostra o bloco do que falta.
- Salvar como orçamento: congela os preços (RN-VEN-18) e abre o detalhe do orçamento.
- Sem folha intermediária: cada botão faz o que diz em 1 toque.

### 2.4 Folha "Sair do pedido?" com os rótulos novos (RN-VEN-38)
Atualizada em `formulario-pendencias.md` §2.2: **Salvar e enviar pedido · Apenas salvar · Salvar como orçamento · Descartar ·
Continuar editando**. O kit tem a opção nova `apenasSalvar` em `FolhaSairDoFormulario` (ação `apenas_salvar`).

## 3. Desconto compacto, o mesmo no item e no pedido (`DescontoCompacto`)
```
item:    [− 6 +]  [Desc % ˅][ 5,0 ]  −R$ 1,00/FD
pedido:  DESCONTO DO PEDIDO  [Desc % ˅][ 1,0 ]  −R$ 0,20
```
- **Uma linha de 44 dp**, a altura do `Passo` compacto do item (`DESCONTO_COMPACTO.altura`). Com fonte grande, o rótulo do
  pedido quebra em 2 linhas e a linha cresce; nada é cortado.
- **Tipo**: lista Desc %, Desc R$, Acrésc %, Acrésc R$ (`TIPOS_AJUSTE`), menu ancorado do `CampoAjuste`. Tipo desabilitado
  (ex.: acréscimo não permitido no tenant) com cadeado e motivo.
- **Valor**: digitável, teclado decimal, **sem − e +**. Vazio = 0. Cada número válido vale na hora.
- **Equivalente** ao lado, na mesma linha (`equivalenteDoAjuste`): tipo em % mostra R$; tipo em R$ mostra %.
  Desconto em verde `success` com "−" (U+2212): "−R$ 0,20", "−1,0%". Acréscimo em `ink2` com "+": "+R$ 1,50". No item, R$ por
  unidade com a medida: "−R$ 1,00/FD" (RN-VEN-18). Sem valor, sem equivalente. Acima do limite (`erro`): borda e equivalente em
  `danger`; o motivo vem em texto perto, pela tela (a `Faixa` da alçada no Resumo).
- TalkBack: o tipo lê "Tipo do ajuste do pedido: Desconto em porcentagem"; o valor lê o `rotuloAcessivel`; o equivalente lê
  "Equivale a R$ 0,20 de desconto" (região viva educada).
- No item: sem `rotulo`, o campo cresce (`flexGrow`) e a linha do item quebra abaixo do `Passo` quando não cabe (360 dp).
- No pedido: `rotulo="Desconto do pedido"`, campo de 124 dp.
- Trocar o tipo com valor: o domain converte pelo equivalente (como hoje no item); sem valor, só troca o tipo.

## 4. Detalhe do pedido/orçamento (RF-VEN-05, T-0138)

### 4.1 Ordem
```
‹ Pedidos                                         ⋮

Orçamento 000012                     [Orçamento · até 15/11]
Mercadinho São Jorge · cód. C5002
Vendedor: Lucas Andrade

ITENS
Água mineral 1,5 L (fardo 6) · 1 FD              R$ 19,90

──────────────────────────────────────────────
Total                                            R$ 19,90
Pix · À vista · CIF

HISTÓRICO
[Salvo · 08/11 10:35]

[ ↑ Transformar em pedido ]
 ✎ Editar     ▤ PDF     ⧉ Duplicar
```
1. **Cabeçalho em destaque** (sem cartão, direto no fundo): `BackLink` à esquerda e `MenuMais` (⋮) à direita, na mesma linha.
   Título `h1Small` 24 "Orçamento 000012" / "Pedido 000013", com a tag de tipo/status à direita na mesma linha (quebra para
   baixo se não couber): `Selo tamanho="m" pilula`, tom `roxo` "Orçamento · até 15/11" (vencido: tom `aviso` "Orçamento ·
   vencido"); no pedido, a tag do status atual, igual à última do histórico (§5). Cliente 16 `ink` "Nome · cód. C5002";
   "Vendedor: Lucas Andrade" 13 `ink2`. No Gestão e no BKO, o mesmo.
2. **Itens**: `RotuloSecao "Itens"` + um `LinhaValor` por item ("nome · qtd medida" ··· total); desconto do item numa 2ª linha
   12 `ink2` quando houver ("Desc 5,0% · −R$ 1,00/FD"). Mais de 8 itens: os 8 primeiros e "Ver os 23 itens" (`LinkTexto`).
3. **Total**, separado por um traço (`LinhaValor destaque divisor`): "Total" ··· R$; abaixo, 13 `ink2`, "forma · prazo · frete"
   ("Pix · À vista · CIF"; FOB: "Boleto · 28/56 dias · FOB · Transportes Rio Negro"). Com desconto do pedido, Tabela e Descontos
   acima do Total (o `BlocoTotais` sem cartão).
4. **Histórico**: `RotuloSecao "Histórico"` + `HistoricoEmTags` (§5).
5. **Ações**: `RodapeAcoes` fixo no fim da tela (§4.4).

Sem "Recebido pelo servidor", sem frase de validade no histórico (a validade está na tag do cabeçalho), sem "não reserva
estoque nem consome crédito" (é regra, não estado).

### 4.2 Faixa de estado (só quando pede ação ou explica espera)
- `na_fila`: a faixa de `formulario-pendencias.md` §4.2 ("Pedido salvo · enviando" / "Pedido salvo · vai quando houver sinal").
- Não aceito: §4.3 de lá ("Não foi aceito: <motivo>. Corrija e salve de novo.").
- Nos outros estados, nenhuma faixa: a tag do cabeçalho e o histórico bastam.

### 4.3 Ações por estado
| Registro / estado | Principal (botão grande) | Ícone + rótulo curto (ordem) | Menu ⋮ |
|---|---|---|---|
| orçamento aberto | **Transformar em pedido** (`send`) | Editar (`edit`) · PDF (`file`) · Duplicar (`copy`) | Cancelar orçamento |
| orçamento vencido | **Duplicar** (`copy`), texto embaixo "Entra pelos preços de hoje" | PDF | — |
| orçamento transformado | — | PDF · Duplicar · "Pedido" (`chevron`, abre o pedido gerado) | — |
| pedido `rascunho` (Salvo) | **Continuar pedido** (`edit`) | — | Descartar pedido |
| pedido `na_fila` | — (o "Enviar agora" da faixa, se houver sinal) | PDF | — |
| pedido não aceito | **Corrigir pedido** (`edit`) | PDF · Duplicar | Cancelar pedido |
| pedido enviado, em aprovação, aprovado | — | Editar (se o domain permitir) · PDF · Duplicar | Cancelar pedido (se o domain permitir; RN-VEN-31) |
| rejeitado | **Corrigir pedido** (`edit`) | PDF · Duplicar | Cancelar pedido |
| recebido no ERP, faturado, cancelado | — | PDF · Duplicar | — |

Quem decide se a ação existe é o domain (`orderActions`, RN-VEN-31); a tabela diz onde ela fica. Promotor nunca vê ações de
pedido (regra 7).

### 4.4 Rodapé compacto (`RodapeAcoes`) e menu ⋮ (`MenuMais`)
- `RodapeAcoes` fixo, fundo branco com traço em cima, área segura embaixo. **1 principal** de 52 dp, largura total (com `apoio`
  opcional, 12 `ink2`), e abaixo **uma linha** com até 4 ações de ícone 18 + rótulo 13/600 `ink`, largura dividida, alvo 48 dp.
  Sem principal, só a linha (o rodapé fica com 48 dp + respiros).
- Rótulo curto: 1 palavra, até 10 letras (`rotuloCurtoOk`): **Editar · PDF · Duplicar · Pedido**. A leitura do TalkBack é a
  completa ("Editar orçamento", "Baixar o PDF do orçamento", "Duplicar orçamento").
- `MenuMais`: botão ⋮ (ícone `mais`, 48 × 48 dp) no cabeçalho, TalkBack "Mais ações do orçamento". Abre `Folha` com as opções
  (`OpcaoFolha`; destrutiva em `perigo`) e o rodapé "Voltar". Opção destrutiva pede confirmação (`Dialogo perigo`); Voltar do
  diálogo volta à folha:
  - **Cancelar orçamento** → "Cancelar este orçamento?" · "Ele continua na lista como cancelado e não pode mais virar pedido." ·
    [Voltar] [Cancelar orçamento]
  - **Cancelar pedido** → "Cancelar este pedido?" · "O pedido não será enviado ao ERP." (enviado com ERP que aceita:
    "O cancelamento será pedido ao ERP.") · [Voltar] [Cancelar pedido]. O motivo, quando a regra pedir, é um campo no diálogo
    (fica com o modulo-vendedor; o texto passa pela revisão).
  - **Descartar pedido** → o diálogo do §2.4 de `formulario-pendencias.md`.
- Depois de cancelar: `AvisoRodape` "Orçamento cancelado" / "Pedido cancelado" (sem Desfazer); a tag Cancelado entra no histórico.

## 5. Histórico em tags (RN-VEN-30) — `TagHistorico` / `HistoricoEmTags`

### 5.1 Lista de tags
Texto da tag: **"Rótulo · dd/mm hh:mm"** no fuso do tenant (de outro ano: "dd/mm/aa hh:mm"); com autor que não é o vendedor do
pedido: "Rótulo · dd/mm hh:mm · Nome". Rejeitado e Cancelado: **motivo em 1 linha** abaixo da tag (13 `ink2`, reticências se não
couber; o TalkBack lê inteiro).

**Pedido**
| Status (contrato · banco) | Tag | Tom | Motivo |
|---|---|---|---|
| `rascunho` · `draft` | **Salvo** | neutro | — |
| `na_fila` · `queued` | **Na fila** | aviso | — |
| `recebido` · `received` | **Enviado** | neutro | — |
| `em_aprovacao` · `pending_approval` | **Em aprovação** | destaque | — |
| `aprovado` · `approved` | **Aprovado** | sucesso | — |
| `rejeitado` · `rejected` | **Rejeitado** | erro | sim |
| `enviado_erp` · `sent_to_erp` | (não aparece) | — | — |
| `integrado_erp` · `integrated` | **Recebido no ERP** | sucesso | — |
| `faturado_parcial` · `invoiced_partial` | **Faturado parcial** | sucesso | — |
| `faturado_total`/`faturado` · `invoiced` | **Faturado** | sucesso | — |
| `cancelado` · `cancelled` | **Cancelado** | erro | sim |

**Orçamento**
| Evento | Tag | Tom | Motivo |
|---|---|---|---|
| `salvo` (ou `aberto`, `rascunho`) | **Salvo** | neutro | — |
| `convertido` / `transformado` | **Transformado em pedido nº 000013** | sucesso | — |
| `vencido` | **Vencido** | aviso | — |
| `cancelado` | **Cancelado** | erro | sim |

- Status sem tag (`enviado_erp`, o evento "Editado", qualquer id desconhecido) **não aparece**; nunca o código cru.
- Ordem: do mais antigo ao mais recente, da esquerda para a direita, quebrando linha; a tag com motivo ocupa a linha inteira.
  A última tag é o estado de agora (a mesma do cabeçalho).
- Tom = cor + texto (nunca só cor). Tons e pares de contraste: os do `ChipEstado` (§6).
- TalkBack: o bloco lê "Histórico: 3 etapas"; cada tag lê "Rejeitado, 8 de novembro às 14:02, por Carla Souza. Motivo: Desconto
  acima da alçada".

### 5.2 Uso
```ts
const tags = tagsDoHistorico(eventos, { tipo: 'orcamento', tz: tenant.fuso, agora: new Date() });
<RotuloSecao texto="Histórico" />
<HistoricoEmTags tags={tags} titulo="Histórico" />
```
O evento traz `status`, `em` (UTC), `motivo`, `autor`, `autorEhVendedor` (o módulo compara o autor com o vendedor do pedido) e,
no orçamento transformado, `numeroPedido`. **BKO**: `import { HistoricoEmTags, tagsDoHistorico } from '@macuxi/ui/web'` (as mesmas
tags, em `<ul>`, com a leitura em `sr-only`). **Gestão**: os mesmos componentes do kit mobile.

## 6. Contraste (regra do `componentes.md` §1.1)
- Texto laranja só em `accentInk` (6,7:1 no fundo, 7,4:1 no branco): a tag **Em aprovação** (destaque: `accentInk` no
  `accentSoft`, 6,27:1) e o link Trocar. Nenhum texto em `colors.accent`.
- Sobre o laranja cheio, `onAccent` (4,6:1): o principal do Resumo e do rodapé de ações (o `Botao` já faz).
- Tags: neutro `neutralInk` no `neutralBg` (8,6:1); aviso `warning` no `warningBg` (6,4:1); sucesso `success` no `successBg`
  (5,5:1); erro `danger` no `dangerBg` (6,0:1). Motivo `ink2` no fundo (6,9:1).
- Equivalente do desconto: `success` no branco (6,4:1); acréscimo `ink2` (7,6:1); erro `danger` (7,1:1).
- Ícone + rótulo do rodapé em `ink` (16,5:1); desabilitado em `ink3` (5,8:1 no branco), sem transparência.
- Secundários do Resumo: texto `ink` no branco com borda `ink` 1,5; desabilitado `#5B6673` no `#E6E9E2` (4,8:1).

## 7. Componentes do kit
| Peça | Componente | Onde |
|---|---|---|
| abas | `Abas` (`pendente`, `rotuloPendencia="com pendência"`), `rotuloComContador` | `formulario.tsx`, `componentes.ts` |
| alertas da aba Venda | `Faixa` (nova prop `apoio`), `alertaInadimplencia`, `TEXTO_CLIENTE_LIBERADO` | `valores.tsx`, `selecao.ts` |
| forma, prazo, transportadora | `ListaSuspensa` | `suspensa.tsx` |
| limite, prazo médio, itens, totais | `LinhaValor`, `BlocoTotais` | `valores.tsx` |
| linhas do Resumo | `LinhaResumo` (novo) | `valores.tsx` |
| desconto do item e do pedido | **`DescontoCompacto`** (novo), `equivalenteDoAjuste`, `TIPOS_AJUSTE` | `desconto-rn.tsx`, `desconto.ts` |
| botões do Resumo | `Botao` (nova prop `quebrarLinha` para "Salvar como orçamento" na metade) | `base.tsx` |
| pendências e saída | `BlocoPendencias`, `FolhaSairDoFormulario` (nova opção `apenasSalvar`) | `pendencias-rn.tsx` |
| tag do cabeçalho | `Selo tamanho="m" pilula` | `valores.tsx` |
| histórico | **`TagHistorico`**, **`HistoricoEmTags`** (novos), `tagsDoHistorico` | `historico-rn.tsx`, `../comum/historico.ts`; web: `web/historico.tsx` |
| ações do detalhe | **`RodapeAcoes`** (novo), **`MenuMais`** (novo, ícone `mais`) | `acoes-rn.tsx`, `acoes.ts` |

## 8. Textos finais (copiar exatamente)
| Onde | Texto |
|---|---|
| abas | `Venda` · `Itens (n)` · `Entrega` · `Resumo` |
| rodapé das abas | `Total do pedido` · `Avançar` |
| aba Venda | `Alertas` · `Cliente liberado · sem título vencido` · `Forma de pagamento` · `Prazo` · `Escolha` · `Limite` · `R$ x · disponível R$ y` · `Prazo médio do cliente` · `Atualizado hoje às 10:27` |
| aba Entrega | `Endereço de entrega` · `Trocar` · `Frete` · `CIF` · `FOB` · `Frete incluso no preço` · `Frete por conta do cliente` · `Transportadora` · `Escolha a transportadora` · `Observações` |
| Resumo | `Venda` · `Itens` · `Entrega` · `Obs.` · `Desconto do pedido` · `Tabela` · `Descontos` · `Total` · `Falta para salvar` |
| botões do Resumo | `Salvar e enviar pedido` (`Vai direto ao ERP` / `Vai para o supervisor`) · `Apenas salvar` · `Salvar como orçamento` · `Cancelar` |
| editar orçamento | `Salvar orçamento` · `Transformar em pedido` · `Cancelar` |
| depois de Apenas salvar | `Pedido salvo` |
| detalhe | `Orçamento 000012` · `Orçamento · até 15/11` · `Vendedor: <nome>` · `Itens` · `Total` · `Histórico` |
| ações | `Transformar em pedido` · `Continuar pedido` · `Corrigir pedido` · `Editar` · `PDF` · `Duplicar` · `Pedido` |
| menu ⋮ | `Cancelar orçamento` · `Cancelar pedido` · `Descartar pedido` · `Voltar` |
| confirmação | `Cancelar este orçamento?` · `Ele continua na lista como cancelado e não pode mais virar pedido.` · `Cancelar este pedido?` · `O pedido não será enviado ao ERP.` |
| tags | §5.1 |

## 9. Critérios de revisão (designer-ux, nas T-0136, T-0137 e T-0138)
1. 4 abas com os rótulos exatos, abrindo em Venda; bolinha só na aba da pendência; nenhum alerta de pendência fora do Resumo.
2. Aba Venda com a caixa Alertas (ou a linha do cliente liberado), forma, prazo, limite, prazo médio e a atualização; aba
   Entrega sem valor de frete; Leve mais e Combina no fim da aba Itens.
3. Resumo com todos os dados, na ordem do §2.1; desconto do pedido numa linha (`DescontoCompacto`); 4 botões com a hierarquia e
   os estados do §2.2–2.3; nenhuma folha intermediária.
4. O mesmo `DescontoCompacto` no item e no pedido, sem − e +, com o equivalente ao lado.
5. Detalhe na ordem do §4.1; 1 principal no máximo; ícone + rótulo curto; Cancelar só no ⋮, com confirmação.
6. Histórico só com tags (§5); nenhum "Recebido pelo servidor" no app; Gestão e BKO com os mesmos componentes.
7. Contraste do §6; alvos ≥ 48 dp (44 dp na linha densa do item, como hoje); textos do §8.

## 10. Premissas (ajustáveis pelo dono do produto)
- `enviado_erp` não vira tag (é passo interno entre Aprovado e Recebido no ERP).
- Na fila em tom aviso (amarelo) no histórico, como na lista Pedidos de hoje.
- O evento "Editado" sai do histórico (não é status).
- Orçamento vencido: Duplicar vira a ação principal (é a única que resta, RN-VEN-18).
- No Resumo, Cancelar é texto neutro (`ink2`), não link laranja.
- Editar orçamento não mostra "Válido até" embaixo de Salvar orçamento até a Frente J definir se a edição renova a validade.
