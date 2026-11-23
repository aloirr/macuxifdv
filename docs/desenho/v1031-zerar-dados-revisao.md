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

---

# Rodada 2 — 23/11/2026, ~19h30 (Manaus)

Diffs revistos contra os SHAs da rodada 1 e contra o `origin/main` f2556d681:
- banco-dados 36d958549 (antes 2d9578b81);
- engenheiro-software 6ccd07e32 (antes d31bca66b);
- engenheiro-apps 5e46817be (antes e4fc95fb6; contém o 6ccd07e32 por merge);
- modulo-integracao c32abc632 (sem mudança);
- testes `nuvem/v1031-zerar-testes` 5a54d2876 (o mais novo do remoto às 19h30).

Revisão de leitura, sem rodar testes nesta sessão. As medições citadas são dos donos.

**Veredito: com 🔴 (1), só no branch do testes.** O código do banco, da API, do SDK e do portal fica sem 🔴. O lote sai quando o testes subir o reteste no fluxo novo e o 🔴 3 da rodada 1 for cumprido na ordem de merge.

## Os 🔴 da rodada 1

1. **Texto do "Mantém"** (engenheiro-apps): **resolvido.**
   - `apps/web/lib/portal-empresa-zerar.ts:38` diz "Mantém: empresa, plano, administradores, perfis, parâmetros e conectores.", só no zerar inteiro (`dialogo-zerar.tsx`, `!entidades?.length`).
   - O grupo "Usuários não administradores" (`core.usuario`, `usuario_perfil`, `usuario_modulo`) entra no "Apaga:" (`packages/platform-sdk/src/empresa-zerar.ts`, `GRUPOS_ZERAR` e `grupoDaTabelaZerar`).
   - Fica a premissa da ADR 0068 (Consequências): o Alexandre ainda precisa confirmar a regra dos usuários do #675.
2. **Prévia no pool do portal** (engenheiro-software + banco-dados): **resolvido.**
   - A prévia virou trabalho do worker: `sa_pedir_previa_zerar` e `sa_ler_previa_zerar` só ao `macuxi_portal`, `pegar_previa_zerar` e `executar_previa_zerar` só ao `macuxi_worker`. A conferência pelo catálogo no fim da 0100 cobre as 42 `sa_*` e as 6 do worker.
   - A `limpar_cadastros(..., p_simular)` roda as mesmas raízes e a mesma cascata, só com `count(*)`, sem cópia, sem UPDATE, sem DELETE e sem trava (`0100…up.sql:440-445` e `468-512`).
   - O worker usa um pool próprio de 2 conexões, com `statement_timeout` de 15 min e `lock_timeout` de 5 s por `set local` (`empresa-zerar-worker.ts:90-105`).
   - Os testes `empresa-zerar.db.test.ts:408` e `:586` mostram que o simular conta o mesmo que o executar, na empresa inteira e por entidade.
   - Medição informada: 400 mil linhas, prévia em 1,35 s e zerar inteiro desfeito em 13,9 s. Na proporção, 2 milhões dão cerca de 70 s, dentro dos 15 min.
3. **Ordem de merge com a sessão C** (banco-dados + gerente): **continua como condição de merge, não de código.**
   - O branch da C (`nuvem/v1029-revisao-pre-cadastro-banco-dados` 1ea0ec192) ainda tem `migrarUp(c)` sem `ate` em `db/testes/resumo-outbox-vivos.db.test.ts:140` e `:154`.
   - O doc do testes registra o mesmo problema como D-1 (`docs/testes/v1031-zerar-dados.md:44`).
   - A C entra primeiro, com `{ ate: VERSAO }` nas duas linhas. Depois a 0100 vem por cima do `main`, com o número confirmado pelo gerente, e `db/testes` roda inteiro na sessão antes do push.

## Os 🟡 da rodada 1

- **Trava global do Hub** (banco-dados): **resolvido.**
  - Saiu o `lock table`. Ficaram `for update` no `integracao.conector` e nos `integracao.lote` da empresa (`0100…up.sql:303-306`), e o simular não trava nada.
  - Conferi: lote, sessão de carga, `registro_atual` e as demais tabelas do Hub têm FK `(tenant_id, conector_id)` para o conector (`0010`, `0094`, `0096`). O INSERT toma FOR KEY SHARE, que espera o FOR UPDATE.
  - A troca de situação do lote espera o FOR UPDATE dos lotes, e o staging novo, com FK para o lote, também espera.
  - O teste com duas conexões é o `empresa-zerar.db.test.ts:798`.
