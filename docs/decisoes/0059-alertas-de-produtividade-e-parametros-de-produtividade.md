# ADR 0059 — Alertas de produtividade no Gestor e parâmetro `alertas.produtividade` do Core

- **Status**: proposta em 2026-11-15 (branch `nuvem/T-0180-alertas-engenheiro-software`); revista no mesmo dia (rodada 2) com as
  decisões do gerente-projetos tomadas depois da rodada 1: ação `parametro.alertas_produtividade`, rota própria do `parado_min`,
  permanência mínima fora do Gestor na v1.0.13, tabela `core.usuario_contato` na 0085 e almoço descontado do "parado"; na rodada 5,
  `ctx.gravarParametros` (§8).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: T-0180 (v1.0.13), decisões D1 a D6 (R-20261115-123000 item 1 e R-20261115-120632, tomadas pelo gerente-projetos
  por delegação escrita do dono do produto). Desenho: `docs/desenho/T-0180.md`; proposta funcional do Gestor:
  `docs/modulos/gestor/alertas-produtividade.md` (branch `nuvem/T-0180-alertas-modulo-gestor`).
- **Quem implementa**: modulo-core (parâmetro, consulta, contato do aparelho), modulo-gestor (avaliação e chave), banco-dados
  (0085, com `core.usuario_contato`), engenheiro-software (gancho do contato no SDK e na API, `ctx.gravarParametros` da §8, esta
  ADR). A consulta da permanência
  no Promotor e a migração da cópia ficam para uma tarefa seguinte da esteira (§6).

## Contexto
- O Gestor passa a abrir dois alertas de produtividade da equipe (D4): `parado_entre_visitas` e `sem_checkin_inicio`. Os outros
  (rota incompleta, visita aberta, envio pendente, fim do almoço) são lembretes locais do Campo, sem servidor.
- O Campo (lembretes, offline) e o Gestor (alertas, servidor) usam os mesmos números (D1, D6). O "parado" (60 min) já existe no
  Core como `inicio.parado_min` (RN-CORE-26) e a Equipe agora o usa.
- O Gestor não lê tabela do Core (regra 1) e `ctx.parametros()` só entrega os parâmetros do próprio módulo.
- O índice `gestor.alerta_vivo_uk (tenant_id, chave)` garante um alerta vivo por chave.
- O app Gestão instalado (até a v1.0.12) valida `GET /v1/gestor/alertas` com `ListaAlertas` estrito (`tipo: z.enum(TIPOS_ALERTA)`,
  `modules/gestor/app/lib/cache.ts`): um item com tipo desconhecido faz a lista inteira cair em "Resposta do servidor em formato
  inesperado" e congelar.

## Decisão
1. **Tipos novos em `TIPOS_ALERTA`: aditivo, sem evento novo nem versão nova.** Nenhum evento carrega `TipoAlerta` (o Gestor não
   publica alerta; `.coord/contratos/eventos.md`). O enum só aparece nas respostas da API do Gestor (`/v1/gestor/alertas`,
   `alertas/:id/dispensar`, `alertas/regras`). Para não quebrar o Gestão instalado:
   - `AlertasQuery` ganha `produtividade?: '1'` (opcional). Sem ele, a API **omite** os alertas de `TIPOS_ALERTA_PRODUTIVIDADE`
     da lista; o Gestão v1.0.13+ e o BKO mandam `produtividade=1`. Quando não houver mais Gestão anterior à v1.0.13 em uso, o
     filtro vira padrão ligado numa revisão desta ADR (mesma versão de rota).
   - `alertas/regras` devolve só as 6 regras da equipe (`TIPOS_REGRA_EQUIPE`) e `PUT alertas/regras/:tipo` aceita só esses 6
     (`ParamsTipoAlerta` com `TIPOS_REGRA_EQUIPE`): os tipos de produtividade não têm linha em `gestor.alerta_regra` (o CHECK
     `alerta_regra_tipo_valido` da 0085 continua recusando) e o 422/400 sai antes do banco.
   - Daqui em diante, enum em resposta lida pelo app instalado é contrato: valor novo exige filtro por opção do cliente, como acima.
