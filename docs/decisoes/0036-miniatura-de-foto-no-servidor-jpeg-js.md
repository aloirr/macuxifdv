# ADR 0036 — Miniatura da foto gerada no servidor com `jpeg-js` (JS puro), na primeira leitura

- **Status**: aceita em 2026-11-08 (rodada da madrugada, R-20261108-220117: aprovação prévia do dono do produto para o que não é governança).
- **Data**: 2026-11-08
- **Tarefa**: T-0097 item (b) — versão reduzida de 320 px da foto no servidor.
- **Autor**: engenheiro-software
- **Base**: ADR 0010 (arquivos e fotos), ADR 0020 (armazenamento S3 da demo), contrato da miniatura do Catálogo (`modules/catalogo/contracts/sync-conteudo.ts`: 320 px, 30 KB).

## Contexto

O pull de `produto_conteudo` leva a referência da foto principal com os tetos do contrato: maior lado de 320 px e até 30 KB. O aparelho confere o tamanho antes de baixar. Mas a foto guardada é a original: o app manda 1600 px e JPEG 80, ou seja, de 100 a 600 KB. Assim o aparelho nunca baixaria a miniatura.

Restrições:
- a API roda em Node, no Docker da VM da Magalu, e no CI;
- não há Docker nem compilação nativa no PC do dono do produto;
- nada de dependência pesada sem ADR;
- a regra de quem pode ver a foto é a de `GET /v1/arquivos/:id`: licença e perfil do módulo dono, carteira do cliente, usuários visíveis, foto do tenant.

## Decisão

1. **Rota nova da plataforma:** `GET /v1/arquivos/:id/miniatura` (`caminhoMiniaturaArquivo` no SDK). Ela usa a mesma função de autorização do original (`lerAutorizado` em `apps/api/src/arquivos.ts`). Quem não pode ler o original também não lê a miniatura, e nada é gerado para essa pessoa.
2. **A miniatura é gerada na primeira leitura, não no upload.** Ela fica guardada no mesmo armazenamento, ao lado do original: `<id>.m320.jpg` (`CHAVE_ARQUIVO_RE` aceita o sufixo). Com isso:
   - o upload continua rápido;
   - as fotos que já estão guardadas também ganham miniatura;
   - o S3 e o disco não mudam.

   Gravar a miniatura é melhor esforço: se falhar, a leitura seguinte gera de novo.
3. **Biblioteca `jpeg-js` 0.4.4:** JS puro, MIT, sem dependências, cerca de 100 KB.
   - Decodifica com teto de 30 MP e 256 MB.
   - Reduz por média de área, aplica a orientação EXIF e codifica.
   - Para caber em 30 KB, a qualidade desce de 80 até 30. Se ainda não couber, o lado diminui ×0,8.
   - Original que não decodifica → 422 `MINIATURA_INDISPONIVEL`. Nesse caso o app mostra o espaço vazio, como sem sinal.
4. **Tetos no SDK:** `LADO_MINIATURA_ARQUIVO_PX` = 320 e `BYTES_MAX_MINIATURA_ARQUIVO` = 30 KB, iguais aos do contrato do Catálogo.

## Alternativas consideradas

- **`sharp` (libvips):** mais rápido e com reamostragem melhor. Porém traz binário nativo de cerca de 30 MB por plataforma, variante para musl e glibc na imagem Docker e risco de falha de instalação no Windows. É peso demais para uma miniatura por foto, gerada uma vez só.
- **Gerar no upload:** deixa o `PUT` mais lento e não cobre as fotos que já existem. Também prende a transação do upload enquanto codifica.
- **Gerar no aparelho e subir as duas versões:** a foto de produto vem do BKO (web) e de cargas, não só do app. Além disso, o servidor continuaria sem garantir o teto.

## Consequências

- A primeira leitura de cada foto custa cerca de 100 a 300 ms de CPU na API, para 1600 px. As seguintes só leem o armazenamento.
- O Catálogo passa a apontar a `url` da miniatura para `/v1/arquivos/<id>/miniatura`. O contrato aceita, porque é prefixo `/v1/arquivos/`. O recado vai ao modulo-catalogo, e o resolvedor do shell (engenheiro-apps) não muda.
- Apagar o original não apaga a miniatura (ADR 0010, sem expurgo físico no v1). Quando houver expurgo, ele remove as duas chaves.
- `jpeg-js` entra só em `apps/api`. O app e o SDK não carregam a biblioteca.
