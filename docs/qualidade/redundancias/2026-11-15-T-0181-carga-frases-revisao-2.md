# Parecer de redundâncias — T-0181, segunda revisão (heads finais do lote "carga com as 30 frases")

> 2026-11-15, ~09h40 (Manaus) · corretor-redundancias · pedido da sessão de revisão do gerente-projetos.
> Base: `.coord/tarefas/T-0181.md` no `nuvem/carga-frases-gerente-projetos` (58ef0542), com a tabela dos branches finais.
> Pareceres anteriores (ainda fora do `main`): `nuvem/carga-frases-corretor-redundancias-3` (4a4ca42c, RD-0516 a RD-0525
> corrigidos) e `nuvem/carga-frases-corretor-redundancias-4` (48e84b40, RD-0610 a RD-0614 abertos).
> Recados: `node scripts/coord.mjs caixa corretor-redundancias` respondeu **HTTP 403** (repositório de recados sem acesso
> nesta sessão). Este relatório e a resposta ao gerente substituem os recados aos donos.

## Resultado

**COM ACHADO. 6 achados novos (RD-0660 a RD-0665), todos baixos, mais os 5 do reteste 2 (RD-0610 a RD-0614), que continuam
abertos.** Os 6 novos estão no corpo de testes ou em doc, então seguram o lote pela R-20261110-062506 (a exceção da
R-20261111-190159 vale só para comentário e título de teste). As telas não mudaram desde o reteste do branch -3 e seguem sem
achado.

## 1. Escopo (heads finais da tabela do gerente)

| # | Dono | Branch | SHA |
|---|---|---|---|
| 1 | banco-dados | `nuvem/carga-frases-banco-dados-3` | d9905ae7 |
| 2 | engenheiro-software | `nuvem/carga-frases-engenheiro-software-3` | dad7179a |
| 3 | testes | `nuvem/carga-frases-testes-2` | 76816089 |
| 4 | designer-ux | `nuvem/carga-frases-designer-ux-kit3` | 5e94cd33 |
| 5 | engenheiro-apps | `nuvem/carga-frases-engenheiro-apps-3` | d5d83250 |
| 7 | design-de-marca | `nuvem/carga-frases-design-de-marca-3` | aca1e1ab (só o parecer; nada de código) |

Lido cada branch contra o `origin/main` (5d744724) com `git show`/`git diff origin/main...<branch>`, sem merge local.

## 2. Reteste do que estava fechado

- **RD-0516 a RD-0525: continuam corrigidos.** Os heads 1 a 4 são os mesmos do reteste do branch -3. O head 5 (d5d83250) só
  acrescenta testes ao 5de0ca38 (reteste 2). Conferido de novo: `apps/api/src/frases-carga.ts` sem `sort` (`return { frases:
  r.frases }` e `.send({ itens: lista.itens })`); `frasesDaResposta` sem `sort`; `tela-entrada.tsx` com uma `<Barra>` só;
  `SEM_ACESSO_TIME_MACUXI` em `portal-sessao.ts`; `cortarFrase` e `contadorDaFrase` pelo `tamanhoFrase` do SDK.
- **RD-0610 a RD-0614: continuam abertos.** Não existe head do engenheiro-apps depois do d5d83250, e foi nele que o reteste 2
  achou os 5. A tabela da T-0181 cita o corretor `-3` como final e diz "corretor sem achado aberto". Falta o `-4` (48e84b40)
  na lista e na ordem do lote.

## 3. Achados novos

