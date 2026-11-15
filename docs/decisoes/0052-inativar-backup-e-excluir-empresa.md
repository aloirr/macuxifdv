# ADR 0052 — Inativar, fazer backup e excluir a empresa pelo portal

- **Status**: proposta em 2026-11-14; regra da exclusão, retenção de 90 dias, código não reaproveitado e backup sem download aprovados pelo dono do produto (R-20261114-202000-alexandre).
- **Data**: 2026-11-14 (Manaus)
- **Tarefa**: ações da empresa no portal (branch `nuvem/empresa-acoes-engenheiro-software`; o gerente atribui o número)
- **Autor**: engenheiro-software
- **Origem**: R-20261114-195600-alexandre (14/11/2026 ~19h56, Manaus): "Nao vi a opcao de inativar a empresa no config. Ajuste para ter essa opção na lista de empresa, junto com o botao backup e excluir. A inativação desabilita todos os acessos mas nao exclui nada. O botao excluir fica do lado de inativar e so pode ser usado apos ser feito o backup da empresa."
- **Desenho**: `docs/desenho/empresa-acoes.md`. **Contrato**: `packages/platform-sdk/src/empresa-acoes.ts` (com testes).

## Contexto
- `plataforma.tenant.status` já aceita `ativo`, `suspenso` e `encerrado` (check da 0001). Só o login, o "esqueci a senha", o portal do admin do cliente e o agendador (`tenants_ativos()`) olham o status. **O `autenticar` do Core e o renovar não olham**: um token aberto continua valendo numa empresa suspensa. O Conector também não olha.
- O backup diário (ADR 0028 §9; `db/backup/backup-dbaas.sh`) é um `pg_dump` do banco inteiro em `backups/`, com 30 dias de retenção. Ele não restaura uma empresa só.
- `plataforma.excluir_tenant(uuid, text)` (0032, ADR 0024 B2) apaga em ordem de FK, sem superusuário, e exige o tenant `encerrado` e o código como confirmação. Ela é `SECURITY INVOKER` e só o migrador (com o `macuxi_manutencao`) a executa. A API e o worker nunca usam essa conexão (S0-028).
- Os papéis do DBaaS não têm superusuário nem BYPASSRLS (ADR 0024 B1). O `pg_dump` por tenant não existe: o dump não filtra linhas.

## Decisão

### 1. Inativar e Reativar (RN-PLA-07)
1. **Estado**: o próprio `plataforma.tenant.status`. Inativa = `suspenso` (o portal mostra "Inativa"; `ROTULO_STATUS_EMPRESA`). O valor do banco não muda e não há migração do check. Colunas novas: `inativada_em`, `motivo_inativacao` (lista `MOTIVOS_INATIVACAO`, sem texto livre). Inativar **não apaga nem altera** nenhum dado da empresa e **não revoga** as sessões: ao reativar, quem estava logado volta sem novo login e a fila do aparelho sobe.
2. **Quem**: só o super-admin, pelas rotas do portal (§4). O admin do cliente recebe 403 `PERFIL_SEM_ACESSO`.
3. **O que bloqueia** (código único `EMPRESA_INATIVA`, `CODIGO_EMPRESA_INATIVA` no SDK):