2. **`alertas.produtividade` do Core é a fonte única** dos lembretes do Campo e da avaliação do Gestor.
   - Guardado em `plataforma.parametro` (módulo `core`, chave `alertas.produtividade`), JSON validado pelo Zod
     `ParametrosAlertasProdutividadeSchema` de `@macuxi/core/contracts`, com `PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO` (D6). Chave
     ausente ou inválida = padrão (nunca 500).
   - Leitura e escrita pelas rotas do Core `GET|PUT /v1/core/parametros/alertas-produtividade`, com ação própria do Core
     `parametro.alertas_produtividade` (analista e admin). O nome não é `parametro.alertas`: o SDK não deixa a mesma ação em dois
     módulos. A escrita é idempotente (grava e audita só o que mudou, RN-AUD-01). O BKO do Gestor (Parâmetros › Alertas) chama
     essas rotas; o Gestor não grava parâmetro do Core.
   - O Campo lê pelo pull `parametro` do Core (a chave entra na lista do `onde` de `modules/core/api/sync.ts`).
   - O Gestor lê pela consulta `core.produtividade_equipe@1` (§4). O tipo espelhado em
     `modules/gestor/domain/produtividade-do-dia.ts` (adaptador temporário) sai e o Gestor importa o contrato do Core.
3. **D1: `inicio.parado_min` é o valor único do "parado".** Mesma chave e mesmo dono (Core); nenhuma migração. Sai do formulário
   de Parâmetros › Início e passa a ser editado em Parâmetros › Alertas. É gravado **só** pela rota própria
   `PUT /v1/core/parametros/parado-min` (mesma ação `parametro.alertas_produtividade`, idempotente e auditada), nunca dentro do JSON
   de `alertas.produtividade`; o PUT de Parâmetros › Início deixa de gravá-lo. A tela Parâmetros › Alertas lê o valor por
   `GET /v1/core/parametros/parado-min` (mesma ação; `{ parado_min }`, padrão 60). O campo continua editável com a regra desligada. O Gestor recebe o valor pela consulta (§4) e
   deixa de procurar `inicio.parado_min` nos próprios parâmetros (`modules/gestor/domain/parametros.ts`), onde ele nunca chega.
4. **Consulta `core.produtividade_equipe@1` (ADR 0012), dono Core, consumidor Gestor (`usaConsultas`).**
   - Entrada: `{ usuario_ids: uuid[] }` (1 a 500), estrita.
   - Saída: `{ parado_min, alertas: ParametrosAlertasProdutividade, usuarios: [{ id, ultimo_contato_em: InstanteUtc | null,
     almoco_inicio_min, almoco_fim_min }] }`. O almoço já vem resolvido (próprio ou `jornada.almoco_padrao`, D5); id que não
     existe ou é de outro tenant some (não é erro). Só leitura, na transação de quem consulta (RLS do tenant).