- **Teto de tentativas** (banco-dados): **resolvido.**
  - `pegar_zerar` fecha `falhou` `ZERAR_FALHOU` com auditoria quando `tentativas >= 3`. (`0100…up.sql:689-695`).
  - `pegar_previa_zerar` faz o mesmo e ainda apaga as prévias vencidas.
  - Teste: `empresa-zerar.db.test.ts:684`.
- **Cópia da rotina do #675** (banco-dados): **resolvido.**
  - `db/testes/referencia/limpar-cadastros-675.sql` saiu. O teste guarda o retrato fixo (`RETRATO_675`, `:408-423`).
- **Regra em dois lugares** (engenheiro-software): **resolvido.**
  - `conferirZerar` e `LIMITE_LINHAS_ZERAR` saíram do SDK, e o teste `empresa-zerar.test.ts:51` garante que não voltam.
  - O bloqueio mora só na `plataforma.zerar_bloqueado`, e o portal falso devolve um bloqueio fixo.
  - Os comentários da API, do SDK e do `apps/web/lib/portal-empresa-zerar.ts:4` foram acertados.
- **Banco fora na subida** (engenheiro-software): **resolvido.**
  - Com erro de conexão, a `criarConferenciaMigracao` (`empresa-zerar-worker.ts:258-276`) devolve o erro ao laço e confere de novo no ciclo seguinte. Só a função ausente desliga o zerar.
  - Testes: `empresa-zerar-worker.test.ts:264` e `:275`.
- **PR conjunto da lista de `sa_*`** (gerente + banco-dados + testes): **aberto.** A lista agora tem 42 (sai a `sa_previa_zerar`, entram 2) e o teste da lista é o do 🔴 abaixo.
- **Reserva da ADR 0068 no quadro** (gerente-projetos): **aberto.** O `.coord/quadro.md` do `origin/main` continua sem a reserva.

Os 🟢 da rodada 1 também foram resolvidos: `warn` de "fora do contrato", `ID_EM_USO` em `CODIGOS_ZERAR_EMPRESA`, o comentário do `apps/web` e o "0099" no doc do testes. Fica aberto o 🟢 do `modulo-integracao` (`cursores[].external_id`), sem mudança no c32abc632.

## Rodada 2 — 🔴 bloqueia

1. **testes**: o branch `nuvem/v1031-zerar-testes` 5a54d2876 ainda testa o fluxo da rodada 1, que não existe mais.
   - `tests/integracao/banco/conformidade.test.ts:170` lista a `plataforma.sa_previa_zerar(p_sid, p_tenant, p_entidades)`, que a 0100 apagou. A conferência das `sa_*` cai no banco migrado.
   - `tests/integracao/api/zerar-dados-v1031.test.ts:158`, `:351` e `:352` chamam `GET …/zerar/previa[?entidades=]`. A rota virou `POST …/zerar/previa` (202) e `GET …/zerar/previa/:previa_id`.
   - Nas linhas `:461` e `:573`, o teste usa `pv.total_linhas`, que virou `total`, e a prévia agora só fica pronta depois do `executar_previa_zerar` do worker.
   - **Correção:** refazer o reteste com banco-dados 36d958549 e engenheiro-apps 5e46817be, que contém o 6ccd07e32. Cobrir:
     - a prévia pedida, contada pelo worker e lida até `pronta`;
     - o 404 `ZERAR_PREVIA_NAO_ENCONTRADA`;
     - o teto de 3 tentativas;
     - a lista com 42 `sa_*` e 6 funções do worker.
   - O e2e (`tests/e2e/bko/integracao-simples.spec.ts`) também precisa passar com a tela nova ("Contando os dados…" e depois o resumo).
   - Se o reteste em curso já cobre tudo isso, o 🔴 cai quando o SHA novo chegar ao remoto.

## Rodada 2 — 🟡 corrigir

