# ADR 0025 — Consulta entre módulos pela licença do tenant (`{ licenca: 'tenant' }`)

- **Status**: aceita (2026-11-05, decisão do gerente-projetos R-20261105-101645, caminho (a) da revisão R-20261105-101415)
- **Data**: 2026-11-05
- **Tarefa**: T-0082 (D-T0082a), com efeito na T-0081 (Farol) e na T-0080 (Início)
- **Autor**: engenheiro-software
- **Base**: ADR 0012 (consultas entre módulos; esta ADR a complementa), ADR 0019 (`usaConsultasOpcionais`), RN-CORE-02/03
  (licença), RN-CORE-04 (escopo), RN-CORE-20/21/27/29

## Contexto
Pela ADR 0012, `tx.consultar(def, entrada)` só chama o dono se ele estiver entre os **módulos efetivos de quem consulta**
(tenant ∩ perfil, menos as exceções do usuário). Para quase tudo isso é o certo: quem não tem o Catálogo não vê preço.

Os indicadores agregados do Core seguem outra regra. A RN-CORE-27 (aceita pelo Alexandre em R-20261105-054146) diz que a
fonte da positivação e da venda é decidida pela **licença do tenant**: com o Vendedor ligado no tenant vale o pedido
(RN-CORE-20/21); sem ele, as notas do ERP. As duas fontes nunca se somam. O Core lê o pedido pela consulta
`vendedor.pedidos_da_meta@1` (ADR 0019) e, se a consulta não responde, cai no `core.indicador_diario`.

O D-T0082a mostrou a falha: um analista do BKO sem o Vendedor no perfil recebe `ConsultaIndisponivel` e vê a RV de um
vendedor pelo `indicador_diario`. O supervisor, que tem o Vendedor, vê a mesma RV pelo pedido. A RV da **mesma pessoa** muda
conforme **quem olha**. O mesmo vale para o painel de metas e para o Início.

## Decisão
1. **Opção na chamada**: `tx.consultar(def, entrada, { licenca: 'tenant' })` (tipo `OpcoesConsulta`, `LicencaConsulta =
   'usuario' | 'tenant'`, no `platform-sdk`). Sem a opção, ou com `'usuario'`, nada muda.
2. **O que muda**: só a checagem de módulo. Com `'tenant'`, o dono vale se estiver entre os **módulos efetivos do tenant**. São
   os mesmos módulos que o consumidor de evento e a tarefa periódica já usam: ativos no tenant ∩ instalados, menos quem perdeu
   uma dependência (RN-CORE-03), com o core sempre ativo. Dono desligado no tenant continua `ConsultaIndisponivel`: a opção
   nunca liga um módulo sem licença.
3. **O que não muda**: a implementação recebe o **mesmo usuário da requisição** (id, perfil, tenant e os módulos dele), a
   mesma transação, o mesmo tenant, a mesma RLS e os mesmos parâmetros do dono.
   - Não há elevação de escopo nem de perfil.
   - O escopo de carteira e de usuários continua o de quem consulta: o consumidor filtra a entrada por `usuariosVisiveis()` e
     `carteira()`, e o dono continua aplicando o próprio recorte pelo perfil (ex.: em `vendedor.pedidos_da_meta@1`, o
     vendedor e o promotor só recebem o próprio número).
   - **Desvio do texto da revisão**: a proposta falava em "identidade de sistema do tenant" (a `t.sistema` dos consumidores).
     Da identidade de sistema, esta ADR usa **só a licença**. O usuário de sistema tem perfil `admin`, e as implementações
     recortam pelo perfil (`pedidos_da_meta@1`; `catalogo.precos_cliente@1`, com `verPrecoDoPerfil`; `pesquisa.etapas_checkout@1`).
     Entregar o admin a elas elevaria o escopo.
4. **Quando um módulo pode pedir `'tenant'`**: só em leitura agregada de indicador cuja fonte a regra de negócio decide pela
   licença do tenant (RN-CORE-27, que vale para o Início, o painel de metas, a RV e o Farol). Nunca em escrita, nunca para
   decidir permissão e nunca para mostrar dado de um módulo que a pessoa não tem (ex.: preço do Catálogo, pedido do Vendedor
   na lista). Caso novo = complemento desta ADR, com a RN que manda a licença do tenant.
5. **Onde vale** (o executor fica em `apps/api/src/outbox.ts`):

   | Onde | Comportamento de `'tenant'` |
   |---|---|
   | Rota de usuário em GET ou HEAD (inclusive o pull e as novidades do sync) | vale |
   | Rota de escrita (POST, PUT, PATCH, DELETE e o push do sync) | erro de programação (500 `ERRO_INTERNO`, sem detalhes); o teste do módulo pega |
   | Consumidor de evento e tarefa periódica | a licença já é a do tenant (ADR 0012/0022); a opção é aceita e não muda o resultado |
   | Rota de Conector (sem usuário, ADR 0013) | continua `ConsultaIndisponivel` |
   | Aparelho (`ambiente.consultar`) | sem a opção: o aparelho só tem as linhas dos módulos do usuário |

6. **Rastreio**: o log da consulta passa a levar `licenca` (`usuario` ou `tenant`), além de `modulo`, `consulta`, `consumidor`
   e `request_id`. Nunca leva a entrada nem a saída.

## Alternativas consideradas
- **(b) Produto: todo perfil do BKO que vê indicador precisa ter o Vendedor no perfil.** Descartada pelo gerente
  (R-20261105-101645). Prende a configuração de perfis a um detalhe técnico, e um único perfil mal configurado volta a mostrar
  números diferentes.
- **Ler sempre o `core.indicador_diario`.** Ignora o tipo da meta (faturamento × pedido, RN-CORE-21/29) e faz a RV deixar de
  bater com o `metas/painel` (🔴 R1 da revisão R-20261105-101415).
- **Chamar a consulta com o usuário de sistema (admin).** Eleva o escopo: o dono recorta pelo perfil (ver o desvio no item 3).
- **Declarar no manifesto (`usaConsultasPeloTenant`).** Mais uma lista para validar, por um caso só. A opção na chamada fica
  explícita no código, o teste cobre o uso e a revisão final confere o item 4. Se surgirem mais casos, a lista pode vir depois
  sem quebrar nada.

## Consequências
- platform-sdk: `OpcoesConsulta` e `LicencaConsulta`; 3º argumento opcional em `TransacaoTenant.consultar`, que vale também
  para `ContextoConsumo.consultar` e `ContextoTarefa.consultar`. A mudança é compatível: quem passa só `(def, entrada)` não
  muda, e os contextos falsos dos testes dos módulos continuam valendo.
- apps/api: `OrigemTransacao.modulosDoTenant`, calculado no `preparar` só em GET/HEAD e passado também pelo despachante e
  pelo agendador. Testes em `apps/api/test/consultas.test.ts`, bloco "ADR 0025".
- Core (modulo-core): liga a opção nas leituras agregadas da RN-CORE-27. São o GET `rv`, o `metas/painel`, os `indicadores` e
  o `inicio`, por meio de `fontePorConsulta`. O Farol só precisa da opção se passar a ler o Vendedor por consulta. Com isso, o
  R-08a do testes (`plano-rv-t0082.test.ts`) vira `it`.
- Revisão final: todo `licenca: 'tenant'` novo é conferido contra o item 4.
