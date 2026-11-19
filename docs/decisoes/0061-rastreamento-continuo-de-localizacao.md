# ADR 0061 — Rastreamento contínuo de localização no expediente

- **Status**: **Aceita** em 2026-11-19. As 7 decisões de negócio do desenho §12 foram aprovadas pelo dono do produto em 16/11/2026
  (R-20261116-110200-alexandre). Execução na v1.0.15.
- **Data**: 2026-11-15 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: T-0156 (R-20261110-085951-alexandre, item 5); RF-CORE-17, RN-CORE-13, RN-CORE-37, RN-CORE-46 (proposta,
  `docs/desenho/performance-produtividade.md` §8).
- **Desenho**: [`docs/desenho/tracking.md`](../desenho/tracking.md). **Finalidade**: `docs/desenho/T-0156-legal-finalidade.md`.
- **Revisão**: 19/11/2026, decisão 6.
- **Quem implementa**: banco-dados, modulo-core, engenheiro-apps e modulo-gestor (T-0156).

## Contexto
- Desde 10/11/2026 o Campo exige a localização "o tempo todo" (RN-CORE-37), mas não grava trajeto: só o GPS do check-in e do
  checkout (RN-CORE-13).
- A Performance já espera o resumo `core.deslocamento_dia` e a função `metrosDoTrajeto` (T-0170); sem o tracking, os 2 cards de km
  ficam "sem dado".
- Localização contínua de quem trabalha é dado pessoal com alto risco de abuso (não é "dado sensível" no sentido do art. 5º, II,
  da LGPD): o desenho precisa provar minimização, limite de horário, retenção curta e acesso só da cadeia de gestão.

## Decisão
1. **Dono**: o módulo Core (rotas e visitas, carteira, km). O Gestor lê pelo contrato `core.trajeto_do_dia@1`; nenhum outro módulo
   lê as tabelas do trajeto.
2. **Portão de sete condições** (desenho §2), todas na mesma função pura `podeRastrear`, no app e na API: parâmetro da empresa
   ligado (padrão desligado), cargo de campo, app Campo, fora de feriado, fora de ausência, dentro do expediente e permissão do
   aparelho (só o app confere). Fora do portão o app não grava nem guarda ponto, e a API descarta o que chegar.
3. **Captura no Android** por `expo-location` com serviço em primeiro plano e notificação fixa "Macuxi Campo ativo", sem citar localização, no canal `macuxi-servico`
   (frequência em "Decisões técnicas"); a tarefa `macuxi-trajeto` só grava no SQLite, sem rede e sem derrubar o processo.
   Liga ao abrir, ao voltar ao primeiro plano e na `macuxi-sync-delta` (ADR 0017); desliga sozinha quando o portão fecha.
4. **Envio pelo motor de sync** como entidade só de envio (`ponto_trajeto`), em lotes, idempotente pelo UUID do aparelho. O app
   não mostra nada do trajeto (decisão 6).
5. **Resumo diário** recalculado do dia inteiro a cada push em `core.deslocamento_dia` (upsert idempotente). No fim do prazo
   (`docs/desenho/T-0156-legal-finalidade.md` §5), os pontos saem por `delete` físico num expurgo diário (exceção consciente ao
   `deleted_at`: a eliminação é obrigação da LGPD).
6. **Rastreamento interno** (dono do produto, recados das 05h45 e 05h46 de 19/11/2026): sem termo, aceite, pausa, "Meu trajeto"
   nem contestação; só supervisor e gerente veem, pela `trajeto.ver_equipe`; liga quando o dono do produto mandar, pelo parâmetro
   da empresa no BKO.
7. **Acesso** pelo motor de permissões (ADR 0033), ações do manifesto do Core: `trajeto.ver_equipe` (só no
   escopo), `rastreamento.configurar` e `ausencia.cadastrar`. Nenhuma exportação de pontos brutos; sem grant ao `macuxi_leitura`.
8. **Nenhuma coordenada em log**, erro, Diagnóstico ou telemetria, com prova por teste no CI. Contrato da plataforma:
   `privacidade-localizacao.ts` do platform-sdk (`semCoordenadas`, `textoSemCoordenadas`, `CAMINHOS_COORDENADA_LOG`, este já
   na redação do pino da API).

## Alternativas descartadas
- **Gravar o tempo todo e filtrar no servidor**: coleta além da finalidade e notificação fixa fora do expediente. Descartada.
- **Só a tarefa periódica (WorkManager) lendo a posição a cada 15 min**: não mede km nem permanência e o Android adia a tarefa.
- **Km estimado em linha reta entre check-ins**: rejeitado na T-0170 (fica de 20% a 40% abaixo do real).
- **Biblioteca paga de rastreamento** (ex.: transistorsoft): dependência pesada e licença por aparelho; o `expo-location` já
  instalado cobre a v1. Reavaliar se o ensaio de bateria falhar.
- **Mapa no servidor com provedor externo**: o trajeto sairia para um suboperador novo. O mapa desenha no aparelho.

## Decisões técnicas
- **Frequência e bateria**: `distanceInterval` [200 m], `timeInterval` [5 min], `deferredUpdatesInterval` [5 min], `accuracy: High`;
  meta ≤ [8%] da bateria em 10 h de expediente, medida no ensaio em 2 aparelhos de entrada. Ajuste por parâmetro, sem build.
- **Envio**: lotes de [500] pontos.
- **Volume**: sem partição na v1 (~1,4 milhão de linhas por tenant grande em 90 dias); reavaliar acima de 10 milhões.
- **Km**: em `metrosDoTrajeto`, o 1º ponto só vira referência se o 2º for compatível (achado baixo da T-0170).

## Consequências
- Tabelas novas no Core (desenho §5.1), 3 chaves de permissão novas, 1 entidade de sync só de envio, 1 contrato de consulta e
  1 job de expurgo; tudo aditivo, sem versão nova de contrato existente.
- Os cards de km da Performance passam a ter dado de quem é rastreado.
- Antes de ligar (decisão 6), o cadastro de ausências precisa estar no ar (desenho §9).
