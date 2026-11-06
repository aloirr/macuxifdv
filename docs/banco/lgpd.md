# LGPD no banco: retenção e exclusão sob pedido (T-0078)

Dono: `banco-dados`. Itens G1 e G2 de `docs/seguranca/checklist.md`. Funções: migração
`db/migrations/0024_plataforma_resumo_outbox_lgpd.up.sql`. Prova: `db/testes/lgpd-outbox.test.ts`, que roda no Postgres de
testes do CI com a fixture dois-tenants, sempre com ROLLBACK. **Nada disto foi rodado em base real.**

## 1. Retenção: o que existe hoje

| Dado | Prazo hoje | Onde está |
|---|---|---|
| Backup do Postgres da demo | 7 cópias diárias (`MACUXI_BACKUP_DIAS=7`) no bucket. O doc 04 pede 30 dias: **a decisão é do Alexandre** | `db/backup/LEIA-ME.md` |
| Outbox (`plataforma.evento` publicado e `evento_consumo`) | 30 dias depois de publicado (parâmetro `outbox.retencao_dias`, de 7 a 365). Pendente nunca sai | 0011, `expurgar_outbox` (worker) |
| Hub: `lote_staging.corpo` | 7 dias depois do lote concluído (30 dias em `falhou`) | 0010, `expurgar_retencao` (worker) |
| Hub: `lote_linha_erro.payload` | 30 dias | idem |
| Hub: `sessao_carga_recebido` | 7 dias depois da sessão fechada | idem |
| Hub: `registro_atual.payload` | 30 dias depois da inativação | idem |
| Hub: `lote` (com cascata) | 12 meses | idem |
| Gestor: `evento_aplicado` e projeção | 120 dias | API do Gestor, sob RLS (`docs/banco/gestor.md`) |
| `core.sessao` (refresh) | expira em 30 dias, mas a linha **não é apagada** | 0004 (limpeza ficou como "job futuro") |
| `catalogo.busca_log` | **sem prazo** ("a definir com o expurgo") | 0013 |
| `catalogo.uso_ia` (cota por dia) | **sem prazo** | 0013 |
| `plataforma.auditoria` | **sem prazo** (só inserção) | 0001 |
| `plataforma.arquivo` e fotos no bucket | **sem prazo** | 0005 |
| Coordenadas de check-in e checkout (`core.visita`) | **sem prazo** | 0006 |
| Pedidos, títulos, notas e histórico de compra | sem prazo enquanto o tenant estiver ativo | módulos |

## 2. Prazos propostos (para o Alexandre decidir)

| Dado | Proposta | Por quê |
|---|---|---|
| `catalogo.busca_log` | 90 dias | serve aos termos sem resultado (RF-CAT-07) e à calibração (RN-CAT-08). O termo é normalizado, mas o log é ligado ao usuário |
| `catalogo.uso_ia` | 90 dias | a cota é por dia, então o histórico só serve para custo |
| `core.sessao` | apagar 30 dias depois de expirada ou revogada | o token já não vale, a linha só serve para detectar reuso por pouco tempo |
| `plataforma.auditoria` | 5 anos, e anonimizar `antes`/`depois` sob pedido do titular (já existe, seção 3) | prazo prescricional das relações de consumo e comerciais |
| Coordenadas de visita | 24 meses e depois anuladas (a visita fica) | prova de visita para o gestor; depois disso é só localização |
| Fotos (`plataforma.arquivo` e bucket) | 24 meses, com parâmetro por tenant | as fotos de trade perdem valor; a orientação "sem rostos" (G4) diminui o risco, mas não o elimina |
| Pedidos, títulos e notas | 5 anos (obrigação fiscal, LGPD art. 16, I) ou até a exclusão do tenant | documento fiscal e comercial |
| Tenant encerrado | excluir em até 90 dias depois do fim do contrato (seção 4). Os backups somem em 7 ou 30 dias depois | fim da finalidade |
| Logs da API, do worker e da VM | 30 dias de rotação | caminho do `engenheiro-software` (`scripts/deploy/demo/`) |

