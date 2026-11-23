# Revisão final — "Zerar dados" (v1.0.31, ADR 0068, RN-PLA-12)

Revisor: `engenheiro-software`, 23/11/2026, ~17h (Manaus). Sem recado (pedido da sessão E): este parecer vai ao gerente e aos donos.
Diffs revistos contra o `origin/main` f2556d681:
- banco-dados `nuvem/v1030-zerar-banco-dados` 2d9578b81;
- modulo-integracao `nuvem/v1031-zerar-modulo-integracao` c32abc632;
- engenheiro-apps `nuvem/v1030-zerar-engenheiro-apps` e4fc95fb6 (só `apps/web`);
- testes `nuvem/v1031-zerar-testes` cf2bd3d9f;
- engenheiro-software `nuvem/v1030-zerar-engenheiro-software` d31bca66b (o meu, com o mesmo rigor).

Revisão de leitura: nenhum teste rodado nesta sessão. A sessão C da v1.0.29 entrou na conferência dos conflitos (`nuvem/v1029-revisao-pre-cadastro-banco-dados`, 0098 e 0099).

**Veredito: com 🔴 (3).** O lote não vai ao build antes de corrigir os três.

## 🔴 Bloqueiam

1. **engenheiro-apps** (texto do designer-ux): `apps/web/lib/portal-empresa-zerar.ts:35`, exibido em `apps/web/components/portal/dialogo-zerar.tsx:171`.
   - **Problema:** no zerar da empresa inteira, a tela diz "Mantém: empresa, plano, **usuários**, perfis, parâmetros e conectores.". A `limpar_cadastros` apaga os usuários que não são administradores (`0100…up.sql:278-283`; desenho §9, linha 264; teste Z-08: "ficam administradores"). O texto está errado justo na confirmação de uma ação destrutiva.
   - **Correção:** trocar por "administradores" ou tirar "usuários". Passa de novo pelo designer-ux e pelo corretor.

2. **engenheiro-software + banco-dados**: a prévia roda a limpeza inteira no pool do portal.
   - **Problema:** o pool do portal tem `statement_timeout=10000` (`apps/api/src/servidor.ts:78`). A `sa_previa_zerar` (`0100…up.sql:735-779`) roda a `limpar_cadastros` completa: copia cada linha em `to_jsonb` para a `limpeza_copia`, inclusive o corpo do `lote_staging`, faz os UPDATE e os DELETE e só então desfaz. Duas consequências:
     - Numa empresa de volume real, isso passa de 10 s. A prévia falha, o botão nunca libera (`zerarLiberado` exige a prévia) e o limite de 2 milhões (`ZERAR_VOLUME_ALTO`) nunca é alcançado pela prévia.
     - Enquanto a prévia roda, as linhas da empresa ficam travadas, e o app espera sem `lock_timeout`.
   - **Nenhum teste mede tempo:** o banco dos testes é pequeno.
   - **Correção (escolher uma, com medição numa base de volume real antes do build):**
     - (a) dar à prévia um prazo e um `lock_timeout` próprios (`set local` numa transação da rota, como o `SQL_PRAZO_PROVISIONAR`) e devolver um 503/422 claro quando estourar;
     - (b) um modo "contar" na `limpar_cadastros`: a mesma cascata, sem cópia, sem UPDATE e sem DELETE. A regra continua num lugar só.

3. **banco-dados** (condição de merge com a v1.0.29):
   - **Problema:** o branch da 0100 não traz a 0098 e a 0099 da sessão C. Mesmo assim, o cabeçalho da 0100 diz "em cima da 0098 e 0099" e o número ainda é provisório.
   - **O que quebra:** o `db/testes/resumo-outbox-vivos.db.test.ts:140` da C espera `migrarUp(c)` = só a 0099, e a `:155` sobe tudo. Com a 0100 no `main`:
     - o `aplicadas` vira `[0099, 0100]`;
     - o `migrarDown({ passos: 1 })` desfaz a 0100, não a 0099, e o teste da C cai.
   - Os dois branches também mexem em `db/testes/estatico.test.ts`, `db/src/excecoes.ts`, `docs/banco/{README,plataforma,rls}.md`.
   - **Correção:** a C entra primeiro. A 0100 vem por cima do `main` com a C, com o número confirmado pelo gerente. O teste da C passa a `migrarUp(c, { ate: VERSAO })` nas linhas 140 e 155. Por último, rodar `db/testes` inteiro na sessão.

## 🟡 Corrigir

