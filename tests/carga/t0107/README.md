# T-0107 — carga de 20 mil produtos e roteiro do ensaio de onboarding

Dono: agente `testes`. Frente N14 (nuvem). Nada aqui roda contra a demo (Magalu) nem contra produção: os testes sobem a própria
API numa porta local e um banco efêmero (`macuxi_teste_*`) que é apagado no fim. Sem dado pessoal real.

| Arquivo | O que é | Banco |
|---|---|---|
| `gerador.ts` | gerador determinístico da base de carga (semente fixa) e `gravarBaseCarga` | — |
| `gerador.test.ts` | prova do gerador: determinismo, volumes, árvore, códigos, LGPD, limites das colunas | não precisa |
| `carga-20mil-t0107.test.ts` | carga com HTTP real: sync inicial, busca, 100 pedidos, retorno do ERP, D-T0107a | Postgres |

---

## Parte A — a carga automatizada

### Como rodar

```bash
# local com Postgres (precisa das variáveis MACUXI_PG_*; no PC do dono do produto NÃO: lá quem roda é o CI)
pnpm test:tests carga/t0107

# com as metas de tempo valendo (job próprio, máquina sem outros testes)
MACUXI_CARGA_MEDIR=1 pnpm test:tests carga/t0107

# sem banco: o gerador.test.ts roda e o arquivo de carga pula (com aviso no fim)
MACUXI_PG_EXIGIR=0 MACUXI_PG_PORTA=1 pnpm test:tests carga/t0107
```

No CI (job de integração com o service Postgres, `MACUXI_PG_EXIGIR=1`) o arquivo roda com a suíte `pnpm test:tests`. O
tempo de parede do arquivo de carga é de ~1,5 min nesta máquina (preparo ~10 s, sync ~11 s, busca ~55 s, pedidos < 1 s,
fila ~3 s, D-T0107a ~4 s).

### O que reprova em cada modo

| Modo | Reprova |
|---|---|
| Suíte comum (padrão) | só erro FUNCIONAL: status >= 400 ou falha de rede; linha gerada que não entrou no banco (colisão escondida pelo `on conflict do nothing`); sync incompleto (aparelho com menos de 20 mil linhas de `produto`, `tabela_preco_item`, `produto_conteudo`, `produto_no`, `produto_atributo` ou de 40 mil de `estoque_saldo`; id repetido entre páginas; cliente/carteira diferente dos 100 do vendedor); busca por SKU que não acha o produto; pedido não `aceito` ou não `approved`; fila com retenção ou incompleta; Conector que não recebe os 100; retorno recusado; pedido que não chega a `integrated`; evento com falha na outbox; `/v1/saude` com 5xx. |
| `MACUXI_CARGA_MEDIR=1` | tudo acima **e** o tempo contra `METAS` (p95 de cada métrica e o ciclo da fila). |

O caso 6 é `it.fails` (defeito aberto D-T0107a, abaixo): passa enquanto o defeito existir e fica VERMELHO quando for
corrigido — aí vira `it` e o caso 3 volta aos 100 pedidos ao mesmo tempo.

### Onde ler os números

Toda métrica sai no console, SEMPRE (com ou sem `MACUXI_CARGA_MEDIR`), numa linha com o prefixo `[carga T-0107]` seguida de
um JSON `{ n, p50, p95, max, meta, ... }` (ms). No CI: log do job, procure `[carga T-0107]`.

