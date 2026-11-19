# Cliente 360 v2: Resumo, Financeiro e Documentação (simulação)

Pedido do dono do produto: R-20261119-030234. É uma simulação, sem código. O desenho vale para o Campo e o Gestão e inclui a permissão de documentos em BKO › Parâmetros.

**Revisão de 19/11 (R-20261119-0440):** as pranchas 01 a 04 foram refeitas pelo comentário do dono do produto sobre a simulação:
1. no Resumo, os dados cadastrais e os endereços vêm **primeiro**, no topo da aba;
2. saem "Última compra" e "Sugestão de mix";
3. **nenhum alerta financeiro nas páginas da ficha**: a NF em atraso aparece só na aba Financeiro, onde o vendedor vê e age (status "Em atraso", linha em destaque e filtro). Os Alertas do pedido (Novo pedido) não mudam;
4. **toda lista vira tabela**, com colunas e cabeçalho, no padrão da tabela de itens do Novo pedido (print `15-pedido-resumo` da apresentação): notas, parcelas e itens da nota (Financeiro), documentos (Documentação), endereços, contatos e últimos itens comprados (Resumo).

A prancha 05 (BKO) não mudou.

Pranchas desta pasta (gere com `node docs/design/cliente-360-v2/gerar.mjs`, a partir da raiz do repositório):

| Prancha | O que mostra |
|---|---|
| `01-campo-resumo.png` | Resumo no Campo: topo (cadastro e endereços), Endereços e Contatos, Compras e Visitas, fim da rolagem |
| `02-campo-financeiro.png` | Financeiro: filtros fechados (padrão), tabela rolada com os cinco status, folha de filtros com "Em atraso", filtro "Em atraso" aplicado, detalhe da nota com as parcelas e itens da nota |
| `03-campo-documentacao.png` | Documentação: tabela por tipo, documento sem permissão, estado vazio e arquivo sem internet |
| `04-gestao.png` | O mesmo Cliente 360 no Gestão (supervisora): Resumo e Documentação |
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
- limite de R$ 8.000 e R$ 6.120 em aberto: crédito disponível de R$ 1.880;
- o valor em aberto soma os saldos de quatro notas: 2.380 + 1.560 + 1.540 + 640;
- 1 NF em atraso: a 004655, de R$ 1.280,00, com a parcela 2/2 (R$ 640,00) vencida em 31/10; a 1/2 foi paga em 23/10;
- compras de novembro: R$ 3.940, nas NFs 004817 e 004790, que vêm dos pedidos 000017 e 000013. O pedido 000009 virou a NF 004702;
- itens da NF 004655: 645,00 + 371,00 + 144,00 + 120,00 = R$ 1.280,00.

## 1. O que muda em relação ao de hoje

Hoje a ficha tem seis abas, roladas na horizontal: Resumo, Cadastro, Financeiro, Compras, Performance e Anexos. A v2 tem **três abas fixas**, sem rolagem: **Resumo · Financeiro · Documentação**.

| Hoje | Na v2 |
|---|---|
| Resumo (contato, Compras no mês, Última compra) | Os botões de contato vão para a tabela Contatos; "Compras no mês" e "Última compra" saem |
| Cadastro (CNPJ, endereço, filial, segmento, contatos, endereços de entrega, observações) | Resumo, **no topo** ("Dados cadastrais", Endereços, Contatos); Observações no fim |
| Performance (visitas, curvas, prazo médio, últimos itens, sugestão de mix) | Resumo, depois do cadastro. As curvas vão para o bloco Compras e o prazo médio vai para o Financeiro; a sugestão de mix sai |
| Compras: 4 indicadores | Resumo › Compras, com 3 indicadores (Compra média/mês, Ticket médio, Frequência); "Última compra" sai (R-20261119-0440) |
| Compras: "Histórico de Pedidos" (pedidos e linhas mensais) | **Sai.** A compra faturada aparece no Financeiro, uma linha por NF. O pedido não faturado continua na aba Pedidos do app (ponto em aberto P6) |
| Financeiro (4 cartões e o motivo do bloqueio) | Financeiro com o bloco de crédito em tabela compacta, o histórico de notas com filtros e o detalhe da nota com as parcelas |
| Anexos (Foto do PDV, Fotos do PDV) | Documentação, no grupo "Fotos do PDV" (P9) |
| Aba Compras | **Documentação** entra no lugar: a lista de documentos do cliente por tipo |

