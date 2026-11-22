# ADR 0066 — Busca na API do ERP e cofre de credenciais por tenant

- **Status**: aceita em 2026-11-22 (decisões D1–D9 do dono do produto, R-20261122-005500-alexandre, item 5 A).
- **Data**: 2026-11-22 (Manaus)
- **Tarefa**: integração por ERP (fatias F0 e F1; número de tarefa ainda não reservado no quadro). Regras: RN-INT-16 a RN-INT-20
  (propostas; o número final é do gerente-projetos no doc 03), RN-INT-01 a 14, RN-CORE-23.
- **Autor**: engenheiro-software
- **Origem**: R-20261111-194840-alexandre (modelos de integração por ERP); aprovação do desenho e das decisões:
  R-20261122-005500-alexandre.
- **Desenho**: `docs/desenho/integracao-modelos-erp.md` (§2 busca, §2.2 credenciais, §2.3 agendamento, §2.5 SSRF, §6 fatias,
  §8 decisões). Estende as ADRs 0013 (Hub), 0022 (tarefas periódicas), 0058 (trabalhos sob demanda) e 0028 (produção).

## Contexto
Hoje o ERP, ou o Conector on-premise, **empurra** os lotes ao Hub `/integracao/v1`. Os ERPs na nuvem (SAP Business One pelo
Service Layer, Sankhya Om) têm API, mas o cliente não tem onde rodar um Conector nem quem escreva o envio. O contrato já prevê
o Conector tipo `nuvem` (`TIPOS_CONECTOR`), sem nada que o execute.

Para o Macuxi **buscar** na API do ERP, a plataforma passa a guardar credencial de terceiro e a chamar uma URL informada pelo
cliente. As duas coisas são riscos novos: vazamento da credencial e SSRF a partir da VM.

## Decisão
Valem as decisões D1 a D9 do §8 do desenho, aceitas pelo dono do produto. O que é novo, da fatia F1 (plataforma):

1. **Cofre de segredos** (`@macuxi/platform-sdk/cofre-segredos`, só Node):
   - AES-256-GCM com `node:crypto`, IV aleatório de 12 bytes por cifra e tag de 16 bytes, sem dependência nova;
   - AAD `tenant_id|conector_id`: o texto copiado para outro tenant ou outro Conector não decifra;
   - chave-mestra `MACUXI_CHAVE_SEGREDOS_v<n>` (ou `_V<n>`; 32 bytes em base64 ou hex) no ambiente. A maior versão cifra; as menores só
     decifram. Sem nenhuma, erro `COFRE_SEM_CHAVE` com o nome da variável. A chave nunca vai ao banco, ao backup, ao log
     nem à mensagem de erro;
   - linha cifrada com `cifrado`, `iv`, `tag` e `chave_versao` (tabela `integracao.credencial_erp`, fatia F2);
   - rotação da chave-mestra: entra a `v<n+1>`, um trabalho recifra as linhas por tenant (`precisaRecifrar` e `recifrar`) e a
     `v<n>` sai do ambiente quando a contagem por versão zerar.
2. **Só escrita:** nenhuma rota devolve o segredo nem parte dele. Decifram só o trabalho de coleta e a rota "Testar conexão",
   em memória. O diagnóstico (ADR 0043) e o suporte não leem a tabela.
3. **Redação do log:** `CAMINHOS_SEGREDO_LOG` no SDK (`packages/platform-sdk/src/segredos-log.ts`, espelho da função
   `integracao.parametros_sem_segredo` da migração 0094) entra no pino da API e, agora, também no do worker, que não tinha
   redação. A lista da API (`CAMINHOS_REDIGIDOS_LOG`) não repete o que o SDK cobre.
