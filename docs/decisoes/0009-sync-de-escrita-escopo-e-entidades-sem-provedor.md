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
   **Revisto no adendo de 2026-10-31 (D-3)**: o item aceito continua sobreposto até o pull trazer a linha; a tela lê
   `motor.sobreposicao()`.
4. **Versão do escopo na página do pull.** `PaginaSync` ganha `versao_escopo?: string` (hash do conjunto visível: carteira para
   entidade de cliente, usuários visíveis para entidade de usuário). O provedor declara o escopo (`escopo: 'carteira' | 'usuarios'
   | 'proprio' | 'tenant'`) e a plataforma calcula e devolve o hash. Se a versão mudou desde a última página guardada, o motor
   faz **ressincronização da entidade**: recomeça do cursor nulo, marca as linhas recebidas e, ao fim da passada, apaga as que não
   vieram (com `linhas` do SQLite, numa transação por lote; no chave→JSON, no mapa). Assim cliente que entra traz o histórico e
   cliente que sai some do aparelho no próximo sync.
5. **Janela de tempo no provedor.** Entidade que cresce sem limite (visita, rota, título liquidado, notificação, histórico) só
   devolve linhas dentro de uma janela (`data >= hoje − N`). Linha que sai da janela não é apagada pelo servidor: o módulo poda
   localmente por data (etapa de limpeza do próprio módulo). A janela de cada entidade fica no desenho do módulo.
   **Adendo (revisão final da Sprint 1)**: só limite que a linha deixa com o tempo; nunca limite superior por data futura (ver adendo §5).
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

## Adendo 2026-10-31 — §5: a janela só pode ter limite que a linha deixa com o tempo (revisão final da Sprint 1)
**Problema** (revisão da T-0018): a janela de `rota`/`rota_parada` era `data ∈ [hoje − 40, hoje + 30]`. Uma rota gravada para
daqui a 45 dias fica fora da janela no pull de hoje; o cursor `(updated_at, id)` passa por ela e, quando a data entra na janela,
nada mudou na linha (`updated_at` antigo): ela nunca chega ao aparelho. A `versao_escopo` não ajuda (o conjunto de usuários não mudou).

**Decisão**: o filtro de janela do provedor só pode excluir linhas que **saem** dela com o passar do tempo (limite inferior por
data/instante, ex.: `data >= hoje − 40`, `created_at >= now() − 30 dias`, `expira_em > now()`). Limite superior por data futura
(`data <= hoje + N`) é proibido: o que ainda vai entrar tem de vir já no primeiro pull. Quem precisa limitar o futuro limita na
escrita (ex.: o BKO não grava rota além de N dias) ou na tela. Correção: `rota` e `rota_parada` passam a `data >= hoje − 40`
(desenho T-0016 §2). Teste do provedor: linha com data além do limite antigo vem no pull.

## Adendo 2026-10-31 — §3: o item aceito continua sobreposto até o pull trazer a linha (D-3)
**Problema** (D-3, testes, T-0018/T-0019): o item saía da fila no `aceito`, mas a linha só volta pelo pull depois do
horizonte (`updated_at < horizonte`, ≥ 2 s atrás do relógio do banco, mais se houver transação longa aberta). Nesse
intervalo a sobreposição não tinha mais o item e o pull ainda não tinha a linha: a visita aberta sumia da rota e o app
deixava abrir outro check-in (RN-CORE-11 quebrada no aparelho), e a notificação lida voltava a "não lida".

**Decisão**
1. **Estado `aceito` fora da fila.** No `aceito`, o motor tira o item de `estado.fila` (que continua sendo "o que falta
   enviar": contadores, badges, tela de sync) e o põe em `estado.aceitos` (`ItemAceito`, `situacao: 'aceito'`, persistido
   em `sync:aceitos`). Fila e aceitos mudam no mesmo `mudar` (a tela nunca vê o item fora dos dois); no disco, aceitos
   primeiro (queda entre as gravações = item nos dois: reenvio idempotente, sobreposição repetida inofensiva).
2. **A sobreposição lê `motor.sobreposicao(entidades?)`** (= `itensParaSobrepor(estado, entidades)`, pura para `useMemo`
   com `[estado.fila, estado.aceitos]`): aceitos + `pendente`/`falhou` da fila, por ordem de criação. `motor.pendentes()`
   continua só com `pendente`/`falhou`. As funções do domínio (`aplicarPendentesVisita`, `montarCaixa`) já são idempotentes
   com a linha presente (check-in com id existente é ignorado; checkout com `checkout_id` igual é ignorado; leitura só vale
   se a linha não está lida).
3. **Quando sai.** No fim de cada `sincronizar()` (também na que falha no meio, com o que chegou), sai o aceito cuja
   linha a passada **garante** ter trazido: a API devolve `PaginaSync.horizonte` (o `ate` usado na página) e
   `ResultadoItemPush.em` (`clock_timestamp()` do banco lido depois dos provedores gravarem; toda linha gravada tem
   `updated_at` = início da transação, antes dele). Sai se a passada completa da entidade-alvo teve `min(horizonte) > em`.
   Entidade-alvo: a própria, se `ambos` (`visita`, `pedido`); num comando só de push (`visita_checkout`,
   `notificacao_leitura`), **todas** as de pull do mesmo módulo; entidade que respondeu 501 não segura (não há linha a
   esperar); módulo sem entidade de pull = sai no primeiro sync. Servidor sem os campos (Fase M, servidor simulado sem
   relógio): relógio do aparelho — pull iniciado mais de `MARGEM_ACEITE_SEM_HORIZONTE_MS` (5 s) depois do aceite.
4. RN-CORE-02 (módulo desativado) e RN-CORE-15 (aparelho bloqueado) levam os aceitos do módulo/de todos junto.

**Alternativas**: (b) linha local provisória gravada pelo motor — o motor não conhece o formato da linha (o comando de
checkout muda a linha `visita`, não cria `visita_checkout`); (c) o push devolver a linha — exige cada `receber` montar a
linha de outra entidade e o motor gravar fora do cursor; (d) soltar o aceito por tempo fixo — falha com transação longa
segurando o horizonte. A (a) com `horizonte`/`em` é exata, compatível (campos opcionais) e não muda os provedores.

**Consequências**: platform-sdk (`ItemAceito`, `ItemSobreposicao`, `estado.aceitos`, `motor.sobreposicao`,
`itensParaSobrepor`, `MARGEM_ACEITE_SEM_HORIZONTE_MS`, `PaginaSync.horizonte?`, `ResultadoItemPush.em?`, `relogio` no servidor
simulado); apps/api (`horizonte` na página, `em` no aceito, `BancoApp.instanteSync()`). Core: `pendentesDaFila` aceita
`ItemSobreposicao` com `situacao` `aceito`; `montarEstadoLocal`/`painelLocal`/`montarCaixa` recebem `motor.sobreposicao()`
em vez de `estado.fila`; os efeitos que recalculam dependem também de `estado.aceitos`. Testes: S1-042 e S1-065 deixam de
falhar (o helper `caixa` do teste passa `ap.motor.sobreposicao()`).

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