| Acesso | Resposta com a empresa inativa |
|---|---|
| Login do Campo, do Gestão e do BKO (`POST /v1/auth/login`) | **senha certa**: 403 `EMPRESA_INATIVA`, sem token. Senha errada, usuário ou empresa inexistente: 401 `CREDENCIAIS_INVALIDAS`, como hoje (não vira oráculo) |
| Token de acesso aberto (toda rota autenticada: BKO, apps, `/v1/sync/*`, `/v1/arquivos/*`, `/v1/diagnosticos`, rotas dos módulos) | 403 `EMPRESA_INATIVA` na requisição seguinte: o `autenticar` lê o status junto com o usuário, na mesma consulta |
| Renovar (`POST /v1/auth/refresh`) | 403 `EMPRESA_INATIVA`; o refresh **não** é revogado |
| "Esqueci a senha" | 202 `{}` sem gerar senha nem e-mail (como hoje) |
| Portal do admin do cliente | login com senha certa só em empresas inativas: 403 `EMPRESA_INATIVA`; empresa inativa sai do "Escolha a empresa"; sessão aberta numa empresa que foi inativada: 401 na requisição seguinte (como hoje, pela `sa_*`) |
| Super-admin no portal | lista e vê a empresa e usa Reativar, Backup e Excluir. As rotas de dado do tenant (bases, integração) seguem com 404 "Empresa não encontrada ou inativa", como hoje |
| Hub de integração (`/integracao/v1/*`, chave do Conector) | 403 `empresa_inativa` (passo 4 do `conector.ts`, junto da licença). O Conector pausa e tenta a cada 15 min, sem perder nada: os dados continuam no ERP |
| Jobs do agendador | já param (`tenants_ativos()` só traz `ativo`) |
| Despachante da outbox | segura os eventos do tenant inativo (não entrega nem conta tentativa). Ao reativar, eles seguem. Exceção: os `plataforma.tenant.*` |
| E-mails (`plataforma.email_saida`) | o worker não envia os do tenant inativo: ficam aguardando e vencem pelo prazo normal |
| App (Campo e Gestão) | ao receber 403 `EMPRESA_INATIVA`, mostra `MENSAGEM_EMPRESA_INATIVA` (texto final do designer-ux) e para de sincronizar. **Não apaga** os dados locais nem a fila (diferente do 423 de aparelho bloqueado) |

4. **Auditoria**: uma linha `tenant.inativado` ou `tenant.reativado` em `plataforma.auditoria_plataforma`, com o motivo, o antes e o depois, e o evento `plataforma.tenant.inativado@1` ou `plataforma.tenant.reativado@1` na outbox do tenant, na mesma transação. Ações idempotentes: repetir dá 200 com `resultado: 'sem_mudanca'` e não grava evento.

### 2. Backup da empresa (RN-PLA-08)
1. **Formato**: exportação lógica por tabela, não `pg_dump`. Para cada tabela com `tenant_id` (a mesma lista do catálogo da `excluir_tenant`, em ordem de FK, mães antes das filhas) e mais a linha de `plataforma.tenant`, um arquivo NDJSON (`row_to_json` da linha inteira), compactado com gzip e cifrado. Mais um `manifesto.json` (`ManifestoBackupEmpresaSchema`): versão do formato, migração do banco, contagem, bytes e sha256 de cada parte. Os arquivos (fotos, prints, miniaturas) de `arquivos/<tenant_id>/` são **copiados no próprio bucket** (`CopyObject`, sem baixar).
2. **Onde**: bucket `macuxi-prod`, prefixo `backups-empresas/<tenant_id>/<backup_id>/` (`dados/<esquema>.<tabela>.ndjson.gz.cifrado`, `arquivos/...`, `manifesto.json`). Fica fora de `backups/` (a poda do diário só apaga `macuxi-*.dump`) e de `arquivos/`.
3. **Cifra**: AES-256-GCM por parte, com a chave `MACUXI_BACKUP_EMPRESA_CHAVE` (32 bytes, só no `segredos.env`). O `chave_id` vai no manifesto para permitir a rotação. Os arquivos copiados ficam como estão hoje (bucket privado, sem URL pública). Sem chave ou sem bucket, a rota responde 503 `BACKUP_INDISPONIVEL` (falha fechada).
4. **Quem executa**: o worker, com o papel `macuxi_worker`, por uma função `SECURITY DEFINER` nova do banco-dados (`plataforma.exportar_backup_pagina(p_backup, p_tabela, p_depois, p_limite)`). A função lê o tenant **da linha do backup** (nunca do argumento), confere que o backup está `em_andamento` e que a tabela é da lista, e devolve uma página por chave primária (keyset, 5.000 linhas). Não depende de superusuário nem do `macuxi_manutencao` na conexão da aplicação (ADR 0024 B1).
5. **Estado**: tabela `plataforma.backup_empresa` com `em_andamento` → `pronto` | `falhou` (`apagado` depois da retenção), `progresso_pct`, contagens, `erro_codigo` (código técnico, sem mensagem), `consistente`. A coluna é `empresa_id`, **sem `tenant_id` e sem FK** (exceção da regra 5, como a `plataforma.tenant` e a `auditoria_plataforma`). Assim o registro sobrevive à exclusão. RLS ligado; só as `sa_*` do portal e a função do worker leem. Um backup por vez por empresa (409 `BACKUP_EM_ANDAMENTO`). O `id` vem do portal (idempotente). Worker caído: o job volta a `em_andamento` a partir da última tabela confirmada (as partes são idempotentes pelo nome).
6. **Consistência**: sem transação longa, para não segurar o horizonte do pull de todos os tenants. O backup feito com a empresa **inativa** do começo ao fim é `consistente` (nada escreve: API, Conector, outbox e jobs parados). Feito com a empresa ativa, ele é permitido, mas sai `consistente: false` e não libera a exclusão.
7. **Tempo e tamanho esperados**: a demo tem 1.802 linhas e 115 tabelas, então leva segundos e menos de 1 MB. Um cliente médio (50 usuários, 5 mil clientes, 20 mil produtos, 1 ano de pedidos, cerca de 2 milhões de linhas) dá de 100 a 300 MB compactados e de 2 a 5 minutos de dados. As fotos dominam: 50 mil fotos de cerca de 300 KB somam 15 GB e de 20 a 40 minutos de cópia no bucket. O portal mostra o progresso. A rota responde 202 na hora.
8. **Retenção** (RN-PLA-11): 30 dias com a empresa existindo, ficando sempre o mais novo pronto. O backup que serviu a uma exclusão fica 90 dias depois dela, e depois o worker apaga. **Ainda vale**: o dump diário do banco inteiro guarda a empresa excluída por até 30 dias (ADR 0028).
9. **Restaurar**: comando `tenant:restaurar --backup <id>` na ferramenta `tenant` da VM, com a conexão do migrador (`macuxi_manutencao`), como o `tenant:criar`. Só restaura no banco com a mesma migração do backup. A empresa volta **inativa**, e o super-admin confere e reativa. O ensaio de restauração entra no CI (`*.db.test.ts`). Passos: desenho §3.

