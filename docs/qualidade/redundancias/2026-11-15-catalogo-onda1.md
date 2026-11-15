# Catálogo onda 1: trabalhar enquanto o catálogo carrega (ADR 0054, solução 5)

> 2026-11-15, à tarde (Manaus) · corretor-redundancias · parecer de leitura pedido pela sessão de revisão do gerente-projetos.
> Base: `origin/main` 5d744724. Só os heads abaixo contam (as versões `-modulo-core`, `-modulo-catalogo` e `-v2` foram substituídas):
>
> | Branch | Head | Dono |
> |---|---|---|
> | `nuvem/catalogo-onda1-modulo-core-v2` | b207cb1c | modulo-core |
> | `nuvem/catalogo-onda1-modulo-catalogo-v3` | 88122be7 | modulo-catalogo |
> | `nuvem/catalogo-onda1-designer-ux` | b63e1e3b | designer-ux |
> | `nuvem/catalogo-onda1-engenheiro-apps` | e4636797 | engenheiro-apps |
>
> Caixa: `node scripts/coord.mjs caixa corretor-redundancias` respondeu **HTTP 403** (sessão sem acesso ao repositório de recados).
> Por isso os recados aos donos **não foram enviados**: cabe ao gerente repassar esta tabela. Não havia parecer anterior meu
> sobre o tema, então nada foi repetido nem reaberto.
> Leitura do código e dos docs, sem print do aparelho: o parecer sobre o print fica para o reteste.

## 1. Resultado
**COM ACHADO: 8 RD (RD-0670 a RD-0677), 4 médios e 4 baixos.** Todos seguram o lote. Nenhum está só em comentário ou em título de teste.

## 2. Achados