O que **sai** de vez, porque já aparece em outro lugar ou não serve para agir:
- "Compras no mês": o valor está nas notas do mês, no Financeiro. "Compras em 12 meses" também sai (P7).
- As linhas mensais do histórico ("11/2026 · 2 pedidos · 17 itens"): o Financeiro já lista as notas por mês.
- O cartão "Vencidos" do Financeiro: a NF em atraso passa a ter o status "Em atraso" na própria tabela de notas (§4). Não há aviso de atraso em nenhuma outra aba da ficha (R-20261119-0440).
- "Última compra" e "Sugestão de mix" (R-20261119-0440).
- A linha de botões "Ligar", "WhatsApp" e "Mapa": ligar e WhatsApp ficam em cada linha da tabela Contatos e o mapa em cada linha da tabela Endereços (uma ação, um lugar).
- O botão "Foto do PDV" separado: a fachada vira a primeira linha de "Fotos do PDV" e o toque abre a foto.
- A linha "Endereço" dos dados cadastrais: o endereço fica só na tabela Endereços, com o CEP. A faixa mostra o código, o bairro e a cidade, sem a rua.

## 2. Cabeçalho, abas e avisos (iguais nas três abas)

- **Faixa Azul noite:**
  - o voltar ("‹ Clientes" no Campo; no Gestão, "‹ Carla Lima" ou a tela de origem);
  - o título com o nome fantasia ("Mercado Bom Preço");
  - o subtítulo "C5007 · Centro · Boa Vista/RR";
  - o sino das notificações, como hoje.
- **Abas:** "Resumo", "Financeiro" e "Documentação", fixas, com a largura pelo texto. A aba ativa fica em 16/600, em grafite, com o traço de 3 dp em Azul noite. As outras ficam em 16/400, no #4A5562.
- **Sem alerta financeiro na ficha** (R-20261119-0440): nenhuma aba da ficha mostra aviso de título vencido, NF em atraso ou limite. O atraso aparece só no Financeiro, na tabela de notas (§4). Os Alertas do Novo pedido ("Limite de crédito excedido", "Título vencido") não mudam. O motivo de um bloqueio por crédito fica no Financeiro, como linha do bloco de crédito, só quando houver. Os avisos que não são financeiros (inativo, atendimento aberto, etapa pendente, erro de foto) continuam na área única de Alertas (RN-VEN-42), no topo do conteúdo e só quando houver; nas pranchas não há nenhum.
- **Rodapé do Campo:** "Check-in", "Pesquisa" e "Novo pedido" (principal), como hoje. Na prancha, o "+" saiu de "Novo pedido": com a fonte mais larga do teste (Inter), os três botões não cabiam em 320 dp. No Android, com Roboto, o "+" de hoje cabe e pode ficar.
- **Rodapé do Gestão:** não tem (P13).

## 3. Aba Resumo (ordem dos blocos)

