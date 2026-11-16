# T-0181 — revisão final do engenheiro-software (frases da carga)

> 2026-11-15 · engenheiro-software. Revisão feita de manhã sobre o merge local, no `origin/main`, dos branches da carga
> (banco-dados, engenheiro-software, testes, designer-ux e engenheiro-apps; os 5 sem conflito). Conferida de novo à tarde
> nos heads que vão ao PR conjunto #428: `nuvem/carga-frases-banco-dados-v6`, `nuvem/carga-frases-engenheiro-software-v7` e
> `nuvem/carga-frases-testes-v5`. Spec: `docs/design/carga-aviso-frases/spec.md` (§1 e §1.1 do ajuste R-20261115-080500).

## Resultado na sessão (Node 22, sem Docker)
- `lint` e `typecheck` (turbo) de `@macuxi/db`, `api`, `mobile`, `web`, `@macuxi/platform-sdk` e `@macuxi/ui`: 12/12 verdes.
- `lint:tests`: 0 erros (6 avisos antigos, em `notificacoes.test.ts` e `visitas-campo.test.ts`); `typecheck:tests`: verde;
  `fronteiras`: 0 erros (11 avisos de ciclo antigos, nenhum nos arquivos da T-0181).
- Testes: platform-sdk 884, ui 424, mobile 564 (+1 todo), web 224, todos verdes. db 1065 e api 548 verdes, com 1 falha cada,
  ambas do `crypto.argon2Sync` (Node 22; conhecida). Integração (`tests/integracao/api/frases-carga-t0181.test.ts`, 28 casos,
  e `conformidade.test.ts`): pulados sem banco; o resultado vale no CI. Migrações 0070–0074 vazias e provisórias só na
  sessão (sem commit), para o migrador não recusar o buraco.
- `node scripts/coord.mjs verificar --por-commit origin/main..HEAD`: 5 commits, nenhuma violação.

## Achados
### 🔴 Nenhum.

### 🟡 Corrigir antes do build (não segura o lote do banco, da API, do testes e do kit)
1. **Reticências na frase** — `apps/mobile/src/components/frase-carga.tsx:37` (engenheiro-apps). `numberOfLines={linhas}` sem
   conferir o que foi desenhado: o React Native corta com "…" quando o texto passa das linhas (padrão `ellipsizeMode="tail"`),
   e a spec §1.1 proíbe reticências. Medido com as métricas do `IBMPlexSans_400Regular.ttf` (14 dp, 280 dp): as 30 iniciais
   cabem em 2 linhas na escala de fonte 1,0, mas 13 das 30 vão a 3 linhas na escala 1,15 e 27 na 1,3 (fonte grande do Android),
   e uma frase de 90 caracteres incluída no portal vai a 3 linhas já na escala 1,0. O próprio teto de 32 caracteres por linha
   do `cabeFrase` prevê no máximo 64 em 2 linhas, mas o caso de 2 linhas não confere o texto
   (`apps/mobile/src/lib/entrada.ts:82`). Pronto quando: a frase que não cabe inteira nas linhas dadas não aparece (o bloco
   inteiro sai, como na §1.1), por exemplo com `onTextLayout` (linhas medidas > `linhas` → esconder o bloco) ou com a escala
   de fonte entrando na conta, com teste.
2. **Escala de fonte fora do `cabeFrase`** — `apps/mobile/src/lib/entrada.ts:58` e `:79` (engenheiro-apps). As alturas
   (20 dp por linha, 18 do título) e o teto de 32 caracteres supõem escala 1,0; com fonte grande o bloco cresce e pode invadir
   os 24 dp de respiro acima do aviso. O mesmo vale para o aviso de 1 linha (`aviso-carga.tsx:100`, `numberOfLines={1}` também
   corta com "…" se a escala passar de ~1,3). Resolver junto com o item 1 (medir em vez de estimar) ou registrar a premissa
   "escala 1,0" na spec com o designer-ux.

### 🟢 Sugestões (não seguram)
1. **`cabeFrase` com 32 caracteres** (engenheiro-apps): estimativa conservadora e segura para o texto real (32 caracteres
   típicos medem ~184 dp de 280); só 32 maiúsculas largas passariam (364 dp), caso irreal. Como nenhuma das 30 iniciais tem
   menos de 56 caracteres, o caso "1 linha" quase nunca acontece: em tela baixa o bloco sai. Aceito; se o item 1 passar a
   medir, o teto pode virar medida.
