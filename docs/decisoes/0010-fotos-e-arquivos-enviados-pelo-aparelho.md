# ADR 0010 — Fotos e arquivos enviados pelo aparelho: rota de plataforma, metadados em `plataforma.arquivo` e bytes atrás de porta

- **Status**: proposta (vale quando o gerente aprovar o desenho T-0016)
- **Data**: 2026-10-31
- **Tarefa**: T-0016 (desenho da Sprint 1: [docs/desenho/T-0016.md](../desenho/T-0016.md) §3) · usada pela T-0018 (foto da fachada)
- **Autor**: engenheiro-software
- **Base**: ADR 0006 (rotas declarativas; "escape futuro para upload"), ADR 0008 §5 (câmera: o módulo recebe só o UUID da foto),
  RN-CORE-14, RN-PRO-02, RN-PES-06, doc 04 (LGPD, backups)

## Contexto
A ADR 0008 deixou a foto no aparelho (`<documentos>/fotos/<uuid>.jpg`) e o envio ao servidor para a Sprint 1. A T-0018 exige a
foto da fachada persistida (RN-CORE-14), e Promotor (gôndola, RN-PRO-02) e Pesquisa (RN-PES-06) vão precisar do mesmo. O push do
sync é JSON em lotes de 500 itens: bytes de imagem (100–600 KB cada) não cabem nele. As rotas de módulo são declarativas e não
recebem corpo binário.

## Decisão
1. **Rota de plataforma** `PUT /v1/arquivos/:id` (corpo `image/jpeg` cru, sem multipart, limite 2 MB) e
   `GET /v1/arquivos/:id` (devolve os bytes). Ficam no `createApp` como `/v1/sync/*`. Sem dependência nova (parser de conteúdo
   do Fastify para `image/jpeg`).
2. **Metadados em `plataforma.arquivo`** (`id` = UUID do aparelho, `tenant_id`, `modulo`, `finalidade` ex. `fachada`,
   `entidade`/`entidade_id` (ex.: `visita`/<id>), `cliente_id` (escopo de carteira), `enviado_por`, `tipo`, `tamanho_bytes`,
   `sha256`, `largura_px`, `altura_px`, `situacao` `aguardando | recebido`, `recebido_em`, `chave_armazenamento`, colunas comuns, RLS).
   **Quem cria a linha é o módulo**, na transação do comando que referencia a foto (`tx.registrarArquivo({...})` no SDK; ex.: o
   checkout com `foto_fachada_id`). A rota de upload só **completa** uma linha `aguardando` do mesmo tenant e do mesmo usuário:
   sem linha → 409 `ARQUIVO_SEM_REFERENCIA` (retentável: o push ainda não chegou); `sha256` igual a um já recebido → 200
   (idempotente); diferente → 409 `ARQUIVO_DIVERGENTE`. Valida assinatura JPEG (`FF D8 FF`) e tamanho. O GET checa licença do
   `modulo`, perfil e carteira do `cliente_id` (403 `FORA_DA_CARTEIRA`).
3. **Bytes atrás da porta `ArmazenamentoArquivos`** (`gravar(chave, bytes)`, `ler(chave)`, `remover(chave)`) em `apps/api`:
   adaptador de **disco local** (`MACUXI_ARQUIVOS_DIR`, padrão `./.dados/arquivos`, fora do git) para dev, CI e a primeira
   implantação; chave `<tenant_id>/<modulo>/<aaaa-mm>/<id>.jpg`. Armazenamento de objetos (S3 compatível) entra com ADR própria
   quando o ambiente de nuvem for escolhido (dependência nova).
4. **Fila de arquivos no motor** (platform-sdk): `motor.enfileirarArquivo({ id, modulo, caminho, tipo })`, persistida em
   `sync:arquivos` (separada da fila de itens), enviada **depois** do push dos itens (a linha `aguardando` já existe), um por vez,
   com o leitor de bytes injetado pelo shell (`lerArquivo(caminho)` com `expo-file-system`). `409 ARQUIVO_SEM_REFERENCIA` mantém
   o arquivo na fila; aceito → o arquivo local é apagado depois de 7 dias (a tela ainda mostra a foto offline). RN-CORE-02 vale
   igual à fila de itens (arquivo de módulo desativado fica "não enviado — módulo desativado" até o usuário confirmar).
   A tela de sync mostra "Fotos pendentes: N".
5. **Regras de imagem continuam no aparelho** (ADR 0008 §5: só câmera, 1600 px, JPEG 80); o servidor revalida tipo e tamanho, não
   reprocessa a imagem. Sem dado pessoal em log (só `id`, tamanho e tempo).

## Alternativas consideradas
- **Base64 dentro do push**: estoura o lote (500 itens × 400 KB), reenvia a foto a cada retentativa do lote e infla a outbox no
  aparelho (a fila é uma linha JSON, T-0008 §1.2).
- **`bytea` no Postgres**: zero infraestrutura, mas infla backups/replicação e o banco vira armazenamento de mídia; a porta
  permite começar no disco e trocar sem mudar a rota.
- **URL pré-assinada direto ao S3**: melhor em escala, mas exige o provedor de nuvem agora e uma dependência pesada; fica para a
  ADR do armazenamento de objetos (a rota pode passar a devolver 307 para a URL pré-assinada sem mudar o aparelho).
- **Rota de upload por módulo** (`/v1/core/fotos`, `/v1/promotor/fotos`): três implementações da mesma coisa; e a rota declarativa
  (ADR 0006) não recebe binário.
- **Multipart** (`@fastify/multipart`): dependência nova sem ganho (um arquivo por requisição).

## Consequências
- banco-dados: migração de `plataforma.arquivo` (RLS, índices `(tenant_id, entidade, entidade_id)` e `(tenant_id, situacao)`
  parcial em `aguardando`), mais a coluna de foto no módulo que referencia (ex.: `core.visita.foto_fachada_id`).
- platform-sdk: `tx.registrarArquivo`, fila de arquivos no motor, `enviarArquivo` no transporte. apps/api: rotas, porta e
  adaptador de disco; `MACUXI_ARQUIVOS_DIR` no `.env.example`. apps/mobile: `lerArquivo` no shell.
- Linha `aguardando` há mais de 7 dias aparece no monitor do BKO (foto não chegou) — tarefa futura; nada é rejeitado por isso.
- Backup dos arquivos fica com a ADR do armazenamento de objetos; no disco local, o diretório entra no backup do servidor.
- Retenção/exclusão por tenant (LGPD) apaga linhas e bytes pela chave `<tenant_id>/…`.
