# Desenho — Modelos de integração por ERP, busca na API do ERP, assistente e painel dos 30 dias

Aprovado pelo dono do produto em 22/11/2026 (R-20261122-005500-alexandre): D1–D9 conforme as recomendações; codificação na v1.0.23

- **Autor:** engenheiro-software · **Data:** 22/11/2026 (Manaus) · **Situação:** aprovado; codificação em andamento (F0–F2).
  F0 e F1 no branch `nuvem/v1025-erp-engenheiro-software`: ADR 0066, eventos no registro (`@1`, padrão do registro), cofre,
  redação do log, cliente HTTP de saída e piso da coleta no `platform-sdk`
- **Pedido:** R-20261111-194840-alexandre. Aprovação para começar o desenho: R-20261121-234000-alexandre, item 3.
- **Premissa de origem:** o recado R-20261111-194840-alexandre **não foi lido na íntegra**. A sessão da nuvem recebe 403 no
  repositório de recados. Este desenho parte do resumo do gerente-projetos:
  1. modelo de integração com desenho único, aprovado pelo dono do produto antes de codar;
  2. modelos prontos para 5 ERPs (Protheus, WinThor, SAP B1, Sankhya e Senior), com "o Macuxi busca na API do ERP";
  3. assistente de instalação no `config.`;
  4. acompanhamento da implantação nos primeiros 30 dias no `config.`.

  Se o texto original disser algo diferente, vale o recado, e este desenho é corrigido antes do código.
- **Contexto já decidido:**
  - integração só por Conector ou API, sem CSV em todo o sistema (R-20261121-235000, item 5);
  - a v1.0.22 traz o `config.` enxuto, com "Integração via Conector | via API" e o guia da API em PDF;
  - a T-0164 (Excel) foi cancelada.
- **Base:** RF-INT-01, 02, 04, 05 e 06; RN-INT-01 a 14; RN-CORE-23 e 39; ADR 0006, 0007, 0013, 0016, 0022, 0025, 0028, 0029,
  0040, 0043 e 0058; doc 06.
- **Escopo:** só o desenho. Nenhum código, migração, contrato ou tela muda nesta frente.

---

## 1. O que já existe

| Peça | Onde | O que faz hoje |
|---|---|---|
| **Hub `/integracao/v1`** | `modules/integracao/contracts/hub.ts`, `api/rotas-lotes.ts`, `api/rotas-pedidos.ts`, `api/aplicar-lote.ts`; ADR 0013 | O contrato canônico. Lote por entidade (até 5.000 linhas, 202 assíncrono, RN-INT-01), delta por cursor `(alterado_em, external_id)` (RN-INT-05), carga completa com inativação (RN-INT-06), idempotência por `external_id` + hash (RN-INT-02, `domain/idempotencia.ts`, `domain/lote-idempotencia.ts`) e guarda monotônica. Pedidos pendentes e retorno (RN-INT-08), sinal de vida, reconciliação. Chave por Conector, guardada só como hash (`domain/credencial.ts`, RN-INT-10). OpenAPI em `modules/integracao/docs/openapi-hub-v1.json` e guia em `docs/guia-api-hub.md`. |
| **Entidades canônicas** | `modules/integracao/contracts/entidades.ts` | 16 entidades: `filial`, `vendedor`, `catalogo_no`, `forma_pagamento`, `prazo_pagamento`, `produto`, `produto_unidade`, `preco`, `tabela_escalonada`, `estoque`, `cliente`, `cliente_endereco`, `transportadora`, `rota`, `titulo` e `nota` (faturamento e devolução). `ORDEM_CARGA_ENTIDADES` (RN-INT-04) e `CAMPO_SOMA_CONTROLE` (reconciliação). |
| **Conector on-premise** | `apps/conector/src` (`erp/sqlserver.ts`, `oracle.ts`, `postgres.ts`; `sincronizador.ts`, `pedidos.ts`, `reconciliacao.ts`, `segredos/`, `atualizacao/`) | Serviço Windows. Lê as views do ERP por keyset e empurra lotes ao Hub por HTTPS de saída. Busca os pedidos aprovados, grava na entrada do ERP e devolve o retorno. Fila local em SQLite, segredos no Credential Manager do Windows, máscara de log e atualização assinada. **Drivers: SQL Server, Oracle e PostgreSQL** (sem Firebird, MySQL e HANA). Versão atual 1.5.0. |
| **Views-modelo** | `db/conector/views-modelo.sql` e `db/conector/entrada-pedido-modelo.sql` | As 16 views `vw_macuxi_<entidade>` mais as 2 de retorno do pedido (`vw_macuxi_pedido_status` e itens faturados), e a tabela de entrada com as procedures `sp_macuxi_pedido_inserir` e `sp_macuxi_pedido_item_inserir`. Escritas para **um ERP genérico**: o técnico do cliente troca o `FROM`. Não há modelo por ERP. |
| **Kit do piloto** | `modules/integracao/kit-piloto/` (`ROTEIRO.md`, `Instalar-Piloto.ps1`, `sql/`, `erp-via-api/erp-via-api.mjs`); `docs/modulos/integracao/kit-piloto.md`; T-0162 | ERP simulado em SQL Server Express com as duas modalidades: **Piloto Conector** (o Conector lê as views) e **Piloto API** (um script de minuto em minuto, no Windows, que lê as views e **empurra** ao Hub pelo `ClienteHub`). O "via API" do kit é o ERP empurrando, não o Macuxi buscando. |
| **Kit Thathyany** | `modules/integracao/kit-thathyany/` | Carga por CSV (`modelos/*.csv`, `carga_csv.py`). Sai pela decisão "sem CSV" (R-20261121-235000, item 5). Não entra neste desenho. |
| **Monitor e lotes no BKO** | `modules/integracao/web/components/monitor-page.tsx`, `entidades-panel.tsx`, `lote-drawer.tsx`, `historico-dialog.tsx`, `autorizar-reprocessamento.tsx`; `api/bko-monitor.ts`, `api/bko-lotes-acoes.ts`; `domain/monitor.ts`, `domain/status-lote.ts` | Uma linha por entidade com a última carga, histórico de lotes, log de erros por linha, reprocessar e cancelar (com autorização), saúde do Conector (`ok`, `atrasado`, `sem_sinal`, `parado_por_versao`, `nunca_conectou`, `desativado`) e alertas (lotes falhos em 24 h, inativação pendente, reconciliação divergente, pedidos presos e retidos). Validado no roteiro da v1.0.14, seção 12 (T-0173). |
| **Reconciliação** | `modules/integracao/domain/reconciliacao.ts`; `apps/conector/src/reconciliacao.ts` | Diária por entidade: contagem de ativos e soma de controle, com tolerância (RN-INT-07) e evento `integracao.reconciliacao.divergente@1`. |
| **Pedidos ao ERP** | `domain/pedido-fila.ts`, `domain/resumo-pedidos-erp.ts`, `api/consumidores-pedido.ts`, `domain/mapeamento.ts` (de-para) | Fila de pendentes, entrega idempotente pelo UUID, retidos por de-para ou cadastro, presos sem retorno. Os cards ficam em BKO › Pedidos. |
| **Portal `config.`** | `apps/web/components/portal/aba-integracao.tsx`, `baixar-conector.tsx` | Aba "Integração automática": cadastra o Conector, mostra a chave uma vez, baixa o Conector e abre a OpenAPI. `TIPOS_CONECTOR = ['conector', 'nuvem', 'arquivo']` (`contracts/bko.ts:24`): **o tipo `nuvem` já existe no contrato**, sem nada que o execute. |
| **Agendador e trabalhos** | `apps/api/src/agendador.ts` (ADR 0022) e `definirTrabalho` em `packages/platform-sdk/src/api.ts` (ADR 0058) | Tarefa periódica por tenant, com intervalo mínimo de 15 min (RN-CORE-23), e trabalho sob demanda fatiado, com rede fora da transação, tentativas e `aoFalhar`. É a base da busca na nuvem. |
| **`apps/mock-api`** | `apps/mock-api/src/seed/generate.ts` | Legado da Fase M (planilhas Excel). **Correção ao pedido:** o seed não tem os 5 ERPs. Tem só `erp_name: 'Protheus'` como rótulo da empresa de exemplo, sem tabelas nem endpoints de ERP. Não serve de simulador; o simulador está na fatia F7 (§6). |