Cada prazo aprovado vira uma migração de expurgo, no mesmo modelo da 0011: função `SECURITY DEFINER` só para o
`macuxi_worker`, parâmetro por tenant com limites e teste com a fixture. A primeira candidata é a `busca_log`.

## 3. Roteiro: anonimizar um titular (usuário, cliente ou contato)

Quem roda: o dono do banco (migrador/superusuário), à mão, numa transação, com o pedido do titular registrado (quem pediu,
quando, qual tenant). A aplicação não executa estas funções: `macuxi_app` e `macuxi_worker` recebem 42501.

1. **Confira o titular** (somente leitura): o id e o tenant certos, por exemplo
   `select id, tenant_id, external_id from core.usuario where tenant_id = '<tenant>' and email = '<e-mail>';`.
2. **No ERP primeiro**, se o dado vem do ERP (`external_id` preenchido): peça ao cliente que exclua ou anonimize lá. Se não
   fizer isso, a próxima carga do Hub traz o dado de volta como cadastro novo.
3. **Anonimize** (escolha uma das funções):
   ```sql
   begin;
   select * from plataforma.anonimizar_usuario('<tenant>', '<usuario_id>');   -- vendedor, promotor, gestor ou usuário do BKO
   select * from plataforma.anonimizar_cliente('<tenant>', '<cliente_id>');   -- cliente pessoa física, com contatos e endereços
   select * from plataforma.anonimizar_contato('<tenant>', '<contato_id>');   -- só um contato de cliente pessoa jurídica
   commit;
   ```
   Cada função devolve `(item, quantidade)` do que mudou. Se o titular não existir naquele tenant, dá erro P0002 e nada muda.
4. **O que cada função faz.** Os ids ficam: pedidos, títulos, notas e históricos continuam ligados ao registro anonimizado.
   O `updated_at` anda e o `deleted_at` é preenchido, então o próximo sync remove o registro do aparelho.
   - usuário: nome "Usuário anonimizado", e-mail fictício único (`anonimizado-<id>@anonimizado.invalid`), sem senha e sem
     `external_id` e sem telefone (0036), inativo e bloqueado. Revoga todas as sessões e os convites de 1º acesso pendentes
     (0036: item `core.usuario_convite`; o link deixa de valer). Bloqueia os aparelhos, sem nome (RN-CORE-15: o aparelho
     apaga os dados locais). Anula as coordenadas de check-in e checkout das visitas dele;
   - cliente: razão social "Cliente anonimizado". Tira fantasia, CPF/CNPJ, IE, telefone, e-mail, endereço, coordenadas,
     observação e `external_id`. Ficam cidade, UF e segmento, para os números. Anonimiza todos os contatos e endereços dele
     e anula as coordenadas das visitas feitas nele;
   - nas três funções: `antes`/`depois` da auditoria da entidade viram nulos, e o payload dos eventos **já publicados** do
     agregado vira `{}`. No usuário e no cliente, anula também `integracao.registro_atual.payload` pelo `external_id`. Cada
     função grava uma linha nova de auditoria (`acao = 'lgpd.anonimizar'`, sem dado pessoal).
5. **O que fica fora das funções** (registre no atendimento):
   - eventos ainda pendentes do agregado: rode de novo depois que o worker publicar;
   - `integracao.lote_staging` e `lote_linha_erro`: expiram sozinhos em 7 e 30 dias (seção 1);
   - texto livre que cite o titular (observação de pedido, justificativa de visita, respostas de pesquisa): procure à mão;
   - fotos no bucket (`plataforma.arquivo.chave`): apague o objeto se a foto identificar o titular;
   - schemas de módulo com dado ligado ao usuário (promotor, pesquisa, treinamento, gestor): esses dados ficam ligados ao id já
     anonimizado (pseudônimo). Se o pedido exigir, faça uma extensão por módulo, com recado ao módulo;
   - backups: o dado anonimizado ainda existe nas cópias até elas expirarem (7 dias hoje). Não restaure um backup anterior
     sem repetir o passo 3.

