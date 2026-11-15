# Desenho — Inativar, Backup e Excluir na lista de empresas do portal

- **Origem**: R-20261114-195600-alexandre (14/11/2026 ~19h56, Manaus). **Decisão**: ADR 0052. **Contrato**: `packages/platform-sdk/src/empresa-acoes.ts`.
- **Autor**: engenheiro-software. **Tarefa**: o gerente atribui o número.

## 1. Tela (portal `config.`, aba Empresas, só o time Macuxi)
Cada linha da lista ganha três ações, nesta ordem: **Backup**, **Inativar** (ou **Reativar**) e **Excluir**, com Excluir ao lado de Inativar. O texto e o visual são do designer-ux, e a marca é validada pelo design-de-marca.
- **Inativar**: diálogo com o motivo (`MOTIVOS_INATIVACAO`) e o botão principal. O selo da linha vira "Inativa".
- **Backup**: pede o backup (`id` gerado no portal). A linha mostra "Backup em andamento (40%)", "Backup de 14/11 20h10" (fuso de Manaus no portal) ou "Backup falhou".
- **Excluir**: desabilitado enquanto `acoes.exclusao_bloqueada` não for nulo. O motivo aparece no próprio botão (dica), com o texto do código (§5). O diálogo mostra a razão social e o código e pede o código digitado e a senha do super-admin. Depois do envio, a linha mostra "Excluindo…" até `concluida`, e a empresa sai da lista.

## 2. Sequências
**Inativar**: `POST …/inativar` → `sa_inativar_tenant(sid, tenant, motivo)` numa transação: status `suspenso`, `inativada_em = now()`, motivo, auditoria `tenant.inativado`, evento `plataforma.tenant.inativado@1`. A partir do commit, a próxima requisição de qualquer token do tenant leva 403 `EMPRESA_INATIVA`.

**Backup**: `POST …/backups` → `sa_pedir_backup(sid, tenant, id)` grava `em_andamento` (único por empresa; o mesmo `id` devolve o mesmo) e marca `consistente = (status = 'suspenso')`. O worker, a cada ciclo:
1. pega um job (`for update skip locked`);
2. lê a lista de tabelas pela `plataforma.tabelas_do_backup(p_backup)`;
3. para cada tabela, pagina com `exportar_backup_pagina`, grava a parte (gzip + AES-256-GCM, sha256) e registra a parte confirmada;
4. copia os objetos de `arquivos/<tenant_id>/`;
5. grava o `manifesto.json` e fecha como `pronto`, com o evento `backup_concluido@1`.

Qualquer erro dá `falhou` com `erro_codigo`, mais o evento `backup_falhou@1`. Se a empresa for reativada durante o backup, o worker marca `consistente = false` ao fechar (a função confere `inativada_em` × `iniciado_em` e o status atual).

**Excluir**: `POST …/exclusao` → API: Zod, depois a senha do super-admin (`sa_reautenticar`), depois a `sa_pedir_exclusao(sid, tenant, id, backup_id, codigo)`, que revalida `conferirExclusao` e o código na transação, grava o job `em_andamento/banco` e a auditoria `tenant.exclusao_pedida`. Em seguida o worker:
1. `executar_exclusao(id)` numa transação: confere de novo, `encerrado`, `excluir_tenant`, `empresa_excluida`, auditoria `tenant.excluido`, job → `arquivos`;
2. remove `arquivos/<tenant_id>/`, depois job → `concluida/fim`.

Falha no passo 1 desfaz tudo, e a empresa continua inativa e intacta. Falha no passo 2 tenta de novo. O banco já está limpo.

## 3. Restaurar (operação manual, do time)
`pnpm --filter api tenant:restaurar -- --backup <id> [--simular]` na ferramenta `tenant` da VM:
1. baixa e confere o manifesto (Zod) e o sha256 de cada parte;
2. confere a migração atual;
3. confere que o tenant não existe e que o código está livre ou registrado para o mesmo id;
4. insere numa transação, em ordem;
5. copia os arquivos de volta;
6. apaga o registro `empresa_excluida` do id e audita `tenant.restaurado`.

A empresa volta inativa. O tempo é parecido com o do backup.

## 4. Banco (pedido ao banco-dados)
- `plataforma.tenant`: colunas `inativada_em timestamptz`, `motivo_inativacao text` (check da lista), com o check "inativa ⇔ data e motivo".
- `plataforma.backup_empresa`, `plataforma.backup_empresa_parte` e `plataforma.exclusao_empresa`, com `empresa_id` sem FK e sem `tenant_id` (para sobreviver à `excluir_tenant`). RLS ligado e política `manutencao`. Exceção da regra 5 no `docs/banco/rls.md` e na conformidade.
- `plataforma.empresa_excluida` (id, código, CNPJ, razão social, `excluida_em`, `backup_id`, `super_admin_id`).
- Funções `sa_*` (EXECUTE só `macuxi_portal`): `sa_inativar_tenant`, `sa_reativar_tenant`, `sa_pedir_backup`, `sa_listar_backups`, `sa_pedir_exclusao`, `sa_ler_exclusao`, `sa_reautenticar`. A `sa_listar_tenants` ganha o bloco `acoes`.
- Funções do worker (EXECUTE só `macuxi_worker`): `tabelas_do_backup`, `exportar_backup_pagina`, `registrar_parte_backup`, `fechar_backup`, `executar_exclusao` e `fechar_exclusao`, todas `SECURITY DEFINER` com o dono migrador. O tenant sai sempre da linha do job.
- O `sortear_codigo_licenca` e o `provisionar_tenant` recusam código em `empresa_excluida`.
- A `excluir_tenant` não muda. O despachante e o worker de e-mail pulam os tenants que não estão `ativo` (função `tenant_esta_ativo(uuid)` ou a lista `tenants_ativos()` no ciclo).
- Testes `*.db.test.ts`: a função do worker não lê outro tenant; o argumento de tenant não existe; a exclusão em ordem com backup; o ensaio de restauração (backup → exclusão → restauração → contagem igual por tabela); o código não reaproveitado.