Tabelas (todas as listas da ficha): no padrão da `TabelaDeItens` do Novo pedido (`tabelas-pedido.tsx`, print `15-pedido-resumo`), num cartão: cabeçalho 12/600 em #4A5562, alinhado como a coluna; linhas de no mínimo 44 dp com fio entre elas; espaço de 4 dp entre colunas e 8 dp nas bordas; texto principal 14/600, segunda linha da célula 12 em #4A5562; números tabulares, alinhados à direita, sem "R$" na célula (a moeda vai no cabeçalho, "Valor (R$)"); código de produto e número da NF em mono 12, sublinhado, em Azul noite (abre o detalhe). Nenhuma célula corta com reticências em 360 dp: o texto longo quebra em duas linhas. Os pares rótulo-valor (Dados cadastrais, Compras, Visitas) usam a `TabelaRotuloValor` do Novo pedido: rótulo 14 em #4A5562 à esquerda, valor 16 à direita.

1. **Dados cadastrais** (rótulo-valor): "Razão social", "CNPJ", "Filial", "Segmento" e "Cliente desde".
2. **Endereços** (tabela): **Local · Endereço · Mapa**. Local com "Padrão" na 2ª linha do principal; Endereço com a rua e o número e, na 2ª linha, o bairro e o CEP; Mapa é o botão de 44 dp que abre o mapa.
3. **Contatos** (tabela): **Nome · Cargo · Ligar · WhatsApp**. "Principal" vai na 2ª linha do nome. Os botões têm 44 dp e os rótulos "Ligar para Antônio Ferreira" e "WhatsApp de Antônio Ferreira"; ficam desligados sem número, como hoje.
4. **Gestão, só lá: Carteira** (tabela): **Vendedora · Ligar · WhatsApp**, com "Carla Lima" e os rótulos "Ligar para Carla Lima" e "WhatsApp de Carla Lima". Com mais de uma pessoa na carteira, uma linha por pessoa e a coluna passa a "Pessoa".
5. **Compras** (título de seção, 18/700):
   - as tags de curva (RN-CORE-49): "Faturamento A", "Volume B" e "Frequência A", em chips no tom de destaque;
   - rótulo-valor: "Compra média/mês" (R$ 5.210,00), "Ticket médio" (R$ 2.605,00) e "Frequência" (a cada 14 dias). "Última compra" sai (R-20261119-0440).

   Sem compra na janela, o bloco mostra só "Sem compras em 12 meses" (RN-CORE-40).
6. **Visitas** (rótulo-valor): "Visitas" (46) e "Última visita" (12/11/2026). No Gestão entra "Visitada por" (Carla Lima).
7. **Últimos itens comprados** (tabela): **Produto · Qtd · Data · Total (R$)**. Produto com o nome e o código na 2ª linha; Qtd com a unidade ("10 CX"); Data em dd/mm. Os 3 últimos e, embaixo da tabela, "Ver os 20 itens ›", que abre a lista completa na mesma tabela (RN-CORE-50).
8. **Observações:** o texto do ERP, como hoje (RN-CORE-17).

"Sugestão de mix" sai do Resumo (R-20261119-0440).

Para o promotor sem `promotor_ve_pedidos` (RN-PRO-01), ficam fora os blocos 5 e 7 e o prazo médio. Fica o resto.

## 4. Aba Financeiro

É o único lugar da ficha onde o atraso aparece (R-20261119-0440).

1. **Bloco de crédito:** uma tabela compacta 2×2 num cartão, como o bloco de crédito do Novo pedido (RF-VEN, `novo-pedido-itens.md` §2.1). Os valores ficam em destaque, 16/600, com algarismos tabulares: "Limite" R$ 8.000,00 · "Crédito disponível" R$ 1.880,00 · "Em aberto" R$ 6.120,00 (inclui o saldo em atraso) · "Prazo médio" 24 dias. Com o cliente bloqueado por crédito, entra embaixo a linha do motivo, como hoje.
2. **Busca e filtro:**
   - o campo "Nº da NF", que busca pelo número;
   - o botão de filtro, de 48 dp. Quando há filtro fora do padrão, ele mostra a contagem num círculo laranja (gráfico). O padrão não conta.
