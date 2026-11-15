# T-0174 · Fotos em lote por ZIP · 2ª revisão do corretor-redundancias

> 2026-11-15, ~09h40 (Manaus) · corretor-redundancias · sessão de revisão do gerente-projetos.
> Tarefa: `.coord/tarefas/T-0174.md` em `nuvem/T-0174-gerente-projetos` (46128555). Regras: RN-CAT-14, ADR 0054.

## Veredito

**NÃO LIBERADO.** A tarefa (`T-0174.md:75`) diz "Corretor liberado", mas isso vale só para o 1º parecer
(`nuvem/T-0174-corretor-redundancias` 4a9523d, RD-0615..0622, RD-0635, RD-0636, todos corrigidos e conferidos de novo
aqui). O 2º parecer, de 08h45 (`nuvem/fotos-lote-corretor-redundancias` 0908a2c, RD-0620..0634), nunca foi conferido de
novo. **13 dos seus 15 achados seguem abertos nos heads de hoje** (RD-0623..0634, 3 médios, e a sobra do RD-0622, renumerada
para RD-0650). Há também 4 achados novos (RD-0651..0654, 1 médio).
Todos estão em código de produção, spec, doc ou corpo de teste. Nenhum está só em comentário ou título de teste, então
todos seguram o lote (R-20261110-062506).

Não houve defeito funcional novo. A seção 6 traz uma observação para o testes.

Caixa: `node scripts/coord.mjs caixa corretor-redundancias` deu **HTTP 403** (repositório de recados fora da sessão).
Nenhum recado foi gravado; o gerente repassa a seção 5. Ainda não há print do BKO: avaliei pela spec e pelo código.

| Branch | Head lido | Como |
|---|---|---|
| `nuvem/T-0174-banco-dados` | 4b1ea50e | `git diff origin/main...` |
| `nuvem/T-0174-modulo-core` | 06ae4b72 | idem |
| `nuvem/T-0174-engenheiro-software` | 75c7af3a | idem + `jscpd` |
| `nuvem/T-0174-designer-ux` | 24eb01ba | idem (spec inteira) |
| `nuvem/T-0174-modulo-catalogo` | d66ebfff | idem + `jscpd` (sem clone em código de produção) + `grep` dos exports novos |
| `nuvem/T-0174-testes` | ae5aa0d8 | idem (títulos e corpo × testes de unidade) |

## 1. Numeração em conflito entre os dois pareceres (catálogo, meu)

Os dois branches de parecer acrescentam ao `catalogo.md` os números **RD-0620, RD-0621 e RD-0622 com conteúdos
diferentes**. Se os dois entrarem, o catálogo fica com 2 linhas para cada número. Esta revisão resolve assim:

| Nº no 0908a2c | Destino |
|---|---|
| RD-0620 (fase no selo e no andamento, spec) | **corrigido**: é o mesmo fato do RD-0615, que fechou. Sem linha própria |
| RD-0621 (coluna `⋯` com `Baixar CSV`) | **fechado sem mudança** (`manter`). O 1º parecer (§4) já tinha decidido que fica: são telas diferentes, e a ação na lista evita abrir o lote. A coluna fica, a spec não muda |
| RD-0622 (rótulos que não aparecem) | **renumerado para RD-0650** (sobra parcial, abaixo) |
| RD-0623 a RD-0634 | ficam com o número (sem conflito). Situação de cada um na seção 2 |

**Pedido ao gerente-projetos:** no merge, do branch 0908a2c entra só o relatório
(`2026-11-15-T-0174-fotos-em-lote.md`). As linhas dele no `catalogo.md` e no diário não entram: este branch já traz as
linhas de RD-0623..0634 com a situação atualizada.

## 2. Reteste dos achados do 2º parecer (0908a2c)