5. **Último contato do aparelho.** É o instante da última `GET /v1/sync/novidades` ou `POST /v1/sync/push` autenticada do
   usuário (o app chama o novidades em toda rodada de sincronização, com ou sem fila).
   - Plataforma (feito nesta ADR): `ModuloApi.contatoDoAparelho?(ctx)`, só core (`definirModuloApi` recusa nos outros); a API
     chama depois do novidades e do push, com o contexto do core do usuário, em melhor esforço (erro vira `warn` sem dado
     pessoal; a sincronização responde normalmente). O pull não conta (cada página seria uma escrita).
   - Core: grava na tabela própria `core.usuario_contato (tenant_id, usuario_id, contato_em, …)`, criada pela migração 0085 do
     banco-dados (b7af968) com RLS e as colunas obrigatórias, um registro por usuário (`usuario_contato_usuario_uk`), `insert … on conflict do update … where contato_em < excluded.contato_em - 1 min`
     (trava de frequência no SQL; idempotente). **Não** em `core.usuario`: o `updated_at` andaria a cada sincronização e todo
     aparelho puxaria o usuário de novo.
   - Gestor: só abre `parado_entre_visitas` com `ultimo_contato_em` posterior ao último checkout, e `sem_checkin_inicio` com
     `ultimo_contato_em` posterior ao horário `ate` do dia (não acusa quem trabalhou sem sinal e ainda não sincronizou).
   - Gestor: o tempo "parado" desconta o almoço cadastrado do usuário (`almoco_inicio_min`/`almoco_fim_min` da consulta), como o
     lembrete do Campo faz; a parte do intervalo entre o último checkout e agora que cai no almoço não conta para `parado_min`.
     Mesma regra nos dois lados: a conta fica numa função pura (RN-CORE-26) e o teste cobre intervalo antes, durante e depois do
     almoço.
6. **Permanência mínima (RN-PRO-07): um valor, um lugar, no Promotor.** A regra é do Promotor e ele já a lê de
   `plataforma.parametro` (módulo `promotor`, `permanencia_min_min`, indicadores e relatórios). O Gestor tem uma cópia
   (`gestor`/`permanencia_min_min`) para a "Visita curta"; gravá-la em Parâmetros › Alertas criaria dois valores que divergem.
   - **Na v1.0.13** a permanência sai do Gestor: o `PUT /v1/gestor/parametros/alertas` não a grava (o campo sai do contrato e da
     tela Parâmetros › Alertas). A linha `gestor`/`permanencia_min_min` existente fica como está até a tarefa seguinte.
   - **Tarefa seguinte da esteira** (fora da T-0180): o Promotor oferece `promotor.parametros_trade@1` (`configuracaoDoTenant: true`,
     saída com `permanencia_min_min`) e a rota de escrita com ação própria (analista e admin), idempotente e auditada; o Gestor a
     lê em `usaConsultasOpcionais` (sem Promotor não há "Visita curta") e tira `permanencia_min_min` de `ParametrosAlertasEquipe`
     e de `ParametrosGestor`; o banco-dados migra a cópia (`gestor` → `promotor` onde o Promotor não tem valor, soft delete da
     linha do Gestor).
7. **Um alerta de produtividade aberto por pessoa (D4).** Os dois tipos usam a MESMA chave: `produtividade:<usuario_id>`. Assim o
   `alerta_vivo_uk` garante no banco um vivo por pessoa, também com avaliações concorrentes. Em `reconciliarAlertas`, condição com a
   mesma chave e **tipo diferente** do vivo encerra o vivo (`condicao_normalizada`, motivo já existente; nenhum valor novo em
   `MOTIVOS_ENCERRAMENTO`) e abre o novo na mesma operação: o mais novo substitui o anterior, mesmo dispensado. O repositório já
   aplica encerrar antes de abrir na mesma transação (`modules/gestor/api/repositorio-postgres.ts`).

