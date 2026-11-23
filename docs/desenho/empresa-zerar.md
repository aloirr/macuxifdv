# Desenho — "Zerar dados" e "Reprocessar" da empresa no portal (v1.0.31)

- **Origem** (dono do produto, v1.0.31):
  - "coloque um botão ao lado do excluir chamado 'zerar dados'. vou clicar lá para zerar os dados";
  - "Na verdade, na integração dentro de config, deve ter uma opção de zerar os dados por entidade. acho que fica melhor. então alem do zerar tudo ao lado de excluir, crie o botão zerar dados ao lado de cada entidade no config. a tela do config deve ter a mesma aba Integração FDV que o BKO tem, mas com mais detalhes e tambem a opção de reprocessar e zerar dados".
- **Decisão**: ADR 0068 (proposta). **Contrato**: `packages/platform-sdk/src/empresa-zerar.ts`. **Base**: ADR 0052, ADR 0029 §5 e a rotina do PR #675 (`scripts/producao/limpar-cadastros-rotina.sql` no squash f2556d68, que saiu na §8).
- **Autor**: engenheiro-software. **Tarefa**: o gerente atribui o número. **Migração**: 0100.

## 1. Uma regra só, no banco
A regra do que sai mora numa função só: **`plataforma.limpar_cadastros(p_tenant uuid, p_lote text, p_entidades text[] default null, p_exigir_hub_parado boolean default true)`**, na migração 0100.
- O corpo é o da `pg_temp.macuxi_limpar_cadastros` do #675, promovido a função `SECURITY DEFINER`, com as mudanças da §4.1 e o parâmetro `p_entidades` (`null` = a empresa inteira, igual ao #675).
- Devolve `(r_ordem, r_tabela, r_modo, r_linhas)`: só nomes de tabela, o modo e contagens.
- Não abre nem fecha transação: quem chama decide entre COMMIT (gravar) e ROLLBACK (simular).

Quem chama:

| Quem | Como |
|---|---|
| Prévia do portal | `sa_previa_zerar` roda a função numa subtransação e desfaz (§3) |
| Worker do portal | `executar_zerar(id)` roda a função na transação do worker e confirma |
| Workflow `producao-limpar-cadastros.yml` | `select … from plataforma.limpar_cadastros(...)` no lugar da `pg_temp` (§8) |

Por que no banco:
1. A cascata vem do catálogo (FKs e nomes de coluna). Uma tabela nova com `tenant_id`, `id` e `deleted_at` entra sozinha.
2. A função lê as tabelas de todos os módulos numa transação. O TS do worker não pode (regra 1), e o workflow roda `psql` sem a API.
3. Duas cópias (a `pg_temp` do workflow e uma do portal) divergiriam na primeira mudança. A `rotina.sql` saiu (§8).

## 2. Cópia e volta: decisão
**Uma tabela de cópia só: `plataforma.limpeza_copia`**, criada pela 0100 com as **mesmas colunas e na mesma ordem** da `public.macuxi_limpeza_backup` do #675: `lote`, `tenant_id`, `tabela`, `modo`, `linha jsonb`, `copiado_em`.
- A mesma ordem mantém o arquivo `.copy` da VM compatível com `\copy plataforma.limpeza_copia from …`.
- A 0100 move para ela as linhas da `public.macuxi_limpeza_backup`, se a tabela existir (o workflow pode ter rodado antes da v1.0.31), e apaga a `public`.
- RLS ligado e forçado, só a política `manutencao`, nenhum grant. É exceção da regra 5, como as tabelas da 0072, e vai ao `docs/banco/rls.md`.
- Sai a `zerar_empresa_copia` da 0100 atual. Sai também a `zerar_empresa_objeto`: o zerar é soft delete, as fotos e os pacotes ficam no armazenamento como em qualquer linha apagada e não há bytes a remover.

