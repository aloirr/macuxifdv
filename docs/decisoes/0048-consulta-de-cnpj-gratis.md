# ADR 0048 — Consulta de CNPJ grátis (BrasilAPI, reserva CNPJá) no portal

- **Status**: proposta em 2026-11-14.
- **Data**: 2026-11-14
- **Tarefa**: consulta de CNPJ (branch `nuvem/cnpj-receita-engenheiro-software`; o gerente atribui o número)
- **Autor**: engenheiro-software
- **Origem**: R-20261114-132600-alexandre, item 2 ("integração grátis com a Receita Federal… ao colocar o CNPJ do cliente, aparecer todos os dados dele no cadastro") e R-20261114-133700-alexandre (UF das empresas sem código `UF+4`).

## Contexto
- No passo Empresa do portal `config.`, quem implanta digita razão social, endereço e UF à mão.
- A Receita não tem API própria grátis e aberta. Os dados públicos do CNPJ (dados abertos, atualizados todo mês) são servidos de graça por terceiros.
- As empresas sem código de licença no formato novo `UF+4` (hoje uma) precisam da UF, e a UF não pode ficar fixa no código.

## Decisão
1. **Rota** `POST /v1/plataforma/cnpj` com corpo `{ cnpj }` (com ou sem máscara), para o super-admin ou o admin do cliente. É POST para o CNPJ não ir na URL nem no log de acesso. Contrato no SDK (`packages/platform-sdk/src/cnpj.ts`): `ConsultaCnpjPedidoSchema` e `ConsultaCnpjRespostaSchema` (`.strict()`). Erros: 400 `CNPJ_INVALIDO` (a fonte nem é chamada), 404 `CNPJ_NAO_ENCONTRADO`, 503 `CNPJ_FONTE_FORA`, 429 `CNPJ_LIMITE` com `Retry-After` (20 por minuto por sessão do portal).
2. **Fonte**: BrasilAPI (`brasilapi.com.br/api/cnpj/v1/{cnpj}`). É grátis, sem chave e sem SLA; o limite de uso não é publicado. Os dados vêm da base pública da Receita.
3. **Reserva**: CNPJá API aberta (`open.cnpja.com/office/{cnpj}`). É grátis, sem chave, com cerca de 5 consultas por minuto por IP, e roda em infraestrutura independente. É chamada quando a BrasilAPI está fora (prazo, 5xx, 429, rede, resposta fora do formato) **ou dá 404**: a base dela é mais nova e acha empresa recém-aberta.
4. **Resultado**: 404 nas duas, ou 404 numa e a outra fora, dá não encontrado. As duas fora dão 503, e o portal deixa preencher à mão.
5. **Prazo e cache**: 4 s por fonte (`AbortController`). Cache em memória: 24 h para o que achou e 1 h para o não encontrado, com até 1000 CNPJs. Pedidos simultâneos do mesmo CNPJ viram uma chamada só.
6. **LGPD**: sócios e QSA não saem da API, porque o mapeamento nem lê esses campos e o contrato é `.strict()`. O log leva só fonte, resultado, cache e duração: nunca o CNPJ, o corpo ou a resposta.
7. **UF das empresas antigas**: o comando `pnpm --filter api uf-do-cnpj <CNPJ>` usa as mesmas fontes e imprime `{"cnpj","uf","fonte"}`. A geração do código `UF+4` e a gravação são do banco-dados.
8. **CNPJ inválido não cria empresa** (R-20261114-144000, item 3): o `POST /v1/plataforma/empresas` confere o CNPJ na Receita antes de ir ao banco, com a mesma consulta e o mesmo cache da rota 1, também no `simular`. Só a situação **ATIVA** cria (`situacaoCriaEmpresa` no SDK). Erros: 400 `CNPJ_INVALIDO` (dígito errado; a Receita nem é chamada), 422 `CNPJ_INATIVO` com `detalhes.situacao_cadastral` (baixada, suspensa, inapta, nula), 422 `CNPJ_NAO_ENCONTRADO` e 503 `CNPJ_FONTE_FORA` com `Retry-After` ("tente de novo"; nada é criado com a Receita fora).

## Alternativas descartadas
- **minhareceita.org**: tem o mesmo formato e a mesma base da BrasilAPI, então não é uma reserva independente.
- **ReceitaWS**: só 3 consultas por minuto no plano grátis, com termos mais restritivos.
- **API paga, como o Serpro**: tem custo e contrato, e o pedido foi "grátis".
- **GET com o CNPJ na URL**: o número cairia no log de acesso.