3. **Filtros aplicados:** um chip para cada filtro fora do padrão, com "×" para tirar ("Em atraso ×").
4. **Contagem:** "8 notas · últimos 90 dias". Com o filtro de status, fica "1 nota em atraso · últimos 90 dias".
5. **Tabela de notas**, da mais recente para a mais antiga (§3, padrão das tabelas). Colunas escolhidas para caber em 360 dp sem reticências:

| Coluna | Largura | Conteúdo |
|---|---|---|
| Data | 36 dp | dd/mm ("07/11"); o ano está na faixa do mês |
| Nº NF | o que sobra (~104 dp) | o número em mono 12, sublinhado; **2ª linha: a forma de pagamento** ("Boleto 28 dias"; depende de D2, §9). "Boleto 14/21 dias" quebra em duas linhas |
| Valor (R$) | 64 dp | o valor da nota em 14/600; 2ª linha, só quando houver: a devolução ("− 330,00"; depende de D3) |
| Status | 92 dp, 8 dp de afastamento | o chip de status; 2ª linha, só no atraso: "desde 31/10", em vermelho |

   A forma de pagamento ficou como 2ª linha do Nº NF, e não como coluna: como coluna, ela tiraria uns 90 dp e o Status não caberia. Uma faixa por mês ("NOVEMBRO DE 2026", 12/600 em maiúsculas) separa as notas. A linha inteira é tocável e abre o detalhe.

   **NF em atraso:** status "Em atraso" (`danger`), a linha com fundo #FDF1EF e fio vermelho de 3 dp à esquerda, e "desde 31/10" embaixo do chip. É a nota que tem parcela vencida e não paga.
6. **Chips de status**, nos tons do sistema e sempre com texto:

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
- "Período": "30 dias", "90 dias" (padrão), "12 meses" e "Escolher datas". Hoje o aparelho tem só 90 dias de títulos: "12 meses" e datas além de 90 dias seguem o P17;
- "Status": "Em atraso" (primeiro), "Em aberto", "Pago", "Devolvido" e "Devolvido parcial", de múltipla escolha. O padrão é nenhum marcado, que vale como todos;
- "Forma de pagamento": as formas que aparecem nas notas do cliente (depende de D2; sem ela, o grupo não aparece);
- botões "Limpar" e "Ver 1 nota" (principal), com a contagem ao vivo. Nenhum resultado dá "Nenhuma nota" e o botão fica desligado.

**Detalhe da nota** (folha), aberto ao tocar na linha:
- título "NF 004655" e, embaixo, "10/10/2026 · Boleto 14/21 dias", com o chip de status;
- rótulo-valor: "Valor da nota" e, só quando houver, "Em atraso" (em vermelho) ou "Devolvido em 29/10" ("− R$ 330,00") e "Valor final";
- "Parcelas" (tabela): **Parcela · Vencimento · Valor (R$) · Status**; a parcela paga leva "paga em 23/10" na 2ª linha do vencimento; a parcela em atraso tem o mesmo destaque da linha da nota;
- botão secundário "Ver itens da nota (4)".

**Itens da nota** (folha, R-20261119-0440): título "Itens da NF 004655" e "4 itens · R$ 1.280,00"; tabela **Produto · Emb. · Qtd · Total (R$)**, como a de itens do Novo pedido: Produto com o nome e o código (mono, sublinhado) na 2ª linha; Emb. com a unidade e o fator na 2ª linha ("CX / c/ 6"); Qtd; Total em 14/600.

**Estados:**
- sem notas na janela: "Nenhuma nota nos últimos 90 dias" e o botão "Ver 12 meses" (segue o P17: na opção B, só com sinal);
- sem dados financeiros: "Sem dados financeiros", como hoje;
- sem internet: a tabela sai do aparelho e não muda.

## 5. Aba Documentação