**O que falta:** modelo por ERP (views e de-para prontos), o executor do tipo `nuvem` (a busca na API do ERP), o cofre de
credenciais do ERP por tenant, o assistente e o painel dos 30 dias.

---

## 2. "O Macuxi busca na API do ERP"

Hoje o ERP (ou o Conector) **empurra** ao Hub. Na busca, o Macuxi **puxa**: chama a API do ERP, converte para o contrato
canônico e aplica pelo mesmo caminho do lote. Nada muda depois do staging: idempotência, cursor, guarda monotônica,
inativação, eventos, Monitor e reconciliação continuam os mesmos.

### 2.1 Onde roda: worker na nuvem × Conector

| Critério | Worker na nuvem (Conector tipo `nuvem`) | Conector on-premise com "driver HTTP" |
|---|---|---|
| ERP na nuvem (Sankhya Om, SAP B1 hospedado, Senior X, TOTVS Cloud) | Funciona direto. Nada a instalar no cliente. | Exige uma máquina Windows no cliente só para chamar outra nuvem. |
| ERP no servidor do cliente com API só na rede local (Protheus REST, Service Layer na LAN) | Exige que o cliente publique a API na internet (HTTPS, lista de IPs). Barreira de TI e risco para ele. | Funciona sem abrir porta: a conexão é sempre de saída (doc 06). |
| Segredo do ERP | No cofre do Macuxi (§2.2). O Macuxi passa a guardar credencial de terceiro. | Continua no Credential Manager do cliente. O Macuxi nunca vê. |
| Atualização e versão | Uma só, no deploy da API. | Depende do auto-update do Conector (política de versão, RN-INT-11). |
| Intervalo mínimo | 15 min (ADR 0022, RN-CORE-23), salvo exceção (D3). | 1 min (o Conector já faz). |
| Custo para o Macuxi | CPU e rede do worker, por tenant. | Nenhum. |
| Esforço | Novo: executor, cofre e proteção contra SSRF. | Novo: driver HTTP e modelos dentro do Conector, mais uma versão distribuída. |

**Recomendação (D1):** a busca roda no **worker na nuvem**, como o Conector tipo `nuvem` que o contrato já prevê. Ela vale
para ERP com API na internet. ERP que só está na rede do cliente continua no **Conector com as views** (modelo por ERP, §3).
O "driver HTTP" no Conector fica para quando aparecer um cliente com API só na LAN e sem acesso ao banco. A conversão
(de-para) fica em função pura no `domain`, sem depender de onde roda, para que esse passo futuro reaproveite o código.

### 2.2 Credenciais do ERP

- **Tabela** `integracao.credencial_erp` (banco-dados): `id`, `tenant_id`, `conector_id`, `cifrado`, `iv`, `tag`,
  `chave_versao`, `atualizada_em`, `atualizada_por`, mais as colunas padrão (regra 5). RLS ligado. Uma linha viva por Conector.
- **Cifra:** AES-256-GCM no processo da API e do worker (`node:crypto`, sem dependência nova). O AAD é `tenant_id|conector_id`:
  um texto cifrado copiado para outro tenant não decifra.
- **Chave-mestra:** `MACUXI_CHAVE_SEGREDOS_v<n>` no `.env` da VM. Onde ela nasce é a decisão D7. Ela nunca vai ao banco nem ao
  backup: o `pg_dump` leva só o texto cifrado.
