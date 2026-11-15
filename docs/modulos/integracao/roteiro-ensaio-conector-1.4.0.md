# Roteiro do ensaio de quinta: Conector 1.4.0 em Windows

> T-0149/T-0098 · módulo `integracao` · para o `testes` e o `gerente-projetos`. Tempo previsto: 60 a 90 min. Referências: `conector.md` (§3 instalação, §7 operação, "Filial e Conector 1.4.0"), `db/conector/views-modelo.sql`, `db/conector/entrada-pedido-modelo.sql`.

## 0. Pré-requisitos (antes de começar)
- Windows 10/11 ou Server, PowerShell **como administrador**, saída HTTPS liberada para o Hub (demo). Não precisa instalar Node.
- SQL Server do ERP-modelo (Express serve) com as views `vw_macuxi_*` (`views-modelo.sql`) e a tabela/procedures de entrada (`entrada-pedido-modelo.sql`) criadas, mais dados: 2 filiais (uma marcada como padrão no Macuxi), clientes com `filial_external_id`, produtos, preços e estoque.
- Usuário SQL do Conector só com SELECT nas views e EXECUTE nas duas procedures.
- Chave de API do Conector gerada no BKO (escopo `integracao.v1`) e o pacote `conector-1.4.0.zip` com `.sha256` (e `.sig`, se assinado) — gerado por `apps/conector/scripts/pacote.mjs` ou pelo workflow `conector-publicar.yml`.
- Pedido de filial **não padrão** só chega a Conector 1.4.0+; o de filial padrão vai a qualquer versão.

