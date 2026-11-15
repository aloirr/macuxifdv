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
| 5 | `nuvem/catalogo-campo-modulo-catalogo-v8` | d2d4660f | modulo-catalogo | **COM ACHADO**: RD-0685 a RD-0693 abertos, mais os novos RD-0694 e RD-0695 |

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
