# Parecer do corretor-redundancias: código da marca e filial do vendedor (Hub, Conector e kits)

15/11/2026, horário de Manaus. Comparação com `git diff origin/main...<branch>`:

| Branch | Head | Dono |
|---|---|---|
| `nuvem/marca-codigo-modulo-integracao` | 69d53564 | modulo-integracao |
| `nuvem/referencia-cruzada-modulo-integracao` | 34ba5c15 (só o que não vem do branch acima) | modulo-integracao |
| `nuvem/marca-codigo-banco-dados` | 634a00b7 | banco-dados |

**Resultado: COM ACHADO.** São 5 achados novos (RD-0531 a RD-0535), e todos seguram o lote. O RD-0535 está no corpo de teste, não em comentário nem em título, e por isso também segura (precedente RD-0233). O reteste fecha RD-0490 e RD-0503.

## 1. Achados

| RD | Grav. | Dono | Onde | O que se repete | Proposta (antes → depois) |
|---|---|---|---|---|---|
| RD-0531 | média | modulo-integracao (banco-dados no passo do teste) | `apps/conector/src/config/entidades.ts:9` (`ORDEM_CARGA`) × `modules/integracao/domain/portal-carga.ts:12` (`ORDEM_PORTAL`) | A ordem de carga das 16 entidades foi escrita à mão duas vezes, em permutações diferentes sem motivo de negócio (transportadora e cliente/preço trocam de lugar). Para pôr a filial antes do vendedor foi preciso mexer nas duas. O `ORDEM_PORTAL` passa por conferência em tempo de execução contra `DEPENDENCIAS`. O `ORDEM_CARGA` só tem conferência parcial no teste (o conjunto e 4 pares). | Antes: duas listas literais. Depois: uma lista só, `ORDEM_CARGA_ENTIDADES` em `modules/integracao/contracts`, que o Conector pode importar. O `portal-carga.ts` usa essa lista e mantém a conferência com `DEPENDENCIAS`. O Conector faz `export const ORDEM_CARGA = ORDEM_CARGA_ENTIDADES`. O comentário da linha 8, que repete a ordem em prosa, sai. Depois disso, o banco-dados troca o regex de `db/testes/views-modelo-conector.test.ts:152-156`, que lê o literal do Conector, por import do contrato e reordena as views do `views-modelo.sql`. |
| RD-0532 | baixa | modulo-integracao | `modules/integracao/web/lib/apresentacao.ts:93-105` (`ROTULO_AVISO_LINHA`) | Export morto: nenhum arquivo do repositório importa o mapa (`git grep` no `main` e no branch). Mesmo assim, o branch editou o rótulo `referencia_descartada` (`:99`). O mapa também não tem o código novo `vendedor_sem_filial`. | Apagar `ROTULO_AVISO_LINHA`. Se a gaveta do lote precisar de rótulo, ligar o mapa à tela e cobrir todo o `CODIGOS_AVISO_LINHA` com `Record<CodigoAvisoLinha, string>`. |
| RD-0533 | baixa | modulo-integracao | `modules/integracao/domain/vendedor-filial.ts:12` (mensagem do aviso, no monitor do BKO) | O texto vai além do problema e da ação. "O cadastro foi carregado." repete o que o próprio tipo "aviso" (linha aplicada) já diz (R-20261110-192153). | Antes: `Vendedor sem filial: bloqueado até informar a filial (na carga ou no Backoffice). O cadastro foi carregado.` Depois: `Vendedor sem filial: bloqueado até informar a filial (na carga ou no Backoffice).` |
| RD-0534 | baixa | banco-dados | `db/conector/views-modelo.sql:9-11`, `:77`, `:118`, `:130` | (a) O cabeçalho repete em prosa a lista das 16 entidades. As views já estão nessa ordem e o teste `views-modelo-conector.test.ts:180-186` confere essa ordem com o `ORDEM_CARGA`. (b) A regra "filial antes do vendedor, o vendedor cita a filial" aparece 3 vezes em 55 linhas: no cabeçalho da view 1 (`:77`), no cabeçalho da 1b (`:118`) e no comentário da coluna (`:130`). | (a) Antes: "NA ORDEM DE CARGA do Conector (…ORDEM_CARGA): filial, vendedor, …, nota." Depois: "Na ordem de carga do Conector (`ORDEM_CARGA`), conferida por teste." A lista em prosa sai. (b) A linha `:118` sai. O comentário da coluna (`:130`) fica: é ele que o técnico lê ao trocar `v.id_filial`. |
| RD-0535 | baixa (teste; segura, precedente RD-0233) | modulo-integracao | `modules/integracao/domain/vendedor-filial.test.ts:2-3`; `modules/integracao/kit-thathyany/kit-thathyany.test.ts:291-307` | (a) Dois `import` do mesmo módulo `./ordem`. (b) Há 3 `it` que conferem o mesmo `IF COL_LENGTH … ALTER TABLE` em colunas diferentes: `marca_codigo` (`:291`), `filial_external_id` (`:297`) e as referências (`:304`). | (a) Trocar por `import { ordenarCarga, referenciasDoRegistro } from './ordem';`. (b) Um `it` só, com laço sobre as colunas acrescentadas (`referencia_1`, `marca_referencia_3`, `marca_codigo`, `filial_external_id`). Os outros asserts de `:291` e `:297` (modelo, `conector.json`, `referencia` no contrato) ficam no `it` de cada campo. |

