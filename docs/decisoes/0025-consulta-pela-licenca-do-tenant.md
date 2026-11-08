# ADR 0025 — Consulta entre módulos pela licença do tenant (`{ licenca: 'tenant' }`)

- **Status**: aceita (2026-11-05, decisão do gerente-projetos R-20261105-101645, caminho (a) da revisão R-20261105-101415)
- **Data**: 2026-11-05; complemento §4.1 em 2026-11-08 (T-0114, bloqueio R-20261108-085416: consulta de configuração do tenant em rota de escrita)
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
   na lista). Caso novo = complemento desta ADR, com a RN que manda a licença do tenant. Exceção à escrita: §4.1 (consulta
   `configuracaoDoTenant`, só leitura).
5. **Onde vale** (o executor fica em `apps/api/src/outbox.ts`):

   | Onde | Comportamento de `'tenant'` |
   |---|---|
   | Rota de usuário em GET ou HEAD (inclusive o pull e as novidades do sync) | vale |
   | Rota de escrita (POST, PUT, PATCH, DELETE e o push do sync) | erro de programação (500 `ERRO_INTERNO`, sem detalhes); o teste do módulo pega. Exceção: consulta `configuracaoDoTenant` (§4.1), num savepoint somente leitura |
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

## Complemento §4.1 — consulta de configuração do tenant em rota de escrita (2026-11-08, T-0114)

**Contexto.** O cancelamento do pedido do Vendedor (POST `pedidos/:id/cancelar`, RN-VEN-31 com a exceção da T-0114) pergunta
"o ERP deste tenant aceita cancelamento?" pela consulta `integracao.cancelamento_erp@1`. A Integração só está nos perfis
admin e analista. Com a licença do usuário, o vendedor, o supervisor e o gerente recebem sempre `ConsultaIndisponivel`, e a
rota responde 422 `RN-VEN-CANCELAR-APOS-ENVIO` (D-1 do testes, R-20261108-081926; E2-V em
`tests/integracao/api/cancelamento-erp-t0114.test.ts`; bloqueio R-20261108-085416). A pergunta é do **tenant**, não do perfil:
quem pode cancelar continua decidido pela ação `pedido.cancelar` do motor de permissões (ADR 0033) e pela RN-PRO-01.

**Decisão.**
1. **O dono declara no contrato**: `definirConsulta({ ..., configuracaoDoTenant: true })` (`DefinicaoConsulta.configuracaoDoTenant`).
   A declaração afirma que a resposta é **configuração do tenant**: a mesma para qualquer usuário do tenant, sem recorte por
   perfil, carteira ou usuário, e sem dado pessoal na entrada nem na saída (ex.: um booleano ou um código).
2. **Rota de escrita** (método ≠ GET/HEAD, inclusive o push do sync) pode pedir `{ licenca: 'tenant' }` **só** para consulta
   assim declarada. A API confere a declaração no **registro da implementação do dono**, não na definição que o consumidor
   passa (uma cópia "disfarçada" não vale). Qualquer outra consulta com `'tenant'` em escrita continua erro de programação
   (500 `ERRO_INTERNO`).
3. **Só leitura, garantido pelo Postgres**: nesse caso a API roda a consulta em `savepoint macuxi_consulta_tenant` + `set
   transaction read only`, e ao fim faz `rollback to savepoint` + `release savepoint`. Qualquer escrita da implementação é
   recusada (SQLSTATE 25006) e a rota cai em 500 com a transação inteira desfeita. Como a consulta não escreveu nada, desfazer
   o savepoint não perde dado, e a transação volta ao modo leitura e escrita para a rota continuar. A implementação não recebe
   `publicar`, `auditar` nem sessão de outro módulo: só o mesmo `ClienteBanco`, o mesmo usuário (sem elevação) e a mesma RLS.
4. **O que não muda**: GET/HEAD seguem a decisão original (sem savepoint); a checagem de módulo é a mesma (dono desligado no
   tenant = `ConsultaIndisponivel`; a opção nunca liga módulo sem licença); Conector sem usuário = `ConsultaIndisponivel`;
   consumidor e tarefa periódica não mudam; o aparelho segue sem a opção.
5. **Quando declarar** (a revisão final confere): só quando a pergunta é do tenant e a RN diz isso. Primeiro e único caso:
   `integracao.cancelamento_erp@1` (RN-INT-08, RN-VEN-31/T-0114). Nunca para decidir permissão de perfil, nunca para devolver
   dado de módulo que a pessoa não tem (preço, pedido, cliente) e nunca com recorte pelo usuário.

**Alternativas.**
- **Lista fixa de consultas na plataforma** (`apps/api`). Prende a plataforma a nomes de módulo e tira do dono a afirmação
  sobre o que a consulta devolve. Descartada.
- **Colocar a Integração no perfil do vendedor, supervisor e gerente.** Mostraria o módulo inteiro (menus, telas e consultas)
  a quem só precisa de um sim ou não. Descartada.
- **Cópia da configuração no Vendedor por evento.** A T-0114 decidiu consultar na hora, sem cópia (RN-INT-08). Descartada.
- **Só confiar na revisão, sem savepoint somente leitura.** A ADR original já proíbe escrita na consulta; aqui a rota é de
  escrita e a transação é a mesma, então a garantia passa a ser do banco. Custo: três comandos a mais só neste caso.

**Consequências.**
- platform-sdk: `DefinicaoConsulta.configuracaoDoTenant?: true` e a opção em `definirConsulta` (compatível: contratos sem a
  chave não mudam de forma). Testes em `packages/platform-sdk/src/consultas.test.ts`.
- apps/api: `OrigemTransacao.escrita`; `modulosDoTenant` passa a ir também na rota de escrita; `emSomenteLeitura` no
  `outbox.ts`. Testes em `apps/api/test/consultas-tenant-escrita.test.ts` (banco falso) e
  `consultas-tenant-escrita.banco.test.ts` (Postgres, no CI).
- modulo-integracao: `configuracaoDoTenant: true` em `CONSULTA_CANCELAMENTO_ERP` (`modules/integracao/contracts/consulta-cancelamento.ts`).
  A versão continua `@1`: entrada e saída não mudam.
- modulo-vendedor: `tx.consultar(CONSULTA_CANCELAMENTO_ERP, {}, { licenca: 'tenant' })` em `rotaCancelarPedido`. Sem a
  declaração do dono a chamada dá 500; por isso o Vendedor só troca depois da Integração.