| Linha | O que é |
|---|---|
| `preparo` | tempo de subir banco + API, gerar, gravar e `analyze` (informativo) e a impressão digital curta da base |
| `sync inicial por aparelho (ms)` | duração total do sync inicial (novidades + todas as páginas de todas as entidades) por aparelho — **meta** |
| `sync página (ms, informativo)` | latência de cada página de 1.000 linhas |
| `sync linhas por entidade (aparelho 0)` | contagem recebida por entidade |
| `busca isolada (ms, informativo; ...)` | 1 busca em voo (sem disputa de CPU) |
| `busca (ms)` | rajada com concorrência — **meta**; registra o modo (`inteligente` padrão, sem provedor de IA ⇒ `interpreted_by: regras`) |
| `pedido push (ms)` | 1 pedido por `POST /v1/sync/push` — **meta** |
| `erp pendentes GET (ms)` · `erp retorno POST (ms)` · `erp ciclo da fila (ms)` | retorno ao ERP — **metas (premissa)** |
| `D-T0107a pedidos ao mesmo tempo (ms)` | reprodução do defeito: aceitos e status das 100 respostas simultâneas |

### Metas (constante `METAS` no topo do arquivo de carga)

| Métrica | Meta (p95) | Origem |
|---|---|---|
| Sync inicial completo por aparelho | < 60.000 ms | pedido da T-0107 |
| Busca do catálogo | < 300 ms | pedido da T-0107 |
| Pedido (push de 1 pedido) | < 500 ms | pedido da T-0107 |
| `POST /integracao/v1/pedidos/{uuid}/retorno` | < 500 ms | **premissa** desta tarefa (o doc 06 não dá número) |
| `GET /integracao/v1/pedidos/pendentes?limite=50` | < 1.000 ms | **premissa** |
| Ciclo da fila dos 100 (despacho → pendentes → retornos → despacho → `integrated`) | < 60.000 ms | **premissa**; o despachante roda em ciclos seguidos (sem o intervalo de 1 s do `worker`) |

Meta não se afrouxa: número acima da meta é achado da carga e vira pendência para o dono do código.

### Números medidos (08/11/2026, Postgres 16 local da sessão de nuvem, `MACUXI_CARGA_MEDIR=1`)

| Métrica | n | p50 | p95 | max | Meta | Situação |
|---|---|---|---|---|---|---|
| Sync inicial por aparelho (5 em paralelo, 250 requisições cada) | 5 | 10.514 | 10.517 | 10.517 | 60.000 | ok |
| Página do sync (informativo) | 1.245 | 40 | 78 | 149 | — | — |
| Busca isolada (informativo) | 2 | 5.234 | 5.234 | 5.234 | — | ~17× a meta já sem concorrência |
| Busca (4 concorrentes, orçamento 30 s) | 12 | 13.573 | 20.013 | 20.013 | 300 | **estoura — D-T0107b** |
| Pedido push (5 em voo) | 100 | 26 | 85 | 122 | 500 | ok (só com concorrência < pool — D-T0107a) |
| GET pendentes | 3 | 18 | 26 | 26 | 1.000 | ok |
| POST retorno (10 em voo) | 100 | 22 | 38 | 45 | 500 | ok |
| Ciclo da fila dos 100 | 1 | — | 3.187 | — | 60.000 | ok |
| 100 pedidos AO MESMO TEMPO, pool 10 (D-T0107a) | 100 | 4.113 | 4.217 | 4.490 | 500 | **13 aceitos, 87 × 500** |

Preparo: gerar 0,8 s; gravar 233.204 linhas 7,2 s; `analyze` 0,7 s.

### Achados

- **D-T0107a — pool da API trava com pedidos simultâneos (defeito, aberto).** O push do pedido abre a transação
  (`ctx.comTenant`, `modules/vendedor/api/receber.ts` → `receberPedidos`) e, dentro dela, chama `ctx.carteira()`
  (`apps/api/src/app.ts` → `carteiraDe(token, acesso, …)`), que pede OUTRA conexão ao mesmo pool. Com pushes em voo >= pool
  (10), todas as conexões ficam "idle in transaction" esperando a 11ª: no teste sem `connectionTimeoutMillis` o arquivo
  pendurou; no servidor (`idle_in_transaction_session_timeout=60000`) o Postgres derruba as sessões em 60 s e o lote volta
  5xx (o motor do app reenvia). Reprodução determinística: caso 6. Correção provável: resolver `ctx.carteira()` ANTES de
  abrir a transação (no `receberPedidos` ou na plataforma, antes de `prov.receber`), ou ler a carteira na mesma conexão.
  Donos prováveis: `modulo-vendedor` (receber.ts) e/ou `engenheiro-software` (app.ts/sync.ts). Vale procurar o mesmo padrão
  (consulta que pega 2ª conexão dentro de `comTenant`) nos outros `receber` (visita, promotor, pesquisa).