- **Só escrita:** a rota grava. Nenhuma rota devolve o segredo, nem parte dele. A tela mostra "Configurada em dd/mm hh:mm por
  <nome>" e o usuário do ERP, que não é segredo.
- **Quem decifra:** só o worker, na coleta, e a rota "Testar conexão", em memória. O token de sessão do ERP (`B1SESSION`,
  bearer OAuth) fica só em memória, com o prazo dele.
- **Nunca em log nem em recado:**
  - `redact` do pino nos campos `senha`, `segredo`, `token`, `authorization` e `cookie`;
  - a resposta do ERP nunca vai inteira ao log, só o status e o código;
  - o diagnóstico (ADR 0043) e o suporte não leem a tabela;
  - o teste da F7 procura o segredo em log, resposta, auditoria e outbox.
- **Rotação da credencial do ERP:** o admin cola a nova, o "Testar conexão" roda com ela e só então ela troca a anterior, numa
  transação. Não há convivência: quem chama o ERP é o Macuxi.
- **Rotação da chave-mestra:** entra a `v<n+1>` e um trabalho recifra as linhas por tenant. A `v<n>` sai do `.env` quando a
  contagem por versão zerar.
- **Auditoria:** "credencial do ERP trocada" (quem e quando, sem o valor).

### 2.3 Agendamento

1. **Tarefa periódica** `agendar_coletas` (ADR 0022, a cada 15 min). Para cada Conector `nuvem` ativo do tenant e cada
   entidade vencida pela frequência dela, publica `integracao.coleta.solicitada@v1`, com `{ conector_id, entidade, modo }`.
2. **Trabalho sob demanda** `coletar_erp` (ADR 0058), com alvo `(conector, entidade)` e um trabalho vivo por alvo. Cada fatia:
   - busca uma página na API do ERP, fora da transação;
   - converte pelo modelo do ERP (função pura);
   - aplica como lote em `emTransacao`, pelo mesmo caminho do `POST /lotes`, sem HTTP;
   - com `deveParar()`, devolve `continua`.
3. **Frequência por entidade:** a do doc 06, com piso de 15 min. Preço, escalonada e estoque a cada 15 min. Cliente, produto,
   unidade, endereço e título a cada 1 h. Filial, vendedor, forma, prazo, transportadora e árvore 1 vez por dia.
4. **Incremental:**
   - o cursor `(alterado_em, external_id)` é o mesmo (RN-INT-05) e a API filtra por data de alteração (§3);
   - a janela de sobreposição (parâmetro, padrão 10 min) cobre o relógio do ERP e transação tardia, e a guarda monotônica
     descarta o repetido;
   - entidade sem data de alteração na API vai em carga completa na frequência dela;
   - a carga completa semanal, de madrugada no fuso do tenant, é a única que inativa (RN-INT-06), porque a API não avisa exclusão.
5. **Reprocesso:**
   - "Buscar agora", por entidade ou tudo, com perfil admin, publica o mesmo evento;
   - "Recarregar entidade" pede carga completa;
   - o reprocesso de lote e de linha com erro é o do Monitor, sem mudança.
6. **Limites (parâmetros do módulo, por tenant):**
   - página de 100 a 500 linhas, conforme o ERP;
   - no máximo 60 chamadas por minuto por Conector;
   - 30 s por chamada;
   - 1 coleta por vez por Conector;
   - no máximo 5.000 linhas por lote (RN-INT-01);
   - carga completa fora do horário comercial do tenant, para não pesar no ERP.

### 2.4 Falha e idempotência

| Falha | O que acontece | No Monitor |
|---|---|---|
| 401 ou 403 do ERP | Para as coletas do Conector e não tenta de novo até trocarem a credencial. | Alerta "O ERP recusou a credencial" com a ação "Trocar credencial". |
| Rede, timeout, 429 ou 5xx | Tenta de novo em 1, 2, 4, 8 e 16 min (respeitando `Retry-After`). Depois, `aoFalhar` e volta no próximo ciclo. | Saúde `atrasado`; acima de 15 min, `sem_sinal` (mesma regra do sinal de vida). |
| Linha fora do contrato | Vai para `lote_linha_erro`; o lote segue (RN-INT-03). | Linha com erro, como hoje. |
| Campo do modelo sumiu em todas as linhas (ERP mudou) | O lote falha e o cursor não anda. | Alerta "O ERP mudou o formato de <entidade>". |
| Referência ausente (cliente antes do vendedor) | `referencia_ausente` e reprocesso, como hoje (RN-INT-04). | Igual. |

- **Idempotência da carga:** o cursor só anda com o lote concluído. A mesma página aplicada de novo tem o mesmo hash e não muda
  nada (RN-INT-02).
- **Pedido ao ERP pela API:**
  1. o consumidor da fila de pendentes (`pedido-fila.ts`) dispara o trabalho `entregar_pedido_erp` assim que o pedido é
     aprovado, sem esperar o ciclo;
  2. o trabalho procura no ERP o pedido pelo UUID do Macuxi, num campo do ERP (§3, D8);
  3. só cria se não achar;
  4. grava `integrado` com o `numero_erp` (RN-INT-08).

  Se a resposta se perder no timeout, a tentativa seguinte acha o pedido e não duplica. Recusa de regra do ERP vira
  `rejeitado_erp` com o motivo. O retorno (faturado ou cancelado) chega na coleta de `nota` e do status do pedido, a cada 15 min.

### 2.5 Multi-tenant, RLS, licença e SSRF

- **Tenant:** todo evento, trabalho e tabela leva `tenant_id`. O trabalho roda em `comTenant` com `macuxi_app` sob RLS, e o
  decifrar exige o AAD do tenant.
- **Licença:** o agendador só roda para tenant com a `integracao` efetiva (ADR 0022 e 0025). As rotas de configuração exigem
  o módulo, o perfil admin (ou o super-admin no `config.`, ADR 0029) e as ações novas `integracao.erp_api.editar` e
  `integracao.erp_api.testar`.
