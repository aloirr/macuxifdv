# ADR 0054 — Fotos dos produtos em lote por ZIP

- **Status**: proposta em 2026-11-15 (branch `nuvem/T-0174-engenheiro-software`).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: R-20261115-071800-alexandre (simulação aprovada) e R-20261115-073000-alexandre, item 6, e
  R-20261115-074500 (formatos, EAN no nome e galeria); RN-CAT-14; T-0174.
- **Desenho executável**: [`docs/desenho/T-0174.md`](../desenho/T-0174.md) (contratos, schema, divisão por dono e testes).

## Contexto
- O analista sobe um ZIP de até 500 MB com até 10 mil fotos de até 8 MB (RN-CAT-14). Hoje a foto entra uma a uma pela
  ficha: `PUT /v1/catalogo/produtos/:id/foto-principal` registra o arquivo e o aparelho/BKO manda os bytes em
  `PUT /v1/arquivos/:id` (corpo inteiro em memória, teto de 2 MB, ADR 0010). Isso não serve para 500 MB.
- A produção passa pelo túnel da Cloudflare (ADR 0020/0028), que recusa pedido acima de 100 MB, e o BKO fala com a API
  pelo `/api-proxy` do Next, que também limita o corpo. Um `PUT` único de 500 MB não chega à API.
- O despachante da outbox (ADR 0007) roda o consumidor dentro da transação do lote de eventos, com `statement_timeout`
  de 30 s; o agendador (ADR 0022) acorda a cada 15 min. Nenhum dos dois roda um processamento de minutos.
- `catalogo.produto_midia` já tem `ordem` e `principal` (migração 0013). O código do produto (`sku`) é do Core
  (`core.produto`, ADR 0005): o Catálogo só o lê por consulta (ADR 0012).

## Decisão
1. **Envio em fluxo, em partes.** O ZIP é um `plataforma.arquivo` do tipo `application/zip` (mesma linha, RLS, dono e
   licença das fotos). O BKO manda o arquivo em partes de **8 MiB** (`PUT /v1/arquivos/:id/partes/:n`), e a API grava
   cada parte como um objeto no armazenamento, sem nunca ter mais que uma parte em memória. `POST /v1/arquivos/:id/concluir`
   confere as partes (tamanho de cada uma e total) e marca o arquivo `recebido`. As partes passam no túnel, no `/api-proxy`
   e em qualquer S3 compatível sem multipart nem `UNSIGNED-PAYLOAD`.
   **Alternativa ligável:** URL assinada de `PUT` por parte direto no S3 (`GET /v1/arquivos/:id/partes/:n/url-envio`,
   15 min, só com `MACUXI_ARQUIVOS_DRIVER=s3` e `MACUXI_ENVIO_URL_ASSINADA=1`, desligada por padrão; exige CORS no
   bucket). O layout das partes é o mesmo, então o `concluir` e o job não mudam. É a única exceção à regra "foto não sai
   por URL assinada" (ADR 0041): é só escrita, de uma chave fixa, com validade curta.
2. **Job sob demanda, em fatias, com checkpoint.** Primitivo novo da plataforma: `ModuloApi.trabalhos`
   (`TrabalhoSobDemanda`). O módulo publica um evento próprio (`catalogo.foto_lote.enfileirado@1`) na transação que
   enfileira o lote. O despachante entrega o evento a um consumidor da plataforma que só grava uma linha em
   `plataforma.trabalho` (única por tenant, módulo, trabalho e alvo). Um laço do worker (`apps/api/src/trabalhos.ts`)
   reserva o trabalho por função `SECURITY DEFINER` com trava de prazo (`travado_ate`), confere a licença do módulo no
   tenant e chama `executarFatia` por até **20 s / 100 itens**. Cada item é uma transação curta, e o checkpoint é o
   próprio item (`situacao = 'pendente'` → final), então a fatia seguinte, o reinício do worker ou outro processo retomam
   de onde parou. Falha conta tentativa com espera crescente; com 5 falhas o módulo marca o lote `falhou` (`aoFalhar`).
   Rede e disco ficam fora das transações (T-0121).
