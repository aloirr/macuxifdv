# Cliente 360 v2: Resumo, Financeiro e Documentação (simulação)

Pedido do dono do produto: R-20261119-030234. É uma simulação, sem código. O desenho vale para o Campo e o Gestão e inclui a permissão de documentos em BKO › Parâmetros.

Pranchas desta pasta (gere com `node docs/design/cliente-360-v2/gerar.mjs`, a partir da raiz do repositório):

| Prancha | O que mostra |
|---|---|
| `01-campo-resumo.png` | Resumo no Campo: topo, Performance de hoje, Cadastro de hoje e fim da rolagem |
| `02-campo-financeiro.png` | Financeiro: filtros fechados (padrão), lista rolada com os quatro status, folha de filtros aberta, filtro "Em aberto" aplicado e detalhe da nota |
| `03-campo-documentacao.png` | Documentação: lista por tipo, documento sem permissão, estado vazio e arquivo sem internet |
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
- 1 título vencido, de R$ 640,00, venceu em 01/11;
- compras de novembro: R$ 3.940, nas NFs 004817 e 004790, que vêm dos pedidos 000017 e 000013. O pedido 000009 virou a NF 004702.

## 1. O que muda em relação ao de hoje

Hoje a ficha tem seis abas, roladas na horizontal: Resumo, Cadastro, Financeiro, Compras, Performance e Anexos. A v2 tem **três abas fixas**, sem rolagem: **Resumo · Financeiro · Documentação**.

| Hoje | Na v2 |
|---|---|
| Resumo (contato, Compras no mês, Última compra) | Resumo, no topo |
| Cadastro (CNPJ, endereço, filial, segmento, contatos, endereços de entrega, observações) | Resumo, no fim ("Dados cadastrais", Contatos, Endereços de entrega, Observações) |
| Performance (visitas, curvas, prazo médio, últimos itens, sugestão de mix) | Resumo, no meio. As curvas vão para o bloco Compras e o prazo médio vai para o Financeiro |
| Compras: 4 indicadores | Resumo › Compras, com os 4 indicadores da RN-CORE-40 (Última compra, Compra média/mês, Ticket médio, Frequência) |
| Compras: "Histórico de Pedidos" (pedidos e linhas mensais) | **Sai.** A compra faturada aparece no Financeiro, uma linha por NF. O pedido não faturado continua na aba Pedidos do app (ponto em aberto P6) |
| Financeiro (4 cartões e o motivo do bloqueio) | Financeiro com o bloco de crédito em tabela compacta, o histórico de notas com filtros e o detalhe da nota com as parcelas |
| Anexos (Foto do PDV, Fotos do PDV) | Documentação, no grupo "Fotos do PDV" (P9) |
| Aba Compras | **Documentação** entra no lugar: a lista de documentos do cliente por tipo |

O que **sai** de vez, porque já aparece em outro lugar ou não serve para agir:
- "Compras no mês": o valor está nas notas do mês, no Financeiro. "Compras em 12 meses" também sai (P7).
- As linhas mensais do histórico ("11/2026 · 2 pedidos · 17 itens"): o Financeiro já lista as notas por mês.
- O cartão "Vencidos" e o "Motivo do bloqueio" no Financeiro: vão para a área **Alertas** (RN-VEN-42) e aparecem uma vez só, no topo de todas as abas.
- O botão "Foto do PDV" separado: a fachada vira a primeira linha de "Fotos do PDV" e o toque abre a foto.
- A linha "Endereço" dos dados cadastrais: o endereço fica só em "Endereços de entrega", e o principal leva o CEP. A faixa mostra o código, o bairro e a cidade, sem a rua.

## 2. Cabeçalho, abas e Alertas (iguais nas três abas)

- **Faixa Azul noite:**
  - o voltar ("‹ Clientes" no Campo; no Gestão, "‹ Carla Lima" ou a tela de origem);
  - o título com o nome fantasia ("Mercado Bom Preço");
  - o subtítulo "C5007 · Centro · Boa Vista/RR";
  - o sino das notificações, como hoje.
- **Abas:** "Resumo", "Financeiro" e "Documentação", fixas, com a largura pelo texto. A aba ativa fica em 16/600, em grafite, com o traço de 3 dp em Azul noite. As outras ficam em 16/400, no #4A5562.
- **Alertas (RN-VEN-42):** a área única fica no topo do conteúdo, em todas as abas, e é o único lugar de aviso da ficha. Na simulação há o aviso do vencido:
  - linha 1: "1 título vencido";
  - linha 2: "R$ 640,00 · venceu em 01/11";
  - ação "Ver", com alvo de 48 dp: abre o Financeiro com o filtro "Em aberto".

  Os outros alertas de hoje (bloqueado, inativo, atendimento aberto, etapa pendente, erro de foto) entram nesta mesma área, com o texto de hoje.
