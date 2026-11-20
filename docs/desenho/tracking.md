# Rastreamento contínuo de localização (tracking) — desenho técnico (T-0156)

- **Autor**: engenheiro-software, 15/11/2026 (Manaus). **Decisão de arquitetura**: [ADR 0061](../decisoes/0061-rastreamento-continuo-de-localizacao.md).
- **Regras**: RF-CORE-17, RN-CORE-13 (localização e tracking), RN-CORE-37 (permissões), RN-CORE-46 (km do dia; proposta,
  [performance-produtividade.md §8](performance-produtividade.md#8-rn-propostas-texto-para-o-doc-03-numeração-a-confirmar-pelo-gerente)).
- **Finalidade e retenção**: [T-0156-legal-finalidade.md](T-0156-legal-finalidade.md).
- **Escopo e decisões**: na [ADR 0061](../decisoes/0061-rastreamento-continuo-de-localizacao.md), que é a fonte única (rastreamento interno, quem vê, quando liga).
- **Consumidor já pronto**: a Performance lê só o resumo `core.deslocamento_dia` e usa `metrosDoTrajeto`
  ([performance-produtividade.md §5](performance-produtividade.md#5-km-e-o-rastreamento-de-localização)).
- Valores entre [colchetes] são parâmetros ajustáveis.

## 1. O que já existe
| Peça | Onde | Estado |
|---|---|---|
| Permissão "Permitir o tempo todo" exigida no Campo a cada abertura | `apps/mobile/src/lib/permissoes.ts`, `app.config.ts` (`isAndroidBackgroundLocationEnabled` nas duas variantes; no Gestão a tela pede só ao supervisor (T-0187)) | pronto (RN-CORE-37) |
| GPS do momento no check-in e no checkout (`sem_gps` no evento) | Core, `contracts/eventos.ts` | pronto (RN-CORE-13); **não muda** |
| `expo-location` e `expo-task-manager` | `apps/mobile/package.json` | instalados |
| Tarefa de segundo plano `macuxi-sync-delta` (WorkManager, ≥ 15 min) | `apps/mobile/src/services/segundo-plano.ts` (ADR 0017) | pronto; o tracking se apoia nela (§3.2) |
| `core.deslocamento_dia` (tabela, RLS, `DeslocamentoDiaSchema`, entidade de pull) | migração da T-0170, `modules/core/contracts` | quem escreve é esta tarefa |
| `metrosDoTrajeto` (haversine, precisão ≤ [50 m], salto ≤ [150 km/h]) | `modules/core/domain/performance/trajeto.ts` | pronto, com testes |

## 2. Quando o tracking grava (portão)
Sete condições, todas obrigatórias, na função pura `podeRastrear` (domain do Core), a mesma no app e na API:

| # | Condição | Motivo quando falta |
|---|---|---|
| 1 | Parâmetro da empresa `rastreamento.ativo = true` (padrão **desligado**) | `desligado` |
| 2 | Cargo rastreado: vendedor, promotor ou supervisor; o gerente não (ADR 0049 e ADR 0063; `CARGOS_RASTREADOS`) | `cargo` |
| 3 | App do cargo: Campo para vendedor e promotor, Gestão para supervisor (ADR 0063; `APP_RASTREADO_DO_CARGO`; a API usa o app do cargo) | `app` |
| 4 | Fora de feriado do calendário do tenant | `feriado` |
| 5 | Fora de ausência cadastrada (§4.2) | `ausencia` |
| 6 | Dentro do **expediente** do tenant (§4.1) | `fora_do_expediente` |
| 7 | Permissão "o tempo todo" concedida no aparelho (RN-CORE-37; só o app confere, a API não recebe) | `sem_permissao` |

Faltou qualquer uma: o app **não grava nem guarda** ponto, e a API descarta o que chegar. Check-in e checkout seguem com o GPS
do momento (RN-CORE-13).

## 3. Coleta no aparelho (Campo, Android)

### 3.1 Captura
- `Location.startLocationUpdatesAsync('macuxi-trajeto', …)` com **serviço em primeiro plano** (exigência do Android para localização
  em segundo plano). Notificação fixa, sem ação, título **"Macuxi Campo ativo"**, sem citar localização, no canal `macuxi-servico`
  ("Serviço do app", spec do #492), de baixa prioridade e sem som.
- Parâmetros: `accuracy: High`, `distanceInterval: [200 m]`, `timeInterval: [5 min]`, `deferredUpdatesInterval: [5 min]`.
- Cada ponto: `id` (UUID do aparelho), `capturado_em` (UTC), `latitude` e `longitude` (6 casas), `precisao_m`, `velocidade_ms`
  (nula se o aparelho não der). Nada mais.
- A tarefa `macuxi-trajeto` é definida no escopo global, não toca em tela, só grava no SQLite e **nunca derruba o processo**
  (erro ao Diagnóstico, sem coordenada).

### 3.2 Ligar e desligar
- **Liga** ao abrir o app, ao voltar ao primeiro plano e a cada passada da `macuxi-sync-delta`, se o §2 vale.
- **Desliga** pela própria tarefa, a cada lote, quando o §2 deixa de valer (fim do expediente, ausência, logout, parâmetro
  desligado): `stopLocationUpdatesAsync` e descarte do lote. A notificação some.
- Ponto do lote com `capturado_em` fora do expediente é descartado no aparelho.
- `podeRastrear({ ativo, cargo, app, expediente, feriados, ausencias, permissao, instante, fuso })` → `{ pode: true } | { pode: false, motivo }`,
  no domain do Core, com as 7 condições do §2 e teste citando RN-CORE-13.

### 3.3 Bateria
- Meta: **≤ [8%] da bateria** num expediente de 10 h, medida no ensaio em 2 aparelhos de entrada. Se passar, sobem
  `distanceInterval` e `deferredUpdatesInterval` pelos parâmetros, sem build novo.
- A tarefa de localização não usa rede: o envio vai na sincronização normal (§3.4).

### 3.4 Offline e envio
- Tabela local `ponto_trajeto` (SQLite do usuário), entidade **só de envio** no motor de sync, em lotes de [500], idempotente pelo `id`.
- Depois do envio confirmado, o aparelho apaga os pontos. Nada do trajeto aparece no app do vendedor.
- Ponto não enviado com mais de [90] dias é apagado sem envio.
- Logout ou aparelho bloqueado: os bancos do usuário são apagados como hoje; ponto não enviado se perde.

## 4. Expediente, feriados e ausências

### 4.1 Expediente
- Parâmetro do tenant `rastreamento.expediente`: por dia da semana, de 0 a 2 faixas `{ inicio, fim }` no **fuso do tenant**.
  Padrão de fábrica: seg–sex 08:00–18:00, sáb 08:00–12:00, dom sem expediente.
- Sem expediente cadastrado, o tracking não liga.

### 4.2 Feriados e ausências
- **Feriado**: o calendário do tenant (`core.calendario_metas@1`) vale aqui: feriado = sem expediente.
- **Ausência** (férias, folga, afastamento): cadastro no BKO, por usuário, `{ usuario_id, de, ate }`, feito pelo admin ou pelo
  supervisor da equipe, sem motivo. Chega ao aparelho do usuário no pull, só para o portão; não aparece na tela dele.

## 5. Servidor (módulo Core)

### 5.1 Dados
| Tabela | Colunas próprias | Regras |
|---|---|---|
| `core.ponto_trajeto` | `usuario_id`, `aparelho_id`, `capturado_em`, `latitude numeric(9,6)`, `longitude numeric(9,6)`, `precisao_m`, `velocidade_ms` | campos comuns e RLS; índice `(tenant_id, usuario_id, capturado_em)`; expurgo por `delete` depois de [90] dias; sem grant ao `macuxi_leitura` (ADR 0055) |
| `core.ausencia_usuario` | `usuario_id`, `de`, `ate` | campos comuns e RLS; `de ≤ ate` |
| `core.deslocamento_dia` | já existe | escrita por esta tarefa (§5.3) |


### 5.2 API (`/v1/core`; revalida tudo)
- **Push** de `ponto_trajeto` pelo motor de sync. Cada ponto é descartado, sem gravar, se: o usuário não é de campo; o tracking
  estava desligado no instante; o instante cai fora do expediente, em feriado ou em ausência; `capturado_em` está mais de [5 min] no
  futuro ou mais de [90] dias atrás; ou a coordenada é inválida. Descarte não trava a fila.
- **Consultas**: `GET /v1/core/trajeto?usuario_id&data` (pontos de um dia, até [90] dias atrás), só com `trajeto.ver_equipe` e no
  escopo. Contrato `core.trajeto_do_dia@1` para o Gestor (mapa da equipe).
- **BKO**: Parâmetros › Rastreamento (ligar, expediente, frequência) e cadastro de ausências.

### 5.3 Resumo diário
- A cada push com pontos de `(usuário, data)`, o Core recalcula **o dia inteiro** com `metrosDoTrajeto` e faz upsert em
  `core.deslocamento_dia` (`origem = 'rastreamento'`).
- Correção no domain: o 1º ponto só vira referência se o 2º for compatível com ele (achado baixo da T-0170).

### 5.4 Expurgo
Job diário do worker: apaga `ponto_trajeto` com mais de [90] dias. O log leva só o tenant e a contagem.

## 6. Quem vê (motor de permissões, ADR 0033)
| Ação | Chave | Padrão de fábrica | Área |
|---|---|---|---|
| Ver o trajeto da equipe (Gestão e BKO, só no escopo) | `trajeto.ver_equipe` | supervisor, gerente | Usuários |
| Ligar o tracking e o expediente | `rastreamento.configurar` | admin | Administração |
| Cadastrar ausência da equipe | `ausencia.cadastrar` | supervisor, gerente, admin | Usuários |

- O admin configura, mas não vê os pontos, a menos que o perfil dele receba `trajeto.ver_equipe`.
- O analista vê só o resumo `deslocamento_dia` nos relatórios.
- Nenhum endpoint exporta pontos brutos.

## 7. Retenção
Prazos: [finalidade §5](T-0156-legal-finalidade.md#5-quem-vê-e-por-quanto-tempo). Servidor: §5.4. Aparelho: §3.4.

## 8. Privacidade técnica
- **Nenhuma coordenada** em log, mensagem de erro, Diagnóstico, Sentry ou telemetria. A API redige no pino as chaves de
  `CHAVES_COORDENADA` (`packages/platform-sdk/src/privacidade-localizacao.ts`); o shell e os módulos passam pelo `semCoordenadas`
  o que mandam ao Diagnóstico e ao envio de erro. Prova por teste (item G4 de `docs/seguranca/checklist.md`).
- O Diagnóstico guarda só o estado técnico da tarefa e a hora do último ponto, sem coordenada.
- Nenhum provedor de mapa recebe o trajeto pelo servidor; o mapa do Gestão desenha os pontos no aparelho.

## 9. Antes de ligar em produção
Quem decide ligar é o dono do produto, pelo parâmetro da empresa no BKO. Antes disso:
1. Cadastro de ausências (§4.2) no ar.
2. Ensaio de bateria (§3.3) e de offline (3 dias sem rede, envio sem duplicar).
3. Teste "sem coordenada em log" verde no CI.

## 10. Decisões
Do dono do produto e técnicas: [ADR 0061](../decisoes/0061-rastreamento-continuo-de-localizacao.md).
