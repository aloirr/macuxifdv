# Alertas: Parâmetros › Alertas e alertas de produtividade (PROPOSTA, sem código)

Pedido do Alexandre: R-20261115-112500 (15/11/2026, manhã, horário de Manaus). Alvo: v1.0.13 ou depois.
**Só proposta.** Nada muda no código, no banco nem nas telas até a aprovação. Simulação: `docs/design/alertas-parametros/` (designer-ux).
Donos: modulo-gestor (regras e alertas da equipe), modulo-core (horário de almoço, lembretes no aparelho, notificações), banco-dados (colunas novas), designer-ux (tela).

Decisões do recado, já aplicadas aqui:
1. "Regras de alerta" sai de Comunicação e vai para **Parâmetros › Alertas** (menu desenhado em `docs/design/menu-parametros/spec.md`, branch `nuvem/menu-parametros-designer-ux`). Todo campo vem **preenchido com o valor padrão**; nenhum campo vazio nem cinza sem explicação; o liga/desliga fica visível em cada regra; cada regra tem uma frase curta.
2. Alertas próprios (criados pela empresa): **não** entram agora nem no backlog.
3. Alertas de produtividade: esta proposta (seção 3), para aprovação antes de implementar.

## 1. O que muda na tela de regras que já existe

Hoje (`modules/gestor/web/pages/regras-page.tsx`): uma tabela com Limite, Janela (dias) e Amostra mínima. Em 3 das 6 regras os campos ficam vazios ou cinza, porque o valor vem de outro parâmetro (RN-GES-01, RN-GES-03, RN-PRO-07).

Proposta:
- Uma linha (cartão) por regra: **liga/desliga** à esquerda, nome, **frase curta**, os campos da regra com a unidade escrita, a severidade e o próprio Salvar (ativo só na regra alterada).
- Cada regra mostra **só os campos que ela usa**, com o nome do que o campo faz (nada de "Limite", "Janela" e "Amostra" genéricos).
- Quando o valor vem de um parâmetro do gestor (tolerância, carência, prazo da aprovação), o campo fica **na própria regra** e é editável ali. É um valor só, guardado num lugar só: a fila de aprovação lê o mesmo prazo.
- Regra desligada: os campos continuam com o valor e ficam só leitura. A linha mostra "Desligada"; ao religar, os valores voltam como estavam.
- Seção visível só com `alerta_regra.gerenciar` (analista e admin) e com o módulo de origem licenciado (RN-CORE-03). Sem Promotor, as 3 regras de trade não aparecem.

| Regra | Frase curta | Campos (padrão) | Severidade | Origem do valor |
|---|---|---|---|---|
| Cliente sem visita | Avisa quando o cliente passa do prazo de visita. | Tolerância sobre a frequência **50 %** · Cliente sem frequência **30 dias** · Carência do cliente novo **15 dias** | Atenção | `pct_tolerancia_frequencia`, `dias_sem_visita_padrao`, `dias_carencia_cliente_novo` (RN-GES-01/02) |
| Ritmo abaixo da meta | Avisa quando o vendedor está abaixo do ritmo da meta. | Ritmo mínimo **80 %** · A partir do dia útil **3** | Atenção | `limiar`, `amostra_min` |
| Pedido parado na aprovação | Avisa quando o pedido passa do prazo de aprovação. | Prazo **1 dia útil** | Crítica | `prazo_aprovacao_dias_uteis` (RN-GES-03; o mesmo da fila) |
| Ruptura recorrente | Avisa quando a loja repete ruptura em várias visitas. | **3** visitas com ruptura em **14 dias** | Atenção | `limiar`, `janela_dias` |
| Visita curta | Avisa quando o promotor fica menos que o mínimo na loja. | Permanência mínima **10 min** · Nos últimos **3 dias** | Informativa | `permanencia_min_min` (RN-PRO-07) e `janela_dias` |
| Fotos sem GPS | Avisa quando muitas fotos chegam sem localização. | Máximo **20 %** sem GPS · Em **7 dias** · Com pelo menos **10** fotos | Atenção | `limiar`, `janela_dias`, `amostra_min` |

Links antigos: `/regras-alerta` redireciona para `/parametros/alertas`. O item sai de Comunicação (ficam Alertas e Recados).

## 2. Regras gerais dos alertas de produtividade

Valem para todas as propostas da seção 3.
- **Dois destinos**, cada um com seu liga/desliga na mesma linha da regra:
  - **Vendedor/promotor:** lembrete com push **local**, agendado pelo próprio aparelho. Funciona sem sinal (seção 4).
  - **Gestor:** alerta na área **Alertas** do Gestão e do BKO (RN-VEN-42), calculado no servidor, no escopo do supervisor ou gerente. Sem push para o gestor (anti-spam; decisão D3).
