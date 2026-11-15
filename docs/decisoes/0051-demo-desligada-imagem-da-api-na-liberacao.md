# ADR 0051 — Demo desligada: a imagem da API passa a ser montada na liberação da versão

- **Status**: proposta em 2026-11-14 (branch `nuvem/demo-desligada-engenheiro-software`). Mexe em `.github/**` e
  `scripts/ci/**`: o merge segue o rito de governança, com a autorização do dono do produto (número do PR e SHA).
- **Data**: 2026-11-14
- **Autor**: engenheiro-software
- **Origem**: R-20261114-230600-alexandre ("Pode desligar a demo / Ja vou desligar a VM dele e o / banco de dados. Ja
  posso fazer isso? Nao quero gastar actions com ele tambem").
- **Altera**: ADR 0020 (demo, agora desligada), ADR 0028 §4 (origem da imagem da API), ADR 0044 §6 (`demo-mudou`),
  ADR 0024 (o `dbaas-teste.yml` sai).

## Contexto
A demo (ADR 0020) sai do ar: VM `macuxi-demo-se1`, o Postgres dela, o túnel `macuxi-demo-nuvem` e o bucket
`macuxi-demo-arquivos`. A produção (ADR 0028/0046) não muda. Mas ela dependia da demo num ponto: a
`ghcr.io/<dono>/macuxi-api:<sha>` que o `producao-liberar`, o `producao-aprovar` e o `producao-publicar` exigem era
montada pelo job `imagens` do `demo-publicar.yml`, a cada push no `main` que mexesse em código.

## Decisão
1. **A imagem da API é montada no `producao-liberar.yml`** (job `imagem`), e não mais a cada push no `main`:
   - primeiro confere a versão nova e que o commit está no `main` com CI verde de push (`producao-conferir.mjs entrada` e
     `commit`), **antes** de montar qualquer imagem;
   - depois verifica se a `macuxi-api:<sha>` já existe no GHCR (`producao-conferir.mjs imagem`). Só monta quando o GHCR
     diz que a tag não existe. Se a consulta falhar, o job falha sem montar nada. Assim uma tag existente nunca é remontada
     e o digest não muda entre liberar, aprovar e publicar;
   - monta o `apps/api/Dockerfile` **do commit liberado** (checkout do SHA em `alvo/`; os scripts de conferência são os do
     `main`) e envia só a tag `<sha>`. A tag `main` deixa de existir, porque ninguém a usa;
   - por fim, faz a mesma conferência `conferir` do aprovar e do publicar, que fixa o digest.
2. **Sai tudo o que dependia da VM da demo**: `demo-publicar.yml` (jobs `mudou`, `imagens` e `deploy`), `demo-recriar-base.yml`,
   `dbaas-teste.yml` (entrava na VPC pela VM da demo), `scripts/ci/demo-mudou.mjs` e o alvo `teste-db` do
   `apps/api/Dockerfile`. O `conector-publicar.yml` perde a opção `demo` e publica só no bucket `macuxi-prod`
   (environment `PRODUCAO`).
3. **`scripts/deploy/demo/` fica**:
   - a produção copia o `alerta-saude.sh` e o `ghcr-tentar.sh` para a VM;
   - os três workflows de produção usam o `ghcr-tentar.sh`;
   - o `stack-isolado.yml` monta o compose da demo no runner (migrações, seed, backup e restauração).

   Mover esses arquivos mexeria em quatro workflows e dispararia o stack isolado, sem economizar nada.
4. **O BKO de produção** deixa de ler o cache `macuxi-bko` da demo: usa só o `macuxi-bko-prod`.

## Por que a opção (b), e não manter só o job de imagens
- **Gasto**:
  - (a) manter o job `imagens` monta a API e o BKO da demo em todo push de código no `main`, várias vezes por dia,
    ~5–10 min cada, para usar uma imagem só a cada versão;
  - (b) monta só a API, uma vez por versão, e nada quando a imagem do SHA já existe (as versões antigas e a repetição do
    liberar);
  - a imagem do BKO da demo some de vez, porque a produção monta a `macuxi-bko-prod`.
- **Garantia da ADR 0028 §4**: é a mesma. Nos dois casos, a imagem é montada no Actions a partir do commit que tem CI
  verde de push no `main`, depois desse CI, e a produção roda essa imagem por digest. Em (b), o CI verde é conferido
  **antes** do build, e não só depois. A parte "e já roda na demo" acaba com a demo, nas duas opções.

## Alternativas consideradas
- **(a) Manter só o job `imagens` do `demo-publicar`**: rejeitada pelo gasto. Ela também manteria um workflow chamado
  "demo" sem demo.
- **Montar a imagem no `producao-publicar`, na tag**: rejeitada. O liberar e o aprovar conferem a imagem antes da issue
  e da tag, e o digest tem de ser o mesmo nos três.
- **Remontar sempre no liberar**: rejeitada. Uma nova liberação do mesmo SHA trocaria o digest (o build não é
  reprodutível) e a issue aberta antes apontaria para outra imagem.

## Consequências
- O primeiro `producao-liberar` de cada SHA leva ~5–10 min a mais (build da API). Os seguintes não mudam.
- Liberar commit só de `.github`/docs passa a funcionar sem passo manual (antes era preciso o "demo — publicar" manual).
- O cache `type=gha,scope=macuxi-api` passa a ser gravado só pelo liberar. O stack isolado continua lendo esse cache.
  Sem uso por 7 dias, o GitHub apaga o cache, e o build seguinte só fica mais lento.
- O dono do produto pode apagar o environment `DEMO_SSH_KEY` e os secrets dele, listados no relatório da entrega.
- Fica para os donos: endereços `*-demo.macuxifdv.com.br` nos apps (`eas.json`, `next.config.ts`, `portal.ts`,
  `apps/web/Dockerfile`), roteiros e autotestes da demo (`tests/`), seeds e scripts do `db/dbaas`, `CLAUDE.md` e o doc 07.
