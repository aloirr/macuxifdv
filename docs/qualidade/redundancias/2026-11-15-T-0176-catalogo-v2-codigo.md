# T-0176 · Catálogo v2 no Campo (código) · parecer do corretor-redundancias

**Veredito: COM ACHADO.** São 9 achados, do RD-0685 ao RD-0693: 5 de gravidade média e 4 de gravidade baixa, todos do **modulo-catalogo**. Todos seguram o lote, porque estão em código de produção, tela, teste (no corpo, não só no título) ou comentário de regra. Além disso, há 6 observações para o testes, sem RD.

Corretor-redundancias, 15/11/2026 (horário de Manaus). Conferi `git diff origin/main...origin/nuvem/catalogo-campo-modulo-catalogo-v7`, head **cbb926bb** ("estoque por filial no Campo, contrato final das filiais do Core", RN-CORE-39), com 44 arquivos. A referência foi a spec `docs/design/catalogo-campo-v2/spec.md` do `origin/nuvem/catalogo-campo-designer-ux`, já revisada no parecer `2026-11-15-catalogo-campo-v2-filtro-padrao.md` (branch `nuvem/catalogo-campo-corretor-redundancias`, RD-0496 a RD-0577). Não repito achados da spec já fechados. Também mantive as decisões do parecer anterior: o código na linha de apoio da folha fica, e o cabeçalho "Filial | Estoque" ficou por decisão do dono do produto (RD-0574).

Caixa: `node scripts/coord.mjs caixa corretor-redundancias` respondeu **HTTP 403**, porque o repositório de recados não está habilitado nesta sessão. Por isso não li a caixa nem enviei recados. Este parecer segue ao gerente-projetos pela entrega da sessão, e ele repassa os recados ao modulo-catalogo e ao testes.

## O que ficou fiel e sem sobra
- **Cartão:** "Estoque: N" (chip) e o botão `pacote` são a única representação do estoque. O "Estoque sem informação", a faixa laranja e a hora saíram do cartão. O TalkBack lê "Estoque 0" uma vez só.
- **Ficha:** a caixa antiga ("Estoque na filial…", selo, hora e uma linha por filial) foi trocada pelo chip e por "Por filial". A tabela e a hora ficam só na folha, como pede a spec §2.
- **Folha "Filtrar":** os grupos Filial e Itens sem estoque, com "Limpar" e "Ver N produtos". "Só com estoque ✕" só aparece com `Ocultar`.
- **`apresentacao.ts`:** `rotuloEstoque`, `rotuloFaixa`, `rotuloEstoqueFilial` e `TomCatalogo` saíram, sem cópia em outro lugar. A ficha e o cartão usam a mesma `tagDeEstoque`.
- **API:** a regra de quem vê qual filial vem do contrato `core.filiais_do_usuario@1`, e a tabela do Core não é lida. O N sai de `filiaisDoEstoque` (domain) na API e no aparelho, e a busca online usa o estoque do aparelho (decisão 4).

## Achados

### RD-0685 · média · texto · layout · modulo-catalogo: com uma só filial de venda, a tela diz a filial duas vezes
- **Onde:** `modules/catalogo/app/telas/catalogo.tsx:186` (`nomesProprias.length > 0`) e `modules/catalogo/domain/estoque-campo.ts:93` (`nomesDoGrupo`, o ramo de um nome só, `Filial ${nomes[0]}`).
- **O que se repete:** se o usuário tem uma filial de venda (o caso da `01-grade.png`), a faixa mostra "Boa Vista · 40 produtos" e logo abaixo aparece a etiqueta "Filial Boa Vista", sem ✕. O botão Filtrar ainda ganha o selo `1`, sem nenhum filtro escolhido. A filial aparece 2 vezes na mesma tela, e o selo conta um filtro que não existe. A spec §4 diz: "com uma só, não há chip"; e a `01`: "sem selo e sem chip".
- **Impacto:** leitura e decisão. O selo `1` faz o vendedor procurar um filtro para limpar.
- **Proposta:**
  - `catalogo.tsx:186`: antes `nomesProprias.length > 0`, depois `nomesProprias.length > 1`;
  - `estoque-campo.ts:93`: `nomesDoGrupo` fica só com `Suas filiais (${nomes.length})`, e o ramo de um nome sai;
  - o teste `estoque-campo.test.ts:81` passa a esperar que, com uma filial só, não haja chip.

