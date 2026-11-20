# Investigação da busca: aviso da "busca inteligente" e "BAP amortecedor palio" (R-20261120-193511)

Investigação só de leitura, de 20/11/2026, das 19h40 às 20h25 de Manaus. As provas vêm do código no `main` (9776251), do `GET /v1/saude` público de produção, consultado
às 19h37 de Manaus, e de uma reprodução local com produtos de teste.

## Resumo para o Alexandre
1. **Não existe busca inteligente na produção.** O servidor de produção não tem provedor de IA configurado. O aviso amarelo saiu
   porque o **app** recebeu um erro da API na busca e passou para a busca do aparelho. O texto da tela culpa a IA, mas a causa é
   outra. A causa mais provável, provada no código, é o botão **"Mostrar mais"**: no terceiro toque o app pede 60 itens, e a
   API aceita no máximo 50.
2. **O EcoSport apareceu porque nenhum amortecedor BAP casou com a palavra "palio".** "BAP" vira filtro de marca, e sobram
   "amortecedor" e "palio". Quando ninguém casa com as duas, a regra R-20261120-103142 mostra os mais próximos. O EcoSport casa
   com "amortecedor". As duas causas prováveis são o amortecedor BAP do Palio estar sem aplicação gravada (um dos 34 produtos
   da outbox parada) ou não existir no cadastro. O §4 decide.
3. **Regra pedida** ("só o BAP do Palio"): o código já cumpre se a aplicação do Palio estiver gravada e o app estiver na
   v1.0.17 (C1). **Falta decidir (§3):** quando nada casa com todas as palavras, mostrar os mais próximos ou a lista vazia?

## 1. O aviso "A busca inteligente está indisponível agora…"
### 1.1 O que a busca online chama
- **Rota:** `GET /v1/catalogo/busca` (`modules/catalogo/api/rotas.ts:269-312`).
- **LLM:** uma porta HTTP genérica (`api/ia/provedor-http.ts`). Ela é ligada por `portaIaDoAmbiente`
  (`api/index.ts:26-31`), que lê só os **nomes** abaixo.
  - `MACUXI_CATALOGO_IA_URL`: sem ela, não há porta.
  - `MACUXI_CATALOGO_IA_CHAVE`: opcional; vai como `Authorization: Bearer`.
- **pgvector / embeddings:** só a interface `PortaEmbeddings` existe (`domain/ia.ts:32-35`). Nenhuma implementação está
  ligada na busca, e nenhuma rota chama banco vetorial.
- **Sem a URL:** a porta fica nula e a busca usa só as regras locais, **sem aviso** (`domain/ia.ts:149`, `semChamar(null)`;
  `docs/modulos/catalogo/ponta-a-ponta.md:25`).

### 1.2 O que está na produção
- `MACUXI_CATALOGO_IA_URL` não aparece em nenhum workflow nem script de deploy. O `producao-publicar.yml` grava só banco, S3,
  SMTP, recados, push e alerta. **Conclusão:** em produção, a API nunca chama LLM e nunca devolve esse aviso.
- O `GET /v1/saude` público não diz se há provedor de IA. Às 19h37 de Manaus ele mostrou:
  - versão `v1.0.17`, banco `ok` e `OUTBOX_PARADA` com 36 parados;
  - na janela de 15 min (19h22–19h37), **0 erros 5xx e 19 erros 4xx**.

### 1.3 De onde veio o aviso
O aviso foi montado pelo **app**, não pela API (`modules/catalogo/app/telas/catalogo.tsx:172-180`). Quando a chamada à rota da
busca lança um erro:
- erro de sem conexão (inclui o tempo limite de 12 s do cliente HTTP, `apps/mobile/src/services/api.ts:119-134`) → aviso
  "volta quando houver internet";
- **qualquer outro erro (HTTP 4xx/5xx)** → `AVISO_BUSCA_FALHOU` e busca no aparelho.

Causas prováveis, da mais para a menos provável:

| # | Causa | Prova | Certeza |
|---|---|---|---|
| A1 | **"Mostrar mais" passa do limite da API.** O app soma 20 por toque (`limit: limite`, `catalogo.tsx:174` e `:301`; `PAGINA_DA_BUSCA = 20`). O contrato aceita `limit` até **50** (`contracts/busca.ts:208`). No 3º toque o app pede 60, a API devolve **400 VALIDACAO** e o app mostra o aviso e cai para o aparelho. Busca curta como "Bap" traz muitos itens, e o vendedor chega ao 3º toque. | Código; compatível com 4xx > 0 e 5xx = 0 na janela | Alta (defeito certo; ser a causa do print depende de ter tocado 2× em "Mostrar mais") |
| A2 | **Usuário sem filial de venda** → 403 `USUARIO_SEM_FILIAL` (`api/rotas.ts:181-182`). | Código | Média-baixa (pegaria toda busca online desse usuário) |
| A3 | Sessão vencida ou licença (401/403), ou outro 4xx da plataforma. | Código | Baixa |
| A4 | Serviço de IA fora, chave ausente ou tempo esgotado do LLM. | Não há LLM em produção (§1.2) | Descartada |
| A5 | 5xx da API. | 0 erros 5xx na janela do `/v1/saude` | Improvável |