- **Quando nunca dispara:** fora dos dias úteis do tenant, em feriado, fora do horário comercial do tenant, para usuário inativo, sem o módulo licenciado, com a regra desligada ou para quem não é de campo (vendedor e promotor).
- **Horários** no fuso do tenant; gravação e banco em UTC.
- **Teto do vendedor:** no máximo **4 lembretes de produtividade por dia** por pessoa. Passou do teto, o aparelho não agenda mais naquele dia. Ordem de prioridade: fim do almoço, sem visita há 1 h, rota do dia, visita aberta, envio pendente.
- **Gestor:** um alerta aberto por chave `<tipo>:<alvo_id>` (como hoje; nos alertas novos, um por pessoa e tipo). Ele se encerra sozinho quando a condição some (`condicao_normalizada`). Dispensado não reabre enquanto a condição persistir; se sumir e voltar, abre outro.
- **Sem dado pessoal em log.** O push leva só título e corpo curtos e o link da tela.
- **Texto:** só o problema e a ação (R-20261110-192153). Sem explicar o funcionamento.

## 3. Propostas

### 3a. Fim do almoço (pedido do Alexandre)
- **Gatilho:** **10 min** antes do fim do horário de almoço **cadastrado para o usuário**, num dia útil.
  - Só dispara se a pessoa já fez ao menos um check-in no dia. Quem não trabalhou não recebe.
  - Não dispara se ela está em visita (check-in aberto) ou se já fez check-in depois do início do almoço (voltou antes).
- **Destinatário:** vendedor e promotor. O gestor não recebe este lembrete. Atraso na volta do almoço aparece no 3b, que conta a partir do fim do almoço.
- **Horário:** fim do almoço − minutos de antecedência. Padrão: almoço 12:00–13:00, aviso às 12:50.
- **Texto (push):**
  - Título: "Seu almoço termina às 13:00".
  - Corpo: "Próxima visita: Mercado Bom Preço." Sem rota no dia, o push vai sem corpo.
  - Toque: abre a rota do dia.
- **Como desliga:** Parâmetros › Alertas › Fim do almoço (liga/desliga da empresa e "Avisar **10** min antes", de 5 a 30). Sem opção por pessoa (decisão D2).
- **Anti-spam:** um por dia por pessoa. Entra no teto de 4.
- **Offline:** todo no aparelho. O horário de almoço e os parâmetros chegam no sync. O app agenda a notificação local ao abrir, a cada sync e a cada check-in ou checkout, e cancela quando a condição deixa de valer.

#### Cadastro do horário de almoço (novo, dono: modulo-core; banco: banco-dados)
Hoje não existe. Existe só a **janela de detecção** do almoço da Produtividade (`produtividade.almoco_janela`, 11:00–15:00, RN-CORE-44), que serve para outra coisa: achar o intervalo nas visitas. Ela continua como está.
- **Padrão da empresa:** "Horário de almoço padrão" **12:00 às 13:00**, em Parâmetros › Calendário, ao lado da janela do almoço. Parâmetro novo do core, `jornada.almoco_padrao`.
- **Por usuário:** na ficha do usuário no BKO (Acesso › Usuários › gaveta do usuário), seção **Jornada**, campo "Horário de almoço".
  - Vem marcado **"Padrão da empresa (12:00 às 13:00)"**, já preenchido.
  - Desmarcado, abre os dois horários (início e fim) já preenchidos com o padrão, para ajustar.
  - Regras: fim maior que início; duração de 15 min a 3 h; dentro do horário comercial.
- **Banco:** `core.usuario.almoco_inicio_min` e `almoco_fim_min` (minutos do dia, `null` = padrão da empresa), com migração do banco-dados.
- **Sync:** os campos vão no pull do próprio usuário. A ação de editar é a do cadastro de usuários (`usuario.editar`), auditada (RN-AUD-01).
- **Importação:** coluna opcional "almoço" (`12:00-13:00`) no CSV da equipe (`docs/modulos/core/equipe-csv.md`). Vazia, fica o padrão da empresa.
- **Uso pela Produtividade (opcional, decisão D5):** a RN-CORE-44 pode passar a preferir o horário cadastrado à detecção pela janela. Fica fora desta proposta se o Alexandre não pedir.

