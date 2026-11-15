# Kit da thathyany — roteiro

Teste da integração da thathyany a partir do seu notebook, em duas fases. Uma forma de integração ativa por vez (RN-INT-13):
- **Fase 1:** só o Conector 1.4.0.
- **Fase 2:** o Conector desativado e a API com outra credencial.

Cada fase vai do pedido no app até o número do ERP voltar ao app.

## O que ter em mãos
- Notebook com Windows 10 ou 11, internet e a sua senha do Windows (o serviço do Conector roda na sua conta).
- **SQL Server Express instalado no notebook:** se ainda não houver, instale o SQL Server 2022 Express (instalação Básica) no idioma do Windows. O banco é o `ERP_THATHYANY`.
- **Os dados da thathyany em CSV:** um arquivo por cadastro, no formato da pasta `modelos` (os nomes das colunas não mudam).
- **O código novo da thathyany:** sai depois do deploy da v1.0.9. Você usa no portal e no login do app.
- Um vendedor da thathyany com o app Macuxi Campo instalado.

## Preparar (uma vez)
1. Baixe `macuxi-kit-thathyany-1.0.5.zip`, clique com o botão direito e escolha **Extrair tudo** (por exemplo, para `C:\MacuxiKit`).
2. Abra o **Windows PowerShell** (o azul) **como administrador**.

## Fase 1 — Conector 1.4.0
1. **Portal, aba Integração:** em **Gerar credencial**, use o identificador `thathyany-conector`, o nome "Conector thathyany", marque **Recebe pedidos** e gere. Copie a chave (ela aparece uma vez só).
2. **Portal, aba Integração:** clique em **Baixar o Conector** e salve o `conector-1.4.0.zip`.
3. **Instale:** copie a chave gerada no portal e, logo em seguida, rode:
   ```
   cd C:\MacuxiKit
   powershell -ExecutionPolicy Bypass -File .\Instalar-Thathyany.ps1 -Fase Conector
   ```
   Quando pedir, digite a senha do Windows (o texto fica oculto).
4. **Carregue os dados:** troque os CSVs de `C:\MacuxiThathyany\csv` pelos da thathyany e rode:
   ```
   cd C:\MacuxiThathyany
   py carga_csv.py --pasta csv --validar
   py carga_csv.py --pasta csv
   ```
   No `produto.csv`, `referencia_1` a `referencia_3` levam até 3 códigos da concorrência, e `marca_referencia_1` a `marca_referencia_3` levam a marca de cada um (opcional), já cadastrada em Marcas do Catálogo. Com as três vazias, o Macuxi mantém as referências do cadastro (para tirar uma, use o Backoffice).
   O relatório mostra, por tabela, as linhas lidas, inseridas, atualizadas, sem mudança e recusadas, com a linha e o motivo da recusa. Corrija o CSV e rode de novo.
5. **Confira a carga:** em 2 a 5 minutos, os vendedores, clientes e produtos aparecem no Backoffice. O Monitor da integração mostra o Conector `thathyany-conector` em dia, versão 1.4.0.
6. **Pedido no app:** o vendedor sincroniza, faz um pedido para um cliente da carga e o envia.
7. **Pedido no ERP:** em 1 a 2 minutos, o pedido entra no `ERP_THATHYANY`. No SSMS (servidor que o instalador mostrou, ex.: `localhost\SQLEXPRESS`; autenticação do Windows), rode:
   ```
   SELECT * FROM ERP_THATHYANY.dbo.vw_thathyany_pedidos ORDER BY recebido_em DESC;
   ```
   A linha tem a origem **Thathyany Conector** e o número do pedido.
8. **Número de volta:** em 1 a 2 minutos, o app mostra o pedido como integrado, com o número do ERP.
9. **Faturamento (opcional):** simule a nota e confira o status no app em 1 a 2 minutos:
   ```
   UPDATE ERP_THATHYANY.dbo.macuxi_pedido_entrada SET situacao = 'F', nota_numero = '1001', nota_emitida_em = SYSUTCDATETIME(), nota_total_cents = total_cents, situacao_em = SYSUTCDATETIME() WHERE numero_pedido = <número>;
   ```
   Para rejeitar: `situacao = 'R', motivo = 'Sem estoque'`.

## Fase 2 — API com outra credencial
1. **Desative o `thathyany-conector`:** peça ao gerente-projetos.
2. **Portal, aba Integração:** em **Gerar credencial**, use o identificador `thathyany-api`, o nome "API thathyany", marque **Recebe pedidos** e gere. Copie a chave nova.
3. **Instale:** copie a chave nova e, logo em seguida, rode:
   ```
   cd C:\MacuxiKit
   powershell -ExecutionPolicy Bypass -File .\Instalar-Thathyany.ps1 -Fase API
   ```
4. **Carga pela API:** mude um preço ou um cliente no CSV e rode `py carga_csv.py --pasta csv`. Em 2 a 6 minutos a mudança aparece no Backoffice.
5. **Pedido no app:** o vendedor faz e envia um pedido novo.
6. **Pedido no ERP:** em 1 a 2 minutos, a consulta do passo 7 da fase 1 mostra o pedido com a origem **Thathyany API**.
7. **Número de volta:** em 1 a 2 minutos, o app mostra o pedido como integrado, com o número do ERP.
8. **Faturamento (opcional):** o mesmo `UPDATE` do passo 9 da fase 1.

Para voltar à fase 1: peça ao gerente-projetos para reativar o `thathyany-conector` e desativar o `thathyany-api`, e rode `.\Instalar-Thathyany.ps1 -Fase Conector`.

## Se der errado
- **O serviço do Conector não inicia** (ou você trocou a senha do Windows): rode a fase 1 de novo e digite a senha atual.
- **Chave errada ou trocada no portal:** rode a fase de novo com `-TrocarChave`.
- **A tarefa da API não roda:** entre na sua conta do Windows; a tarefa volta em 1 minuto. O registro fica em `C:\MacuxiThathyany\erp-via-api\erp-via-api.log`.
- **O carga_csv.py diz que falta o driver:** instale o "ODBC Driver 18 for SQL Server" (aka.ms/odbc18) e rode de novo.