## Consequências
- **Rede**: a VM de produção (e a da demo) precisa de saída HTTPS para `brasilapi.com.br` e `open.cnpja.com`. Sem ela, a consulta responde 503 e nenhuma empresa é criada (item 8).
- **Testes**: quem sobe a API para criar empresa injeta uma consulta falsa (`consultaCnpj` do `createApp`); sem ela, o teste depende da rede e da situação real do CNPJ.
- **Sem SLA**: as duas fontes podem mudar o formato ou sair do ar. Uma resposta fora do contrato conta como fonte fora, e o teste com as amostras reais avisa da mudança.
- **Cache por processo**: com mais de uma instância, cada uma tem o seu cache, o que é aceitável para o volume do portal.
- **Dado mensal**: a base pública é atualizada uma vez por mês, então o portal mostra os dados para conferir, e não para gravar sem olhar.

## Adendo 1 (2026-11-14): código da licença pela UF da Receita, plano na lista e dados gravados
Origem: pedidos do engenheiro-apps para o portal config. enxuto, aprovado pelo dono do produto (R-20261114-170600).

9. **Código da empresa = código da licença** (`UF` + 4 dígitos aleatórios, sorteado pelo banco na migração 0068). No `CriarEmpresaSchema` e no `CriarEmpresaComPlanoSchema`, o `codigo` passa a ser opcional e entram `tenant_id` (UUID gerado no portal) e `uf`:
   - **sem `codigo`** (o portal): o `tenant_id` é obrigatório, porque é a chave de idempotência do sorteio (reenviar não sorteia outro código). Sem ele, a API responde 400 `VALIDACAO` com `detalhes.campo = 'tenant_id'`. A UF do sorteio é a da Receita, que a API consulta de novo (item 8). A `uf` do corpo é opcional: se for diferente da Receita, a API responde 422 `UF_DIFERENTE_DA_RECEITA` com `detalhes.uf_receita`; ela só vale quando a Receita não tem UF (sede no exterior). Sem nenhuma das duas, a API responde 422 `UF_OBRIGATORIA`. O código sorteado volta em `codigo` na resposta, também no `simular` (sorteio desfeito com a transação);
   - **com `codigo`** (legado e `pnpm tenant`): segue como antes, idempotente pelo código. O contrato recusa código no formato da licença (`am1234`): só o banco sorteia.
10. **O `POST /v1/plataforma/empresas-com-plano` também confere o CNPJ na Receita** (só a situação ATIVA cria, como no item 8). Antes ele criava sem conferir.
11. **Lista de empresas** (`EmpresaResumoSchema`): entram `plano` (nome do plano da assinatura; `null` = sem assinatura), `teste_ate` (fim do teste grátis enquanto a assinatura não está paga; `null` = paga, sem teste ou sem plano) e `em_teste` (hoje, no fuso da empresa, até `teste_ate`; calculado pela API com `emTeste` do SDK). A `sa_listar_tenants` devolve o nome do plano, o `teste_ate` e o `paga` de cada empresa na mesma consulta, sem consulta por linha. Enquanto o banco não devolve esses campos, a lista sai sem plano.
12. **Dados da Receita gravados** no cadastro da empresa: razão social (já em `nome`), CNPJ (já em `documento`), UF, nome fantasia, endereço (logradouro, número, complemento, bairro e CEP), município e CNAE principal (código e descrição). São dados públicos da pessoa jurídica. O que vai ao banco é o que a API recebeu da Receita na conferência do item 8, e não o que o portal manda. O corpo continua só com razão social, CNPJ e UF.
    - **Não são gravados**: telefone e e-mail da Receita, porque em MEI, empresário individual e empresa pequena costumam ser do titular, ou seja, dado pessoal pela LGPD. O contato que vale é o do admin inicial. A situação cadastral também não é gravada: ela só é conferida na criação. Sócios e QSA nunca entram (item 6).
    - **Log**: nenhum desses campos vai a log. O log continua só com fonte, resultado, situação e cache.
    - **Pendente do banco-dados**: as colunas do cadastro em `plataforma.tenant` (ou uma tabela 1:1), aceitas pela `provisionar_tenant` num bloco `cadastro`, e a `sa_listar_tenants` com `plano`, `teste_ate` e `paga`. Com a migração pronta, a API passa o bloco `cadastro` na `EntradaProvisionarPlataforma`; até lá, só razão social, CNPJ e UF (no código) ficam gravados.
