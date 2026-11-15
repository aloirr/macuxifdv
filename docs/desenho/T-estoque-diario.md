# Estoque carregado uma vez por dia no aparelho e botão "Sincronizar" parcial ou completo — desenho

Origem: R-20261115-084000-alexandre, texto literal: "Estoque é algo carregado apenas uma vez no dia. Para não pesar no FDV."
Autor: engenheiro-software, 15/11/2026 (Manaus). Situação: **aprovada** pelo Alexandre (R-20261115-100000-alexandre) com as
decisões 1 a 4 abaixo; **ADR 0057** (`docs/decisoes/0057-estoque-diario-e-sincronizacao-parcial.md`). Parte A (SDK e motor) feita.

**Decisões do Alexandre (R-20261115-100000-alexandre):**
1. Carga diária às **06:00 no fuso do tenant** (`estoque_carga_hora`).
2. A busca online usa o **estoque do aparelho** (§4).
3. Aprovada a **opção (b)**: a reserva do pedido faturado continua descontada até a próxima carga (§3, modulo-vendedor).
4. **Botão "Sincronizar"**: toque normal atualiza **só pedidos e clientes** (sincronização parcial); **segurar 10 s** faz a
   sincronização **completa** (tudo de novo, estoque inclusive), a única exceção ao "uma vez por dia". Durante a completa, popup
   "Realizando a sincronização completa, aguarde e não saia dessa tela" com barra de progresso igual à da tela de carga (§9).
Base lida: branch `nuvem/catalogo-pacote-engenheiro-software` (4e6fc2d), com o pacote da 1ª carga (ADR 0054, `docs/desenho/T-catalogo-pacote.md`).

## 0. Como funciona hoje
- O estoque chega ao aparelho em duas entidades do Catálogo: `deposito` e `estoque_saldo` (`modules/catalogo/api/sync.ts`, escopo
  `tenant` filtrado pelas filiais da carteira, RN-CORE-39). Elas entram em toda sincronização: na completa, nas **novidades**
  (RN-CORE-23 item 4: ao abrir, ao voltar ao primeiro plano depois de 30 min e a cada `sync_auto_min`) e no push silencioso.
  Cada lote de estoque do ERP (`integracao.estoque.atualizado@1` → `criarConsumidorEstoqueDoErp`) muda `updated_at` e faz o aparelho
  puxar de novo.
- O "Atualizado às hh:mm" (RN-CAT-07, `modules/catalogo/app/lib/apresentacao.ts` → `rotuloEstoque`) mostra o `atualizado_em` de cada
  saldo (= `atualizado_erp_em`, a hora do ERP), e "Estoque desatualizado" depois de [`estoque_defasado_horas` = 24] h.
- O Novo pedido (`modules/vendedor/app/state/use-vendedor.ts`, `comEstoqueDaFilial`) mostra e valida offline o disponível da
  filial do cliente = saldo local − reservas locais (RN-VEN-20). A API **revalida** com o saldo atual do servidor
  (`modules/vendedor/api/receber.ts` → `faltaDeEstoqueNaFilial` → `catalogo.estoque_filial@1`) e rejeita com `RN-VEN-20`.

## 1. Quando acontece a carga diária
- **Gatilho:** a **primeira sincronização do dia que tiver sinal** (abrir o app, voltar ao primeiro plano, automática ou
  puxar para baixo; o toque no botão é a parcial e não leva estoque, §9), a partir da hora `estoque_carga_hora` [06:00] no **fuso do tenant**. Não há timer novo
  (RN-CORE-23 continua sem timer abaixo de 15 min); a carga vai junto da sincronização que já ia acontecer.
- **Regra (função pura):** `cargaDiariaDevida({ ultima, agora, fuso, hora })` = verdadeiro quando não houve carga ou quando a última
  aconteceu antes do instante "hoje às `hora`" no fuso do tenant e `agora` já passou desse instante. Antes da hora, vale a carga de
  ontem. A hora é parâmetro do tenant para casar com o lote noturno do ERP (ex.: ERP fecha às 5h → carga a partir das 6h).
- **O que é a carga:** o pull das entidades marcadas como diárias (`deposito` e `estoque_saldo`), a partir do cursor de cada uma, ou
  seja, só o que mudou desde ontem. Ela só conta como feita quando **todas** as diárias terminam; aí o motor grava
  `sync:carga_diaria_em` (ISO UTC, relógio do aparelho no fim da carga).
- **Fora da carga:** as novidades, o push silencioso, a sincronização padrão (`motor.sincronizar()` sem modo) e a parcial
  **pulam** as entidades diárias. Só a completa (segurar o botão 10 s, §9) força uma segunda carga no mesmo dia. O cursor de novidades continua andando
  normalmente: cada entidade tem cursor próprio, então o que for pulado chega na carga do dia seguinte (nada se perde).