1. **engenheiro-software (eu)**: a ADR 0068 e o desenho não batem com a 0100.
   - `docs/decisoes/0068-zerar-dados-da-empresa.md:40` rejeita o **modo "contar"** na `limpar_cadastros` ("um segundo caminho no corpo da regra"). Só que a 0100 adotou exatamente esse modo: `p_simular`, que conta sem cópia, sem UPDATE e sem DELETE, além de rodar numa subtransação desfeita.
   - A assinatura em `:21` não traz o `p_simular`.
   - `docs/desenho/empresa-zerar.md:72` diz que "a prévia é a mesma função desfeita" e `:82` diz que ela "roda a `limpar_cadastros` numa subtransação desfeita", sem falar do simular.
   - **Correção:**
     - a decisão passa a ser "mesma função, modo simular", com a garantia de igualdade nos testes `:408` e `:586` do banco;
     - a alternativa rejeitada vira a "limpeza rodada e desfeita", que custava a cópia `to_jsonb`;
     - a assinatura ganha o 5º parâmetro.
2. **banco-dados + engenheiro-software**: a lista das tabelas que não saem ficou repetida.
   - A prévia devolve `linhas` sem o `modo` (`0100…up.sql:905`). Por isso o SDK mantém uma segunda lista das tabelas que só mudam: `TABELAS_QUE_NAO_SAEM` (`packages/platform-sdk/src/empresa-zerar.ts:106`), usada no `superRefine` (`:304`) e no agrupamento.
   - Se a `limpar_cadastros` ganhar outro modo que não apaga, o banco soma certo, mas o SDK recusa a prévia ("fora do contrato") ou agrupa errado.
   - **Correção:**
     - banco-dados: incluir `'modo', l.r_modo` no `v_linhas` da `executar_previa_zerar`;
     - eu: `LinhaPreviaZerarSchema` com `modo`, e a `TABELAS_QUE_NAO_SAEM` sai.
   - Muda o contrato, mas a 0100 ainda é provisória e não está no `main`.
3. **engenheiro-apps + engenheiro-software**: a espera pela prévia não tem teto.
   - `apps/web/components/portal/dialogo-zerar.tsx:74` lê a cada 2 s enquanto a prévia está `em_andamento`, sem limite.
   - Com o worker fora (deploy, processo parado) ou com a prévia passando dos 15 min, a tela mostra "Contando os dados…" até a prévia vencer: 1 hora, e só então aparece o 404.
   - O cancelamento por `statement_timeout` (57014) não cai no `when others` da `executar_previa_zerar` (`0100…up.sql:915`) e volta 3 vezes.
   - **Correção:** um prazo no SDK, por exemplo `PRAZO_PREVIA_ZERAR_MS` de 2 min contado do `criado_em`. Passado o prazo, a tela mostra a frase de falha com "Tentar de novo", que pede uma prévia com id novo, como o `refazer` já faz. O texto passa pelo designer-ux e pelo corretor.

## Rodada 2 — 🟢 sugestões

- **banco-dados**: a medição foi feita com 400 mil linhas. Antes do build, vale uma medição perto do limite de 2 milhões, no executar, para confirmar a folga dos 15 min e o tamanho da `limpeza_copia` (desenho §3.1, linha 100: "continua valendo").

## Conferido sem achado (rodada 2)

- **Prévia:**
  - idempotente pelo id, e o id de outra empresa dá 23505 → 409 `ID_EM_USO`;
  - `sa_ler_previa_zerar` filtra empresa e validade, e a ausente dá 404;
  - o bloqueio é calculado na leitura (`zerar_previa_json` → `zerar_bloqueado`). Com um zerar em andamento, a tela vai direto ao andamento (`zerarJaRodando`).
- **Contrato `PreviaZerarSchema`:** `.strict()`, coerência situação × campos no `superRefine`, e `total` = soma das linhas que saem. Exceção: a lista repetida do 🟡 2.
- **Worker:**
  - os 3 laços (zerar, prévia, descarte) dividem 2 conexões sem aninhar `connect`;
  - a concessão de 2 min da prévia não duplica trabalho, porque a linha fica em `for update` durante a `executar_previa_zerar` e a `pegar_previa_zerar` usa `skip locked`;
  - a `parar()` encerra os 3 laços e o pool.