| RD | Situação | Evidência nos heads de hoje |
|---|---|---|
| RD-0623 | **aberto** | (a) Página de envio: ZIP grande dá `O ZIP passa de 500 MB. …` (`fotos-lote-page.tsx:163-165`, `validarArquivoZip`) com a linha `… ZIP até 500 MB` logo abaixo (`:206-209`); a spec §6.1 `:239` manda o mesmo. (b) Spec §6.1 `:240` ainda lista o 409 `LOTE_EM_ANDAMENTO` como aviso, e a frase também está em §2.1 `:50-51`. A página já não mostra aviso (RD-0617), então a spec contradiz o código |
| RD-0624 | **aberto** | Spec §3.1 `:76-81` (estado → ações) repete a coluna "Cabeçalho" da §4 `:162-172` |
| RD-0625 | **reaberto** (parcial) | Já saíram o literal 500 MiB e a 2ª frase (RD-0619). Sobram `PARTES_ENVIO_MAX = 63` calculado à mão (`packages/platform-sdk/src/arquivos.ts:50`) e o 2º mapa `TETO_ENVIO_EM_PARTES` (`apps/api/src/arquivos.ts:224`), com a mesma forma de `TETO_POR_CATEGORIA` (`:212`) |
| RD-0626 | **aberto** | `imagens.ts:27` repete a assinatura do JPEG de `ehJpeg`. `arquivos.ts:38` `TIPOS_ARQUIVO` repete os 3 tipos de `imagens.ts:8` `TIPOS_IMAGEM` |
| RD-0627 | **aberto** | `BYTES_ASSINATURA_IMAGEM` (`imagens.ts:19`) e `apagarTemporario` (`leitor-zip.ts:229`) sem nenhum uso |
| RD-0628 | **aberto** | `semLog` em `trabalhos.ts:136`: agora há 5 cópias (`agendador.ts:55`, `despachante.ts:95`, `email/despachante.ts:80`, `diagnosticos-worker.ts:215`) |
| RD-0629 | **aberto** | O teto de megapixels é conferido em `leitor-zip.ts:182,213` e de novo em `decodificadores.ts:61` |
| RD-0630 | **reaberto** (parcial) | O título de `leitor-zip.test.ts:106` mudou ("a leitura devolve a recusa da classificação"), mas o corpo ainda tem os 3 casos de `zip.test.ts:25,40` |
| RD-0631 | **aberto** (média) | `docs/desenho/T-0174.md:230`: `Migração nova 0070_catalogo_foto_lote`. A migração é a **0080** (as 0070–0073 já estão no `main`, #334) |
| RD-0632 | **aberto** | As premissas estão em 3 lugares: ADR 0054 `:86-91`, desenho §7 `:397-400` e tarefa `:67`. O cabeçalho do desenho `:6-8` repete a R-20261115-074500 |
| RD-0633 | **aberto** (média) | Tarefa `:28`: "`PUT` do ZIP em fluxo (stream…)", que a ADR 0054 `:94` rejeita, contra `:68` ("Envio em partes de 8 MiB…, não um PUT único") |
| RD-0634 | **aberto** | `modules/core/api/consultas.ts:170`: `sku = any($1)` continua junto de `lower(sku) = any($2)`, que já o contém. O head é o mesmo (06ae4b7) |

As propostas (antes → depois) estão no relatório 0908a2c, §1 a §4, e continuam valendo. O RD-0625 vale só para a sobra
indicada acima, e o RD-0630 só para o corpo do teste.

## 3. Achados novos

| ID | Onde | Tipo | O que se repete | Impacto | Gravidade | Proposta (antes → depois) | Dono |
|---|---|---|---|---|---|---|---|
| RD-0650 | spec `fotos-em-lote.md:189` (§5.1) | doc | Renumeração da sobra do RD-0622 do 0908a2c. O rótulo `Já enviado` do lote `duplicado` diz "só para o CSV e a auditoria", mas o CSV é por item e não traz a situação do lote. A página troca para o lote existente antes de mostrar o selo (`fotos-lote-page.tsx:315,332`), e a lista tira o `duplicado` (`api/fotos-lote.ts:214`). O rótulo não aparece em lugar nenhum. (O `Na fila` do item `pendente` fica, porque o CSV da API não exige lote concluído) | manutenção: texto sem uso, justificativa falsa | baixa | Spec `:189`: `\| duplicado \| — \| — \|` com a nota "não aparece: a página abre o lote existente (3.6)". No código, `SELO_LOTE.duplicado` fica, porque o tipo `Record<FaseLote, Selo>` exige a chave e a página para antes de mostrá-lo (`:332`) | designer-ux |
| RD-0651 | `modules/catalogo/api/fotos-lote.ts:97,190,258,282` | código | `'Lote de fotos não encontrado. Volte à lista e abra o lote de novo.'` escrito 4 vezes. O `select … for update` de `:188` repete o `lerLote` (`:90-93`) | manutenção: mudar o texto exige 4 lugares | baixa | `const loteNaoEncontrado = () => new ErroNaoEncontrado('LOTE_NAO_ENCONTRADO', '…')`, usado nos 4 lugares. `lerLote(db, id, { travar: true })` acrescenta o `for update` | modulo-catalogo |
| RD-0652 | `api/fotos-lote.ts:101-104,156,175` (`envioDoLote`) · `contracts/fotos-lote.ts:102-106` (`EnvioLoteSchema`, `FotoLoteCriadoSchema`) × `fotos-lote-page.tsx:146,285,320` | código | O POST devolve `envio = { arquivo_id, parte_bytes, partes }`, mas o único cliente (BKO) descarta a resposta e calcula tudo de novo: o `arquivo_id` ele mesmo gerou, `partesDoEnvio(total)` 2 vezes e `PARTE_ENVIO_BYTES` do SDK. `EnvioLoteSchema` só é usado dentro do próprio contrato | manutenção: a mesma conta em 2 lados, e a resposta não tem leitor | baixa | Ou o BKO usa a resposta (`FotoLoteCriadoSchema.parse(...)`, com `envio.partes` no `concluir` e no "tentar de novo"), ou o POST devolve só o `FotoLote` e saem `envioDoLote`, `EnvioLoteSchema` e `FotoLoteCriadoSchema`. Fica um caminho só | modulo-catalogo |
| RD-0653 | `contracts/fotos-lote.ts:162` | código | `totais: z.object({ ligado, sem_produto, ambiguo, recusado, repetido })` copia o `TotaisLoteSchema` (`:82`) sem o `pendente` | manutenção: 2 listas dos totais | baixa | `totais: TotaisLoteSchema.omit({ pendente: true })` (mesma forma no `@1`, sem mudar o contrato do evento) | modulo-catalogo |
| RD-0654 | `.coord/tarefas/T-0174.md:75,82` | doc | A tarefa diz "Corretor liberado (RD-0615..0622, RD-0635, RD-0636 corrigidos)" e põe no merge só o parecer 4a9523d. O parecer 0908a2c (RD-0620..0634), com números que colidem com os do 1º, não aparece | confunde: o lote seguiria com achados abertos e com o catálogo com 2 linhas por número | média | `:75`: `Corretor: 1º parecer (4a9523d) liberado; 2º parecer (0908a2c) e 2ª revisão (nuvem/fotos-lote-2-corretor-redundancias) com RD abertos — ver 2026-11-15-T-0174-fotos-lote-revisao-2.md.` `:82`: acrescentar `nuvem/fotos-lote-2-corretor-redundancias` e, do 0908a2c, só o relatório (seção 1) | gerente-projetos |

## 4. Conferido e fica (sem RD)

- **1º parecer**: RD-0615..0619, RD-0621, RD-0622, RD-0635 e RD-0636 continuam corrigidos nos heads de hoje. Na página,
  não há quadro em fila nem em conferindo, e a barra aparece só com o número. Não há `Notice` em `falhou`. O 409 não abre
  aviso. Os tetos vêm de `LIMITES_ZIP_TETO`, e os 409 usam os textos do contrato.
- **`KpiCard` com `onClick`/`selecionado`** e **`Progresso` com `mostrarRotulo="valor"`**: não há outro cartão-filtro
  nem outra barra no kit web. Os `aria-pressed` do `main` são botões, não cartões.
- **`useLimites()` chamado 2 vezes na página do lote** (`:257`, `:415`): mesma `queryKey`, um pedido só.
- **Testes do testes × unidade**: ZS-05, ZS-06 e ZS-10 testam a fronteira exata, que a unidade não testa. ZS-13 junta a
  leitura do ZIP e o domain, e FL-API-01..12 passam pelo `createApp` real (status HTTP, cabeçalhos do CSV). Cada um
  acrescenta alguma coisa: ficam.
- **Banco** (0080, docs): sem índice, constraint ou doc repetidos. Igual ao parecer anterior.
- **`jscpd`** nos arquivos novos do Catálogo e do testes: os clones estão só em preparo de teste de banco, no padrão do
  módulo (`marcas.db.test.ts`). Ficam.

## 5. Pedidos por dono (cc gerente-projetos, T-0174) — sem recado gravado (403)

| Dono | Achados |
|---|---|
| engenheiro-software | RD-0625 (sobra), RD-0626, RD-0627, RD-0628, RD-0629, RD-0630 (corpo do teste), RD-0631 (média), RD-0632 (ADR e desenho) |
| designer-ux | RD-0623 (spec §6.1), RD-0624, RD-0650 |
| modulo-catalogo | RD-0623 (aviso do ZIP grande na página de envio: sem o número, `O ZIP passa do limite de tamanho. Divida as fotos em mais de um ZIP.`, porque a linha de limites já mostra o número), RD-0651, RD-0652, RD-0653 |
| modulo-core | RD-0634 |
| gerente-projetos | RD-0632 (tarefa `:67`), RD-0633 (média), RD-0654 (média) e a seção 1 (merge do 0908a2c só com o relatório) |

## 6. Para o testes (observação, sem RD)

`buscarItens` (`fotos-lote-page.tsx:98-104`) pede 100 itens sem filtro e tira os `pendente` no navegador. Durante o
processamento, a página pode vir com menos de 100 linhas, ou vazia, com `Mostrar mais` ligado. Vale conferir se a tabela
fica vazia com "Nenhuma foto com esse filtro." enquanto há itens resolvidos depois do 100º. Sem recado (403); o gerente
encaminha.
