# Carga por arquivo (RF-INT-03)

Para quem não tem Conector instalado (ou quer carregar uma planilha avulsa), o BKO recebe um **CSV** e o transforma no **mesmo lote** que o Conector enviaria. Nada de regra nova: o arquivo passa pelo pipeline do Hub (`hub-api.md` §7), com validação por linha, `concluido_com_erros` (RN-INT-01), trava de inativação (RN-INT-06), `Idempotency-Key` (RN-INT-12) e topologia por Conector (RN-INT-13).

Fora desta entrega (backlog): Excel nativo (`.xlsx`), SFTP, arquivo com mais de 5.000 linhas dividido em partes da mesma sessão, listas dentro de uma linha (`contatos`, `paradas`) e a tela de envio no BKO (T-0051 trava `modules/integracao/web`).

## 1. Formato do arquivo

- **CSV UTF-8**, com ou sem BOM. Excel: *Salvar como → CSV UTF-8 (delimitado por vírgulas)* ou *CSV (separado por ponto e vírgula)*.
- **Separador** `;` ou `,`, detectado no cabeçalho (sem nenhum dos dois vale `;`). Texto com separador ou quebra de linha vai entre aspas duplas (`"Silva; Souza"`, `""` escapa aspas).
- **Cabeçalho** na linha 1 = nomes dos campos do contrato canônico da entidade (`contracts/entidades.ts`), sem diferenciar maiúsculas. Campo aninhado com ponto: `endereco.cidade`. Coluna fora do contrato, repetida ou de lista recusa o arquivo inteiro com a lista das colunas aceitas; coluna obrigatória ausente também.
- **Célula vazia = campo ausente.** `alterado_em` pode ficar de fora (ou vazio): vale o instante do envio. Quando vier, é ISO 8601 UTC (`2026-10-31T14:00:00Z`).
- **Tipos**: texto como está; número com `.` ou `,` decimal (dinheiro em **centavos inteiros**, `_cents`); **sem separador de milhar**: um número com `.` ou `,` seguido de exatamente 3 dígitos ("1.500", "1,500") é ambíguo (milhar ou decimal) e a linha é recusada com mensagem clara (`tipo_invalido`) — escreva 1500 ou 1,5; booleano `sim|não|true|false|1|0|s|n`; datas `AAAA-MM-DD`; UF e unidade são normalizadas pelo contrato.
- Linhas em branco e linhas só de separadores (sobra do Excel) são ignoradas; a numeração dos erros é a **linha física do arquivo** (cabeçalho = 1).

| Entidade | Obrigatórias | Opcionais (além de `alterado_em` e `ativo`) |
|---|---|---|
| `vendedor` | external_id, nome | email, telefone |
| `cliente` | external_id, razao_social | prazo_medio_max_dias, formas_pagamento (códigos separados por barra: `PIX/BOLETO`), nome_fantasia, documento, vendedor_external_id, endereco.{logradouro, numero, complemento, bairro, cidade, uf, cep}, latitude, longitude, telefone, email, limite_credito_cents, inscricao_estadual, observacao, bloqueado (`contatos`: só pelo Conector) |
| `produto` | external_id, sku, nome, unidade | ean, marca, categoria, catalogo_no_external_id, custo_cents, preco_venda_cents, desconto_maximo_pct |
| `preco` | external_id, tabela_external_id, tabela_nome, vigencia_inicio, produto_external_id, preco_cents | vigencia_fim, unidade |
| `estoque` | external_id, deposito_external_id, produto_external_id, saldo | deposito_nome |
| `titulo` | external_id, cliente_external_id, numero, vencimento, valor_cents, saldo_cents, situacao | parcela, emissao, baixado_em |
| `nota` | external_id, cliente_external_id, tipo, numero, emitida_em, total_cents | vendedor_external_id, serie, quantidade_itens, pedido_uuid, cancelada |
| `rota` | external_id, nome, vendedor_external_id | dia_semana (`paradas`: só pelo Conector) |
| `catalogo_no` | external_id, codigo, nome, nivel | pai_external_id, ordem |
| `produto_unidade` | external_id, produto_external_id, unidade, fator | ean, padrao |
| `cliente_endereco` | external_id, cliente_external_id, logradouro, cidade, uf | tipo, descricao, numero, complemento, bairro, cep, latitude, longitude, principal |
| `transportadora` | external_id, nome | documento, inscricao_estadual, telefone |
| `forma_pagamento` | external_id, codigo, nome | ordem |
| `prazo_pagamento` | external_id, forma_external_id, codigo, parcelas_dias (dias separados por barra: `28/56`; `0` = à vista, sem decrescer) | descricao, prazo_medio_dias (informativo; o Macuxi calcula), ordem |
| `tabela_escalonada` | external_id, produto_external_id, quantidade_minima, preco_unidade_cents, vigencia_inicio | medida (ausente = unidade base), vigencia_fim, tabela_external_id (ausente = todas as tabelas), filial_external_id (ausente = todas as filiais) |
| `filial` (T-0149) | external_id, codigo, nome | cidade, uf |