### 3b. Há 1 h sem check-in/check-out (pedido do Alexandre)
- **Gatilho:** sem check-in aberto e **60 min** sem nenhum check-in nem checkout, contados a partir do **último checkout do dia** ou do **fim do almoço**, o que for mais recente.
  - Só depois do **primeiro check-in do dia**. Antes dele, quem cobre é o 3c-1.
  - Não conta o tempo dentro do horário de almoço cadastrado.
  - Só com paradas pendentes na rota do dia. Sem rota, vale para quem tem a regra "Sem rota também" ligada (padrão: ligada).
- **Destinatário:**
  - Vendedor ou promotor: lembrete no aparelho.
  - Supervisor ou gerente: alerta na lista, aberto **30 min depois** do lembrete do vendedor. Assim ele vê só quem continuou parado.
- **Horário:** dentro do horário comercial do tenant.
- **Texto:**
  - Vendedor (push): título "Há 1 h sem visita"; corpo "Próxima: Mercado Bom Preço."
  - Gestor (lista): "João Silva: sem visita há 1 h 30 min. Último checkout às 10:12."
- **Como desliga:** Parâmetros › Alertas › Sem visita, com:
  - "Avisar depois de **60** min" (15 a 480);
  - liga/desliga por destino (Vendedor, Gestor);
  - "Alertar o gestor **30** min depois".
- **Valor único (decisão D1):** é o mesmo número do "parado" da Equipe agora (`inicio.parado_min`, RN-CORE-26, padrão 60). Proposta: o campo **mora só aqui**, e a Equipe agora lê o mesmo valor. Ele sai de Parâmetros › Início, para não haver dois campos com o mesmo número.
- **Anti-spam:**
  - Vendedor: um lembrete por parada. Volta a armar só depois de um novo check-in. Máximo **2 por dia**, dentro do teto de 4.
  - Gestor: um alerta aberto por pessoa (chave `<tipo>:<usuario_id>`). Encerra sozinho no próximo check-in.
- **Offline:**
  - Vendedor: agendado no aparelho com as visitas locais, sem depender de sinal. Cada check-in ou checkout cancela e reagenda.
  - Gestor: o servidor só abre o alerta quando o **último contato do aparelho** é posterior ao início da parada. Isso evita acusar quem fez visita sem sinal e ainda não sincronizou. Precisa de um contrato novo do core com o último contato do aparelho (`core.aparelho.contato@1` ou campo no read-model, a desenhar pelo engenheiro-software).

### 3c. Outras (sugestões; o Alexandre escolhe quais ficam)
Premissa: o recado R-20261115-112500 não pôde ser lido nesta sessão (o repositório de recados está sem acesso aqui). As sugestões abaixo vêm do RF-GES-07 ("vendedor sem check-in até [10h]", "cliente da rota não visitado") e das lacunas do dia de campo. Se o recado trouxer outras, elas entram no lugar destas, no mesmo formato.

| # | Alerta | Gatilho | Destinatário | Horário (padrão) | Texto | Como desliga | Anti-spam | Offline |
|---|---|---|---|---|---|---|---|---|
| 3c-1 | Sem check-in no início do dia | Dia útil sem nenhum check-in até o horário | Vendedor: lembrete. Gestor: alerta | **10:00** (RF-GES-07) | Vendedor: "Nenhuma visita hoje. Primeira: Mercado Bom Preço." Gestor: "João Silva: sem check-in até 10:00." | Liga/desliga por destino; campo "Até as **10:00**" | 1 por dia; encerra no 1º check-in | Vendedor: local. Gestor: só com último contato do aparelho depois das 10:00 |
| 3c-2 | Rota do dia incompleta | Clientes da rota do dia ainda sem visita | Vendedor: lembrete às 16:00. Gestor: alerta no fim do expediente | **16:00** e **18:00** | Vendedor: "Faltam 3 clientes da rota hoje. Próximo: Mercado Bom Preço." Gestor: "João Silva: 3 clientes da rota sem visita hoje." | Liga/desliga por destino; os dois horários | 1 por dia por destino. O alerta do gestor encerra no dia seguinte (é do dia) | Vendedor: local com a rota baixada. Gestor: servidor, com a mesma condição de último contato |
| 3c-3 | Visita aberta há muito tempo | Check-in aberto há mais de **120 min** | Vendedor | Ao passar do limite | "Visita aberta há 2 h no Mercado Bom Preço. Faça o checkout ao sair." | Liga/desliga; campo "Depois de **120** min" (30 a 480) | 1 por visita | Local. O fechamento automático do servidor (RN-CORE-11) continua igual |
| 3c-4 | Envio pendente | Itens na fila sem enviar há mais de **4 h** (pedidos, visitas, fotos) | Vendedor: lembrete. Gestor: alerta | Ao passar do limite, no horário comercial | Vendedor: "3 registros sem enviar desde 10:00. Abra o app com internet." Gestor: "João Silva: aparelho sem sincronizar há 4 h." | Liga/desliga por destino; campo "Depois de **4** h" (1 a 12) | 1 por dia por destino | Vendedor: local (a fila é local). Gestor: pelo último contato do aparelho |