- **Topologia (RN-INT-13):** o Conector `nuvem` ocupa as entidades dele, e conflito com outro Conector é recusado, como hoje.
  Um destino de pedidos por empresa.
- **SSRF:** a URL do ERP vem do cliente. Por isso:
  - só `https`;
  - o DNS é resolvido antes e endereço privado, loopback, link-local e de metadados (169.254.169.254) é recusado;
  - redirecionamento para outro host é recusado.

  O worker sai por um IP fixo, publicado no assistente para a lista de IPs do cliente (D7).

**RN propostas** (o gerente dá o número final):
- RN-INT-17: Conector `nuvem` e frequência por entidade, múltipla de 15 min, de 15 min a 1 dia; a carga completa semanal à parte.
- RN-INT-18: cofre de credenciais do ERP (só escrita, cifra por tenant, rotação).
- RN-INT-19: pedido pela API só com o campo do UUID no ERP, com consulta antes de criar.
- RN-INT-20: classes de falha e a parada por credencial recusada.
- RN-INT-21: marcos e fim da implantação (§5).

---

## 3. Um modelo por ERP

**Legenda.** **[P]** = conhecimento público (documentação do fabricante ou uso amplo no mercado). **[C]** = confirmar com
o cliente ou o parceiro antes de codar: muda por versão, licença ou customização. Todo ERP brasileiro é customizado. Os nomes
abaixo são o ponto de partida do modelo, não a garantia.

**Entrega de cada modelo:**
- `db/conector/modelos/<erp>.sql`: as views `vw_macuxi_*` com o `FROM` do ERP, mais a entrada de pedido quando o ERP não tem
  API de pedido (banco-dados);
- o adaptador de API, quando o ERP tem uma: endpoints, paginação, filtro por data e conversão (modulo-integracao);
- uma ficha no guia: o que o cliente confirma antes, os campos customizados e o usuário só de leitura.

### 3.1 TOTVS Protheus

- **Meio padrão:** Conector com views. O banco é SQL Server, Oracle ou PostgreSQL, todos com driver no Conector.
- **API:** o REST do Protheus (TOTVS API, `/api/...` no AppServer) só quando o cliente está no TOTVS Cloud ou publica a API
  **[C]**. A cobertura de endpoints muda por release.
- **Regras gerais [P]:**
  - as tabelas levam o sufixo da empresa (`SA1010`);
  - `D_E_L_E_T_ = '*'` é registro excluído;
  - `xx_FILIAL` é vazio quando a tabela é compartilhada;
  - `xx_MSBLQL = '1'` é bloqueado.
- **Data de alteração:** `S_T_A_M_P_` só existe se o DBAccess estiver configurado para isso **[C]**. Sem ela, carga completa
  na frequência.

| Canônica | Tabela | `external_id` e campos | Fonte |
|---|---|---|---|
| filial | `SYS_COMPANY` (12.1.2x) ou SIGAMAT (arquivo, não tabela) | `M0_CODFIL` | [C] |
| vendedor | `SA3` | `A3_COD`, `A3_NOME` | [P] |
| cliente | `SA1` | `A1_COD`+`A1_LOJA`; `A1_NOME`, `A1_CGC`, `A1_END`, `A1_MUN`, `A1_EST`, `A1_VEND`, `A1_LC` (limite), `A1_COND`, `A1_TABELA` | [P] |
| produto e unidade | `SB1` (`SBM` grupo) | `B1_COD`; `B1_DESC`, `B1_UM`, `B1_SEGUM` + `B1_CONV` (embalagem), `B1_CODBAR` | [P] |
| preço | `DA0` (cabeçalho) e `DA1` (itens) | `DA1_CODTAB`+`DA1_CODPRO`; `DA1_PRCVEN`; vigência em `DA0_DATDE` e `DA0_DATATE` | [P] |
| estoque | `SB2` | `B2_COD`+`B2_LOCAL`; saldo `B2_QATU − B2_RESERVA − B2_QEMP`; filial em `B2_FILIAL` | [P] |
| título | `SE1` | `E1_PREFIXO`+`E1_NUM`+`E1_PARCELA`+`E1_TIPO`; `E1_VENCREA`, `E1_VALOR`, `E1_SALDO`, `E1_BAIXA` | [P] |
| forma e prazo | `SE4` | `E4_CODIGO`; `E4_COND` ("30,60,90") | [P] |
| transportadora | `SA4` | `A4_COD` | [P] |
| nota e devolução | `SF2`/`SD2` (saída); `SF1`/`SD1` com `F1_TIPO = 'D'` | | [P] |
| devolução do pedido | `SC5`/`SC6`, **pela rotina `MATA410` (ExecAuto)**, nunca por `INSERT` direto. Caminho: a tabela de entrada do modelo e um job do parceiro que chama a `MATA410`, ou um REST customizado. UUID em campo customizado (`C5_XMXUUID`). | | [C] |

### 3.2 TOTVS WinThor

- **Meio padrão:** Conector com views (Oracle, com driver).
- **API:** não presumir **[C]**. A integração de força de vendas do WinThor costuma usar tabelas intermediárias.

