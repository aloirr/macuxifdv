# ADR 0034 — Marcas concorrentes no Catálogo: uma lista só, lida pelo Promotor por contrato

- **Status**: **proposta** em 2026-11-08 (aceita com o ok do gerente-projetos). **Substitui a [0027](0027-marcas-concorrentes-no-core.md).**
- **Data**: 2026-11-08
- **Tarefa**: T-0113 ([desenho](../desenho/T-0113.md))
- **Autor**: engenheiro-software
- **Origem**: decisão do dono do produto, R-20261107-173950 item b
- **Regras**: RN-CAT-09, RN-PRO-12, RF-PRO-11, RF-CAT-09; proposta de RN-CAT-13 (§7)
- **Base**: ADR 0005 (sem FK entre schemas), ADR 0012 (consultas entre módulos), ADR 0019 (consulta opcional), ADR 0007/0022
  (eventos e consumidores), ADR 0033 (chaves de permissão estáveis)

## Contexto
Pela ADR 0027, as marcas concorrentes da referência cruzada (RN-CAT-09) eram o cadastro `promotor.concorrente`. O Catálogo lia
esse cadastro pela consulta `promotor.concorrentes@1`. Isso deixou dois riscos registrados:
1. o tenant sem o Promotor (o caso típico de autopeças: Catálogo + Vendedor) não tem marcas, então não grava referências;
2. o usuário sem o Promotor no perfil (o vendedor) recebe `ConsultaIndisponivel`. A 0034 resolveu isso com o retrato
   `produto_referencia.marca_nome`.

O dono do produto decidiu (R-20261107-173950 b): **o cadastro de marcas passa a ser do Catálogo**. O Promotor lê a lista do
Catálogo por contrato. A lista é uma só, sem cadastro duplicado, e funciona com ou sem o Promotor licenciado. O retrato
`marca_nome` continua. A troca é feita agora, enquanto não há cliente real.

Hoje o Promotor usa `promotor.concorrente` em quatro lugares:
- no BKO de cadastros de trade (aba Concorrentes, e o seletor da aba Produtos do concorrente);
- na FK interna `promotor.produto_concorrente.concorrente_id`;
- na entidade de pull `concorrente`, que nenhuma tela do app usa (o `loja.ts` só grava `concorrente_id: null`);
- na consulta `promotor.concorrentes@1`, que tem um consumidor só, o Catálogo.

As coletas (`coleta_preco.concorrente_id` e `acao_concorrencia.concorrente_id`) guardam o id **sem FK**.

## Decisão

### 1. Dono
O cadastro é do **Catálogo**: tabela `catalogo.marca_concorrente`, com as colunas da regra 5, `nome` (1..120) e `ativo`.
O Catálogo tem também a tela do BKO, as rotas, a entidade de pull, a consulta e o evento.
- O nome `marca_concorrente` não é por acaso. `marca`, sozinho, já é o texto da marca própria do produto, que vem do ERP para o
  `core.produto` e entra no vocabulário da busca. A entrada `'marca'` sem entidade no `sync` do manifesto do Catálogo **não** é
  reaproveitada.
- **Sem exclusão pelo BKO**: a marca só inativa e reativa. O id fica no histórico das coletas do Trade e nas referências.
- Para o Promotor nada muda nas permissões: quem cadastra continua sendo analista e admin, agora pela ação nova
  `marca.gerenciar` do Catálogo (chave estável, ADR 0033). A ação `concorrente.gerenciar` do Promotor fica, com a mesma chave,
  e passa a cobrir só os **produtos** do concorrente.

