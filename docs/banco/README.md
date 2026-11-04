# Banco de dados — como subir, testar e derrubar

Dono: `banco-dados`. Pacote `@macuxi/db` em `db/`. Postgres 16 + pgvector via Docker Desktop
(imagem `pgvector/pgvector:pg16`, a mesma do CI — T-0005).

> **Situação em 2026-10-31:** Docker Desktop instalado (motor 29.9.2). Migrações up/down/up, seed
> Fase M, fixture dois-tenants e a suíte inteira de `db/testes/` rodam no container `macuxi-postgres`
> (74 testes, 0 pulados). Medição do sync em [desempenho-sync.md](desempenho-sync.md).
> SQLite do aparelho (esquema local, FTS5 do Catálogo, limpeza RN-CORE-02/15 e medições da T-0008):
> [aparelho-sqlite.md](aparelho-sqlite.md).
> **2026-11-01 (T-0029):** migrações até a `0009` (0008 preço do Catálogo, 0009 pedido completo do Vendedor); suíte de
> `db/testes/` com 300 casos, 0 pulados. Dicionários: [plataforma.md](plataforma.md), [core.md](core.md),
> [catalogo.md](catalogo.md), [vendedor.md](vendedor.md).
> **2026-11-01 (T-0032):** `0010_integracao` (schema `integracao` do Hub: 17 tabelas, `autenticar_chave`, `expurgar_retencao`)
> e `0011_plataforma_outbox_retencao` (expurgo da outbox + comentário de legado em `tenant_modulo.parametros`); dicionário
> [integracao.md](integracao.md); fixture com Conector, chave (HMAC com `PEPPER_HUB_FIXTURE`) e linhas de A e B em toda tabela nova.
> **2026-11-02 (T-0055, nuvem):** `0014_gestor` (schema `gestor`: `evento_aplicado`, `projecao_fato`, `alerta`, `alerta_regra`;
> retenção pela API sob RLS, sem função SECURITY DEFINER); dicionário [gestor.md](gestor.md); fixture com linhas de A e B nas 4 tabelas;
> seed da demo do Gestor em `db/seeds/demo/gestor.ts` (licença + projeção). **Depende da `0013` (Catálogo) na pasta** (o
> executor recusa buraco na numeração).
> **2026-11-02 (T-0056):** `0015_promotor` (schema `promotor`: 9 cadastros de trade e 11 coletas com payload jsonb + colunas
> derivadas por gatilho, FK composta coleta → visita de loja, sem DELETE); dicionário [promotor.md](promotor.md); seed da demo em
> `db/seeds/demo/promotor.ts` (`gravarDemoPromotor`) e fixture em `db/seeds/fixtures/promotor.ts` (ids nos grupos 0x84–0x97; o Gestor usa 0x70–0x73).
> **2026-11-02 (T-0057, nuvem):** `0016_pesquisa` (schema `pesquisa`: questionário, versões, respostas, itens e fotos;
> RN-PES-01 e RF-PES-04 no banco); dicionário, consultas do repositório SQL e passos de integração em [pesquisa.md](pesquisa.md);
> seed demo da Pesquisa em `db/seeds/demo/pesquisa.ts` (ligar no `carregarDemo`, ver pesquisa.md).
> **2026-11-02 (T-0058):** `0017_treinamento` (schema `treinamento`: 14 tabelas — conteúdo, publicação, progresso, tentativas,
> XP, medalhas e desafio de vendas); dicionário [treinamento.md](treinamento.md); fixture própria (`db/testes/fixture-treinamento.ts`,
> carregada pelo globalSetup, ids nos grupos 0x170–0x17d) e seed da demo `db/seeds/demo/treinamento.ts` (licença do módulo na demo;
> ligar no `carregarDemo`, ver treinamento.md).
> **2026-11-02 (T-0063, nuvem):** `0018_medidas` (`core.medida` com lista inicial em todo tenant, FKs compostas de
> `produto.unidade`/`embalagem_medida` e `produto_unidade.unidade`, item do pedido com `medida`/`quantidade_embalagem`/
> `quantidade_unidades` derivados de `unidade`/`fator`/`quantidade` por gatilho que sempre sobrescreve + CHECKs; embalagem do
> produto de 2 a 9999; sigla fora do formato em produto aborta com tenant e sigla, em item antigo vira medida nula); dicionário em [core.md](core.md) e [vendedor.md](vendedor.md); seed da demo em
> `db/seeds/demo/medidas.ts` (`gravarDemoMedidas`, ligado no `carregarDemo` na T-0070). **Depende da `0016` e da `0017` na pasta** (o executor recusa buraco).
> **2026-11-03 (T-0066 e T-0065):** `0019_core_nota_erp_meta_tipo` (aditiva: `core.nota_erp` — notas de faturamento/devolução do ERP,
> base idempotente do recálculo de `historico_compra`, fora do pull, único vivo por `external_id` e índices por cliente/mês e por mês —
> e `core.meta.tipo` `pedido | faturamento`, padrão `pedido`, RN-CORE-21); dicionário em [core.md](core.md).
> **2026-11-03 (T-0071):** `0020_pedido_ajuste_valor_produto_relacao` (aditiva: ajuste em R$ no pedido — `desconto_valor_cents`/`acrescimo_valor_cents`/`ajuste_em` — e no item por unidade da medida vendida — `desconto_unitario_cents`/`acrescimo_unitario_cents`/`ajuste_em` — com CHECKs de exclusividade, sentido coerente com o %, R$ do item <= tabela e preço unitário coerente; índice `pedido_orcamento_aberto_ix`; nova `catalogo.produto_relacao` (complementar/superior/substituto, sem FK para o Core, pull tenant)); dicionário em [vendedor.md](vendedor.md) e [catalogo.md](catalogo.md); base demo com a referência do novo pedido (Mini Box Japiim C5110). **Não aplicada na demo (5432) até o gerente decidir.**