Não proposto, por já existir: "ritmo do dia baixo" (é o `ritmo_abaixo_meta`) e "visita curta do vendedor" (a `visita_curta` cobre o promotor; estender ao vendedor fica para outra decisão).

## 4. Offline, push e permissões
- **Lembrete ao vendedor = notificação local.**
  - O app agenda com o que já está no aparelho: rota, visitas, fila, horário de almoço e parâmetros do último sync. Não há envio do servidor.
  - Sem sinal funciona igual. Com o aparelho desligado na hora, o lembrete perde a hora e não sai atrasado.
  - Precisa da permissão de notificações (já obrigatória, RF-CORE-17) e do `expo-notifications` no build. O push remoto está pronto e desligado (`MACUXI_PUSH_ATIVO`, `modules/core/api/push.ts`); a notificação **local** não depende dele.
  - O lembrete também entra na central de notificações do app (RF-CORE-09) como aviso de sistema, sem duplicar no Início (uma informação, um lugar).
- **Alerta ao gestor = read-model do gestor**, nos tipos novos `parado_sem_visita`, `sem_checkin_inicio`, `rota_incompleta` e `aparelho_sem_sync`, avaliados por `avaliarAlertas`/`reconciliarAlertas` (seção 5 de `regras.md`).
  - Usa só eventos (`core.visita.checkin@1`, `core.visita.checkout@1`, rota do dia e o contrato novo de último contato), nunca tabela do core.
  - No Gestão offline, vale a última cópia sincronizada.
- **Permissões:** configurar = `alerta_regra.gerenciar` (analista e admin). Ver ou dispensar o alerta da equipe = escopo do supervisor ou gerente (`alerta_equipe.dispensar`). O horário de almoço é editado por quem edita usuários.
- **Multi-tenant:** parâmetros, regras e horários por `tenant_id`, com RLS. Nenhum valor de um tenant aparece em outro.

## 5. Como fica a página Parâmetros › Alertas
Duas seções, uma embaixo da outra, cada uma com os próprios Salvar por linha:
1. **Alertas da equipe:** as 6 regras da seção 1.
2. **Produtividade do dia:** 3a, 3b e as que o Alexandre aprovar do 3c. Cada linha tem:
   - liga/desliga geral;
   - os destinos (Vendedor e Gestor, cada um com o seu liga/desliga);
   - os campos com o padrão preenchido;
   - a frase curta.

Simulação: `docs/design/alertas-parametros/`.

## 6. Decisões para o Alexandre
- **D1.** O "parado" (60 min) mora só em Parâmetros › Alertas › Sem visita e a Equipe agora lê o mesmo valor? Proposta: sim. Alternativa: dois números independentes.
- **D2.** O vendedor pode silenciar os lembretes no próprio app? Proposta: não; só a empresa liga ou desliga.
- **D3.** O gestor recebe push dos alertas de produtividade? Proposta: não, só a lista de Alertas (anti-spam). Alternativa: push só no 3b.
- **D4.** Quais do 3c entram (3c-1 a 3c-4)?
- **D5.** Horário de almoço por pessoa (proposta) ou só o padrão da empresa? A Produtividade (RN-CORE-44) passa a usar o horário cadastrado?
- **D6.** Padrões: almoço 12:00–13:00, aviso 10 min antes, parado 60 min, gestor +30 min, início do dia 10:00, rota 16:00/18:00, visita aberta 120 min, envio pendente 4 h, teto de 4 lembretes por dia.

## 7. Depois da aprovação (ordem padrão)
1. engenheiro-software: contratos (tipos de alerta novos, último contato do aparelho, parâmetros dos lembretes) e ADR, se mudar o `TipoAlerta`.
2. banco-dados: colunas do almoço, parâmetros e migração.
3. Implementação:
   - modulo-core: cadastro do almoço, agendador local, central;
   - modulo-gestor: regras, avaliação e tela de Parâmetros › Alertas;
   - designer-ux: revisão.
4. testes: incluir offline, multi-tenant, licença e perfil.
5. corretor-redundancias e design-de-marca.
6. Revisão final do engenheiro-software.
