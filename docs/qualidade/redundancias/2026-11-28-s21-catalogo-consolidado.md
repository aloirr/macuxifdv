# Redundâncias: catálogo consolidado no main 47c11bc (S21, v1.0.43, 28/11/2026, horário de Manaus)

Este parecer substitui os PRs #792 e #820, que estão em conflito com o `main`, e traz para o catálogo dois branches que não chegaram a ter PR. Cada achado foi conferido no `main` 47c11bc (#873). O detalhe de cada rodada antiga fica no relatório dela, copiado sem mudança nesta pasta. A exceção é o relatório do ensaio, renumerado. Este relatório guarda só a situação de hoje.

| Fonte | Ref e head | Achados | Relatórios trazidos |
|---|---|---|---|
| #792, pareceres v1.0.35 do web e da senha (S11) | `pr/792` = `nuvem/v1035-web-corretor-redundancias` @ 14a3e23f | RD-3550 a RD-3574 | `2026-11-25-v1035-{portal-dados-sdk-web,web-cabecalho,web-integracao-reteste,senha-admin-portal,defeitos-4-5-7,refeitos-main}.md` |
| #820, ensaio das migrações (S7) | `pr/820` = `nuvem/v1036-ensaio-corretor-redundancias` @ 7f180312 | 6 achados, publicados como RD-3723 a RD-3728 e **renumerados para RD-3746 a RD-3751** | `2026-11-25-s7-ensaio-migracoes.md` (com os números novos e uma nota no topo) |
| Motor desligado na v1.0.37 (S7, sem PR) | `nuvem/v1037-perfis-corretor-redundancias` @ 1e6e17d | RD-3721 e RD-3722 | `2026-11-25-s7-perfis-motor-desligado.md` |
| E5 e E6 dos perfis (S18, sem PR) | `nuvem/v1040-corretor-redundancias-perfis` @ 4c0eacd | RD-3723 a RD-3742 | `2026-11-27-s18-perfis-{e5,e6,e5-final,core-2}.md` |
| T-0207, Vendas do mês (S21, hoje de manhã) | `nuvem/v1043-modulo-core-t0207` @ 3822d703 · `nuvem/v1043-modulo-gestor-t0207` @ ef344686 | RD-3743 a RD-3745 e RD-3752 | este relatório |

O branch v1037 é antigo. Contra o `main`, o diff dele apaga o relatório `2026-11-25-s12-t0196-codigo.md` e linhas do catálogo e do diário. Nada disso foi apagado aqui: entraram só as linhas dele que faltavam. O #792 e o #820 têm o mesmo problema, com relatórios e linhas da S7 e da S12, e receberam o mesmo cuidado.

## Renumeração
O main 47c11bc já cita os números dos perfis: RD-3732 em `db/testes/perfis-leitura-concessao.db.test.ts:50` e em `docs/banco/plataforma.md:1702`, e RD-3734 e RD-3741 em `docs/testes/v1040-perfis-e5.md:11,59`. Nada no `main` cita os números do ensaio.
- **Os perfis ficam com RD-3723 a RD-3742.**
- **O ensaio passa para RD-3746 a RD-3751**, na mesma ordem: 3723→3746, 3724→3747, 3725→3748, 3726→3749, 3727→3750, 3728→3751. Antes eram RD-3723 a RD-3728 no #820.
- **Colisões do adendo (S21, fim da manhã de Manaus).** Os commits enviados não mudam; o número novo vai só no catálogo:

| Antes | Fonte | Agora | Status |
|---|---|---|---|
| RD-3721 a RD-3724 | S22, T-0206, PR #874 (ed91e55) | RD-3755 a RD-3758 | corrigido em ed91e55 |
| — (resíduos da S22) | S22, T-0206 (ed91e55) | RD-3759 e RD-3760 | aberto |
| RD-3743 | #873, d2085d96 (no `main` 47c11bc) | RD-3761 | corrigido, sem descrição na fonte |
| RD-3724 e RD-3725 | T-0199, #837 (c1d078ae) | RD-3762 e RD-3763 | corrigido, sem descrição na fonte |

