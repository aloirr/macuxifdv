# ADR 0063 — Supervisor rastreado no app Gestão (revisa a decisão 2 da ADR 0061)

- **Status**: aceita em 2026-11-19.
- **Data**: 2026-11-19 (Manaus)
- **Autor**: engenheiro-software
- **Origem**: T-0187 (supervisor em campo no app Gestão), pedido do dono do produto de rastrear só o supervisor; simulação
  `docs/design/supervisor-campo/` (P7 A). Regras: RN-CORE-13 e RN-CORE-37.
- **Desenho**: [`docs/desenho/T-0187.md`](../desenho/T-0187.md) §1.2 e [`docs/desenho/tracking.md`](../desenho/tracking.md) §2.
- **Revisa**: [ADR 0061](0061-rastreamento-continuo-de-localizacao.md), decisão 2 (condições 2 e 3 do portão). As demais decisões
  da 0061 seguem valendo.
- **Quem implementa**: modulo-core (portão e API), engenheiro-apps (captura no Gestão) e modulo-gestor (trajeto sem o próprio).

## Contexto
- A ADR 0061 fixou no portão `podeRastrear` o cargo de campo (vendedor ou promotor) e o app Campo: o Gestão não rastreia, e a
  API passa `campo` fixo.
- Na T-0187 o supervisor passa a trabalhar em campo pelo app Gestão: rota própria, check-in, checkout e pedido em nome. O dono
  do produto pediu que o supervisor seja rastreado como o vendedor, e o gerente não.

## Decisão
1. **Cargos rastreados**: `CARGOS_RASTREADOS = ['vendedor', 'promotor', 'supervisor']`. O gerente segue fora (motivo `cargo`).
2. **App do cargo** em vez do Campo fixo: constante `APP_RASTREADO_DO_CARGO = { vendedor: 'campo', promotor: 'campo',
   supervisor: 'gestao' }` no domain do Core, exportada por `contracts/rastreamento-portao.ts` (aditivo). A condição 3 passa a
   `app === APP_RASTREADO_DO_CARGO[cargo]`, com o mesmo motivo `app`. `MotivoSemRastreio` e a assinatura de `podeRastrear` não
   mudam.
3. **API**: o push de `ponto_trajeto` (`trajeto-push.ts`, `triarPontoRecebido`) usa `APP_RASTREADO_DO_CARGO[cargo]` no lugar
   do `'campo'` fixo, porque o push não diz de que app veio e o cargo decide.
4. **Ninguém vê o próprio trajeto**: `GET /v1/core/trajeto` com o `usuario_id` da sessão responde 404 `USUARIO_NAO_ENCONTRADO`
   para qualquer perfil, e a consulta `core.trajeto_do_dia@1` tira o id da sessão. O supervisor vê o da equipe; o gerente vê o
   da equipe abaixo, com os supervisores.
5. **Interno e desligado por padrão**, como na decisão 6 da 0061: nenhuma tela do Gestão mostra trajeto; fica só a notificação
   fixa "Macuxi Gestão ativo" no canal `macuxi-servico`, sem citar localização. Liga quando o dono do produto mandar, pelo
   parâmetro `rastreamento.ativo` da empresa.
6. **Permissão "o tempo todo"** (RN-CORE-37) no Gestão só para o cargo supervisor; o gerente não recebe o pedido.

## Alternativas descartadas
- **Manter o Gestão fora do rastreamento**: o supervisor em campo ficaria sem km e sem trajeto para o gerente, contra o pedido
  do dono do produto.
- **O aparelho mandar o app no push**: a API passaria a confiar num dado do aparelho; o cargo já vem do token e basta.
- **Rastrear também o gerente**: fora do pedido do dono do produto e da minimização da ADR 0061.

## Consequências
- Teste do `podeRastrear` com 4 casos novos (supervisor/gestao pode; supervisor/campo `app`; vendedor/gestao `app`; gerente
  `cargo`), citando RN-CORE-13.
- O Gestão ganha `isAndroidBackgroundLocationEnabled` e o serviço `macuxi-trajeto`; a publicação pede a declaração de
  localização em segundo plano na Play Console para o pacote do Gestão.
- Contratos: só aditivos ou que restringem (`.coord/contratos/modulos.md`, seção T-0187); nenhuma versão nova de evento.