1. **Tabela de documentos** (§3, padrão das tabelas): **Documento · Data · Abrir**, com uma faixa por tipo ("FOTOS DO PDV", "CADASTRO", "CONTRATOS"), como a faixa do mês no Financeiro:
   - Documento: o nome em 14/600; na 2ª linha, o formato e, quando houver, a validade ("PDF · válido até 03/2027"). A validade ficou na 2ª linha, e não como coluna, para o nome caber em uma ou duas linhas;
   - Data: dd/mm/aaaa, 76 dp;
   - Abrir: 44 dp, com a seta (abre o arquivo no visualizador do shell), o cadeado (sem permissão) ou a câmera (foto que falta, quando o perfil "vê e envia").

   Os grupos: "Fotos do PDV", o que é hoje Anexos (RN-CORE-38; "Fachada" com "Foto" e a data; "Gôndola" com "Falta" em vermelho e a câmera); "Cadastro" (Alvará de funcionamento, Cartão CNPJ, Comprovante de endereço); "Contratos" (Contrato de comodato, Contrato social). Os grupos e a ordem vêm do cadastro de tipos (§7).
2. **Documento vencido:** a 2ª linha do documento ganha "Vencido em 10/2026" em vermelho, no lugar do "válido até". Sem aviso fora da tabela (P16).
3. **Sem permissão por exceção** (§7): o nome em #4A5562, "Sem permissão para abrir" na 2ª linha, data "—" e o cadeado na coluna Abrir. A linha não abre e não dá aviso ao tocar, porque ela mesma já diz o porquê. A acessibilidade lê "…, sem permissão para abrir".
4. **Tipo que o perfil não vê:** não aparece. Na prancha, a vendedora não vê "Contrato social" e a supervisora vê.
5. **Estado vazio:** o ícone e "Nenhum documento deste cliente". Fica sem texto de explicação.
6. **Sem internet, com o arquivo ainda fora do aparelho:**
   - folha com o título do documento;
   - o texto "Sem internet. Este arquivo ainda não está no aparelho.";
   - o botão principal "Tentar de novo".

## 6. Gestão

É o mesmo componente, com estas diferenças:
- o voltar leva à tela de origem;
- a tabela "Carteira" no Resumo, depois de Contatos;
- "Visitada por" em Visitas;
- sem rodapé (o pedido em nome sai da ficha da vendedora, RF-GES-05);
- sem a câmera nas fotos;
- na Documentação, o que o perfil Supervisor ou Gerente vê;
- a barra de baixo do Gestão: Início, Equipe, Aprovações e Alertas.

O Financeiro é igual ao do Campo.

## 7. Permissões

- **Aba Financeiro:** segue o acesso ao financeiro de hoje. O promotor sem `promotor_ve_pedidos` não vê a aba e fica com duas: Resumo e Documentação (P12).
- **Documentos, por tipo e por perfil** (BKO › Parâmetros › Documentos, prancha 05):
  - os níveis são "Não vê", "Vê" e "Vê e envia". "Vê e envia" só existe nos tipos que o app captura (Fotos do PDV);
  - as colunas são os perfis do app da empresa (Vendedor, Promotor, Supervisor, Gerente e os derivados);
  - Administrador e Analista do BKO veem tudo;
  - a origem do tipo (ERP, Escritório, App) aparece embaixo do nome;
  - "Salvar permissões" é o principal da página e só liga com alguma mudança. "Descartar" desfaz;
  - toda mudança é auditada (RN-AUD-01) e vale na próxima sincronização.
- **Exceção por documento** (quadro "Exceções por documento"):
  - cada exceção tem o documento, o cliente e quem vê;
  - a exceção **só tira acesso** do que o tipo libera (P11): "A exceção só tira acesso do que o tipo libera.";
  - no app, quem perde acesso vê a linha com cadeado (§5.3);
  - "Adicionar exceção" é secundário.
- **A API sempre revalida:** a lista e o download do arquivo checam o perfil, a carteira e a licença do módulo. O app nunca recebe o arquivo de um documento sem permissão.

## 8. Offline (o que fica no aparelho)

