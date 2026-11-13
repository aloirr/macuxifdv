# Kit do piloto (T-0162)

> Código: `modules/integracao/kit-piloto/`. Testes: `kit-piloto.test.ts` (módulo) e `apps/conector/test/conector-piloto.test.ts`. Roteiro do usuário: `modules/integracao/kit-piloto/ROTEIRO.md` (uma página, vai dentro do zip).

## O que é
O notebook do dono do produto vira um ERP simulado (SQL Server 2022 Express, banco `ERP_PILOTO`) ligado a duas empresas teste, sobre a mesma base:

| Empresa teste | Como conversa com o Hub | Identificador | Quem grava o pedido |
|---|---|---|---|
| Piloto Conector | Conector (serviço Windows `MacuxiConector`), `conector.json` para `https://api.macuxifdv.com.br` | `piloto-conector` | procedure `sp_macuxi_pedido_inserir` (origem padrão `Piloto Conector`) |
| Piloto API | tarefa agendada "ERP via API" (a cada minuto), `/integracao/v1` | `piloto-api` | `erp-via-api.mjs` (origem `Piloto API`) |

A origem de cada pedido fica na coluna `origem` de `macuxi_pedido_entrada` (consulta: `vw_piloto_pedidos`).

## Peças
- `Instalar-Piloto.ps1`: único, idempotente, como administrador no Windows PowerShell 5.1. Instala (winget) SQL Server 2022 Express, SSMS e Node LTS, mais os módulos `SqlServer` e `ImportExcel`; liga TCP 1433 e autenticação mista; firewall só `LocalSubnet`; cria a `ERP_PILOTO`; gera as planilhas `.xlsx` em `C:\MacuxiPiloto\planilhas`, importa e recarrega só o que mudou (hash por linha; quem sai da planilha vira inativo) e imprime o relatório por planilha (novas, atualizadas, sem mudança, desativadas, recusadas com linha e motivo). Parâmetros: `-Limpar`, `-ComExemplo`, `-Modalidade`, `-TrocarChaves`, `-ConectorZip`.
- `sql/`: `01` tabelas `piloto_*` e views `vw_macuxi_*` (mesmas colunas de `db/conector/views-modelo.sql`, horários já em UTC); `02` entrada de pedidos, **gerada** de `db/conector/entrada-pedido-modelo.sql` pelo `montar-kit` (só guarda o `CREATE TABLE` e usa `CREATE OR ALTER PROCEDURE`); `03` coluna `origem`, status do pedido e `vw_piloto_pedidos`; `04` usuários `macuxi_conector` (SELECT nas views, EXECUTE nas 2 procedures, SELECT na entrada) e `macuxi_api` (o mesmo, mais INSERT/UPDATE na entrada). Senhas aleatórias a cada execução, por variável, só em memória.
- `erp-via-api/`: `erp-via-api.mjs` (lógica; carga a cada 5 min, pedidos e retornos a cada passada), `executar.mjs` (entrada; driver `mssql`), `executar.ps1` (lê o Gerenciador de Credenciais e chama o Node), `cliente-hub.mjs` (cópia oficial de `modules/integracao/docs/exemplos/node/cliente-hub.mjs`, copiada na montagem).
- `scripts/montar-kit.mjs`: gera `macuxi-kit-piloto-<versão>.zip` (+ `.sha256`) e o `conector.json` do piloto a partir de `apps/conector/exemplos/conector.exemplo.json` (só as 9 entidades do kit).

## Segredos
Chave do Hub: `Read-Host -AsSecureString`, depois Gerenciador de Credenciais (`Macuxi.Conector/hub_chave` pelo CLI do Conector; `Macuxi.Piloto/hub_chave_api` e `Macuxi.Piloto/erp_senha_api` para o ERP via API). Nada em arquivo, log ou `cmdkey`. O serviço do Conector roda na conta de quem instalou (o cofre é por usuário); o instalador pede a senha do Windows, também mascarada.

## Limites conhecidos
- O ERP via API roda na sessão do usuário (tarefa "Interactive"): com o usuário deslogado não roda.
- Pedido rejeitado pelo ERP via API não é gravado na `ERP_PILOTO` (o motivo vai ao Hub). Cancelamento pedido pelo Hub ainda não é tratado pelo ERP via API.
- A validação real do `.ps1` e do SQL exige Windows e SQL Server: no repositório há conferência estática e testes da lógica com dublês; o roteiro é o teste de aceite no notebook.