3. **Leitor de ZIP seguro na plataforma, sem dependência nova** (`node:zlib`, `node:fs`). O worker junta as partes num
   arquivo temporário (calcula o SHA-256 do ZIP nesse passo) e lê o diretório central com acesso aleatório. Regras:
   - **Path traversal**: separador `\` vira `/`; caminho absoluto, letra de unidade ou segmento `..` → item **recusado**
     (`caminho_invalido`); nos outros, vale só o **nome-base**. Nada é escrito a partir do nome.
   - **Zip bomb**: até 8 MB descompactados por entrada (declarado e **real**: `inflateRaw` com `maxOutputLength`) e até
     8 MB + 64 KiB compactados (o leitor nunca aloca mais que isso por entrada), razão
     descompactado/compactado até **20**, soma descompactada do lote até **1 GiB**, CRC-32 e tamanho real iguais aos
     declarados. Fora disso o item é recusado (`foto_grande`, `compressao_suspeita`, `entrada_corrompida`) ou o lote
     inteiro (`descompactado_grande`).
   - Só os métodos `stored` e `deflate`; entrada criptografada, ZIP64 e ZIP de vários discos são recusados.
   - **Ignorados** (fora do relatório e da contagem): pastas, `__MACOSX/`, qualquer segmento que comece com `.`,
     `Thumbs.db` e `desktop.ini`. O teto de 10 mil vale para os arquivos considerados; o diretório central com mais de
     20 mil entradas recusa o lote antes de qualquer leitura.
   - **Tipo pela assinatura** (magic bytes), nunca pela extensão.
4. **JPEG, PNG e WEBP, com decodificadores em JS puro registrados por assinatura** (R-20261115-074500).
   `packages/platform-sdk/src/imagens.ts` reconhece a assinatura (magic bytes) e lê largura e altura do cabeçalho sem
   decodificar. O que é **aceito** é a interseção da lista do módulo (`TIPOS_FOTO_LOTE`, os três) com os decodificadores
   registrados na API (`apps/api/src/decodificadores.ts`, tipo → RGBA):
   - JPEG: `jpeg-js` 0.4.4 (já em uso, ADR 0036);
   - PNG e WEBP (com e sem perda, com transparência): **`image-in-browser` 3.7.0** — MIT, TypeScript compilado para JS,
     sem dependências, sem binário nativo nem WASM (porta do `image` do Dart; o WEBP deriva do libwebp, BSD). Entra só
     em `apps/api`; o app e o SDK não a carregam.
   O teto de 30 MP é conferido pelo cabeçalho **antes** de alocar os pixels. O original fica guardado como veio
   (`<id>.png`/`.webp`); a miniatura é sempre JPEG. A rota antiga `PUT /v1/arquivos/:id` continua só JPEG.
5. **Casamento do nome com o produto** (função pura no `domain` do Catálogo): código exato → código sem diferenciar
   maiúsculas → EAN; o primeiro passo que acha decide, e mais de um produto casando é **ambíguo** (nada é ligado). O Core
   oferece `core.produtos_por_sku@1` (`{ codigos: string[1..500] }` → `{ produtos: { id, sku, ean, ativo }[] }`, os não
   removidos com `sku`, `lower(sku)` ou `ean` na lista).
6. **Miniatura no job.** `guardarImagem` decodifica (com o teto de 30 MP da ADR 0036), grava o original e a miniatura
   (`<id>.m320.jpg`) antes da transação do item. Foto que não decodifica é recusada (`foto_ilegivel`) e nada é gravado.
   O `GET /v1/arquivos/:id/miniatura` continua gerando na 1ª leitura para as fotos antigas.
7. **Idempotência.**
   - Lote: `id` gerado no BKO (POST idempotente). O SHA-256 do ZIP é calculado no job; outro lote vivo do tenant com o
     mesmo SHA → o novo vira `duplicado` com `duplicado_de` (não processa, some da lista) e a tela abre o existente.
   - Foto: `produto_midia.hash_conteudo` (SHA-256 da imagem), único por produto entre as vivas. A mesma foto no mesmo
     produto = **repetido**, sem mídia nova.
   - Item: `arquivo_id` e `midia_id` nascem na conferência (gravados no item), então repetir a fatia regrava a mesma
     chave e o `update ... where situacao = 'pendente'` não aplica duas vezes.
8. **Função única `definirFotosProduto`** (`modules/catalogo/api/miniatura.ts`): grava fotos por ordem (a de ordem 1 é
   a principal), aposenta a viva da mesma ordem, publica `catalogo.foto.definida@1` / `catalogo.foto.removida@1` e toca
   `produto_conteudo` na mesma transação. `definirFotoPrincipal` e `removerFotoPrincipal` passam a delegar a ela. Todas as
   fotos ficam gravadas com a ordem; a galeria no app é a 2ª etapa, e o app continua só com a foto de ordem 1.
9. **Permissão e licença.** Todas as rotas do lote exigem `produto.enriquecer` e o Catálogo licenciado; as rotas de
   partes e `concluir` só aceitam o arquivo do próprio usuário, do mesmo tenant, ainda `aguardando`. Lote, itens e
   trabalho com `tenant_id` e RLS.

## Premissas (aceitas pelo gerente-projetos em 15/11/2026)
- Produto **inativo** também casa; só o removido fica de fora.
- A foto nova da mesma ordem **substitui** a anterior (a antiga é aposentada com `catalogo.foto.removida@1`).
- `SKU_1` vale como ordem 1 (ele e `SKU` no mesmo ZIP → o segundo é recusado com `ordem_repetida_no_lote`).
- Existindo `CX` e `CX_12`, o arquivo `CX_12.jpg` é **ambíguo** (as duas leituras casam).
- Reenviar o mesmo ZIP sobe os bytes de novo, mas **não reprocessa**: o lote novo vira `duplicado` do existente.

## Alternativas consideradas
- **`PUT` único em fluxo** (stream direto para o S3 com `UNSIGNED-PAYLOAD` ou multipart): não passa pelo túnel da
  Cloudflare (100 MB) nem pelo `/api-proxy`, e depende do provedor aceitar `UNSIGNED-PAYLOAD`. Rejeitada para o BKO.
- **URL assinada como caminho principal**: abre o bucket ao navegador (CORS) e foge da regra da ADR 0041. Fica ligável.
- **Processar no consumidor da outbox**: segura o lote de eventos e a transação por minutos e estoura os 30 s.
- **Agendador de 15 min**: o analista esperaria até 15 min para começar.
- **pg-boss**: dependência e schema novos para um único job; a ADR 0007 já trocou pg-boss pela outbox. Volta se surgirem
  vários jobs longos.
- **`yauzl`/`unzipper`**: resolvem o ZIP, mas não os tetos de zip bomb do jeito que a RN pede; o leitor próprio é pequeno,
  só `stored`/`deflate`, e a regra fica testável no SDK.
- **`sharp`/libvips para PNG e WEBP**: binário nativo, já recusado na ADR 0036. **`@jsquash/webp` / `webp-wasm`**: WASM
  do libwebp, mais rápido, mas é binário embutido; fora da regra "JS puro". **`pngjs`** só cobre o PNG; uma biblioteca
  para os dois formatos é menos superfície. **Converter tudo para JPEG na chegada**: perde a transparência e o original,
  e o hash de "repetido" deixaria de ser o do arquivo enviado.
- **Hash do ZIP no navegador** (deduplicar antes do envio): SubtleCrypto não faz SHA-256 em fluxo, e 500 MB em memória no
  navegador é risco. O reenvio sobe o ZIP de novo, mas não cria processamento nem mídia.

## Consequências
- SDK: `TrabalhoSobDemanda`, `ContextoTrabalho`, `ArquivosDoTrabalho`, `classificarEntradaZip`, `detectarTipoImagem`,
  `dimensoesImagem`, `TipoArquivo` com `image/png`, `image/webp` e `application/zip`, `TransacaoTenant.infoArquivo`.
- Dependência nova só em `apps/api`: `image-in-browser` 3.7.0 (MIT, JS puro, ~3 MB no disco). API: partes, `concluir`, URL assinada, leitor de ZIP,
  decodificadores, laço de trabalhos no worker. Porta `ArmazenamentoArquivos` ganha `tamanho(chave)`.
- Banco: `plataforma.trabalho` + funções do worker; `plataforma.arquivo` aceita `image/png`, `image/webp` e
  `application/zip` (até 500 MB) e foto de até 8 MB; `catalogo.foto_lote`, `catalogo.foto_lote_item`, `produto_midia.hash_conteudo` e ordem única por produto;
  índice `lower(sku)` em `core.produto`.
- Core oferece `core.produtos_por_sku@1` (exato, sem diferenciar maiúsculas e EAN, até 500 códigos).
- O worker precisa de até ~600 MB livres no disco temporário por lote em andamento (um por processo).
- Lote recusado ou concluído apaga as partes do ZIP; o SHA fica no lote para a idempotência.
