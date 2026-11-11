# Redundâncias — 10/11/2026: auditoria do fluxo de venda na v1.0.2 (T-0152)

**Auditor:** corretor-redundancias · **Pedido:** gerente-projetos (T-0152), a partir de R-20261110-062239 e R-20261110-062506
(regra permanente), com os casos de R-20261110-062233, 062237, 062238 e 062240 (Alexandre).
**Base:** `main` a987c6df. O código de `modules/`, `packages/` e `apps/` está igual ao da v1.0.2 (`git diff --stat cbc35ead a987c6df`
vazio). Na ficha do cliente, o modulo-core já tem uma correção da T-0146 na árvore local, sem commit. Ela foi lida, mas
não vale como reteste.
**Escopo:** Novo pedido (abas Venda, Itens, Entrega e Resumo), confirmação do envio, detalhe do pedido e do orçamento, lista de
Pedidos e ficha do cliente, no Campo, no Gestão (mesmas telas do Vendedor) e no BKO (gaveta do pedido, painel de aprovação e
Cliente 360). Também as pranchas novas do designer-ux, `docs/design/telas/T-0150-resumo.png` e `T-0150-detalhe.png`, com parecer
prévio no §4.
**Critérios (R-20261110-062506):** informação repetida na mesma tela ou entre telas; aviso ou caixa que repete uma linha; texto
além do problema e da ação; rótulo e número que não batem. Este último é defeito funcional: vai ao testes (§5) e não vira RD.

**Sem aparelho:** não houve print da v1.0.2. O parecer foi tirado do código das telas, montando o que cada tela desenha no estado
relatado pelo Alexandre (AGU-1500 com desconto acima do máximo, desconto líquido de 8,8% e alçada de 5%), e das pranchas.
Os recados do Alexandre não trazem anexos.

## 1. Resumo

| | Alta | Média | Baixa | Total |
|---|---|---|---|---|
| Novos (RD-0055 a RD-0069) | 5 | 7 | 3 | 15 |

Os 5 casos do Alexandre estão cobertos: alçada 3 vezes no Resumo (RD-0055), recusa junto com a alçada (RD-0057), caixa repetindo o %
(RD-0056), limite e vencidos na ficha (RD-0065) e mensagens longas (RD-0067). Além deles, a auditoria achou mais 10.
**Veredito:** com 15 achados em aberto, a v1.0.3 não vai ao build sem o reteste (regra de 10/11).

## 2. Achados

### RD-0055 · alta · Resumo: a alçada aparece 3 vezes (e mais 3 fora dele)
- **Onde / o que se repete** (estado: 8,8% com alçada de 5%):
  1. a linha Venda do Resumo diz "Vai para aprovação (desconto acima da alçada)" (`modules/vendedor/app/lib/textos-venda.ts:97-104`,
     chamada em `app/screens/new-order-screen.tsx:794`);
  2. a faixa dos Totais diz "8,8% · vai para o supervisor" (`app/lib/textos-pedido.ts:70-78`; `app/components/novo-pedido-abas.tsx:482,513`);
  3. embaixo do botão aparece "Vai para o supervisor" (`domain/botoes-resumo.ts:25-35,101,112`; `novo-pedido-abas.tsx:619-623`).
- **Fora do Resumo:**
  - o cabeçalho do pedido em nome mostra "Em nome de X · alçada de supervisor" (`new-order-screen.tsx:686`);
  - a folha do Transformar diz "Confere preço e alçada ao enviar." e mostra o destino 2 vezes (`textos-pedido.ts:184-187`;
    `order-detail-screen.tsx:685-689,721`);
  - a folha de saída da edição repete o destino (`new-order-screen.tsx:829`);
  - `textoDaAlcada` (`app/lib/novo-pedido.ts:360-369`) é uma 4ª frase de alçada sem nenhum leitor (código morto).