- **D-T0107b — busca do catálogo segundos acima da meta com 20 mil produtos (tempo).** A rota `GET /v1/catalogo/busca`
  (`modules/catalogo/api/rotas.ts`) carrega o catálogo inteiro a cada requisição (`repo.produtos()` + atributos, referências,
  conteúdo, preços e saldos de todos os candidatos) e ranqueia em memória (`buscarProdutos` do domain): ~0,7 s de SQL
  (155 consultas; as maiores: saldos 40 mil linhas ~90 ms, referências 30 mil ~70 ms, atributos 40 mil ~60 ms) e ~4 s de
  CPU do Node por busca. Sendo CPU, a concorrência enfileira no event loop e atrasa as outras rotas da mesma instância.
  Caminho provável: pré-filtrar no Postgres pelo `catalogo.produto_busca.documento` (tsvector, já existe) e só então montar
  preço/estoque dos N candidatos, ou cache do vocabulário/documentos por tenant. Dono: `modulo-catalogo`.
- O sync inicial (5 aparelhos × ~233 mil linhas, 250 requisições) fica em ~11 s, folgado na meta; a página de 1.000 linhas
  tem p95 < 100 ms. Paginação com 20 mil linhas no mesmo `updated_at`: sem id repetido.

### O gerador

- `gerarBaseCarga({ tenantId, instante, senhaHash, semente?, produtos?, clientes? })` → `{ base, resumo }`. Padrão:
  `SEMENTE_PADRAO = 0x01072026`, 20.000 produtos, 300 clientes. PRNG mulberry32 (sem `Math.random`, sem relógio): a mesma
  semente gera as mesmas linhas na mesma ordem (`impressaoDigital(base)` = sha256 de tudo). Ids por `idDeChave` (independem
  do tenant); o `instante` vira `created_at`/`updated_at`; a senha chega já com hash (`hashSenha` de `@macuxi/db`).
- Volumes (padrão): produto 20.000 · produto_unidade ~21.900 · catalogo_no 158 (12 sistemas › 42 grupos › 104 linhas; produto
  sempre na folha, nível 3) · produto_no / produto_conteudo / produto_busca / tabela_preco_item 20.000 · produto_atributo
  40.000 · produto_referencia ~30.000 (0 a 3 por produto, marcas concorrentes inventadas, `codigo_compacto`) · estoque_saldo
  40.000 (2 depósitos) · 3 vendedores (`vendedorN.carga@exemplo.com.br`, 1/3 da carteira cada) · cliente / carteira /
  cliente_financeiro / cliente_tabela_preco 300 · 6 sinônimos.
- Sem dado pessoal: razão social montada de listas de palavras, CNPJ fictício com DV válido (raiz 90xxxxxx), cliente sem
  telefone e sem e-mail; e-mails só `@exemplo.com.br`. Montadoras e modelos de veículo são nomes comerciais públicos.
- Códigos prefixados para não colidir com a fixture: nós `T107-Sxx…`, depósitos `T107-MAO`/`T107-BVB`, tabela `T107-PADRAO`;
  external_id do ERP: `ERP-<sku>`, `CLI-xxxxx`, `VEND-00n` (o pedido não fica retido na fila).
- Mudar volume ou semente: passe `produtos`, `clientes` ou `semente` na chamada (o teste de carga usa o padrão). Termos de
  busca, produtos com estoque e clientes por vendedor saem no `resumo`.
