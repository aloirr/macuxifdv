# Cliente 360 v2: Resumo, Histórico e Documentação (simulação)

Pedido do dono do produto: R-20261119-030234. É uma simulação, sem código. O desenho vale para o Campo e o Gestão e inclui a permissão de documentos em BKO › Parâmetros.

**Revisão de 19/11 (R-20261119-0440):** as pranchas 01 a 04 foram refeitas pelo comentário do dono do produto sobre a simulação:
1. no Resumo, os dados cadastrais e os endereços vêm **primeiro**, no topo da aba;
2. saem "Última compra" e "Sugestão de mix";
3. **nenhum alerta financeiro nas páginas da ficha**: a NF em atraso aparece só na aba Histórico (antes Financeiro), onde o vendedor vê e age (status "Em atraso", linha em destaque e filtro). Os Alertas do pedido (Novo pedido) não mudam;
4. **toda lista vira tabela**, com colunas e cabeçalho, no padrão da tabela de itens do Novo pedido (print `15-pedido-resumo` da apresentação): notas, parcelas e itens da nota (Histórico), documentos (Documentação), endereços, contatos e últimos itens comprados (Resumo).

A prancha 05 (BKO) não mudou.

**Ajustes de 19/11, 05h30 (R-20261119-0530):** as pranchas 01 a 04 e esta spec foram refeitas:
1. o status "Em atraso" vai **sem data**: sai o "desde 31/10" da tabela de notas (§4);
2. a aba "Financeiro" passa a se chamar **"Histórico"** (abas, legendas, notas e spec; a prancha 02 virou `02-campo-historico.png`);
3. **Limite, Saldo disponível e Prazo médio** saem do Histórico e voltam ao **Resumo, logo depois de Dados cadastrais** (§3). O Histórico fica só com a contagem, o botão de filtro e a tabela (§4);
4. o bloco "Compras" do Resumo passa a se chamar **"Performance"**: saem as tags de curva e entram as linhas "Curva Faturamento", "Curva Frequência" e "Curva Volume" na tabela rótulo-valor; os 3 indicadores e as visitas (no Gestão, "Visitada por") continuam no bloco (§3).

**Premissa, para o dono do produto confirmar:** o cartão de crédito do Resumo tem só os três itens listados: **Limite · Saldo disponível · Prazo médio**. "Crédito disponível" sai porque "Saldo disponível" é o mesmo número (limite − em aberto − pedidos aprovados não faturados, RN-VEN-12), e "Em aberto" também sai (o saldo de cada nota está no Histórico). Com o cliente bloqueado por crédito, a linha do motivo entra no fim desse cartão, como estava no bloco de crédito do Financeiro.

**Decisões de 19/11 (R-20261119-0458):** E1 = sim (o ERP manda a forma de pagamento por NF). P1 a P17 ficam como recomendado (§10), com quatro mudanças:
- **P7:** o bloco Visitas sai; visitas e a última visita entram no bloco de compras do Resumo (hoje "Performance"). No Gestão, "Visitada por" vai junto (pranchas 01 e 04);
- **P14:** sai o campo de busca da aba Histórico. O "Nº da NF" passa para o topo da folha Filtrar (prancha 02);
- **P15:** a Documentação é só para ver: o arquivo abre do servidor, sem baixar e sem cópia no aparelho (§8, prancha 03);
- **P17:** a NF (detalhe, parcelas, itens e PDF) vem do servidor ao tocar, só com a autorização do vendedor, e não fica guardada. Não há pull de 12 meses (§8, prancha 02).

Pranchas desta pasta (gere com `node docs/design/cliente-360-v2/gerar.mjs`, a partir da raiz do repositório):

| Prancha | O que mostra |
|---|---|
| `01-campo-resumo.png` | Resumo no Campo: topo (Dados cadastrais e crédito), crédito, Endereços e Contatos, Performance (curvas, indicadores e visitas), fim da rolagem |
| `02-campo-historico.png` | Histórico: filtros fechados (padrão), tabela rolada com os cinco status, folha Filtrar com o Nº da NF no topo e "Em atraso", filtro "Em atraso" aplicado, autorização para baixar a NF, detalhe da nota (do servidor) com as parcelas, itens da nota e baixar sem internet |
| `03-campo-documentacao.png` | Documentação: tabela por tipo, documento sem permissão, estado vazio e abrir sem internet |
| `04-gestao.png` | O mesmo Cliente 360 no Gestão (supervisora): Resumo (topo com o crédito, Contatos e Carteira, Performance com "Visitada por") e Documentação |
| `05-bko-parametros-documentos.png` | BKO › Parâmetros › Documentos: quem vê cada tipo de documento, por perfil, e as exceções por documento (opção A) |

