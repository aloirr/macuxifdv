# Catálogo onda 1 + Catálogo Campo v8: parecer para a Meta v1.0.13

> 2026-11-15, à tarde (Manaus; corte da Meta às 15h30) · corretor-redundancias · pedido do gerente-projetos.
> Base: `origin/main` 2e554c4a. Li `git diff origin/main...origin/<branch>`, sem checkout no diretório principal.
> Regras aplicadas: R-20261110-062506 (nenhum achado em aberto, de qualquer gravidade), R-20261110-093124 e RN-VEN-42 (uma
> informação, um lugar; aviso só em Alertas), R-20261110-192153 (só o que o usuário usa para agir) e a exceção R-20261111-190159
> (gravidade baixa só em comentário ou título de teste não segura).
> Caixa: `node scripts/coord.mjs caixa corretor-redundancias` respondeu **HTTP 403**. Nenhum recado foi enviado: o gerente
> repassa a tabela da §2 aos donos.

| # | Branch | Head | Dono | Resultado |
|---|---|---|---|---|
| 1 | `nuvem/catalogo-onda1-modulo-core-v2` | b207cb1c → **155544cc** | modulo-core | **LIMPO** no re-parecer (RD-0672 e RD-0676 lado Core fechados) |
| 2 | `nuvem/catalogo-onda1-modulo-catalogo-v3` | 88122be7 → **6b1f4815** | modulo-catalogo | **COM ACHADO** no re-parecer: RD-0675 reaberto (resto). RD-0670 e RD-0676 fechados |
| 3 | `nuvem/catalogo-onda1-designer-ux` | b63e1e3b → **87943b16** | designer-ux | **COM ACHADO** no re-parecer: RD-0671 fechado; novo RD-0696 |
| 4 | `nuvem/catalogo-onda1-engenheiro-apps` | e4636797 → **541522ce** | engenheiro-apps | **LIMPO** no re-parecer (RD-0673, RD-0674 e RD-0677 fechados) |
| 5 | `nuvem/catalogo-campo-modulo-catalogo-v8` | d2d4660f → **e390219f** | modulo-catalogo | **COM ACHADO** no re-parecer v8: 8 fechados; RD-0691, RD-0692 e RD-0694 (restos) e o novo RD-0698 seguram; RD-0699 não segura |

## 1. Reteste
- **Branches 1 a 4:** os heads são **os mesmos** do parecer `2026-11-15-catalogo-onda1.md` (branch
  `nuvem/catalogo-onda1-corretor-redundancias`). Nada mudou, e os RD-0670 a RD-0677 seguem **abertos**, com os mesmos
  arquivos e linhas. Não repito o detalhe aqui. A §2 traz o resumo e a correção.
- **Branch 5:** o v8 é o v7 (cbb926bb, parecer `2026-11-15-T-0176-catalogo-v2-codigo.md`) reaplicado sobre o `main` novo. Em
  `modules/catalogo`, ele muda só dois testes (`estoque-campo.test.ts` e `estoque.test.ts`) e o `docs/modulos/catalogo/regras.md`.
  O código de tela e de domain é o mesmo do v7, então os RD-0685 a RD-0693 seguem **abertos**, nas mesmas linhas. Confirmei 4 deles
  no head d2d4660f:
  - RD-0685 em `catalogo.tsx:186` (`nomesProprias.length > 0`);
  - RD-0686 em `estoque-folha.ts:27`;
  - RD-0691 em `catalogo.tsx:81` e `:93` (dois efeitos para a mesma linha `usuario`) e em `catalogo.tsx:317` (`filialMarcada`);
  - RD-0687 em `domain/estoque.ts:93-109`, que ainda tem a `filiaisDoEstoque` antiga.
  O v8 mexeu no `regras.md`, mas a remissão que o RD-0687 pedia continua sem sair: o §8 agora diz "`filiaisDoEstoque` +
  `filiaisDaFolha`", e há duas funções com esse nome.
