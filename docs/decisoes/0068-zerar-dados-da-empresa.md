# ADR 0068 — "Zerar dados" da empresa, inteira ou por entidade: uma função no banco para o portal e o workflow

- **Status**: proposta. O número 0068 vale depois de reservado no `.coord/quadro.md` pelo gerente-projetos; está livre no `origin/main` 6b2cfd4 e sem reserva no quadro.
- **Data**: 2026-11-23 (Manaus)
- **Versão**: v1.0.30. Regra: RN-PLA-12 (nova). Desenho: `docs/desenho/empresa-zerar.md`. Contrato: `packages/platform-sdk/src/empresa-zerar.ts`.
- **Autor**: engenheiro-software
- **Origem**: pedidos do dono do produto na v1.0.30: o botão "zerar dados" ao lado de Excluir e, depois, "zerar dados" e "reprocessar" em cada entidade da aba Integração do portal, com mais detalhes que o monitor do BKO.

## Contexto
- O PR #675 (`alexandre/limpar-cadastros-am2808`) trouxe a limpeza de uma empresa pelo workflow `producao-limpar-cadastros.yml`, para o ERP reenviar tudo. A rotina dele (`scripts/producao/limpar-cadastros-rotina.sql`, `pg_temp.macuxi_limpar_cadastros`) faz:
  - soft delete no domínio e DELETE físico só no Hub e nas filas, cujos índices únicos não têm `deleted_at`;
  - raízes nos cadastros do ERP (com `external_id`), em todos os pedidos e nos usuários não administradores;
  - cascata por FK e por nome de coluna;
  - as filiais ficam e só perdem o `external_id`;
  - cópia de cada linha numa tabela, com restaurar e descartar.
- O texto dela diz que o botão da v1.0.30 deve usar o mesmo corpo.
- A primeira versão desta ADR tinha outra regra (DELETE físico de tudo o que tem `tenant_id`, menos uma lista de mantidas) e outra cópia. Ficariam duas regras para a mesma ação.
- A ADR 0052 pôs Inativar, Backup e Excluir no portal. O worker do backup (cifra, S3) não existe, e a exclusão nunca libera.

## Decisão
1. **Uma função**: `plataforma.limpar_cadastros(p_tenant, p_lote, p_entidades text[] default null, p_exigir_hub_parado default true)`, na migração 0099. É o corpo do #675 promovido a `SECURITY DEFINER`, sem EXECUTE para papel da aplicação.
   - A prévia do portal roda a função numa subtransação desfeita. O worker roda e confirma. O workflow passa a chamá-la, e a `rotina.sql` sai depois do merge do #675.
   - `p_entidades = null` é o comportamento do #675.
2. **Por entidade**: `p_entidades` traz uma ou mais das 16 entidades do Hub (`ENTIDADES_ZERAR` no SDK = `ORDEM_CARGA_ENTIDADES` do módulo, conferido em teste). O mapa entidade → raízes fica numa função do banco.
   - Saem as raízes da entidade, a cascata e o Hub dela (lotes, staging, erros, sessões, `registro_atual` e cursor).
   - Duas regras a mais. Um pedido com item que sai sai inteiro. O `registro_atual` das linhas dependentes também sai, para o reenvio não sair "inalterado".
   - A prévia e o resultado trazem as `entidades_afetadas`.
3. **Uma cópia**: `plataforma.limpeza_copia`, com as colunas da `public.macuxi_limpeza_backup` do #675, que a 0099 move e apaga.
   - A volta é `restaurar_limpeza` e `descartar_limpeza`, as mesmas do workflow.
   - No portal, a cópia fica 7 dias e o worker a descarta.
4. **Reaproveita da 0099 atual** o job `zerar_empresa`, as três `sa_*` (com `entidades`), `pegar_zerar`, `executar_zerar` e `fechar_zerar`.
   - **Sai**: `zerar_tenant` e as funções dele, a `zerar_empresa_copia`, a `zerar_empresa_objeto` e a extração do laço da 0032 (a `excluir_tenant` fica como está).
5. **Reprocessar** por entidade é o que o BKO já faz (RN-INT-15): os lotes da entidade com falha ou com avisos voltam à fila.
   - A rota e o monitor do módulo abrem ao super-admin pela ADR 0029 §5 (`superAdmin: 'aceita'`). Os detalhes a mais (cursor, erros por código, sinal do conector) vêm de uma rota nova do módulo, só do super-admin.
   - **Não zera o cursor**: o Conector só lê o cursor do Hub quando não tem estado local, e o reenvio completo é `conector carga-completa <entidade>`.
6. **Confirmação**: só o super-admin, com prévia, o código da empresa e a senha de novo. A auditoria `tenant.zerado` leva o payload `plataforma.tenant.zerado@1`.

## Alternativas
- **Manter a regra própria do portal** (DELETE físico de tudo menos as mantidas): seriam duas regras para a mesma ação. Ela também apagaria a auditoria do Hub e os usuários de um jeito diferente do workflow, que o dono do produto já usou.
- **Deixar a rotina em `scripts/` e o worker ler o mesmo texto**: o worker precisaria do arquivo em tempo de execução e de criar função temporária com o papel dele. A `SECURITY DEFINER` na migração é versionada com o schema.
- **Ficar com as duas cópias** (`zerar_empresa_copia` e `public.macuxi_limpeza_backup`): seriam dois restaurar. A tabela na `public`, sem RLS, criada de dentro da função, não fica.
- **Reprocessar = zerar o cursor da entidade**: não faz o Conector reenviar e deixa os cursores fora de sincronia.
- **Reprocessar = rota nova no servidor, ou `sa_*` em SQL**: duplicaria a regra do RN-INT-15, que já existe e roda no BKO.
- **Pedir a carga completa ao Conector pela resposta do sinal**: é o certo para depois. Muda o contrato do Hub e pede uma versão nova do Conector. Fica como proposta (desenho §6.3) e depende de "backlog" do dono do produto.

## Consequências
- **O ERP precisa reenviar**: o operador roda `conector carga-completa` para as `entidades_afetadas`. A tela mostra o comando.
- **Usuários**: no inteiro e na entidade `vendedor`, os usuários que não são administradores saem, como no #675. O ERP os recria sem senha, e o acesso volta pelo convite.
- **Linhas apagadas no banco**: o soft delete deixa as linhas no banco, e as fotos e os pacotes ficam no armazenamento, como em qualquer linha apagada.
- **Retenção**: a cópia fica 7 dias no banco (portal).
- **Workflow**: muda depois do merge do #675, na mesma tag da 0099.
- **`sa_*`**: a assinatura de duas muda. A migração e o teste da lista vão juntos no PR conjunto `alexandre/migracao-zerar`.