4. **Cliente HTTP de saída** (`@macuxi/platform-sdk/http-saida`, só Node), obrigatório para toda URL informada pelo cliente:
   - só `https`, sem usuário e senha na URL;
   - DNS resolvido antes, com todos os endereços conferidos; loopback, privado, CGNAT, link-local, metadados
     (169.254.169.254 e fd00:ec2::254), multicast, documentação e reservado são recusados, em IPv4 e IPv6, com o IPv4
     embutido (mapeado, NAT64 e 6to4);
   - a conexão vai ao endereço conferido (o `lookup` do `https.request` devolve só ele), com o SNI e o certificado do host:
     não há segunda resolução (DNS rebinding);
   - redirecionamento só para o mesmo host e porta, em `https`, reconferido; no máximo 3;
   - 30 s no total por chamada, 60 chamadas por minuto por Conector (em memória do processo), resposta de até 20 MB (`LIMITES_COLETA_ERP`);
   - nada é registrado; o erro (`ErroHttpSaida`) leva só o código, o host e, no limite, quanto esperar.
5. **Piso da coleta:** `FREQUENCIA_MINIMA_COLETA_MIN` (= `INTERVALO_MINIMO_TAREFA_MIN`, 15 min) e `problemaFrequenciaColeta`
   (múltiplo de 15, de 15 min a 1440 min, 1 vez por dia); tetos em `LIMITES_COLETA_ERP`. A carga completa semanal é um modo
   à parte (§2.3 item 4), não uma frequência. Os parâmetros do tenant só baixam os tetos.
6. **Eventos novos** do módulo integracao (registro em `.coord/contratos/eventos.md`): `integracao.coleta.solicitada@1` e
   `integracao.implantacao.marco@1`. O schema fica no `modules/integracao/contracts` (fatia F3).

## Alternativas
- **Conector com driver HTTP (D1 b):** o segredo ficaria no cliente, mas exige uma máquina Windows só para chamar outra
  nuvem. Fica para o primeiro cliente com API só na rede local.
- **Chave-mestra gerada na VM, como o pepper (D7):** perder a VM obrigaria cada cliente a redigitar a credencial. Recusada.
- **KMS da nuvem:** a Magalu não oferece um KMS com a mesma API dos grandes provedores e seria uma dependência nova. Recusada
  por ora; a versão da chave permite migrar sem mudar o formato da linha.
- **Biblioteca de cifra de terceiros (libsodium, `jose`):** o `node:crypto` faz AES-256-GCM sem dependência nova. Recusada.
- **`fetch` com `undici` e um `Agent` com `lookup`:** exigiria o `undici` como dependência direta do SDK. O `node:https` com
  `lookup` fixado faz o mesmo. Recusada.
- **Lista de hosts permitidos por tenant em vez de lista de endereços proibidos:** o cliente cadastra a URL; a lista proibida
  cobre a rede interna sem cadastro manual. Pode ser somada depois.
- **Exceção de 5 min para estoque (D3 b):** recusada pelo dono do produto.
- **Cifra única com a do e-mail (`apps/api/src/email/cifra.ts`):** fica separada agora; unificar com o cofre depois.

## Consequências
- **Operação (D7):** o secret `MACUXI_CHAVE_SEGREDOS_V1` do environment `PRODUCAO` (o GitHub guarda o nome em maiúsculas; o
  cofre aceita `v` e `V`) vai ao `.env` da VM pelo workflow de publicação (PR de governança, com autorização do dono do
  produto). Sem ele, a busca na API do ERP
  não liga; o resto da API sobe normalmente. Confirmar com a Magalu o IP fixo de saída da VM e publicá-lo no assistente.
- **Backup:** o `pg_dump` leva só o texto cifrado; restaurar em outra VM exige a mesma chave-mestra.
- **Limite em memória:** o limite de 60 chamadas por minuto vale por processo. Com um worker só (hoje), vale por Conector.
  Com mais de um worker, passar o contador ao banco.
- **Testes:** as chaves dos testes são geradas na hora; nenhuma chave real no repositório. A F7 procura o segredo em log,
  resposta, auditoria e outbox.
- **Fatias seguintes:** F2 (banco-dados: `conector_api`, `credencial_erp`, `implantacao`, `implantacao_dia`,
  `coleta_execucao`), F3 (modulo-integracao: contratos `ModeloErp` e `ConfigApiErp`, schemas dos dois eventos, `domain` da
  coleta, tarefa `agendar_coletas`, trabalhos `coletar_erp` e `entregar_pedido_erp`, rotas e ações
  `integracao.erp_api.editar` e `integracao.erp_api.testar`), F4 a F8 conforme o §6 do desenho.