## 2. Cópias da ordem de carga: o que fica e o que deriva

| Cópia | Onde | Parecer |
|---|---|---|
| `DEPENDENCIAS` | `modules/integracao/domain/ordem.ts:9` | **Fonte da verdade** das dependências (RN-INT-04, RN-CORE-39). Fica. |
| `ORDEM_PORTAL` | `modules/integracao/domain/portal-carga.ts:12` | Fica uma ordem fixa (escolhe uma entre as ordens topológicas válidas), com a conferência em tempo de execução contra `DEPENDENCIAS`. Vira a lista única do RD-0531 e passa para `contracts`. |
| `ENTIDADES_ORDEM_CARGA` | `modules/integracao/domain/modelos-csv.ts:27` | Já deriva do portal. Certo. |
| `ORDEM_CARGA` do Conector | `apps/conector/src/config/entidades.ts:9` | **Deve derivar** (RD-0531). O Conector já importa `@macuxi/integracao/contracts`. |
| Kit da thathyany (`contrato.json`, `criar-banco.sql`, `carga_csv.py`) | `kit-thathyany/scripts/gerar.ts:230` | Já deriva de `ENTIDADES_ORDEM_CARGA` (gerado). Certo. |
| `ENTIDADES_PILOTO` | `kit-piloto/scripts/montar-kit.mjs:24` | Necessária: é um subconjunto escolhido para o piloto, num script `.mjs` que não importa TS. A ordem dela, porém, não tem conferência contra `DEPENDENCIAS`. Sugestão, só em teste e sem segurar: em `kit-piloto.test.ts`, `expect(ordenarCarga(ENTIDADES_PILOTO)).toEqual({ ok: true, ordem: ENTIDADES_PILOTO })`, que dispensa os 3 `indexOf` à mão. |
| `ENTIDADES` do erp-via-api | `kit-piloto/erp-via-api/erp-via-api.mjs:18` | Necessária: o script vai solto no zip do cliente, sem import do repositório. O teste `kit-piloto.test.ts:232` exige que seja igual a `ENTIDADES_PILOTO`. |
| `guia-api-hub.md` (tabela e "Sequência segura") | `modules/integracao/docs/guia-api-hub.md:64-79` | Necessária: é o doc do integrador externo. A tabela é a versão legível de `DEPENDENCIAS`, e as "ondas" da sequência são outra informação (o que pode ir em paralelo). Fica. |
| Views do `views-modelo.sql` | `db/conector/views-modelo.sql` | A ordem das views é necessária (modelo SQL escrito à mão, com conferência por teste). Depois do RD-0531, a conferência passa a ser contra o contrato. A lista em prosa do cabeçalho sai (RD-0534). |

## 3. Sem achado

- Contrato `marca_codigo` e `VendedorPayload.filial_external_id`, `CODIGOS_AVISO_LINHA` e OpenAPI: estão gerados e alinhados, sem duplicação.
- `referenciasDoRegistro('vendedor')` usa o `ref` comum, sem cópia da regra do cliente.
- Migração 0076, `docs/banco/core.md` e espelho Drizzle: o cabeçalho da migração, a seção do dicionário e o cabeçalho do teste repetem "aditiva, sem CHECK, como voltar". Fica (`manter`), porque é o padrão do banco-dados em todas as migrações e cada texto tem um leitor diferente. O teste estático do espelho (`varchar(30)`) acrescenta o tipo, que o `drizzle-x-banco` não confere.
- `ROTEIRO.md` do kit (passo 4): só diz o que pôr em cada coluna nova, que é a ação do técnico. As regras ficam no `contrato.json`, como pede o precedente RD-0491.
- `COLUNAS_ACRESCENTADAS` (`gerar.ts:53`): lista curta e necessária, porque nem toda coluna do Hub precisa de `ALTER` no banco antigo.

## 4. Reteste de achados anteriores (kit 1.0.5)

| RD | Evidência | Status |
|---|---|---|
| RD-0490 | `kit-thathyany/scripts/gerar.ts:242`: `extras` filtra só por `COLUNAS_SO_CONECTOR`, sem o `!derivadas.includes(col)` morto | **corrigido** |
| RD-0503 | `gerar.ts:36` ("a marca é opcional, basta o código"), `gerar.ts:94` (documenta `requer`), `testes/test_carga_csv.py:238` | **corrigido** |

## 5. Encaminhado ao testes (fora do escopo, não catalogado)

Nenhum defeito funcional encontrado. A falta de `vendedor_sem_filial` no `ROTULO_AVISO_LINHA` não tem efeito na tela, porque o mapa não é usado (RD-0532).

## 6. Reteste (15/11/2026, tarde)

Heads: `nuvem/marca-codigo-modulo-integracao` 46876619, `nuvem/referencia-cruzada-modulo-integracao` 759a0799 e `nuvem/marca-codigo-banco-dados` 00e050dc.