### RD-0686 · média · texto · modulo-catalogo: a linha de apoio da folha diz a idade do estoque duas vezes
- **Onde:** `modules/catalogo/app/lib/estoque-folha.ts:27`.
- **O que se repete:** se o estoque está defasado, a linha fica "PAF.1434 · **Estoque desatualizado** · **Atualizado ontem às 06:12**". São 2 representações do mesmo fato (a idade do dado), e "Estoque" repete o título da folha, "Estoque por filial", uma linha acima. A spec §2.1 traz só "`PAF.1434 · Atualizado às 07:28`". O aviso também fica fora da área "Alertas" (R-20261110-093124). A "redundância útil" de aviso de dado antigo não se aplica aqui, porque o "ontem às" / "em 12/11 às" já mostra que o dado é antigo.
- **Proposta:** antes, `` `${e.codigo} · ${a.stale ? `${AVISO_ESTOQUE_DESATUALIZADO} · ` : ''}${hora}` ``; depois, `` `${e.codigo} · ${hora}` ``. Sai o import de `AVISO_ESTOQUE_DESATUALIZADO`. O teste `estoque-folha.test.ts:59` perde o caso "velho".

### RD-0687 · média · código · modulo-catalogo: duas `filiaisDoEstoque` no mesmo domain
- **Onde:**
  - `modules/catalogo/domain/estoque.ts:93-109`: `EntradaFiliaisDoEstoque` e `filiaisDoEstoque`, a antiga, por carteira ou tenant;
  - `modules/catalogo/domain/estoque-campo.ts:40`: a nova, cujo comentário diz "ÚNICA função que decide as filiais";
  - `modules/catalogo/api/repositorio-postgres.ts:15` e `:546`;
  - `docs/modulos/catalogo/regras.md`: a linha RN-CAT-07 aponta `estoque.ts (filiaisDoEstoque)`, e o §8 traz "Estoque (`filiaisDoEstoque` + `estoqueVisivel`)".
- **O que se repete:** duas funções com o mesmo nome e o mesmo assunto, as duas no domain. A antiga só serve para `repositorio-postgres.filiaisDoUsuario(clienteId)`, que entrega a filial do cliente. O `rotas.ts:176` lê só `escopo?.[0]`. A regra "carteira/tenant" da antiga já não decide nada.
- **Impacto:** manutenção. Quem procura "a regra das filiais do estoque" acha duas, e o doc aponta a errada.
- **Proposta:** o repositório expõe `filialDoCliente(clienteId): Promise<string | null>`, com base no `filialDoClienteNoCore` que já existe. Saem `EntradaFiliaisDoEstoque` e a `filiaisDoEstoque` de `estoque.ts`, com os testes delas. O `regras.md` passa a apontar `estoque-campo.ts`.

### RD-0688 · média · código · modulo-catalogo: dois adaptadores e três tipos para o mesmo contrato do Core
- **Onde:**
  - `modules/catalogo/api/filiais-core.ts:52-72`: `FiliaisDeVendaDoUsuario` e `lerFiliaisDeVenda`, com `FilialDoUsuarioSchema`;
  - `modules/catalogo/app/lib/filiais-usuario.ts`: `FiliaisDeVendaLocal` e `lerFiliaisDeVendaDaLinha`, com leitura manual dos campos;
  - `modules/catalogo/domain/estoque-campo.ts:19-26`: `UsuarioFiliais`.
