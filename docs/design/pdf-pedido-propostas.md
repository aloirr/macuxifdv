# PDF do pedido: 3 propostas (T-0159)

Origem: R-20261110-192932-alexandre. Imagens: `docs/design/telas/T-0159-pdf-proposta-{1,2,3}-{cliente,escritorio}.html/png` (A4, 1588 × 2246 px).
O dono do produto escolhe **uma**; só então ela vai para o código (`modules/vendedor/domain/pdf-pedido.ts`, `buildOrderPdfHtml`).

## Pedido de exemplo (o mesmo nas 6 imagens)
Pedido 000014 de 10/11/2026 (arquivo `PED-0014-10112026.pdf`, RN-VEN-41), Atacadinho Cachoeirinha (C5007), Boleto 28/56 dias, CIF para a Rua Pará, 137, vendedor Lucas Andrade, 3 itens (CAF-500, ACU-1K +10%, AGU-1500 −15%), tabela R$ 119,70, desconto líquido 0,8% (− R$ 0,92), total R$ 118,78. Situação: Rejeitado às 05:58 (igual à T-0150, caso B).

## As 3 propostas
| | 1 Clássica | 2 Compacta | 3 Moderna |
|---|---|---|---|
| Cabeçalho | logo + nome; quadro do documento com número e data | uma faixa: logo + nome à esquerda, "Pedido 000014" à direita | faixa laranja no topo; número grande à direita |
| Dados | 2 cartões: Cliente · Condições | ficha em grade (cada dado numa célula com rótulo), como nota fiscal | painel cinza: Cliente · Condições · Total |
| Itens | tabela com linhas finas, código em coluna | tabela densa com cabeçalho grafite e linhas alternadas | tabela arejada, código abaixo do nome |
| Total | embaixo, à direita | no rodapé da tabela | **só no topo**, no painel grafite |
| Histórico (escritório) | lista | uma linha com setas | linha do tempo |
| Melhor para | pedido comum, aparência tradicional | pedido com muitos itens (cabe mais por página) | poucos itens; o total aparece primeiro |

## Regras aplicadas (as 3)
- **Uma informação, um lugar:** vendedor, pagamento, entrega e frete só em Condições; data só no cabeçalho (e nas etapas do Histórico, no escritório); total uma vez; o desconto do pedido só numa linha dos totais (% e R$ juntos).
- **Endereço:** só o de entrega, junto do frete ("CIF · Rua Pará, 137 · ..."); o endereço do cadastro do cliente sai.
- **Frete:** só "CIF" ou "FOB · transportadora (CNPJ)"; sem "por conta da empresa/do cliente".
- **Alertas (RN-VEN-42), só no escritório:** área única, uma linha curta por problema ("AGU-1500 acima do desconto máximo"); sem alerta, a área não sai. Alçada não aparece (não é alerta).
- **Histórico, só no escritório:** a última etapa é a situação; sem selo de situação. O nome só aparece na etapa feita por outra pessoa que não o vendedor (ex.: "Aprovado · Carla Souza").
- **Cliente:** sem nenhum % nem a palavra desconto (regra atual); preço unitário líquido.
- **Escritório:** "uso interno" no cabeçalho (para não ir ao cliente por engano); código do cliente, tabela de preço e filial; colunas Tabela, Desc./Acr., Líquido e Total.
- **Uma nota só, junto do total do cliente:** "Valores sem impostos. Preço e estoque confirmados no faturamento." (junta as 2 frases de hoje). No escritório não sai.
- **Sai:** "Gerado pelo Macuxi FDV", "Gerado em ...", "uso interno · Gerado pelo", quantidade por embalagem ("3 itens · 4 UN + 3 FD"), "Desconto efetivo (sem frete)", "Alçada do vendedor · dentro/acima da alçada", "Status" em selo, "Observação: Sem pendências.", "Motivo da pendência" fora dos Alertas, data repetida no cartão, prazo repetido na linha do total e no rodapé.

## O que o código precisa para a escolhida (para o modulo-vendedor, depois da escolha)
- **Dados novos do tenant** (hoje o PDF só tem `tenant_name`): logo (imagem), CNPJ, endereço e telefone da distribuidora. Sem logo, sai só o nome; sem CNPJ/endereço/telefone, a linha não sai. O dono do dado é o modulo-core (parâmetros do tenant).
- **Fontes:** Archivo e IBM Plex Sans embutidas no HTML (`@font-face` com os arquivos do app em base64), porque o PDF é gerado sem internet. Sem isso, cai para a fonte do sistema.
- **Tabela de itens** em `<table>` com `<thead>` (repete o cabeçalho em cada página) e larguras fixas em mm.
- **Alertas** vêm da mesma lista da tela (RN-VEN-42); o PDF não calcula alerta.
- Desconto/acréscimo do pedido: uma linha só, "Desconto x,x%  − R$ y" ou "Acréscimo x,x%  + R$ y", com o % de `descontoDoPedidoPct` (corrige o D-T0150-1).
- Orçamento: título "Orçamento", sem selo de validade; o dia do preço é a data do cabeçalho (RN-VEN-18).