- `gravarBaseCarga(admin, base)` grava em lotes de 5.000 com `json_populate_recordset(null::<tabela>, $1)` (o Postgres
  converte cada coluna pelo tipo da tabela; array JSON vira `text[]`) e `on conflict do nothing`, que torna a gravação
  repetível mas esconde colisão — por isso o teste confere as linhas gravadas por tabela contra o tamanho da base.

### Variáveis

| Variável | Padrão | Efeito |
|---|---|---|
| `MACUXI_CARGA_MEDIR` | — | `1` = metas de tempo reprovam |
| `MACUXI_CARGA_APARELHOS` | 5 | aparelhos no sync inicial |
| `MACUXI_CARGA_BUSCAS` / `_BUSCA_CONCORRENCIA` / `_BUSCA_SEGUNDOS` | 200 / 4 / 30 | alvo, concorrência e orçamento de tempo da rajada de busca (o ensaio pedido: 200 / 10 / 900) |
| `MACUXI_CARGA_PEDIDOS_CONCORRENCIA` | 5 | pushes em voo no caso 3 (>= 10 trava hoje: D-T0107a) |

### Premissas

- Tenant de teste = A da fixture dois-tenants (Conector `erp-alfa` que recebe pedidos, chave e de-para AVISTA → `001`); B é o
  vizinho (RLS). Licença `integracao` ligada em A pela rota real do Core; pepper do Hub = `PEPPER_HUB_FIXTURE` só no processo.
- Pagamento: caminho LEGADO (sem forma/prazo no payload) ⇒ a condição padrão do tenant (AVISTA, `padrao = true`); os
  clientes da carga não têm `vendedor.cliente_condicao`. Nada gravado além da base.
- Pool da API = 10 (padrão de `MACUXI_API_POOL` no servidor). Busca sem provedor de IA (servidor sem chave): modo padrão
  `inteligente` cai nas regras locais.

---

## Parte B — roteiro do ensaio de onboarding (tenant do zero até o 1º pedido integrado)

**Onde**: ambiente de ensaio (Postgres local ou banco de homologação próprio). Nunca a demo nem produção sem autorização
escrita do Alexandre. **Dados**: só fictícios — a base deste gerador exportada para os CSVs-modelo, ou o ERP de teste.
**Quem**: 1 pessoa operando (papel de implantador) + 1 anotando. **Registro**: para cada passo, hora de início/fim (relógio
de parede), contagens, erros (código + mensagem da tela), prints das telas e o `requisicao_id` de qualquer erro.

Legenda: ⏱ medir · ✔ critério de aceite do passo · ⚠ pendência/premissa (não existe hoje ou não foi conferido).

### Passo 0 — preparação
1. Ambiente no ar (API, BKO, banco migrado), versão anotada (commit). Relógio do anotador sincronizado.
2. Base fictícia pronta: produtos (20 mil), árvore, preços, estoque (2 depósitos), 300 clientes, 3 vendedores — mesmos volumes
   do gerador. ⏱ nada. ✔ arquivos conferidos sem dado pessoal real.

### Passo 1 — criar a empresa (tenant)
- Pelo comando (RN-CORE-31, desenho docs/desenho/T-0083.md): `pnpm tenant:criar --codigo <codigo> --nome "<Nome>" --modulos
  core,catalogo,vendedor,integracao --licencas vendedor=3 --fuso America/Manaus --admin-email <admin>@exemplo.com.br
  --admin-nome "<Nome>" --simular` (confere o plano), depois sem `--simular` (fora do Postgres local: `--confirmar <codigo>`).
  Senha do admin só por `MACUXI_TENANT_ADMIN_SENHA` ou digitada.
- Ou pelo portal de implantação (`config.`; docs/desenho/T-0087.md §5.1): passo Empresa, "Conferir" (`simular`) e gravar
  (`POST /v1/plataforma/empresas`; `integracao` entra sempre; alçadas e validade do orçamento como parâmetros).
