# ADR 0009 — Sync de escrita e de escopo: comandos push-only, sobreposição da fila, versão do escopo e entidade sem provedor

- **Status**: proposta (vale quando o gerente aprovar o desenho T-0016)
- **Data**: 2026-10-31
- **Tarefa**: T-0016 (desenho da Sprint 1: [docs/desenho/T-0016.md](../desenho/T-0016.md) §2) · corrige o D-2 da T-0006
- **Autor**: engenheiro-software
- **Base**: ADR 0003 (motor de sync), ADR 0006 (API modular e horizonte do pull), doc 04 "Sincronização offline", RN-CORE-02/04/11

## Contexto
A Sprint 1 traz as primeiras escritas reais do aparelho (check-in, checkout, leitura de notificação) e as primeiras entidades
de sync cujo escopo depende de quem é o usuário (títulos, histórico, visitas, rotas, metas). Quatro problemas apareceram:

1. **Uma entidade, dois papéis.** Hoje a entidade `visita` do app recebe no push tanto o check-in (id do item = id da visita)
   quanto o checkout (id do item = UUID novo, com `visit_id` no payload). O id do item é a chave de idempotência e, no pull, o id
   da linha. Misturar os dois papéis torna a idempotência e o conflito ambíguos. Além disso, `DefinicaoEntidadeSync.schema` é
   usado para o payload do push **e** documenta a linha do pull, que têm formatos diferentes (ex.: `CreateOrderRequest` × linha
   de `vendedor.pedido`).
2. **Pull sobrescreve o que ainda está na fila.** Com `servidor_vence`, uma visita fechada no aparelho e ainda não enviada volta
   "aberta" se o pull trouxer a linha do servidor antes do push ser aceito.
3. **Escopo que muda sem a linha mudar.** O cursor `(updated_at, id)` só traz linha alterada. Se um cliente entra na carteira do
   vendedor (ou o vendedor muda de equipe), as linhas antigas desse cliente (títulos, contatos, histórico) têm `updated_at` atrás
   do cursor e nunca chegam; se o cliente sai, nada manda apagar no aparelho (vazamento, RN-CORE-04).
4. **D-2.** O pull de uma entidade registrada no app sem provedor no servidor responde 501 e o motor para a sincronização inteira.
   O push de entidade sem `receber` volta `ENTIDADE_DESCONHECIDA` e o item fica "falhou — corrija ou descarte", embora não haja
   nada a corrigir (pedido feito offline antes de o servidor aceitar pedidos).

## Decisão
1. **Comando = entidade push-only com id próprio.** Fato que muda uma linha já existente vira entidade de push separada
   (`visita_checkout`, `notificacao_leitura`), com o UUID do comando como id do item e chave de idempotência guardada na linha
   (ex.: `visita.checkout_id`). A entidade "estado" (`visita`) aceita no push só a criação (check-in, id = id da visita).
   Pedido continua estado (`app_edita_ate_status`, id = id do pedido).
2. **`DefinicaoEntidadeSync.schemaLinha?`** (opcional, platform-sdk): schema Zod da linha do pull. `schema` passa a ser só o do
   payload do push (entidades `pull` usam o mesmo nos dois, como hoje). Os provedores validam a linha em teste; o app tipa a
   leitura local por ele. Compatível: sem `schemaLinha`, nada muda.
3. **Sobreposição da fila no aparelho.** A tela lê `linhas do pull ⊕ itens pendentes da fila` da mesma entidade/agregado; o item
   pendente vence até ser aceito. O motor expõe `motor.pendentes(entidade)` (itens `pendente`/`falhou` da fila) e o módulo aplica
   a sobreposição com função pura do próprio domínio (ex.: `aplicarPendentesVisita`). O pull nunca apaga um item da fila.
4. **Versão do escopo na página do pull.** `PaginaSync` ganha `versao_escopo?: string` (hash do conjunto visível: carteira para
   entidade de cliente, usuários visíveis para entidade de usuário). O provedor declara o escopo (`escopo: 'carteira' | 'usuarios'
   | 'proprio' | 'tenant'`) e a plataforma calcula e devolve o hash. Se a versão mudou desde a última página guardada, o motor
   faz **ressincronização da entidade**: recomeça do cursor nulo, marca as linhas recebidas e, ao fim da passada, apaga as que não
   vieram (com `linhas` do SQLite, numa transação por lote; no chave→JSON, no mapa). Assim cliente que entra traz o histórico e
   cliente que sai some do aparelho no próximo sync.