- **Gestão:** a mesma regra vale no motor do Gestão (Aprovações mostra estoque).

## 2. Vendedor sem sinal no momento da carga
- O aparelho fica com o **estoque de ontem**; nada é apagado.
- "Atualizado às" passa a mostrar **a hora da última carga diária** (`carga_diaria_em`, no fuso do tenant), e não mais a hora do
  ERP de cada saldo. Se a carga não é de hoje, o texto leva o dia: "Atualizado ontem às 06:12" ou "Atualizado em 13/11 às 06:12"
  (texto final do designer-ux, parecer do corretor).
- "Estoque desatualizado" (RN-CAT-07) passa a contar a partir da carga: com a carga diária, 24 h deixa de servir (carga às 06:05
  ontem e às 07:00 hoje = 25 h, aviso no meio da manhã sem motivo). Proposta: **desatualizado = a última carga não é de hoje e a
  hora da carga de hoje já passou** (mesma função do §1), e o parâmetro `estoque_defasado_horas` sai do app (fica só no BKO, que lê o
  servidor).
- **Nova tentativa:** toda sincronização seguinte (sinal voltando, abrir o app, primeiro plano, puxar para baixo) reavalia `cargaDiariaDevida`;
  a primeira que conseguir faz a carga. Queda no meio = não grava `carga_diaria_em`; a próxima retoma do cursor de cada entidade
  (o que já entrou fica, a hora continua a de ontem até terminar).

## 3. Pedido, ruptura e validação no servidor (modulo-vendedor)
- **Servidor sem mudança:** a API continua revalidando RN-VEN-20 com o saldo **atual** do servidor (regra 2 do CLAUDE.md). O que o
  aparelho mostra é só ajuda; quem decide é a API.