- **Contradição:** na edição de orçamento, a faixa e a linha Venda falam em alçada, e o orçamento não tem alçada. Isso foi ao testes (§5).
- **Impacto:** leitura e decisão. É o mesmo fato 3 vezes numa tela.
- **Proposta (R-20261110-062238 item 2):** nada de alçada nas telas. Ao tocar em "Salvar e enviar pedido", só quando passar da alçada,
  abre a pergunta **"Desconto acima da sua alçada. Enviar para aprovação?"**, com os botões **Enviar para aprovação** e **Voltar**.
  Saem o motivo `alcada` de `alertaDaVendaNoResumo`, a `Faixa` da alçada, o `destino` do botão principal, "alçada de …" do cabeçalho
  em nome, o subtítulo da folha do Transformar e `textoDaAlcada`. No cabeçalho fica só "Em nome de Lucas Andrade".
- **Dono:** modulo-vendedor (T-0151); a prancha da pergunta já está em `T-0150-resumo.png` (designer-ux).

### RD-0056 · alta · Resumo: a caixa colorida repete o % que os Totais já dizem
- **Onde:** os Totais mostram "Acréscimos + R$ 6,94" e, logo abaixo, a `Faixa` verde "Acréscimo 5,8%". Com desconto, aparece
  "Descontos − R$ …" e, na faixa, "8,8% · …" (`textos-pedido.ts:110-115` e `:70-78`; `novo-pedido-abas.tsx:512-514`). É o mesmo
  ajuste em 2 lugares: um com o valor, outro com o %.
- **Proposta (R-20261110-062237):** **uma linha** nos Totais, com o resultado líquido sobre a tabela: "Acréscimo 5,8%  + R$ 6,94" ou
  "Desconto 8,8%  − R$ 10,53". Sai a `Faixa`. `linhasDeTotais` passa a montar essa linha (o % vem de `desconto_efetivo_exibicao_pct`,
  RN-VEN-03), e `textoDaFaixa` sai.
- **Dono:** modulo-vendedor (T-0150).

### RD-0057 · alta · Detalhe do pedido recusado: a recusa vem junto com a alçada e com 3 ordens
- **Onde** (pedido da fila que a API recusou, `order-detail-screen.tsx:513-522`), na mesma área:
  - a faixa vermelha diz "Não foi aceito: Desconto acima do máximo do produto: AGU-1500. Reduza o desconto do item. Corrija e salve
    de novo." (`app/lib/salvar-na-fila.ts:79`, com a frase da API em `domain/aprovacao.ts:363`);
  - abaixo, as `notes` da validação local dizem "Desconto de 8,8% acima da sua alçada de 5,0%. Vai para aprovação."
    (`app/lib/pedidos.ts:235`, `domain/order.ts:153`).
- **O que se repete:** a palavra "desconto" 3 vezes e 3 ordens ("Reduza", "Corrija e salve de novo", "Vai para aprovação"). O botão
  "Corrigir pedido" do rodapé já é a ação. A linha da alçada ainda contradiz a recusa: o pedido não vai para aprovação.
- **Proposta (R-20261110-062238 item 4):** a faixa só com o problema, **"Desconto acima do máximo: AGU-1500"**. Sem as `notes` na
  recusa e sem "Corrija e salve de novo". A frase da API (`aprovacao.ts:363`) fica sem "Reduza o desconto do item."
- **Dono:** modulo-vendedor (T-0151).

### RD-0058 · alta · Detalhe aguardando aprovação (Campo e Gestão): a situação e o % aparecem 4 vezes
- **Onde** (`order-detail-screen.tsx`):
  - o selo do cabeçalho diz "Aguardando aprovação" (`:496-497`);
  - a linha `detalhe-pendencia` diz "Desconto de 8,8% acima da alçada de 5,0%: aguardando supervisor" (`:524-528`, texto de
    `domain/aprovacao.ts:85-87`);
  - o cartão `order-approval` traz "Desconto do pedido 8,8%", "Alçada do vendedor 5,0%", "Quem aprova Supervisor" e
    "Aguardando o supervisor." (`:594-628`);
  - embaixo do total aparece "Desconto efetivo (sem frete): 8,8%" (`:563`), além da linha "Desconto 15,0%" (`:467`; o rótulo
    não bate com o número e foi ao testes, §5).
- **O que se repete:** "aguardando" 3 vezes, o % 3 vezes, "supervisor" 3 vezes e a alçada 2 vezes.
- **Mais um caso:** em qualquer status, o selo do cabeçalho é a última tag do histórico (`:404,496-497` × `:632-636`). "Rejeitado"
  aparece no topo e de novo no histórico.
