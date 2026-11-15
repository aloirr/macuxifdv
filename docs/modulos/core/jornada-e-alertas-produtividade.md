# Jornada (almoço) e parâmetros dos alertas de produtividade (T-0180, v1.0.13)

Decisões D1, D4, D5 e D6 do gerente-projetos, por delegação escrita do dono do produto (15/11/2026, Manaus). Regras: RN-CORE-26, RN-CORE-44, RN-CORE-03, RN-AUD-01.

## 1. Almoço (D5, RN-CORE-44)
- Padrão da empresa: parâmetro `jornada.almoco_padrao` = `{ inicio_min, fim_min }` (minutos do dia no fuso do tenant). Padrão 12:00 às 13:00.
  - `GET|PUT /v1/core/parametros/jornada`, ação `parametro.inicio` (analista e admin), auditado, idempotente. Editado em Parâmetros › Calendário, painel "Horário de almoço padrão".
- Por usuário: `core.usuario.almoco_inicio_min` e `almoco_fim_min` (migração 0085 do banco-dados). Os dois nulos = padrão da empresa.
  - Edição: `PUT /v1/core/usuarios/:id` (`usuario.editar`), auditado com antes e depois (RN-AUD-01). Um campo só preenchido é 422.
  - Gaveta "Editar usuário", seção **Jornada** depois de "Código no ERP": caixa "Padrão da empresa (12:00 às 13:00)" marcada; desmarcada, Início e Fim já preenchidos com o padrão.
- Regras (domain `validarHorarioAlmoco`): fim depois do início; de 15 min a 3 h. O erro aparece só ao salvar, no texto do campo.
- Sync: o parâmetro vai no pull `parametro`; o horário do próprio usuário, no pull `usuario` (`almoco_inicio_min`, `almoco_fim_min`).
- Produtividade: `ParametrosAlmoco.horario` (o do usuário ou o padrão) manda. O almoço do dia é o intervalo entre o check-out real e o próximo check-in que mais se sobrepõe ao horário cadastrado (empate: o mais longo); sem sobreposição, sem almoço. A detecção pela janela e pelo corte só vale quando `horario` não vem (compatibilidade).

## 2. "Parado" (D1, RN-CORE-26)
- O valor continua em `inicio.parado_min` (15 a 480 min, padrão 60). Saiu de Parâmetros › Início.
- Gravação para a tela Parâmetros › Alertas (modulo-gestor): `PUT /v1/core/parametros/parado-min`, corpo `{ parado_min }` (`CAMINHO_PARAMETRO_PARADO_MIN`, `ParametroParadoMinSchema`). Leitura: `GET /v1/core/parametros/inicio`.
- `PUT /v1/core/parametros/inicio` continua exigindo `parado_min` (a tela do Início manda o valor já salvo).

## 3. Parâmetros dos alertas de produtividade (D6)
- Chave `alertas.produtividade` (JSON). `GET|PUT /v1/core/parametros/alertas-produtividade`.
- Ação `parametro.alertas_produtividade` (analista e admin). Uma ação não pode estar em dois manifestos: o `alerta_regra.gerenciar` é do Gestor, então o Core tem a ação própria, com o mesmo público. A licença do módulo core é checada pelo SDK (RN-CORE-03).
- Contrato (`modules/core/contracts/alertas-produtividade.ts`): `ParametrosAlertasProdutividade`, `parametrosAlertasProdutividadeSchema`, `PARAMETRO_ALERTAS_PRODUTIVIDADE`, `PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO`, `FAIXAS_ALERTAS_PRODUTIVIDADE`.
- Padrões: fim do almoço (liga, 10 min antes, vendedor); parado entre visitas (liga; vendedor e gestor; gestor 30 min depois; o limite é `inicio.parado_min`); sem check-in até 10:00 (vendedor e gestor); rota incompleta (vendedor, 16:00); visita aberta (vendedor, 120 min); envio pendente (vendedor, 4 h); teto 4 lembretes por pessoa por dia.
- Vai ao Campo e ao Gestão no pull `parametro`.

## 4. Lembretes locais no Campo (D4)
- `agendaDeLembretes` (`modules/core/domain/lembretes-produtividade.ts`): função pura. Entra a rota do dia, as visitas locais (com a fila aplicada), a fila de envio, o almoço, o parado e os parâmetros; sai a agenda do dia.
- Ordem de prioridade para o teto: sem check-in, fim do almoço, parado, rota incompleta, visita aberta, envio pendente. Rota incompleta não sai se o parado disparou na última hora. Só dia útil, só horário comercial, só vendedor e promotor. O que já passou da hora não sai atrasado.
- Textos: título curto e corpo "Próxima visita: <cliente>." em todos (sem rota, sem corpo). Vai só para a bandeja.
- Pendente (engenheiro-apps): agendar com `expo-notifications` (está em `apps/mobile`), recalculando ao abrir, a cada sync e a cada check-in ou check-out, e guardando o que já saiu no dia (`enviados`); ícone monocromático Azul noite (designer-ux).
- Pendente: o horário comercial do tenant ainda não existe como parâmetro; a função usa 08:00 às 18:00 (`HORARIO_COMERCIAL_PADRAO`) e aceita o valor de fora.

## testIDs novos
`calendario.almoco-padrao.inicio|fim|salvar|aviso` · `calendario.almoco-padrao.erro.inicio|fim` · `usuarios.jornada` · `usuarios.campo-almoco-padrao` · `usuarios.campo-almoco-inicio` · `usuarios.campo-almoco-fim`. Saiu `inicio-params.parado`.