- **Down da 0100:** apaga as 4 `sa_*`, as 6 do worker, as internas e a `zerar_previa`. As do mapa saem por último, porque os CHECKs as usam.
- **Listas:** `funcoes-sa.ts`, `estatico.test.ts` e `excecoes.ts` (`zerar_previa` só por função, sem `tenant_id`) e a `conferir-rls.sql` foram atualizados.
- **Fronteiras:** sem mudança. O `apps/web` usa só `@macuxi/platform-sdk` e `@macuxi/integracao/contracts`.
- **Logs:** a prévia registra só ids, situação, total, tabelas, bloqueio e `erro_codigo`. A mensagem do banco só aparece sem SQLSTATE, via `mensagemSegura`.

# Rodada 3 — 23/11/2026, ~19h50 (Manaus)

Diffs revistos contra os SHAs da rodada 2 e contra o `origin/main` 918ba20d0 (v1.0.30, já com a sessão C):
- banco-dados 098a4d8f1 (antes 36d958549);
- engenheiro-software 88510349b (antes 6ccd07e32);
- engenheiro-apps df8aef9a8 (antes 5e46817be; contém o 88510349b por merge);
- testes `nuvem/v1031-zerar-testes` 10ad063f5 (antes 5a54d2876; o mais novo do remoto às 19h44);
- modulo-integracao c32abc632 (sem mudança).

Revisão de leitura, sem rodar testes nesta sessão. As medições citadas são dos donos.

**Veredito: sem 🔴 no código.** Fica o 🔴 3 da rodada 1 como **condição de merge** (não de código), agora mais concreto: a sessão C entrou no `main` sem o `{ ate: VERSAO }`. O lote sai com os 2 🟡 abaixo fechados e a condição cumprida.

## Os achados da rodada 2

1. 🔴 **testes, prévia antiga**: **resolvido** no 10ad063f5.
   - `tests/integracao/api/zerar-dados-v1031.test.ts` usa `POST …/zerar/previa` (202), o `cicloPrevia` do worker real e `GET …/zerar/previa/:previa_id` (`:168-182`), com 403 do admin do cliente e 404 `ZERAR_PREVIA_NAO_ENCONTRADA`, inclusive o id de outra empresa (`:406-412`).
   - Z-09 (`:647`) cobre o teto de 3 tentativas da prévia e do zerar, com a auditoria. Z-10 cobre a trava só da empresa, com duas conexões.
   - `tests/integracao/banco/conformidade.test.ts:170-178` tem as 42 `sa_*` sem a `sa_previa_zerar`, e `:232` em diante, as 6 do worker.
   - O reteste rodou na junção com os SHAs da rodada 2 (36d958549, 6ccd07e32, 5e46817be). O que sobra está no 🟡 1 abaixo.