- **Sobre o texto de carregando (pergunta do gerente):** **sim, o v3 deve usar o `CatalogoCarregando` do branch 3.**
  - `carga-online.ts:21`: sai `TEXTO_CATALOGO_CARREGANDO` ("O catálogo ainda está carregando. Conecte-se à internet para
    buscar."). As três consultas passam a usar o `TEXTO_CATALOGO_CARREGANDO` de `@macuxi/ui/mobile/puro` ("Busque quando tiver
    sinal.").
  - `telas/catalogo.tsx`: hoje o texto vai no `Banner` (`lista.aviso`), que é forma de aviso fora de Alertas. Passa a montar
    `<CatalogoCarregando />` no lugar da grade.
  - `telas/produto.tsx`: troca `<Empty text={TEXTO_CATALOGO_CARREGANDO} />` por `<CatalogoCarregando comTitulo />`.
  - Com isso fecham o RD-0670 e a colisão de nome das duas constantes `TEXTO_CATALOGO_CARREGANDO`.

## 2. Achados em aberto (todos seguram a Meta)

| RD | Branch | Onde | Gravidade | Dono | Correção |
|---|---|---|---|---|---|
| RD-0670 | 2 | `modules/catalogo/app/lib/carga-online.ts:21`; `telas/catalogo.tsx:140,145,221-228`; `telas/produto.tsx:76` | média | modulo-catalogo | Usar o `CatalogoCarregando` e o texto do kit, sem `Banner`, e apagar a constante provisória (§1) |
| RD-0671 | 3 | `docs/design/carga-em-segundo-plano.md` §2; `packages/ui/src/mobile/carga-fundo-rn.tsx` (`CatalogoCarregando`); `simulacoes/2026-11-15-catalogo-carregando-3.png` | média | designer-ux | Na aba Catálogo, sem sinal, o print mostra a mesma informação 3 vezes: o indicador "Catálogo 63% · parado" com `wifiOff`, o vazio com `wifiOff` e "Catálogo ainda carregando", e o selo "Sem sinal". Na aba, o vazio fica só com "Busque quando tiver sinal." (prop `comTitulo`, padrão `false`, sem o segundo `wifiOff`). O título fica só na ficha e no Novo pedido, que não mostram o indicador |
| RD-0672 | 1 | `modules/core/domain/entrada-sync.ts:194`; `modules/core/app/index.ts:29` | média | modulo-core | `entradaLiberada` repete a regra de `essencialDaEntrada` e não é usada fora do teste. Sai, e no lugar o Core exporta `etapaQueLibera(perfil)` |
| RD-0673 | 4 | `apps/mobile/src/lib/carga-fundo.ts:38` | média | engenheiro-apps | `ETAPAS_DA_LIBERACAO` copia no shell a regra do Core. Passa a usar o `etapaQueLibera` do RD-0672 |
| RD-0674 | 4 | `apps/mobile/src/lib/ordem-da-carga.ts:31-43` × `:12-24` | baixa | engenheiro-apps | `essenciaisDoUsuario` repete o memo de `ordemDaCargaDoUsuario`. Um auxiliar `porPerfilEModulos(fabrica)` serve aos dois |
| RD-0675 | 2 | `telas/catalogo.tsx:65,140`; `telas/produto.tsx:38,41,52`; `lib/consultas-online.ts:14,18` | baixa | modulo-catalogo | (a) As telas recalculam o modo fora de `usarApiNaCarga`. (b) A ficha faz o mesmo `GET produtos/:id` duas vezes (`produto.tsx:41` e `:52`). (c) `new ConsultaIndisponivel(…)` aparece 3 vezes, ao lado do auxiliar. Ficam uma função de modo, uma chamada online e o auxiliar `indisponivel` |
| RD-0676 | 2 | `modules/catalogo/app/lib/carga-online.ts:12-18` × `modules/core/domain/entrada-sync.ts:44-46` | baixa | modulo-catalogo · modulo-core | `CHAVES_DO_CATALOGO` relista `produto`, `produto_unidade` e `medida`, que são do Core. O Core exporta em `contracts` as entidades da etapa `catalogo_precos`, ou então o shell entrega na porta um `catalogoPendente()` já calculado pelo Core |
| RD-0677 | 4 | `apps/mobile/src/services/motor-do-usuario.test.ts:68-80`; `apps/mobile/src/lib/ordem-da-carga.test.ts:185-207` × `modules/core/domain/entrada-sync.test.ts:186-203` | baixa | engenheiro-apps | Os casos de "essenciais" estão testados 3 vezes. A regra fica só no teste do Core, e o shell testa só o repasse |
| RD-0685 | 5 | `modules/catalogo/app/telas/catalogo.tsx:186`; `domain/estoque-campo.ts:93` | média | modulo-catalogo | Com uma só filial de venda, a etiqueta "Filial Boa Vista" e o selo `1` repetem a faixa "Boa Vista · N produtos". A condição passa a ser `> 1`, e sai o ramo de um nome só |
| RD-0686 | 5 | `modules/catalogo/app/lib/estoque-folha.ts:27` | média | modulo-catalogo | "Estoque desatualizado · Atualizado ontem às…" diz a idade duas vezes. Fica `${codigo} · ${hora}` |
| RD-0687 | 5 | `domain/estoque.ts:93-109`; `api/repositorio-postgres.ts:15,546`; `docs/modulos/catalogo/regras.md` §8 | média | modulo-catalogo | Há duas `filiaisDoEstoque`. A antiga sai, o repositório expõe `filialDoCliente(clienteId)`, e o doc aponta só `estoque-campo.ts` |
| RD-0688 | 5 | `api/filiais-core.ts:52-72`; `app/lib/filiais-usuario.ts`; `domain/estoque-campo.ts:19-26` | média | modulo-catalogo | Dois adaptadores e três tipos para o mesmo contrato do Core. Fica uma função pura no domain, que valida pelo `FilialDoUsuarioSchema` |
| RD-0689 | 5 | `domain/estoque.ts:77-91` × `domain/estoque-campo.ts` (`rotuloCargaEstoque`); `regras.md` §5 | média | modulo-catalogo | O "Atualizado às" está em duas funções, e a antiga não tem uso. Sai `rotuloAtualizacaoEstoque`, e os comentários e o doc passam a citar a nova |
| RD-0690 | 5 | `domain/visibilidade.ts:16`; `app/lib/local.ts:295`; `api/rotas.ts:183`; `domain/vitrine.ts:86`; `domain/preco-filial.ts:128` | baixa | modulo-catalogo | `podeVerEstoque` é sempre verdadeiro, e os ramos negativos dele estão mortos. `filialNaCarteira` e `UsuarioFiliais.perfil` também não têm uso. Os três saem |
| RD-0691 | 5 | `app/lib/grade.ts:92`; `app/lib/estoque-folha.ts:9,26`; `telas/estoque-filial.tsx:13,21,29`; `telas/catalogo.tsx:81,93,317` | baixa | modulo-catalogo | `codigosDoCartao.produto` é igual a `copiar`. `'Estoque por filial'` aparece 4 vezes. A prop `filialMarcada` é derivada. Há dois efeitos para a mesma linha `usuario`. Tudo vira um campo, uma constante e um efeito |
| RD-0692 | 5 | `app/lib/grade.test.ts:43,55,60`; `app/lib/estoque-folha.test.ts:34,40,59,66` × `domain/estoque-campo.test.ts` | baixa | modulo-catalogo | Os testes do app repetem os casos do domain no corpo. Cada um fica com um caso, só para o que o invólucro acrescenta |
| RD-0693 | 5 | `domain/visibilidade.ts:1-5`; `domain/vitrine.ts:58`; `contracts/rotas.ts:26` | baixa | modulo-catalogo | Os comentários ainda descrevem a regra antiga, por perfil. Cada um fica só com a remissão a `estoque-campo.ts` |
| **RD-0694** | 5 | `docs/modulos/catalogo/regras.md:19` (tabela RN-CAT-05), `:92` (§5), `:120` ("RN-CAT-05 no domínio"), `:127` (texto proposto ao doc 03) e `:197` (§8) | baixa | modulo-catalogo | **Novo.** O v8 escreveu de novo, em 5 lugares do mesmo doc e com 5 textos diferentes, a regra "todo perfil vê o estoque só das filiais de venda (N = soma; folha = as de venda; com cliente, a dele; com filtro, a escolhida)". A fonte fica na linha da tabela RN-CAT-05 (`:19`), que já aponta para `estoque-campo.ts`. O §5, o "no domínio" e o §8 ficam só com a remissão: "filiais: RN-CAT-05 (`estoque-campo.ts`)". O "texto proposto ao doc 03" (`:127`) vai ao doc 03 e sai daqui quando o doc 03 for atualizado |
| **RD-0695** | 5 | `modules/catalogo/domain/estoque-campo.test.ts:46-53` | baixa | modulo-catalogo | **Novo.** O caso "alternativa em simulação" repete, na última linha, a asserção do caso anterior (`filiaisDaFolha` = as de venda, `:41-45`) e confere uma função criada dentro do próprio teste (`alternativa = x => x.filiaisVenda.slice(0, 1)`), que não testa código de produção. Segura porque está no corpo do teste. O caso inteiro sai, e o "N e folha em funções separadas" já está no comentário de `filiaisDoEstoque` |

Total: 20 abertos. São 9 médios e 11 baixos. Nenhum se encaixa na exceção R-20261111-190159, porque nenhum está só em
comentário ou em título de teste. **Veredito da Meta v1.0.13 para estes 5 branches: NÃO LIBERADO.**

## 3. Encaminhado ao testes (defeito funcional, sem RD; recado não enviado por causa do 403)
1. **`regras.md:92` (v8):** o texto diz "Saldo negativo do ERP conta 0", mas o domain do mesmo branch mantém o sinal
   (`domain/estoque.ts`, `Math.trunc(s.quantity)` sem `Math.max(0, …)`, e o teste `quantity: -3`). A spec v2 §2.1 também pede
   `−2`. O doc contradiz o código.
2. **Branch 2 × branch 5, mesma tela:** os dois mudam o `carregar` de `telas/catalogo.tsx`. O caminho online do v3 (`online()`, a
   busca durante a carga) devolve o estoque da API. O v8 decidiu que, na busca online, o estoque mostrado é o do aparelho
   (decisão 4 do R-20261115-100000). Depois da junção, o modulo-catalogo precisa juntar os dois numa busca online só. Se ficarem
   duas, há duas regras de estoque na mesma tela.
3. **Continuam valendo do parecer anterior:**
   - percentual da etapa × da carga no `IndicadorCargaFundo` (branch 4);
   - os itens 1 a 6 do `2026-11-15-T-0176-catalogo-v2-codigo.md`: faixa "Sua filial:", a marca "sua filial", a caixa "Copiar
     código" na ficha (`produto.tsx:130`), a foto de 112, o chip com cliente e o sync do vendedor.

## 4. Conferido sem achado
- O indicador "Catálogo 63%" / "· parado" não é aviso: não tem cor de alerta e não entra em Alertas. Ele não explica o que o app
  faz por trás e não repete "Sem sinal" nas telas sem o vazio (prints 1 e 2). O rótulo acessível com a causa é redundância útil.
- Os exports novos do kit (`carga-fundo` em `index.ts` e `puro.ts`) seguem o padrão.
- A porta `definirCargaOnline` é uma só por app. A tarefa em segundo plano não a troca.
- No v8, o cartão tem uma representação do estoque ("Estoque: N" + `pacote`). A ficha não repete a tabela, e o "Filtrar" só tem
  "Limpar" com dois grupos.

## Re-parecer onda 1 (2026-11-15, ~16h Manaus)

> Pedido do gerente-projetos depois das correções. Li `git diff origin/main...origin/<branch>` e o commit de correção de cada
> branch, e considerei os quatro juntos (o que um exporta e o outro usa). O Catálogo v2 (v8, branch 5) **não** foi reavaliado:
> recebe uma correção funcional e vem em seguida. A §2 acima continua valendo para ele.

| Branch | Head | Resultado |
|---|---|---|
| 1 `nuvem/catalogo-onda1-modulo-core-v2` | 155544cc | **Limpo** |
| 2 `nuvem/catalogo-onda1-modulo-catalogo-v3` | 6b1f4815 | **Com achado**: RD-0675 (resto) |
| 3 `nuvem/catalogo-onda1-designer-ux` | 87943b16 | **Com achado**: RD-0696 (novo) |
| 4 `nuvem/catalogo-onda1-engenheiro-apps` | 541522ce | **Limpo** |

### Fechados (7)
- **RD-0670** (modulo-catalogo): a constante provisória saiu de `carga-online.ts`. O `consultaIndisponivel` (`:21`) e a tela usam
  o `TEXTO_CATALOGO_CARREGANDO` do kit. A aba monta `<CatalogoCarregando />` (`telas/catalogo.tsx:221`), e o `Banner` não mostra
  mais esse texto (`:222-223`). A ficha usa `<CatalogoCarregando comTitulo />` (`telas/produto.tsx:75`). Um texto, uma constante.
- **RD-0671** (designer-ux): `desenhoCatalogoCarregando` (`packages/ui/src/mobile/carga-fundo.ts`) devolve só o texto por padrão.
  O `wifiOff` e o título ficam com `comTitulo`. O print `simulacoes/2026-11-15-catalogo-carregando-3.png` mostra, na aba, o selo
  "Sem sinal", "Busque quando tiver sinal." e o indicador "Catálogo 63% · parado", sem o segundo `wifiOff` nem o título. O §2 da
  spec diz onde vai cada forma.
- **RD-0672** (modulo-core): `entradaLiberada` saiu. O Core exporta `etapaQueLibera(perfil)` (`domain/entrada-sync.ts:189`), e
  `essencialDaEntrada` usa essa função. Os dois estão em `app/index.ts:29`.
- **RD-0673** (engenheiro-apps): `ETAPAS_DA_LIBERACAO` saiu. `indicadorDaCargaFundo` usa o `etapaQueLibera` do Core
  (`apps/mobile/src/lib/carga-fundo.ts:11,67`).
- **RD-0674** (engenheiro-apps): o memo ficou em um só auxiliar, `porPerfilEModulos(fabrica, …)` (`lib/ordem-da-carga.ts:15-28`).
  `ordemDaCargaDoUsuario` e `essenciaisDoUsuario` chamam esse auxiliar.
- **RD-0676** (modulo-catalogo · modulo-core): o Core exporta `ENTIDADES_CORE_CATALOGO_PRECOS` em
  `modules/core/contracts/entrada-sync.ts:61` e monta o `ENTIDADE_CAMPO` a partir dela (`domain/entrada-sync.ts:45`). O Catálogo
  usa a mesma lista em `CHAVES_DO_CATALOGO` (`carga-online.ts:16`).
- **RD-0677** (engenheiro-apps): a regra dos essenciais é testada só no Core (`entrada-sync.test.ts`, "essenciais do Campo" e
  "da Gestão"). `ordem-da-carga.test.ts` testa só o repasse do perfil e dos módulos, e `motor-do-usuario.test.ts` usa um dublê
  (`sim.essenciais`) e confere só a ligação.

### Em aberto (seguram a Meta)

| RD | Branch | Onde | Gravidade | Dono | Correção |
|---|---|---|---|---|---|
| RD-0675 (reaberto, resto) | 2 | `modules/catalogo/app/telas/catalogo.tsx:65,139-140`; `telas/produto.tsx:38,47-55,61` | baixa | modulo-catalogo | A parte (c) está fechada: um auxiliar, `consultaIndisponivel` (`carga-online.ts:21`). Seguem abertas: **(a)** as duas telas ainda calculam o modo por conta própria, com `catalogoPendente(...)` mais `ambiente.online()`, fora de `usarApiNaCarga`. O cast `(sync as { pendentes?: readonly string[] }).pendentes` aparece 3 vezes (`catalogo.tsx:65`, `produto.tsx:38` e `:61`). **(b)** Na ficha, a chamada agora está em uma função só (`daApi`). Mas, na carga, com sinal e com a 1ª chamada falhando, sem a ficha no aparelho, o mesmo `GET produtos/:id` sai de novo (`:47-48` e depois `:55`). **Depois:** `carga-online.ts` exporta `modoDaCarga(sync, online): 'local' \| 'api' \| 'sem_sinal'`, que lê `pendentes` uma vez e reaproveita `usarApiNaCarga`. As telas usam o `modo`. Na ficha: `if (modo === 'api' && id) { const r = await daApi(); if (r) return r; }` … `if (modo === 'sem_sinal') return { fase: 'catalogo_carregando' }; if (modo === 'api' \|\| !ambiente.online() \|\| !id) return { fase: 'nao_encontrado' }; return (await daApi()) ?? { fase: 'nao_encontrado' };` |
| **RD-0696** (novo) | 3 × 4 | `packages/ui/src/mobile/carga-fundo.ts:45-49` × `apps/mobile/src/lib/carga.ts:41-49` | baixa | designer-ux | Achado ao olhar os quatro juntos. Ele já estava no head anterior e passou no 1º parecer, e não veio das correções. A regra "carregando, no máximo 99" está escrita duas vezes e com o mesmo nome exportado. No shell, `percentualDaCarga(estado, situacao)` já entrega 0..99 ao indicador (`lib/carga-fundo.ts:71`). No kit, `percentualDaCarga(percentual)` corta 0..99 de novo e é exportada por `@macuxi/ui/mobile` e `/puro`. O app passa a ter duas `percentualDaCarga` com assinaturas diferentes. **Depois:** a do kit deixa de ser exportada e vira um auxiliar interno de `desenhoCargaFundo`, com outro nome (ex.: `barraDoIndicador`). O teste passa a conferir o corte por `desenhoCargaFundo({ percentual: 100 }).percentual === 99`. Assim, o app tem uma `percentualDaCarga` só |

### Conferido sem achado
- O Core exporta `etapaQueLibera`, `essencialDaEntrada` e `ENTIDADES_CORE_CATALOGO_PRECOS`, e os três são usados pelo shell e
  pelo Catálogo. Nenhum fica sem uso.
- A etapa "Catálogo e preços" e a etapa "Aprovações" foram para o fim da lista. Os testes mudaram só os números esperados. Nenhum
  caso novo repete outro.
- `tela-carga.tsx` (`liberada`) e `entradaLiberadaPeloMotor` (`_layout.tsx`) não são a mesma regra. A tela de carga ignora
  `liberado_em` no detalhe (`?detalhe=1`) e tem a regra própria da carga completa (`pronta`).
- Na aba Catálogo sem sinal, o selo "Sem sinal" e o "· parado" do indicador são redundância útil (indicador de offline e de
  fila). Não há outro texto que repita os dois.

**Veredito do re-parecer da onda 1: NÃO LIBERADO.** Seguem abertos 2 achados baixos, RD-0675 (resto) e RD-0696, ambos em
código de produção, fora da exceção R-20261111-190159. Os branches 1 e 4 estão limpos. Caixa e recados: HTTP 403, e o gerente
repassa esta tabela aos donos.

## Parecer final onda 1 (2026-11-15, ~16h30 Manaus)

> Pedido do gerente-projetos depois das correções do re-parecer. Li só o que mudou (`git diff <head anterior>..<head novo>`) e
> conferi se as correções criaram algo novo, olhando os quatro juntos. Branches 1 e 4 sem mudança desde o re-parecer.

| Branch | Head | Resultado |
|---|---|---|
| 1 `nuvem/catalogo-onda1-modulo-core-v2` | 155544cc (igual) | **Limpo** |
| 2 `nuvem/catalogo-onda1-modulo-catalogo-v3` | 6b1f4815 → **346fabe3** | **Com achado**: RD-0675 fechado; novo RD-0697 |
| 3 `nuvem/catalogo-onda1-designer-ux` | 87943b16 → **674f8630** | **Limpo** (RD-0696 fechado) |
| 4 `nuvem/catalogo-onda1-engenheiro-apps` | 541522ce (igual) | **Limpo** |

### Fechados (2)
- **RD-0696** (designer-ux): a função do kit virou `inteiroDaLinha`, sem export, usada só por `desenhoCargaFundo`
  (`packages/ui/src/mobile/carga-fundo.ts:46,66`). O teste confere o corte pelo `desenhoCargaFundo(...).percentual`. Em
  `packages`, `apps` e `modules`, `percentualDaCarga` agora existe só no shell (`apps/mobile/src/lib/carga.ts`).
- **RD-0675** (modulo-catalogo): **(a)** as duas telas usam `modoDaCarga(sync, ambiente.online())` (`telas/catalogo.tsx:65`,
  `telas/produto.tsx:31`). O cast de `pendentes` ficou num lugar só (`carga-online.ts:49`). **(b)** Na ficha, no modo `api`, a
  1ª chamada que falha sem ficha no aparelho termina em `nao_encontrado` (`produto.tsx:55`), e o `GET produtos/:id` não sai de
  novo. O `useEffect` depende de `modo`, e não mais do cast.

### Em aberto (segura a Meta)

| RD | Branch | Onde | Gravidade | Dono | Correção |
|---|---|---|---|---|---|
| **RD-0697** (novo, nasceu da correção do RD-0675) | 2 | `modules/catalogo/app/lib/carga-online.ts:42-45` × `:48-52`; `carga-online.test.ts:79-88` | baixa | modulo-catalogo | A regra "catálogo pendente → com sinal `api`, sem sinal `sem_sinal`, senão `local`" está escrita 2 vezes no mesmo arquivo, em `usarApiNaCarga` e em `modoDaCarga`, e o tipo `'local' \| 'api' \| 'sem_sinal'` também. A proposta do re-parecer pedia que `modoDaCarga` reaproveitasse `usarApiNaCarga`. O teste novo repete os 3 casos que o de `usarApiNaCarga` já cobre. **Depois:** `export type ModoDaCarga = 'local' \| 'api' \| 'sem_sinal';` e a regra só em `modoDaCarga`; `usarApiNaCarga(p) { return p ? modoDaCarga({ pendentes: p.pendentes() }, p.online()) : 'local'; }` (ou o inverso: a regra só numa das duas, a outra só repassa). O teste fica com os 3 modos em um bloco só, e o outro confere só o repasse (porta `null` = `local`) |

### Conferido sem achado
- `catalogo.tsx:65`: `naCarga = modoDaCarga(...) !== 'local'` dá o mesmo valor que o `catalogoPendente` de antes (pendente em
  `api` ou `sem_sinal`). O `ambiente.online()` das linhas 140 e 149 escolhe o caminho dentro da carga e fora dela, e não repete
  o modo.
- `produto.tsx:53-55`: `!ambiente.online() || !id` e `modo === 'api'` são saídas diferentes (fora da carga sem sinal × na carga
  com a API falhando). Não há texto de tela novo nem mudança de layout nas duas correções.
- `catalogoPendente` segue exportada e usada por `usarApiNaCarga` e `modoDaCarga`, além do teste. Sai do export se o RD-0697
  deixar a regra numa função só (opcional, entra na mesma correção).

**Veredito do parecer final da onda 1: NÃO LIBERADO.** Branches 1, 3 e 4 limpos. O branch 2 segura por 1 achado baixo, o
RD-0697, em código de produção, fora da exceção R-20261111-190159. Caixa e recados: HTTP 403, e o gerente repassa esta tabela
ao modulo-catalogo.

### Reteste do RD-0697 (2026-11-15, Manaus) · branch 2 em 346fabe3 → **7fe32349**

Li só `git diff 346fabe3e..7fe323497` (1 commit, 2 arquivos: `carga-online.ts` e `carga-online.test.ts`).

- **RD-0697 fechado.** A regra "catálogo pendente → com sinal `api`, sem sinal `sem_sinal`, senão `local`" ficou só em
  `modoDaCarga` (`modules/catalogo/app/lib/carga-online.ts:42-46`). `usarApiNaCarga` (`:49-51`) só repassa:
  `p ? modoDaCarga({ pendentes: p.pendentes() }, p.online()) : 'local'`. O comentário do modo também ficou num lugar só.
- **Teste:** os 3 modos ficam só no bloco "modo da carga a partir do estado do sync" (`carga-online.test.ts:77-86`). O de
  `usarApiNaCarga` (`:30-33`) confere só o repasse (porta com pendência e sinal = `api`) e a porta `null` = `local`.
- **Conferido sem achado:** o tipo `'local' | 'api' | 'sem_sinal'` segue escrito nas 2 assinaturas, a 7 linhas uma da outra.
  Não segura: `usarApiNaCarga` devolve o valor de `modoDaCarga`, e o typecheck quebra se as duas divergirem para o lado
  perigoso (valor novo no modo). O `export type ModoDaCarga` fica como melhoria opcional. `catalogoPendente` segue exportada,
  agora usada só por `modoDaCarga` e pelo próprio teste dela, que é seu, sem repetir outro teste (opcional tirar o export).
- **Nada novo:** os chamadores não mudaram (`consultas-online.ts:11` com `usarApiNaCarga`; `telas/catalogo.tsx:65` e
  `telas/produto.tsx:31` com `modoDaCarga`). Não há texto de tela, layout nem regra nova.

| Branch | Head | Resultado |
|---|---|---|
| 1 `nuvem/catalogo-onda1-modulo-core-v2` | 155544cc | **Limpo** |
| 2 `nuvem/catalogo-onda1-modulo-catalogo-v3` | **7fe32349** | **Limpo** (RD-0697 fechado) |
| 3 `nuvem/catalogo-onda1-designer-ux` | 674f8630 | **Limpo** |
| 4 `nuvem/catalogo-onda1-engenheiro-apps` | 541522ce | **Limpo** |

**Veredito do parecer final da onda 1 (depois do reteste): ONDA 1 LIBERADA.** Nenhum achado em aberto, de qualquer gravidade,
nos 4 branches da onda 1 nos heads acima. Vale para esses heads: commit novo em qualquer um deles volta ao corretor.

## Re-parecer v8 (2026-11-15, 12h05 Manaus) · branch 5 em d2d4660f → **e390219f**

Pedido do gerente-projetos (Meta v1.0.13). Li `git diff d2d4660fd..e390219fd` (3 commits do dono: c9bfdff0 correções
RD-0685 a RD-0695; fe2d0402 estoque nulo sem filial de venda; e390219f ajustes de marca MC-0130 a MC-0133) e
`git diff origin/main...e390219fd`. Li a árvore só pelo worktree, sem checkout no diretório principal. O branch
`nuvem/catalogo-campo-testes` ficou de fora, como pedido. Caixa e recados: HTTP 403. O gerente repassa a tabela ao
modulo-catalogo.

### Fechados (8)
- **RD-0685 fechado.** `catalogo.tsx:184`: o chip só aparece com `nomesProprias.length > 1`. `rotuloChipFiliais` perdeu o ramo
  "Filial X" de nome único (`estoque-campo.ts:101-104`), e o selo do Filtrar deixa de contar um filtro que não existe. Com uma
  filial de venda, ela aparece só na faixa.
- **RD-0686 fechado.** `estoque-folha.ts:26` ficou só com `${codigo} · ${hora}`. O teste "velho" confere que a idade não se repete.
- **RD-0687 fechado.** A `filiaisDoEstoque` antiga e o `EntradaFiliaisDoEstoque` saíram de `domain/estoque.ts`. O repositório
  expõe `filialDoCliente(clienteId)` (`repositorio.ts`, `repositorio-postgres.ts`). O `regras.md` aponta só para `estoque-campo.ts`.
- **RD-0688 fechado.** Fica um leitor só, `lerFiliaisDoUsuario` (`estoque-campo.ts`, validado pelo `FilialDoUsuarioSchema`), e um
  tipo só, `FiliaisDoUsuario`. Os dois adaptadores (`api/filiais-core.ts` e `app/lib/filiais-usuario.ts`) saíram com os testes
  deles. Cada lado decide só o próprio fallback.
- **RD-0689 fechado.** `rotuloAtualizacaoEstoque` saiu com o teste dela. `estoque.ts:4`, `contracts/busca.ts:103` e `regras.md`
  citam `rotuloCargaEstoque`.
- **RD-0690 fechado.** Saíram `podeVerEstoque` (com os 4 ramos), `filialNaCarteira` (com o caso dela) e `UsuarioFiliais.perfil`.
- **RD-0693 fechado.** `visibilidade.ts:1-5`, `vitrine.ts:59` e `contracts/rotas.ts:26` só remetem a `estoque-campo.ts`.
- **RD-0695 fechado.** O caso "alternativa em simulação" saiu de `estoque-campo.test.ts`.

### Abertos ou reabertos (seguram a Meta)

| RD | Onde (e390219f) | Gravidade | Dono | O que falta |
|---|---|---|---|---|
| RD-0691 (resto) | `modules/catalogo/app/lib/estoque-folha.ts:11` e `:25`; `telas/estoque-filial.tsx:29`; `estoque-folha.test.ts:27` | baixa | modulo-catalogo | Fechadas 3 partes: `codigosDoCartao` com um campo (`codigo`), um efeito só para a linha `usuario` e a prop `filialMarcada` fora. O texto agora usa a constante nos 3 lugares. **Falta** o campo `DadosDaFolha.titulo`, que é sempre `TITULO_FOLHA_ESTOQUE`, e a tela ainda faz `dados?.titulo ?? TITULO_FOLHA_ESTOQUE`. **Depois:** sai `titulo` da interface e do retorno de `dadosDaFolha`, a folha usa `titulo={TITULO_FOLHA_ESTOQUE}` e o teste confere a constante |
| RD-0692 (resto) | `modules/catalogo/app/lib/grade.test.ts:43-48` × `domain/estoque-campo.test.ts:61-80` | baixa | modulo-catalogo | Saíram os casos repetidos de `estoque-folha.test.ts` e 3 dos 4 de `grade.test.ts`. **Falta** o caso "verde acima de 0 e vermelho em 0 ou menos": as 4 asserções (84, 6, 0, −2) repetem `corDoEstoque` e `textoEstoqueCartao` do domain. Segura porque está no corpo do teste. **Depois:** um caso só, para o que `tagDeEstoque` acrescenta (juntar texto e tom): `expect(tagDeEstoque(disp('sem_estoque', -2))).toEqual({ texto: 'Estoque: −2', tom: 'erro' })` |
| RD-0694 (resto) | `docs/modulos/catalogo/regras.md:92` | baixa | modulo-catalogo | Fecharam 4 dos 5 lugares (`:19` fonte, `:120`, `:127` e `:197` só remetem). O §5 ainda repete o pedaço "sem filial" da RN-CAT-05 com outro texto: "Usuário **sem filial** vê `sem_estoque` (conservador)". Desde o fe2d0402 a frase também contradiz o código (sem filial de venda, `availability` nula, sem tag nem folha). **Depois:** a frase sai. A RN-CAT-05 (`:19`) já diz "usuário sem filial fica sem preço e sem estoque" |
| **RD-0698** (novo, nasceu da correção do RD-0686) | `modules/catalogo/domain/estoque.ts:11`; `domain/estoque.test.ts:3,124`; `regras.md:95` | baixa | modulo-catalogo | `AVISO_ESTOQUE_DESATUALIZADO` ("Estoque desatualizado") ficou sem uso em produção: o único chamador era a linha da folha. Sobram o export, o teste que confere o próprio valor e o §5 do `regras.md`, que o cita como texto de tela. **Depois:** saem a constante, o caso do teste e a menção "`AVISO_ESTOQUE_DESATUALIZADO`" no §5. Se o testes decidir que o `stale` volta a aparecer (item 2 abaixo), a constante fica e passa a ter esse uso, num lugar só |
| **RD-0699** (novo) | `modules/catalogo/app/lib/copiar-codigo.test.ts:50` | baixa | modulo-catalogo | O comentário "o toast é só do ícone da lista; a ficha confirma pelo rótulo" descreve a ficha antiga. Desde o e390219f, a ficha usa o mesmo ícone, com toast. A fonte é o comentário de `comum.tsx:25-28`. **Não segura** (só comentário de teste, exceção R-20261111-190159): vai no lote seguinte, e o comentário sai ou só remete a `BotaoCopiarCodigo` |

### Encaminhado ao testes (sem RD; recado não enviado por causa do 403)
1. **`regras.md:92` × fe2d0402:** o doc diz "sem filial vê `sem_estoque`", e o código devolve `availability` nula. A correção do
   RD-0694 tira a frase. O testes confere que o comportamento novo é o da RN-CAT-05.
2. **RN-CAT-07, "desatualizado depois de [24 h]":** depois do RD-0686, nenhuma tela do Campo usa `stale` (nem
   `estoque_defasado_horas`). A idade aparece só pela hora da carga ("ontem às", "em 12/11 às"). O testes precisa conferir se
   a RN ainda pede um sinal próprio de dado defasado (e, nesse caso, em Alertas) ou se o doc 03 muda.
3. Item 1 do §3 anterior ("saldo negativo do ERP conta 0"): **resolvido** no c9bfdff0. O §5 agora diz "mantém o sinal".

### Conferido sem achado
- **fe2d0402:** a regra "sem filial de venda = estoque nulo" está num lugar só (`vitrine.ts:87-88`, pela `filiaisFolha` vazia).
  `local.ts` só entrega o contexto vazio. `local.test.ts` confere o invólucro (sem usuário e `sem_filial`), e `vitrine.test.ts`
  confere a regra. Os testes não se repetem.
- **e390219f, ficha:** a caixa "Copiar código" saiu do corpo. O código aparece uma vez no subtítulo da faixa, com o ícone de
  copiar ao lado (`produto.tsx:93`). A variante `ficha` e o `Button` saíram de `BotaoCopiarCodigo`. Ficou um aviso por cópia:
  ✓ por 2 s e o toast, ou o anúncio do leitor de tela sem toast. A divisória entre o preço e o estoque é só borda, sem texto.
- **e390219f, Filtrar:** a folha tem "Limpar" e "Ver N produtos" (o antigo rodapé virou botão principal). Não há texto novo.
  O ✕ do título e o "Ver N produtos" fecham a folha, como no padrão `Folha` já aceito, e o "Ver N" traz a contagem que decide.
  A divisória entre as opções é só borda.
- **e390219f, cartão:** a foto tem 96, o nome vai até 3 linhas e o código tem 13/700. É só estilo, e o teste de fonte foi
  atualizado (`catalogo-hierarquia.test.ts:34-36`).
- **`git diff origin/main...e390219f`:** fora de `modules/catalogo` e do `regras.md`, o que entra veio do merge do `main`
  (#336, #339, #340), que tem os próprios pareceres.

| Branch | Head | Resultado |
|---|---|---|
| 5 `nuvem/catalogo-campo-modulo-catalogo-v8` | **e390219f** | **COM ACHADO**: RD-0691, RD-0692 e RD-0694 (restos) e RD-0698 seguram; RD-0699 não segura |

**Veredito do re-parecer v8: NÃO LIBERADO.** Fecharam 8 dos 11 (RD-0685 a 0690, 0693 e 0695). Seguram 4 achados baixos em código de
produção, corpo de teste e doc, fora da exceção R-20261111-190159. São correções de poucas linhas, todas do modulo-catalogo. O
reteste vale para o próximo head do v8.