Ordem única da carga (`ORDEM_CARGA_ENTIDADES`, RN-INT-04; regras de 15/11/2026 em `hub-api.md` §21): filial, vendedor, catalogo_no, forma_pagamento, prazo_pagamento, produto, produto_unidade, preco, tabela_escalonada, estoque, cliente, cliente_endereco, transportadora, rota, titulo, nota. A entidade `filial` é a primeira. `cliente`, `preco` e `estoque` também aceitam a coluna opcional `filial_external_id` (vazia: `cliente` não altera; `preco` e `estoque` usam a filial padrão).

Exemplo (`transportadora`):
```
external_id;nome;documento
TRP-01;Rápido Norte;12345678000199
TRP-02;"Boa Vista; Cargas";
```

## 2. Passo a passo

1. **Uma vez, por empresa** (admin, `conector.gerenciar`): em Integração ERP > Conectores, cadastre um Conector do tipo **arquivo**, **desmarque "recebe pedidos"** e informe só as entidades que serão carregadas por arquivo. Na v1 cada entidade vem de um único Conector por empresa (RN-INT-13): uma entidade que o Conector do ERP já recebe não pode ser carregada por arquivo (a API recusa dizendo qual Conector a recebe) — tire-a da lista dele antes.
2. **Ordem de carga**: a mesma do Hub (`vendedor` → `cliente` → `produto` → `preco`/`estoque`…). Cada arquivo é uma entidade; referência a registro que ainda não existe vira erro `referencia_ausente` na linha, reprocessável.
3. **Enviar** (admin ou analista): `POST /v1/integracao/cargas-arquivo` (ação `carga.arquivo`) com `entidade`, `modo` (`delta`, padrão, ou `completo`), `conteudo` (o texto do CSV), `chave_idempotencia` e, se houver mais de um Conector arquivo para a entidade, `conector_id`. Resposta **202** com `lote_id` e `consulta`.
4. **Acompanhar**: `GET /v1/integracao/lotes/{lote_id}` (contagens, status, inativação) e `GET /v1/integracao/lotes/{lote_id}/erros` (por linha, paginado, filtro por `codigo`; é a gaveta de erros do monitor). O lote é aplicado em segundo plano (alguns segundos).
5. **Corrigir e reenviar**: cada erro diz *"Linha 12 do arquivo: …"*, o campo e o `external_id`. Corrija a planilha e envie de novo **com outra chave**. O que já entrou e não mudou conta como "inalterada" (hash do conteúdo, RN-INT-02), então reenviar o arquivo inteiro é seguro.
6. **Carga completa** (`modo: completo`): o arquivo é a lista inteira da entidade; o que sumiu dele é inativado. Registro que veio **inválido** no arquivo **nunca** é inativado (RN-INT-06) e, se mais de 30% dos ativos sairiam, nada é inativado: aparece em Inativações para confirmação de admin ou analista (vale 7 dias). Linha sem `external_id` legível impede a inativação da carga.

## 3. Resposta e erros

`POST /v1/integracao/cargas-arquivo` — perfil admin ou analista (a plataforma devolve 403 aos outros e quando o módulo não está licenciado; o handler repete a conferência de perfil).