**Volta**:
- `plataforma.restaurar_limpeza(p_tenant, p_lote)`: o corpo do `limpar-cadastros-restaurar.sql` do #675 promovido. Só o dono roda, pelo workflow (modo `restaurar`). Marca `desfeito_em` no zerar do portal com o mesmo lote.
- `plataforma.descartar_limpeza(p_tenant, p_lote)`: o `limpar-cadastros-descartar.sql` promovido.
- No portal, a cópia fica 7 dias (`RETENCAO_COPIA_ZERAR_DIAS`). Depois o worker a descarta (`expurgar_zerar`).
- Os lotes do workflow continuam com o descarte manual, como no #675.

**Lote**:
- formato `^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$` (`LOTE_LIMPEZA_FORMATO`);
- o workflow usa o carimbo UTC, como hoje;
- o portal usa o carimbo do pedido + `-` + os 8 primeiros dígitos do id do zerar. Fica no job e na resposta: é o que se passa ao `restaurar`.

## 3. Fluxo
```
Portal  GET  …/zerar/previa[?entidades=a,b] → sa_previa_zerar(sid, tenant, entidades)
          begin (subtransação) → limpar_cadastros(tenant, lote_simulado, entidades, false) → guarda o resultado → raise → rollback
          → PreviaZerarEmpresa (tabelas, total, entidades_afetadas, bloqueio)
Portal  POST …/zerar {id, codigo_confirmacao, senha, entidades?} → Zod → senha (sa_reautenticar) → sa_pedir_zerar(sid, tenant, id, codigo, entidades)
          → zerar_empresa em_andamento (lote) + auditoria tenant.zerar_pedido → 202 ZerarEmpresa
Worker  pegar_zerar() (skip locked, concessão de 10 min)
        BEGIN; statement_timeout 15min; lock_timeout 5s
        executar_zerar(id) → confere exclusão e backup → limpar_cadastros(tenant, lote, entidades, true)
          → soma soft + físico > LIMITE: 22023 ZERAR_VOLUME_ALTO · lote do Hub processando: 55000 ZERAR_HUB_PROCESSANDO
          → zerar_empresa concluido (contagem, entidades_afetadas, copia_expira_em) + auditoria tenant.zerado; COMMIT
        23503/40001/40P01/55P03 → ROLLBACK e nova tentativa (2 s, 5 s); na 3ª: fechar_zerar(id, ZERAR_CONCORRENCIA)
        hint ZERAR_HUB_PROCESSANDO | ZERAR_VOLUME_ALTO → fechar_zerar(id, <código>), sem nova tentativa
        outro erro → fechar_zerar(id, ZERAR_FALHOU)
Portal  GET  …/zerar → sa_ler_zerar(sid, tenant) a cada 5 s até concluido | falhou
Worker  (a cada hora) expurgar_zerar(20) → apaga a cópia dos concluídos vencidos, expurgado_em
Workflow psql (admin): plataforma.limpar_cadastros(tenant, lote, entidades, gravar) · restaurar_limpeza · descartar_limpeza
```
- Falha = nada muda (uma transação).
- A prévia é a mesma função desfeita, e por isso conta exatamente o que o worker vai fazer naquele instante.
- Na prévia, `p_exigir_hub_parado = false`, e a função não trava as tabelas do Hub (§4.1 d).

**Depois do zerar, o ERP reenvia.** O Conector só lê o cursor do Hub quando não tem estado local (`apps/conector/src/sincronizador.ts:54-60`). Zerar o cursor no Hub **não** faz o Conector reenviar. O reenvio é `conector carga-completa <entidade>` (ou `todas`) no servidor do cliente, ou a carga pela API. A tela do resultado mostra esse comando com as `entidades_afetadas`. O pedido remoto de carga completa está na §6.3, como proposta.

## 4. A regra
### 4.1 O que muda no corpo do #675 ao promover
- **a. Assinatura e segurança**:
  - a assinatura da §1;
  - `security definer`, com dono o migrador (o admin do DBaaS, o mesmo que roda o workflow);
  - `set search_path = pg_catalog, pg_temp`, e todo nome qualificado;
  - `revoke all … from public`, sem EXECUTE para nenhum papel da aplicação. Só as funções `SECURITY DEFINER` da 0100 (mesmo dono) e o admin chamam.
