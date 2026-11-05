# ADR 0021 — Geração da base do tenant no sync: o aparelho percebe a base recriada ou restaurada

- **Status**: proposta (2026-11-04)
- **Data**: 2026-11-04
- **Tarefa**: T-0079 (bug R-20261104-163228, diagnóstico R-20261104-195513 do banco-dados)
- **Autor**: engenheiro-software
- **Base**: ADR 0003 (motor de sync), ADR 0009 (sobreposição e versão do escopo), ADR 0018 (novidades), RN-CORE-23

## Contexto
O pull é incremental: o aparelho só recebe linhas com `(updated_at, id)` depois do cursor, inclusive os removidos (tombstone
`deleted_at`). Quando a base do tenant é **recriada** (`seed demo --recriar`, servidor novo) ou **restaurada** de um backup, as
linhas que o servidor perdeu somem sem tombstone. O aparelho guarda a cópia antiga para sempre: no teste de campo de 04/11, o
pedido 000011 de 02/11 continuou no Campo e o seed novo deu o mesmo número a outro pedido ("pedido fantasma").

A `versao_escopo` (ADR 0009 §4) não resolve: ela muda quando a carteira muda, não quando a base volta no tempo. O
`tenant.created_at` também não: muda no `--recriar`, mas não na restauração de backup.

## Decisão
1. **Marcador explícito**: `plataforma.tenant.geracao_base` (uuid, `default gen_random_uuid()`). Regra: **toda operação que
   apaga ou volta dados do tenant gira a geração** (seed `--recriar`, restauração de backup, primeiro seed de servidor novo).
   O uso normal (API, Hub, BKO, migrações) nunca a toca. Migração e scripts: banco-dados.
2. **Onde trafega (aditivo, sem versão nova de rota)**: campo opcional `geracao_base` (string) em **toda página do pull**
   (`PaginaSync`) e na resposta de **`GET /v1/sync/novidades`** (`NovidadesRespostaSchema`). Servidor sem a coluna (antes da
   migração) não manda o campo. O app antigo ignora: o transporte não valida a página com schema estrito e o schema de
   novidades descarta campo desconhecido.
3. **Não vai no `/v1/me/modulos` nem no login** nesta versão: o app instalado lê essas respostas com schema `.strict()`
   (`MeusModulosRespostaSchema`, `auth.ts` do Core) e um campo novo quebraria o APK de campo (C1 de 04/11). O pull e as
   novidades já passam em toda sincronização (completa, leve e em segundo plano), então o login não acrescenta cobertura.
4. **Regra no aparelho** (`decidirGeracao`, função pura em `platform-sdk/src/geracao-base.ts`):
   - servidor sem o campo → nada muda (servidor antigo);
   - aparelho sem geração guardada → **adota** a recebida (instalação nova ou app atualizado; não apaga nada);
   - igual → nada muda;
   - diferente → **troca de geração**.
5. **Troca de geração** (motor, `criarMotorSync`), nesta ordem e idempotente se o app cair no meio:
   1. os itens **aceitos ainda sobrepostos** (D-3) voltam para a fila como `pendente`, na ordem de criação
      (`filaNaTrocaDeGeracao`): a base nova pode não ter recebido; o reenvio é idempotente pelo UUID do aparelho;
   2. **envia a fila** (o que a base nova recusar fica `falhou`, visível na Fila do aparelho; nada é descartado);
   3. apaga do aparelho as **linhas, cursores, versões de escopo e ressincronizações** de todas as entidades, o registro de
      carga e o cursor de novidades. **Ficam**: fila de itens, fila de arquivos, módulos efetivos, parâmetros e limpeza
      pendente (RN-CORE-02);
   4. cada etapa de módulo com **`aoTrocarGeracao(ctx)`** limpa o próprio cache em `mod:<m>:` (o motor não sabe o que ali é
      cópia do servidor e o que é rascunho do usuário);
   5. grava a geração nova e faz o **pull completo** de novo, na mesma sincronização. Se o app cair antes do passo 5, a
      próxima sincronização vê a geração antiga e repete tudo (passos idempotentes).
   Se a geração mudar de novo na mesma passada, a sincronização termina com erro e a próxima recomeça (nada se perde).
6. **Fotos já enviadas não são reenviadas**: a fila de arquivos fica como está (limitação conhecida; a foto pendente segue).

## Alternativas
- **`tenant.created_at`** (sugestão do banco-dados): sem migração, mas não muda na restauração de backup.
- **Pull completo periódico** com apagar o que não veio: custo alto na rede de campo e não resolve entre duas passadas.
- **Geração no login/`/me`**: quebra o APK instalado (item 3); fica para quando os leitores do Core forem tolerantes.
- **Apagar tudo, fila inclusive** (como `limparAparelho`): perde pedido feito sem sinal. Recusado (critério 3 da T-0079).

## Consequências
- O fantasma some na primeira sincronização depois do `--recriar` ou da restauração, sem "Limpar dados" no Android.
- Aparelho que já tem o fantasma **antes** de receber a primeira geração (APK anterior a esta ADR) só se limpa na próxima troca
  (a primeira geração é adotada). Contorno: limpar os dados do app uma vez, ou girar a geração depois de instalar o APK novo.
- Custo: uma consulta por chave primária por página de pull e por novidades.
- Módulo que guarda cópia do servidor em `mod:<m>:` implementa `aoTrocarGeracao` na sua etapa (Vendedor na T-0079; os demais no
  backlog, porque os caminhos `app/**` deles estão com a nuvem).
