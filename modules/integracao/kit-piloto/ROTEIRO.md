# Kit do piloto — roteiro de uma página

Precisa de internet e de uns 20 minutos na primeira vez.

## Antes de começar (no portal do Macuxi, uma vez)
1. Crie as empresas **Piloto Conector** e **Piloto API**.
2. Em cada uma, cadastre um Conector: na Piloto Conector com o identificador `piloto-conector`; na Piloto API com `piloto-api`. Copie a chave de cada um (aparece uma vez só, começa com `mxc_`).

## Instalar
1. Baixe `macuxi-kit-piloto-1.0.0.zip` pelo navegador, clique com o botão direito, **Extrair tudo** (para uma pasta, ex.: `C:\MacuxiKit`).
2. Abra o **Windows PowerShell** (o azul) **como administrador**.
3. Rode (troque a pasta se for outra):
   ```
   cd C:\MacuxiKit
   powershell -ExecutionPolicy Bypass -File .\Instalar-Piloto.ps1 -ComExemplo
   ```
   Sem `-ComExemplo` as planilhas nascem vazias, só com os cabeçalhos.
4. Quando pedir, cole a **chave** de cada empresa e a **senha do Windows** da sua conta (o texto fica oculto).
5. Se o relatório do fim mostrar linha recusada, corrija-a na planilha e rode o instalador de novo.

## Usar
- **Dados:** edite as planilhas em `C:\MacuxiPiloto\planilhas` (a aba `colunas` mostra o tipo e se o campo é obrigatório), salve, feche o Excel e rode o instalador de novo. Linha apagada da planilha fica inativa (usuário nunca é excluído). O Macuxi recebe a filial primeiro; linha que cita uma filial inexistente chega como `referencia_ausente` e se reprocessa no Monitor. O código FDV é gerado pelo Macuxi; não preencha.
- **Pedido aprovado no app:** entra na ERP_PILOTO em 1 a 2 minutos. Veja no SSMS (Windows Authentication, servidor `localhost,1433`, banco `ERP_PILOTO`):
  `SELECT * FROM vw_piloto_pedidos ORDER BY recebido_em DESC;` — a coluna **origem** diz se veio da *Piloto Conector* ou da *Piloto API*.
- **Simular o ERP andando:** `UPDATE macuxi_pedido_entrada SET situacao='R', motivo='Sem estoque', situacao_em=SYSUTCDATETIME() WHERE numero_pedido=1;` (R rejeitado, C cancelado; P/F faturado exigem `nota_numero`, `nota_emitida_em` e `nota_total_cents`). Confira o status no app em 1 a 2 minutos.
- **Trocar uma chave:** rode de novo com `-TrocarChaves`. **Só uma modalidade:** `-Modalidade Conector` ou `-Modalidade API`.

## Zerar tudo
`powershell -ExecutionPolicy Bypass -File .\Instalar-Piloto.ps1 -Limpar` apaga cadastros e pedidos da `ERP_PILOTO`. Depois de recarregar, peça a **carga completa** no BKO.

## Se der errado
- **Serviço do Conector não inicia** (ou você trocou a senha do Windows): rode o instalador de novo e digite a senha atual. Se continuar, abra `services.msc` › **Macuxi Conector** › aba **Fazer logon**, informe sua conta e senha e clique em Iniciar.
- **Piloto API parada:** entre na sua conta do Windows; a tarefa volta em 1 minuto. Se não voltar, abra `C:\MacuxiPiloto\erp-via-api\erp-via-api.log`.
- **SSMS não instalou:** baixe em aka.ms/ssms e instale à mão.