- **Rodapé do Campo:** "Check-in", "Pesquisa" e "Novo pedido" (principal), como hoje. Na prancha, o "+" saiu de "Novo pedido": com a fonte mais larga do teste (Inter), os três botões não cabiam em 320 dp. No Android, com Roboto, o "+" de hoje cabe e pode ficar.
- **Rodapé do Gestão:** não tem (P13).

## 3. Aba Resumo (ordem dos blocos)

1. **Alertas** (§2).
2. **Contato:** "Ligar", "WhatsApp" e "Mapa", com 64 dp de altura. O botão fica desligado quando não há número, como hoje.
3. **Gestão, só lá:** o cartão "Vendedora da carteira" com "Carla Lima" e os botões de ligar e de WhatsApp para ela (48 dp). Os rótulos de acessibilidade são "Ligar para Carla Lima" e "WhatsApp de Carla Lima". Com mais de uma pessoa na carteira, o rótulo passa a "Carteira" e cada pessoa ocupa uma linha.
4. **Compras** (título de seção, 18/700):
   - as tags de curva (RN-CORE-49): "Faturamento A", "Volume B" e "Frequência A", em chips no tom de destaque;
   - uma grade 2×2 com "Última compra" ("há 12 dias"), "Compra média/mês" ("R$ 5.210"), "Ticket médio" ("R$ 2.605") e "Frequência" ("a cada 14 dias").

   Sem compra na janela, o bloco mostra só "Sem compras em 12 meses" (RN-CORE-40).
5. **Visitas:** "Visitas" ("46") e "Última visita" ("12/11/2026"). Embaixo vai quem visitou: "Você" no Campo e "Carla Lima" no Gestão.
6. **Últimos itens comprados:** os 3 últimos, cada um com o nome, a quantidade, a unidade e a data ("10 CX · 07/11/2026") e o valor. A última linha é "Ver os 20 itens ›" e abre a lista completa (a mesma de hoje, RN-CORE-50).
7. **Sugestão de mix:** só no Campo, pela extensão `mix` do Vendedor, como hoje.
8. **Dados cadastrais:** "CNPJ", "Razão social", "Filial", "Segmento" e "Cliente desde". Cada campo leva o rótulo em 12 e o valor em 16/600.
9. **Contatos:** o nome; embaixo, o cargo e "principal" ("Comprador · principal"); os botões de ligar e de WhatsApp.
10. **Endereços de entrega:** a descrição com o chip "Padrão" e o endereço com o CEP no principal; o botão do mapa.
11. **Observações:** o texto do ERP, como hoje (RN-CORE-17).

Para o promotor sem `promotor_ve_pedidos` (RN-PRO-01), ficam fora os blocos 4 e 6 e o prazo médio. Fica o resto.

## 4. Aba Financeiro

1. **Alertas** (§2).
2. **Bloco de crédito:** uma tabela compacta 2×2 num cartão, como o bloco de crédito do Novo pedido (RF-VEN, `novo-pedido-itens.md` §2.1). Os valores ficam em destaque, 16/600, com algarismos tabulares: "Limite" R$ 8.000 · "Crédito disponível" R$ 1.880 · "Em aberto" R$ 6.120 · "Prazo médio" 24 dias.
3. **Busca e filtro:**
   - o campo "Nº da NF", que busca pelo número;
   - o botão de filtro, de 48 dp. Quando há filtro fora do padrão, ele mostra a contagem num círculo laranja (gráfico). O padrão não conta.
4. **Filtros aplicados:** um chip para cada filtro fora do padrão, com "×" para tirar ("Em aberto ×").
5. **Contagem:** "8 notas · últimos 90 dias". Com o filtro de status, fica "4 notas em aberto · últimos 90 dias".
6. **Lista de notas**, da mais recente para a mais antiga, num cartão:
   - uma faixa por mês ("NOVEMBRO DE 2026", rótulo de 12/600 em maiúsculas);
   - linha 1 da nota: "NF 004817" à esquerda e o valor "R$ 2.380,00" à direita;
   - linha 2: a data e a forma de pagamento ("07/11 · Boleto 28 dias"; a forma por NF depende de D2, §9) à esquerda e o chip de status à direita;
   - linha 3, só quando houver: o vencido em vermelho, como "R$ 640,00 vencido desde 01/11", ou a devolução, como "Devolvido R$ 330,00" (a devolução depende de D3, §9);
   - a seta "›" no fim. A linha inteira é tocável, com no mínimo 64 dp de altura.
7. **Chips de status**, nos tons do sistema e sempre com texto:

