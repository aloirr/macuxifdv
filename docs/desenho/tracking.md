# Rastreamento contínuo de localização (tracking) — desenho técnico (T-0156)

- **Autor**: engenheiro-software, 15/11/2026 (Manaus). **Decisão de arquitetura**: [ADR 0061](../decisoes/0061-rastreamento-continuo-de-localizacao.md).
- **Regras**: RF-CORE-17, RN-CORE-13 (localização e tracking), RN-CORE-37 (permissões), RN-CORE-46 (km do dia).
- **Base LGPD**: [finalidade](T-0156-legal-finalidade.md), [aviso](T-0156-legal-aviso-ao-vendedor.md) e [termo de ciência](T-0156-legal-termo-de-ciencia.md) (**rascunho para revisão de advogado**). Parte de
  [`T-0145-lgpd-tracking.md`](T-0145-lgpd-tracking.md), que segue como fonte do aviso curto da tela de permissões (§6 dele).
- **Consumidor já pronto**: a Performance lê só o resumo `core.deslocamento_dia` e usa `metrosDoTrajeto`
  ([performance-produtividade.md §5](performance-produtividade.md#5-km-e-o-rastreamento-de-localização)).
- Valores entre [colchetes] são parâmetros ajustáveis. As decisões de negócio do §12 foram aprovadas pelo Alexandre em 16/11/2026
  (R-20261116-110200-alexandre). Execução na v1.0.15.

## 1. O que já existe
| Peça | Onde | Estado |
|---|---|---|
| Permissão "Permitir o tempo todo" exigida no Campo a cada abertura | `apps/mobile/src/lib/permissoes.ts`, `app.config.ts` (`isAndroidBackgroundLocationEnabled` só no Campo) | pronto (RN-CORE-37) |
| GPS do momento no check-in e no checkout (`sem_gps` no evento) | Core, `contracts/eventos.ts` | pronto (RN-CORE-13); **não muda** |
| `expo-location` e `expo-task-manager` | `apps/mobile/package.json` | instalados; nenhuma tarefa de localização definida |
| Tarefa de segundo plano `macuxi-sync-delta` (WorkManager, ≥ 15 min) | `apps/mobile/src/services/segundo-plano.ts` (ADR 0017) | pronto; o tracking se apoia nela (§3.2) |
| `core.deslocamento_dia` (tabela, RLS, `DeslocamentoDiaSchema`, entidade de pull) | migração da T-0170, `modules/core/contracts` | vazia; quem escreve é esta tarefa |
| `metrosDoTrajeto` (haversine, precisão ≤ [50 m], salto ≤ [150 km/h]) | `modules/core/domain/performance/trajeto.ts` | pronto, com testes |

## 2. Quando o tracking grava (todas as condições)
O app grava ponto **só** quando todas valem; o servidor revalida as que dependem de cadastro (§5.2).

| # | Condição | Quem confere |
|---|---|---|
| 1 | A empresa ligou o tracking: `rastreamento.ativo = true` (padrão **desligado**) e publicou o termo (§6) | app e API |
| 2 | Usuário de campo (cargo vendedor ou promotor, ADR 0049), logado no app **Campo** | app e API |
| 3 | Aceite da **versão vigente** do termo de ciência (§6) | app e API |
| 4 | Dentro do **expediente** (§4.1), fora de feriado do calendário do tenant e fora de ausência cadastrada (§4.2) | app e API |
| 5 | Sem pausa pessoal em curso (§4.3) | app |
| 6 | Permissão "o tempo todo" concedida (RN-CORE-37) | app |

Faltou qualquer uma: o app **não grava nem guarda** ponto para mandar depois. Check-in e checkout seguem gravando o GPS do
momento, como hoje (RN-CORE-13).

## 3. Coleta no aparelho (Campo, Android)

### 3.1 Captura
- `Location.startLocationUpdatesAsync('macuxi-trajeto', …)` com **serviço em primeiro plano** (exigência do Android para localização
  em segundo plano; o tipo `location` do Android 14 vem do plugin do `expo-location`). Notificação fixa, sem ação:
  **"Macuxi Campo — localização ativa no expediente"**, canal próprio de baixa prioridade, sem som.
- Parâmetros: `accuracy: High`, `distanceInterval: [200 m]`, `timeInterval: [5 min]` (ponto de presença quando parado),
  `deferredUpdatesInterval: [5 min]` (o Android entrega em lote: menos despertares).
- Cada ponto: `id` (UUID do aparelho), `capturado_em` (UTC), `latitude` e `longitude` (6 casas), `precisao_m`, `velocidade_ms`
  (nula se o aparelho não der). Nada mais: sem endereço, altitude, rumo, rede, bateria ou apps.
- A tarefa `macuxi-trajeto` é definida no escopo global (como a `macuxi-sync-delta`), não toca em tela nem em estado de React, só
  grava no SQLite e **nunca derruba o processo** (o erro vai ao Diagnóstico, sem coordenada; padrão da T-0140).

### 3.2 Ligar e desligar
- **Liga** ao abrir o app, ao voltar ao primeiro plano e a cada passada da `macuxi-sync-delta`, se o §2 vale. Com o app fechado
  no início do expediente, o atraso é de até 15 min (intervalo mínimo do WorkManager); a próxima abertura liga na hora.
- **Desliga** pela própria tarefa, a cada lote: se o §2 deixou de valer (fim do expediente, pausa, logout, termo novo sem aceite,
  tracking desligado pela empresa), chama `stopLocationUpdatesAsync` e descarta o lote. A notificação some.
- Ponto do lote com `capturado_em` fora do expediente é descartado no aparelho (o lote do Android pode cruzar o fim).
- Função pura no domain do Core, a mesma no app e na API: `podeRastrear({ ativo, cargo, aceite, expediente, feriados, ausencias,
  pausa, instante, fuso })` → `{ pode: true } | { pode: false, motivo }`, com teste citando RN-CORE-13.

### 3.3 Bateria
- Meta: **≤ [8%] da bateria** num expediente de 10 h, medida no ensaio em 2 aparelhos de entrada (critério da implementação).
  Se passar, sobem `distanceInterval` e `deferredUpdatesInterval` pelos parâmetros, sem build novo.
- A tarefa de localização não usa rede: o envio vai na sincronização normal (§3.4), sem despertar a mais.

### 3.4 Offline e envio
- Tabela local `ponto_trajeto` (SQLite do usuário, o mesmo banco do motor de sync), entidade **só de envio** no motor, em lotes
  de [500] pontos, idempotente pelo `id`.
- Depois do envio confirmado, o aparelho guarda só os pontos **de hoje** (km parcial offline com `metrosDoTrajeto`) e apaga os demais.
- Ponto não enviado com mais de [90] dias é apagado no aparelho sem envio: a retenção vale também ali.
- Logout ou aparelho bloqueado: os bancos do usuário são apagados como hoje (`apagarBancosDoAparelho`); ponto não enviado se perde.
- O aceite do termo (§6) é gravado no aparelho e enviado **antes** dos pontos (ordem das entidades no push); funciona offline.

## 4. Expediente, feriados, ausências e pausa

### 4.1 Expediente
- Parâmetro do tenant `rastreamento.expediente`: por dia da semana, de 0 a 2 faixas `{ inicio, fim }` no **fuso do tenant**.
  Proposta: seg–sex 08:00–18:00, sáb 08:00–12:00, dom sem expediente.
- Sem expediente cadastrado, o tracking não liga, mesmo com `rastreamento.ativo`.
- Um expediente só por empresa (§12).

### 4.2 Feriados e ausências
- **Feriado**: o calendário do tenant (`core.calendario_metas@1`, que já devolve `feriados`) vale aqui: feriado = sem expediente.
- **Ausência** (férias, folga, afastamento): cadastro novo no BKO, por usuário, `{ usuario_id, de, ate }` (datas no fuso do tenant),
  feito pelo admin ou pelo supervisor da equipe, sem motivo (minimização). Chega ao aparelho do próprio usuário no pull.
- O termo promete que nada é registrado em folga, férias ou afastamento: **sem este cadastro, o tracking não liga em produção** (§10).

### 4.3 Pausa pessoal
Botão "Pausar localização" no Perfil do Campo: para por até [60] min ou até "Retomar". Registra só o início e o fim da pausa
(sem motivo) e envia junto dos pontos, para o gestor não ler o buraco do trajeto como falha.

## 5. Servidor (módulo Core)

### 5.1 Dados (pedido ao banco-dados)
| Tabela | Colunas próprias | Regras |
|---|---|---|
| `core.ponto_trajeto` | `usuario_id`, `aparelho_id`, `capturado_em`, `latitude numeric(9,6)`, `longitude numeric(9,6)`, `precisao_m`, `velocidade_ms` | campos comuns e RLS; índice `(tenant_id, usuario_id, capturado_em)`; expurgo por `delete` (não por `deleted_at`) depois de [90] dias; sem grant ao papel `macuxi_leitura` (ADR 0055) |
| `core.pausa_trajeto` | `usuario_id`, `inicio`, `fim` | campos comuns e RLS; retenção dos pontos |
| `core.ausencia_usuario` | `usuario_id`, `de`, `ate` | campos comuns e RLS; `de ≤ ate` |
| `core.termo_rastreamento` | `versao`, `texto`, `publicado_em`, `publicado_por` | único `(tenant_id, versao)`; vigente = maior versão publicada |
| `core.aceite_termo_rastreamento` | `usuario_id`, `termo_versao`, `aceito_em`, `aparelho_id` | único vivo `(tenant_id, usuario_id, termo_versao)` |
| `core.deslocamento_dia` | já existe | escrita por esta tarefa (§5.3) |

Volume estimado: ~150 pontos por usuário por dia × 100 usuários × 90 dias ≈ 1,4 milhão de linhas num tenant grande; sem partição na v1.

### 5.2 API (`/v1/core`; revalida tudo)
- **Push** de `ponto_trajeto` e `pausa_trajeto` pelo motor de sync (entidades só de envio). Cada ponto é descartado, sem gravar,
  se: o usuário não é de campo; não há aceite vigente com `aceito_em ≤ capturado_em`; o tracking estava desligado no instante;
  o instante cai fora do expediente, em feriado ou em ausência; `capturado_em` está mais de [5 min] no futuro ou mais de [90] dias
  atrás; ou a coordenada é inválida. Descarte não trava a fila: a resposta traz quantos foram aceitos e o aparelho apaga todos.
- **Push** de `aceite_termo_rastreamento` (idempotente; a versão tem de existir no tenant).
- **Consultas**: `GET /v1/core/trajeto?usuario_id&data` (pontos de um dia, até [90] dias atrás) e o pull de `deslocamento_dia`, que já
  existe. Contrato `core.trajeto_do_dia@1` para o Gestor (mapa da equipe), com o escopo conferido pelo Core.
- **BKO**: Parâmetros › Rastreamento (ligar, expediente, frequência), publicação do termo (o admin preenche a empresa e o contato do
  encarregado no modelo de [`T-0156-legal-termo-de-ciencia.md`](T-0156-legal-termo-de-ciencia.md)) e cadastro de ausências.

### 5.3 Resumo diário
- A cada push com pontos de `(usuário, data)` (data no fuso do tenant), o Core recalcula **o dia inteiro** com `metrosDoTrajeto` e
  faz upsert em `core.deslocamento_dia` (idempotente, `origem = 'rastreamento'`). Ponto atrasado de um dia passado recalcula aquele dia.
- Achado em aberto da T-0170 (baixa): um 1º ponto errado com boa precisão vira referência e derruba os seguintes como salto.
  Correção no domain: o 1º ponto só vira referência se o 2º for compatível com ele; se não for, o 1º sai (teste novo).

### 5.4 Expurgo
Job diário do worker: apaga `ponto_trajeto` e `pausa_trajeto` com mais de [90] dias e os aceites de usuários excluídos há mais
de [5] anos. O log leva só o tenant e a contagem.

## 6. Termo de ciência
- Texto-modelo: [`T-0156-legal-termo-de-ciencia.md`](T-0156-legal-termo-de-ciencia.md). A empresa publica a
  versão dela no BKO (§5.2); cada publicação cria uma versão nova.
- No Campo, depois do login e da carga, se o tracking está ligado e falta o aceite da versão vigente, abre a tela do termo com
  "Li e estou ciente". O app **segue usável** sem o aceite (o tracking não é condição para vender); só não grava trajeto.
  A tela volta a cada abertura até o aceite.
- Versão nova publicada: chega no pull e o tracking para até o novo aceite.

## 7. Quem vê (motor de permissões, ADR 0033)
| Ação | Chave | Padrão de fábrica |
|---|---|---|
| Ver o próprio trajeto ("Meu trajeto", Campo) | `core.trajeto.ver_proprio` | vendedor, promotor |
| Ver o trajeto da equipe (Gestão e BKO, só no escopo) | `core.trajeto.ver_equipe` | supervisor, gerente, admin |
| Ligar o tracking, expediente e termo | `core.rastreamento.configurar` | admin |
| Cadastrar ausência da equipe | `core.ausencia.cadastrar` | supervisor, gerente, admin |

- O administrativo (analista) vê só o resumo `deslocamento_dia` nos relatórios, nunca os pontos.
- Nenhum endpoint exporta pontos brutos; a exportação leva só o resumo.
- Vendedor e promotor nunca veem o trajeto de colegas.

## 8. Retenção
| Dado | Onde | Prazo |
|---|---|---|
| Pontos e pausas | servidor | [90] dias, depois apagados (§5.4) |
| Pontos | aparelho | os de hoje (enviados) ou até o envio; nunca mais de [90] dias |
| Resumo diário (km, pontos, 1º e último instante) | servidor e aparelho | [5] anos (metas e RV) |
| Aceite do termo | servidor | enquanto o usuário existir + [5] anos |

## 9. Privacidade técnica
- **Nenhuma coordenada** em log, mensagem de erro, Diagnóstico, Sentry ou telemetria: só id do usuário, contagem e tempo.
  O item G4 de `docs/seguranca/checklist.md` passa a cobrir o tracking do expediente, com prova por teste (pedido ao testes).
- O Diagnóstico do Perfil mostra só o estado ("ativa", "fora do expediente", "pausada", "sem termo") e a hora do último ponto.
- Nenhum provedor de mapa recebe o trajeto pelo servidor; o mapa do Gestão desenha os pontos no aparelho.
- Isolamento por tenant (RLS), como toda tabela.

## 10. Antes de ligar em produção
1. Revisão de advogado dos textos `T-0156-legal-*.md`, inclusive da base legal (§12).
2. Cadastro de ausências (§4.2) no ar.
3. Ensaio de bateria (§3.3) e de offline (3 dias sem rede, envio sem duplicar).
4. Teste "sem coordenada em log" verde no CI.
5. A empresa liga no BKO, publica o termo e os usuários aceitam.

## 11. Plano de execução (para o gerente)
| Ordem | Agente | Entrega | Depende de |
|---|---|---|---|
| 1 | banco-dados | tabelas do §5.1 (RLS, grants sem `macuxi_leitura`, espelho Drizzle, SQLite do aparelho) e o expurgo como função | ADR 0061 aceita |
| 2 | modulo-core | contratos (`PontoTrajeto`, `PausaTrajeto`, `AceiteTermoRastreamento`, `AusenciaUsuario`, `TermoRastreamento`, `core.trajeto_do_dia@1`), `podeRastrear`, correção do 1º ponto, push e consultas, resumo diário, BKO (parâmetros, termo, ausências), permissões do §7, "Meu trajeto" e a tela do termo no Campo | 1 |
| 3 | engenheiro-apps | tarefa `macuxi-trajeto`, ligar e desligar no shell (§3.2), notificação fixa e canal, Diagnóstico | 2 (contratos) |
| 4 | modulo-gestor | trajeto do dia no mapa da equipe (Gestão e BKO) pelo `core.trajeto_do_dia@1` | 2 |
| 5 | designer-ux e design-de-marca | tela do termo, "Meu trajeto", pausa e notificação | em paralelo a 2 |
| 6 | testes e corretor-redundancias | cada condição do §2 desliga sozinha, offline, multi-tenant, permissões do §7, sem coordenada em log, bateria | 2 a 5 |

## 12. Decisões
**Do Alexandre**, aprovadas em 16/11/2026 (R-20261116-110200-alexandre):
1. **Base legal**: legítimo interesse e execução do contrato, **sem** consentimento (o termo é de ciência), a confirmar com o advogado.
2. **Retenção**: pontos [90] dias; resumo [5] anos; aceite enquanto o usuário existir + [5] anos.
3. **Expediente**: um por empresa.
4. **Pausa pessoal** (§4.3): entra, com limite de [60] min.
5. **Ausências** (§4.2): cadastradas pelo admin e pelo supervisor.
6. **Representante autônomo**: só com o contrato de representação prevendo a comprovação de visita.
7. **Admin vê os pontos**: sim.

**Técnicas** (decididas pelo engenheiro, na ADR 0061, "Decisões técnicas"): frequência [200 m] / [5 min] com entrega em lote e
meta de bateria ≤ [8%], ajustáveis por parâmetro; lotes de envio de [500] pontos; sem partição na v1; correção do 1º ponto em
`metrosDoTrajeto`.