### 2. Contratos do Catálogo (todos `@1`, aditivos para o Catálogo)
| Contrato | Forma |
|---|---|
| Consulta `catalogo.marcas@1` (API **e** aparelho) | Entrada `{ids?: UUID[] ≤ 500, busca?: trecho do nome ≤ 120 (ilike, curingas escapados), incluir_inativas = false}` strict. Saída `{marcas: [{id, nome, ativo, external_id}]}`, ordenada por `lower(nome), id`, com no máximo 2000 linhas. Apagadas nunca saem; id inexistente simplesmente não volta (não é erro). Responde a quem tem o Catálogo efetivo (ADR 0012): os 7 perfis do Catálogo, inclusive vendedor e promotor. |
| Entidade de pull `marca_concorrente` (`MarcaConcorrenteSyncSchema`) | Pull, escopo tenant, servidor vence: `id, nome, ativo, external_id` + colunas de sync. Alimenta a consulta no aparelho (offline-first das telas do Trade e do Catálogo). |
| Evento `catalogo.marca_concorrente.alterada@1` | Um por escrita, publicado pela outbox na mesma transação. Payload strict: `{id, nome, ativo, external_id: string \| null, fato: 'criada' \| 'alterada' \| 'inativada' \| 'reativada', alterada_em}`. É o estado completo, e o consumidor guarda o de `alterada_em` maior (idempotente, tolera evento fora de ordem). Sem dado pessoal: o nome é de empresa. |

A forma da consulta é a da `promotor.concorrentes@1` com outros nomes: `concorrentes` passa a `marcas` e `incluir_inativos`
passa a `incluir_inativas`. Assim a troca no consumidor é mecânica.

### 3. O Promotor consome o contrato, sem ler tabela do Catálogo
- **Servidor**: o Promotor chama `catalogo.marcas@1` em `usaConsultas`. Pode ser `usaConsultas` e não `usaConsultasOpcionais`
  porque o Catálogo já está em `opcionais` do Promotor (ADR 0012). Usos:
  - validar `concorrente_id` ao gravar produto do concorrente: a marca precisa existir e estar ativa, senão 422
    `REFERENCIA_INVALIDA`, como hoje;
  - preencher o seletor e os nomes da aba Produtos do concorrente e do CSV.
- **Aparelho**: as telas do Trade que precisarem da lista (preço do concorrente, ação da concorrência) leem `catalogo.marcas@1` no
  aparelho, que lê a entidade `marca_concorrente` local do Catálogo.
- **Sem cópia no Promotor.** Ele não guarda projeção da lista; por isso não precisa do evento para ler. O evento existe porque
  é o contrato de mudança da lista (pedido do dono) e porque serve a quem reage a ela. Exemplos: o Hub, para reprocessar os
  avisos `marca_concorrente_desconhecida` quando a marca for cadastrada; e um cache futuro de nomes nos relatórios. O Promotor
  passa a consumi-lo só se um dia guardar algo derivado da marca.
- **Integridade**: sai a FK `produto_concorrente_concorrente_fk`. O id continua o mesmo e a referência passa a ser lógica,
  validada pela consulta na escrita (ADR 0005). `coleta_preco` e `acao_concorrencia` não mudam.
- **RN-PRO-12**: o Catálogo não enxerga o Trade, então a inativação da marca não é barrada por produto do concorrente vivo. O
  Promotor reage na leitura:
  - o produto do concorrente de marca inativa sai dos seletores e das listas da coleta;
  - o histórico mostra o nome pela consulta com `incluir_inativas`.
  A parte "concorrente com produto vivo" da RN-PRO-12 sai. A de categoria fica.

### 4. Migração dos dados (banco-dados; próximo número livre, hoje 0043)
É uma migração só, num lote só com as fatias do Catálogo e do Promotor (desenho §3):
1. Cria `catalogo.marca_concorrente` com RLS e FORCE RLS, `isolamento_tenant`, `select, insert, update` ao `macuxi_app`, gatilho
   de `updated_at` e os mesmos índices de hoje: `(tenant_id, id)` único, `lower(nome)` único entre as vivas, `external_id` único
   entre as vivas e o índice de sync.
2. Copia **todas** as linhas de `promotor.concorrente`, inclusive as inativas e as apagadas, com o **mesmo** `id`, `tenant_id`,
   `nome`, `ativo`, `created_at`, `updated_at`, `deleted_at` e `external_id`. Esta leitura entre schemas é a **única exceção** à
   regra 1 / ADR 0005 que esta ADR autoriza: só na migração do banco-dados, uma vez, para transferir o dono. Nenhum código de
   módulo lê o schema do outro.
3. Confere por tenant que as contagens e o conjunto de ids batem; se não baterem, `raise`.
4. Preenche `produto_referencia.marca_nome` onde ele está nulo, com o nome da marca. Antes, confere que não há referência órfã
   (`marca_id` sem marca), com `raise` e a contagem se houver. Depois cria a FK
   `produto_referencia (tenant_id, marca_id) → marca_concorrente (tenant_id, id)`, que é do mesmo schema e agora pode existir.
