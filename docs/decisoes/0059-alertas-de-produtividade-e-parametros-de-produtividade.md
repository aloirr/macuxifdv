# ADR 0059 — Alertas de produtividade no Gestor e parâmetro `alertas.produtividade` do Core

- **Status**: proposta em 2026-11-15 (branch `nuvem/T-0180-alertas-engenheiro-software`).
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: T-0180 (v1.0.13), decisões D1 a D6 (R-20261115-123000 item 1 e R-20261115-120632, tomadas pelo gerente-projetos
  por delegação escrita do dono do produto). Desenho: `docs/desenho/T-0180.md`; proposta funcional do Gestor:
  `docs/modulos/gestor/alertas-produtividade.md` (branch `nuvem/T-0180-alertas-modulo-gestor`).
- **Quem implementa**: modulo-core (parâmetro, consulta, contato do aparelho), modulo-gestor (avaliação e chave), banco-dados
  (0085 e a tabela do contato), modulo-promotor (permanência mínima, §6), engenheiro-software (gancho do contato no SDK e na API,
  esta ADR).

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
     `parametrosAlertasProdutividadeSchema` de `@macuxi/core/contracts`, com `PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO` (D6). Chave
     ausente ou inválida = padrão (nunca 500).
   - Escrita só pela rota do Core `PUT /v1/core/parametros/alertas-produtividade`, com ação própria do Core (`parametro.alertas`,
     analista e admin), idempotente (grava e audita só o que mudou, RN-AUD-01). O BKO do Gestor (Parâmetros › Alertas) chama essa
     rota; o Gestor não grava parâmetro do Core.
   - O Campo lê pelo pull `parametro` do Core (a chave entra na lista do `onde` de `modules/core/api/sync.ts`).
   - O Gestor lê pela consulta `core.produtividade_equipe@1` (§4). O tipo espelhado em
     `modules/gestor/domain/produtividade-do-dia.ts` (adaptador temporário) sai e o Gestor importa o contrato do Core.
3. **D1: `inicio.parado_min` é o valor único do "parado".** Mesma chave e mesmo dono (Core); nenhuma migração. Sai do formulário
   de Parâmetros › Início e passa a ser editado em Parâmetros › Alertas. Para uma tela, uma rota e uma auditoria, o corpo do
   `PUT /v1/core/parametros/alertas-produtividade` leva também `parado_min` e o Core o grava em `inicio.parado_min` (não no JSON
   de `alertas.produtividade`). O campo continua editável com a regra desligada. O Gestor recebe o valor pela consulta (§4) e
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
   - Core: grava numa tabela própria, `core.usuario_contato (tenant_id, usuario_id, contato_em, …)` com RLS e as colunas
     obrigatórias, um registro por usuário, `insert … on conflict do update … where contato_em < excluded.contato_em - 1 min`
     (trava de frequência no SQL; idempotente). **Não** em `core.usuario`: o `updated_at` andaria a cada sincronização e todo
     aparelho puxaria o usuário de novo.
   - Gestor: só abre `parado_entre_visitas` com `ultimo_contato_em` posterior ao último checkout, e `sem_checkin_inicio` com
     `ultimo_contato_em` posterior ao horário `ate` do dia (não acusa quem trabalhou sem sinal e ainda não sincronizou).
6. **Permanência mínima (RN-PRO-07): um valor, um lugar, no Promotor.** A regra é do Promotor e ele já a lê de
   `plataforma.parametro` (módulo `promotor`, `permanencia_min_min`, indicadores e relatórios). O Gestor tem uma cópia
   (`gestor`/`permanencia_min_min`) para a "Visita curta"; gravá-la em Parâmetros › Alertas criaria dois valores que divergem.
   - O Promotor oferece `promotor.parametros_trade@1` (`configuracaoDoTenant: true`, saída com `permanencia_min_min`) e a rota de
     escrita da permanência com ação própria (analista e admin), idempotente e auditada.
   - O Gestor lê pela consulta (`usaConsultasOpcionais`: sem Promotor não há "Visita curta"), tira `permanencia_min_min` de
     `ParametrosAlertasEquipe` e de `ParametrosGestor`, e a tela chama a rota do Promotor.
   - banco-dados: migração de dados que copia `gestor`/`permanencia_min_min` para `promotor` onde o Promotor não tem valor e
     apaga (soft delete) a linha do Gestor.
   - Até isso entrar, o `PUT /v1/gestor/parametros/alertas` **não** grava a permanência (o campo sai do contrato e da tela).
7. **Um alerta de produtividade aberto por pessoa (D4).** Os dois tipos usam a MESMA chave: `produtividade:<usuario_id>`. Assim o
   `alerta_vivo_uk` garante no banco um vivo por pessoa, também com avaliações concorrentes. Em `reconciliarAlertas`, condição com a
   mesma chave e **tipo diferente** do vivo encerra o vivo (`condicao_normalizada`, motivo já existente; nenhum valor novo em
   `MOTIVOS_ENCERRAMENTO`) e abre o novo na mesma operação: o mais novo substitui o anterior, mesmo dispensado. O repositório já
   aplica encerrar antes de abrir na mesma transação (`modules/gestor/api/repositorio-postgres.ts`).

## Alternativas descartadas
- **Versão nova do contrato da lista (`/v2/gestor/alertas` ou `Alerta@2`)**: mais caro que o filtro opcional, e o enum não é
  evento.
- **Regras de produtividade em `gestor.alerta_regra`**: o Campo precisaria ler parâmetro do Gestor (módulo que o vendedor não
  tem) e os números se duplicariam.
- **Gestor lendo `plataforma.parametro` do módulo `core`**: fura a fronteira (cada módulo só lê os próprios parâmetros).
- **Último contato em `core.usuario` ou `core.dispositivo.ultimo_acesso_em`**: o primeiro faz todo aparelho puxar o usuário de
  novo; o segundo é por aparelho, só muda no login e a sincronização não leva o id do aparelho.
- **Evento `core.aparelho.contato@1`**: um evento por rodada de sincronização de cada usuário, só para o Gestor ler o último.
- **Chave `<tipo>:<usuario_id>`**: deixa dois vivos por pessoa e o banco não garante a D4.

## Consequências
- O Gestão instalado (até a v1.0.12) continua lendo a lista de alertas; só não vê os de produtividade.
- O Gestor depende de `core.produtividade_equipe@1`; sem o PR do Core, os alertas de produtividade não são avaliados (o
  `produtividade` ausente desliga os dois tipos, como já está no domain).
- Uma escrita a mais por usuário e por minuto, no máximo, na sincronização (a trava fica no SQL do Core).
- Os alertas novos precisam da 0085 no banco antes do código do Gestor que os grava (ordem de merge: banco-dados, Core, Gestor).
