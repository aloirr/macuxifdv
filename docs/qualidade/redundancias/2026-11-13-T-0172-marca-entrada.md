# T-0172 · tela de entrada com a marca (código) e `entrada-sync.md`

> 2026-11-13 ~09h30 (Manaus) · corretor-redundancias · passada única da v1.0.5, pedido do gerente-projetos para o
> Campo-Demo-v1.0.5 (corte às 11h30). Entrega R-20261113-104633.
> Regras de hoje (R-20261113-062739): só achado **médio ou alto** segura o demo; o **baixo** fica registrado e vai para o
> build seguinte; todos os achados numa passada; no reteste, só o que foi corrigido.
> Outras tarefas da mesma passada: T-0166 (`2026-11-12-T-0166-alertas.md` §Reteste 4), T-0171
> (`2026-11-12-T-0171-listas.md` §6) e T-0173 (`2026-11-13-T-0173-catalogo-grade.md`).

## Parecer
**Não liberado:** RD-0239 (média) e RD-0240 (média) seguram o Campo. O RD-0241 (baixa) vai para a v1.0.6.

## O que passa
Sem frase que se alterna, sem nome de entidade, sem percentual por etapa, sem botão no Pronto. `Olá, {nome}` fica
(`manter?`): confirma quem entrou, ao lado de "Trocar usuário".

## Achados
### RD-0239 · média · texto · engenheiro-apps (código) · designer-ux (spec)
- **Onde:** `apps/mobile/src/lib/entrada.ts:67-69,77-79`, `tela-carga.tsx:70`, `tela-entrada.tsx:131-133`; spec
  `entrada-sync.md` §2 item 2 (:24-25) e §3 item 1 (:51-53); prancha `T-0172-marca.png`, telas 4 e 6.
- **O que se repete:** com a lista na tela, `Etapa 2 de 5 · Clientes e rota` repete a lista de 5 linhas em que `Clientes e rota`
  já está em destaque. No Parou com a lista (tela alta), `Sem internet na etapa 3 de 5` repete o "!" da etapa 3.
- **Impacto:** leitura; o mesmo fato em dois lugares da tela.
- **Proposta:** com a lista visível, a linha da barra mostra só o percentual (o rótulo segue só para o leitor de tela, na região
  viva); `Etapa n de N · nome` só na tela baixa, sem a lista. No Parou com a lista: `Sem internet` / `A sincronização parou`;
  sem a lista, como está.

### RD-0240 · média · código · modulo-core · engenheiro-apps
- **Onde:** `apps/mobile/src/lib/entrada.ts:81-136` (`ETAPAS_CAMPO`, `ETAPAS_GESTAO`, `progressoProvisorio`).
- **O que se repete:** copia o domain do Core, que já existe (`modules/core/domain/entrada-sync.ts:15-29`; `progressoDaEntrada`
  `:132`), e já diverge: o shell tira `Pedidos e metas` do promotor (`entrada.ts:108`), o Core não (`entrada-sync.ts:19`).
- **Impacto:** manutenção; regra de negócio fora do `domain` do módulo.
- **Proposta:** o modulo-core exporta `progressoDaEntrada` por `@macuxi/core/app`; o engenheiro-apps troca a chamada em
  `tela-carga.tsx:54` e apaga `entrada.ts:81-136`.

### RD-0241 · baixa · doc · designer-ux
- **Onde:** `entrada-sync.md`.
- **O que se repete:** diz 4 vezes que o logo não se move (§1:10, §2:41-42, §5:81, §6:87) e 3 vezes o "sem botão/600 ms" do
  Pronto (§1:18, §2:47, §7:99).
- **Proposta:** ficam o §5 e o §1 estado 5; saem os outros.

## Ao testes (defeito funcional, sem RD)
- §3 item 3 (:58-59) e a prancha (tela 5) têm "Continuar sem sincronizar", que o código não tem; o código tem "Desligar modo
  sem sinal" (`tela-carga.tsx:78`), que a spec não tem.
- A divergência das etapas do promotor (ver RD-0240): o shell tira `Pedidos e metas`, o Core não.