Aparelhos em 360×760 dp, com `deviceScaleFactor` 2. O BKO está em 1366×768. O gerador falha nestes casos:
- a nota de simulação cobre um aparelho ou o conteúdo;
- um texto é cortado ou fica a menos de 4 px da borda do aparelho;
- um bloco fixo (faixa, abas, rodapé, barra ou folha) estoura;
- dois itens da mesma linha se sobrepõem;
- o menu do BKO passa da lista visível.

`docs/design/_comum/navegador.mjs` não existe no `main` de 19/11. Por isso a abertura do Chromium e o laço de captura ficam no próprio `gerar.mjs`, como em `docs/design/menu-parametros/gerar.mjs`.

Dados de exemplo, iguais em todas as pranchas:
- cliente: Mercado Bom Preço, código C5007, Boa Vista/RR; vendedora Carla Lima; hoje é 19/11/2026, no fuso de Manaus;
- limite de R$ 8.000, R$ 6.120 em aberto e nenhum pedido aprovado não faturado: saldo disponível de R$ 1.880 (RN-VEN-12);
- o valor em aberto soma os saldos de quatro notas: 2.380 + 1.560 + 1.540 + 640;
- 1 NF em atraso: a 004655, de R$ 1.280,00, com a parcela 2/2 (R$ 640,00) vencida em 31/10; a 1/2 foi paga em 23/10;
- compras de novembro: R$ 3.940, nas NFs 004817 e 004790, que vêm dos pedidos 000017 e 000013. O pedido 000009 virou a NF 004702;
- itens da NF 004655: 645,00 + 371,00 + 144,00 + 120,00 = R$ 1.280,00.

## 1. O que muda em relação ao de hoje

Hoje a ficha tem seis abas, roladas na horizontal: Resumo, Cadastro, Financeiro, Compras, Performance e Anexos. A v2 tem **três abas fixas**, sem rolagem: **Resumo · Histórico · Documentação**.

| Hoje | Na v2 |
|---|---|
| Resumo (contato, Compras no mês, Última compra) | Os botões de contato vão para a tabela Contatos; "Compras no mês" e "Última compra" saem |
| Cadastro (CNPJ, endereço, filial, segmento, contatos, endereços de entrega, observações) | Resumo, **no topo** ("Dados cadastrais", Endereços, Contatos); Observações no fim |
| Performance (visitas, curvas, prazo médio, últimos itens, sugestão de mix) | Resumo: o prazo médio vai para o cartão de crédito, logo depois de Dados cadastrais; as curvas viram linhas do bloco Performance (R-20261119-0530); a sugestão de mix sai |
| Compras: 4 indicadores | Resumo › Performance, com 3 indicadores (Compra média/mês, Ticket médio, Frequência); "Última compra" sai (R-20261119-0440) |
| Compras: "Histórico de Pedidos" (pedidos e linhas mensais) | **Sai.** A compra faturada aparece no Histórico, uma linha por NF. O pedido não faturado continua na aba Pedidos do app (ponto em aberto P6) |
| Financeiro (4 cartões e o motivo do bloqueio) | Limite, Saldo disponível e Prazo médio no Resumo, logo depois de Dados cadastrais; a aba vira **Histórico**, só com as notas, o filtro e o detalhe da nota com as parcelas (R-20261119-0530) |
| Anexos (Foto do PDV, Fotos do PDV) | Documentação, no grupo "Fotos do PDV" (P9) |
| Aba Compras | **Documentação** entra no lugar: a lista de documentos do cliente por tipo |

O que **sai** de vez, porque já aparece em outro lugar ou não serve para agir:
- "Compras no mês": o valor está nas notas do mês, no Histórico. "Compras em 12 meses" também sai (P7).
- As linhas mensais do histórico ("11/2026 · 2 pedidos · 17 itens"): o Histórico já lista as notas por mês.
- O cartão "Vencidos" do Financeiro: a NF em atraso passa a ter o status "Em atraso" na própria tabela de notas (§4). Não há aviso de atraso em nenhuma outra aba da ficha (R-20261119-0440).
- "Última compra" e "Sugestão de mix" (R-20261119-0440).
- "Crédito disponível" e "Em aberto": o Saldo disponível já dá o crédito que sobra, e o saldo de cada nota está no Histórico (R-20261119-0530; premissa acima).
- As tags de curva: as curvas viram linhas do bloco Performance (R-20261119-0530).
- A linha de botões "Ligar", "WhatsApp" e "Mapa": ligar e WhatsApp ficam em cada linha da tabela Contatos e o mapa em cada linha da tabela Endereços (uma ação, um lugar).
- O botão "Foto do PDV" separado: a fachada vira a primeira linha de "Fotos do PDV" e o toque abre a foto.
- A linha "Endereço" dos dados cadastrais: o endereço fica só na tabela Endereços, com o CEP. A faixa mostra o código, o bairro e a cidade, sem a rua.