| Canônica | Tabela | `external_id` e campos | Fonte |
|---|---|---|---|
| filial | `PCFILIAL` | `CODIGO` | [P] |
| vendedor (RCA) | `PCUSUARI` | `CODUSUR`; `NOME` | [P] |
| cliente | `PCCLIENT` | `CODCLI`; `CLIENTE`, `CGCENT`, `ENDERENT`, `MUNICENT`, `ESTENT`, `CODUSUR1`, `LIMCRED`, `BLOQUEIO`, `CODPLPAG`; alteração em `DTULTALTER` | [P]; `DTULTALTER` [C] |
| produto e unidade | `PCPRODUT` | `CODPROD`; `DESCRICAO`, `UNIDADE`, `EMBALAGEM`, `QTUNITCX`, `CODAUXILIAR` (EAN) | [P] |
| preço | `PCTABPR` por região (`NUMREGIAO`); a região do cliente vem da praça (`PCPRACA`) | `CODPROD`+`NUMREGIAO`; `PVENDA` | [C] |
| estoque | `PCEST` | `CODFILIAL`+`CODPROD`; saldo `QTESTGER − QTRESERV − QTBLOQUEADA` | [P] |
| título | `PCPREST` | `DUPLIC`+`PREST`; `CODCLI`, `VALOR`, `DTVENC`, `DTPAG`, `CODCOB` | [P] |
| forma e prazo | `PCPLPAG` (plano) e `PCCOB` (cobrança) | `CODPLPAG`; `NUMDIAS` | [P] |
| nota e devolução | `PCNFSAID`; devolução em `PCNFENT` | | [C] |
| devolução do pedido | tabelas de pedido da força de vendas (`PCPEDCFV`/`PCPEDIFV`), importadas pela rotina do WinThor. Nunca direto em `PCPEDC`/`PCPEDI`. | | [C] |

### 3.3 SAP Business One

- **Meio padrão:** API, pelo **Service Layer** (REST/OData, `https://<host>:50000/b1s/v1`) **[P]**.
  - `POST /Login` com `CompanyDB`, `UserName` e `Password` devolve o cookie `B1SESSION`, que vence em 30 min.
  - Paginação por `$top`/`$skip` e `Prefer: odata.maxpagesize`.
  - Filtro por `UpdateDate` e `UpdateTime`.
- **Conector:** só no SQL Server. Com HANA, só a API, porque o Conector não tem driver HANA.
- **Licença:** o Service Layer pode exigir licença ou usuário dedicado **[C]**.

| Canônica | Tabela / endpoint | `external_id` e campos | Fonte |
|---|---|---|---|
| filial | `OBPL` / `BusinessPlaces` (só com multifilial) | `BPLId` | [P] |
| vendedor | `OSLP` / `SalesPersons` | `SalesEmployeeCode`; `SalesEmployeeName` | [P] |
| cliente e endereço | `OCRD` / `BusinessPartners?$filter=CardType eq 'cCustomer'`; endereços em `CRD1` / `BPAddresses` | `CardCode`; `CardName`, `CreditLimit`, `SalesPersonCode`, `PayTermsGrpCode`, `PriceListNum`, `Frozen`; CNPJ em `CRD7` / `BPFiscalTaxIDCollection` | [P]; CNPJ [C] |
| produto e unidade | `OITM` / `Items` | `ItemCode`; `ItemName`, `BarCode`, `SalesUnit`, `SalesItemsPerUnit`, `ItemsGroupCode`, `Frozen` | [P] |
| preço | `ITM1` / `Items.ItemPrices`; listas em `OPLN` / `PriceLists` | `ItemCode`+`PriceList`; `Price` | [P] |
| estoque | `OITW` / `Items.ItemWarehouseInfoCollection`; `OWHS` / `Warehouses` | `ItemCode`+`WarehouseCode`; `InStock − Committed` | [P] |
| título | `OINV` / `Invoices` em aberto; parcelas em `INV6` | `DocEntry`+parcela; `DocTotal − PaidToDate`, `DocDueDate` | [P] |
| forma e prazo | `OCTG` / `PaymentTermsTypes` | `GroupNumber`; `PaymentTermsGroupName`, `NumberOfAdditionalDays` | [P] |
| nota e devolução | `OINV` / `Invoices`; `ORIN` / `CreditNotes` | | [P] |
| devolução do pedido | `POST /Orders` (`ORDR`/`RDR1`): `CardCode`, `DocDueDate`, `DocumentLines` (`ItemCode`, `Quantity`, `UnitPrice`, `DiscountPercent`). UUID num UDF `U_MXUUID`; antes, `GET /Orders?$filter=U_MXUUID eq '<uuid>'`. Status por `DocumentStatus` e `Cancelled`. | | [P]; UDF [C] |

### 3.4 Sankhya (Sankhya Om)

- **Meio padrão:** API, pelo gateway da Sankhya (`https://api.sankhya.com.br`, autenticação com token e appkey do parceiro)
  **[P]**, quando o cliente está na nuvem da Sankhya.
  - Serviços `mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords` para leitura e `CACSP.incluirNota` para o pedido.
  - O acesso à API depende de contrato com a Sankhya **[C]**.
- **Conector:** Oracle ou SQL Server, quando o banco é do cliente.

| Canônica | Tabela (entidade na API) | `external_id` e campos | Fonte |
|---|---|---|---|
| filial | `TSIEMP` (Empresa) | `CODEMP` | [P] |
| vendedor | `TGFVEN` (Vendedor) | `CODVEND`; `APELIDO` | [P] |
| cliente e endereço | `TGFPAR` (Parceiro) com `CLIENTE = 'S'`; endereço por `TSIEND`/`TSIBAI`/`TSICID` | `CODPARC`; `NOMEPARC`, `CGC_CPF`, `CODVEND`, `LIMCRED`, `BLOQUEAR`; alteração em `DTALTER` | [P] |
| produto e unidade | `TGFPRO` (Produto); unidades alternativas em `TGFVOA` | `CODPROD`; `DESCRPROD`, `CODVOL`, `REFERENCIA`, `CODGRUPOPROD`, `ATIVO` | [P] |
| preço | `TGFTAB` (tabela e vigência `DTVIGOR`) e `TGFEXC` (preço por produto) | `NUTAB`+`CODPROD`; `VLRVENDA` | [P] |
| estoque | `TGFEST` | `CODEMP`+`CODPROD`+`CODLOCAL`; `ESTOQUE − RESERVADO` | [P] |
| título | `TGFFIN` com `RECDESP = 1` | `NUFIN`; `CODPARC`, `DTVENC`, `VLRDESDOB`, `DHBAIXA` | [P] |
| forma e prazo | `TGFTPV` (tipo de negociação) | `CODTIPVENDA`; `DESCRTIPVENDA` | [P] |
| nota e devolução | `TGFCAB`/`TGFITE`, por `TIPMOV` (`V` venda, `D` devolução) | `NUNOTA` | [P] |
| devolução do pedido | `CACSP.incluirNota` com a TOP de pedido do cliente (`CODTIPOPER`, `TIPMOV = 'P'`). UUID em campo adicional `AD_MXUUID`; antes, consulta por ele. | | [C] |

