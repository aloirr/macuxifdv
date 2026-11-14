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