## Windows: subir, derrubar e recriar o banco de teste (5 passos)
1. **Abra o Docker Desktop** e espere "Engine running". No Git Bash, se `docker` não for encontrado:
   `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"` (no PowerShell:
   `$env:Path += ";C:\Program Files\Docker\Docker\resources\bin"`). O CLI e os testes acham esse
   caminho sozinhos; o PATH só importa para usar `docker` à mão.
2. **Subir** (baixa `pgvector/pgvector:pg16` na 1ª vez, cria o banco `macuxi` e migra):
   `pnpm --filter @macuxi/db banco subir` → `[banco] pronto: localhost:5432/macuxi`.
3. **Carregar dados**: `pnpm --filter @macuxi/db banco seed fase-m` e/ou
   `pnpm --filter @macuxi/db banco fixture dois-tenants` (idempotentes; `banco status` confere).
4. **Testar**: `pnpm --filter @macuxi/db test` (ou `pnpm test` na raiz). Cada execução cria e apaga um
   banco efêmero `macuxi_teste_*` no **Postgres dos testes** (abaixo), nunca no da demo; se o container dele
   estiver parado e o Docker aberto, o teste o sobe sozinho.
5. **Derrubar ou recriar**: `banco derrubar` (para o container, mantém o volume),
   `banco derrubar --limpar` (apaga também o volume) ou `banco recriar` (apaga volume e sobe do zero,
   migrado e vazio). Bancos de teste esquecidos por execução interrompida: `banco apagar-teste --todos`
   (no Postgres dos testes) ou `pnpm --filter @macuxi/db limpar-testes [-- --apagar]` (sobras no da demo, abaixo).

### Dois Postgres locais: demo × testes (02/11)
A carga dos testes derrubou duas vezes o Postgres da demo (crash recovery com fsync de ~190 bancos de teste
esquecidos). Desde então são **dois serviços** no `db/docker-compose.yml`:

| Serviço | Container | Porta | Dados | Quem usa |
|---|---|---|---|---|
| `postgres` | `macuxi-postgres` | 5432 (`MACUXI_PG_PORTA`) | volume `macuxi-pgdata`, durável | demo, `subir-demo`, API/worker locais, `banco subir/migrar/seed` |
| `postgres-testes` | `macuxi-postgres-testes` | 5434 (`MACUXI_PG_TESTES_PORTA`) | **tmpfs** (4 GB), `fsync`/`synchronous_commit`/`full_page_writes` **off** | `globalSetup`, `criarBancoDeTeste`, `banco criar-teste/apagar-teste`, `medir-sync` |

- `banco subir` sobe **só** o `postgres`; `banco subir-testes` (ou o próprio `globalSetup`) sobe só o `postgres-testes`.
  O dos testes não tem `restart`: um reinício do Docker o deixa parado até o próximo teste. Queda = zero recuperação
  (tmpfs, nada a fazer fsync); os bancos de teste somem junto — são efêmeros.
- Endereço dos testes (`lerConfigTestes` em `db/src/config.ts`), nesta ordem:
  1. `MACUXI_PG_TESTES_URL=postgres://usuario:senha@host:porta` (explícito);
  2. `MACUXI_PG_HOST` ou `MACUXI_PG_PORTA` definidos no ambiente → o mesmo servidor de `lerConfig` (é o caso do **CI**,
     cujo workflow define os dois para o service container na 5432; e do `varrer-relogio`, com porta 1);
  3. padrão: `localhost:5434` (`MACUXI_PG_TESTES_PORTA`).
  Atenção: quem põe `MACUXI_PG_PORTA` no `.env` local (ex.: 5433 por porta ocupada) volta a testar no servidor da demo;
  nesse caso defina também `MACUXI_PG_TESTES_URL`.