- **Proposta:**
  - **No Campo:** o selo "Aguardando aprovação" e nada mais. O % fica só na linha do total (RD-0056), sem a linha
    "Desconto efetivo" e sem o cartão.
  - **No Gestão** (quem decide): uma linha acima de Aprovar/Rejeitar, "Desconto 8,8% · alçada do vendedor 5,0%". Saem "Quem aprova"
    e "Aguardando o …". "Este pedido é do nível supervisor; a decisão fica registrada como do gerente." vira "Nível do supervisor".
    "Aprovar exige internet: conecte-se para decidir este pedido." vira "Sem sinal: aprovar exige internet".
  - **Histórico:** sem a etapa atual, que já está no selo, como na prancha `T-0150-detalhe.png`.
- **Dono:** modulo-vendedor (T-0150 e T-0151).

### RD-0059 · média · Lista de Pedidos (Campo e Gestão): o selo e a nota da linha dizem a mesma coisa
- **Onde:** `app/screens/orders-screen.tsx:454-456` com `app/lib/order-status.ts:84-95`.
  - O selo "Aguardando aprovação" vem com a nota "Desconto de 8,8% acima da alçada de 5,0%: aguardando supervisor".
  - O selo "Não aceito" vem com a nota "Não foi aceito: Desconto acima do máximo do produto: AGU-1500. Reduza o desconto do item".
- **Proposta:**
  - no aguardando, a nota sai (o selo diz);
  - no recusado e no rejeitado, a nota fica só com o motivo ("Desconto acima do máximo: AGU-1500"). `textoDaRecusaCurto` deixa de
    pôr "Não foi aceito:" na lista.
- **Dono:** modulo-vendedor.

### RD-0060 · média · Código de regra na tela: "(RN-VEN-13)"
- **Onde:** `MOTIVO_TITULO_VENCIDO = 'Cliente com título vencido: só à vista ou com aprovação (RN-VEN-13).'`
  (`domain/aprovacao.ts:114`) vira `pending_reason` (`:123,132`). Sai assim na lista (`order-status.ts:87`), no detalhe (`:524-528`),
  no cartão do envio (`textos-pedido.ts:167`), na gaveta e no painel do BKO (`web/components/orders/order-drawer.tsx:91`,
  `approvals-panel.tsx:39`) e no PDF (`domain/pdf-pedido.ts:368`). Junto do desconto, a frase fica com 2 períodos.
- **Proposta:** "Título vencido", sem o código da regra.
- **Dono:** modulo-vendedor.

### RD-0061 · média · Novo pedido: "só orçamento" (RN-VEN-13) aparece 4 vezes
- **Onde** (cliente bloqueado, inativo ou com cadastro incompleto):
  1. o alerta da aba Venda diz "Cliente bloqueado · só orçamento" (`textos-venda.ts:31-36`);
  2. as Observações da aba Entrega dizem "Cliente bloqueado." (`new-order-screen.tsx:781` passa `motivoSoOrcamento`;
     `novo-pedido-abas.tsx:303-307`). A linha automática é da RN-CORE-17 e só deveria aparecer no cadastro incompleto;
  3. a linha Venda do Resumo repete "Cliente bloqueado · só orçamento" (`textos-venda.ts:98-99`);
  4. a faixa acima dos botões diz "Cliente bloqueado: só dá para salvar como orçamento" (`domain/orcamento.ts:166-171`;
     `novo-pedido-abas.tsx:609`), logo acima do botão "Salvar como orçamento".
- **Proposta:**
  - a aba Venda fica com o alerta;
  - no Resumo fica **uma** linha, a de cima dos botões: "Cliente bloqueado · só orçamento" (sem "só dá para salvar como"), e a linha
    Venda fica sem alerta;
  - a Entrega só mostra a linha automática no cadastro incompleto ("Falta: CNPJ, CEP").
- **Dono:** modulo-vendedor.

### RD-0062 · média · Aba Venda: o "disponível" aparece 2 vezes
- **Onde:** o alerta diz "Limite excedido · disponível R$ 1.234,00", com a linha de apoio "Vai para aprovação"
  (`textos-venda.ts:40`). A tabela Crédito, logo abaixo, traz "Disponível −R$ 1.234,00" em vermelho (`textos-venda.ts:74`).