2. 🔴 3 da rodada 1, **ordem de merge com a sessão C** (banco-dados + gerente): **continua como condição de merge, não de código.**
   - O `origin/main` 918ba20d0 (#677) já tem a 0098 e a 0099, e `db/testes/resumo-outbox-vivos.db.test.ts:140` e `:154` seguem com `migrarUp(c)` sem `ate`.
   - O branch do banco-dados (098a4d8f1) não contém o 918ba20d0.
   - **Condição:**
     - o banco-dados traz o `main` para o branch e põe `{ ate: VERSAO }` nas duas linhas, no mesmo PR da 0100;
     - resolve os conflitos que o testes já viu (`db/testes/estatico.test.ts`, `docs/banco/README.md`);
     - roda `db/testes` inteiro na sessão antes do push. O número 0100 continua livre no `main`.
3. 🟡 **ADR e desenho sem o `p_simular`** (eu): **resolvido** no 88510349b.
   - `docs/decisoes/0068-zerar-dados-da-empresa.md:21` traz o 5º parâmetro, e `:22` explica o simular.
   - `:43` troca a alternativa rejeitada pela "execução inteira desfeita".
   - `docs/desenho/empresa-zerar.md:10`, `:72` e `:82` batem com a 0100.
4. 🟡 **modo na prévia e lista repetida no SDK** (banco-dados + eu): **resolvido.**
   - O `v_linhas` da `executar_previa_zerar` traz `'modo', l.r_modo` (`0100…up.sql:903`). A `v_lista` saiu, e as `entidades_afetadas` saem do mesmo `v_linhas` (`:921`).
   - `LinhaPreviaZerarSchema` exige `modo` (`packages/platform-sdk/src/empresa-zerar.ts:266-268`), e `MODOS_QUE_SAEM` (`:102`) é a única lista do SDK. A `TABELAS_QUE_NAO_SAEM` saiu.
   - O teste de banco confere a prévia e o executado por `tabela modo linhas` (`db/testes/empresa-zerar.db.test.ts:637-639`).
   - Os portais falsos e os testes da API e da web passaram a mandar `modo`. Não sobrou nenhuma linha de prévia sem `modo` nos branches de código.
5. 🟡 **prazo da prévia na tela** (engenheiro-apps): **resolvido** no df8aef9a8.
   - `PRAZO_PREVIA_ZERAR_MS` de 2 min fica em `apps/web/components/portal/dialogo-zerar.tsx:60`, contado do pedido.
   - Quando o prazo vence, a consulta para (`:82`) e um disparo único acorda a tela (`:93`). A tela mostra a frase que já existia para `ZERAR_FALHOU` (`mensagemDaPreviaZerar`), com "Tentar de novo", que pede a prévia com id novo e reabre o prazo. Não há texto novo.
   - O teste está em `dialogo-zerar.test.tsx:74`.
   - A medida de 23 s para 2 milhões de linhas fica bem dentro dos 2 min.
6. 🟢 **medir perto de 2 milhões** (banco-dados): **resolvido.** Com 1.999.963 linhas, o zerar levou 1 min 27 s (dentro dos 15 min do worker) e a prévia, 23 s. A medida está registrada na ADR, no desenho e em `docs/banco/plataforma.md`.
7. 🟢 **`cursores[].external_id`** (modulo-integracao): **aberto**, sem mudança no c32abc632. Não segura o lote.

## Rodada 3 — 🟡 corrigir

1. **testes**: o reteste ainda não usa o `modo` e não rodou nos SHAs finais.
   - `tests/integracao/api/zerar-dados-v1031.test.ts:612-614` guarda uma terceira cópia da lista das tabelas que não saem (`ficamNaEmpresa`: `core.filial`, `plataforma.sync_pacote`, `plataforma.tenant`). O `:185` ainda diz "a prévia não tem o modo".
   - Com o `modo` obrigatório, o valor × regra passa a ser `total = soma das linhas com modo em MODOS_QUE_SAEM` (importado do SDK). "Prévia = executado" passa a comparar `tabela|modo|linhas`.
   - O doc `docs/testes/v1031-zerar-dados.md` precisa citar a junção com 098a4d8f1, 88510349b, df8aef9a8 e c32abc632 sobre o `main` 918ba20d0.
   - É o reteste curto em andamento: o 🟡 cai quando o SHA novo chegar ao remoto com esses pontos.
2. **gerente-projetos**, abertos desde a rodada 1:
   - a reserva da ADR 0068 no `.coord/quadro.md` do `origin/main`, que continua sem ela. A 0068 segue livre em `docs/decisoes/`, e a 0069 já existe;
   - o PR conjunto `alexandre/migracao-*` da lista de `sa_*` (0100 + `conformidade.test.ts`).

## Conferido sem achado (rodada 3)

- **Prazo da prévia:**
  - com o POST preso, `isPending` também conta para o prazo;
  - um erro de rede tem precedência (`!previa.isError`);
  - uma prévia que fica pronta depois do prazo não é relida, e a tela segue na falha até "Tentar de novo".
- **Cancelamento por `statement_timeout`:** o 57014 não cai no `when others` (`0100…up.sql:913`) e volta pelo teto de 3. A tela já desistiu aos 2 min, e com 23 s no limite de volume o caso fica remoto.
- **`entidades_afetadas_limpeza`:** lê só `tabela`, `modo` e `linhas`. A chave `ordem` a mais no jsonb não muda o resultado.
- **Workflow:** `scripts/producao/limpar-cadastros.sql:33` passa `gravar` como `p_exigir_hub_parado` e fica no `p_simular` padrão (false). Simular = execução desfeita, igual ao #675, sem trava do Hub. Coerente com o desenho §3.
- **Fronteiras, logs e contrato:** sem mudança fora do `modo`. `PreviaZerarSchema` continua `.strict()`, e a soma é conferida pelo `MODOS_QUE_SAEM`.
