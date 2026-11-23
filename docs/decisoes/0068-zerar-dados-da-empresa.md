# ADR 0068 — "Zerar dados" da empresa: regra no banco e cópia de 7 dias no lugar do backup

- **Status**: proposta. O número 0068 vale depois de reservado no `.coord/quadro.md` pelo gerente-projetos; está livre no `origin/main` 6b2cfd4 e sem reserva no quadro.
- **Data**: 2026-11-23 (Manaus)
- **Versão**: v1.0.30. Regra: RN-PLA-12 (nova). Desenho: `docs/desenho/empresa-zerar.md`. Contrato: `packages/platform-sdk/src/empresa-zerar.ts`.
- **Autor**: engenheiro-software
- **Origem**: pedido do dono do produto: "coloque um botão ao lado do excluir chamado 'zerar dados'. vou clicar lá para zerar os dados".

## Contexto
A ADR 0052 pôs Inativar, Backup e Excluir no portal. A exclusão exige um backup `pronto`, mas o worker do backup (cifra, S3,
manifesto) não foi feito: no `main` só existem o SQL da 0072 e os testes de banco.

O dono do produto quer apagar os dados de uma empresa, para recarregar do ERP, e manter:
- a empresa, o plano e as licenças;
- os usuários, os perfis e os parâmetros;
- os conectores.

Ele quer fazer isso pelo portal e pelo workflow `producao-limpar-cadastros.yml`, sem duas listas.

## Decisão
1. **A regra mora no banco.** A `plataforma.zerar_tenant(p_zerar)` (migração 0099) apaga numa transação.
   - **Conjunto**: toda tabela com `tenant_id` (pelo catálogo, como a `excluir_tenant` da 0032) menos a lista explícita da
     `plataforma.tabelas_mantidas_no_zerar()`. Três tabelas são parciais: `core.filial` (fica a padrão), `core.usuario_filial` e
     `plataforma.arquivo` (fica o avatar).
   - **Ordem**: por FK, com o laço da 0032 extraído para uma função comum.
   - **Classificação**: o teste de banco tem a lista das tabelas que saem, e uma tabela nova sem classificação derruba o teste.
   - **Chamadas**: o worker do portal chama a função direto, e o workflow pela `zerar_tenant_manual`.
2. **Backup antes = cópia no banco.** A mesma transação copia cada linha apagada (`to_jsonb`) e o "antes" das linhas mantidas que
   ela altera.
   - Os bytes das fotos e dos pacotes de sync só saem no expurgo.
   - A cópia e os bytes ficam 7 dias. Nesse prazo, o time desfaz pela `restaurar_zerar` (manual, só o dono do banco). Depois, o
     worker expurga.
   - O portal recusa acima de 2 milhões de linhas.
3. **Sem inativar antes.** Uma escrita concorrente derruba a transação por FK, e o worker tenta de novo até três vezes.
4. **Confirmação igual à do Excluir**: só o super-admin, com o código da empresa e a senha de novo.
   - A auditoria `tenant.zerado` leva o payload `plataforma.tenant.zerado@1`.
   - O evento fica fora da outbox, porque a outbox do tenant é apagada na mesma transação.
5. **Aparelhos e Hub recomeçam.**
   - `girar_geracao_base`: o aparelho limpa a cópia local e puxa tudo.
   - `cursor_entidade` e `registro_atual` vazios: o Conector reenvia desde o início.
   - A forma e o prazo padrão voltam (`vendedor.semear_pagamento`).

## Alternativas
- **Exigir um backup `pronto`, como a exclusão**: o botão ficaria sempre travado, porque nenhum worker gera backup hoje.
- **Fazer agora o worker do backup**: é o maior pedaço da ADR 0052 e não cabe na v1.0.30. Continua devido, com o worker da exclusão.
- **Lista de tabelas no TS do worker ou no YAML do workflow**:
  - seriam duas fontes;
  - a ordem de FK ficaria à mão;
  - o worker acessaria fora do banco as tabelas de todos os módulos (regra 1).
- **Lista do que sai, no lugar da lista do que fica**: uma tabela nova de dados ficaria esquecida. O teste de classificação cobre o
  risco contrário.

## Consequências
- **Espaço e retenção**: a cópia ocupa espaço no banco por 7 dias. Nesse prazo, os dados apagados continuam no banco, como no dump
  diário (RN-PLA-11).
- **Filiais de venda**: os usuários perdem as filiais de venda e passam todos à filial padrão. O BKO refaz depois da carga (RN-CORE-39).
- **Escrita offline**: a escrita pendente no aparelho que dependia de cadastro apagado volta com erro.
- **`excluir_tenant`**: é recriada chamando o laço comum, com a mesma assinatura e os testes da 0032.
- **Lista de `sa_*`**: muda, e por isso a migração e o teste dela vão juntos no PR conjunto de migração (`migracao-zerar`).