| Status | Quando |
|---|---|
| **202** | Lote recebido. Corpo: `lote_id`, `status: recebido`, `entidade`, `modo`, `recebidos`, `conector_id`, `linhas_lidas`, `linhas_invalidas_leitura`, `consulta`; `repetido: true` quando é a repetição da mesma chave e conteúdo (o mesmo `lote_id`, nenhum lote novo, nenhum evento novo). |
| **409** `chave_idempotencia_reutilizada` | Mesma chave, conteúdo diferente (RN-INT-12). |
| **422** | `chave_idempotencia_invalida` (obrigatória, 16–128 caracteres seguros); `entidade_desconhecida`; `modo_invalido`; `arquivo_vazio`; `csv_invalido` (aspas abertas, diz a linha); `colunas_desconhecidas`; `colunas_repetidas`; `coluna_nao_suportada`; `colunas_obrigatorias_ausentes`; `lote_vazio` (só cabeçalho); **RN-INT-13**: `sem_conector_arquivo`, `entidade_de_outro_conector` (diz qual Conector a recebe), `conector_nao_e_arquivo`, `conector_ambiguo`. Todas com mensagem em português e a ação seguinte. |
| **422** + `detalhes.limite: true` | `acima_do_limite` (linhas acima do limite do lote, 5.000 por padrão, parâmetro `limiteRegistrosLote` do tenant) e `corpo_grande` (bytes acima de `limiteCorpoLoteBytes`, 8 MiB). O SDK de módulo não emite 413: o corpo acima de 1 MiB já é barrado pela plataforma (Fastify) com 413. |
| **404** `CONECTOR_NAO_ENCONTRADO` | `conector_id` que não existe (ou é de outra empresa). |
| 401 / 403 | Sem login; perfil sem a ação `carga.arquivo`; módulo Integração não licenciado (plataforma). |

**Linhas com erro**: valor que não converte (número, booleano) ou linha com colunas a mais viram `linhas_invalidas` do lote (origem `conector`). Valor que não converte guarda o `external_id` da linha (protege o registro da inativação na carga completa); linha com **colunas a mais** fica com `external_id` nulo (as células andam e o id lido seria outro pedaço do texto), e a carga completa que a contém não inativa nada (`linhas_sem_external_id`, RN-INT-06); o resto é validado pelo Hub linha a linha (formato, faixa, obrigatório, referência). Todas ganham o prefixo *"Linha N do arquivo:"* com a linha física. As mensagens citam só a linha, o campo e o tipo esperado — **nunca o valor digitado** (dado pessoal).

**`chave_idempotencia`**: a rota de usuário não expõe cabeçalhos, então a `Idempotency-Key` (RN-INT-12) vai no corpo, com a mesma regra do `POST /lotes`. Mesmo arquivo reenviado com a mesma chave devolve a mesma resposta (BOM, CRLF e linhas em branco no fim não contam como diferença); arquivo novo, chave nova. A tela de envio deve gerar um UUID por tentativa e reutilizá-lo no "tentar de novo".

## 4. Como funciona por dentro

```
BKO ── POST cargas-arquivo ──► autorizarAcaoIntegracao ─► validarChaveIdempotencia ─► converterCsvParaLote (domain/carga-arquivo.ts)
                                  └► validarEnvelope (o MESMO do Hub) ─► resolverConectorDoArquivo (RN-INT-13)
                                       └► gravarLote (o MESMO do POST /lotes: idempotência, sessão, lote, lote_staging, lote.recebido@1)
outbox ──► aplicarLote (A7, o mesmo) ──► validação por linha, upsert, integracao.<entidade>.atualizado@1, cursor, inativação/pendência
```
- O lote é do **Conector tipo arquivo**: cursor, reconciliação e inativação são por (Conector, entidade). O Conector do ERP do mesmo tenant não o enxerga pelo Hub.
- Carga completa = sessão de **uma parte** (`ultimo: true`) cujo UUID deriva da chave de idempotência (arquivo igual com chave nova é outra sessão e inativa de novo).
- O staging do lote leva `origem: 'arquivo'` e `linhas_arquivo` (linha física de cada registro, em paralelo a `registros`); `aplicar-lote.ts` usa o mapa para anotar erros e avisos do Hub (`anotarLinhaDoArquivo`).
- Auditoria (`carga.arquivo`) guarda só ids, entidade, modo e contagens; log idem. O conteúdo do arquivo fica apenas no staging, como o de qualquer lote.