- **Resumo:** tudo vem das linhas do sync de hoje (cliente, contatos, endereços, histórico, visitas, itens) e funciona em modo avião.
- **Financeiro:** hoje o pull traz só 90 dias de títulos (`TituloSync`), e a NF não vem ao aparelho (D1). Na recomendação do P17 (A), o aparelho passa a guardar as notas dos últimos 12 meses de cada cliente da carteira, com as parcelas e a devolução; filtro e busca rodam no aparelho e o que passa de 12 meses só aparece com internet. Na opção B, o aparelho fica com 90 dias e o resto só com sinal.
- **Documentação:**
  - a lista (tipo, nome, data, validade, permissão) fica no aparelho;
  - o arquivo baixa no primeiro toque e fica guardado (P15);
  - sem internet e sem o arquivo, aparece a folha do §5.6;
  - as fotos tiradas sem internet entram na fila, como hoje ("Na fila").
- **Permissões:** a matriz e as exceções vêm no sync. Ao perder o acesso, o app apaga o arquivo guardado na sincronização seguinte.

## 9. Dependências (ERP e contratos)

Levantamento do `modulo-integracao` (19/11). O desenho não define contrato; cada item abaixo é do dono indicado.

| # | O que falta | Hoje | Dono |
|---|---|---|---|
| D1 | NF no aparelho | A NF existe no servidor (`core.nota_erp`: número, série, data, total, faturamento ou devolução), mas não vai ao aparelho | `modulo-core` (contrato do sync), `banco-dados` (sync e RLS) |
| D2 | Forma de pagamento por NF | Não existe no contrato | `modulo-integracao` (carga do ERP), `modulo-core` (contrato) |
| D3 | Vínculo título → NF → devolução (status "Devolvido" e "Devolvido parcial", valor devolvido, parcelas no detalhe) | `TituloSync` tem só aberto, baixado ou cancelado, sem a NF | `modulo-integracao` (carga do ERP), `modulo-core` (contrato), `banco-dados` (tabela e chave) |
| D4 | 12 meses de notas e títulos no aparelho (P17) | Pull de 90 dias | `modulo-core` (janela do sync), `banco-dados` (volume e índice) |
| D5 | Documento do cliente e tipo de documento, com a matriz de permissão e as exceções | Não existe entidade; a aba Anexos mostra só a foto do PDV | `modulo-core` (entidades novas, ADR e contrato), `banco-dados` (tabelas e RLS) |
| D6 | Documento com origem no ERP (P1) | Não há carga | `modulo-integracao` (entidade e carga novas no Hub e no Conector) |

O upload no BKO (Cadastros › Clientes › ficha do cliente) aproveita o `plataforma.arquivo`, que já existe; a tela fica fora desta simulação.

## 10. Pontos em aberto (A/B, com recomendação)