## 2. Cabeçalho, abas e avisos (iguais nas três abas)

- **Faixa Azul noite:**
  - o voltar ("‹ Clientes" no Campo; no Gestão, "‹ Carla Lima" ou a tela de origem);
  - o título com o nome fantasia ("Mercado Bom Preço");
  - o subtítulo "C5007 · Centro · Boa Vista/RR";
  - o sino das notificações, como hoje.
- **Abas:** "Resumo", "Histórico" e "Documentação", fixas, com a largura pelo texto. A aba ativa fica em 16/600, em grafite, com o traço de 3 dp em Azul noite. As outras ficam em 16/400, no #4A5562.
- **Sem alerta financeiro na ficha** (R-20261119-0440): nenhuma aba da ficha mostra aviso de título vencido, NF em atraso ou limite. O atraso aparece só no Histórico, na tabela de notas (§4). Os Alertas do Novo pedido ("Limite de crédito excedido", "Título vencido") não mudam. O motivo de um bloqueio por crédito fica no fim do cartão de crédito do Resumo (§3), só quando houver. Os avisos que não são financeiros (inativo, atendimento aberto, etapa pendente, erro de foto) continuam na área única de Alertas (RN-VEN-42), no topo do conteúdo e só quando houver; nas pranchas não há nenhum.
- **Rodapé do Campo:** "Check-in", "Pesquisa" e "Novo pedido" (principal), como hoje. Na prancha, o "+" saiu de "Novo pedido": com a fonte mais larga do teste (Inter), os três botões não cabiam em 320 dp. No Android, com Roboto, o "+" de hoje cabe e pode ficar.
- **Rodapé do Gestão:** não tem (P13).

## 3. Aba Resumo (ordem dos blocos)

Tabelas (todas as listas da ficha): no padrão da `TabelaDeItens` do Novo pedido (`tabelas-pedido.tsx`, print `15-pedido-resumo`), num cartão: cabeçalho 12/600 em #4A5562, alinhado como a coluna; linhas de no mínimo 44 dp com fio entre elas; espaço de 4 dp entre colunas e 8 dp nas bordas; texto principal 14/600, segunda linha da célula 12 em #4A5562; números tabulares, alinhados à direita, sem "R$" na célula (a moeda vai no cabeçalho, "Valor (R$)"); código de produto e número da NF em mono 12, sublinhado, em Azul noite (abre o detalhe). Nenhuma célula corta com reticências em 360 dp: o texto longo quebra em duas linhas. Os pares rótulo-valor (Dados cadastrais, crédito, Performance) usam a `TabelaRotuloValor` do Novo pedido: rótulo 14 em #4A5562 à esquerda, valor 16 à direita. No crédito e na Performance a coluna do rótulo tem 136 dp, para "Saldo disponível" e "Curva Faturamento" caberem numa linha; em Dados cadastrais fica em 104 dp, para o CNPJ caber.

1. **Dados cadastrais** (rótulo-valor): "Razão social", "CNPJ", "Filial", "Segmento" e "Cliente desde".
2. **Crédito** (rótulo-valor, sem título, logo depois de Dados cadastrais; R-20261119-0530): "Limite" (R$ 8.000,00), "Saldo disponível" (R$ 1.880,00: limite − em aberto − pedidos aprovados não faturados, RN-VEN-12) e "Prazo médio" (24 dias). Com o cliente bloqueado por crédito, a linha do motivo entra no fim do cartão, como hoje. Premissa: só esses três itens (ver o topo).
3. **Endereços** (tabela): **Local · Endereço · Mapa**. Local com "Padrão" na 2ª linha do principal; Endereço com a rua e o número e, na 2ª linha, o bairro e o CEP; Mapa é o botão de 44 dp que abre o mapa.
4. **Contatos** (tabela): **Nome · Cargo · Ligar · WhatsApp**. "Principal" vai na 2ª linha do nome. Os botões têm 44 dp e os rótulos "Ligar para Antônio Ferreira" e "WhatsApp de Antônio Ferreira"; ficam desligados sem número, como hoje.
5. **Gestão, só lá: Carteira** (tabela): **Vendedora · Ligar · WhatsApp**, com "Carla Lima" e os rótulos "Ligar para Carla Lima" e "WhatsApp de Carla Lima". Com mais de uma pessoa na carteira, uma linha por pessoa e a coluna passa a "Pessoa".
6. **Performance** (título de seção, 18/700; era "Compras", R-20261119-0530), uma tabela rótulo-valor de 2 colunas, nesta ordem:
   - as curvas (RN-CORE-49), uma por linha, com o valor A, B ou C: "Curva Faturamento" (A), "Curva Frequência" (A) e "Curva Volume" (B). As tags de curva saíram;
   - "Compra média/mês" (R$ 5.210,00), "Ticket médio" (R$ 2.605,00), "Frequência" (a cada 14 dias), "Visitas" (46) e "Última visita" (12/11/2026). No Gestão entra "Visitada por" (Carla Lima), depois da última visita. "Última compra" sai (R-20261119-0440). O bloco Visitas acabou: as visitas vêm para cá (P7, R-20261119-0458).

   Sem compra na janela, os indicadores de compra dão lugar a "Sem compras em 12 meses" (RN-CORE-40); as linhas de visita continuam.