- **Proposta:** o alerta só com "Limite excedido". O valor fica na tabela.
- **Para o testes:** o apoio "Vai para aprovação" e o "limite excedido" do Resumo contradizem o servidor, que não manda pedido
  para aprovação por crédito (§5).
- **Dono:** modulo-vendedor.

### RD-0063 · média · Confirmação depois de enviar: o selo e a nota dizem o mesmo
- **Onde:** `textos-pedido.ts:163-169`; `new-order-screen.tsx:834-847`. Aparecem "Pedido 000015 recebido", o selo "Aguardando aprovação"
  e a nota "Desconto de 8,8% acima da alçada de 5,0%: aguardando supervisor". No aprovado: o selo "Aprovado" e a nota "Dentro da
  alçada: aprovado na hora."
- **Proposta:** o título e o selo, sem a nota no aguardando e no aprovado. No recusado fica só o motivo.
- **Dono:** modulo-vendedor.

### RD-0064 · média · BKO: a gaveta do pedido e o painel de aprovação repetem a alçada, o % e o motivo
- **Onde** (`modules/vendedor/web/components/orders/`):
  - `order-drawer.tsx:91` traz o `Notice` com o `pending_reason` (alçada e %). Na seção Decisão, `:102` repete "Desconto 8,8% ·
    alçada do vendedor 5,0% · cabe ao nível Supervisor";
  - `:116` mostra o campo "Desconto do pedido 15,0%", e os Totais (`:134`) repetem "Desconto (15,0%)". O % é o mesmo, em 2 lugares,
    e o rótulo não bate com o líquido (§5). O campo "Desconto efetivo (sem frete)" fica em `:117`;
  - `:92` traz o `Notice` "Motivo: …" do rejeitado, e a tag Rejeitado do histórico (`:257`) repete o motivo;
  - o subtítulo da gaveta diz "cliente · vendedor" (`:71`), e a Decisão repete "Vendedor: X · cliente Y" (`:97-100`);
  - o campo "Itens" diz "3 itens · 12 un." (`:113-115`): a unidade se repete;
  - a frase "O frete não tem valor no pedido: no FOB o cliente paga direto à transportadora." (`:163`) explica o óbvio;
  - no painel (`approvals-panel.tsx:17-43`), o título "Aguardando aprovação · N" vem com a nota "acima da alçada do vendedor", e cada
    cartão traz o motivo da alçada e "Quem decide: supervisor.".
- **Proposta:**
  - **Gaveta:**
    - sem o `Notice` do aguardando (a Decisão diz) e sem o `Notice` "Motivo:" (o histórico diz);
    - a Decisão fica numa linha, "Desconto 8,8% · alçada do vendedor 5,0%";
    - um % só, na linha do total, com o líquido (RD-0056);
    - "Itens" fica "3 · 12 un.";
    - sai a frase do frete.
  - **Painel:** sem a nota do título; o cartão fica com o % e "Supervisor".
- **Dono:** modulo-vendedor; o padrão do detalhe vem da T-0150 (designer-ux).

### RD-0065 · alta · Ficha do cliente: limite, vencidos e bloqueio aparecem 2 vezes
- **Campo** (v1.0.2):
  - o topo mostra "Limite disponível R$ 17.900" e "Títulos vencidos Nenhum" (`modules/core/app/telas/cliente.tsx:159-164` em HEAD).
    O Financeiro repete os dois como "Crédito disponível" e "Vencidos" (`app/components/cliente360.tsx:149-150`);
  - `CabecalhoCliente` põe os selos "Bloqueado · motivo" e "N vencidos" (`cliente360.tsx:55-56`), e o Financeiro repete
    "Cliente bloqueado: motivo." (`:152`) e os vencidos (`:150`).
- **BKO:** o selo "Bloqueado" (`web/components/cliente360/cliente360-page.tsx:53`) vem com o `Notice` "Cliente bloqueado no
  financeiro: motivo." (`:71`).
- **Proposta (R-20261110-062233):**
  - o topo fica só com os indicadores de compra: média por mês, última compra, ticket e frequência;
  - o limite, o disponível e os vencidos ficam **só no Financeiro**;
  - no cabeçalho, sai o selo "N vencidos" e o selo "Bloqueado" fica **sem** o motivo, que vai só no Financeiro.