### 3.5 Senior (ERP Senior / Gestão Empresarial)

- **Meio padrão:** Conector com views (Oracle ou SQL Server) **[P]**.
- **API:** pelos web services do ERP (SOAP, `com_senior_g5_co_*`) ou pela Senior X Platform (REST), quando o cliente as tiver
  **[C]**. A disponibilidade e a licença mudam por contrato.

| Canônica | Tabela | `external_id` e campos | Fonte |
|---|---|---|---|
| filial | `E070FIL` | `CODEMP`+`CODFIL` | [P] |
| vendedor (representante) | `E090REP` | `CODREP`; `NOMREP` | [P] |
| cliente | `E085CLI` + `E085HCL` (dados por empresa e filial: representante, condição, tabela) | `CODCLI`; `NOMCLI`, `CGCCPF`, `ENDCLI`, `CIDCLI`, `SIGUFS`, `SITCLI` | [P]; campos da `E085HCL` [C] |
| produto e unidade | `E075PRO` + `E075DER` (derivação) | `CODPRO`+`CODDER`; `DESPRO`, `UNIMED`, `SITPRO` | [P] |
| preço | `E081TAB` / `E081ITE` | `CODTPR`+`CODPRO`+`CODDER`; `PREBAS`; vigência `DATINI` | [C] |
| estoque | `E210EST` | `CODPRO`+`CODDER`+`CODDEP`; `QTDEST − QTDRES` | [P] |
| título | `E301TCR` | `CODEMP`+`CODFIL`+`NUMTIT`+`CODTPT`; `CODCLI`, `VCTPRO`, `VLRABE`, `SITTIT` | [P] |
| forma e prazo | `E028CPG` | `CODCPG`; `DESCPG` | [P] |
| nota e devolução | `E140NFV`/`E140IPV`; devolução pela nota de entrada | | [C] |
| devolução do pedido | `E120PED`/`E120IPD` **pelo web service de pedidos**, nunca por `INSERT` direto. UUID em campo de usuário `USU_MXUUID`. | | [C] |
| data de alteração | varia por tabela | | [C] |

### 3.6 Resumo

| ERP | Meio padrão | Busca na API | Pedido ao ERP | O que travar com o cliente |
|---|---|---|---|---|
| Protheus | Conector | só com TOTVS Cloud ou REST publicado | `MATA410` por job ou REST do parceiro | `S_T_A_M_P_`, campo do UUID, filiais compartilhadas |
| WinThor | Conector | não | tabelas de FV e a rotina do WinThor | preço por região, tabelas de FV, `DTULTALTER` |
| SAP B1 | API (Service Layer) | sim | `POST /Orders` | licença do Service Layer, UDF, HANA × SQL Server |
| Sankhya | API (nuvem) ou Conector | sim, com contrato | `CACSP.incluirNota` | appkey e contrato, TOP de pedido, `AD_MXUUID` |
| Senior | Conector | depois, com web service | web service de pedidos | licença dos web services, `E085HCL`, `USU_MXUUID` |

---

## 4. Assistente de instalação no `config.`

Fica na ficha da empresa, aba Integração, no lugar do "via Conector | via API" da v1.0.22. O estado é salvo por tenant
(`integracao.implantacao`: passo, ERP, meio e início). O admin sai e volta no mesmo passo.

1. **Seu ERP.**
   - Lista: Protheus, WinThor, SAP Business One, Sankhya, Senior e Outro.
   - "Outro" segue com o modelo genérico de hoje (`views-modelo.sql`) ou com o guia da API em PDF.
2. **Como o ERP fala com o Macuxi** (D4).
   - **Conector:** "o ERP fica num servidor da empresa". Recomendado para Protheus, WinThor e Senior.
   - **API:** "o ERP está na nuvem". Recomendado para SAP B1 e Sankhya. Duas escolhas:
     - "O Macuxi busca no ERP": modelo pronto, §2;
     - "O ERP envia ao Macuxi": guia da API em PDF e chave do Hub, como hoje.
   - O assistente já marca a recomendada pelo ERP escolhido.
3. **Conexão.**
   - **Conector:**
     - gera a chave (mostrada uma vez, como hoje) e baixa o Conector;
     - baixa o script de views do ERP escolhido (`db/conector/modelos/<erp>.sql`) e a ficha do que o técnico confirma antes.
   - **Busca na API:**
     - campos: endereço da API (https), usuário, senha ou token (campo de senha) e o que o ERP pedir (`CompanyDB` no SAP B1,
       appkey na Sankhya);
     - o IP de saída do Macuxi aparece para a lista de IPs do cliente.
   - **ERP envia:** chave do Hub e o PDF.
4. **Testar conexão.**
   - **Conector:** espera o primeiro sinal de vida e mostra "Conector conectado, versão 1.5.0", ou o erro com a ação.
   - **Busca na API:** autentica e lê 1 registro de cada entidade marcada. Mostra por entidade "OK, n registros" ou o motivo:
     credencial recusada, endpoint não encontrado, campo do modelo ausente ou tempo esgotado. Nunca mostra o dado lido.
     Só com o teste OK o segredo é gravado (§2.2).