**Resultado: COM ACHADO.** Os 5 achados da rodada foram corrigidos, mas a correção trouxe 3 achados novos (RD-0536 a RD-0538), e todos seguram o lote.

### 6.1 Reteste

| RD | Evidência | Status |
|---|---|---|
| RD-0531 | Existe uma lista só, `ORDEM_CARGA_ENTIDADES` (`modules/integracao/contracts/entidades.ts:32`). O `ORDEM_PORTAL` (`domain/portal-carga.ts:12`) e o `ORDEM_CARGA` do Conector (`apps/conector/src/config/entidades.ts:9`) apontam para ela. O teste `domain/ordem.test.ts:43-51` confere a lista contra `DEPENDENCIAS`. Do lado do banco, `db/testes/views-modelo-conector.test.ts:16` importa a constante, o regex saiu e as views foram renumeradas de 1 a 16 na ordem do contrato. O `ENTIDADES_PILOTO` e o erp-via-api foram reordenados do mesmo jeito. | **corrigido** |
| RD-0532 | `ROTULO_AVISO_LINHA` foi apagado de `web/lib/apresentacao.ts`. Nenhuma referência sobrou no repositório (`git grep` = 0). | **corrigido** |
| RD-0533 | `domain/vendedor-filial.ts:12`: "Vendedor sem filial: bloqueado até informar a filial (na carga ou no Backoffice)." | **corrigido** |
| RD-0534 | O cabeçalho do `views-modelo.sql:9` aponta para `ORDEM_CARGA_ENTIDADES`, sem a lista em prosa. A regra "filial antes do vendedor" fica só no comentário da coluna (`:127`). | **corrigido** |
| RD-0535 | `vendedor-filial.test.ts:2` agora tem um import só. `kit-thathyany.test.ts:291-294` tem um `it` só, com laço sobre as 4 colunas. | **corrigido** |

### 6.2 Achados novos

| RD | Grav. | Dono | Onde | O que se repete | Proposta (antes → depois) |
|---|---|---|---|---|---|
| RD-0536 | alta | modulo-integracao | `docs/modulos/integracao/conector.md:432` | O doc diz "A ordem de carga do Conector põe `filial` logo depois de `vendedor`.", o contrário da lista única nova e do `guia-api-hub.md:79` (filial, vendedor, …). A mesma regra está em dois docs com textos que se contradizem. | Antes: "A ordem de carga do Conector põe `filial` logo depois de `vendedor`." Depois: a frase sai. A ordem é a de `ORDEM_CARGA_ENTIDADES`, e o `:419` já remete a ela. |
| RD-0537 | baixa (teste; segura, precedente RD-0233) | modulo-integracao | `apps/conector/test/ordem-carga.test.ts:5-16`; `domain/ordem.test.ts:43-51` × `domain/modelos-csv.test.ts:103-111` | Com a lista única, há 3 testes conferindo a mesma constante. O `ordem.test.ts:43-51` (conjunto, dependências antes, `slice(0, 2)`) repete o `modelos-csv.test.ts:103-111`. Os 2 `it` do Conector conferem pares soltos da mesma lista, que é `ORDEM_CARGA` por apelido. | Deixar a conferência completa só no `ordem.test.ts:43-51`, ao lado de `DEPENDENCIAS`. No `modelos-csv.test.ts:103-111`, ficar só `expect([...ENTIDADES_ORDEM_CARGA]).toEqual([...ORDEM_CARGA_ENTIDADES])` e a parte de `RESUMO_MODELOS`, opcional e `depende_de`. No Conector, trocar os 2 `it` por `expect(ORDEM_CARGA).toBe(ORDEM_CARGA_ENTIDADES)`. |
| RD-0538 | baixa (teste; segura, precedente RD-0233) | banco-dados | `db/testes/views-modelo-conector.test.ts:178` e `:182-188` | (a) `expect([...ordem].sort()).toEqual([...ENTIDADES].sort())` (`:178`) confere a constante do contrato, o que o `ordem.test.ts` já faz, e também é implicado pelas linhas `:176` e `:179`. (b) O `it` "a ordem respeita as dependências da T-0089" (`:182-188`) confere 4 pares das views, que já são iguais à lista (`:179`) conferida contra `DEPENDENCIAS` no `ordem.test.ts:43-51`. | Ficam as linhas `:174-176` e `:179`. Saem a linha `:178` e o `it` das linhas `:182-188`. |

### 6.3 Sem redundância nova

- O apelido `ORDEM_PORTAL` (local, `portal-carga.ts:12`) e o apelido `ORDEM_CARGA` do Conector, que é usado em 6 arquivos, ficam: só dão nome local à lista única, sem segunda cópia (`manter`).
- `docs/banco/integracao.md:421` ("1b, logo depois do vendedor") faz parte do registro histórico da 0056, então fica como está.
- Ordem de merge, para o gerente: o teste do banco (`views-modelo-conector.test.ts:16`) importa `ORDEM_CARGA_ENTIDADES`, que só existe no branch do modulo-integracao. Por isso o PR do banco-dados entra depois dele.
