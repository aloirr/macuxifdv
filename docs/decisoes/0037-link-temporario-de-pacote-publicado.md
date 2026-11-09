# ADR 0037 — Link temporário (URL pré-assinada) só para pacotes publicados, como o instalador do Conector

- **Status**: aceita em 2026-11-09 (esteira permanente, R-20261107-164646; não é governança).
- **Data**: 2026-11-09
- **Tarefa**: T-0098 — download do Conector no portal por link temporário de bucket privado.
- **Autor**: engenheiro-software
- **Base**: ADR 0010 (fotos; "URL pré-assinada fica para a ADR do armazenamento"), ADR 0020 (S3 da demo, "se precisarmos de URL pré-assinada, revemos"), ADR 0031 (portal), contrato acordado em R-20261108-234517 e na resposta R-20261109-012239-engenheiro-software.

## Contexto

O portal (aba Integração) precisa entregar o instalador do Conector on-premise ao admin do cliente. Os requisitos são:
- o pacote fica num bucket privado;
- o link vale pouco tempo;
- só quem entra no portal pede o link, e cada pedido fica auditado.

O instalador tem dezenas de MB. Se a API servisse os bytes, um processo do Fastify ficaria preso por download e o pacote passaria pela VM. O S3 já resolve isso com a URL pré-assinada.

As ADRs 0010 e 0020 deixaram a URL pré-assinada de fora do v1 e só para as fotos: lá quem decide o acesso é a rota, a cada leitura.

## Decisão

1. **Porta `ServicoPacotes` no SDK** (`packages/platform-sdk/src/pacotes.ts`), entregue às rotas de módulo em `ctx.pacotes`.
   - `linkDoUltimo(produto)` devolve `{ versao, arquivo, tamanho_bytes?, sha256?, publicado_em?, url, expira_em }`, ou `null` quando nenhum pacote foi publicado.
   - Sem S3, com o bucket fora ou com o manifesto inválido, a porta lança `ErroHttpModulo` 503 `ARMAZENAMENTO_INDISPONIVEL` (falha fechada).
   - Os produtos são uma lista fechada (`PRODUTOS_PACOTE = ['conector']`). A chave do objeto nunca vem do cliente.
2. **Quem decide o acesso é a rota do módulo, não a porta.** A rota é `POST /v1/integracao/conector/download`, do `modulo-integracao`. Ela checa a permissão do portal e a licença, grava a auditoria (`tx.auditar`, sem a URL) e traduz o `null` em 404 `CONECTOR_SEM_PACOTE`.
3. **No bucket:** o mesmo bucket privado e a mesma credencial das fotos (`MACUXI_S3_*`), com o prefixo `MACUXI_PACOTES_PREFIXO` (padrão `pacotes/`, diferente do prefixo das fotos).
   - `pacotes/<produto>/<arquivo>` é o pacote.
   - `pacotes/<produto>/ultimo.json` é o manifesto (`PacotePublicadoSchema`).
   - Quem publica é o comando `pnpm --filter api publicar-pacote conector <arquivo> --versao X.Y.Z`. Ele grava o pacote primeiro e o manifesto depois. Assim, quem pede no meio da publicação recebe o pacote anterior.
4. **O link** (`apps/api/src/pacotes.ts`, `preAssinarGetS3` em `armazenamento-s3.ts`):
   - é um GET assinado com SigV4 por query string, com só o `host` assinado e `UNSIGNED-PAYLOAD`;
   - leva `response-content-disposition: attachment` com o nome do arquivo;
   - vale `MACUXI_PACOTES_VALIDADE_S` segundos: padrão 300, de 60 a 900. Valor fora disso impede a API de subir.

   É o mesmo código de ~40 linhas da ADR 0020, sem SDK da AWS. O teste confere o resultado contra o exemplo publicado pela AWS e contra o S3 falso, que recalcula a assinatura e a validade.
5. **As fotos continuam sem URL pré-assinada.** A ADR 0010 vale como está: elas passam pela rota a cada leitura.
6. **Log e segredos:**
   - a URL assinada é um segredo de curta duração: não vai para log, auditoria nem armazenamento no cliente (o portal gera um link a cada clique);
   - os logs da porta levam só o produto, o status HTTP e o código S3 ou da porta;
   - a credencial fica só no ambiente.

## Alternativas consideradas

- **A API servir o arquivo (stream do S3 pela rota):** dispensa a URL assinada, mas prende a API e a banda da VM por download e duplica o tráfego. Não ganha nada em controle, porque o link já nasce de uma rota autenticada e auditada.
- **Bucket ou objeto público:** qualquer um baixa sem login, e o critério 1 da T-0098 não seria cumprido.
- **Listar o bucket (`ListObjectsV2`) para achar a última versão:** exige parsear XML e ordenar versões, e a publicação deixa de ser atômica. O `ultimo.json` é mais simples e já traz o tamanho e o sha256 que o portal mostra.
- **SDK da AWS (`@aws-sdk/s3-request-presigner`):** é uma dependência pesada para uma função pura que já temos testada.

## Consequências

- O `modulo-integracao` publica `LinkDownloadConectorSchema` nos contracts e cria a rota. O portal (`apps/web`) troca o schema local pelo do contrato.
- O link só é útil se o endpoint do S3 for acessível pelo navegador de quem baixa. Na Magalu (`https://br-se1.magaluobjects.com`) é. Num MinIO interno (stack isolado) o link aponta para um host interno, o que só serve para teste.
- Sem `MACUXI_ARQUIVOS_DRIVER=s3` (dev e CI), a porta fica desligada e a rota responde 503. O portal mostra "em breve".
- Versões antigas ficam no bucket. A limpeza é manual, e o `ultimo.json` sempre aponta para a mais recente publicada.