| Status | Tom |
|---|---|
| Em aberto | `warning` (#7A4F00 sobre #FFF1D6) |
| Pago | `success` (#1D6B4F sobre #E2F1EA) |
| Devolvido | `neutral` (#34404D sobre #ECEEF1) |
| Devolvido parcial | `accent` (#1E3350 sobre #DFE2E6) |

"Em aberto" e "Pago" saem do título de hoje (`TituloSync`: aberto, baixado ou cancelado). "Devolvido" e "Devolvido parcial" dependem do vínculo título → NF → devolução (D3, §9).

O vencido não tem status próprio: a nota continua "Em aberto", a linha 3 aparece em vermelho e o aviso fica nos Alertas.

**Folha "Filtrar"**, que sobe de baixo:
- "Período": "30 dias", "90 dias" (padrão), "12 meses" e "Escolher datas". Hoje o aparelho tem só 90 dias de títulos: "12 meses" e datas além de 90 dias seguem o P17;
- "Status": "Em aberto", "Pago", "Devolvido" e "Devolvido parcial", de múltipla escolha. O padrão é nenhum marcado, que vale como todos;
- "Forma de pagamento": as formas que aparecem nas notas do cliente (depende de D2; sem ela, o grupo não aparece);
- botões "Limpar" e "Ver 4 notas" (principal), com a contagem ao vivo. Nenhum resultado dá "Nenhuma nota" e o botão fica desligado.

**Detalhe da nota** (folha), aberto ao tocar na linha:
- título "NF 004702" e, embaixo, "24/10/2026 · pedido 000009", com o chip de status;
- tabela "Valor da nota", "Devolvido em 29/10" ("− R$ 330,00"), "Valor final" e "Forma de pagamento";
- "Parcelas": cada uma com "1/2 · venceu 31/10", o valor, o chip "Pago" ou "Em aberto" e "Paga em 31/10" quando paga;
- botão secundário "Ver itens da nota (12)".

**Estados:**
- sem notas na janela: "Nenhuma nota nos últimos 90 dias" e o botão "Ver 12 meses" (segue o P17: na opção B, só com sinal);
- sem dados financeiros: "Sem dados financeiros", como hoje;
- sem internet: a lista sai do aparelho e não muda.

## 5. Aba Documentação

1. **Alertas** (§2).
2. **Grupos por tipo**, cada um com um título de seção:
   - "Fotos do PDV": o que é hoje Anexos (RN-CORE-38). "Fachada" mostra "Foto · 12/11/2026" e abre a foto. "Gôndola" mostra "Falta", em vermelho, e "Adicionar" com a câmera quando o perfil "vê e envia";
   - "Cadastro": Alvará de funcionamento, Cartão CNPJ e Comprovante de endereço;
   - "Contratos": Contrato de comodato e Contrato social.

   Os grupos e a ordem vêm do cadastro de tipos (§7).
3. **Linha do documento:**
   - o ícone do arquivo em Azul noite e o nome, em 16/600;
   - embaixo, o formato e a data ("PDF · 05/08/2026"). Quando há validade, entra ela no lugar da data: "PDF · válido até 03/2027";
   - a seta "›". O toque abre o arquivo no visualizador do shell.
4. **Documento vencido:** a linha ganha o chip "Vencido" (`danger`). Se o tenant quiser, o vencido também entra nos Alertas (P16).
5. **Sem permissão por exceção** (§7): a linha aparece com cadeado. O nome fica em #4A5562 e embaixo vai "Sem permissão para abrir". A linha não tem seta, não abre e não dá aviso ao tocar, porque ela mesma já diz o porquê. A acessibilidade lê "…, sem permissão para abrir".
6. **Tipo que o perfil não vê:** não aparece. Na prancha, a vendedora não vê "Contrato social" e a supervisora vê.
7. **Estado vazio:** os Alertas, o ícone e "Nenhum documento deste cliente". Fica sem texto de explicação.
8. **Sem internet, com o arquivo ainda fora do aparelho:**
   - folha com o título do documento;
   - o texto "Sem internet. Este arquivo ainda não está no aparelho.";
   - o botão principal "Tentar de novo".

## 6. Gestão

É o mesmo componente, com estas diferenças:
- o voltar leva à tela de origem;
- o cartão "Vendedora da carteira" no Resumo;
- a última visita com o nome de quem visitou;
- sem "Sugestão de mix" e sem rodapé (o pedido em nome sai da ficha da vendedora, RF-GES-05);
- sem "Adicionar" nas fotos;
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
  - no app, quem perde acesso vê a linha com cadeado (§5);
  - "Adicionar exceção" é secundário.
- **A API sempre revalida:** a lista e o download do arquivo checam o perfil, a carteira e a licença do módulo. O app nunca recebe o arquivo de um documento sem permissão.

## 8. Offline (o que fica no aparelho)

- **Resumo:** tudo vem das linhas do sync de hoje (cliente, contatos, endereços, histórico, visitas, itens) e funciona em modo avião.
- **Financeiro:** hoje o pull traz só 90 dias de títulos (`TituloSync`), e a NF não vem ao aparelho (D1). Na recomendação do P17 (A), o aparelho passa a guardar as notas dos últimos 12 meses de cada cliente da carteira, com as parcelas e a devolução; filtro e busca rodam no aparelho e o que passa de 12 meses só aparece com internet. Na opção B, o aparelho fica com 90 dias e o resto só com sinal.
- **Documentação:**
  - a lista (tipo, nome, data, validade, permissão) fica no aparelho;
  - o arquivo baixa no primeiro toque e fica guardado (P15);
  - sem internet e sem o arquivo, aparece a folha do §5.8;
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
| P2 | Notas e títulos | **Juntos**: a linha é a NF e as parcelas (títulos) ficam no detalhe (depende do ERP: D1 e D3) | Separados: duas listas, "Notas" e "Títulos" | **A**. Uma informação, um lugar. O vencido fica nos Alertas |
| P3 | NF com devolução parcial e saldo em aberto (as duas opções dependem do ERP: D3) | "Em aberto" prevalece enquanto houver saldo; "Devolvido parcial" só depois de quitada | "Devolvido parcial" prevalece e a linha 3 mostra o saldo | **A**. O vendedor age sobre o saldo |
| P4 | "Devolvido parcial" mostra o valor devolvido? (as duas opções dependem do ERP: D3) | Sim, na linha ("Devolvido R$ 330,00") e no detalhe | Só no detalhe | **A**. Explica a diferença do valor sem precisar abrir |
| P5 | Onde fica Documentos em Parâmetros | **Seção nova "Documentos"** (prancha 05) | Dentro de Parâmetros › Clientes | **A**. O quadro é grande e vai crescer (tipos e exceções); em Clientes, empurraria os parâmetros de cliente para baixo |
| P6 | Pedidos e itens que estavam em Compras | O pedido não faturado fica só na aba Pedidos do app, com o filtro do cliente; os itens ficam em "Últimos itens comprados" (Resumo) e em "Ver itens da nota" | Um bloco "Últimos pedidos" no Resumo | **A**. O faturado já está no Financeiro e o resto na aba Pedidos |
| P7 | Indicadores de compra | Os 4 da RN-CORE-40; "Compras no mês" e "Compras em 12 meses" saem | Mantém os 6 | **A**. É o que a RN-CORE-40 define, e o mês já está nas notas |
| P8 | Filtro padrão do Financeiro | Últimos 90 dias, todos os status | Últimos 12 meses, todos os status | **A**. A lista é curta. O filtro abre mais meses conforme o P17 |
| P9 | Fotos do PDV (hoje em Anexos) | Grupo "Fotos do PDV" dentro de Documentação | Volta a ser uma aba (quatro abas) | **A**. O pedido foi de três abas |
| P10 | Documento sem permissão | Aparece com cadeado e "Sem permissão para abrir" | Some | **A** na exceção por documento (o vendedor sabe que existe e pede ao escritório). O **tipo** sem permissão some |
| P11 | Exceção por documento | Só tira acesso | Também libera | **A**, como a exceção de licença por usuário (RF-CORE-03) |
| P12 | Promotor sem `promotor_ve_pedidos` | A aba Financeiro some | A aba aparece só com o crédito, sem notas | **A**. Sem o pedido, a nota também não aparece (RN-PRO-01) |
| P13 | Rodapé no Gestão | Sem rodapé | "Novo pedido" em nome da vendedora | **A**. O pedido em nome já sai da ficha da vendedora (RF-GES-05) |
| P14 | Busca no Financeiro | Campo "Nº da NF" sempre visível | Só a lupa, que abre o campo | **A**. É um toque a menos |
| P15 | Download dos arquivos | No primeiro toque, e o arquivo fica guardado | Todos na sincronização (só no Wi-Fi) | **A**. Poupa dados e espaço; os tipos marcados como "levar para a rua" podem baixar na sincronização numa versão seguinte |
| P16 | Documento vencido nos Alertas | Sim, para os tipos marcados no BKO | Não, só o chip "Vencido" na Documentação | **B** na primeira versão. Os Alertas ficam só para o que trava venda |
| P17 | Janela de "12 meses" no Financeiro (hoje o aparelho tem 90 dias) | Estender o pull das notas e títulos para 12 meses (D4) | "12 meses", "Escolher datas" além de 90 dias e "Ver 12 meses" só com sinal, consultando o servidor; sem sinal, a opção fica desligada | **A**. O vendedor consulta o histórico na rua, sem sinal; B entra só se o volume de 12 meses pesar no aparelho |