5. No Promotor: tira a FK `produto_concorrente_concorrente_fk` e o `insert, update` do `macuxi_app` em `promotor.concorrente`.
   A tabela fica só de leitura, como rede de volta, até a fase 2.
   - Revogar a escrita **fecha a janela do deploy**: uma gravação da API antiga entre a migração e a troca do contêiner falha
     (o usuário refaz na tela nova). Ela não grava numa tabela que ninguém mais lê, então não há perda silenciosa.
6. **Volta (down)**:
   - devolve ao Promotor as linhas do Catálogo, por `id` (insere as novas e atualiza nome, ativo, datas e `external_id` das
     existentes);
   - devolve as permissões e recria a FK do Promotor;
   - tira a FK da referência e apaga `catalogo.marca_concorrente`.
   - O retrato `marca_nome` fica. A volta só vale com o código anterior.
- **Ordem do deploy**: um lote único (migração + Catálogo + Promotor + seeds), porque a imagem da API é uma só e as migrações
  rodam antes dela subir. Não há janela com dois donos. A base demo segue o mesmo caminho. O plano B é o workflow
  `demo-recriar-base`, com os seeds já movidos.

### 5. `promotor.concorrentes@1` e a entidade `concorrente`: deprecação com prazo
- **Neste lote**, o Catálogo deixa de chamar `promotor.concorrentes@1`, que fica sem consumidor. O Promotor continua a oferecê-la
  (registrada no manifesto, marcada `@deprecated`), mas ela **sempre responde `ConsultaIndisponivel`**, com a mensagem que aponta
  `catalogo.marcas@1`.
  - **Revisto em 2026-11-08** (R-20261108-063621, lote do build de hoje): a delegação para `catalogo.marcas@1` prevista na
    primeira versão desta seção **não** é feita. O `ContextoConsulta` do SDK não encadeia consultas (não tem `consultar`), e
    abrir esse encadeamento agora (uma consulta chamando outra, com licença, perfil e ciclo a conferir) é mudança de plataforma
    sem consumidor que a justifique: o único consumidor, o Catálogo, sai neste mesmo lote, e o aparelho nunca a chamou pela
    API (a consulta no aparelho é local). `ConsultaIndisponivel` é a resposta que todo consumidor de consulta opcional já
    trata (ADR 0019), então nada quebra.
  - Vale até a remoção na fase 2 (abaixo, prazo 2026-12-08). Se aparecer consumidor novo antes disso, ele usa
    `catalogo.marcas@1` direto; o encadeamento de consultas no SDK, se um dia for preciso, vem com ADR própria.
- **Neste lote**, a entidade `concorrente` continua registrada no Promotor, mas como legado: o provedor devolve página vazia.
  Assim o APK já distribuído (Campo-Demo-v1.0.0) não recebe 404 `ENTIDADE_DESCONHECIDA` no pull. Ele nunca mostrou essa
  entidade em tela.
- **Fase 2, depois do prazo**: saem a consulta, a entidade, o Drizzle e a tabela `promotor.concorrente` (migração `drop`).
  - **Prazo**: não antes de **2026-12-08** (30 dias).
  - **Condições**: (a) o log de acesso não mostra pull de `entidade=concorrente` há 7 dias; (b) todo APK em uso foi gerado depois
    deste lote.
  - É uma remoção incompatível, por isso vai com recado a todos. Não precisa de ADR nova: o prazo está aqui.

### 6. O retrato `marca_nome` (0034) continua
- Ele continua sendo gravado por quem grava a referência: a rota do BKO e o consumidor do ERP. A diferença é que agora eles
  resolvem a marca na **própria** tabela do Catálogo, na mesma transação, sem consulta.
- **Renomear** a marca atualiza `marca_nome` de todas as referências dela **na mesma transação**. Com isso o `updated_at` sobe e
  o aparelho recebe o nome novo no pull. O consumidor de `promotor.concorrente.alterado@1` previsto na 0027 não é mais preciso
  (esse evento nunca foi publicado e não será).