- **Consequência:** durante o dia o app pode aceitar um item que a API rejeita (`422`, `codigo` RN-VEN-20, "Envie como orçamento ou
  reduza a quantidade"). O fluxo de rejeição já existe; vai acontecer mais.
- **Descompasso das reservas:** os pedidos continuam no sync contínuo. Quando um pedido é faturado no dia, a reserva sai (status
  muda no aparelho), mas o saldo do ERP que baixou só chega amanhã. Resultado: o app mostra **mais** disponível do que existe até a
  próxima carga. **Aprovada a opção (b)** (decisão 3): o app continua descontando a reserva do
  pedido faturado depois da `carga_diaria_em`, até a próxima carga (regra pura no `domain` do Vendedor, `reserva-filial.ts`,
  RN-VEN-20). A opção (a), só a API decidir, foi descartada.
- **"Risco de ruptura"** do popup do item (`modules/vendedor/app/lib/item-popup.ts`) e os alertas de estoque do pedido (RN-VEN-42)
  passam a refletir a carga do dia; sem mudança de código além do item (b).
- **`alerta_ruptura`** (ruptura registrada pelo promotor, `promotor.ruptura.registrada@1`) **não** é estoque do ERP: continua no
  sync contínuo. A ruptura do promotor (gôndola/depósito da loja) não muda.
- **Promotor sem preço/estoque** (RN-CAT-05): não recebe as entidades; nada muda.

## 4. Hub de integração e servidor
- O Hub continua recebendo estoque **a qualquer hora** (`integracao.estoque.atualizado@1`, RN-INT-02/04) e o consumidor do Catálogo
  grava em `catalogo.estoque_saldo` na hora. Servidor, BKO, `catalogo.estoque_filial@1` e a validação do pedido ficam sempre atuais.
- Nada muda no `modulo-integracao` nem no banco. Só a ida ao aparelho é diária.
- Online, a busca do catálogo (`GET /v1/catalogo/busca`) traz o estoque atual do servidor. Para o app não mostrar dois estoques
  diferentes na mesma manhã, proposta: **com a carga diária já feita, o app mostra o estoque local também nos resultados online**
  (o Catálogo troca a disponibilidade da resposta pela local); só na 1ª carga, com o catálogo ainda pendente (solução 5), mostra o da
  API com a hora do ERP. **Aprovado** (decisão 2).

## 5. Pacote da 1ª carga (solução 4) e entrar enquanto carrega (solução 5)
- **Solução 4:** `deposito` e `estoque_saldo` já estão na partição `catalogo · filial:<uuid>` do pacote. Na 1ª carga o pacote entra
  como hoje e o pull incremental de depois completa; no fim, o motor grava `carga_diaria_em` (a 1ª carga **é** a carga do dia).
  Nenhuma mudança no formato nem no gerador (ADR 0054). Fica como possibilidade futura um pacote só de estoque para a carga diária,
  se o ERP regravar o estoque inteiro toda noite (ver risco 1).
- **Solução 5:** a entrada continua liberada depois de "Clientes e rota"; o estoque segue na etapa "Catálogo e preços" (a última).
  Enquanto ela não termina, não há `carga_diaria_em`; a busca online mostra o estoque da API (§4).
- **Troca de geração** (ADR 0021): apaga `carga_diaria_em` junto com os cursores; a carga seguinte refaz tudo.

## 6. RN afetadas (texto final pelo gerente no doc 03; números conferidos em origin/main e em todos os branches em 15/11)
- **RN-CORE-23 (revista)**, item 1: toque no "Sincronizar" = sincronização **parcial** (envio da fila + pedidos e clientes);
  segurar 10 s = **completa** (tudo de novo, estoque inclusive, popup com progresso). Itens 3 e 4: push silencioso e novidades
  não trazem as entidades de carga diária. Item 5 (puxar para baixo) continua a sincronização padrão.
- **RN-CORE-61 (nova) Carga diária do estoque:** uma carga por dia, na primeira sincronização com sinal a partir de
  [`estoque_carga_hora` = 06:00] no fuso do tenant; antes da hora vale a de ontem; sem sinal fica a de ontem; queda no meio não
  conta; a completa do botão é a única segunda carga no mesmo dia. (Última em uso: RN-CORE-58, em branch; o gerente confirma.)
- **RN-CAT-07 (revista):** no app, "Atualizado às hh:mm" = hora da carga diária (`carga_diaria_em`, fuso do tenant; com o dia
  quando não é hoje); "Estoque desatualizado" = a carga de hoje já devia ter acontecido (passou da hora) e não aconteceu. Sem
  `carga_diaria_em` (app/motor antigo), vale a regra de hoje. No BKO continua a hora do ERP e as [24] h.
- **RN-VEN-20 (revista):** o app valida com o saldo da carga do dia e a API com o saldo atual (a API decide); no app, o pedido
  faturado depois da `carga_diaria_em` continua descontando a reserva até a próxima carga (opção b).
- **RN-CORE-48** e solução 5: sem mudança de ordem.
- Parâmetro novo na tabela do doc 03: `catalogo.estoque_carga_hora` [06:00] (`HH:MM`, 00:00–23:59).

## 7. Divisão por dono (caminhos exclusivos; números T-nnnn pelo gerente)
Contrato do SDK que as partes B–G usam (feito na parte A, `@macuxi/platform-sdk`, tudo aditivo):
- `DefinicaoEntidadeSync.cadencia?: 'continua' | 'diaria'` e `DefinicaoEntidadeSync.parcial?: boolean` (`definirEntidadeSync`).
- `OpcoesMotorSync.cargaDiariaDevida?: (ultima: string | null, agora: Date) => boolean` (se lançar, vale "devida").
- `EstadoMotorSync.carga_diaria_em?: string | null` (ISO UTC; persistido em `sync:carga_diaria_em`; nulo sem a função injetada).
- `motor.sincronizar({ modo?: ModoSincronizacao })`, `ModoSincronizacao = 'parcial' | 'completa'`; sem modo = a de sempre.
- Progresso da completa: o mesmo da carga inicial (`estado.carga` = `{ entidade, modulo, concluidas, total, paginas }` e
  `estado.progresso` 0..1, `estado.sincronizando`), `estado.erro` na falha.

| # | Dono | O que faz | Caminhos | Depende |
|---|---|---|---|---|
| A | engenheiro-software | **Feito.** Cadência, parcial, carga diária injetada, `carga_diaria_em`, modos `parcial`/`completa` (ressincronização forçada e retomável), troca de geração; ADR 0057; contrato em `.coord/contratos/modulos.md` | `packages/platform-sdk/src/{sync,motor-sync}.ts`, `motor-sync.diaria.test.ts`, `docs/decisoes/0057-*`, `.coord/contratos/modulos.md` | — |
| B | modulo-core | `cargaDiariaDevida({ ultima, agora, fuso, hora })` e `cargaDeHoje(...)` puras (RN-CORE-61); `parcial: true` nas entidades de clientes | `modules/core/domain/carga-diaria.ts` (+ teste), `modules/core/contracts/` (export), `modules/core/app/lib/entidades-cliente.ts` (+ teste) | A |
| C | modulo-catalogo | `cadencia: 'diaria'` em `deposito`/`estoque_saldo`; parâmetro `estoque_carga_hora`; "Atualizado às" e "desatualizado" pela `carga_diaria_em`; busca online com o estoque local (RN-CAT-07) | `modules/catalogo/contracts/**` (`entidades.ts`; `busca.ts` = `ParametrosCatalogo`), `modules/catalogo/domain/estoque.ts` (+ teste), `modules/catalogo/app/**` | A, B |
| D | modulo-vendedor | Opção (b) da reserva (RN-VEN-20); `parcial: true` nas entidades de pedidos | `modules/vendedor/domain/reserva-filial.ts` (+ teste), `modules/vendedor/app/state/use-vendedor.ts`, `modules/vendedor/contracts/entidades.ts` (+ teste) | A |
| E | engenheiro-apps | Injeta `cargaDiariaDevida` no motor; expõe `carga_diaria_em`; botão com toque = `parcial` e segurar 10 s = `completa`; popup com barra | `apps/mobile/src/services/motor-do-usuario.ts`, `apps/mobile/src/state/plataforma.tsx`, componente do botão e do popup no shell (+ testes) | A, B, F |
| F | designer-ux | Simulação do botão (toque/segurar) e do popup; textos "Atualizado ontem às…"/"em dd/mm às…" | `docs/design/**` | — |
| G | testes | Roteiro do §10 | `tests/**`, `docs/testes/**` | todas |

- **Sem tarefa:** modulo-integracao, banco-dados (sem schema novo), modulo-promotor, modulo-gestor (as entidades de pedido e
  cliente são do Vendedor e do Core; o Gestão herda pelo motor).
- **Gerente:** RN do §6 no doc 03 e quadro. **Corretor-redundancias:** textos do "Atualizado", do popup e do botão.
  **Design-de-marca:** popup e botão (layout novo).
- Tudo aditivo: app antigo continua no sync contínuo; servidor não muda.

## 8. Riscos (as perguntas foram respondidas pelas decisões 1 a 4)
1. **ERP que regrava tudo toda noite:** se o consumidor atualiza `updated_at` mesmo sem mudar a quantidade, a carga diária vira o
   estoque inteiro (dezenas de milhares de linhas, páginas de 1.000). Mitigação: o modulo-catalogo confere no consumidor e não toca
   linha com a mesma quantidade (só `atualizado_erp_em`, sem `updated_at`); se não bastar, pacote só de estoque (ADR 0054).
2. **Mais rejeições RN-VEN-20** ao enviar (estoque do app mais velho). Mitigação: opção (b), aprovada; mensagem de rejeição já existe.
3. **Relógio do aparelho errado** decide a carga: usar a hora do servidor da última resposta quando disponível (o motor já tem o
   horizonte); fica no teste G.
4. **Vendedor que abre antes da hora e não sincroniza mais** fica com o de ontem o dia inteiro; o "Atualizado ontem às…" deixa claro.
5. **Completa pesa:** tudo do zero (inclusive o estoque inteiro). É deliberada (segurar 10 s), mostra progresso e retoma se cair.

## 9. Botão "Sincronizar": parcial e completa (decisão 4)
- **Toque (parcial):** `motor.sincronizar({ modo: 'parcial' })` — envia a fila e puxa só as entidades `parcial` (pedidos e
  clientes), cada uma do seu cursor; sem etapas, sem novidades, sem estoque (nem quando a carga diária está devida: ela vai com a
  próxima sincronização automática). Grava "Última sincronização". Antes da primeira sincronização, faz a carga inicial; sem
  nenhuma entidade marcada (módulos antigos), faz a de sempre.
- **Segurar 10 s (completa):** `motor.sincronizar({ modo: 'completa' })` — tudo de novo: envia a fila, ressincroniza cada entidade
  desde o cursor nulo (no fim, sai do aparelho o que não veio), diárias inclusive, roda as etapas e grava `carga_diaria_em`. Com
  outra sincronização em curso, espera ela e roda depois. Queda no meio: nada é apagado; a próxima sincronização que puxar a
  entidade continua da página em curso e termina a limpeza.
- **Popup** durante a completa: "Realizando a sincronização completa, aguarde e não saia dessa tela", com a barra de progresso
  igual à da tela de carga (mesma fonte: `estado.carga`/`estado.progresso`); fecha no fim; na falha mostra o erro e o botão de
  tentar de novo (texto final do designer-ux). O toque curto não abre popup.
- **Puxar para baixo** continua a sincronização padrão (RN-CORE-23 item 5), sem modo.
- O shell atual faz `enviar({ incluirFalhos: true })` e `atualizarModulos()` antes de `sincronizar()`; vale para os dois modos.

## 10. Roteiro do testes (G)
Abre às 05:50 (estoque de ontem, "Atualizado ontem às…"), às 06:10 (carga), 2ª sincronização sem estoque, sem sinal na manhã,
queda no meio, pedido rejeitado RN-VEN-20, pedido faturado depois da carga (reserva continua, opção b), troca de geração; toque no
botão (só pedidos e clientes), segurar 10 s (popup, barra, estoque refeito, "Atualizado às" = agora), soltar antes de 10 s (parcial);
valor × regra com o BKO.