8. **O módulo grava os próprios parâmetros pelo SDK: `ctx.gravarParametros` (rodada 5; achado S0-014 do testes).** A primeira
   versão de `modules/gestor/api/parametros-alertas.ts` lia e gravava `plataforma.parametro` com SQL, o que fere a regra 1 (só a
   plataforma toca em `plataforma.*`). Decisão do gerente-projetos: o contexto de rota ganha a escrita, só do módulo da rota.
   - Assinatura (`packages/platform-sdk/src/api.ts`, `ContextoBase`):
     `gravarParametros?(valores: Readonly<Record<string, unknown>>, opcoes?: { acao?: string }): Promise<void>`. Opcional no
     tipo só para os contextos falsos dos testes; a API sempre preenche (`apps/api/src/parametros-modulo.ts`).
   - Grava com `modulo` = o módulo da rota e `tenant_id = plataforma.tenant_atual()` (RLS). Dentro de `ctx.comTenant` usa a
     MESMA transação (desfaz junto); fora dela abre a sua.
   - Idempotente: upsert que só muda a linha cujo `valor` mudou (`is distinct from` em `jsonb`); nada mudou = nenhuma escrita.
   - Auditada (RN-AUD-01): uma linha `entidade: 'parametro'`, `entidade_id: null`, `antes`/`depois` só das chaves que mudaram,
     ação `opcoes.acao` (ex.: `alerta_regra.gerenciar`) ou `parametro.gravar`. A rota não audita de novo.
   - Depois de gravar, o `ctx.parametros()` da mesma requisição já devolve os valores novos (as próximas requisições os leem do
     banco junto com as licenças, como sempre).
   - Recusa como erro de programação (500), antes de abrir transação (`problemasGravarParametros`, SDK): rota da plataforma,
     nenhuma chave ou mais de 50, chave fora do formato do banco (`^[a-z][a-z0-9_.]*$`), chave com prefixo de OUTRO módulo
     (`core.checkin.raio_m` vindo do Gestor) e valor que não vira JSON. A regra de negócio do valor (faixa, RN-GES-03) continua
     no `domain` do módulo, antes da chamada (422).
   - Leitura: o módulo lê os próprios parâmetros por `ctx.parametros()` (rota), `ContextoConsulta.parametros()` (consulta) e o
     contexto do consumidor e da tarefa; nunca por SQL em `plataforma.parametro`.
   - O Core, dono das tabelas de `plataforma` que administra, mantém por ora o SQL próprio dos parâmetros dele (promotor vê
     pedidos, produtos, metas); a migração dele para `ctx.gravarParametros` é opcional e fica para quando ele tocar nesses arquivos.

## Alternativas descartadas
- **Versão nova do contrato da lista (`/v2/gestor/alertas` ou `Alerta@2`)**: mais caro que o filtro opcional, e o enum não é
  evento.
- **Regras de produtividade em `gestor.alerta_regra`**: o Campo precisaria ler parâmetro do Gestor (módulo que o vendedor não
  tem) e os números se duplicariam.
- **Gestor lendo `plataforma.parametro` do módulo `core`**: fura a fronteira (cada módulo só lê os próprios parâmetros).
- **Gestor gravando `plataforma.parametro` por SQL, só no módulo `gestor`** (primeira versão): fura a regra 1 do mesmo jeito, e
  cada módulo repetiria o upsert, a comparação e a auditoria.
- **Consulta pública do Core para gravar parâmetros (`core.gravar_parametros`)**: consulta é só leitura (ADR 0012), e o
  parâmetro é da plataforma, não do Core.
- **Último contato em `core.usuario` ou `core.dispositivo.ultimo_acesso_em`**: o primeiro faz todo aparelho puxar o usuário de
  novo; o segundo é por aparelho, só muda no login e a sincronização não leva o id do aparelho.
- **Evento `core.aparelho.contato@1`**: um evento por rodada de sincronização de cada usuário, só para o Gestor ler o último.
- **Chave `<tipo>:<usuario_id>`**: deixa dois vivos por pessoa e o banco não garante a D4.

## Consequências
- O Gestão instalado (até a v1.0.12) continua lendo a lista de alertas; só não vê os de produtividade.
- O Gestor depende de `core.produtividade_equipe@1`; sem o PR do Core, os alertas de produtividade não são avaliados (o
  `produtividade` ausente desliga os dois tipos, como já está no domain).
- Uma escrita a mais por usuário e por minuto, no máximo, na sincronização (a trava fica no SQL do Core).
- Os alertas novos precisam da 0085 no banco (tipos novos e `core.usuario_contato`) antes do código do Core e do Gestor que os
  grava (ordem de merge: banco-dados, Core, Gestor).
- Até a tarefa seguinte da §6, a "Visita curta" do Gestor segue com a cópia `gestor`/`permanencia_min_min`, sem tela para editá-la.