7. **Últimos itens comprados** (tabela): **Produto · Qtd · Data · Total (R$)**. Produto com o nome e o código na 2ª linha; Qtd com a unidade ("10 CX"); Data em dd/mm. Os 3 últimos e, embaixo da tabela, "Ver os 20 itens ›", que abre a lista completa na mesma tabela (RN-CORE-50).
8. **Observações:** o texto do ERP, como hoje (RN-CORE-17).

"Sugestão de mix" sai do Resumo (R-20261119-0440).

Para o promotor sem `promotor_ve_pedidos` (RN-PRO-01), ficam fora o cartão de crédito (bloco 2, que seguia o acesso ao financeiro), as curvas e os indicadores de compra do bloco 6 e o bloco 7; as linhas de visita ficam, sob o título "Visitas". Fica o resto.

## 4. Aba Histórico

Era a aba Financeiro (R-20261119-0530). É o único lugar da ficha onde o atraso aparece (R-20261119-0440). Limite, Saldo disponível e Prazo médio ficam no Resumo (§3); aqui ficam só a contagem, o filtro e a tabela.

1. **Contagem e filtro** (uma linha): à esquerda, a contagem "8 notas · últimos 90 dias" (com o filtro de status, "1 nota em atraso · últimos 90 dias"); à direita, o botão de filtro, de 48 dp. Quando há filtro fora do padrão, ele mostra a contagem num círculo laranja (gráfico). O padrão não conta. Não há campo de busca na aba: a busca pelo Nº da NF fica na folha Filtrar (P14, R-20261119-0458).
2. **Filtros aplicados:** um chip para cada filtro fora do padrão, com "×" para tirar ("Em atraso ×"; com busca, "NF 004655 ×").
3. **Tabela de notas**, da mais recente para a mais antiga (§3, padrão das tabelas). Colunas escolhidas para caber em 360 dp sem reticências:

| Coluna | Largura | Conteúdo |
|---|---|---|
| Data | 36 dp | dd/mm ("07/11"); o ano está na faixa do mês |
| Nº NF | o que sobra (~104 dp) | o número em mono 12, sublinhado; **2ª linha: a forma de pagamento** ("Boleto 28 dias"; vem do ERP, D2 confirmado, §9). "Boleto 14/21 dias" quebra em duas linhas |
| Valor (R$) | 64 dp | o valor da nota em 14/600; 2ª linha, só quando houver: a devolução ("− 330,00"; depende de D3) |
| Status | 92 dp, 8 dp de afastamento | o chip de status, sem data (R-20261119-0530) |

   A forma de pagamento ficou como 2ª linha do Nº NF, e não como coluna: como coluna, ela tiraria uns 90 dp e o Status não caberia. Uma faixa por mês ("NOVEMBRO DE 2026", 12/600 em maiúsculas) separa as notas. A linha inteira é tocável e pede para baixar a NF (P17, abaixo).

   **NF em atraso:** status "Em atraso" (`danger`), a linha com fundo #FDF1EF e fio vermelho de 3 dp à esquerda. O chip vai sem data (R-20261119-0530). É a nota que tem parcela vencida e não paga.
4. **Chips de status**, nos tons do sistema e sempre com texto:

| Status | Tom |
|---|---|
| Em atraso | `danger` (#A8261B sobre #FDE8E6) |
| Em aberto | `warning` (#7A4F00 sobre #FFF1D6) |
| Pago | `success` (#1D6B4F sobre #E2F1EA) |
| Devolvido | `neutral` (#34404D sobre #ECEEF1) |
| Devolvido parcial | `accent` (#1E3350 sobre #DFE2E6) |

Dentro da tabela, o chip quebra em duas linhas quando não cabe ("Devolvido parcial").

"Em aberto", "Em atraso" e "Pago" saem do título de hoje (`TituloSync`: aberto com vencimento futuro, aberto com vencimento passado, baixado). "Devolvido" e "Devolvido parcial" dependem do vínculo título → NF → devolução (D3, §9). Uma NF com saldo vencido fica "Em atraso" mesmo com outra parcela a vencer.

**Folha "Filtrar"**, que sobe de baixo:
- **"Nº da NF"**, no topo (P14, R-20261119-0458): o campo de busca, com a lupa e o texto de exemplo "Buscar pelo número". Busca nas notas do período;
- "Período": "30 dias", "90 dias" (padrão), "12 meses" e "Escolher datas". Todo período vem do servidor (§8);
- "Status": "Em atraso" (primeiro), "Em aberto", "Pago", "Devolvido" e "Devolvido parcial", de múltipla escolha. O padrão é nenhum marcado, que vale como todos;
- "Forma de pagamento": as formas que aparecem nas notas do cliente (vem do ERP, D2; nota sem a forma não entra no grupo);
- botões "Limpar" e "Ver 1 nota" (principal), com a contagem ao vivo. Nenhum resultado dá "Nenhuma nota" e o botão fica desligado.

**Baixar a NF** (P17, R-20261119-0458; §8). Ao tocar na linha, sobe uma folha curta com o título "Baixar a NF 004655?" e os botões "Agora não" (secundário) e "Baixar" (principal). Sem texto de explicação. "Baixar" busca no servidor o detalhe, as parcelas, os itens e o PDF; enquanto busca, o botão mostra "Baixando…" e fica desligado. Ao fechar a folha, nada fica guardado: o próximo toque pergunta de novo.

**Sem internet ao baixar:** folha com o título "NF 004655", o ícone sem rede e "Sem internet", e o botão principal "Tentar de novo". Sem internet, o toque na linha abre direto esta folha, sem a pergunta.

**Detalhe da nota** (folha), aberto depois de "Baixar":
- título "NF 004655" e, embaixo, "10/10/2026 · Boleto 14/21 dias", com o chip de status;
- rótulo-valor: "Valor da nota" e, só quando houver, "Em atraso" (em vermelho) ou "Devolvido em 29/10" ("− R$ 330,00") e "Valor final";
- "Parcelas" (tabela): **Parcela · Vencimento · Valor (R$) · Status**; a parcela paga leva "paga em 23/10" na 2ª linha do vencimento; a parcela em atraso tem o mesmo destaque da linha da nota;
- dois botões secundários, lado a lado: "Ver itens (4)" e "Ver PDF". O PDF abre no visualizador do shell, só para ver, sem salvar.

**Itens da nota** (folha, R-20261119-0440; dados vindos do servidor junto com o detalhe): título "Itens da NF 004655" e "4 itens · R$ 1.280,00"; tabela **Produto · Emb. · Qtd · Total (R$)**, como a de itens do Novo pedido: Produto com o nome e o código (mono, sublinhado) na 2ª linha; Emb. com a unidade e o fator na 2ª linha ("CX / c/ 6"); Qtd; Total em 14/600.

**Estados:**
- sem notas na janela: "Nenhuma nota nos últimos 90 dias" e o botão "Ver 12 meses";
- sem dados financeiros: "Sem dados financeiros", como hoje;
- sem internet ao abrir a aba ou ao mudar o filtro (§8): no lugar da tabela, o ícone sem rede, "Sem internet" e o botão principal "Tentar de novo";
- sem internet ao tocar numa nota: a folha "Sem internet" (acima).

## 5. Aba Documentação

1. **Tabela de documentos** (§3, padrão das tabelas): **Documento · Data · Abrir**, com uma faixa por tipo ("FOTOS DO PDV", "CADASTRO", "CONTRATOS"), como a faixa do mês no Histórico:
   - Documento: o nome em 14/600; na 2ª linha, o formato e, quando houver, a validade ("PDF · válido até 03/2027"). A validade ficou na 2ª linha, e não como coluna, para o nome caber em uma ou duas linhas;
   - Data: dd/mm/aaaa, 76 dp;
   - Abrir: 44 dp, com a seta (abre o arquivo do servidor no visualizador do shell, só para ver: sem "Baixar" e sem salvar, P15, §8), o cadeado (sem permissão) ou a câmera (foto que falta, quando o perfil "vê e envia").

   Os grupos: "Fotos do PDV", o que é hoje Anexos (RN-CORE-38; "Fachada" com "Foto" e a data; "Gôndola" com "Falta" em vermelho e a câmera); "Cadastro" (Alvará de funcionamento, Cartão CNPJ, Comprovante de endereço); "Contratos" (Contrato de comodato, Contrato social). Os grupos e a ordem vêm do cadastro de tipos (§7).
2. **Documento vencido:** a 2ª linha do documento ganha "Vencido em 10/2026" em vermelho, no lugar do "válido até". Sem aviso fora da tabela (P16).
3. **Sem permissão por exceção** (§7): o nome em #4A5562, "Sem permissão para abrir" na 2ª linha, data "—" e o cadeado na coluna Abrir. A linha não abre e não dá aviso ao tocar, porque ela mesma já diz o porquê. A acessibilidade lê "…, sem permissão para abrir".
4. **Tipo que o perfil não vê:** não aparece. Na prancha, a vendedora não vê "Contrato social" e a supervisora vê.
5. **Estado vazio:** o ícone e "Nenhum documento deste cliente". Fica sem texto de explicação.
   **Sem internet ao abrir a aba** (§8): no lugar da tabela, o ícone sem rede, "Sem internet" e o botão principal "Tentar de novo".
6. **Abrir sem internet** (P15, R-20261119-0458; §8):
   - folha com o título do documento;
   - o ícone sem rede e o texto "Sem internet";
   - o botão principal "Tentar de novo".

## 6. Gestão

É o mesmo componente, com estas diferenças:
- o voltar leva à tela de origem;
- a tabela "Carteira" no Resumo, depois de Contatos;
- "Visitada por" no bloco Performance, depois da última visita (P7);
- sem rodapé (o pedido em nome sai da ficha da vendedora, RF-GES-05);
- sem a câmera nas fotos;
- na Documentação, o que o perfil Supervisor ou Gerente vê;
- a barra de baixo do Gestão: Início, Equipe, Aprovações e Alertas.

O Histórico é igual ao do Campo. O crédito e a Performance (com as três curvas) ficam no Resumo, como no Campo (R-20261119-0530).

## 7. Permissões

- **Aba Histórico e cartão de crédito do Resumo:** seguem o acesso ao financeiro de hoje. O promotor sem `promotor_ve_pedidos` não vê a aba nem o cartão e fica com duas abas: Resumo e Documentação (P12).
- **Documentos, por tipo e por perfil** (BKO › Parâmetros › Documentos, prancha 05):
  - os níveis são "Não vê", "Vê" e "Vê e envia". "Vê e envia" só existe nos tipos que o app captura (Fotos do PDV);
  - as colunas são os perfis do app da empresa (Vendedor, Promotor, Supervisor, Gerente e os derivados);
  - Administrador e Analista do BKO veem tudo;
  - a origem do tipo (ERP, Escritório, App) aparece embaixo do nome;
  - "Salvar permissões" é o principal da página e só liga com alguma mudança. "Descartar" desfaz;
  - toda mudança é auditada (RN-AUD-01) e vale na próxima vez que o app abrir a aba (§8).
- **Exceção por documento** (quadro "Exceções por documento"):
  - cada exceção tem o documento, o cliente e quem vê;
  - a exceção **só tira acesso** do que o tipo libera (P11): "A exceção só tira acesso do que o tipo libera.";
  - no app, quem perde acesso vê a linha com cadeado (§5.3);
  - "Adicionar exceção" é secundário.
- **A API sempre revalida:** a lista e a abertura do arquivo checam o perfil, a carteira e a licença do módulo. O app nunca recebe o arquivo de um documento sem permissão.

## 8. Offline (o que fica no aparelho)

Uma regra para a ficha toda (P15 e P17, R-20261119-0458): só o Resumo fica no aparelho; o Histórico e a Documentação são online e nada deles fica guardado.

- **Resumo (fica no aparelho):** Dados cadastrais, endereços, contatos, o cartão de crédito, a Performance e os últimos itens comprados vêm das linhas do sync de hoje e funcionam em modo avião.
- **Histórico (online):**
  - a tabela de notas vem do servidor ao abrir a aba e a cada mudança de período ou de filtro; não há pull de notas nem de 12 meses;
  - a NF (detalhe, parcelas, itens e PDF) vem do servidor ao tocar, com a autorização do vendedor ("Baixar a NF …?"), e é descartada ao fechar;
  - sem internet, a aba e a folha da NF mostram os estados do §4.
- **Documentação (online):**
  - a lista vem do servidor ao abrir a aba;
  - o arquivo só abre para ver, vindo do servidor; não baixa;
  - sem internet, a aba e a folha do arquivo mostram os estados do §5;
  - as fotos tiradas sem internet entram na fila, como hoje ("Na fila").
- **Permissões:** a API filtra a lista e o arquivo pelo perfil, pela carteira e pelas exceções a cada consulta; perder o acesso vale na próxima abertura.

## 9. Dependências (ERP e contratos)

Levantamento do `modulo-integracao` (19/11). O desenho não define contrato; cada item abaixo é do dono indicado.

| # | O que falta | Hoje | Dono |
|---|---|---|---|
| D1 | Consulta online das notas do cliente por período (data, número, valor, forma e status) ao abrir o Histórico e da NF (detalhe, parcelas, itens e PDF) ao tocar, sem guardar (P17, R-20261119-0458; §8) | A NF existe no servidor (`core.nota_erp`: número, série, data, total, faturamento ou devolução), mas não vai ao aparelho | `modulo-core` (contrato da consulta), `banco-dados` (índice e RLS) |
| D2 | Forma de pagamento por NF. **Confirmado pelo ERP em 19/11 (E1, R-20261119-0458):** o ERP manda a forma por NF; falta pôr no contrato e na carga | Não existe no contrato | `modulo-integracao` (carga do ERP), `modulo-core` (contrato) |
| D3 | Vínculo título → NF → devolução (status "Devolvido" e "Devolvido parcial", valor devolvido, parcelas no detalhe) | `TituloSync` tem só aberto, baixado ou cancelado, sem a NF | `modulo-integracao` (carga do ERP), `modulo-core` (contrato), `banco-dados` (tabela e chave) |
| D4 | ~~12 meses de notas e títulos no aparelho~~ **Deixou de existir em 19/11 (P17, R-20261119-0458):** sem pull de 12 meses; o Histórico é consulta online (D1, §8) | Pull de 90 dias dos títulos (o Histórico não lê dele) | `modulo-core` (consulta online por período), `banco-dados` (índice da consulta) |
| D5 | Documento do cliente e tipo de documento, com a matriz de permissão e as exceções | Não existe entidade; a aba Anexos mostra só a foto do PDV | `modulo-core` (entidades novas, ADR e contrato), `banco-dados` (tabelas e RLS) |
| D6 | Documento com origem no ERP (P1) | Não há carga | `modulo-integracao` (entidade e carga novas no Hub e no Conector) |

O upload no BKO (Cadastros › Clientes › ficha do cliente) aproveita o `plataforma.arquivo`, que já existe; a tela fica fora desta simulação.

## 10. Pontos em aberto (A/B, com recomendação) e decisões de 19/11

| # | Ponto | A | B | Recomendo | Decisão (19/11, R-20261119-0458) |
|---|---|---|---|---|---|
| P1 | Origem dos documentos | Só do ERP (depende do ERP: D6) | Só upload no BKO (usa o `plataforma.arquivo`, que já existe; precisa de D5) | **Os dois (A+B)**, com a origem por tipo (ERP, Escritório, App), como na prancha 05, e cada tipo com uma origem só. A **primeira entrega pode ser só B** (upload no BKO); a origem ERP entra quando houver a entidade e a carga novas (D6) | Como recomendado (A+B; primeira entrega pode ser só B) |
| P2 | Notas e títulos | **Juntos**: a linha é a NF e as parcelas (títulos) ficam no detalhe (depende do ERP: D1 e D3) | Separados: duas listas, "Notas" e "Títulos" | **Decidido em 19/11 (R-20261119-0440), substitui a recomendação "o vencido fica nos Alertas":** juntos (A), e o atraso aparece só no Histórico (era Financeiro), com o status "Em atraso", a linha em destaque e o filtro (§4). Nenhum alerta financeiro na ficha | Como recomendado (A, já decidido em R-20261119-0440) |
| P3 | NF com devolução parcial e saldo em aberto (as duas opções dependem do ERP: D3) | "Em atraso" ou "Em aberto" prevalece enquanto houver saldo; "Devolvido parcial" só depois de quitada | "Devolvido parcial" prevalece e a 2ª linha do Status mostra o saldo | **A**. O vendedor age sobre o saldo | Como recomendado (A) |
| P4 | "Devolvido parcial" mostra o valor devolvido? (as duas opções dependem do ERP: D3) | Sim, na 2ª linha do Valor ("− 330,00") e no detalhe | Só no detalhe | **A**. Explica a diferença do valor sem precisar abrir | Como recomendado (A) |
| P5 | Onde fica Documentos em Parâmetros | **Seção nova "Documentos"** (prancha 05) | Dentro de Parâmetros › Clientes | **A**. O quadro é grande e vai crescer (tipos e exceções); em Clientes, empurraria os parâmetros de cliente para baixo | Como recomendado (A) |
| P6 | Pedidos e itens que estavam em Compras | O pedido não faturado fica só na aba Pedidos do app, com o filtro do cliente; os itens ficam em "Últimos itens comprados" (Resumo) e em "Ver itens da nota" | Um bloco "Últimos pedidos" no Resumo | **A**. O faturado já está no Histórico e o resto na aba Pedidos | Como recomendado (A) |
| P7 | Indicadores de compra | Os 4 da RN-CORE-40; "Compras no mês" e "Compras em 12 meses" saem | Mantém os 6 | **A**, e em 19/11 "Última compra" também saiu (R-20261119-0440): ficam 3. A RN-CORE-40 segue valendo no cálculo; a mudança de texto da regra é do `modulo-core` | A, **com mudança:** o bloco Visitas acaba; "Visitas" e "Última visita" (e, no Gestão, "Visitada por") entram no bloco de compras do Resumo, hoje "Performance" (R-20261119-0530) (§3, pranchas 01 e 04) |
| P8 | Filtro padrão do Histórico | Últimos 90 dias, todos os status | Últimos 12 meses, todos os status | **A**. A lista é curta. O filtro abre mais meses conforme o P17 | Como recomendado (A) |
| P9 | Fotos do PDV (hoje em Anexos) | Grupo "Fotos do PDV" dentro de Documentação | Volta a ser uma aba (quatro abas) | **A**. O pedido foi de três abas | Como recomendado (A) |
| P10 | Documento sem permissão | Aparece com cadeado e "Sem permissão para abrir" | Some | **A** na exceção por documento (o vendedor sabe que existe e pede ao escritório). O **tipo** sem permissão some | Como recomendado (A) |
| P11 | Exceção por documento | Só tira acesso | Também libera | **A**, como a exceção de licença por usuário (RF-CORE-03) | Como recomendado (A) |
| P12 | Promotor sem `promotor_ve_pedidos` | A aba Histórico some | A aba aparece só com o crédito, sem notas | **A**. Com o ajuste de 05h30 (R-20261119-0530), o cartão de crédito do Resumo também some. Sem o pedido, a nota também não aparece (RN-PRO-01) | Como recomendado (A) |
| P13 | Rodapé no Gestão | Sem rodapé | "Novo pedido" em nome da vendedora | **A**. O pedido em nome já sai da ficha da vendedora (RF-GES-05) | Como recomendado (A) |
| P14 | Busca no Histórico | Campo "Nº da NF" sempre visível | Só a lupa, que abre o campo | **A**. É um toque a menos | **Mudou:** sem campo nem lupa na aba; a busca "Nº da NF" fica no topo da folha Filtrar, dentro do botão de filtro (§4, prancha 02) |
| P15 | Download dos arquivos | No primeiro toque, e o arquivo fica guardado | Todos na sincronização (só no Wi-Fi) | **A**. Poupa dados e espaço; os tipos marcados como "levar para a rua" podem baixar na sincronização numa versão seguinte | **Mudou:** nem A nem B: só visualizar, do servidor, sem baixar e sem guardar no aparelho; sem internet, "Sem internet" e "Tentar de novo" (§5, §8, prancha 03) |
| P16 | Documento vencido nos Alertas | Sim, para os tipos marcados no BKO | Não, só na Documentação | **Decidido em 19/11 (R-20261119-0440), substitui a recomendação anterior:** B. O vencido aparece só na linha do documento ("Vencido em …", em vermelho), sem aviso nas outras abas | Como recomendado (B, já decidido em R-20261119-0440) |
| P17 | Janela de "12 meses" no Histórico (hoje o aparelho tem 90 dias) | Estender o pull das notas e títulos para 12 meses (D4) | "12 meses", "Escolher datas" além de 90 dias e "Ver 12 meses" só com sinal, consultando o servidor; sem sinal, a opção fica desligada | **A**. O vendedor consulta o histórico na rua, sem sinal; B entra só se o volume de 12 meses pesar no aparelho | **Mudou:** sem pull de 12 meses (D4 deixa de existir); a NF (detalhe, parcelas, itens e PDF) vem do servidor ao tocar, só com a autorização "Baixar a NF …?", e não fica guardada; o Histórico é online (§4, §8, prancha 02) |
| E1 | O ERP manda a forma de pagamento por NF? (D2) | — | — | — | **Sim.** D2 confirmado pelo ERP; a forma fica na 2ª linha do Nº NF e no filtro (§4, §9) |