## 4. Roteiro: excluir um tenant inteiro

1. **Encerre o tenant**, para que a API pare de aceitar uso: `update plataforma.tenant set status = 'encerrado' where id = '<tenant>';`.
   Desligue o Conector do cliente (credencial revogada no BKO).
2. **Exporte o que o contrato mandar devolver** ao cliente (pedidos, clientes), antes de apagar.
3. **Liste os objetos do bucket** antes de apagar as linhas:
   `select chave from plataforma.arquivo where tenant_id = '<tenant>';`. Depois apague esses objetos no Object Storage.
4. **Apague** (o segundo argumento é o código do tenant, como confirmação):
   ```sql
   begin;
   select * from plataforma.excluir_tenant('<tenant>', '<codigo>');
   -- confira as quantidades (tabela, quantidade) e só então:
   commit;
   ```
   A função apaga todas as linhas do tenant em **toda tabela com `tenant_id`**. A lista de tabelas vem do catálogo, então
   tabela nova fica coberta sem mudar a função. Por fim apaga a linha de `plataforma.tenant`. Ela recusa código errado
   (22023), tenant que não está encerrado (55000) e tenant que não existe (P0002). Desde a 0032 (T-0075, B2 do DBaaS) não usa
   `session_replication_role` nem desliga gatilho ou FK: apaga em **ordem de FK calculada no catálogo** (filhas antes das
   mães; o ciclo `core.usuario` <-> `core.equipe` é quebrado antes com `update ... set <fk> = null`), e por fim o tenant.
   Os gatilhos de DELETE disparam (os 5 `*_toca_trilha` do Treinamento só tocam a trilha do mesmo tenant, que sai depois).
   Roda sem superusuário: o dono enxerga as linhas pela política `manutencao` da 0031 ([rls.md](rls.md)). Uma linha que
   sobrar faz a FK para `plataforma.tenant` falhar (23503) e a transação desfaz tudo.
   **Tempo esperado.** Com FKs ligadas, cada DELETE de tabela mãe confere a FK nas filhas. No DBaaS (2ª execução da
   T-0075), o tenant demo inteiro saiu em 175 ms (1.802 linhas, 115 passos). Num tenant grande, o tempo só fica
   proporcional às linhas se toda FK entre tabelas de tenant tiver índice que comece pelas colunas dela (`tenant_id`,
   `x_id`); sem esse índice, a conferência varre a filha a cada linha apagada da mãe. Pendente (🟢 2 da revisão
   R-20261105-093536): um caso na conformidade que exija esse índice, medido antes no CI para não reprovar o que já existe.
   Para produção, rode a exclusão fora do horário de uso e com `set local lock_timeout` na própria transação do passo 4.
5. **Depois**: os backups com o tenant expiram em 7 dias (ou 30, se o Alexandre decidir assim). Restaurar um backup antigo
   traz o tenant de volta: repita o passo 4 depois de qualquer restauração. Os aparelhos do tenant deixam de autenticar,
   porque o login e o refresh falham. Apagar a cópia local é com o app, fora do banco.

## 5. Provas

- `pnpm --filter @macuxi/db exec vitest run testes/lgpd-outbox.test.ts`, no CI ou com o Postgres de testes (5434). Cobre: as três anonimizações (o
  dado sai, os ids ficam, o outro tenant e os outros registros não mudam), o payload do ERP anulado, os erros P0002, 22004,
  22023 e 55000, a exclusão de tenant (zero linhas do tenant em toda tabela com `tenant_id`, o tenant B idêntico,
  `session_replication_role` intocado) e o 42501 para `macuxi_app` e `macuxi_worker`. A 0032 também é provada por um papel
  SEM superusuário, num banco efêmero: com a política `manutencao` apaga tudo do tenant (FKs e gatilhos ligados); sem ela
  não enxerga o tenant (P0002) e nada sai.
- Teste estático, que roda sem banco: só uma função `SECURITY DEFINER` na 0024 (`resumo_outbox`); as funções da LGPD com
  `revoke` de `public` e sem `grant`.