**Como confirmar sem credencial nova:** no log do servidor, procurar uma requisição `GET /v1/catalogo/busca` com status 4xx
perto das 23h32 UTC (19h32 de Manaus). O status e o `limit` da query dizem qual das causas foi. O registro `catalogo.busca`
**não** aparece nas buscas que falharam.

**Hora do print:** o aparelho mostra 20h32, e o pedido chegou às ~19h35 de Manaus. 20h32 de Brasília (UTC−3) é 19h32 de
Manaus: o relógio do aparelho estava **no fuso de Brasília**, não errado.

## 2. "BAP amortecedor palio" mostrou o amortecedor do EcoSport
### 2.1 Como a busca lê a frase
`interpretarConsulta` reconhece "BAP" como marca cadastrada e a transforma em **filtro de marca obrigatório**: produto de outra
marca não entra (`domain/ranking.ts:524`). Sobram 2 palavras, "amortecedor" e "palio". A regra R-20261120-103142
(`domain/ranking.ts:613-617`, entrou na v1.0.17 pelo #550) funciona assim:
- se algum produto casa com as 2 palavras, só ele aparece;
- se ninguém casa, aparecem os que casam com mais palavras.

A busca do aparelho (`app/lib/local.ts:487-497`) usa a **mesma** função `buscarProdutos` depois da pré-seleção FTS5.

### 2.2 Reprodução local (função do domínio, com e sem a pré-seleção do índice; resultados iguais)
Produtos de teste, todos BAP, menos o Cofap:

| Cenário | O que tem no catálogo | O que a busca mostra |
|---|---|---|
| C1 | BAP amortecedor com aplicação "FIAT - Palio", BAP amortecedor EcoSport (AMT7255), Cofap amortecedor Palio, BAP pastilha Palio | **só o BAP amortecedor do Palio** |
| C2 | igual ao C1, mas o BAP amortecedor do Palio **sem aplicação gravada** | BAP amortecedor do Palio, **EcoSport embaixo** e a pastilha Palio (todos casam com 1 das 2 palavras) |
| C3 | sem BAP amortecedor do Palio | **EcoSport** e a pastilha Palio |

O Cofap nunca aparece: o filtro de marca funciona. Testes existentes verdes na sessão: `domain/busca-dinamica`,
`app/busca-produtos-aparelho`, `domain/aplicacao-busca` e `domain/ia` (4 arquivos, 67 testes).

### 2.3 Hipóteses
| # | Hipótese | Veredito |
|---|---|---|
| H1 | Não há amortecedor BAP com aplicação Palio no catálogo da AM2808, e a regra dos mais próximos trouxe o EcoSport | **Possível.** É o C3. |
| H2 | O amortecedor BAP do Palio está entre os 34 produtos da outbox parada desde 15/11, sem aplicação gravada | **Mais provável.** O C2 reproduz exatamente o que o Alexandre descreveu: o do Palio aparece, mas o EcoSport vem embaixo. Nesses 34 produtos, a aplicação não foi gravada (`modules/integracao/docs/outbox-parada-am2808-catalogo.md`, §5). Produto novo fica sem aplicação; produto antigo fica com a aplicação de antes de 15/11. A palavra "palio" só casa se estiver no nome. |
| H3 | O app do teste não é a v1.0.17 | **Não descartada.** Antes do #550, quem casava só em parte também aparecia, abaixo de quem casava tudo. Isso daria o mesmo print mesmo com a aplicação gravada. A versão está no app, em Menu › Sobre. O servidor está na v1.0.17, mas, com o aviso na tela, a lista veio do aparelho e vale a regra da versão do app. |
| H4 | Defeito na busca do aparelho (FTS5) com marca, texto e aplicação | **Sem evidência.** Mesmo domínio e mesmo resultado com e sem índice (§2.1 e §2.2); testes do aparelho verdes. |

## 3. Regra pedida e o que falta decidir
- **Decisão pendente do Alexandre:** quando nenhum produto casa com todas as palavras, a busca mostra os mais próximos (hoje)
  ou a lista vazia? Com lista vazia, o C2 e o C3 não mostrariam nada até a aplicação ser gravada.

## 4. Consulta só de leitura (amortecedores BAP para Palio no cadastro e no ERP)
Ela roda no papel `macuxi_leitura`, em transação só de leitura, com o tenant da AM2808 escolhido como no
`producao-diagnostico-outbox.yml` (`set_config('app.tenant_id', …)` via `plataforma.tenant_por_codigo`). Nenhuma coluna tem
dado pessoal: só produto, código e aplicação.

```sql
begin transaction read only;
-- a) cadastro vivo: amortecedores BAP e se a aplicação gravada cita o Palio
select pb.sku, pb.nome, pb.marca, pb.ativo,
       catalogo.sem_acento(lower(coalesce(pc.aplicacoes, ''))) like '%palio%' as aplicacao_cita_palio,
       catalogo.sem_acento(lower(pb.nome)) like '%palio%'                       as nome_cita_palio,
       pc.aplicacoes is null or btrim(pc.aplicacoes) = ''                        as sem_aplicacao,
       pb.updated_at
  from catalogo.produto_busca pb
  left join catalogo.produto_conteudo pc
         on pc.tenant_id = pb.tenant_id and pc.produto_id = pb.produto_id and pc.deleted_at is null
 where pb.deleted_at is null
   and catalogo.sem_acento(lower(coalesce(pb.marca, ''))) = 'bap'
   and catalogo.sem_acento(lower(pb.nome)) like '%amortecedor%'
 order by aplicacao_cita_palio desc, nome_cita_palio desc, pb.sku;

-- b) eventos parados do ERP: algum produto parado é amortecedor com Palio na aplicação enviada pelo ERP?
select e.ocorrido_em, e.tentativas,
       e.payload->>'external_id'                  as external_id,
       e.payload->'registro'->>'sku'              as sku,
       e.payload->'registro'->>'nome'             as nome,
       (e.payload->'registro'->>'aplicacao') ilike '%palio%' as aplicacao_erp_cita_palio
  from plataforma.evento e
 where e.publicado_em is null
   and e.nome like 'integracao.produto.atualizado@%'
   and (e.payload->'registro'->>'nome') ilike '%amortecedor%'
 order by e.ocorrido_em;
rollback;
```
- Se (a) não devolve nenhum BAP com Palio e (b) também não, vale a **H1**: o produto não existe na nuvem nem chegou. Aí é
  preciso conferir no ERP da AM2808 se existe e se é enviado.
- Se (b) devolve o amortecedor com `aplicacao_erp_cita_palio = true`, vale a **H2**.
- **Cabe no PR #560?** A parte (b) cabe: é o mesmo papel, a mesma tabela (`plataforma.evento`) e o mesmo bloco "Produtos
  parados" do §6 do relatório da outbox. Basta uma coluna a mais, `aplicacao_erp_cita_palio`, e o nome do produto que ele já
  lista. A parte (a) lê o schema `catalogo` e foge do diagnóstico da outbox. Ela pode entrar no mesmo workflow como um bloco
  à parte, mas isso amplia o escopo e precisa da frase do Alexandre (a mudança em `.github/` é do engenheiro-software).
  Premissa: os caminhos `payload->'registro'` seguem o §6 do relatório da outbox; o PR #560 não foi lido nesta sessão.

## 5. Impactos estimados (tempo de sessão, já com 15% de folga)
| Item | O que muda | Quem | Estimativa |
|---|---|---|---|
| Tirar o aviso da busca inteligente | O app cai para a busca do aparelho sem aviso (`catalogo.tsx:179`). A API deixa de mandar `notice` na degradação (`domain/ia.ts:156` e `:160`, `api/rotas.ts:223`). A constante `AVISO_BUSCA_FALHOU` sai, e os testes de `domain/ia`, rotas e tela são ajustados. | modulo-catalogo, testes, corretor | **~2h25** (1h20 de código e testes, 25 min do testes e 20 min do corretor = 2h05, mais 15%) |
| A1: "Mostrar mais" acima de 50 | O app passa a paginar com `offset` (ou limita o `limit` a 50), com teste de valor × regra no 3º toque. | modulo-catalogo, testes | **~1h25** |
| H2: outbox parada | Opção C do relatório da outbox (código único do nó) e o reprocessamento com o "sim" do Alexandre. | modulo-integracao, banco-dados | Ver o §7 daquele relatório; nada novo do Catálogo |
| H1: produto inexistente | Cadastro no ERP do cliente e nova carga. | cliente / modulo-integracao | ~0 de código |
| H3: app antigo | Instalar a v1.0.17 no aparelho do teste. | Alexandre | ~0 de código |
| Decisão "nenhum casa = lista vazia" (se for a escolha) | `domain/ranking.ts:613-617`, mais os testes da regra dos mais próximos (5 arquivos citam R-20261120-103142) e o texto da lista vazia. | modulo-catalogo, testes, corretor | **~1h45** |

A correção só começa depois da decisão de versão do Alexandre.