- **Limpeza de sobras de teste** (`node db/scripts/limpar-bancos-teste.mjs`, padrão **5434**, o Postgres dos testes;
  a demo só com `--porta 5432` explícito): sem opção só **lista**; com `--apagar` apaga um por vez. Só sai banco
  com nome no padrão exato de quem cria banco de teste (`macuxi_teste_<base36>_<pid>_<hex6>`, de `criarBancoDeTeste`,
  e `macuxi_conector_teste_<base36>_<hex6>`, do teste do Conector), **sem conexão** em `pg_stat_activity` e **criado há
  mais de 2 h** (`--idade-min-horas H`; idade = a data mais nova entre o `Date.now()` do nome e o `PG_VERSION` do banco).
  Pode rodar com outra rodada de testes em andamento. Nunca `macuxi` (`MACUXI_PG_BANCO`), `postgres` nem `template*`;
  `--forcar` derruba conexões (não ignora a idade). Mostra o espaço liberado. Só host local. Node puro + `pg` (sem tsx).
  04/11: 58 órfãos apagados na 5434 (1.024,5 MB; tmpfs de 1.151 para 138 MB).

Porta ocupada (outro Postgres em 5432)? Defina `MACUXI_PG_PORTA=5433` no `.env` da raiz: o compose e
o CLI usam a mesma variável.

## Pré-requisitos
- Docker Desktop instalado e aberto (`docker version` responde).
- Node >= 24.7 para os seeds/fixtures (usam `crypto.argon2Sync` nativo para o hash argon2id).
- `db` registrado no `pnpm-workspace.yaml` e `pnpm install` rodado (traz `pg`, `drizzle-orm`, `drizzle-kit`).
- Opcional: copiar `db/.env.example` para `db/.env` (ou para a `.env` da raiz). Sem `.env`, valem os
  padrões locais (porta 5432 só em `127.0.0.1`, admin `postgres`/`postgres`, banco `macuxi`, papel `macuxi_app`).

## Base de demo
Base para a demonstração com o gestor externo (app novo + API real; R-20261031-233442, item 1). Seed em
`db/seeds/demo/demo.ts`, teste em `db/testes/seed-demo.test.ts`. O `scripts/demo/subir-demo.ps1` (engenheiro) chama o comando abaixo.

| O quê | Comando (na raiz) |
|---|---|
| Carregar ou atualizar (preserva o que o app gravou no ensaio) | `pnpm --filter @macuxi/db banco seed demo` |
| **Recarregar do zero** (apaga TODAS as linhas do tenant demo, inclusive visitas, pedidos e sessões do ensaio) | `pnpm --filter @macuxi/db banco seed demo --recriar` |
| Fixar o "hoje" (ensaio de outro dia) | `... banco seed demo --hoje AAAA-MM-DD` |
| Banco de teste efêmero com a base | `... banco criar-teste --fixture demo` |

Pré-requisito: banco migrado até a `0020` (`banco subir` ou `banco migrar up`); sem isso o seed para com
`rode "banco migrar up" antes`. Só roda no Postgres local (mesma trava do seed da Fase M: `exigirBancoLocal`).

**Login no app** — código da empresa **`demo`** · senha de todos **`demo-macuxi`** (ou o valor de `MACUXI_SENHA_DEMO` no
`.env`, que tem precedência). A senha só existe como hash argon2id; o CLI imprime os e-mails, nunca a senha.

| Perfil | E-mail | Nome (fictício) | O que vê |
|---|---|---|---|
| vendedor | `vendedor@exemplo.com.br` | Lucas Andrade | 18 clientes; **rota de hoje com 6 paradas** (a 1ª é cliente do Atacado); 8 pedidos (1 aguardando a supervisora, 1 rejeitado, 1 cancelado); recado do supervisor |
| vendedor | `vendedor2@exemplo.com.br` | Camila Freitas | 12 clientes; rota de hoje com 4 paradas; 3 pedidos |
| supervisor | `supervisor@exemplo.com.br` | Renata Barros | responsável pela "Equipe Manaus": carteira dos dois vendedores e do promotor (30 clientes), metas e indicadores, 2 pedidos para aprovar no nível dela (11 pedidos da equipe, 3 aguardando aprovação) |
| gerente | `gerente@exemplo.com.br` | Marcelo Tavares | responsável pela "Regional Norte", pai da "Equipe Manaus" (vê a equipe da supervisora, RN-CORE-04); 1 pedido para aprovar no nível dele (12%); app Gestão |
| promotor | `promotor@exemplo.com.br` | Joana Prado | 7 supermercados/lojas na carteira de promotor; rota de hoje com 4 paradas; sem módulo Vendedor (RN-PRO-01) |
| analista | `analista@exemplo.com.br` | Paulo Ribeiro | tenant inteiro (BKO) |
| admin | `admin@exemplo.com.br` | Sérgio Moura | tenant inteiro (BKO) |

