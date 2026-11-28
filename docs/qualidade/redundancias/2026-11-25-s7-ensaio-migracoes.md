# Corretor — ensaio das migrações em produção (governança, engenheiro-software)

> **Renumerado em 28/11/2026 (S21, [2026-11-28-s21-catalogo-consolidado](2026-11-28-s21-catalogo-consolidado.md)):** os achados deste relatório saíram com RD-3723 a RD-3728 no #820 (`nuvem/v1036-ensaio-corretor-redundancias` @ 7f180312), números também dados aos perfis da E5 (S18). Aqui valem RD-3746 a RD-3751, na mesma ordem.

25/11/2026, Manaus. Branch `nuvem/v1036-ensaio-engenheiro-software`, SHA `d02ebd533053f872e99b83894e008e1b08850183` (1 commit sobre o `main` 168356801).
Arquivos: `.github/workflows/producao-ensaio-migracoes.yml`, `.github/scripts/ensaio-migracoes/{antes.sql,aplicadas.sql,diagnostico.sql,montar.sh}`.

**Parecer: NÃO LIBERADO** — RD-3746 (média) e RD-3748 a RD-3751 (baixas, em código do workflow) seguram; RD-3747 é só comentário (baixa, não segura).

## Pergunta do gerente: a cópia do diagnóstico-0106 é necessária?
**Sim, manter.** Não é cópia literal:
- `db/scripts/diagnostico-0106.sql` não está no `main` (só no #771); nem todo SHA do ensaio o terá.
- O original lista `tenant_id` e `codigo` de perfil (consulta 1) e deixa as consultas 2 a 4 comentadas, com `c.*`. O ensaio roda em produção com o log no Actions: só contagens (regra 8, sem dado em log) e define `:ensaio_falhou`. Ler o script do SHA levaria ids ao log e SQL não confiável para fora do `DO … EXECUTE`, sem passar pela trava.
- Só o CTE `perfis`/`sob`/`achados` da consulta 1 (`antes.sql:7-43`) se repete no texto. O cabeçalho cita a fonte (#771, 3acce47). `manter?` aceito: se a consulta 1 mudar no #771, o `antes.sql` muda junto.

Observação funcional (não catalogada, vai ao `testes`): a consulta 4 do original espera "zero DIFERENCA nos tenants 'concessao'"; o `diagnostico.sql:31-51` reprova por DIFERENCA em tenant `perfis_derivados`. É critério diferente, e conferir se é intencional cabe ao `testes`/banco.

## Achados

| ID | Onde | Tipo | O que se repete | Sev. | Proposta |
|---|---|---|---|---|---|
| RD-3746 | `producao-ensaio-migracoes.yml:80-86` × `montar.sh:119-123` | rotina | Guarda contra COMMIT em 2 lugares, com 2 regex diferentes. A do workflow é mais fraca: não pega `prepare transaction` e ignora `commit` depois de `-`. A do `montar.sh` já varre a moldura, que inclui `antes.sql` e `diagnostico.sql`. O único arquivo fora dela é o `aplicadas.sql`, que é `read only`. | média | Apagar o passo "trava contra gravação nos scripts do ensaio" (linhas 80-86) e, na linha 15, trocar `(o passo "trava" falha se aparecer)` por `(o montar.sh falha se aparecer)`. |
| RD-3747 | `producao-ensaio-migracoes.yml:6-16` × `montar.sh:8-14` | doc | O fluxo da transação aparece em 2 cabeçalhos (BEGIN, timeouts, trava, antes, DO/EXECUTE, diagnóstico, ROLLBACK, ON_ERROR_STOP, conferir.sql). Os dois já divergem: o do workflow omite o `idle_in_transaction_session_timeout 60s`. | baixa (comentário, não segura) | Reduzir os itens 3 a 5 do workflow a uma linha: `# 3. montar.sh monta o ensaio e o conferir.sql (fluxo e travas no cabeçalho dele).` |
| RD-3748 | `producao-ensaio-migracoes.yml:104` × `montar.sh:61` | texto (log) | "aplicadas em produção: N" sai 2× no log; a última versão também sai no `conferir.sql`. | baixa | Apagar a linha 104 (`echo "aplicadas em produção: …"`). |
| RD-3749 | `producao-ensaio-migracoes.yml:99-100, 115-116, 135-136` | código | `env: USUARIO: ${{ secrets.PROD_USER }}` repetido em 3 passos. | baixa | Mover para o `env:` do job (ao lado de `PGCLIENTE`) e tirar dos 3 passos. |
| RD-3750 | `montar.sh:87-88` | texto (log) | Mesmo fato 2×: `\echo 'ensaio: outro migrador está rodando agora'` seguido do `raise exception 'ensaio: trava do migrador ocupada'`. | baixa | Apagar a linha 87 (`\echo …`); fica só o `raise`. |
| RD-3751 | `montar.sh:23` × `montar.sh:101` | código | `perl -0777 -pe 's/\r\n/\n/g'` (CRLF → LF) escrito 2×. | baixa | `normalizar() { perl -0777 -pe 's/\r\n/\n/g' "$1"; }`; `soma() { normalizar "$1" \| sha256sum \| cut -d' ' -f1; }`; linha 101: `normalizar "$arq" >> "$saida"`. |

## Redundância útil (manter)
- `\set ON_ERROR_STOP on` e o preâmbulo do psql em `aplicadas.sql`, na moldura e no `conferir.sql`: a garantia fica dentro de cada SQL, sem depender de como o psql é chamado.
- O `if exists … já aplicada` em cada `DO` (`montar.sh:99`), além do filtro do `aplicadas.txt`: protege a janela entre a leitura e o ensaio.
- A legenda das saídas no resumo (`yml:128`): o operador a usa para decidir.
- `\echo 'RESULTADO: REPROVADO (…)'` + `raise` (`montar.sh:112-113`): o `\echo` diz o motivo, e o `raise` só serve para sair com 3.

## Reteste — SHA `43764be292c13194726da9ed4583bfef3bccaeea` (25/11/2026, Manaus)
**Parecer: LIBERADO**, sem achado em aberto.
- RD-3746 corrigido: o passo "trava contra gravação" saiu; o cabeçalho diz "(o montar.sh falha se aparecer)".
- RD-3747 corrigido: itens 3 a 5 viraram "3. montar.sh monta o ensaio e o conferir.sql (fluxo e travas no cabeçalho dele)".
- RD-3748 corrigido: o `echo "aplicadas em produção…"` do workflow saiu; fica só o do `montar.sh`.
- RD-3749 corrigido: `USUARIO` no `env:` do job, fora dos 3 passos.
- RD-3750 corrigido: saiu o `\echo 'ensaio: outro migrador…'`; fica só o `raise`.
- RD-3751 corrigido: `normalizar()` usado por `soma()` e na montagem.
- Novidades sem achado: `timeout 600` no psql (teto do contêiner; o `timeout-minutes: 15` do passo é do runner, papel diferente) e a saída 124 na legenda; buraco na numeração e symlink agora falham (`erro`); `if:` do job só em main ou tag v*, explicado uma vez no cabeçalho. O `-type f` do `find` dos `.up.sql` ficou junto da checagem de symlink: filtro defensivo, `manter?` aceito.

## Reteste — SHA `c76ac5d64d2e8e4665a4518bd570721a9ce84fc2` (25/11/2026, Manaus)
**Parecer: LIBERADO**, sem achado em aberto. Delta só no yml.
- Job `ref` (falha fora do main ou de tag v*) com o `ensaio` em `needs: ref`: o `if:` do job saiu, a trava fica num lugar só; o cabeçalho (item 2) troca o texto antigo em vez de somar outro.
- `case "$PGCLIENTE"` antes de montar `$comando` com `timeout 600`: a substituição agora é conferida e feita uma vez; a mensagem de erro diz só o problema e o efeito.
- `manter?` aceito: a mensagem do `ref` cita "os scripts do ensaio saem do ref do disparo", que o cabeçalho também diz; é a saída que o operador lê no vermelho, sem abrir o yml.