- RD-3743 a RD-3745 são da T-0207 de hoje. O achado do reteste da T-0207 recebe o RD-3752. Os dois achados novos deste parecer recebem o RD-3753 e o RD-3754.
- **Terceiro uso de RD-3724 e RD-3725, sem linha no catálogo.** O parecer da T-0199 (#837, c1d078ae; `.coord/tarefas/T-0199.md:21` e comentário do #837) diz "corretor LIBERADO (RD-3724 e RD-3725 resolvidos)". Não há relatório nem descrição. Os dois foram corrigidos antes do merge (509a353). Recebem o RD-3762 e o RD-3763, com status corrigido e "sem descrição na fonte", para o catálogo não ter número repetido.

## Situação no main 47c11bc
### #792 (RD-3550 a RD-3574)
- **18 corrigidos no `main`.** Entraram pelos PRs da v1.0.35 (#789 a #799). Conferido no código: `reprocessarLote` importado em `apps/web/lib/portal-monitor.ts:7`; não restam `ListaConectores`, `trocarSenhaAdmin`, `PROXY_BASE_NO_SERVIDOR`, `comCabecalhoApp` nem `PREFIXO_PROXY_API`; existe `packages/platform-sdk/src/proxy-base.ts`; `portal-diagnosticos.ts:42` diz "Desligados neste servidor.".
- **7 seguem abertos, sem mudança desde o parecer.** São RD-3564, RD-3565, RD-3567 e RD-3568 (testes), RD-3569 (modulo-core) e RD-3570 e RD-3574 (engenheiro-apps). Os 7 são baixos. Seis estão só em teste e não seguram o lote. O RD-3569 é export morto em `contracts` e segura o próximo PR do modulo-core. Evidência no `main`:
  - SA-02 em `tests/integracao/banco/senha-admin-portal-v1035.test.ts:146` e SA-06 em `:230`;
  - `revogadasDoUsuario` em `tests/integracao/api/troca-senha-portal-v1034.test.ts:148,305,318`;
  - `for (const quem of ['time', 'admin'])` em `tests/e2e/web/portal-01b-04-api.spec.ts:343`;
  - `trocaSoSuperAdmin` em `modules/core/contracts/plataforma.ts:38`, só citado em `super-admin.test.ts:446`, e `export` de `ehEmailValido` em `contracts/ciclo-senha.ts:12`, só usado nas linhas 155 e 178 do próprio arquivo;
  - `apps/web/lib/menu-usuario.test.ts:143` × `portal-escolha.test.ts:237`;
  - `apps/web/lib/cabecalho-app.test.ts:91,97,98`.

### #820, ensaio (RD-3746 a RD-3751, antes RD-3723 a RD-3728)
- **Os 6 estão corrigidos no `main`.** O workflow entrou já corrigido pelo #819 (0a7ace2, 25/11 às 13h14 de Manaus). Conferido no código:
  - não há guarda de COMMIT no yml;
  - `PROD_USER` aparece 1× (`env:` do job);
  - "aplicadas em produção" aparece só no `montar.sh:65`;
  - `normalizar()` está em `montar.sh:23`, usado por `soma()` e na linha 104;
  - sobra só o `raise` da trava (`:91`).

### v1037, motor desligado (RD-3721 e RD-3722)
- **RD-3721 segue aberto (banco-dados) e ganhou um trecho.** `db/seeds/fixtures/dois-tenants.ts:762` ainda diz "o tenant nasce migrado". O comentário de `:1221` diz "derivados em 'legado' (motor novo desligado na v1.0.37…)". Desde a 0109 (#855, v1.0.41, item 7 do cabeçalho), o tenant novo nasce em `concessao`, e a fixture grava `leitura: 'legado'` (`:1224`). Com isso, os dois comentários descrevem um estado que mudou.
  - Proposta: um comentário só, em `:1221`, com o porquê do `legado` na fixture. Em `:762`, trocar "o tenant nasce migrado" por "o gatilho semeia as concessões".
- **RD-3722 segue aberto (banco-dados).** Em `db/testes/perfis-sem-base-migracao.db.test.ts:133-134`, a 2ª chamada de `migrar_perfis_sem_base` → 'derivado' e o 2º `retratoConcessoes = antes` repetem as linhas 129 e 131 do mesmo laço.
  - Proposta: apagar as linhas 133 e 134 e deixar a contagem de `achados`.

### v1040, perfis E5 e E6 (RD-3723 a RD-3742)
- **15 corrigidos no `main`.** Os 9 do core (RD-3724 a RD-3728, RD-3730, RD-3731, RD-3734 e RD-3741) e o RD-3729 (no kit e na tela) entraram com o #861 (365a2b3) e o #853 (23d760a). Conferido no código:
  - não restam `montarLinhas`, `corpoDoPerfil` nem `baseDoNovoPerfil`, nem os textos "Vale na próxima ação", "Suas mudanças continuam" e "Confira e salve para valer";
  - `niveisAcimaDoTeto` vem do kit;
  - "‹ Voltar" e `CAMPO` estão só em `cabecalho-perfil.tsx`;
  - `usuarioDaRequisicaoVePedidos` usa `promotorNaRequisicao` e `podePeloCargo`, sem o `TODO(RD-3741)`.

  RD-3735 a RD-3737 entraram com o #861. RD-3732 entrou com o #855 (c0fc92b): a 0109 não recria `perfis_do_usuario`, como diz o cabeçalho, linha 15. RD-3733 entrou com o #857 (9c0857a): `promotorNaRequisicao` é a fonte única (`perfis-por-cargo.ts:137`), usada por `acesso-por-cargo.ts:118` e `sync.ts:405`.
- **RD-3723 reaberto (designer-ux, média).** O #853 (23d760a) trouxe o kit novo, mas a limpeza `adbdbfdc` não entrou no `main`. O kit antigo continua lá:
  - `LinhaDePermissao`, `SeletorDeNivel` e `ResumoDasMudancas` em `packages/ui/src/web/permissoes.tsx:164,242,406`;
  - `SELO_PADRAO`, `PerfilBase`, `SECOES_DO_PERFIL`, `agruparMudancas` e `textoDoPadrao` em `perfis.ts:18-151`;
  - tudo exportado por `index.ts:17` e sem import em `modules/` nem em `apps/`.

  O próprio `docs/design/perfis-de-acesso.md:4` diz que essas peças "saíram do kit". Proposta: a do RD-3723, apagar as peças e os testes delas. Feito isso, a linha 4 do guia passa a valer.
- **Seguem abertos:**
  - RD-3738 (designer-ux, média, doc): o guia ainda descreve "Perfil base", "Padrão: X" e "Restaurar o padrão" em `:33,64,72,92-112`;
  - RD-3739 (modulo-core, baixa): `modulosForaDoPerfil` e `modulosCoerentes` (`acesso.ts:182,188`) só têm uso nos testes, em `acesso.test.ts:70-72` e também em `tests/modulos/acesso-perfil-modulos-rncore01.test.ts:104-140`, que é do testes;
  - RD-3740 (modulo-core, baixa, só teste): a escrita direta no banco em `perfis-v2.db.test.ts:461-475` (o `update` direto em `:468`) e de novo no caso RN-PRO-01 (`:478`);
  - RD-3742 (modulo-core, baixa): `perfilRecebeHistoricoDeCompra` (`promotor-pedidos.ts:21`), 1 uso em `documentos-cliente.ts:164`.

### T-0207 (RD-3743 a RD-3745 e RD-3752)
- **RD-3743 (média, modulo-core), corrigido em 3822d703, LIBERADO.** O texto da base das vendas era montado em `textoBaseVendas` na lib web. Agora há uma só fonte, `BASE_APURACAO_ROTULO`, em `modules/core/contracts/meta.ts:50`, usada por Indicadores e Metas.
- **RD-3744 (média, modulo-gestor), corrigido em 4fa3a75 e ef344686, LIBERADO.** O gestor tinha uma constante própria para o mesmo texto. Agora o Ranking do app e o do BKO usam `BASE_APURACAO_ROTULO` de `@macuxi/core/contracts`.
- **RD-3745 (baixa, modulo-gestor, título de teste), corrigido em ef344686.** O título com "received" em `projecao.test.ts` virou "recebido com id".
- **RD-3752 (baixa, modulo-gestor), corrigido em ef344686.** Achado do reteste: a função local `capitalizar` do `ranking-screen.tsx` repetia o `capitalize` de `@macuxi/comum/fuso`. Agora a tela importa o `capitalize`.

### Novos neste parecer
- **RD-3753 (baixa, engenheiro-software, doc em código de produção).** O JSDoc de `promotorNaRequisicao` (`packages/platform-sdk/src/perfis-por-cargo.ts:135`, #857) diz "Fonte única da decisão 'é promotor?' (RD-3736)". O achado dessa fonte única é o RD-3733. O RD-3736 trata de `ALVO_TODOS` e das constantes do BKO.
  - Proposta: "(RD-3733)". Segura o próximo PR do engenheiro-software que tocar o arquivo.
- **RD-3754 (baixa, modulo-core, código em `contracts`).** No head 3822d703 da T-0207, `meta.ts:48` cria `BaseApuracaoSchema` e o usa no `IndicadoresListaSchema`, mas `PainelMetasBkoSchema.base_apuracao` (`meta.ts:90`, no main `:84`) segue com `z.enum(['aprovado', 'faturado'])` no mesmo arquivo. A tela Metas indexa `BASE_APURACAO_ROTULO` com esse campo.
  - Proposta: `base_apuracao: BaseApuracaoSchema,` em `:90`. É 1 linha no PR do core da T-0207. Pela definição de pronto, achado em código de produção segura o lote. O gerente decide se reabre o 3822d703 ou leva a correção no próximo PR do core.
  - **Reteste: corrigido em e64163b49ad40f0ff19bdeab0b699f0326a8b0e1** (`nuvem/v1043-modulo-core-t0207`). O delta é só `meta.ts:90`, que passa a `base_apuracao: BaseApuracaoSchema`; o `z.enum(['aprovado', 'faturado'])` fica só em `:48` (`git grep` no módulo core: 1 ocorrência). Sem mudança de comportamento.
  - **Parecer do head do core: LIBERADO e64163b49ad40f0ff19bdeab0b699f0326a8b0e1.** O gestor ef344686f219af62aee879d88e2d4848a990e598 continua LIBERADO: ele contém o core 3822d70, e o squash depois do core absorve a linha.
- **`manter?` (sem número).** `modules/gestor/contracts/parametros.ts:6` define `BASES_APURACAO = ['aprovado', 'faturado']`, o mesmo enum do core. O `ranking.ts` do gestor tipa `base_apuracao` por ele e indexa o rótulo do core. O dono do parâmetro `metas.base_apuracao` decide qual contrato fica como fonte. O gestor pode importar o enum de `@macuxi/core/contracts`, como já faz com o rótulo.

### T-0206, filial do vendedor (S22, PR #874, head ed91e55feb7ab7f09abce67e916b13dd0a69e88a)
Achados deduzidos do diff 1e2e46a → ed91e55 (`modules/integracao/api/vendedor-filial.db.test.ts`), todos baixos e só em teste:
- **RD-3755 (antes RD-3721 na S22), corrigido.** O cabeçalho listava os 4 casos que os títulos dos `it` já dizem. A lista saiu.
- **RD-3756 (antes RD-3722), corrigido.** `tenantId === A.tenantId ? A.integracao.… : B.integracao.…` 2×, em `aplicar` e `filialNoHub`. As duas recebem o tenant.
- **RD-3757 (antes RD-3723), corrigido.** `conectorDe(t)` só devolvia `t.integracao.conector`. Saiu.
- **RD-3758 (antes RD-3724), corrigido.** O caso sem filial lia `lote(A.tenantId, id)` 2×. Agora lê uma vez (`const l`).

Resíduos, abertos (modulo-integracao, baixa, só teste, não seguram o lote):
- **RD-3759.** As ajudas de lote estão copiadas em 3 testes: `rodar` em `clientes-erp.db.test.ts:43`, `consumidores.db.test.ts:56` e `vendedor-filial.db.test.ts:35`; `novoLote` (o mesmo `insert into integracao.lote_staging`), `aplicar`, `erros` e `registros` em `consumidores.db.test.ts:77,103,107,118,120` e `vendedor-filial.db.test.ts:61,70,73,89,91`.
  - Proposta: uma ajuda comum de teste do módulo, importada pelos 3.
- **RD-3760.** As ajudas ora recebem o tenant, ora só o `tenantId`. Em `vendedor-filial.db.test.ts`, `aplicar` (`:73`) e `filialNoHub` (`:80`) recebem `t`; `rodar`, `novoLote`, `lote`, `erros` e `registros` (`:35,61,87,89,91`) recebem `tenantId`, e as chamadas repetem `A.tenantId, A.integracao.conector`. `consumidores.db.test.ts:77,107` também recebem `tenantId` e o conector.
  - Proposta: uma assinatura só (o tenant da fixture), na mesma ajuda do RD-3759.

## Para o testes (não catalogado)
- A fixture `dois-tenants.ts:1224` grava os dois tenants em `leitura: 'legado'`. Depois da 0109, o gatilho faz o tenant nascer em `concessao`. Falta confirmar se as suítes que usam a fixture querem de fato o `legado`. É comportamento, não redundância. Ligado ao RD-3721.

## Abertos por dono (17)
| Dono | Abertos | Seguram o próximo lote do dono |
|---|---|---|
| testes | RD-3564, RD-3565, RD-3567, RD-3568 (só teste) | não |
| engenheiro-apps | RD-3570, RD-3574 (só teste) | não |
| modulo-core | RD-3569, RD-3739, RD-3740 (só teste), RD-3742 | RD-3569, RD-3739 e RD-3742 (código de produção) |
| designer-ux | RD-3723 (reaberto), RD-3738 | sim (código e doc) |
| banco-dados | RD-3721 (comentário), RD-3722 (só teste) | não (o RD-3721 é comentário de fixture e o RD-3722 é teste) |
| engenheiro-software | RD-3753 | sim (comentário de produção, no próximo PR do arquivo) |
| modulo-integracao | RD-3759, RD-3760 (só teste) | não |

Somam 17: 7 do #792, 2 do v1037, 5 do v1040 (RD-3723 reaberto, RD-3738, RD-3739, RD-3740 e RD-3742), o RD-3753 e os 2 resíduos da S22 (RD-3759 e RD-3760). O RD-3754 foi corrigido em e64163b. O RD-3739 tem uma parte do testes (`tests/modulos/acesso-perfil-modulos-rncore01.test.ts`) e conta uma vez só, no modulo-core. Fora destas fontes, o RD-3720 (modulo-core, baixa, JSDoc órfão em `perfis-cargo.ts:59-62`; "O Core é sempre licenciado" segue 2×, em `:61` e `:63`) segue aberto no `main`.

**Descartados como já resolvidos no `main`: 39.** São 18 do #792, os 6 do ensaio e 15 do v1040 (RD-3724 a RD-3737 e RD-3741). Os 4 da T-0207 e o RD-3754 estão corrigidos nos heads (3822d703, e64163b e ef344686) e ainda não entraram no `main`; os 4 da S22 (RD-3755 a RD-3758) estão corrigidos no ed91e55 (#874).

## Recados
A caixa de recados responde HTTP 403. Por isso não houve recado aos donos: o gerente-projetos repassa este relatório a cada um.