Conteúdo (tenant `dd000000-0000-4000-8000-000000000001`, "Distribuidora Exemplo", fuso America/Manaus, plano `demonstracao`):
- **Módulos licenciados:** core, catalogo, vendedor, promotor (`plataforma.tenant_modulo`) e módulos por perfil em
  `plataforma.perfil_modulo` (vendedor: core/catalogo/vendedor; promotor: core/catalogo/promotor; supervisor, analista e
  admin: os quatro). **Gestor (T-0055):** licenciado pelo seed próprio `db/seeds/demo/gestor.ts` (`carregarDemoGestor`,
  chamado dentro de `carregarDemo`): `gestor` no tenant e para supervisor, gerente, analista e admin, mais a projeção do
  Gestor montada pelo domain com os dados da demo (painel, ranking, fila de aprovação e alertas coerentes). Ver
  [gestor.md](gestor.md) §4. Enquanto a linha que chama `carregarDemoGestor` não estiver em `demo.ts`, o Gestor fica sem
  licença na demo.
- **30 clientes** de distribuição de alimentos em 30 bairros de Manaus (logradouro, número, CEP, coordenadas), contato
  principal com telefone fictício (prefixos não atribuídos: fixo `92 3000-0xxx`, celular `92 9 0000-xxxx`), financeiro,
  3 títulos por cliente (**8 com título vencido**, 1 bloqueado por atraso: Mercearia do Porto; até a T-0071 era o Mini Box Japiim, hoje o cliente da referência do novo pedido) e 12 meses de histórico.
- **Rota de hoje** no fuso do tenant, calculada na hora do seed (vendedor 6 paradas, vendedor2 4, promotor 4), sem visita:
  a demo faz os check-ins ao vivo. Raio de check-in 200 m (padrão): longe do cliente, o app pede justificativa de
  fora do raio (motivos extras `gps_impreciso` e `endereco_desatualizado`).
- **Pedidos** (T-0029) dos últimos dias úteis, **recalculados pela tabela do cliente com a regra do servidor** (`revalidarPedido`
  do Vendedor), com número `000001`..`000011` (o próximo, 000012, é o do orçamento da referência), retratos e linha do tempo (`vendedor.pedido_evento`): 7 aprovados dentro da
  alçada (automático), 2 aguardando o **supervisor** (Lucas 8%, Camila 7%), 1 aguardando o **gerente** (Camila 12%),
  1 **rejeitado** pela supervisora (com motivo) e 1 **cancelado** depois de aprovado. Nada em `sent_to_erp` ou depois. Com
  itens e a visita que os gerou; visitas sem pedido com motivo; `core.indicador_diario` coerente com os pedidos.
- **Metas do mês corrente** (venda, positivação, cobertura, visitas) dos vendedores e do promotor, todas com `tipo = 'pedido'`
  (0019, RN-CORE-21; sem faturamento do ERP na demo) — BKO de metas da T-0068. **Metas do mês anterior** de Lucas e Camila
  (mesmos 4 indicadores e tipo, valores um pouco menores) para o "copiar do mês anterior" da T-0068; o Gestor as projeta por
  `usuário|mês` (o painel do mês corrente não muda). Na recarga `-Manter`, meta viva do ensaio no mesmo (usuário, período,
  indicador) com outro id é mantida e o seed pula a dele (sem violar `meta_uk`). **Hierarquia** (BKO de usuários da T-0067): a
  Equipe Manaus (Lucas, Camila, Joana e Renata) tem a Renata como responsável e a Regional Norte (Marcelo) como pai: supervisor
  e gerente de cada usuário saem de `core.equipe`. **Medidas** (0018): UN, CX, FD, LT e BD ativas, as outras 6 da lista inicial
  inativas, e a caixa de embarque como embalagem do produto (`gravarDemoMedidas`); 36 produtos com marcas
  fictícias (24 de mercearia/limpeza/higiene + 9 da linha automotiva e o detergente 5 L, 0013; + filtro de papel, leite em pó e água 1,5 L, T-0071); 3 notificações (recado do supervisor ao vendedor, pedidos para aprovar à supervisora e ao gerente).
- Parâmetros: os padrões do Core semeados pelo gatilho (`checkin.raio_m`, `metas.base_apuracao`) e as **alçadas do Vendedor**
  `alcada.vendedor_pct = 5`, `alcada.supervisor_pct = 10`, `alcada.gerente_pct = 15`, `alcada.acima_gerente = "analista"`.
- **Preço** (schema `catalogo`, [catalogo.md](catalogo.md)): tabelas "Varejo" (todos os 36 produtos) e "Atacado" (≈ 7% menor,
  **sem** açaí `ACA-1K`, suco `SUC-1L` e creme dental `CRD-90` → "Sem preço para este cliente", RN-CAT-06); supermercados e
  atacarejos no Atacado, os demais no Varejo; vigência desde o 1º dia do mês anterior.
