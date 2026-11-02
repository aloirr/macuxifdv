# ADR 0017 — Sincronização em segundo plano (expo-background-task) e retomada da carga

- **Status**: proposta (2026-11-02; vira aceita com o OK do gerente na T-0059)
- **Data**: 2026-11-02
- **Tarefa**: T-0059 item 4 (teste de campo do Alexandre, R-20261102-090919 itens 1 a 3)
- **Autor**: engenheiro-software (motor) com o engenheiro-apps (shell)
- **Base**: ADR 0006/0009 (motor de sync, cursor `(updated_at, id)`, `versao_escopo`), desenho T-0008 (SQLite no aparelho),
  RN-CORE-15 (aparelho bloqueado)

## Contexto
No APK de preview, sair do app no meio da carga inicial e voltar fazia a carga recomeçar do zero. Duas causas:
1. **Motor**: nas entidades de escopo carteira (cliente, cliente_condicao, título…), a primeira passada ainda não tinha
   `versao_escopo` guardada (ela só é gravada no fim, para a ressincronização ser segura). Ao reabrir, a página trazia uma
   versão "nova" e o motor zerava o cursor — tudo de novo. As entidades sem versão já retomavam pelo cursor.
2. **Shell**: o Android encerra o processo em segundo plano; na volta a tela de carga disparava `sincronizar()` de novo e o
   progresso partia de 0.
O Alexandre pediu também uma decisão sobre sincronizar em segundo plano.

## Decisão
1. **Retomada no motor (feito, `packages/platform-sdk/src/motor-sync.ts`)**:
   - antes de cada página de uma ressincronização o motor grava `sync:ressinc:<entidade>` (`versao` + ids vistos; `null` na
     carga inicial, que não tem o que apagar). Ao reabrir com a mesma versão, continua do cursor gravado; no fim apaga o que
     saiu do escopo (os ids vistos antes da interrupção não se perdem) e remove o registro;
   - na **carga inicial** (sem `sincronizado_em`), `sincronizar()` grava `sync:carga` (entidades e etapas concluídas). Se a
     passada anterior foi interrompida há menos de 6 h (`VALIDADE_RETOMADA_MS`), a nova pula o que já foi concluído e o
     progresso começa do ponto salvo. Depois da carga não há registro: cada entidade já continua do seu cursor (delta);
   - `EstadoMotorSync.carga` (`entidade`, `modulo`, `concluidas`, `total`, `paginas`, `retomada`) dá à tela o módulo em
     andamento (frases sem nome técnico) e diz se é uma retomada. Teste com interrupção simulada por entidade e por página nos
     3 armazenamentos (`motor-sync.retomada.test.ts`).
2. **A carga inicial só roda com o app aberto.** O limite do Android (o processo em segundo plano é encerrado; trabalho em
   segundo plano tem janela de minutos) não comporta milhares de linhas; a tela de carga mostra "Mantenha o app aberto" e,
   se ele for fechado, a carga continua de onde parou na volta (item 1).
3. **Depois da carga, sincronização incremental em segundo plano com `expo-background-task`** (Expo SDK 57, WorkManager no
   Android; já inclui `expo-task-manager`), no shell (engenheiro-apps):
   - tarefa `macuxi-sync-delta`, `minimumInterval: 15` (minutos; o mínimo do WorkManager), só com rede; o sistema decide o
     momento exato (pode atrasar com bateria baixa ou modo econômico);
   - o que roda: `motor.carregar()` e `motor.sincronizar()` — envia a fila (pedidos, visitas, fotos) e puxa o **delta** de cada
     entidade pelo cursor. **Nunca** roda sem `sincronizado_em` gravado (carga inicial) nem com o aparelho bloqueado
     (RN-CORE-15), nem sem sessão válida (se a renovação do token falhar, não faz nada e o app pede login na próxima abertura);
   - orçamento de tempo: 60 s. Passou disso, a tarefa termina; o que já foi gravado vale (cursor por página) e a próxima
     execução continua;
   - exclusão mútua com o app aberto: a tarefa e a tela usam o mesmo motor quando o processo está vivo (chamadas simultâneas
     recebem a mesma promessa); com o app fechado, o processo da tarefa é o único. Um registro `sync:lease` (dono + expira em
     2 min) no armazenamento evita duas passadas se o sistema reabrir o app durante a tarefa;
   - sem notificação ao usuário; erros vão para o diagnóstico da tela de sincronização ("Última sincronização em segundo plano").
4. **iOS** fica fora (a v1 é Android). O `expo-background-task` funciona lá com regras próprias do sistema; reavaliar quando
   houver build iOS.

## Alternativas consideradas
- **Serviço em primeiro plano com notificação fixa** durante a carga inicial: permitiria baixar tudo com o app fechado, mas
  exige permissão e notificação permanente, e o Expo não oferece pronto. Rejeitada para a v1; a retomada resolve o caso real.
- **`expo-background-fetch`**: substituída pelo `expo-background-task` no Expo SDK 53+. Rejeitada.
- **Sem segundo plano**: o vendedor que passa o dia fora do app só envia pedidos quando abre o app. Rejeitada: o envio da
  fila em segundo plano encurta o caminho até a aprovação e o ERP.

## Consequências
- Dependência nova no `apps/mobile`: `expo-background-task` (nativa: exige build novo do EAS; entra junto com o próximo APK de
  preview, dentro do limite de 2 builds por dia).
- O motor não muda para o segundo plano: a mesma `sincronizar()` serve aos dois casos; o que muda é quem chama.
- `limparAparelho` (RN-CORE-15) apaga também `sync:ressinc:*` e `sync:carga`; a desativação de módulo (RN-CORE-02) apaga o
  `sync:ressinc:*` das entidades do módulo.
- Medir no APK de preview: tempo da carga inicial da base demo pelo túnel e a entidade mais pesada (pedido do Alexandre,
  item 4), e com que frequência real o Android roda a tarefa no aparelho de teste.
