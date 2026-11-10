# ADR 0043 — Diagnóstico do aparelho na plataforma e recado automático gravado pelo servidor

- **Status**: proposta em 2026-11-10. O remetente `diagnostico` já foi aprovado em R-20261110-112315-alexandre; o patch de governança segue o rito da T-0143.
- **Data**: 2026-11-10
- **Tarefa**: T-0158 ([desenho](../desenho/T-0158.md))
- **Autor**: engenheiro-software
- **Origem**: R-20261110-101345-alexandre. Complementa as ADRs 0010 (arquivos), 0029 (super-admin), 0039 (recados) e 0042 (`macuxi-saida`).

## Contexto
Erros e quedas ficam presos no aparelho (Perfil › Diagnóstico). O dono do produto só fica sabendo por print, e a produção de sábado precisa receber isso na nuvem. Ferramenta externa (Sentry, Crashlytics) foi descartada por agora: traria dependência pesada, conta externa e dado fora do nosso controle (ADR 0042).

## Decisão
1. **Rota da plataforma `POST /v1/diagnosticos`:**
   - exige a sessão do app; não depende de licença de módulo nem de carteira;
   - é idempotente pelo UUID do aparelho;
   - devolve um protocolo global sequencial;
   - o contrato fica no SDK (`diagnostico.ts`);
   - tenant e usuário vêm só do token;
   - a máscara de dado pessoal (`@macuxi/comum/dado-pessoal`) roda de novo no servidor.
2. **Tabela `plataforma.diagnostico`:**
   - RLS por tenant;
   - `macuxi_app` só insere e lê o próprio tenant;
   - `macuxi_worker` atualiza só as colunas de alerta e apaga no expurgo;
   - a leitura entre tenants é feita só por funções `sa_*` do papel `macuxi_portal` (T-0091).
3. **Print pela fila de arquivos da ADR 0010:**
   - `plataforma.arquivo` com `modulo = 'plataforma'` e `finalidade = 'print_diagnostico'`;
   - o `PUT` dispensa a licença de módulo nesse caso;
   - o `GET` do tenant devolve 404, e só o portal lê.
4. **Visibilidade:** só o super-admin, no portal; "o time" = contas próprias de super-admin. O admin do cliente não vê.
5. **Recado automático pelo worker:**
   - remetente de sistema `diagnostico`, com token fine-grained só do servidor (`MACUXI_RECADOS_TOKEN_SERVIDOR`, Contents read/write só no repositório de recados);
   - a gravação é a mesma da ADR 0039 (`createCommitOnBranch` com `expectedHeadOid`);
   - o recado leva só o protocolo, os dados técnicos curtos, os ids e o link do portal. Nunca leva o texto livre, a pilha nem o print, porque o repositório de recados é imutável;
   - tem teto de 12 recados por hora, com resumo, e agrupa as quedas repetidas;
   - sem token, o alerta fica `desligado`, e o diagnóstico chega ao portal do mesmo jeito.
6. **`diagnostico` não é agente:** não tem caixa, não recebe recado, o `coord enviar --de diagnostico` é recusado e o recado dele nunca autoriza merge nem governança.
7. **Retenção de 90 dias:** apagamento de fato (linha, arquivo e bytes), feito pelo worker uma vez por dia.

## Alternativas
- **Sentry ou Crashlytics agora:** descartado pelo dono do produto até o piloto. Exigiria SDK nativo, conta externa e envio de dados a terceiros.
- **Recado gravado pelo app, com o token no aparelho:** recusado. O token vazaria no APK, e o recado sairia em nome de quem usa o app.
- **Rota sem autenticação, para quedas antes do login:** recusada por abrir porta de abuso. A fila espera o próximo login, o que cobre a queda da 1ª abertura.
- **Texto livre e pilha no recado:** recusado. O repositório de recados é imutável e não tem expurgo de 90 dias (LGPD).
- **Diagnóstico visível ao admin do cliente:** fora do pedido. Pode voltar depois do piloto com outra função `sa_*` e com o filtro por tenant.

## Consequências
- Um segredo novo na VM (demo e produção) e um token a renovar a cada 90 dias. Sem ele, o alerta fica desligado e nada mais muda.
- O worker ganha dois ciclos (alerta a cada 60 s e expurgo diário) e um cliente HTTP do GitHub sem dependência nova.
- O formato do recado é conferido por teste contra o `scripts/coord-lib.mjs`, para não se separar do `coord`.
- O portal ganha a área Diagnósticos, e as funções `sa_*` novas entram no teste de conformidade.