| RD | Gravidade | Dono | Onde | O que se repete | Proposta (antes → depois) |
|---|---|---|---|---|---|
| RD-0670 | média | modulo-catalogo | `modules/catalogo/app/lib/carga-online.ts:21`; `telas/catalogo.tsx` (vazio pelo `lista.aviso`), `telas/produto.tsx` (`<Empty text=…>`) | O mesmo estado tem dois textos e duas constantes com o mesmo nome. No Catálogo: "O catálogo ainda está carregando. Conecte-se à internet para buscar." No kit (`packages/ui/src/mobile/carga-fundo.ts:23-24`): "Catálogo ainda carregando" / "Busque quando tiver sinal." O "provisório (designer-ux fecha)" já foi fechado no kit, e a frase do Catálogo ainda explica a causa ("Conecte-se à internet") | Apagar a constante do Catálogo. As consultas usam `TEXTO_CATALOGO_CARREGANDO` de `@macuxi/ui/mobile/puro`, e as duas telas usam `<CatalogoCarregando />` do kit |
| RD-0671 | média | designer-ux | `docs/design/carga-em-segundo-plano.md` §1 (tabela de estados) e §2; `packages/ui/src/mobile/carga-fundo-rn.tsx` (`CatalogoCarregando`) | Na aba Catálogo, sem sinal, a mesma informação aparece 3 vezes: o indicador "Catálogo 63% · parado" com `wifiOff`, o vazio com `wifiOff` e o título "Catálogo ainda carregando", e o selo "Sem sinal" do cabeçalho. Isso quebra a regra "uma informação, um lugar" | Na aba (o indicador está visível), o vazio fica só com a ação: "Busque quando tiver sinal.", sem título e sem o segundo `wifiOff`. O título "Catálogo ainda carregando" fica só na ficha e no Novo pedido, telas empilhadas que não mostram o indicador. Sugestão: prop `comTitulo` (padrão `false`) no `CatalogoCarregando`, e a spec §2 atualizada |
| RD-0672 | média | modulo-core | `modules/core/domain/entrada-sync.ts:194` (`entradaLiberada`), exportada em `modules/core/app/index.ts:29` | A regra "a entrada libera quando Clientes e rota / Equipe terminam" está escrita 2 vezes: `entradaLiberada` (pelas etapas `feita`) e `essencialDaEntrada` (pelos itens do motor → `liberado_em`). Só a segunda é usada (o shell lê `liberado_em`), e `entradaLiberada` não tem uso fora do próprio teste | Tirar `entradaLiberada`, o export e os 4 casos dela no teste. No lugar, exportar `etapaQueLibera(perfil)` (ou o conjunto `ETAPAS_DA_LIBERACAO`), que é o que o shell precisa (RD-0673) |
| RD-0673 | média | engenheiro-apps · modulo-core | `apps/mobile/src/lib/carga-fundo.ts:38` | `ETAPAS_DA_LIBERACAO = ['envio', 'clientes_rota', 'equipe']` copia no shell a regra do Core (`ETAPA_LIBERA_CAMPO/GESTAO`, `entrada-sync.ts:187-188`). Se o Core mudar a etapa que libera, o indicador passa a errar o nome | Importar do Core o que o RD-0672 exporta e apagar a cópia |
| RD-0674 | baixa | engenheiro-apps | `apps/mobile/src/lib/ordem-da-carga.ts:31-43` × `:12-24` | `essenciaisDoUsuario` repete, linha a linha, o memo por `perfil\|módulos` de `ordemDaCargaDoUsuario` (ler, montar a chave `de`, refazer, aplicar `{ entidade: item.chave, modulo: item.modulo }`) | Um auxiliar `porPerfilEModulos(fabrica)` que as duas chamam: `ordemDaCargaDoUsuario = porPerfilEModulos(chaveDeOrdemDaCarga)` e `essenciaisDoUsuario = porPerfilEModulos(essencialDaEntrada)` |
| RD-0675 | baixa | modulo-catalogo | `telas/catalogo.tsx:65,140`; `telas/produto.tsx:38,41,52,62`; `lib/carga-online.ts:42,87`; `lib/consultas-online.ts:14,18` | (a) As telas recalculam o modo da carga (`catalogoPendente(...)` + `ambiente.online()`) fora de `usarApiNaCarga`, com o cast `(sync as { pendentes?: readonly string[] })` 3 vezes. (b) A ficha faz a mesma chamada `ambiente.http.get(caminhoCatalogo('produto', { id }), { customer_id })` 2 vezes no mesmo `carregar`. (c) `new ConsultaIndisponivel(…, 'catalogo', TEXTO_CATALOGO_CARREGANDO)` aparece 3 vezes, com o auxiliar `indisponivel` definido ao lado | (a) Uma função `modoDaCarga(pendentes, online)` para a porta e as telas, e o cast lido uma vez só (ou tirado quando o SDK tipar `pendentes`). (b) Uma só chamada online na ficha (com sinal: API; se falhar: aparelho). (c) Usar `indisponivel(consulta)` nos 3 lugares, com o auxiliar movido para `carga-online.ts` |
| RD-0676 | baixa | modulo-catalogo · modulo-core | `modules/catalogo/app/lib/carga-online.ts:12-18` × `modules/core/domain/entrada-sync.ts:44-46` | `CHAVES_DO_CATALOGO` relista `produto`, `produto_unidade` e `medida`, que o Core já põe na etapa `catalogo_precos`. Uma entidade nova do Core na vitrine precisaria entrar nos dois lugares | O Core exporta, em `contracts`, as entidades do Core que pertencem à etapa `catalogo_precos` (ou um predicado `ehDaEtapaCatalogo`), e o Catálogo usa esse export |
| RD-0677 | baixa | engenheiro-apps | `apps/mobile/src/services/motor-do-usuario.test.ts:68-80`, `apps/mobile/src/lib/ordem-da-carga.test.ts:185-207` × `modules/core/domain/entrada-sync.test.ts:186-203` | Os mesmos casos de "essenciais" (cliente → sim, pedido → não, produto → não; Gestão: Equipe → sim) estão testados 3 vezes | Deixar a regra só no teste do Core. `ordem-da-carga.test` fica com o memo e a troca de perfil (1 caso). `motor-do-usuario.test` fica com uma única asserção: `opcoes.essenciais` foi passado e é o do shell |

## 3. Encaminhado ao testes (defeito funcional, sem RD)
- `IndicadorCargaFundo`: pela spec, `percentual` é o percentual da **etapa** ("Catálogo 63%", `docs/design/carga-em-segundo-plano.md`
  §1, prop `percentual`). O shell passa o percentual da **carga inteira** (`percentualDaCarga(estado, 'carregando')` em
  `apps/mobile/src/lib/carga-fundo.ts`, `indicadorDaCargaFundo`), e o teste confirma "o mesmo da tela de carga". Assim, o rótulo "Catálogo"
  pode vir com o número do total. É rótulo × valor, então fica com o testes. O recado não foi enviado (403).

## 4. Conferido sem achado
- Indicador: não é aviso (fora de Alertas, sem cor de alerta), não explica o que o sistema faz por trás, e "parado" não repete
  "Sem sinal". O rótulo acessível com a causa é redundância útil (`manter`).
- Tela de carga: o detalhe (`?detalhe=1`) reaproveita a mesma tela, sem um componente novo.
- Retomada (`deveRetomarCarga` + motivo `carga-fundo`): reaproveita `sincronizarSeNecessario` e `deveSincronizar`, sem um timer novo.
- Porta `definirCargaOnline`: uma só por app. A tarefa em segundo plano não troca a porta (`cargaOnline: false`).
- Exports novos do kit (`carga-fundo` em `index.ts` e `puro.ts`) seguem o padrão dos outros componentes.