- **banco-dados**, `0100…up.sql:252`, trava global do Hub:
  - **Problema:** `lock table integracao.lote, registro_atual, sessao_carga in share row exclusive` trava essas tabelas para **todas** as empresas durante a transação do zerar (até 15 min). Nesse tempo, todo INSERT, UPDATE e DELETE do Hub de qualquer cliente espera e cai no `statement_timeout` de 30 s da API. Era aceitável no workflow manual do #675. Com um botão no portal, o efeito alcança as outras empresas.
  - **Correção:** trava por empresa. Por exemplo, um `pg_advisory_xact_lock` por tenant que o Hub também tome ao abrir e processar o lote, ou `select … for update` no `conector` da empresa. Se a trava global ficar, a ADR 0068 diz isso, e a medição do 🔴 2 também mede o tempo do executar.
- **banco-dados**, `0100…up.sql:582-605`, sem teto de tentativas:
  - **Problema:** a `pegar_zerar` conta as `tentativas` e não tem teto. Se o processo morrer no meio (OOM, deploy), o mesmo pedido volta a cada 10 min para sempre, cada vez com a trava acima.
  - **Correção:** com `tentativas >= 3`, fechar `falhou` `ZERAR_CONCORRENCIA` (ou `ZERAR_FALHOU`) na própria `pegar_zerar`, com auditoria.
- **banco-dados**, `db/testes/referencia/limpar-cadastros-675.sql`, cópia da rotina:
  - **Problema:** ficam no `main` 244 linhas, cópia literal da rotina que sai de `scripts/producao`, como oráculo do teste de equivalência. É a cópia da regra que a revisão pediu para não existir: toda mudança intencional da regra obriga a mexer num texto marcado "não editar".
  - **Correção:** trocar o oráculo pelo resultado esperado (tabela, modo e linhas) nos dados de `scripts/producao/teste/limpar-cadastros-dados.sql`, guardado no teste, e apagar a referência.
- **engenheiro-software (eu)**, a regra RN-PLA-12 está em dois lugares:
  - `conferirZerar` (`packages/platform-sdk/src/empresa-zerar.ts:280`) e `plataforma.zerar_bloqueado` (`0100…up.sql:531-562`, com o limite `2000000` fixo nas linhas 557 e 648).
  - Em produção vale só a SQL: a `conferirZerar` só alimenta o portal falso (`apps/web/lib/portal-falso-zerar.ts:149`).
  - Os comentários `apps/api/src/empresa-zerar-portal.ts:8` e `:100` e `empresa-zerar.ts:242` dizem que a API ou a `sa_pedir_zerar` usam a `conferirZerar`, o que está errado.
  - **Correção:**
    - acertar os comentários;
    - o teste de banco confere a mesma ordem de recusas da `conferirZerar` e o `LIMITE_LINHAS_ZERAR` contra a função SQL;
    - ou a `conferirZerar` sai do SDK e o portal falso devolve o bloqueio fixo.
- **engenheiro-software (eu)**, `apps/api/src/empresa-zerar-worker.ts:187`:
  - **Problema:** qualquer falha na conferência da 0100 ao subir (banco fora, rede) desliga o zerar até reiniciar o processo, com a mensagem "falta a migração 0100". Os pedidos ficam `em_andamento` para sempre, e o portal consulta a cada 5 s.
  - **Correção:** distinguir erro de conexão (registrar o erro e tentar de novo no laço) de "função ausente".
- **gerente-projetos + banco-dados + testes**, processo (R-20261115-171000, erro 3):
  - A 0100 muda a lista de `sa_*` (38 → 41) e a de funções do worker.
  - O teste que confere essa lista está no branch do testes (`tests/integracao/banco/conformidade.test.ts`).
  - Os dois saem juntos no PR conjunto `alexandre/migracao-<item>`, não em dois PRs.
- **gerente-projetos**, ADR 0068 (erro 13):
  - Não achei a reserva do número 0068 no `.coord/quadro.md` do `origin/main`.
  - A `0068` não existe em `docs/decisoes/` do `main`, e o branch `nuvem/v1029-adr-0069-engenheiro-software` já usa a 0069.
  - **Correção:** registrar a reserva no quadro antes do merge.

## 🟢 Sugestões

- **engenheiro-software (eu)**:
  - `apps/api/src/empresa-zerar-worker.ts:92-109`: resposta da `executar_zerar` fora do contrato (`safeParse` falhou) é registrada como "zerar dados concluído" com campos nulos. Registrar `warn` "resposta fora do contrato".
  - `apps/api/src/empresa-zerar-portal.ts:76`: o código `ID_EM_USO` não está em `CODIGOS_ZERAR_EMPRESA` e fica sem frase em `mensagemDoZerar`.
- **engenheiro-apps**: `apps/web/lib/portal-empresa-zerar.ts:4` repete o comentário errado de que "a API calcula com `conferirZerar`" (ver o 🟡 da regra em dois lugares).
- **testes**: o número velho "0099" no lugar de 0100 aparece em:
  - `tests/integracao/banco/conformidade.test.ts:19`, `:102`, `:168` e `:228`;
  - `tests/integracao/api/zerar-dados-v1031.test.ts:5`;
  - `docs/testes/v1031-zerar-dados.md:3`.

  Os dos testes são só comentário e não seguram o lote (R-20261111-190159). O do doc entra junto.
