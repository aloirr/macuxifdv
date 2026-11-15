# ADR 0055 — Consulta só leitura no banco de produção

- **Status**: proposta em 2026-11-15 (branch `nuvem/consulta-producao-engenheiro-software`). PR de governança: merge só com a
  autorização do dono do produto (número e SHA).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: R-20261115-073000-alexandre, item 5 ("autorizado"): workflow de consulta só leitura, só SELECT, usuário de
  banco só leitura, sem dado pessoal, disparo manual. Primeiro uso: vendedor do ERP VEN-000034 sem carteira no app e
  "Sem preço" no Catálogo pelo menu.
- **Quem implementa**: engenheiro-software (workflow, `scripts/producao/`, compose, `preparar-vm.sh`, esta ADR);
  banco-dados (papel `macuxi_leitura`, grants e políticas de RLS).

## Contexto
- O DBaaS só tem IP privado na VPC. Os workflows de produção chegam a ele por ssh na VM e `docker compose run` (o
  `pgcliente` usa a conexão de administração, que herda o `macuxi_manutencao` e enxerga todos os tenants).
- Os diagnósticos de campo pedem contagens e flags que o BKO não mostra. Sem caminho só leitura, a alternativa seria usar a
  conexão de administração à mão.

## Decisão
1. **Workflow `producao — consulta só leitura`** (`.github/workflows/producao-consulta.yml`): `workflow_dispatch`, só a
   partir do `main`, environment `PRODUCAO`, concorrência `producao-vm`.
2. **Catálogo versionado, nunca SQL livre**: `scripts/producao/consultas/<nome>.sql`, revisado por PR. O disparo escolhe o
   nome (lista `choice` igual ao catálogo, conferida por teste) e passa só o código do tenant e, quando a consulta declara,
   o `external_id`. Os valores entram como variáveis do psql (`-v`), nunca no texto.
3. **Verificador do catálogo** (`scripts/producao/consulta.mjs verificar`, rodado pelos testes de `scripts/ci`): um comando
   `select`/`with` por bloco; sem palavra de escrita, de transação ou de sessão; sem função com schema, `set_config`,
   `pg_sleep`, meta-comando ou `$`; filtro `tenant_id = :'tenant_id'` obrigatório; colunas declaradas em `@colunas` sem
   nome, e-mail, CPF/CNPJ, telefone, endereço ou segredo (só flags `sem_*`/`tem_*`/`com_*`/`*_vazio`/`*_preenchido`); coluna
   pessoal no SQL só dentro de um teste que vira flag; coluna sensível (a do item 4)
   recusada em qualquer uso, até como flag (senha: `core.v_leitura_usuario_senha.tem_senha`); sem asterisco (`select *`,
   `x.*`), só `count(*)`.
4. **Execução só leitura em três camadas**: papel `macuxi_leitura` (só SELECT, sem BYPASSRLS, RLS pelo `app.tenant_id`;
   nas tabelas com coluna sensível — hash, token, senha, segredo, chave, carga ou cifrad no nome, exceto boolean — o
   SELECT é por coluna, sem elas, para nenhum segredo nem hash chegar ao log do Actions; se o usuário tem senha, só pela
   view `core.v_leitura_usuario_senha (id, tenant_id, tem_senha)`; migração 0078, `docs/banco/rls.md`; o `banco-dbaas.sh`
   para a publicação se o papel faltar, tiver SUPERUSER/BYPASSRLS ou o `conferir-rls.sql` achar problema);
   serviço `pgleitura` do compose com `default_transaction_read_only=on`, `statement_timeout=15s`, `lock_timeout=2s`;
   script com `begin ... read only`, conferência do modo, tenant por `plataforma.tenant_por_codigo` e `rollback` no fim.
5. **Saída conferida antes de publicar**: cabeçalho igual a `@colunas`, flag pessoal só booleana, valores só com forma de
   contagem, id, flag, data ou código (sem espaço, e-mail, CPF/CNPJ ou telefone), até 200 linhas por bloco. Resultado no
   `GITHUB_STEP_SUMMARY` e em artifact de 7 dias; o CSV bruto não vai ao log e é apagado do runner.
6. **Sem secret novo**: a senha do `macuxi_leitura` nasce na VM (`/opt/macuxi/leitura.env`, `preparar-vm.sh`, modo 600,
   nunca regenerada), como a do `macuxi_portal`; só o `pgleitura` e o passo de papéis (serviço `banco`) leem o arquivo.

## Alternativas
- SQL livre no disparo com papel só leitura: descartada (dado pessoal na saída, consulta pesada sem revisão).
- Conexão de administração com `SET TRANSACTION READ ONLY`: descartada; enxerga todos os tenants e um erro de catálogo
  ainda teria o admin.
- Secret `PROD_PG_LEITURA_SENHA` no GitHub: desnecessário; a senha gerada na VM não sai dela.
- Environment novo com aprovação: o plano do repositório não tem "Required reviewers" (ADR 0046); a trava é o catálogo
  revisado, o disparo só do `main` e o papel só leitura.

## Consequências
- Primeiro uso depende de: (a) migração e passo de papéis do banco-dados (`macuxi_leitura`); (b) uma publicação que leve o
  `pgleitura` e o `leitura.env` à VM. Antes disso o workflow para com a mensagem "publique uma versão".
- Consulta nova = PR no catálogo (dono engenheiro-software), revisada como código.
- Tabela nova com RLS precisa da política de leitura do `macuxi_leitura` (o banco-dados inclui na conferência
  `conferir-rls.sql`), senão a consulta devolve 0 linhas.