### RD-0660 — o teste do banco tem uma 3ª cópia literal das 30 frases e do limite de 90
| Campo | Conteúdo |
|---|---|
| Onde | `db/testes/t0181-frase-carga.db.test.ts:30-61` (`FRASES_ESPERADAS`, as 30 escritas de novo), `:63` (`const MAX = 90`), `:96-106` (laço de tamanho, trim e repetição), `:108-117` (o `it` do `frases.md`) |
| Tipo | teste |
| O que se repete | As 30 frases estão no SDK (`FRASES_CARGA_INICIAIS`), no seed da 0081 e, de novo, no teste do banco. O contrato da T-0181 diz que o SDK é a "fonte única para o bundle do app e para o teste que confere o seed", e o `@macuxi/db` já depende de `@macuxi/platform-sdk` (`db/package.json:38`). O `MAX = 90` copia o `FRASE_CARGA_MAX`. O laço de `:96` refaz, no seed, o que o teste do SDK já garante nas mesmas 30 (até 90, sem espaço nas pontas, sem repetir). O `it` de `:108` retorna sem conferir nada quando a pasta `docs/design/carga-aviso-frases/` não existe, e ela não está em nenhum dos branches finais |
| Impacto | manutenção: mudar uma frase exige 3 edições, e o teste do banco confere contra a cópia dele, não contra o app |
| Severidade | baixa |
| Proposta | Importar `FRASES_CARGA_INICIAIS` e `FRASE_CARGA_MAX` do SDK. Antes, `expect(daMigracao).toEqual(FRASES_ESPERADAS.map(...))` e o laço; depois, `expect(daMigracao).toEqual(FRASES_CARGA_INICIAIS.map(({ numero, texto }) => ({ numero, texto })))`. `iniciais()` (`:246`) vira `FRASES_CARGA_INICIAIS`, e `FRASES_ESPERADAS[0]` nos casos do portal vira `FRASES_CARGA_INICIAIS[0].texto`. Tirar `FRASES_ESPERADAS`, `MAX`, o laço de `:99-105` e o `it` do `frases.md`. O `idInicial` (`:65`) fica: é usado em `:346`, onde o banco calcula o id, e nos casos do portal |
| Dono | banco-dados |

### RD-0661 — o FC-01 confere no banco o mesmo seed que o teste do banco confere
| Campo | Conteúdo |
|---|---|
| Onde | `tests/integracao/api/frases-carga-t0181.test.ts:124-137` (1º `it` do FC-01: `select` direto na tabela) × `db/testes/t0181-frase-carga.db.test.ts:248` ("as 30 iniciais no banco: ids do uuid_de_chave, Nº e ordem 1..30, ativas") e `packages/platform-sdk/src/frase-carga.test.ts` (30, até 90, id `30db8593…` do Nº 1) |
| Tipo | teste |
| O que se repete | O FC-01 lê a tabela pela administração, sem passar pela API, e confere o que o teste do banco já confere: 30 linhas, Nº = ordem, ativas, id pela chave. Ele também refaz o que é do SDK: `expect(FRASES_CARGA_INICIAIS).toHaveLength(30)` (`:125`), o filtro `> FRASE_CARGA_MAX` (`:133`) e o id do Nº 1 (`:135-136`). Com o RD-0660, o teste do banco passa a comparar com o SDK, e o 1º `it` fica inteiro repetido. O RD-0525 manteve o FC-01 porque o teste do banco comparava com uma cópia própria |
| Impacto | manutenção e tempo de CI |
| Severidade | baixa |
| Proposta | Tirar o 1º `it` do FC-01 (`:124-137`) e o helper `noBanco` se ficar sem uso. O FC-01 fica com o 2º `it` (`:139`): portal e app devolvem, pela API, as 30 iguais às do SDK. Isso só a integração vê. Ajustar o cabeçalho (`:9-10`) |
| Dono | testes |

### RD-0662 — o teste do kit repete o próprio `toEqual` e refaz a conta do shell
| Campo | Conteúdo |
|---|---|
| Onde | `packages/ui/src/mobile/entrada.test.ts:58-63` ("84 dp com 2 linhas e 64 com 1"), `:65-68` ("aviso tem 1 linha… nenhum limite de corte") e a última linha de `:70-75` (`Object.keys(MEDIDAS_FRASE_CARGA.aviso).sort()`) |
| Tipo | teste |
| O que se repete | O `toEqual` de `:50-56` já fixa o objeto inteiro: `aviso.linhas = 1`, a falta de `linhasMax` e as 5 chaves do aviso. Os testes de `:65` e o fim de `:70` conferem o mesmo de novo. O `it` de `:58` escreve no teste a fórmula da altura do bloco, que é a `alturaDoBlocoFrase` do shell, e o shell testa 84/64 com a função real (`apps/mobile/src/lib/entrada.test.ts:73-74`) |
| Impacto | manutenção: mudar uma medida exige 3 testes do kit e 1 do shell |
| Severidade | baixa |
| Proposta | Tirar os `it` de `:58` e `:65` e a linha `expect(Object.keys(MEDIDAS_FRASE_CARGA.aviso).sort())…`. Fica no `it` de `:70` só a parte dos temas (nenhuma chave `aviso*`), que o `toEqual` do Pérola não cobre |
| Dono | designer-ux |