5. **O que vem do ERP.**
   - Entidades marcadas pelo modelo, com a ordem de carga.
   - Conflito com outro Conector bloqueia (RN-INT-13).
   - Os de-para mínimos: forma e prazo, depósito → filial e a tabela padrão.
6. **Primeira carga.**
   - "Iniciar carga completa", com uma linha por entidade: na fila, carregando n de m, concluída, ou com erros e o link para o
     Monitor.
   - Ao fim, a carga liga o painel dos 30 dias (§5).
7. **Pedidos ao ERP.**
   - Confere o campo do UUID (busca na API) ou a entrada de pedido (Conector) e liga a devolução.
   - Não cria pedido de teste no ERP (D5): o marco é o primeiro pedido real integrado.

O designer-ux escreve os textos finais. O corretor-redundancias passa cada passo pela regra "só o que o usuário usa para agir".

---

## 5. Painel dos primeiros 30 dias no `config.`

Visto pelo super-admin e, só para leitura, pelo admin do cliente (D6). Começa na primeira carga completa (D+0) e termina no
D+30, ou antes, quando todos os marcos estiverem cumpridos e houver 7 dias seguidos sem alerta.

| Bloco | O que mede | Fonte |
|---|---|---|
| **Marcos** | Primeira carga completa · primeiro pedido integrado · primeiro faturamento devolvido · 3 reconciliações seguidas sem divergência · 7 dias seguidos sem alerta | novo (`integracao.implantacao`, com a data de cada marco); a origem de cada marco já está nas tabelas de lote, pedido e reconciliação |
| **Saúde** | Saúde do Conector agora e minutos fora do ar por dia | Monitor (`avaliarSaudeConector`); o "por dia" precisa do retrato diário |
| **Cargas** | Por entidade: última carga, atraso contra a frequência esperada, lotes concluídos × com erro por dia | Monitor (lotes e `entidades-panel`) |
| **Erros a resolver** | Os 5 códigos de erro mais frequentes em aberto, com a ação; clientes com `cadastro_incompleto` | Monitor (log por linha; RN-INT-14) |
| **Reconciliação** | Divergências por dia e por entidade | Monitor (`reconciliacao.ts`) |
| **Pedidos** | Integrados, rejeitados pelo ERP, presos e retidos, e o tempo mediano de aprovação até integrado | `resumo-pedidos-erp.ts` + novo cálculo da mediana |

- **O que é novo:**
  - a tabela de marcos;
  - um retrato diário, `integracao.implantacao_dia`, gravado por uma tarefa de 1 em 1 dia com as contagens do dia, para o
    gráfico não depender da retenção dos lotes;
  - a mediana do tempo do pedido.
- **Rota:** `GET /v1/plataforma/empresas/:tenant_id/implantacao`, com o mesmo padrão de acesso da ficha de assinatura (ADR 0047).
- O painel não repete o Monitor. Cada bloco leva ao Monitor do BKO filtrado para agir.

---

## 6. Donos e fatias

| # | Fatia | Dono | Depende de |
|---|---|---|---|
| F0 | ADR "Busca na API do ERP e cofre de credenciais por tenant" (número reservado no quadro, conferido no `origin/main`); registro em `.coord/contratos/` dos eventos `integracao.coleta.solicitada@v1` e `integracao.implantacao.marco@v1`; RF e RN no doc 02 e 03 (gerente) | engenheiro-software; gerente-projetos | decisões do §8 |
| F1 | Plataforma: cofre (`cifrar`/`decifrar` AES-256-GCM, versão de chave, `redact`), cliente HTTP de saída com proteção contra SSRF, timeout e limite por host, recifra da chave-mestra | engenheiro-software | F0 |
| F2 | Migração: `integracao.conector_api` (ERP, URL e parâmetros não secretos), `credencial_erp`, `implantacao`, `implantacao_dia` e `coleta_execucao`; RLS, down, `*.db.test.ts` e dicionário | banco-dados | F0 |
| F3 | Núcleo da busca: contratos (`ModeloErp`, `ConfigApiErp`), domain puro (plano de coleta, janela, classes de falha, conversão), tarefa `agendar_coletas`, trabalhos `coletar_erp` e `entregar_pedido_erp`, rotas salvar, testar e buscar agora, saúde do tipo `nuvem` no Monitor | modulo-integracao | F1, F2 |
| F4a | Adaptadores de API: SAP B1, Sankhya, Protheus REST e Senior, na ordem de D2 | modulo-integracao | F3 |
| F4b | Views por ERP (`db/conector/modelos/<erp>.sql`) para os 5, com a entrada de pedido onde couber, e o teste estático contra `SCHEMA_REGISTRO` | banco-dados | F0 |
| F4c | Ficha de cada ERP no guia (`docs/modulos/integracao/`) | modulo-integracao | F4a, F4b |
| F5 | Assistente: especificação e textos | designer-ux | F0 |
| F5b | Assistente: telas no `config.` | engenheiro-apps | F3, F5 |
| F6 | Painel dos 30 dias: domain e rota | modulo-integracao | F2, F3 |
| F6b | Painel dos 30 dias: especificação | designer-ux | F0 |
| F6c | Painel dos 30 dias: tela | engenheiro-apps | F6, F6b |
| F7 | Simulador de ERP nos testes (dublês HTTP com os formatos públicos do §3); idempotência do pedido com timeout; isolamento de tenant; SSRF; segredo ausente de log e resposta; roteiro do aparelho e do `config.` | testes | F3–F6 |
| F8 | Parecer do corretor-redundancias (assistente, painel e guias); validação do design-de-marca; revisão final | corretor-redundancias; design-de-marca; engenheiro-software | F7 |

- **Caminho crítico:** F0 → F1 ∥ F2 → F3 → F4a (primeiro ERP) → F5b → F7 → F8.
- **Em paralelo:** F4b começa logo depois da F0 e independe da busca. F5 e F6b correm com a F1.

---