2. **Mensagem do id reusado** — `db/migrations/0081_plataforma_frase_carga.up.sql:184` (banco-dados) e
   `apps/api/src/frases-carga.ts:81` (engenheiro-software): o mesmo `id` com outro texto sai como 23505 e vira "Essa frase já
   está na lista.". Só acontece com cliente fora do padrão (o portal gera um UUID por diálogo); aceitável.
3. **`Barra` repetida** — `apps/mobile/src/components/tela-entrada.tsx:143-150` (engenheiro-apps): as duas ramas desenham a
   mesma `<Barra>`; dá para envolver só quando há aviso. Cosmético.

## Conferido sem achado
- **Fronteiras:** SDK só com `zod`; API e shells importam `@macuxi/platform-sdk` e `@macuxi/ui/mobile/puro`; nenhum módulo
  tocado; `fronteiras` sem erro.
- **Zod como fonte:** `FraseCargaSchema`, `FraseCargaEntradaSchema` (strict, `id` opcional), `FraseCargaAlteracaoSchema`
  (strict, pelo menos um campo), `FrasesCargaAppRespostaSchema`; API confere o retorno das funções (`conferirRetorno`); app e
  portal validam a resposta pelo mesmo schema; `FRASES_CARGA_INICIAIS` é a lista do bundle (ids `uuid_de_chave`); o seed
  da 0081 tem o VALUES próprio (SQL), e o teste do banco o confere contra o SDK.
- **0081 — tabela global sem `tenant_id`:** precedente aceitável (mesmo padrão de `super_admin`, `portal_sessao` e
  `auditoria_plataforma`): exceção declarada em `db/src/excecoes.ts` (`TABELAS_SEM_TENANT_ID` e `TABELAS_SO_POR_FUNCAO`) e
  em `db/scripts/conferir-rls.sql`; RLS ligado e forçado, só a política `manutencao`; nenhum grant de tabela a
  `macuxi_app`/`macuxi_worker`/`macuxi_portal`; sem dado de tenant nem pessoal. Demais colunas-padrão presentes.
- **SECURITY DEFINER:** as 4 funções com `set search_path = pg_catalog, plataforma, pg_temp`; EXECUTE das 3 `sa_*` só ao
  `macuxi_portal`, `frases_carga_ativas()` só ao `macuxi_app` (revoke de PUBLIC); conferência pelo catálogo no fim da migração;
  `funcoes-sa.ts` e `banco-dbaas.sh` com as 30. Sessão e super-admin conferidos dentro das funções (28000/42501).
- **Auditoria sem texto:** `sa.frase_carga.listar` (contagem), `.incluir` (id e Nº), `.editar` (id, Nº, `texto_mudou`,
  `ativa`). Log da API só com código e SQLSTATE.
- **Rota do app:** `p.preparar(req, null)` (sessão exigida, sem licença de módulo, como `/v1/sync` e diagnósticos);
  `no-store`.
- **Sem DELETE** na API, no SDK e no portal; o teste da API confere.
- **Idempotência do POST:** `id` gerado no portal uma vez por diálogo; a função devolve a frase gravada no reenvio igual, sem
  nova auditoria; numeração com `lock table ... share row exclusive` (sem corrida).
- **Sorteio:** `sortearFrase` pura, `rnd` injetado e limitado a [0, n−1]; nunca repete a última com mais de uma ativa;
  nenhuma ativa → nada; lista vazia do servidor não volta ao bundle (correto: "sem ativa, sem frase"); sem lista guardada usa
  as 30 do bundle. Guarda só o id da última.
- **Sync das frases:** `void atualizarFrasesDaCarga(api())` em paralelo, fora do `await` da carga; qualquer erro (rede, 503,
  401 depois da renovação única e deduplicada) é engolido e a lista anterior fica; resposta fora do contrato não substitui
  a lista.
- **`tela-carga.tsx`:** +10 linhas (dois imports, o hook e duas props); **`tela-entrada.tsx`:** só props novas e o encaixe,
  sem mudar o caminho existente quando `frase`/`aviso` não vêm (abertura, "Atualizando o app", "Conferindo o servidor").
- **Fonte da frase:** fora do contrato, do banco, do app e da tela.
- **Dado pessoal em log:** nenhum.