- **Árvore local (T-0146, sem commit):**
  - já tirou os 2 `Stat` do topo no Campo e levou o crédito e os vencidos do BKO para o painel Financeiro;
  - **faltam** o selo "N vencidos" e o motivo no selo "Bloqueado" (Campo, `cliente360.tsx:55-56`);
  - **falta** o selo × `Notice` no BKO: na árvore, o `Notice` foi para o painel Financeiro, mas o selo "Bloqueado" segue no topo.
    Basta o selo sem motivo e o motivo só no painel.
- **Dono:** modulo-core (T-0146).

### RD-0066 · baixa · Ficha do cliente: textos além do problema e da ação
| Onde (HEAD) | Hoje | Proposta |
|---|---|---|
| `cliente360.tsx:93` | "Nenhum contato cadastrado. O telefone do cadastro do cliente é usado no botão Ligar." | "Nenhum contato cadastrado" |
| `cliente360.tsx:117` | "Nenhum endereço de entrega neste aparelho. Sincronize quando houver sinal; endereço novo entra pelo cadastro no ERP." | "Nenhum endereço de entrega. Sincronize com sinal" |
| `cliente360.tsx:143` | "Sem dados financeiros neste aparelho. Sincronize quando houver sinal." | "Sem dados financeiros. Sincronize com sinal" |
| `cliente.tsx:207` | "Check-in bloqueado. Você está em atendimento em X. Pedido para este cliente continua liberado." | "Check-in bloqueado: em atendimento em X" |
| `cliente.tsx:136` | "Cliente não encontrado na carteira sincronizada. Sincronize e tente de novo." | "Cliente fora da carteira do aparelho. Sincronize com sinal" |
| BKO `cliente360-page.tsx:102` | "Nenhum endereço vindo do ERP. Endereço novo entra pelo cadastro do cliente no ERP." | "Nenhum endereço no ERP" |
- **Dono:** modulo-core (com o texto final revisado pelo designer-ux).

### RD-0067 · média · Mensagens longas e didáticas no Novo pedido, no detalhe e na lista
| Onde | Hoje | Proposta |
|---|---|---|
| API `domain/aprovacao.ts:363` | "Desconto acima do máximo do produto: AGU-1500. Reduza o desconto do item." | "Desconto acima do máximo: AGU-1500" |
| `domain/order.ts:160` | "Desconto de X% acima da alçada máxima. Reduza o desconto." | "Desconto X% acima do máximo" |
| `app/lib/novo-pedido.ts:310` | "Desconto efetivo de X% acima da alçada máxima (L). Reduza o desconto do pedido ou dos itens." | "Desconto X% acima do máximo" |
| `domain/order.ts:153` | "Desconto de X acima da sua alçada de Y. Vai para aprovação." | sai (a pergunta ao salvar, RD-0055) |
| `app/state/use-vendedor.ts:506` | "Preços atualizados pela tabela de hoje do cliente." | sai (R-20261110-062238 item 1); a cópia fica "Cópia do pedido 000013 com os preços de hoje" |
| `new-order-screen.tsx:701` | "Sem sinal. Para editar um pedido já enviado, conecte-se à internet ou desligue o modo sem sinal no Perfil." | "Sem sinal: editar pedido enviado exige internet" |
| `salvar-na-fila.ts:79` | "… Corrija e salve de novo." | sai (RD-0057) |
| `orders-screen.tsx:354` | "Não foi possível consultar o servidor: mostrando só o que o aparelho tem deste período. Puxe para baixo para tentar de novo." | "Servidor fora do ar: só o que está no aparelho. Puxe para tentar de novo" |
| `textos-pedido.ts:202` | "Ele continua na lista como cancelado e não pode mais virar pedido." | "Não pode mais virar pedido" |
| `order-detail-screen.tsx:563` | "Desconto efetivo (sem frete): 8,8%" | sai (RD-0056 e RD-0058); o frete não tem valor, então "(sem frete)" não informa nada |
| BKO `web/lib/detalhe-pedido.ts:7` | "Os itens do pedido ainda não carregaram. Use \"Tentar de novo\" no detalhe e depois gere o PDF." | "Itens ainda não carregaram" |
- **Dono:** modulo-vendedor; o texto final é do designer-ux.

