# ADR 0056 — Estoque carregado uma vez por dia e sincronização parcial ou completa no botão

- **Status**: aceita em 2026-11-15 (aprovada pelo dono do produto, R-20261115-100000-alexandre).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: R-20261115-084000-alexandre ("Estoque é algo carregado apenas uma vez no dia. Para não pesar no FDV.") e
  R-20261115-100000-alexandre (aprovação com as decisões 1 a 4). Desenho: `docs/desenho/T-estoque-diario.md`.
- **Altera**: ADR 0003 (motor de sync) e ADR 0018 (novidades): entidades de cadência diária ficam fora das novidades, do push
  silencioso e da sincronização fora da carga; o botão "Sincronizar" passa a ter dois modos. RN-CORE-23, RN-CAT-07, RN-VEN-20.
- **Não altera**: ADR 0054 (o pacote da primeira carga continua igual; a primeira carga é a carga do dia), servidor, banco,
  eventos e Hub.

## Contexto
- O estoque chega ao aparelho em `deposito` e `estoque_saldo` (Catálogo). Hoje elas entram em toda sincronização: novidades ao
  abrir, ao voltar ao primeiro plano, a cada `sync_auto_min`, push silencioso e botão. Cada lote do ERP muda `updated_at` e faz o
  aparelho puxar de novo. O Alexandre quer o estoque uma vez por dia, para não pesar no FDV.
- O botão "Sincronizar" hoje faz a sincronização completa (envio + pull de tudo do cursor de cada entidade + etapas).

## Decisão
1. **Cadência por entidade** (aditivo): `DefinicaoEntidadeSync.cadencia?: 'continua' | 'diaria'` (padrão `continua`). O Catálogo
   marca `deposito` e `estoque_saldo` como `diaria`.
2. **Carga diária às 06:00 no fuso do tenant** (decisão 1): parâmetro do Catálogo `estoque_carga_hora` [06:00]. A carga é o pull das
   entidades diárias (do cursor de cada uma) feito pela **primeira sincronização com sinal** a partir dessa hora (abrir o app,
   primeiro plano, automática, puxar para baixo). Não há timer novo (RN-CORE-23 sem timer abaixo de 15 min).
   - A regra "carga devida" é função pura do Core (`cargaDiariaDevida`), **injetada** no motor pelo shell
     (`OpcoesMotorSync.cargaDiariaDevida(ultima, agora)`), como os `essenciais` da ADR 0054. O motor não conhece fuso nem hora.
   - Quando a passada que incluiu as diárias termina, o motor grava `sync:carga_diaria_em` (ISO UTC, relógio do aparelho) e o expõe
     em `EstadoMotorSync.carga_diaria_em`. Queda no meio não grava; a próxima sincronização refaz do cursor de cada entidade.
   - A primeira carga (ainda sem `sincronizado_em`) sempre traz as diárias e grava `carga_diaria_em`. A troca de geração
     (ADR 0021) apaga `carga_diaria_em` junto com os cursores.
   - Fora da carga, novidades, push silencioso, a sincronização padrão (`motor.sincronizar()` sem modo) e a parcial **pulam** as
     diárias. O cursor de novidades continua andando: cada entidade tem cursor próprio e o que foi pulado chega na carga seguinte.
3. **Busca online usa o estoque do aparelho** (decisão 2): com `carga_diaria_em` preenchido, o Catálogo troca a disponibilidade da
   resposta de `GET /v1/catalogo/busca` pela local (um estoque só na tela). Só com o catálogo ainda pendente da 1ª carga
   (ADR 0054, solução 5) mostra o da API.
4. **Reserva do pedido faturado** (decisão 3, opção b): no app, o pedido faturado depois da `carga_diaria_em` continua
   descontando a reserva até a próxima carga (regra pura no `domain` do Vendedor, RN-VEN-20). A API continua revalidando com o
   saldo atual do servidor e rejeita com `422`/`RN-VEN-20`.
5. **Botão "Sincronizar" com dois modos** (decisão 4): `motor.sincronizar({ modo })`.
   - **Toque = `parcial`**: envia a fila e puxa **só** as entidades marcadas `DefinicaoEntidadeSync.parcial = true` (pedidos e
     clientes), do cursor de cada uma, sem etapas, sem consultar novidades e sem mexer no cursor de novidades; grava
     `sincronizado_em`. Antes da primeira sincronização completa, faz a completa (carga inicial). Sem nenhuma entidade marcada
     (módulos antigos), faz a sincronização padrão de hoje.
   - **Segurar 10 s = `completa`**: única exceção ao "uma vez por dia". Refaz **tudo do zero**: envia a fila, puxa todas as
     entidades dos módulos efetivos desde o cursor nulo (ressincronização forçada: no fim apaga do aparelho o que não veio), as
     diárias inclusive, e roda as etapas; o progresso é o mesmo da carga inicial (`estado.carga` e `estado.progresso`) e, no fim,
     grava `carga_diaria_em`. Com outra sincronização em curso, espera ela terminar e roda depois. A interrupção é retomada pela
     próxima passada que puxar a entidade (registro `sync:ressinc:<e>` com `refazer` e o cursor da página em curso).
   - Durante a completa o app mostra o popup "Realizando a sincronização completa, aguarde e não saia dessa tela" com a barra de
     progresso igual à da tela de carga (engenheiro-apps; textos e simulação do designer-ux).
   - Chamadas sem `modo` (telas dos módulos, segundo plano, carga inicial) mantêm a sincronização padrão.
6. **Gestão**: a mesma regra vale no motor do Gestão.
7. Tudo **aditivo e opcional**: sem `cargaDiariaDevida` injetada, as diárias são contínuas e `carga_diaria_em` fica nulo (o
   Catálogo usa a hora do ERP como hoje); sem entidade `parcial`, o toque faz o de hoje; servidor sem mudança. Nenhum evento novo,
   nenhuma versão nova de contrato existente, nenhuma dependência nova.

## Alternativas consideradas
- **Timer no aparelho às 06:00**: rejeitado (RN-CORE-23 proíbe timer abaixo de 15 min e o app pode estar fechado; a primeira
  sincronização do dia já acontece ao abrir).
- **Servidor decidir a cadência** (novidades sem as diárias): exigiria mudar a rota e a API para saber a última carga de cada
  aparelho; no aparelho é função pura e funciona offline.
- **Completa só do cursor (delta)**: não atende "tudo de novo"; a completa é o recurso de recuperação do usuário quando algo não
  bate, então refaz do zero e apaga o que não veio.
- **Pacote só de estoque para a carga diária**: fica como evolução se o ERP regravar o estoque inteiro toda noite (risco 1 do
  desenho).

## Consequências
- Menos tráfego e bateria no Campo e no Gestão; estoque no aparelho com até um dia de atraso. "Atualizado às" passa a ser a hora
  da carga diária (com o dia quando não é hoje) e "Estoque desatualizado" = a carga de hoje já devia ter acontecido e não aconteceu
  (RN-CAT-07).
- Mais rejeições `RN-VEN-20` no envio (o app valida com o estoque da carga); mitigado pela opção (b).
- A completa pesa (tudo de novo): é deliberada (segurar 10 s) e mostra progresso; o vendedor não sai da tela.
- Testes do motor: `packages/platform-sdk/src/motor-sync.diaria.test.ts` (3 armazenamentos).