### RD-0663 — `lib/entrada.test.ts` confere os mesmos casos nos dois `describe` da carga
| Campo | Conteúdo |
|---|---|
| Onde | `apps/mobile/src/lib/entrada.test.ts`: `LONGA`/`CURTA` declaradas 2× (`:69-70` e `:115-116`); `alturaDoBlocoFrase(2)` = 84 (`:73`) × `alturaDoBlocoFrase(2, 1)` = 84 (`:128`); `cabeFrase(800, 48, LONGA)` = 2 (`:85`) × `cabeFrase(800, 48, LONGA, 1)` = 2 (`:141`); `fraseEmUmaLinha(CURTA)` (`:76`) × `fraseEmUmaLinha(CURTA, 1)` (`:134`); `cabeLista(1100, 5, 48, true, false, { aviso: true, linhasFrase: 2 })` = true (`:108` e `:147`); `linhasDoAviso()` × `linhasDoAviso(1)` (`:119-120`) |
| Tipo | teste |
| O que se repete | 5 asserções iguais (escala 1 explícita × escala padrão, que é 1) e 2 constantes copiadas |
| Impacto | manutenção |
| Severidade | baixa |
| Proposta | Subir `LONGA` e `CURTA` para o topo do arquivo, uma vez só. No 2º `describe`, tirar as linhas de escala 1 que repetem o 1º: `:128`, `:134`, `:141`, `:147` e `:120`. Ficam só os casos de 1,15 e 1,3, e cada `it` compara com o caso de escala 1 do 1º `describe` pelo título |
| Dono | engenheiro-apps |

### RD-0664 — testes do portal: menu conferido em 2 arquivos, teste que compara a constante com ela mesma e regra do SDK de novo
| Campo | Conteúdo |
|---|---|
| Onde | `apps/web/components/portal/tela-frases-carga.test.tsx:54` × `apps/web/lib/portal-diagnosticos.test.ts:204` (a mesma linha `expect(MENU_TIME_MACUXI.map((i) => i.rotulo)).toEqual(['Empresas', 'Diagnósticos', 'Frases da carga'])`); `tela-frases-carga.test.tsx:133-136` (`TEXTOS_PORTAL_FRASES.semAcesso` = `TEXTOS_PORTAL_DIAGNOSTICOS.semAcesso`: depois do RD-0521, os dois são a mesma `SEM_ACESSO_TIME_MACUXI`); `:85-87` (vazia, repetida sem diferenciar maiúsculas e a própria na edição, que são os casos do `validarTextoFrase` em `packages/platform-sdk/src/frase-carga.test.ts`) |
| Tipo | teste |
| O que se repete | A ordem do menu está em 2 testes, e o próximo item vai exigir as 2 edições. A igualdade de `:134` compara a constante com ela mesma e sempre passa. A regra do texto já é testada no SDK, e `erroDoFormulario` só repassa a `mensagem` |
| Impacto | manutenção |
| Severidade | baixa |
| Proposta | Em `tela-frases-carga.test.tsx:54`, trocar a lista inteira por `expect(MENU_TIME_MACUXI.at(-1)?.rotulo).toBe('Frases da carga')`; a ordem completa fica no teste do cabeçalho (`portal-diagnosticos.test.ts:204`). Tirar o `it` de `:133-136`, porque o de `:138` já confere o texto na tela. Em `:85-87`, deixar uma linha só (`erroDoFormulario('   ', lista)` = "Escreva a frase.") para provar a ligação com o SDK |
| Dono | engenheiro-apps |