- **O que se repete:** as duas funções leem `{ filial_cadastro_id, filial_venda_ids, sem_filial }` e repetem a mesma regra: tirar ids duplicados e `sem_filial || lista vazia`. Só a do servidor valida pelo Zod do contrato. Ficam 3 formas para o mesmo dado, e os chamadores convertem de uma para outra (`rotas.ts:175`, `local.ts:357`).
- **Proposta:** uma função pura no domain, por exemplo `filiaisDeVendaDoContrato(dados: FilialDoUsuario)`, com um tipo só. Os dois lados passam a validar pelo `FilialDoUsuarioSchema.safeParse`, já que o app pode importar `@macuxi/core/contracts`. Cada lado decide só o próprio fallback: a API trata a saída inválida como sem filial, e o app trata a linha ausente como `null`.

### RD-0689 · média · código · modulo-catalogo: o "Atualizado às" está em duas funções, e a antiga não tem mais uso
- **Onde:** `modules/catalogo/domain/estoque.ts:77-91` (`rotuloAtualizacaoEstoque`) e `modules/catalogo/domain/estoque-campo.ts`, no fim do arquivo (`rotuloCargaEstoque`).
- **O que se repete:** as duas montam "Atualizado às hh:mm" / "Atualizado em dd/mm às hh:mm" com o mesmo `Intl` e o mesmo `localDate`. A nova acrescenta o "ontem". Depois deste branch, a antiga só aparece no `estoque.test.ts` e em comentários: `estoque.ts:4`, `contracts/busca.ts:103` e o `regras.md` §5 ("`rotuloAtualizacaoEstoque(estoque, agora, fuso)` dá o texto da tela"). Nenhuma tela a chama mais.
- **Proposta:** sai `rotuloAtualizacaoEstoque`, com os testes dela. Os três comentários e o `regras.md` §5 passam a citar `rotuloCargaEstoque`. Se o BKO precisar da hora do ERP, ele chama a mesma `rotuloCargaEstoque(updated_at, …)`.

### RD-0690 · baixa · código · modulo-catalogo: um predicado que é sempre verdadeiro e exports sem uso
- **Onde e o que sobra:**
  - `domain/visibilidade.ts:16`: `podeVerEstoque = (_perfil) => true`. Os 4 testes negativos dela são ramos mortos: `app/lib/local.ts:295`, `api/rotas.ts:183` e `domain/vitrine.ts:86` e `:134`;
  - `domain/preco-filial.ts:128`: `filialNaCarteira` perdeu o único chamador (`rotas.ts`) e ficou só no teste;
  - `domain/estoque-campo.ts:21`: `UsuarioFiliais.perfil` não é lido por `filiaisDoEstoque` nem por `filiaisDaFolha`, mas os chamadores o montam (`rotas.ts:175`, `local.ts:357`).
- **Proposta:** sai `podeVerEstoque`, e os 4 ramos ficam sem o teste. Sai `filialNaCarteira`, com o caso dela no `preco-filial.test.ts`. Sai o campo `perfil` de `UsuarioFiliais`.

### RD-0691 · baixa · código · modulo-catalogo: campos, props e textos que repetem outro
- `app/lib/grade.ts:92`: `codigosDoCartao` devolve `produto` e `copiar`, os dois iguais a `item.erp_code`. Deve ficar um campo só, `codigo`.
- `app/lib/estoque-folha.ts:9` e `:26`: `DadosDaFolha.titulo` é sempre `TITULO_FOLHA_ESTOQUE`. Mesmo assim, `telas/estoque-filial.tsx` repete o texto `'Estoque por filial'` em 3 lugares (`:13`, `:21`, `:29`). O certo é usar a constante nos 3 lugares e tirar o campo `titulo`.
- `telas/estoque-filial.tsx` (`FolhaFiltroCatalogo`) e `catalogo.tsx:317`: a prop `filialMarcada` é sempre `escolha.filial ?? 'todas'`, e a folha já recebe `escolha`. A prop sai, e a folha calcula.
- `telas/catalogo.tsx:76-97`: dois `useEffect` com as mesmas dependências (`motor`, `usuarioId`, `sync.sincronizado_em`) leem a mesma linha `usuario`: `filiaisDoUsuarioLocal`, e `filialDeCadastroLocal`, que chama `filiaisDoUsuarioLocal` de novo. Deve ficar um efeito só, que lê a linha uma vez e preenche as filiais e a faixa.