- ⏱ tempo do comando/tela; JSON de saída (`resultado`, `modulos_adicionados`, `admin`, `avisos`). Rodar de novo o mesmo
  comando. ✔ `resultado: criado`, depois `sem_mudanca` (idempotente); nenhum segredo/e-mail em claro na saída.

### Passo 2 — licenças, perfis e parâmetros
- Login do admin no BKO (`POST /v1/auth/login` com o código da empresa). Conferir `GET /v1/core/licencas` e ligar o que faltar
  (`PUT /v1/core/licencas/tenant/:modulo`, `.../perfis/:perfil/:modulo`). Parâmetros de início: `GET /v1/core/parametros/inicio`.
- ⏱ tempo até a tela de licenças mostrar os módulos. ✔ os módulos contratados ativos; os perfis de campo (vendedor) com
  catálogo e vendedor; `integracao` só no tenant e nos perfis do BKO que acompanham o monitor (admin/analista).

### Passo 3 — equipe e convite de 1º acesso (T-0087, fatia E)
- `GET /v1/core/equipe/modelo.csv` → preencher os 3 vendedores (+ supervisor, se houver) → `POST /v1/core/equipe/importacoes`
  com `modo: conferir` (erros por linha) e depois `modo: gravar` com a `origem` do BKO (o link do convite `/convite/<token>` sai
  UMA vez na resposta). `GET /v1/core/equipe/convites` lista; `.../convites/:usuario_id/renovar` gera outro.
- Cada usuário abre o link e cria a senha (`POST /v1/auth/convite/aceitar`).
- ⏱ tempo da importação; tempo médio do aceite por usuário; erros por linha. ✔ convites = usuários importados; todos aceitos;
  login de cada vendedor funciona; nenhum convite reaproveitável (2º uso do link recusado).

### Passo 4 — Conector e credencial
- BKO > Integração ERP > Conectores: `POST /v1/integracao/conectores` (a chave aparece UMA vez; marcar o Conector que recebe
  pedidos; lista de IPs se o cliente tiver). Baixar o Conector e a documentação (`openapi.json` público do Hub).
- Instalar o Conector no servidor do ERP de teste, configurar as views (`db/conector/views-modelo.sql`) e ligar.
- ⏱ tempo da instalação até o 1º sinal (`POST /integracao/v1/sinal`). ✔ monitor (`GET /v1/integracao/monitor`) mostra o
  Conector com sinal recente e versão; chave errada = 401 genérico.

### Passo 5 — carga inicial (Hub ou arquivo)
- Ordem das entidades: `GET /v1/integracao/ordem-carga` (vendedor → cliente → produto → preço → … como o Hub exige).
- **Pelo Hub**: o Conector envia `POST /integracao/v1/lotes` (até 5.000 registros, `Idempotency-Key`), modo `completo`.
- **Por arquivo** (portal/BKO, sem Conector): `GET /v1/integracao/modelos/:entidade.csv` e `.../dicionario`;
  `POST /v1/integracao/cargas-arquivo/conferir` (sem gravar) → `POST /v1/integracao/cargas-arquivo` (arquivos grandes em
  partes: `cargas-arquivo/sessoes/:sessao_id`); status em `GET /v1/integracao/lotes/:id`, erros em `.../erros` e `.../erros.csv`.
- ⏱ tempo por entidade (envio → lote `concluido`), linhas aceitas × com erro, tempo total da carga. ✔ todos os lotes
  concluídos; erros por linha explicados (motivo legível); reenvio do mesmo lote não duplica (idempotência).
- ⚠ Vínculo cliente → tabela de preço: na T-0032 não havia campo/rota do ERP nem do BKO para `catalogo.cliente_tabela_preco`
  (os testes gravam direto). Conferir no ensaio se o cliente carregado tem preço na busca; sem preço = pendência do
  `modulo-catalogo`/`modulo-integracao`.