- **0013** ([core.md](core.md), [catalogo.md](catalogo.md), [vendedor.md](vendedor.md)): **CNPJ fictício gerado (dígito
  verificador correto) e IE em todos os clientes** (Panificadora Pão Dourado ISENTO); o **Atacado Boto Rosa sem CEP**
  (`cadastro_incompleto`, falta `cep`: pedido dele só como orçamento, RN-VEN-13); pedidos com o CNPJ no retrato (o
  `000010` abre no BKO), frete (FOB com transportadora em 4 clientes, CIF no resto; sem valor de frete, R-20261102-105040) e endereço de entrega
  principal; custo com margem de 20% a 40%, desconto máximo próprio em `OLE-4T-1L` 25%, `VEL-150` 5% e `DET-5L` 10%
  (padrão 15% sem linha de parâmetro); UN e CX em 10 produtos (preço próprio da CX ligado na T-0071: café, óleo de soja, leite e óleo 4T); árvore do catálogo de 3 níveis; conteúdo, atributos,
  sinônimos e documento de busca ("óleo para moto 150 cilindradas" acha `OLE-4T-1L`); 2 depósitos com rupturas e
  saldos baixos; 2 transportadoras; endereço de entrega extra em 5 clientes.
- **Condições de pagamento** ([vendedor.md](vendedor.md)): À vista (padrão), 28 dias, 28/56 e 30/60/90; os 8 clientes com título
  vencido só À vista e 28 dias (RN-VEN-14); os demais 3 ou 4.
- **Roteiro do ensaio** que a base permite: o Lucas tira pedido de 3% (aprova sozinho), de 8% (vai à Renata) e de 12% (vai
  ao Marcelo), e no Supermercado Bom Preço (Atacado) o açaí aparece sem preço. Os números do ensaio seguem o contador
  (`000011` em diante); recarregar a base nunca volta o contador.
- **Limitação no começo do mês** (R-20261101-045314, O-2): pedidos, visitas e `core.indicador_diario` da base são dos dias
  úteis ANTERIORES ao "hoje". Até o 1º dia útil depois do dia 1º, eles caem todos no mês anterior e Metas (app) e
  Indicadores (BKO) do mês mostram 0%. Para o ensaio nesses dias, rode o ensaio a partir do 2º dia útil do mês ou mostre
  os painéis do mês anterior; puxar parte do histórico para o mês corrente fica como melhoria da base (pendência
  registrada na entrega da T-0029).

Idempotência: upsert por id determinístico. Rodar de novo no mesmo dia não muda nada (nem o hash da senha, que só é
refeito se não conferir com a senha informada); zera `tentativas_falhas`/`bloqueio_ate` (ninguém fica travado por senha
errada no ensaio). Em outro dia entra a rota do novo dia (as anteriores ficam como histórico, com paradas não
visitadas) e as datas relativas andam; para a demo, prefira `--recriar`. `--recriar` usa
`session_replication_role = replica` só na transação (precisa do superusuário do Docker) e apaga apenas `tenant_id = demo`.
O teste confere que nenhuma linha de outro tenant muda e que, pelo `macuxi_app`, os tenants não se enxergam.

## Banco que não é o local (homologação, nuvem)
Os padrões acima são **públicos** e valem só para o Postgres local: host `localhost`, `127.0.0.1`, `::1` ou
`macuxi-postgres` (lista `HOSTS_LOCAIS` em `db/src/config.ts`, a mesma do `global-setup`) **e** `NODE_ENV`
diferente de `production`. Fora disso:
- `lerConfig` **falha** se faltar `MACUXI_PG_ADMIN_SENHA` ou `MACUXI_PG_APP_SENHA` (ou se vierem com a senha
  pública local), com a mensagem `[db] Banco fora do ambiente local (...): defina ... no .env`. Assim
  `banco papeis`/`migrar`/`criar-teste` nunca gravam a senha pública no papel `macuxi_app`;
  `garantirPapelApp` ainda recusa a senha pública se o cliente não estiver num host local (segunda trava).
- `banco seed fase-m` (`carregarFaseM`: senha `demo-macuxi` e usuários fictícios) **recusa** rodar.
- `banco seed demo` (`carregarDemo` e os seeds de módulo em `db/seeds/demo/`) recusa, **salvo com `MACUXI_AMBIENTE=demo`**
  (valor exato; `exigirBancoDemo`): é a permissão explícita do servidor da demo (VM da Magalu, ADR 0020 §5), que vale
  também com `NODE_ENV=production`. Ela não libera a senha pública dos papéis, o seed da Fase M nem a fixture dos testes.
  Na VM, a senha dos logins da demo é `MACUXI_SENHA_DEMO`, se definida, ou a padrão da seção "Base de demo".