| # | Ponto | A | B | Recomendo |
|---|---|---|---|---|
| P1 | Origem dos documentos | Só do ERP (depende do ERP: D6) | Só upload no BKO (usa o `plataforma.arquivo`, que já existe; precisa de D5) | **Os dois (A+B)**, com a origem por tipo (ERP, Escritório, App), como na prancha 05, e cada tipo com uma origem só. A **primeira entrega pode ser só B** (upload no BKO); a origem ERP entra quando houver a entidade e a carga novas (D6) |
| P2 | Notas e títulos | **Juntos**: a linha é a NF e as parcelas (títulos) ficam no detalhe (depende do ERP: D1 e D3) | Separados: duas listas, "Notas" e "Títulos" | **Decidido em 19/11 (R-20261119-0440), substitui a recomendação "o vencido fica nos Alertas":** juntos (A), e o atraso aparece só no Financeiro, com o status "Em atraso", a linha em destaque e o filtro (§4). Nenhum alerta financeiro na ficha |
| P3 | NF com devolução parcial e saldo em aberto (as duas opções dependem do ERP: D3) | "Em atraso" ou "Em aberto" prevalece enquanto houver saldo; "Devolvido parcial" só depois de quitada | "Devolvido parcial" prevalece e a 2ª linha do Status mostra o saldo | **A**. O vendedor age sobre o saldo |
| P4 | "Devolvido parcial" mostra o valor devolvido? (as duas opções dependem do ERP: D3) | Sim, na 2ª linha do Valor ("− 330,00") e no detalhe | Só no detalhe | **A**. Explica a diferença do valor sem precisar abrir |
| P5 | Onde fica Documentos em Parâmetros | **Seção nova "Documentos"** (prancha 05) | Dentro de Parâmetros › Clientes | **A**. O quadro é grande e vai crescer (tipos e exceções); em Clientes, empurraria os parâmetros de cliente para baixo |
| P6 | Pedidos e itens que estavam em Compras | O pedido não faturado fica só na aba Pedidos do app, com o filtro do cliente; os itens ficam em "Últimos itens comprados" (Resumo) e em "Ver itens da nota" | Um bloco "Últimos pedidos" no Resumo | **A**. O faturado já está no Financeiro e o resto na aba Pedidos |
| P7 | Indicadores de compra | Os 4 da RN-CORE-40; "Compras no mês" e "Compras em 12 meses" saem | Mantém os 6 | **A**, e em 19/11 "Última compra" também saiu (R-20261119-0440): ficam 3. A RN-CORE-40 segue valendo no cálculo; a mudança de texto da regra é do `modulo-core` |
| P8 | Filtro padrão do Financeiro | Últimos 90 dias, todos os status | Últimos 12 meses, todos os status | **A**. A lista é curta. O filtro abre mais meses conforme o P17 |
| P9 | Fotos do PDV (hoje em Anexos) | Grupo "Fotos do PDV" dentro de Documentação | Volta a ser uma aba (quatro abas) | **A**. O pedido foi de três abas |
| P10 | Documento sem permissão | Aparece com cadeado e "Sem permissão para abrir" | Some | **A** na exceção por documento (o vendedor sabe que existe e pede ao escritório). O **tipo** sem permissão some |
| P11 | Exceção por documento | Só tira acesso | Também libera | **A**, como a exceção de licença por usuário (RF-CORE-03) |
| P12 | Promotor sem `promotor_ve_pedidos` | A aba Financeiro some | A aba aparece só com o crédito, sem notas | **A**. Sem o pedido, a nota também não aparece (RN-PRO-01) |
| P13 | Rodapé no Gestão | Sem rodapé | "Novo pedido" em nome da vendedora | **A**. O pedido em nome já sai da ficha da vendedora (RF-GES-05) |
| P14 | Busca no Financeiro | Campo "Nº da NF" sempre visível | Só a lupa, que abre o campo | **A**. É um toque a menos |
| P15 | Download dos arquivos | No primeiro toque, e o arquivo fica guardado | Todos na sincronização (só no Wi-Fi) | **A**. Poupa dados e espaço; os tipos marcados como "levar para a rua" podem baixar na sincronização numa versão seguinte |
| P16 | Documento vencido nos Alertas | Sim, para os tipos marcados no BKO | Não, só na Documentação | **Decidido em 19/11 (R-20261119-0440), substitui a recomendação anterior:** B. O vencido aparece só na linha do documento ("Vencido em …", em vermelho), sem aviso nas outras abas |
| P17 | Janela de "12 meses" no Financeiro (hoje o aparelho tem 90 dias) | Estender o pull das notas e títulos para 12 meses (D4) | "12 meses", "Escolher datas" além de 90 dias e "Ver 12 meses" só com sinal, consultando o servidor; sem sinal, a opção fica desligada | **A**. O vendedor consulta o histórico na rua, sem sinal; B entra só se o volume de 12 meses pesar no aparelho |