### Passo 6 — de-para da condição de pagamento
- O pedido vai ao ERP com o código do ERP da condição (`integracao.mapeamento`, tipo `condicao_pagamento`; ex.: AVISTA → 001).
- ⚠ Não há tela nem rota do BKO para o de-para hoje (o doc 06 prevê "tela no BKO para de-para"); no ensaio o mapeamento é
  gravado pelo `banco-dados` (SQL de apoio) ou o ensaio usa forma/prazo vindos do ERP (RN-VEN-24, códigos do próprio ERP).
  Registrar qual caminho foi usado. ✔ pedido de teste não fica retido com `mapeamento_ausente`.

### Passo 7 — conferência da carga
- Monitor (`GET /v1/integracao/monitor`): lotes, alertas, sinal. Reconciliação pelo Conector (`POST /integracao/v1/reconciliacoes`,
  RN-INT-07). No BKO: contagem de produtos, clientes, carteira por vendedor, tabela de preço e estoque.
- ⏱ tempo da conferência. ✔ contagens do ERP = contagens do Macuxi por entidade (20.000 produtos, 300 clientes, 100 por
  vendedor, 40.000 saldos); nenhum alerta aberto sem explicação.

### Passo 8 — login no app Campo e sync inicial
- Aparelho Android real (o roteiro de aparelho é manual), Wi-Fi e depois 4G. Login do vendedor 1 com o código da empresa;
  tela de carga (primeiro acesso) até o catálogo pronto.
- ⏱ tempo do login até a tela inicial com o catálogo (meta da carga automatizada: 60 s por aparelho; anotar rede, modelo do
  aparelho e espaço usado); contagens no app (clientes = 100, produtos = 20.000). ✔ sem erro na carga; só a carteira do vendedor
  aparece; reabrir o app não refaz a carga inteira.

### Passo 9 — busca no catálogo
- Buscar por SKU, por código de referência do concorrente e por "item + modelo" (ex.: "amortecedor Gol 1.0"), com o cliente
  escolhido; repetir offline.
- ⏱ tempo até a lista (online e offline). ✔ o produto do SKU aparece primeiro; preço da tabela do cliente; estoque por depósito.
  ⚠ Online, hoje a busca do servidor leva segundos com 20 mil produtos (D-T0107b): anotar o tempo, não afrouxar a meta.

### Passo 10 — 1º pedido
- Pedido com 2 itens para um cliente da carteira, sem desconto (dentro da alçada), enviar.
- ⏱ tempo do "Enviar" até "aprovado" no app. ✔ status aprovado, número do pedido, total do servidor = total do app; o pedido
  aparece no BKO (`/v1/vendedor/pedidos`).

### Passo 11 — retorno do ERP
- O Conector lê `GET /integracao/v1/pedidos/pendentes` (poll de 1–2 min), grava no ERP e devolve
  `POST /integracao/v1/pedidos/{uuid}/retorno` com `status: integrado` e o `numero_erp`; depois o faturamento.
- ⏱ tempo do aprovado até `integrated` no BKO e no app (próximo sync). ✔ o número do ERP aparece no pedido; o retorno repetido
  é idempotente; a condição foi para o ERP com o código certo.

### Critério de aceite do ensaio
1. Todos os passos com ✔ cumprido, sem erro bloqueante e sem intervenção no banco além das ⚠ registradas.
2. Tempos anotados por passo e o tempo total de relógio do Passo 1 ao 1º pedido `integrated`. ⚠ A meta do tempo total de
   onboarding não está definida em docs/produto: proposta para o gerente/Alexandre decidir — ensaio de ponta a ponta em até
   1 dia útil, com a carga inicial (Passo 5) em até 1 h para os volumes deste gerador.
3. Toda pendência (⚠) e todo erro viram recado ao dono do arquivo, com passos para reproduzir.