- **b. Lote**: o lote aceita o sufixo da §2.
- **c. Cópia**: vai para `plataforma.limpeza_copia`. Sai o `create table if not exists` de dentro da função.
- **d. Trava e Hub em processamento**:
  - o `lock table … share row exclusive` só acontece quando `p_exigir_hub_parado`;
  - "lote do Hub em processamento" sai com `errcode '55000'` e `hint 'ZERAR_HUB_PROCESSANDO'`;
  - entidade fora da lista sai com `22023`.
- **e. Rótulos**: as linhas extras do resumo levam o nome puro da tabela, e o `r_modo` diz o que foi feito (`MODOS_LIMPEZA`):

  | Tabela | Modo |
  |---|---|
  | `plataforma.evento` | `soft` |
  | `core.filial` | `filial` |
  | `plataforma.sync_pacote` | `sync_pacote` |
  | `plataforma.tenant` | `girar` |

  O workflow mostra a coluna `modo`.
- **f. O mapa das entidades**: fica numa função `plataforma.mapa_limpeza_entidades() returns jsonb` (imutável), lida pela `limpar_cadastros` e pela conta das `entidades_afetadas` (§4.3). As chaves são as 16 de `ENTIDADES_ZERAR` (SDK), e o teste de banco confere as duas listas.

### 4.2 Mapa entidade → raízes e Hub
As raízes são as linhas vivas do tenant **com `external_id`**, como no #675.