5. **Janela de tempo no provedor.** Entidade que cresce sem limite (visita, rota, título liquidado, notificação, histórico) só
   devolve linhas dentro de uma janela (`data >= hoje − N`). Linha que sai da janela não é apagada pelo servidor: o módulo poda
   localmente por data (etapa de limpeza do próprio módulo). A janela de cada entidade fica no desenho do módulo.
6. **`ctx.usuariosVisiveis()`** no contexto da rota e do provedor (porta nova, fornecida pelo Core em
   `servicos.usuariosVisiveis`, padrão que falha fechado = só o próprio usuário): conjunto de usuários cujos dados o usuário vê
   (RN-CORE-04: ele mesmo; supervisor + a equipe; gerente + equipes abaixo; analista/assistente/admin `'tenant'`). Usado por
   visita, rota, meta e pedido.
7. **Entidade sem provedor não derruba a sincronização (D-2).**
   - Pull: 501 `SYNC_NAO_IMPLEMENTADO` de uma entidade faz o motor pular a entidade (sem mexer no cursor), registrar um aviso na
     tela de sync ("ainda não disponível no servidor") e seguir com as demais; `sincronizar()` termina com sucesso.
   - Push: entidade de módulo efetivo que tem provedor sem `receber` (ou nenhum provedor) volta `rejeitado/SYNC_NAO_IMPLEMENTADO`;
     o motor trata esse código como **retentável**: o item continua `pendente` (não "falhou"), com a mensagem "envio ainda não
     disponível no servidor", e não bloqueia o resto do lote. Entidade fora de todos os manifestos continua `ENTIDADE_DESCONHECIDA`
     (D-1 / T-0015 decide a ordem com `MODULO_INATIVO`).
   - Isso não substitui os provedores reais: na Sprint 1 `visita` (core) e `pedido`/`pedido_item` (vendedor, só pull) ganham provedor.

## Alternativas consideradas
- **Payload em união na mesma entidade** (como hoje na `visita`): menos entidades, mas o id do item muda de significado conforme
  o formato e o servidor precisa adivinhar o comando pelo corpo; conflito e idempotência ficam por convenção.
- **Pull completo periódico** (sem versão de escopo): simples, mas relê 500 clientes com títulos e histórico a cada N horas
  mesmo sem mudança; não resolve o vazamento entre duas passadas.
- **`greatest(linha.updated_at, carteira.updated_at)` como cursor**: resolve a entrada na carteira, não resolve a saída nem a
  mudança de equipe, e impede o uso do índice `(tenant_id, updated_at, id)`.
- **Motor ignorar todo erro de pull por entidade**: esconderia erro real (500, 403); só o 501 é "ainda não existe".
- **Servidor responder página vazia para entidade sem provedor** (opção (c) do D-2): o cursor avançaria sobre nada e, quando o
  provedor chegasse, o aparelho acharia que já está em dia. O 501 explícito com o motor tolerante é mais honesto.

## Consequências
- platform-sdk: `schemaLinha`, `versao_escopo` em `PaginaSync`, `escopo` no `ProvedorSync`, `ctx.usuariosVisiveis()`,
  `motor.pendentes()`, ressincronização por entidade, tratamento de 501/`SYNC_NAO_IMPLEMENTADO`. Suíte de contrato do motor
  ganha os casos (memória, chave→JSON com `linhas`, SQLite da T-0008).
- apps/api: calcula `versao_escopo` (sha256 curto dos ids ordenados, uma vez por requisição) e o push sem `receber` passa a
  `SYNC_NAO_IMPLEMENTADO`.
- Core: manifesto ganha `visita_checkout` e `notificacao_leitura` em `sync`; `servicos.usuariosVisiveis`.
- Módulos: cada provedor declara `escopo` e janela; cada tela que mostra entidade com push aplica a sobreposição da fila.
- Testes: D-2 (`tests/integracao/api/sync-app.test.ts`, `it.fails`) fica vermelho quando o motor e os provedores entrarem.