- **API e worker usam `lerConfigApp`**: fora do local, exige só `MACUXI_PG_APP_SENHA` (e `MACUXI_PG_WORKER_SENHA` para o
  worker); `MACUXI_PG_ADMIN_SENHA` é opcional e, sem ela, `urlAdmin` lança. Migrações, papéis e seeds seguem com
  `lerConfig` (admin obrigatório).
- `garantirPapel` (papéis `macuxi_app`/`macuxi_worker`) desliga o log de comando na própria transação
  (`log_min_duration_statement=-1`, `log_statement=none`, só se o admin for superusuário): a senha do `ALTER ROLE` não
  cai no log do servidor.
- Backup do servidor da demo: [db/backup/LEIA-ME.md](../../db/backup/LEIA-ME.md). Faz `pg_dump` diário para
  `backups/` no bucket, com 7 dias de retenção e restauração testada em `db/testes/backup.test.ts`.
- Segredos só no `.env` (CLAUDE.md regra 8). Testes: `db/testes/ambiente-local.test.ts`.

## Logs do Postgres
O compose local liga `log_min_duration_statement=300` (consultas lentas para EXPLAIN), que registra também os
parâmetros da consulta (aqui só dados fictícios). Em nuvem, para não levar dado pessoal ao log (regra 8), use
`log_parameter_max_length=0` e `log_parameter_max_length_on_error=0`.

## Comandos (rodar na raiz)
| O quê | Comando |
|---|---|
| Subir o Postgres, criar o banco `macuxi` e migrar | `pnpm --filter @macuxi/db banco subir` |
| Estado (conexão, migrações, bancos de teste esquecidos) | `pnpm --filter @macuxi/db banco status` |
| Aplicar migrações pendentes | `pnpm --filter @macuxi/db banco migrar up [--ate 0001]` |
| Desfazer a última / N / todas | `pnpm --filter @macuxi/db banco migrar down [--passos N \| --tudo]` |
| Carregar o seed da Fase M | `pnpm --filter @macuxi/db banco seed fase-m` |
| Carregar a base de demo (`--recriar` = do zero) | `pnpm --filter @macuxi/db banco seed demo [--recriar]` |
| Carregar a fixture dois-tenants | `pnpm --filter @macuxi/db banco fixture dois-tenants` |
| Criar banco de teste efêmero (migrado) | `pnpm --filter @macuxi/db banco criar-teste [--fixture dois-tenants\|fase-m]` |
| Apagar banco(s) de teste | `pnpm --filter @macuxi/db banco apagar-teste <nome> \| --todos` |
| (Re)criar o papel de aplicação | `pnpm --filter @macuxi/db banco papeis` |
| Recriar do zero (apaga volume, sobe e migra) | `pnpm --filter @macuxi/db banco recriar` |
| Medir o sync com volume (EXPLAIN + p50/p95) | `pnpm --filter @macuxi/db exec tsx scripts/medir-sync.ts` |
| Parar o container (mantém os dados) | `pnpm --filter @macuxi/db banco derrubar` |
| Parar e APAGAR o volume de dados | `pnpm --filter @macuxi/db banco derrubar --limpar` |
| Testes do banco | `pnpm --filter @macuxi/db test` |
| Subir só o Postgres dos testes (5434, tmpfs) | `pnpm --filter @macuxi/db banco subir-testes` |
| Listar / apagar sobras de teste (5434; sem conexão e com mais de 2 h) | `pnpm --filter @macuxi/db limpar-testes` · `... limpar-testes -- --apagar` |
| Backup / restauração da demo (VM) | `db/backup/backup-vm.sh` · `db/backup/restaurar-vm.sh` ([LEIA-ME](../../db/backup/LEIA-ME.md)) |

Todas aceitam `--banco <nome>` (padrão: `MACUXI_PG_BANCO` ou `macuxi`).

## Testes
`pnpm --filter @macuxi/db test` (também roda no `pnpm test` da raiz):
- **Estáticos (sempre rodam):** pares up/down, campos comuns, RLS/FORCE/política/grant/índice de sync
  em cada `create table`, Drizzle x SQL, cobertura da fixture e do seed.
- **Com Postgres:** o `globalSetup` cria um banco efêmero `macuxi_teste_<...>`, aplica as migrações,
  carrega a fixture dois-tenants e apaga o banco no fim. Arquivos:
  `migracoes.test.ts` (S0-020/021/022), `conformidade.test.ts` (S0-023/028), `vazamento.test.ts`
  (S0-024/025/026/027), `seed-fase-m.test.ts` (S0-031..034), `seed-demo.test.ts` (base de demo: idempotência, `--recriar`, isolamento), `drizzle-x-banco.test.ts`.
- **Postgres parado, Docker aberto:** o `globalSetup` roda `docker compose up -d --wait postgres-testes` e os testes
  **rodam** (desligue com `MACUXI_PG_AUTO_SUBIR=0`; só vale para host local).
- **Sem Docker/Postgres:** esses arquivos são **pulados** e, no fim, aparece
  `[db] Docker não está rodando: N testes de banco pulados.` (relator `db/testes/aviso-pulos.ts`).
