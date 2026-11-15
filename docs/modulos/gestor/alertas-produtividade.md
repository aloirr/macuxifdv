# Alertas: Parâmetros › Alertas e alertas de produtividade (APROVADO, T-0180, v1.0.13)

Pedido do Alexandre: R-20261115-112500 (15/11/2026, manhã, horário de Manaus). Aprovado pelo gerente-projetos, com autorização escrita do dono do produto (R-20261115-123000 e R-20261115-120632).
Donos: modulo-gestor (regras da equipe e alertas ao gestor), modulo-core (almoço, parâmetro `alertas.produtividade`, lembretes no aparelho, consulta `core.produtividade_equipe@1`), modulo-promotor (permanência mínima), designer-ux (tela).

**Onde está cada coisa (uma informação, um lugar):**
- O que cada tela mostra (nomes, frases, campos, estados, textos dos lembretes): `docs/design/alertas-parametros/spec.md`.
- Lembretes do aparelho (gatilhos, teto, prioridade, cadência): `docs/modulos/core/jornada-e-alertas-produtividade.md`.
- Tipos de alerta, chave, parâmetro do Core e último contato do aparelho: ADR 0059 e `docs/desenho/T-0180.md`.
- Este documento guarda só o que é do Gestor: as decisões, o que o servidor avalia e como o código se organiza.

## 1. Parâmetros › Alertas (BKO)
- Página `/parametros/alertas`, só com `alerta_regra.gerenciar` (analista e admin); sem o Promotor, as 3 regras de trade somem (RN-CORE-03).
- **Alertas da equipe:** as 6 regras (`TIPOS_REGRA_EQUIPE`), cada uma com liga/desliga, frase, só os campos que usa e o próprio Salvar. Os valores que moram em parâmetros do tenant (tolerância, sem frequência, carência, prazo da aprovação: RN-GES-01/02/03) ficam na própria regra, editáveis ali: um valor, um lugar.
- **Permanência mínima (RN-PRO-07) não se edita aqui.** O valor é do Promotor; "Visita curta" mostra só a janela. O campo volta quando o Promotor oferecer a consulta e a rota de escrita (ADR 0059 §6; tarefa seguinte).
- **Produtividade do dia:** 6 regras e o teto de lembretes, no formato do parâmetro `alertas.produtividade` do Core (`PUT /v1/core/parametros/alertas-produtividade`). Padrões e faixas vêm do contrato do Core. Destinos (Vendedor e Gestor) só no Parado e no Sem check-in.
- O "parado" (`inicio.parado_min`, RN-CORE-26) é gravado por `PUT /v1/core/parametros/parado-min` e continua editável com a regra desligada (D1).

## 2. O que o servidor avalia (alerta ao gestor)
Só dois tipos, no escopo do supervisor ou gerente, sem push (D3):
- **`parado_entre_visitas`:** sem visita aberta e `parado_min` + `gestor_depois_min` desde o último checkout. O Parado ao gestor vale com ou sem rota.
- **`sem_checkin_inicio`:** dia útil, depois do horário `ate_min`, sem nenhum check-in.
- Só em dia útil, dentro do horário comercial do tenant, para vendedor e promotor ativos, com a regra e o destino Gestor ligados.
- **Último contato do aparelho (ADR 0059 §5):** a API chama `core.produtividade_equipe@1` e só abre o alerta se o último contato for posterior ao início da parada (último checkout, ou o horário `ate_min`). Sem contato, não abre: não acusa quem trabalhou sem sinal.
- **Um alerta por pessoa (D4):** os dois tipos usam a chave `produtividade:<usuario_id>`; o mais novo substitui o vivo (`condicao_normalizada`), mesmo dispensado. Encerra sozinho quando a condição some.
- **Compatibilidade:** `GET /v1/gestor/alertas` só traz esses tipos com `?produtividade=1` (o Gestão novo e o BKO pedem); sem ele, a lista os omite para o Gestão instalado não rejeitar o tipo novo.
- Textos: tipo "Parado", mensagem "João Silva: último checkout às 10:12."; tipo "Sem check-in", mensagem só o nome.

Rota incompleta, visita aberta, envio pendente e fim do almoço são lembretes do Campo (notificação local, só na bandeja do Android); não geram alerta ao gestor.

## 3. Decisões (tomadas, T-0180)
- **D1.** O "parado" (60 min) é o `inicio.parado_min` do Core: um valor num lugar só; sai de Parâmetros › Início; a Equipe agora lê o mesmo valor. Editável mesmo com a regra desligada.
- **D2.** Sem silenciar no app; só a empresa liga e desliga.
- **D3.** Sem push ao gestor; só a lista de Alertas (Gestão e BKO).
- **D4.** No servidor entram só `parado_entre_visitas` e `sem_checkin_inicio`; um alerta de produtividade aberto por pessoa, o mais novo substitui.
- **D5.** Almoço por pessoa com o padrão da empresa (modulo-core).
- **D6.** Padrões: almoço 12:00–13:00, aviso 10 min antes; parado 60 min, gestor 30 min depois; sem check-in até 10:00; rota às 16:00; visita aberta 120 min; envio pendente 4 h; teto de 4 lembretes por pessoa por dia.

## 4. Como ficou no código (modulo-gestor)
- `domain/campos-regra.ts`: campos de cada regra da equipe, frases, regras visíveis por módulo e `montarSalvamento` (separa o que é da regra do que é parâmetro do tenant).
- `domain/produtividade-do-dia.ts`: nomes, frases, campos e salvamento da Produtividade do dia, sobre o contrato do Core (`@macuxi/core/contracts`), sem tipo nem validador copiado.
- `domain/alertas.ts`: `avaliarAlertas` (recebe `produtividade`, `params.parado_min` e `ultimo_contato_em`) e `reconciliarAlertas` (a substituição por chave).
- `api/rotas.ts`: consulta `core.produtividade_equipe@1` e filtro `?produtividade=1`; `api/parametros-alertas.ts`: `GET|PUT /v1/gestor/parametros/alertas` (4 valores, auditado).
- `web/pages/parametros-alertas-page.tsx` e `web/lib/parametros-alertas.ts`: a página e as chamadas ao Core.

## 5. Pendências
- Menu "Parâmetros" e redirecionamento de `/regras-alerta` para `/parametros/alertas`: engenheiro-apps.
- Permanência mínima no Promotor (consulta `promotor.parametros_trade@1` e rota de escrita) e sua volta à regra "Visita curta": modulo-promotor, com o Gestor depois.