### RD-0692 · baixa · teste · modulo-catalogo: os casos do domain se repetem nos testes dos invólucros do app
O que segura é o corpo do teste, não o título.

| Caso | Domain (fica) | Repetido em |
|---|---|---|
| 999+ no cartão, exato na ficha | `estoque-campo.test.ts:62` | `grade.test.ts:55` |
| "Em estoque" / "Sem estoque" | `estoque-campo.test.ts:71` | `estoque-campo.test.ts:104`, `grade.test.ts:60`, `estoque-folha.test.ts:66` |
| Verde acima de 0, vermelho em 0 ou menos | `estoque-campo.test.ts:75` | `grade.test.ts:43` |
| "ontem" e "Sem hora de atualização" | `estoque-campo.test.ts:114` e `:119` | `estoque-folha.test.ts:40` e `:59` |
| Nenhuma linha com "sua filial" | `estoque-campo.test.ts:104` | `estoque-folha.test.ts:34` |

- **Proposta:** os testes do app ficam com um caso cada, e só para o que o invólucro acrescenta: o `noCartao` repassado, o prefixo do código na linha de apoio e a leitura do TalkBack. O resto sai.

### RD-0693 · baixa · doc · modulo-catalogo: comentários ainda descrevem a regra antiga, por perfil
- **Onde:**
  - `domain/visibilidade.ts:1-5`: "promotor, supervisor e gerente só das filiais deles";
  - `domain/vitrine.ts:58`: "`null` = todas, o vendedor";
  - `contracts/rotas.ts:26`: "soma de todas; para quem só vê as suas, as suas".
- **O que se repete:** a regra de quem vê qual filial, escrita de novo em 3 lugares, com um texto que contradiz a fonte. A fonte é o cabeçalho de `estoque-campo.ts`: "todo perfil vê só as filiais de VENDA dele".
- **Proposta:** cada comentário fica só com a remissão. Por exemplo: "filiais do estoque: `estoque-campo.ts` (RN-CORE-39)" e "`todas` = Suas filiais (a soma das de venda)".

## Para o testes (defeito ou desvio da spec, sem RD)
1. **Faixa:** o código mostra "Boa Vista · 40 produtos" (`grade.ts`, `subtituloDaGrade`), e a spec §4 pede "Sua filial: Boa Vista · 1.284 produtos".
2. **"sua filial" e a ordem:** a spec §2.1 e §4 pede a filial de cadastro primeiro, com a marca `sua filial`, na folha "Estoque por filial" e no grupo Filial do "Filtrar". O código passa `marcarPropria: false` (`estoque-folha.ts:24`) e `apoio: null` (`:48`) e ordena tudo em ordem alfabética.
3. **Ficha:** a spec §2 manda tirar a caixa "Copiar código" (`BotaoCopiarCodigo` variante `ficha`) e pôr o ícone de copiar na faixa, ao lado do código. O código mantém a caixa (`produto.tsx`).
4. **Cartão:** a foto está com `altura={112}`, e a spec §1 pede 96 dp. Falta conferir o nome em 3 linhas (16/20).
5. **Com cliente no contexto:** a spec §4 diz "a filial é a do cliente, no mesmo chip". O chip continua montado com as filiais de venda do usuário (`catalogo.tsx:184-186`).
6. **Sync do vendedor:** `veSoSuasFiliais` deixa o vendedor de fora, e o pull de `estoque_saldo` dele segue pela carteira (`api/sync.ts:123-124`). Se uma filial de venda não está na carteira, ela chega ao aparelho sem saldo, e o N local pode dar 0. Falta conferir o caso com o contrato final.

## Situação
RD-0685 a RD-0693 estão **abertos** e seguram o lote. O dono é o modulo-catalogo, com cópia ao gerente-projetos. Os RD-0694 a RD-0699 não foram usados. O reteste será feito no próximo head do `nuvem/catalogo-campo-modulo-catalogo-*`, com o print do aparelho para o RD-0685 e o RD-0686.