- **Inativar ou reativar** a marca também toca `updated_at` das referências dela. O provedor de pull de `produto_referencia`
  manda a referência de marca inativa ou apagada como apagada (lápide) e a manda de novo quando a marca reativa. Assim o APK
  antigo, que não conhece `marca_concorrente`, também tira a referência da busca (RN-CAT-09).
- O vendedor continua lendo o retrato. Ele não depende mais do Promotor para nada da referência cruzada.

### 7. Regras de negócio (o texto é do gerente, no doc 03)
- **RN-CAT-09**: as marcas vêm do cadastro de marcas concorrentes do **Catálogo** (BKO → Catálogo → Marcas concorrentes), o mesmo
  que o Promotor usa, com ou sem o Promotor licenciado.
- **RN-CAT-13 (proposta)**, Marcas concorrentes:
  - cadastro do Catálogo, feito por analista e admin;
  - nome único no tenant sem diferenciar maiúsculas, até 120 caracteres; `external_id` opcional e único;
  - não se apaga: só inativa e reativa;
  - ao inativar, a tela mostra quantas referências saem da busca e pede confirmação;
  - renomear atualiza o "Equivale a" das referências.
- **RN-PRO-12**: sai a parte "concorrente com produto vivo" (§3).
- **RF-PRO-11** e doc 06: "concorrentes" passa a "produtos do concorrente (as marcas são do Catálogo)", e a marca da referência
  vem do cadastro do Catálogo.

## Riscos e premissas
1. **Tenant com o Promotor e sem o Catálogo** (premissa P1): não há marcas. O produto do concorrente e as coletas de concorrente
   ficam indisponíveis, e as telas somem sem erro (RN-CORE-03), como já acontece com o Catálogo opcional. Os pacotes comerciais do
   doc 01 sempre trazem o Catálogo junto do Promotor (Trade = Essencial + Promotor + Pesquisa). Tornar o Catálogo dependência do
   Promotor fica para o dono decidir, se esse caso aparecer.
2. A migração lê o schema do Promotor uma única vez (§4 item 2). É uma exceção documentada aqui, não um precedente.
3. Renomear uma marca com muitas referências reescreve essas linhas numa transação. Com até 3 referências por produto, isso fica
   em milhares de linhas, aceitável. Se pesar, a troca vira lotes com a mesma semântica.
4. Ciclo de pacotes no workspace: o Catálogo tira `@macuxi/promotor` das dependências **antes** de o Promotor ganhar
   `@macuxi/catalogo` (o lockfile é do engenheiro-software, no mesmo lote). Com os dois declarados ao mesmo tempo o `turbo`
   recusa o grafo ("Cyclic dependency detected") e `pnpm lint/typecheck/test` da raiz param: o lote não sobe assim.

## Alternativas descartadas
- **Manter a 0027** (o Promotor é o dono): deixa o risco 1 aberto. É a decisão que o dono do produto trocou.
- **Projeção no Promotor** (`promotor.concorrente` como cópia de leitura alimentada pelo evento): manteria a FK e a entidade
  `concorrente` sem esforço. Mas é a lista duplicada que o dono vetou, tem consistência eventual e pede reconciliação. Ela só
  sobrevive como rede de volta, só de leitura, até a fase 2.
- **Core dono**: já descartada pelo dono do produto na 0027.
- **Marcas no Catálogo com ids novos e tabela de/para**: perde os ids das coletas e das referências. Copiar com o mesmo id
  dispensa o de/para.
- **Remover já `promotor.concorrentes@1` e a entidade `concorrente`**: quebraria o pull do APK já distribuído (404).

## Consequências
- Os riscos 1 e 2 da 0027 fecham: o tenant sem o Promotor cadastra marcas e referências, e o vendedor vê "Equivale a".
- O Catálogo deixa de depender do Promotor: saem o `usaConsultasOpcionais: ['promotor.concorrentes@1']` e a dependência
  `@macuxi/promotor` do pacote. O Promotor passa a usar `catalogo.marcas@1`.
- O BKO tem uma lista só, em Catálogo → Marcas concorrentes. A aba Concorrentes do Trade sai, com um aviso e um link para a nova.
- Os registros em `.coord/contratos/` (`modulos.md`, `eventos.md`) passam a apontar para esta ADR. A 0027 fica como histórico,
  com o status "substituída pela 0034".