## 1. Instalar (conector.md §3)
| # | Passo | Esperado |
|---|---|---|
| 1.1 | Conferir o SHA-256 (e a assinatura, §7.4) do `.zip` antes de abrir | "Pacote íntegro"; alterar 1 byte do zip deve falhar (teste negativo) |
| 1.2 | Descompactar em `C:\ProgramData\Macuxi\Conector\`; `.\node.exe -v` | `v24.21.0` (24.7+) |
| 1.3 | Copiar `exemplos\conector.exemplo.json` para `conector.json`; ajustar URL do Hub, servidor/banco do ERP | arquivo salvo |
| 1.4 | `.\node.exe conector.mjs segredo definir erp_senha` e `... hub_chave` (valor pela entrada padrão) | segredos no Gerenciador de Credenciais; nada no `.json` |
| 1.5 | `validar-config` e `testar-conexao` | `ok` em segredos, ERP (incluindo a ordem do `external_id`), Hub |
| 1.6 | `.\node.exe conector.mjs versao` | `1.4.0` |
| 1.7 | `instalar-servico --winsw .\WinSW-x64.exe`, iniciar o serviço "Macuxi Conector" | serviço em execução; reinicia sozinho se parar |
| 1.8 | `conector status` e BKO > Integração > Monitor | `em dia`; Conector com sinal de vida em até 1 min, versão 1.4.0 |

## 2. Carga da filial e das entidades
| # | Passo | Esperado |
|---|---|---|
| 2.1 | `carga-completa filial` (a view traz `cnpj`, `logradouro`, `numero`, `complemento`, `bairro`, `cep`, `telefone`) | lote aceito; BKO mostra a(s) filial(is) com `codigo`, nome, cidade, UF, CNPJ e endereço |
| 2.2 | Incluir no ERP uma filial com UF `R1` e rodar a passada | linha **rejeitada** no BKO (erro legível "UF deve ter 2 letras"); as demais entram (RN-INT-03) |
| 2.2b | Incluir no ERP uma filial sem CNPJ (ou com CNPJ de dígito errado) e outra sem logradouro, número, bairro ou CEP; rodar a passada | as duas linhas **rejeitadas** no BKO, cada uma com o campo e o motivo ("CNPJ da filial é obrigatório", "CEP da filial é obrigatório"...), sem gravar no Core (RN-CORE-39); a filial completa entra com CNPJ, endereço e telefone, e o Core os mostra |
| 2.3 | `carga-completa todas` | ordem: `ORDEM_CARGA_ENTIDADES` (`filial` primeiro); sem bloqueio |
| 2.4 | Conferir no BKO: cliente na filial B, preço específico da filial B, estoque do depósito da filial B | cada um aparece vinculado à filial; `filial_external_id` NULL em cliente = não altera, em preço = padrão |
| 2.5 | Alterar 1 cliente no ERP (delta) | chega na passada seguinte; contagem do lote = 1 |
| 2.6 | Parar o serviço no meio de uma carga e iniciar de novo | retoma do cursor confirmado, sem duplicar (`status`) |

## 3. Pedido até o SQL do ERP-modelo
Preparar no app (ou na demo) dois pedidos aprovados:
- **A**: cliente da filial **não padrão**, frete **FOB** com transportadora cadastrada, endereço de entrega **do cadastro** (com `external_id`), pagamento a prazo 30/60/90.
- **B**: cliente da filial **padrão**, frete **CIF**, endereço **editado** no pedido (RN-VEN-17), pagamento à vista.

| # | Passo | Esperado |
|---|---|---|
| 3.1 | Aprovar A e B; aguardar a passada de pedidos (≤ 1 min) | monitor mostra os pedidos exportados; `numeroErp` devolvido ao Macuxi (RN-INT-08) |
| 3.2 | `SELECT * FROM dbo.macuxi_pedido_entrada` | 2 linhas com `pedido_uuid` distintos |
| 3.3 | Linha A | `filial_codigo` e `filial_external_id` da filial B; `frete_modalidade=FOB`, `frete_transportadora_tipo=cadastrada` com `_external_id`; `entrega_origem=erp` e `entrega_external_id` preenchido; `pagamento_parcelas_dias='30,60,90'`, `pagamento_prazo_medio_dias=60`, forma/prazo com `external_id` |
| 3.4 | Linha B | `filial_*` conforme a padrão (nulos ou da padrão); `frete_modalidade=CIF` e transportadora nula; `entrega_origem=editado`, `entrega_external_id` nulo e logradouro, número, bairro, cidade, UF e CEP em texto; pagamento à vista |
| 3.5 | Itens em `macuxi_pedido_entrada_item` | quantidade, preço e total em **centavos** iguais ao pedido; soma dos itens = total do cabeçalho |
| 3.6 | Reenviar o mesmo pedido (parar o serviço logo após a gravação e religar) | **não duplica** (idempotência por `pedido_uuid`); retorna o mesmo `numeroErp` |
| 3.7 | Simular retorno: atualizar status/nota do pedido no ERP | BKO e app mostram o status/nota (retorno `integracao.pedido.retorno_erp@1`) |
| 3.8 | Pedido antigo (sem filial/frete/entrega/pagamento) | todos os parâmetros novos chegam `NULL`; gravação sem erro |

## 4. Falhas e operação (amostra)
| # | Passo | Esperado |
|---|---|---|
| 4.1 | Derrubar a rede do servidor por 3 min com um pedido na fila | fila local guarda; ao voltar, envia sem perda; backoff nos logs |
| 4.2 | Fazer a procedure do ERP falhar (ex.: tirar o EXECUTE) | pedido fica com erro legível no BKO (sem dado pessoal em log); corrigir e `retomar` reenvia |
| 4.3 | `trocar-chave` com chave nova gerada no BKO | envio continua sem reinstalar; chave antiga revogada deixa de valer |
| 4.4 | (opcional) Instalar um 1.3.x em outra máquina com pedido da filial B na fila | pedido **espera** (não grava na padrão); ao atualizar para 1.4.0, é entregue |
| 4.5 | Logs em `dados\logs\conector-AAAA-MM-DD.log` | JSON por linha, sem CPF, telefone, e-mail ou chave |

## 5. Registro
Para cada linha: OK, Falhou ou Não testado, com print/trecho de log. Falha vira recado ao dono: Conector/Hub = `modulo-integracao`; views, tabela e procedures = `banco-dados`; filial no evento do pedido = `modulo-vendedor`. Limite conhecido (R-20261110-110721): a filial só chega ao ERP se o `vendedor.pedido.aprovado@1` trouxer `filial`; enquanto o Vendedor não gravar essas colunas, 3.3 e 3.4 mostrarão a filial NULL (padrão).