### RD-0068 · baixa · Contagem repetida na lista de Pedidos e na aba Itens
- **Lista:** com o chip "Todos 12" ativo, a linha de baixo diz "12 pedidos · R$ 8.420" (`orders-screen.tsx:337-348`). Proposta:
  a linha só com o valor, "Total R$ 8.420".
- **Itens:** a aba "Itens (3)" fica logo acima de "Total do pedido · 3 itens" (`novo-pedido-abas.tsx:131-141`;
  `app/lib/pagamento-pedido.ts:102-104`). Proposta: "Total do pedido", sem a contagem. A T-0148 refaz a aba Itens.
- **Dono:** modulo-vendedor.

### RD-0069 · baixa · Prancha `T-0150-resumo.png`: "ITENS (3)" logo abaixo da aba "Itens (3)"
- **Onde:** painéis 1 e 3 da prancha do Resumo. A contagem está na aba e no título da seção, na mesma tela.
- **Proposta:** o título da seção fica "ITENS". O detalhe não tem aba, então lá "ITENS (3)" fica.
- **Dono:** designer-ux.

## 3. Redundância útil (não remover)
- A pergunta "Desconto acima da sua alçada. Enviar para aprovação?" com o botão "Enviar para aprovação" é confirmação de ação, e o
  verbo no botão é o padrão: **manter**.
- A faixa "N pedidos na fila do aparelho", o chip "Na fila" e o selo "Na fila" indicam a fila e o offline: **manter**.
- No item acima do máximo (prancha `T-0150-resumo.png`, painel 3), a bolinha na aba Itens, o % em vermelho e a linha
  "AGU-1500 acima do desconto máximo" têm papéis diferentes: navegar, localizar e explicar. **Manter.**
- O PDF interno (escritório) continua com a alçada (`order-sheets.tsx:173`). É documento de conferência e não tela: `manter?`. Fica
  para o Alexandre decidir.

## 4. Parecer prévio das pranchas T-0150 (pedido do gerente: atender o designer com prioridade)
- **`T-0150-resumo.png`:** sem caixa repetida, sem alçada na tela e o % numa linha só. Achado: RD-0069 (baixa).
- **`T-0150-detalhe.png`:** a situação aparece uma vez, no topo; o motivo numa linha; sem caixa colorida. Sem RD.
- **Rótulo e número que não batem** (vai ao testes; a prancha não segue ao Alexandre assim, pela regra de 10/11):
  - `T-0150-resumo.png` painel 1: o total do Açúcar está "39,80", e 1 FD × 36,00 + 10% = **39,60**. O da Água está "38,12", e
    2 FD × 15,05 + 20% = **36,12**. Os itens somam 128,84, e o Total diz 126,64;
  - painel 3: o Café está "53,80" (4 × 13,40 = **53,60**) e o Açúcar "39,80" (**39,60**);
  - `T-0150-detalhe.png`: os mesmos números em A e B, e o Açúcar "39,80" em C.

## 5. Encaminhados ao testes (defeito funcional, sem RD)
1. **Crédito excedido:**
   - a aba Venda diz "Vai para aprovação" (`textos-venda.ts:40`), e o Resumo diz "Vai para aprovação (limite excedido)" (`:101`);
   - o servidor e a validação local não mandam para aprovação por crédito (`app/lib/pedidos.ts:187`, P-6; `api/receber.ts:436`,
     `credito: null`);
   - o texto promete um destino que não acontece.
2. **Desconto do detalhe:**
   - o detalhe mostra "Desconto 15,0%" (`order-detail-screen.tsx:467`), e o BKO mostra "Desconto do pedido" e "Desconto (x%)"
     (`order-drawer.tsx:116,134`);
   - os três usam o `discount_pct` do pedido, não o líquido sobre a tabela (o real era 10,1% e depois 8,8%);
   - já está no item 5 de R-20261110-062238.
3. **Orçamento em edição:** a linha Venda e a faixa do Resumo falam em alçada, e o orçamento não tem alçada (RN-VEN-18;
   R-20261110-062238 item 2).
