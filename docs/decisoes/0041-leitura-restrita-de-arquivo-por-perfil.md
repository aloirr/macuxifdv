# ADR 0041 — Leitura restrita de arquivo por perfil (`perfis_leitura`) e foto sem URL pré-assinada

- **Status**: proposta em 2026-11-10 (vale com o desenho T-0147 aprovado pelo gerente)
- **Data**: 2026-11-10
- **Tarefa**: T-0147 ([desenho](../desenho/T-0147.md))
- **Autor**: engenheiro-software
- **Origem**: R-20261110-062234-alexandre (documentos sensíveis do PDV só para admin, analista e supervisor da carteira; nunca em log); RN-CORE-38.
- **Atualização (10/11)**: o gerente (cargo) também abre (R-20261110-085951 item 3, aviso R-20261110-084206). A lista do Core
  passa a ser admin, analista, gerente e supervisor da carteira. O registro de quem abriu fica para depois da v1.0.5.
- **Complementa**: [ADR 0010](0010-fotos-e-arquivos-enviados-pelo-aparelho.md) (rota de plataforma e fila de arquivos). Mantém a
  [ADR 0037](0037-link-temporario-de-pacote-publicado.md) (pré-assinada só para pacote publicado).

## Contexto
A regra de leitura de arquivo da ADR 0010 é licença + perfil do módulo + carteira do cliente. Ela libera a CNH do sócio para o
vendedor da carteira, o que o dono do produto proíbe. A regra de quem lê é de negócio (Core), mas quem entrega os bytes é a rota de
plataforma, que não conhece tipos de foto.

## Decisão
1. `plataforma.arquivo.perfis_leitura text[]` (nulo = regra de hoje). O módulo dono grava a lista no `tx.registrarArquivo`, a partir
   do seu domain (o Core: `PERFIS_DOC_SENSIVEL` nos tipos sensíveis).
2. O `GET /v1/arquivos/:id` (e a miniatura) exige, quando há lista, um perfil da lista **e** a carteira; fora disso 404 sem motivo.
   Restritos respondem `cache-control: private, no-store`.
3. Foto não ganha URL pré-assinada do bucket: o link valeria sem login durante a validade. O BKO baixa com o token e mostra por
   `URL.createObjectURL`.
4. Fila do aparelho: `apagarAoEnviar` apaga o arquivo local assim que o envio é aceito (documento sensível não fica 7 dias no aparelho).
5. A leitura não escreve linha de log; o log da requisição só tem método, rota com UUID e status.

## Alternativas consideradas
- **Rota de leitura própria do Core** (`/v1/core/clientes/:id/fotos/:tipo`): duplica a rota de arquivos, a miniatura e o cache; e
  a rota declarativa não devolve binário (ADR 0006). Rejeitada.
- **URL pré-assinada curta (5 min)**: alivia a API, mas vira credencial ao portador. Rejeitada para foto; pode voltar com ADR se a
  carga de leitura exigir.
- **Flag `sensivel` em vez de lista de perfis**: põe na plataforma a regra de negócio "quais perfis". Rejeitada.

## Consequências
- banco-dados: coluna nova em `plataforma.arquivo`. engenheiro-software: `NovoArquivo.perfis_leitura?`, regra no `GET`, `apagarAoEnviar` no motor.
- O Core atualiza `perfis_leitura` dos arquivos de um tipo quando o admin muda `sensivel` (função do SDK `tx.restringirArquivos`, mesma transação).
- Outros módulos podem restringir arquivos pelo mesmo caminho, sem mudar a plataforma.