### 3. Excluir (RN-PLA-09/10)
1. **Pré-condições** (`conferirExclusao` no SDK; a API revalida na transação):
   - a empresa está inativa;
   - há um backup `pronto` da própria empresa, `consistente`, iniciado **depois** da última inativação e concluído há no máximo **7 dias** (`PRAZO_BACKUP_PARA_EXCLUIR_DIAS`).

   Recusas 422: `EXCLUSAO_EMPRESA_ATIVA`, `EXCLUSAO_SEM_BACKUP`, `EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO`, `EXCLUSAO_BACKUP_VENCIDO` e `EXCLUSAO_CODIGO_NAO_CONFERE`. 409 `EXCLUSAO_EM_ANDAMENTO`.
2. **Confirmação forte**: diálogo com o nome e o código da empresa. O super-admin digita o código (`AM4821`) e a **própria senha**, conferida de novo (403 `REAUTENTICACAO_FALHOU`, que conta no limite de falhas do portal), e escolhe o backup (`backup_id` no corpo).
3. **Execução**: job assíncrono (`plataforma.exclusao_empresa`, sem `tenant_id`, como o backup), pelo worker, com a função `SECURITY DEFINER` `plataforma.executar_exclusao` (dono: migrador; EXECUTE só para o `macuxi_worker`) e a `excluir_tenant` (B2). Etapas: desenho §2.

   As cópias em `backups-empresas/` ficam pela retenção (§2.8).
4. **Código da licença**: **não é reaproveitado**. O registro `plataforma.empresa_excluida` (id antigo, código, CNPJ, razão social, `excluida_em`, `backup_id`, super-admin) guarda o código. O `sortear_codigo_licenca` e o `provisionar_tenant` recusam o código que está nele. Assim a restauração volta com o mesmo id e o mesmo código, e o app instalado com o código antigo nunca entra em outra empresa. A assinatura (ADR 0047) é apagada junto com o tenant.
5. **Auditoria**: linhas `tenant.exclusao_pedida`, `tenant.excluido` (com `detalhes` = payload de `plataforma.tenant.excluido@1`: contagem por tabela, sem dado pessoal) e `tenant.exclusao_falhou` em `plataforma.auditoria_plataforma`, que não tem `tenant_id` e sobrevive. O evento `excluido` **não passa pela outbox**: o `plataforma.evento` do tenant some na mesma transação.