4. **Pranchas T-0150:** totais de item errados (§4).

## 6. Como foi conferido
- Leitura do código das telas, no HEAD e na v1.0.2, linha a linha, nos estados relatados.
- Grep dos textos de alçada, recusa, crédito e "só orçamento" no Vendedor, no Core, no Gestor e no `packages/ui`.
- `git show HEAD:` da ficha (a árvore local do modulo-core está em correção).
- Leitura das pranchas `T-0150-*.png` e `T-0141-novo-pedido-v3-2.png`.
- **Reteste:** com o print do aparelho (Campo, Gestão e BKO) de cada tela citada. Sem o print, cada RD fica `aberto`.

## 7. Recados
- modulo-vendedor: R-20261110-065020 (RD-0055 a RD-0064, RD-0067, RD-0068), com cc ao gerente, ao designer-ux e ao testes.
- modulo-core: R-20261110-065354 (RD-0065, RD-0066), com cc ao gerente e ao designer-ux.
- designer-ux: R-20261110-065430 (parecer prévio das pranchas T-0150: RD-0069 e os números), com cc ao gerente e ao testes.
- testes: R-20261110-065439 (§5), com cc ao gerente.

## 8. Pareceres prévios das imagens e reteste T-0146 (10/11 07h50)
Regra R-20261110-062506: o parecer vem antes de a imagem ir ao dono do produto, e achado em aberto segura a imagem.

| Imagem | Parecer | Recado |
|---|---|---|
| `T-0148-itens.png` | **segura**: RD-0070 (baixa), "Ver itens (5)" no quadro 4, logo abaixo da aba "Itens (5)". Proposta: "Ver itens" (TalkBack "Ver os 5 itens do pedido"). Ficam (`manter`): o "Desc % 5,0" do campo junto da linha "Desconto 5,0% · − R$ 2,24" (padrão dos Totais) e o estoque na busca e no popup | R-20261110-075051 |
| `T-0145-permissoes.png` | **liberada**, sem achado (o ✓ com "Permitida" fica, por acessibilidade) | R-20261110-075059 |
| `T-0147-fotos-pdv.png` | **liberada**, sem achado (o botão "Foto do PDV" e a linha "Fachada" têm papéis diferentes; "Na fila" é o indicador de fila) | R-20261110-075059 |
| `T-0153-inicio-pedidos.png` | **liberada**, sem achado. Resolve na prancha o RD-0068 e o RD-0059; o cartão Meta segue o RD-0002, e as linhas seguem o RD-0005 e o RD-0007. Observação, sem segurar: o sync aparece como "05:40" no Início e "⟳ 06:30" em Pedidos | R-20261110-075111 |
| `T-0150-resumo.png` · `T-0150-detalhe.png` | **liberadas**. RD-0069 corrigido ("ITENS" sem contagem). Totais conferidos: 126,64 · 118,78 · 69,96, com os itens somando o total e a tabela ± o ajuste também. O RD-0056 se resolve na prancha e fecha no código | R-20261110-075122 |

**Reteste da T-0146 (árvore local, modulo-core):**
- RD-0065: o topo está ok no Campo e no BKO (`cliente.tsx:216`, `ficha-sem-repeticao.test.ts`). **Reaberto** por causa dos selos:
  - `cliente360.tsx:56`: o selo "N vencidos" sai;
  - `:55`: o selo fica sem o motivo, e `:152` vira "Motivo do bloqueio: X.", só quando houver motivo;
  - BKO `cliente360-page.tsx:53,79`: o `Notice` vira essa mesma linha.
  - Esses selos são os itens 1 e 2 do aviso do testes (R-20261110-072556). O item 3 (12 meses com 13 linhas) é defeito de valor e fica com o testes.
- RD-0066: sem entrega. Os textos de `cliente360.tsx:93,117,143`, de `cliente.tsx:136,201` e do BKO `:111` seguem os de antes. O texto final é o do designer-ux, em R-20261110-070524.
- Recado: R-20261110-075618 (modulo-core, cc gerente-projetos e testes).

**T-0151 (modulo-vendedor):** sem entrega até 07h56. Os RD-0055 a RD-0064, RD-0067 e RD-0068 seguem `aberto`.