- **CI:** defina `MACUXI_PG_EXIGIR=1` — aí a ausência do banco é **erro** (não pula).
- **Relógio simulado:** `MACUXI_AGORA=2026-11-04T03:59:00Z pnpm --filter @macuxi/db test` carrega a fixture como se
  fosse esse instante (prova de que nada depende da hora do dia nem da virada de data no fuso). Regra: teste não
  compara instante da fixture com `now()` — use `checkin_em + interval` ou instante fixo (ver fixture-dois-tenants.md).
- Vários processos ao mesmo tempo (ex.: `pnpm test` da raiz + `tests/`) são seguros: cada um usa o
  próprio banco efêmero; a criação do papel `macuxi_app` é serializada por advisory lock.
- **Timeouts:** `db/vitest.config.ts` usa `testTimeout` e `hookTimeout` de 300 s (o caso do aparelho SQLite tem 600 s
  próprios). Tempo de caso não mede desempenho (quem mede é o EXPLAIN): up/down/up (S0-021), seeds e `--recriar`
  levam segundos sozinhos, mas passam de 60 s com o `pnpm test` da raiz carregando todos os pacotes no mesmo Postgres.

## Para o agente `testes` (tests/)

**Opção 1 — mesmo setup do db/ (recomendada para o vazamento):** em `tests/vitest.config.ts`:
```ts
import AvisoPulos from '@macuxi/db/teste/aviso-pulos';
// ...
test: {
  globalSetup: ['../db/testes/global-setup.ts'],   // relativo ao root (tests/): sobe o Docker se preciso,
  reporters: ['default', new AvisoPulos()],         // cria macuxi_teste_*, migra, carrega dois-tenants e apaga no fim
  hookTimeout: 120_000,
}
```
E no teste: `import { banco, semBanco } from '@macuxi/db/teste/estado'` +
`describe.skipIf(semBanco())(...)`; `banco().urlApp` (papel `macuxi_app`, RLS) e `banco().urlAdmin`.
**Relógio da fixture** (T-0042): `agoraDaFixture()` e `hojeDaFixture(fuso)` (de `@macuxi/db/teste` ou `.../estado`) dão o
instante e o "hoje" com que o globalSetup carregou a fixture; use-os no lugar de `new Date()` para o dia/mês da fixture
([fixture-dois-tenants.md](fixture-dois-tenants.md)).
Utilitários do vazamento (`tabelasComTenant`, `emTransacao`, `erroDe`, `comCliente`) em
`@macuxi/db/teste/util`. O próprio `db/testes/vazamento.test.ts` é o modelo.

**Opção 2 — banco por arquivo, sem globalSetup:**
```ts
import { criarBancoDeTeste, carregarDoisTenants, comTenant, DOIS_TENANTS, TABELAS_SEM_TENANT_ID } from '@macuxi/db/teste';
import pg from 'pg';

const banco = await criarBancoDeTeste({ preparar: (admin) => carregarDoisTenants(admin).then(() => {}) });
const pool = new pg.Pool({ connectionString: banco.urlApp });           // papel macuxi_app (sujeito a RLS)
const linhas = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query('select * from core.usuario'));
await pool.end(); await banco.apagar();
```
- `banco.urlAdmin` ignora RLS: use só para preparar dados ou ler o catálogo, **nunca** para provar isolamento.
- `postgresDisponivel()` devolve `{ ok }` para decidir `describe.skipIf`.
- IDs determinísticos em `DOIS_TENANTS` (prefixo `aaaaaaaa-` para A, `bbbbbbbb-` para B). Detalhe em
  [fixture-dois-tenants.md](fixture-dois-tenants.md).