- **modulo-integracao**, `modules/integracao/api/bko-monitor.ts` (`rotaMonitorDetalhes`) e `contracts/monitor-detalhes.ts`: o `cursores[].external_id` é a chave do ERP do último registro. Ela pode ser um CPF ou CNPJ quando o ERP usa o documento como chave, e o cabeçalho do contrato diz "nenhum valor de linha". Isso é aceitável só para o super-admin, sem log. Acertar o comentário ou mascarar.

## Conferido sem achado

- **Fronteiras:** `modules/integracao/{api,domain,contracts,web}` só importam `@macuxi/platform-sdk` e o próprio módulo. `apps/web` usa `@macuxi/integracao/contracts` (`ROTULO_ENTIDADE`). O SDK não importa módulo: `ENTIDADES_ZERAR` é conferida contra `ORDEM_CARGA_ENTIDADES` em `apps/api/test/empresa-zerar-portal.test.ts`.
- **RLS e tenant:**
  - toda consulta da `rotaMonitorDetalhes` filtra `tenant_id = $1` dentro de `ctx.comTenant`;
  - a `limpar_cadastros` filtra `x.tenant_id = p_tenant` em toda raiz, na cascata, na cópia, no UPDATE e no DELETE;
  - `zerar_empresa` e `limpeza_copia` têm RLS ligado e forçado, só a política `manutencao` e nenhum grant (`conferir-rls.sql` e `excecoes.ts` atualizados).
- **SECURITY DEFINER e grants:**
  - todas as funções têm `search_path` com `pg_catalog` primeiro e `pg_temp` por último;
  - `revoke … from public`;
  - EXECUTE das 3 `sa_*` só ao `macuxi_portal`, das 4 do worker só ao `macuxi_worker`, e a regra e as internas de ninguém;
  - um DO no fim da 0100 aborta a migração se algum grant estiver errado.
- **Só super-admin:**
  - na API: `exigirSuperAdmin` nas 3 rotas, `superAdmin: 'exige'` no `monitor/detalhes` e `'aceita'` no monitor e no reprocessar, no padrão do ADR 0029, com a auditoria `via: 'super_admin'`;
  - no banco: as 3 `sa_*` dão 28000 para sessão inválida e 42501 para quem não é super-admin.
- **Senha:** conferida de novo antes da `sa_pedir_zerar`, pelo `criarReautenticar` comum, com o mesmo limite de falhas do login.
- **Idempotência:** o mesmo `id` devolve o mesmo zerar, e id de outra empresa dá 23505 → 409. O `pg_advisory_xact_lock` por empresa e o único parcial `em_andamento` impedem dois pedidos juntos. `executar_zerar` e `fechar_zerar` são idempotentes.
- **Execução:** transação única com a cópia antes de cada UPDATE ou DELETE. Falha = ROLLBACK, e o teste Z-07 prova que nada sai.
- **Worker:**
  - pool próprio de 1 conexão, com `statement_timeout` 15 min e `lock_timeout` 5 s por `set local`;
  - 3 tentativas só para 23503, 40001, 40P01 e 55P03, e as recusas do `hint` fecham sem nova tentativa;
  - a concessão de 10 min não deixa dois executarem o mesmo pedido: o `for update` da `executar_zerar` e o `skip locked` da `pegar_zerar` cuidam disso;
  - `parar()` encerra os dois laços e o pool, e o `worker.ts` aguarda.
- **Logs:** só ids, códigos, SQLSTATE e contagens, sem senha, código digitado, nome ou documento.
- **Contratos Zod:** `.strict()` em todos, `superRefine` da coerência situação × campos igual aos CHECKs da tabela, e `plataforma.tenant.zerado@1` registrado em `.coord/contratos/eventos.md`.
- **Workflow de produção:**
  - sem a 0100, o `montar-limpeza.sh` para antes de qualquer mudança, com uma mensagem clara;
  - o lote do portal (com sufixo) é aceito no restaurar e no descartar;
  - a validação da lista de entidades está no YAML e no psql;
  - a rotina saiu de `scripts/producao` e a regra ficou só na 0100.
- **Down da 0100:** devolve as cópias para a `public.macuxi_limpeza_backup` do #675 e documenta a perda dos registros do portal.
- **Conflitos com a v1.0.29:** fora o 🔴 3, nenhum branch da v1.0.29 mexe em `apps/api/src/app.ts`, `worker.ts`, `apps/web/components/portal/aba-integracao.tsx` ou `apps/web/lib/portal-falso.ts`.