## 7. Estimativa por fatia (horas de agente)

| Fatia | Base (h) |
|---|---|
| F0 ADR, contratos e docs | 3 |
| F1 Plataforma (cofre, HTTP seguro) | 10 |
| F2 Banco | 6 |
| F3 Núcleo da busca | 18 |
| F4a Adaptadores de API (4 × 8 h; WinThor só por Conector) | 32 |
| F4b Views dos 5 ERPs | 12 |
| F5 + F5b Assistente (4 + 10) | 14 |
| F6 + F6b + F6c Painel (6 + 2 + 6) | 14 |
| F7 Testes | 12 |
| F8 Corretor, marca, revisão e F4c (3 + 1 + 3 + 1) | 8 |
| **Base** | **129** |
| **+15% de margem** | **19,35** |
| **Total** | **≈ 148 h** |

**Corte mínimo (recomendado para a primeira entrega):** um ERP na busca por API em vez de quatro, com as views dos 5, o
assistente e o painel. Base de 105 h, mais 15% = **≈ 121 h**. Cada adaptador seguinte custa ≈ 9 h com a margem.

---

## 8. Decisões que só o dono do produto toma

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| D1 | Onde roda a busca na API do ERP | (a) worker na nuvem; (b) Conector com driver HTTP; (c) os dois já | **decidido: (a) worker na nuvem**. ERP só na rede do cliente fica no Conector com as views. O (b) entra com o primeiro cliente que precisar. |
| D2 | Primeiro ERP com busca por API | o ERP do primeiro cliente real; SAP B1 (API pública mais estável); Sankhya (forte em distribuição) | **decidido: o ERP do primeiro cliente real.** Sem cliente definido, **SAP B1**: o Service Layer tem documentação pública e não exige contrato com o fabricante para o desenho. |
| D3 | Intervalo mínimo da busca | (a) 15 min para tudo (ADR 0022, RN-CORE-23); (b) exceção de 5 min para estoque | **decidido: (a) 15 min para tudo**. O pedido vai na hora, por evento, e não espera o ciclo. |
| D4 | Como o `config.` apresenta os meios | (a) Conector \| API, com a API dividida em "Macuxi busca" e "ERP envia"; (b) três opções lado a lado | **decidido: (a) Conector \| API**. Mantém o "via Conector \| via API" da v1.0.22. |
| D5 | Pedido de teste no assistente | (a) criar um pedido de teste no ERP; (b) não criar e acompanhar o primeiro pedido real no painel | **decidido: (b) sem pedido de teste**. Pedido de teste no ERP vira nota ou estoque reservado por engano. |
| D6 | Quem vê o painel dos 30 dias | (a) só o super-admin do Macuxi; (b) também o admin do cliente, só leitura | **decidido: (b) também o admin do cliente, só leitura**. O cliente vê o mesmo que o suporte. |
| D7 | Chave-mestra do cofre e IP de saída | chave gerada na VM (como o pepper; perder a VM obriga cada cliente a redigitar a credencial) × secret do ambiente `PRODUCAO` no GitHub; IP fixo de saída da VM publicado ao cliente | **decidido: secret do `PRODUCAO`**, mais o IP fixo da VM, que o engenheiro-software confirma com a Magalu (ADR 0028). |
| D8 | Pedido pela API sem campo do UUID no ERP | (a) exigir o campo customizado; (b) aceitar sem ele, com risco de pedido duplicado | **decidido: (a) exigir o campo customizado**. Sem o campo, o pedido vai pelo Conector com a tabela de entrada. |
| D9 | Validação dos modelos | (a) cada modelo fica "beta" até o primeiro cliente daquele ERP confirmar os itens [C]; (b) contratar parceiro de cada ERP antes | **decidido: (a) "beta" até o primeiro cliente confirmar**. O custo do parceiro entra só se o primeiro cliente travar. |

---

## 9. Riscos

1. **Desenho sobre o resumo.** O recado original não foi lido. Se ele pedir outra coisa (por exemplo, "busca" no sentido de
   Conector), as seções 2 e 7 mudam.
2. **API do ERP inacessível.** Protheus, WinThor e Senior quase sempre ficam no servidor do cliente. Para eles, a busca pela
   nuvem não se aplica sem publicar a API. O ganho real da busca é para SAP B1 e Sankhya.
3. **Licença e contrato da API do fabricante.** O Service Layer, o gateway da Sankhya e os web services da Senior podem custar
   ao cliente ou exigir parceiro homologado.
4. **Customização.** Os campos `X`, `AD_` e `USU_`, as TOPs e as tabelas de FV mudam por cliente. O modelo é ponto de partida;
   o de-para e a ficha [C] são obrigatórios.
5. **Sem data de alteração ou sem aviso de exclusão.** Carga completa mais frequente pesa no ERP. Para isso, a carga completa
   fica de madrugada, com limite de chamadas por minuto.
6. **Credencial de terceiro no Macuxi.** Vazamento é grave. Pesam a cifra por tenant, o cofre só de escrita, o `redact`, o teste
   de log da F7 e a chave-mestra fora do banco e do backup.
7. **SSRF.** URL informada pelo cliente pode apontar para a rede interna da VM. A defesa é o cliente HTTP da F1; sem ela, a F3
   não entra.
8. **Pedido duplicado no ERP.** Depende do campo do UUID e da consulta antes de criar (D8).
9. **Fuso das datas do ERP.** A maioria grava hora local. O modelo converte para UTC com o fuso do tenant e a janela de
   sobreposição (§2.3).
10. **Carga no worker.** Muitos tenants com busca de 15 min disputam o mesmo processo. O trabalho fatiado e o limite por
    Conector seguram. Acima de ~50 tenants com busca, medir e avaliar um worker dedicado.
11. **`apps/mock-api` não simula ERP.** A premissa de que o seed tem os 5 ERPs não se confirma (§1). O simulador é escrito na F7.