### RD-0665 — rotas e regra do texto descritas em 3 lugares (desenho, cabeçalho do SDK e cabeçalho da API)
| Campo | Conteúdo |
|---|---|
| Onde | `docs/desenho/T-0181.md` §1 (repete o arquivo do SDK: schemas, as 3 mensagens literais, fórmula do id e o id do Nº 1) e §2 (tabela das 4 rotas) × `packages/platform-sdk/src/frase-carga.ts:1-15` (as 4 rotas e a fórmula do id) × `apps/api/src/frases-carga.ts:1-14` (as 4 rotas, função do banco e erros) |
| Tipo | doc |
| O que se repete | As 4 rotas, com quem chama e o que devolvem, estão 3 vezes. "Escreva a frase.", "Use até 90 caracteres." e "Essa frase já está na lista." estão no SDK (fonte) e no desenho. A fórmula do id e o `30db8593…` estão no SDK, no desenho e no teste do SDK. É o mesmo problema que o RD-0524 resolveu na §3 e na §4 do desenho |
| Impacto | manutenção e leitura: o texto da tela muda no SDK e o desenho fica para trás |
| Severidade | baixa |
| Proposta | Fonte da verdade: o SDK para contrato e textos, e o desenho §2 para a tabela de rotas. No desenho §1, deixar a lista dos exports, sem as mensagens literais nem o exemplo de id, e terminar com "Textos, limites e ids: `packages/platform-sdk/src/frase-carga.ts`". No cabeçalho da API, deixar 2 linhas: "Rotas, funções do banco e erros: `docs/desenho/T-0181.md` §2. Log sem o texto das frases." No cabeçalho do SDK, tirar a lista das rotas, porque as constantes `ROTA_*` ficam logo abaixo |
| Dono | engenheiro-software |

## 4. Conferido sem achado

- **Telas:** sem mudança de produção desde 5de0ca38. Os prints do reteste -3 continuam valendo: uma informação em cada lugar
  e nenhum aviso fora do lugar.
- **Rotas do portal** (`ROTAS_PORTAL.frasesCarga` × `ROTA_PORTAL_FRASES_CARGA`): segue o padrão que já existe em
  Diagnósticos (o cliente do portal tira o `/v1`). Não é desta tarefa.
- **Listas de `sa_*`** (`db/testes/funcoes-sa.ts`, `apps/api/test/funcoes-sa.ts`, `banco-dbaas.sh`, `conformidade.test.ts`):
  padrão do T-0093, em que cada lista serve a um consumidor. As 3 novas entram em todas, sem divergência.
- **`docs/desenho/T-0181-revisao.md`:** é o registro datado da revisão do engenheiro, no padrão `T-0117-revisao.md`. Não é RD.
- **403 "Só o time da Macuxi cuida das frases da carga."** na API e no modo falso: `manter`, como no parecer -3.
- **Parecer da marca** (`design-de-marca-3`): só doc da marca, sem cópia de regra de produto.

## 5. Para o gerente e o testes (sem número RD)

1. **O banco-dados-3 não entra mais limpo no `main`.** O `origin/main` 5d744724 (#334, migrações 0070 a 0073) conflita com o
   d9905ae7 em 8 arquivos: `db/esquema/plataforma.ts`, `db/scripts/conferir-rls.sql`, `db/src/excecoes.ts`,
   `db/testes/diagnostico.test.ts`, `db/testes/estatico.test.ts`, `db/testes/funcoes-sa.ts`,
   `db/testes/portal-admin-multiperfil.test.ts` e `docs/banco/plataforma.md`. A T-0181 diz "entram sem conflito sobre o main
   de 15/11". O banco-dados precisa rebasear ou fazer um novo branch, e conferir de novo a numeração da 0081.
2. **A pasta `docs/design/carga-aviso-frases/` (spec e `frases.md`) não está em nenhum branch final.** O contrato pedia que o
   designer-ux a trouxesse do 3cdb384, e o kit3 não traz. Mesmo assim, `docs/design/entrada-sync.md` (kit3), os cabeçalhos do
   SDK, da API, do shell e do portal e os testes citam `docs/design/carga-aviso-frases/spec.md`. No `main`, todas essas
   referências apontam para uma pasta que não existe.
3. **`docs/testes/T-0181.md` (testes-2) está desatualizado:** lista os branches -2 e kit2 e dá L1 a L3 como lacunas (critério
   3 "❌ lacuna L3 no hook"), mas o d5d83250 cobre as três. Fica com o testes.
4. **Tabela dos branches finais:** falta o `nuvem/carga-frases-corretor-redundancias-4` (48e84b40), e a frase "corretor sem
   achado aberto" não vale enquanto RD-0610 a RD-0614 e RD-0660 a RD-0665 estiverem abertos.
5. **Catálogo:** os branches -3 e -4 do corretor e este acrescentam linhas no mesmo trecho do `catalogo.md`. No merge,
   manter as 3 levas em ordem de número (RD-0516 a RD-0525, RD-0610 a RD-0614 e RD-0660 a RD-0665).