### 4. Contratos (`packages/platform-sdk/src/empresa-acoes.ts`)
Rotas do portal, só super-admin, atrás de `MACUXI_EMPRESA_ACOES=1` (padrão desligado, como os planos):

| Rota | Corpo / resposta | Erros |
|---|---|---|
| `POST /v1/plataforma/empresas/:tenant_id/inativar` | `InativarEmpresaSchema` → 200 `SituacaoEmpresaRespostaSchema` | 404 `TENANT_NAO_ENCONTRADO`, 409 `EXCLUSAO_EM_ANDAMENTO` |
| `POST /v1/plataforma/empresas/:tenant_id/reativar` | `{}` → 200 `SituacaoEmpresaRespostaSchema` | 404, 409 `EXCLUSAO_EM_ANDAMENTO` |
| `POST /v1/plataforma/empresas/:tenant_id/backups` | `PedirBackupEmpresaSchema` → 202 `BackupEmpresaSchema` | 404, 409 `BACKUP_EM_ANDAMENTO` / `EXCLUSAO_EM_ANDAMENTO`, 503 `BACKUP_INDISPONIVEL` |
| `GET /v1/plataforma/empresas/:tenant_id/backups[/:backup_id]` | → 200 `ListaBackupsEmpresaSchema` (até 20) / `BackupEmpresaSchema` | 404 |
| `POST /v1/plataforma/empresas/:tenant_id/exclusao` | `ExcluirEmpresaSchema` → 202 `ExclusaoEmpresaSchema` | 404, 409, 422 (§3.1), 403 `REAUTENTICACAO_FALHOU` |
| `GET /v1/plataforma/empresas/:tenant_id/exclusao` | → 200 `ExclusaoEmpresaSchema` (também depois de concluída, pelo registro) | 404 |
| `GET /v1/plataforma/empresas` (já existe) | item ganha `acoes?: AcoesDaEmpresaSchema` (aditivo): inativação, último backup, exclusão e `exclusao_bloqueada` | — |

Eventos `plataforma.tenant.*@1` (`EVENTOS_TENANT`): ver `.coord/contratos/eventos.md`. Nenhum módulo precisa consumir: o bloqueio é da plataforma.

## Alternativas descartadas
- **`pg_dump` por tenant**: o `pg_dump` não filtra linhas. Com `--enable-row-security` e um papel no contexto do tenant, depende de papel com LOGIN e segredo novo para cada execução. Restaurar um dump parcial no banco em uso também não é seguro.
- **CSV por tabela**: perde a diferença entre nulo e texto vazio e os tipos `jsonb`/array. O NDJSON da linha inteira volta com `jsonb_populate_record`.
- **Backup numa transação `REPEATABLE READ` longa** (consistente com a empresa ativa): seguraria o horizonte de todos os tenants por minutos (o pull do sync e o vacuum).
- **Revogar as sessões ao inativar**: obrigaria todos a entrar de novo ao reativar. A fila offline do aparelho ficaria presa até o novo login. O corte já é imediato pelo status.
- **Novo valor `inativo` no check**: migração e troca em todo lugar que usa `suspenso`, sem ganho. O rótulo resolve.
- **Excluir direto pela API (síncrono)**: uma empresa grande leva minutos de DELETE, além do prazo do HTTP. Também exigiria a conexão do migrador na API (S0-028).

## Consequências
- Fecha um furo de hoje: empresa suspensa com token aberto continuava acessando. O `autenticar` passa a ler o status em toda requisição, na mesma consulta do usuário, sem custo de ida ao banco a mais.
- O worker passa a falar com o bucket para cópia e remoção em massa (`CopyObject`, `ListObjectsV2`, `DeleteObjects` no cliente S3 mínimo, sem SDK novo).
- Segredo novo: `MACUXI_BACKUP_EMPRESA_CHAVE` (produção e demo). Sem ele, o backup fica desligado e a exclusão também, porque não há backup que a libere.
- Regra 5 ganha duas exceções documentadas (`backup_empresa` e `exclusao_empresa` com `empresa_id` sem FK) e um registro novo (`empresa_excluida`).
- RN novas a registrar no doc 03: RN-PLA-07 a RN-PLA-11 (texto no desenho, §6).