## 5. Códigos e textos (o designer-ux escreve o texto final)

| Código | HTTP | Onde |
|---|---|---|
| `EMPRESA_INATIVA` | 403 | login com senha certa, renovar, toda rota do tenant, sync, arquivos, login do admin do cliente |
| `empresa_inativa` | 403 | Hub (`/integracao/v1/*`) |
| `EMPRESA_NAO_ENCONTRADA` | 404 | ações do portal |
| `EXCLUSAO_EM_ANDAMENTO`, `BACKUP_EM_ANDAMENTO` | 409 | ações do portal |
| `EXCLUSAO_EMPRESA_ATIVA`, `EXCLUSAO_SEM_BACKUP`, `EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO`, `EXCLUSAO_BACKUP_VENCIDO`, `EXCLUSAO_CODIGO_NAO_CONFERE` | 422 | exclusão |
| `REAUTENTICACAO_FALHOU` | 403 | exclusão |
| `BACKUP_INDISPONIVEL` | 503 | backup sem chave ou sem bucket |

## 6. Regras novas (para o doc 03, pelo gerente)
- **RN-PLA-07**: só o super-admin inativa e reativa. Inativar não apaga nada e corta todo acesso da empresa (apps, BKO, portal do admin do cliente, sync, arquivos, Conector, jobs, outbox e e-mails) com 403 `EMPRESA_INATIVA`. Reativar devolve tudo, sem novo login.
- **RN-PLA-08**: um backup por vez por empresa. Ele é consistente só se a empresa ficou inativa do início ao fim.
- **RN-PLA-09**: excluir só a empresa inativa, com backup pronto, consistente, iniciado depois da última inativação e concluído há no máximo 7 dias. Exige o código da empresa digitado e a senha do super-admin.
- **RN-PLA-10**: o código da licença de uma empresa excluída nunca é reaproveitado.
- **RN-PLA-11**: o backup fica 30 dias, e o mais novo pronto sempre fica. O backup de uma empresa excluída fica 90 dias depois da exclusão. O dump diário do banco guarda a empresa por até 30 dias.

## 7. Quem faz o quê

| Dono | O que faz |
|---|---|
| **banco-dados** | §4 inteiro: migração (colunas, 4 tabelas, funções `sa_*` e do worker, código não reaproveitado, filtro do despachante e do e-mail), `docs/banco/plataforma.md` e `rls.md`, testes `*.db.test.ts` e o ensaio de restauração. O script de restauração (`db/backup/restaurar-empresa.mjs`), com o leitor do manifesto do SDK |
| **modulo-core** | `autenticar`: lê o status do tenant na consulta do usuário (403 `EMPRESA_INATIVA`). `refresh` e `login` (só depois da senha certa): 403 `EMPRESA_INATIVA`. Login do portal do admin do cliente: 403 quando a senha só conferiu em empresas inativas. Testes citando RN-PLA-07 |
| **engenheiro-software** | Rotas do portal em `apps/api/src/` (`empresa-acoes-portal.ts`, flag `MACUXI_EMPRESA_ACOES`). Worker do backup e da exclusão (cifra AES-256-GCM, cliente S3 com `CopyObject`, `ListObjectsV2` e `DeleteObjects`). Passo 4 do `conector.ts` (403 `empresa_inativa`). Despachante e e-mail pulando o tenant inativo. Comando `tenant:restaurar`. Segredo `MACUXI_BACKUP_EMPRESA_CHAVE` no deploy |
| **engenheiro-apps** | Portal: as três ações na lista (`tela-empresas.tsx`), diálogos de inativar e excluir (código e senha), progresso do backup e da exclusão por consulta a cada 5 s, selo "Inativa". Shells: tratar 403 `EMPRESA_INATIVA` (Campo e Gestão: tela de bloqueio sem apagar dados nem fila; BKO: volta ao Entrar com a mensagem). Modo falso do portal com as respostas novas |
| **modulo-integracao** | Conector: tratar 403 `empresa_inativa` como pausa (tentar a cada 15 min, sem descartar nada, aviso no log e no painel local). Documentar no doc 06 e no contrato do Hub (aditivo, mesma versão). O monitor do BKO não muda (a empresa inativa não entra) |
| **designer-ux** | Textos e layout das três ações, dos diálogos, da dica do botão Excluir bloqueado e da tela "Empresa inativa" dos apps |
| **testes** | Roteiro: inativar → acessos negados (os 10 itens da tabela da ADR §1) → reativar sem novo login → backup → excluir → restaurar |