| Entidade | Raízes (domínio) |
|---|---|
| `filial` | nenhuma: `core.filial` fica e só perde o `external_id` (modo `filial`, como no #675) |
| `vendedor` | `core.usuario` não administrador (o mesmo predicado do #675, com ou sem `external_id`) |
| `catalogo_no` | `catalogo.catalogo_no` |
| `forma_pagamento` · `prazo_pagamento` · `transportadora` | `vendedor.forma_pagamento` · `vendedor.prazo_pagamento` · `vendedor.transportadora` |
| `produto` · `produto_unidade` | `core.produto` · `core.produto_unidade` |
| `preco` · `tabela_escalonada` | `catalogo.tabela_preco` · `catalogo.tabela_escalonada` |
| `estoque` | `catalogo.estoque_saldo` e `catalogo.deposito` |
| `cliente` · `cliente_endereco` | `core.cliente` · `core.cliente_endereco` |
| `rota` · `titulo` · `nota` | `core.rota` · `core.titulo` · `core.nota_erp` |

Hub da entidade (físico), de **toda entidade afetada** (as pedidas e as que caíram pela cascata, a lista `entidades_afetadas` da §4.3):
- linhas de `integracao.lote`, `sessao_carga`, `registro_atual`, `cursor_entidade`, `reconciliacao`, `coleta_execucao`, `pendencia_inativacao` e `inativacao_auditoria` com `entidade` na lista;
- `lote_staging`, `lote_linha_erro` e `sessao_carga_recebido` pelo `lote_id` ou `sessao_id` dessas linhas.

O banco-dados confere a coluna de cada tabela na 0097.

### 4.3 Inteira × por entidade

| | `p_entidades = null` (menu ⋯) | `p_entidades = [...]` (aba Integração) |
|---|---|---|
| Raízes | as do #675: as 11 tabelas do ERP, **todos os pedidos** e os usuários não administradores | só as das entidades pedidas (§4.2) |
| Cascata (FK, nome de coluna, `plataforma.arquivo`, posse × autoria) | a do #675 | a mesma, mais **"pedido inteiro"**: se um `vendedor.pedido_item` sai, o pedido dele sai também (e a cascata segue), para não sobrar pedido sem item |
| Hub (físico) | `c_hub` inteiro do tenant + filas pela cascata | o Hub de **toda entidade afetada** (§4.2): as pedidas e as que caíram pela cascata perdem lote, `registro_atual` e cursor. Sem isso, o reenvio delta da entidade dependente (ex.: título, nota e endereço ao zerar cliente) voltaria repetido ou "inalterado" |
| Derivados (`gestor.alerta`, `core.indicador_diario`, `gestor.projecao_fato`) | saem (#675) | só pela cascata |
| Filiais (`external_id` sai) | sim | só com `filial` na lista |
| Outbox não publicada | `integracao.%` e as de registro que sai | só as de registro que sai (os lotes que saem estão nele) |
| `sync_pacote` pronto → substituído e `girar_geracao_base` | sim | sim |

**`entidades_afetadas`**: as entidades cujas raízes do mapa tiveram linhas `soft` no resultado, mais as pedidas, na ordem de carga. Exemplo: zerar `cliente` derruba os endereços, os títulos e as notas, e a lista vira `cliente`, `cliente_endereco`, `titulo` e `nota`. A prévia e o job devolvem a lista, e a tela pede o reenvio de todas.

**Fica** (`c_fica` do #675):
- a empresa, o plano, as licenças, os administradores, os perfis e os parâmetros;
- os conectores, as credenciais, os mapeamentos e a auditoria.

## 5. Banco (0100, banco-dados): reaproveita × sai

| Da versão anterior da migração (08e779289) | Destino |
|---|---|
| `plataforma.zerar_empresa` (job, único parcial `em_andamento`, concessão, `tentativas`) | **fica**, com mudanças nas colunas e nos checks (ver abaixo) |
| `sa_previa_zerar`, `sa_pedir_zerar`, `sa_ler_zerar` | **ficam**, com assinatura nova (ver abaixo) |
| `pegar_zerar`, `fechar_zerar` | **ficam** iguais |
| `executar_zerar` | **fica**: chama `limpar_cadastros` (§3) e audita `tenant.zerado` (payload `plataforma.tenant.zerado@1`) |
| `zerar_bloqueado`, `zerar_empresa_json` | **ficam**, com o JSON novo |
| `zerar_empresa_copia`, `zerar_empresa_objeto`, `objetos_do_expurgo_zerar`, `fechar_expurgo_zerar` | **saem** (cópia única na §2; sem bytes) |
| `zerar_tenant`, `zerar_tenant_manual`, `restaurar_zerar`, `tabelas_mantidas_no_zerar`, `alvos_do_zerar`, `previa_do_zerar` | **saem**: a regra é a `limpar_cadastros`, a volta é a `restaurar_limpeza` |
| `tabelas_com_tenant`, `passos_em_ordem_fk`, `apagar_em_ordem_fk` e a `excluir_tenant` recriada | **saem**. A `excluir_tenant` fica como na 0032: o zerar não usa mais a ordem por FK (é soft), e mexer na exclusão sem necessidade é risco |
| Novas | `limpar_cadastros`, `mapa_limpeza_entidades`, `restaurar_limpeza`, `descartar_limpeza`, `expurgar_zerar(p_limite int) returns int` (EXECUTE só ao `macuxi_worker`) e a tabela `limpeza_copia` |

Mudanças na `zerar_empresa`:
- entram `lote text not null unique` (check do formato), `entidades text[] null` (check: não vazia, sem repetição, dentro das 16) e `entidades_afetadas text[] null`;
- `contagem jsonb` passa a ser a lista `LinhaLimpeza[]`;
- sai `origem`: o workflow não cria job.

Assinaturas novas das `sa_*`:
- `sa_previa_zerar(sid, tenant, entidades text[] default null)`;
- `sa_pedir_zerar(sid, tenant, id, codigo, entidades text[] default null)`:
  - não reconta;
  - confere exclusão, zerar, backup e Hub em processamento, nessa ordem (`conferirZerar`);
  - o mesmo `id` devolve o mesmo job;
  - grava o lote.

A lista de `sa_*` não muda de nome. Muda a assinatura de duas, e o PR conjunto `alexandre/migracao-zerar` continua valendo (teste da lista).

**Testes de banco** (`*.db.test.ts`, na sessão), com dois tenants:
- inteira = o comportamento do teste do #675 (`scripts/producao/teste/limpar-cadastros.teste.sh`), sem mexer no outro tenant;
- por entidade (`cliente`): clientes, endereços, títulos, notas e os pedidos deles saem; os produtos ficam; lote, `registro_atual` e cursor saem de `cliente` e de toda entidade derrubada pela cascata; o Hub de `produto` e de `rota` fica; `entidades_afetadas = {cliente, cliente_endereco, titulo, nota}`;
- `produto`: o pedido com item do produto sai inteiro;
- `filial` sozinha: só o `external_id` sai;
- a prévia não muda nada (o hash por tabela fica igual) e bate com a contagem do executar;
- `restaurar_limpeza` → contagem igual;
- `expurgar_zerar` só nos vencidos;
- o portal e o app sem acesso à `limpeza_copia`;
- as chaves do `mapa_limpeza_entidades()` = `ENTIDADES_ZERAR`;
- a constante de 2 milhões = `LIMITE_LINHAS_ZERAR`;
- recusas 55000 e 22023 com o `hint`.

## 6. API, worker, Reprocessar e a aba Integração
### 6.1 Zerar (engenheiro-software, feito nesta etapa sem a migração)
- `apps/api/src/empresa-zerar-portal.ts`:
  - a prévia aceita `?entidades=a,b` (`PreviaZerarQuerySchema`);
  - o POST aceita `entidades` (`PedirZerarEmpresaSchema`);
  - 409 também para `ZERAR_HUB_PROCESSANDO`.
- `apps/api/src/empresa-zerar-worker.ts`:
  - recusa no `hint` = fecha com o próprio código;
  - o expurgo virou uma chamada (`expurgar_zerar`), sem armazenamento.
- Testes: `apps/api/test/empresa-zerar-*.test.ts`, com a lista `ENTIDADES_ZERAR` = `ORDEM_CARGA_ENTIDADES` do Hub.

### 6.2 Reprocessar por entidade: decisão
**Reprocessar = o "Reprocessar" que o BKO já tem para a entidade (RN-INT-15)**: reenfileira, do mais antigo para o mais recente, os lotes da entidade com falha ou concluídos com avisos que ainda têm o conteúdo no staging.
- `modules/integracao/web/lib/reprocessar-lotes.ts` sobre `POST /v1/integracao/lotes/:id/reprocessar` (`bko-lotes-acoes.ts`), com a lista `reprocessaveis` de `web/lib/entidades.ts`.
- No portal, o super-admin entra pela ADR 0029 §5 (`superAdmin: 'aceita'` e cabeçalho `x-macuxi-tenant`). Vira o admin de fábrica do tenant, que tem `lote.reprocessar`, e não passa pela autorização por senha (RN-INT-16).
- Não há regra nem rota nova de servidor, nem cópia em SQL.

Por que não zerar o cursor:
- o Conector ignora o cursor do Hub enquanto tem estado local (§3), então zerar o cursor não faz nada aparecer;
- e o cursor do Hub fica fora de sincronia com o do Conector.

O reenvio completo de uma entidade é `conector carga-completa <entidade>`.

### 6.3 Proposta, fora da v1.0.31 (precisa de "backlog" do dono do produto)
"Pedir carga completa" pelo portal:
- a resposta do `POST /integracao/v1/sinal` ganha, de forma aditiva, `carga_completa: Entidade[]`;
- o Conector novo chama `reiniciarCargaCompleta` para cada entidade.

É contrato do Hub e uma versão nova do Conector.

### 6.4 Aba Integração da empresa no portal
A aba "Integração" do portal (`apps/web/components/portal/aba-integracao.tsx`) já existe, com conectores e credenciais. Ela ganha a seção **"Monitor"**, que reaproveita o monitor do BKO pelas rotas do módulo com `superAdmin: 'aceita'` (como `rotaLote` e `rotaErrosLote` já fazem).

Rotas que o modulo-integracao abre ao super-admin ou cria:

| Rota | O que muda |
|---|---|
| `GET /v1/integracao/monitor` (`rotaMonitor`) | + `superAdmin: 'aceita'` |
| `POST /v1/integracao/lotes/:id/reprocessar` | + `superAdmin: 'aceita'`; a auditoria grava `via: 'super_admin'` |
| `GET /v1/integracao/monitor/detalhes` (nova, `superAdmin: 'exige'`, contrato `MonitorDetalhes` em `modules/integracao/contracts`) | por entidade: cursor (`alterado_em`, `external_id`, `atualizado_em`), registros no `registro_atual`, último lote, erros por código (`lote_linha_erro` dos lotes recentes) e lotes reprocessáveis; por conector: versão, último sinal e o `sinal_resumo` (fila, entidades, atualização) |

Na tela, cada linha de entidade tem:
- **"Reprocessar"** (§6.2), com confirmação;
- **"Zerar dados"**: o mesmo diálogo do zerar inteiro, com `entidades: [e]`, prévia, código da empresa e senha.

As duas só para o super-admin. Em `GET /v1/integracao/*`, o admin do cliente que entra pelo portal não vê os botões, e a API recusa (`exigirSuperAdmin` no zerar; `superAdmin: 'exige'` nos detalhes).

## 7. Permissões e auditoria
- Só o super-admin, com a sessão do portal `config.`. No zerar (inteiro ou por entidade), também o código da empresa digitado e a senha de novo. O admin do cliente recebe 403 `PERFIL_SEM_ACESSO`.
- Auditoria em `plataforma.auditoria_plataforma`:
  - `tenant.zerar_pedido`, com `entidades`;
  - `tenant.zerado`, com o payload `plataforma.tenant.zerado@1`: `lote`, `entidades`, `linhas_apagadas`, `copia_expira_em`;
  - `tenant.zerar_falhou`;
  - `tenant.zerar_desfeito`, gravado pela `restaurar_limpeza` quando o lote é de um zerar do portal.
- O Reprocessar audita como hoje (`lote.reprocessar`).

## 8. Workflow depois do merge do #675 (engenheiro-software, feito)
- `scripts/producao/limpar-cadastros.sql` chama `plataforma.limpar_cadastros(:'tenant'::uuid, :'lote', string_to_array(nullif(:'entidades', ''), ','), :'gravar'::boolean)`. O "o que fica" e o resto continuam como estão.
- `.github/workflows/producao-limpar-cadastros.yml`:
  - entrada opcional `entidades` (lista por vírgula; `^[a-z_]+(,[a-z_]+)*$`), só no simular e no apagar; vazia = a empresa inteira;
  - o lote do `restaurar` e do `descartar` aceita o sufixo do portal.
- `montar-limpeza.sh`:
  - o modo `limpar` deixa de concatenar a rotina;
  - o modo `arquivo` lê a `plataforma.limpeza_copia`;
  - todos os modos conferem a 0100 (a `limpeza_copia` e as três funções) antes de ler a empresa.
- `limpar-cadastros-restaurar.sql` e `-descartar.sql` viraram uma chamada a `restaurar_limpeza` e `descartar_limpeza`.
- **`limpar-cadastros-rotina.sql` saiu.** O `teste/limpar-cadastros.teste.sh` migra até a 0100, chama as funções e confere o banco sem a 0100. O `scripts/ci/producao-limpar-cadastros.test.mjs` confere que nenhum roteiro escreve direto em tabela.

**Workflow × deploy: decisão.** A rotina sai do `main` agora, sem esperar o deploy da v1.0.31.
- O workflow roda só numa tag e usa os `scripts/producao` daquela tag.
- Tag anterior à v1.0.31: continua com a `pg_temp` dela.
- Tag v1.0.31 ou posterior num banco ainda sem a 0100: o `montar-limpeza.sh` para logo depois das entradas, com "o banco ainda não tem a migração 0100 (plataforma.limpar_cadastros): faça antes o deploy da v1.0.31 ou rode o workflow numa tag anterior (nada mudou)", saída 3, antes de abrir transação.
- Manter a rotina até o deploy deixaria duas cópias da regra no `main` (a `pg_temp` e a 0100). Elas divergiriam (§1, item 3), e o PR que a tirasse seria mais um passo a lembrar.

## 9. Códigos
`CODIGOS_ZERAR_EMPRESA`:
- 404: `TENANT_NAO_ENCONTRADO`, `ZERAR_NAO_ENCONTRADO`;
- 409: `ZERAR_EM_ANDAMENTO`, `EXCLUSAO_EM_ANDAMENTO`, `BACKUP_EM_ANDAMENTO`, `ZERAR_HUB_PROCESSANDO`;
- 422: `ZERAR_CODIGO_NAO_CONFERE`, `ZERAR_VOLUME_ALTO`;
- 403: `REAUTENTICACAO_FALHOU`.

Worker: `ZERAR_CONCORRENCIA`, `ZERAR_FALHOU`, e `ZERAR_HUB_PROCESSANDO` e `ZERAR_VOLUME_ALTO` no `erro_codigo`. O texto final é do designer-ux.

## 10. Regra nova (para o doc 03, pelo gerente)
**RN-PLA-12**: só o super-admin zera os dados de uma empresa, ativa ou inativa, inteira (menu ⋯) ou só algumas entidades do ERP (aba Integração). Ele vê antes o que sai e digita o código da empresa e a senha dele de novo.

A empresa inteira:
- saem os cadastros que vieram do ERP (com `external_id`), todos os pedidos, os usuários que não são administradores e tudo o que depende deles, em soft delete;
- sai também todo o Hub da empresa;
- ficam a empresa, o plano, as licenças, os administradores, os perfis, os parâmetros, os conectores e as credenciais;
- as filiais ficam e só perdem a chave do ERP.

Por entidade:
- saem os cadastros do ERP da entidade, o que depende deles (o pedido sai inteiro) e o Hub da entidade.

Nos dois casos:
- os aparelhos baixam a base de novo;
- a cópia das linhas fica 7 dias para o time desfazer;
- o ERP reenvia com a carga completa das entidades afetadas;
- o zerar é recusado com exclusão, zerar ou backup em andamento, com lote do Hub em processamento e acima de 2 milhões de linhas.

## 11. Quem faz o quê

| Dono | O que faz |
|---|---|
| **banco-dados** | Refaz a 0100 pela §5 (corpo do #675 promovido, §4), com os testes da §5, no PR conjunto `alexandre/migracao-zerar`; `docs/banco/plataforma.md` e `rls.md` |
| **engenheiro-software** | §6.1 (feito); §8 depois do merge do #675; linha do evento em `.coord/contratos/eventos.md`; revisão final |
| **modulo-integracao** | §6.4: `superAdmin: 'aceita'` em `rotaMonitor` e no reprocessar lote (com teste); a rota `monitor/detalhes` e o contrato `MonitorDetalhes`; em `modules/integracao/web`, as consultas do monitor recebem o cliente HTTP por parâmetro (o BKO passa `api`, o portal passa `chamarPortal` com o tenant), e o painel de entidades aceita ações extras por linha (`acoesDaEntidade?: (e) => ReactNode`) sem duplicar o componente |
| **engenheiro-apps** | Na aba Integração do portal, a seção "Monitor" com o painel do módulo, os detalhes e, por entidade, "Reprocessar" (`reprocessarLotes`) e "Zerar dados". O `dialogo-zerar` ganha a prop `entidades`, que leva a prévia e o POST. O resultado mostra o lote e "Rode `conector carga-completa <e>` para: …" com as `entidades_afetadas`. O modo falso do portal ganha as respostas novas. Item "Zerar dados" do menu ⋯ como está |
| **designer-ux** e **design-de-marca** | Textos e layout da seção Monitor e dos dois diálogos; validação da marca |
| **testes** | Roteiro na sessão: (1) zerar `cliente` → prévia = resultado, os produtos intactos, `entidades_afetadas`, `conector carga-completa cliente` recria; (2) zerar inteiro = o roteiro do #675; (3) reprocessar a entidade com 2 lotes com falha → os dois `recebido`, na ordem; (4) recusas 403 (admin do cliente), 409 (`ZERAR_HUB_PROCESSANDO`, em andamento) e 422; (5) `restaurar` pelo workflow com o lote do portal |