## Arquivos
| Caminho | Conteúdo |
|---|---|
| `db/docker-compose.yml` | serviço `postgres` (pgvector/pgvector:pg16), volume `macuxi-pgdata`, porta 5432 só em `127.0.0.1`, UTC |
| `db/migrations/NNNN_nome.up.sql` / `.down.sql` | migrações versionadas (SQL), sempre com caminho de volta |
| `db/src/migrador.ts` | executor up/down com checksum do up e do down (migração aplicada não pode ser editada) e advisory lock |
| `db/src/contexto.ts` | `comTenant` / `definirTenant` (contexto do tenant por transação) |
| `db/src/papeis.ts` | papéis `macuxi_app` e `macuxi_worker` (`garantirPapelApp`, `garantirPapelWorker`) e diagnóstico (S0-028) |
| `db/src/banco-teste.ts` | banco efêmero, disponibilidade do Postgres |
| `db/esquema/plataforma.ts`, `modules/core/db/nuvem.ts`, `modules/vendedor/db/nuvem.ts` | espelho Drizzle (tipado) das tabelas |
| `db/src/ids.ts`, `db/src/datas.ts` | ids fixos/determinísticos (`idDeChave` = `plataforma.uuid_de_chave`, `idMotivoPadrao`) e datas relativas a hoje no fuso |
| `drizzle.config.ts` | Drizzle Kit; `drizzle:rascunho` gera só rascunho em `db/drizzle-rascunho/` (ignorado) |
| `db/seeds/fase-m/fase-m.ts` | seed de demonstração da Fase M |
| `db/seeds/demo/demo.ts` | base de demo (tenant `demo`, seção "Base de demo") |
| `db/seeds/fixtures/dois-tenants.ts` | fixture dos testes de RLS e licenças |
| `db/scripts/banco.ts` | CLI acima |
| `db/src/docker.ts` | acha o Docker (inclusive fora do PATH no Windows), diz se está rodando, sobe o compose |
| `db/testes/global-setup.ts`, `db/testes/aviso-pulos.ts` | setup dos testes de banco (sobe/pula/exige) e aviso de pulados |
| `db/scripts/medir-sync.ts` | medição do sync com volume ([desempenho-sync.md](desempenho-sync.md)) |
| `db/scripts/limpar-bancos-teste.mjs` | limpeza das sobras de teste (lista; `--apagar`; idade e conexão) |
| `db/backup/` | backup da demo para o Object Storage: `backup.mjs`/`s3.mjs` (Node puro, SigV4), `backup-vm.sh`, `restaurar-vm.sh`, `contagem.sql` |

## Migrações: regras
1. Uma migração = `NNNN_nome.up.sql` + `NNNN_nome.down.sql`, numeração contínua (o executor recusa buraco).
2. **Nunca edite migração aplicada** — checksum (sha256, fim de linha normalizado) do `.up.sql` diferente aborta o `up`;
   o do `.down.sql` diferente aborta o `up` e o `down`. Crie a próxima.
3. Toda tabela nova: campos comuns, `enable` + `force row level security`, política `isolamento_tenant`
   para `macuxi_app`, grant explícito, índice `(tenant_id, updated_at, id)` se for sincronizada. O teste
   estático reprova o `create table` que esquecer algum.
4. O `down` apaga dados (DROP SCHEMA ... CASCADE). Em produção, só com backup e decisão registrada.
5. Drizzle é espelho: ao mudar o SQL, ajuste `db/esquema/*.ts` ou `modules/<m>/db/nuvem.ts` (o teste Drizzle x banco acusa).
6. Perfis: a fonte única é `PERFIS` de `@macuxi/platform-sdk`. O Drizzle importa de lá; os `check (perfil in (...))`
   das migrações são comparados com ela em `db/testes/estatico.test.ts` (perfil novo = migração nova trocando o CHECK).

Modelo e políticas: [rls.md](rls.md) · dicionários: [plataforma.md](plataforma.md), [core.md](core.md), [catalogo.md](catalogo.md), [vendedor.md](vendedor.md), [integracao.md](integracao.md).

Migrações: 0001 plataforma · 0002 core · 0003 worker/outbox · 0004 sessão e aparelho · **0005 `plataforma.arquivo` +
`uuid_de_chave`** · **0006 lote A do core** (Cliente 360, rotas, visitas, motivos, notificações, metas, indicador diário;
padrões em todo tenant por gatilho) · **0007 schema `vendedor`** (pedido e pedido_item, mínimo do pull) · 0008 preço do Catálogo ·
0009 pedido completo do Vendedor · **0010 schema `integracao`** (Hub) · **0011 retenção da outbox** (`plataforma.expurgar_outbox`) ·
**0012 `pg_temp` no fim do `search_path`** das 4 funções SECURITY DEFINER (T-0042).
O executor roda como admin (superusuário no Docker/CI): a semeadura dos padrões e as fixtures dependem disso (FORCE RLS).

## Pendências
Feitas na **T-0004** (migração `0003_plataforma_worker`): `carteira_usuario_sync_ix`, papel `macuxi_worker` com as
políticas `despacho_outbox*` (ADR 0007), `plataforma.evento_consumo` e colunas `usuario_id`/`request_id` em
`plataforma.evento`. Feitas na **T-0003 Fase 2** (migração `0004_core_sessao`): `core.sessao`, `core.dispositivo`,
`core.usuario.tentativas_falhas`/`bloqueio_ate` e `equipe_responsavel_ix` ([core.md](core.md)). Pendentes:
- Limpeza de `core.sessao` expirada (job no worker ou por tenant; índice `sessao_expira_ix` pronto).
- pg-boss (schema `pgboss`, criado pelo migrador) junto do primeiro consumidor real (ADR 0007 item 5).
- `MACUXI_PG_WORKER_SENHA` nos `.env.example` (raiz: engenheiro-software; `db/.env.example`: sem permissão de leitura nesta sessão).
- Cursor do pull com transação longa (`updated_at = now()` é o início da transação): tratado na rota de pull (T-0004).