## 4b. Modelos de arquivo e dicionário (N1)

- Rotas (`api/bko-modelos.ts`, sem leitura de banco):
  - `GET /v1/integracao/modelos/:entidade.csv`: `text/csv; charset=utf-8`, baixa como `<entidade>.csv`.
  - `GET /v1/integracao/modelos/:entidade/dicionario`: JSON `DicionarioModelo` (campo, obrigatório, tipo, tamanho máximo, formato, exemplo).
  - Entidade desconhecida: 404 `ENTIDADE_DESCONHECIDA`.
- **Acesso (T-0100)**: quem tem a ação `carga.arquivo` no motor de permissões (ADR 0033) baixa o modelo e o dicionário e envia a carga. De fábrica são o admin e o analista da empresa (mesma ação do `POST cargas-arquivo`); o admin ajusta por perfil na página Perfis de acesso. O super-admin da plataforma continua aceito (`superAdmin: 'aceita'`).
  - As rotas declaram `acao: 'carga.arquivo'` (sem perfil fixo no código nem recusa no handler). Ordem das checagens: licença do módulo (403 `MODULO_INATIVO`), motor de permissões (403 `PERFIL_SEM_ACESSO` para vendedor, promotor, supervisor, gerente, assistente e perfis sem a chave), handler.
  - Multi-tenant: o modelo é igual para todas as empresas (nada do tenant entra no arquivo) e a carga grava sempre no tenant do token; a tela nunca envia nem escolhe empresa.
  - Tela: BKO > Integração ERP > **Carga por arquivo** (`web/components/carga-arquivo-page.tsx`): tabela das 15 bases na ordem de carga com "Modelo" e "Dicionário" (CSV, com `protegerFormula`), escolha de base e modo (delta ou completo), arquivo `.csv` até 25 MB dividido no navegador em partes da mesma sessão (RN-INT-06) com uma chave de idempotência por arquivo (RN-INT-12). O resultado e os erros por linha ficam em Integração ERP > Lotes.
- Conteúdo (`domain/modelos-csv.ts`, gerado de `SCHEMA_REGISTRO`; tipos em `contracts/modelos.ts`):
  - 15 entidades; `;`, UTF-8 com BOM, CRLF; duas linhas de exemplo válidas.
  - Colunas: obrigatórios primeiro, na ordem do contrato; depois os opcionais (`alterado_em`, `ativo`).
  - Listas em célula, itens separados por `/`: `parcelas_dias` (`30/60/90`) e `formas_pagamento` (`PIX/BOLETO`). `contatos`, `paradas`, `referencias` e `oferece_junto` ficam de fora.
  - Todo modelo passa no mesmo parser da carga (`converterCsvParaLote`) e na validação por linha do Hub.
- Ordem dos modelos: a de `ordemDeCargaDoPortal()` (`ENTIDADES_ORDEM_CARGA`, `RESUMO_MODELOS`); não há segunda lista.

## 5. Premissas e backlog

- Premissas: CSV UTF-8; cabeçalho = campos do contrato; Excel = "salvar como CSV"; 1 arquivo = 1 entidade = 1 lote (≤ 5.000 linhas) = 1 sessão; Conector tipo arquivo cadastrado pelo admin.
- Backlog: `.xlsx` nativo; SFTP; arquivo > 5.000 linhas dividido automaticamente em partes da mesma sessão; colunas de lista (`contatos`, `paradas`) por arquivo auxiliar; `Idempotency-Key` como cabeçalho quando o SDK expuser cabeçalhos às rotas de módulo; 413 verdadeiro (inclusão de 413 em `STATUS_ERRO_MODULO`); corpo de rota maior que 1 MiB (`bodyLimit` por rota no `apps/api`) para arquivos grandes.
