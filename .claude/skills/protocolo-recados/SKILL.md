---
name: protocolo-recados
description: Protocolo de recados e donos do time Macuxi FDV — como ler a caixa, enviar, responder, encerrar e checar donos de arquivos. Use sempre que precisar falar com outro agente, pedir algo fora dos seus caminhos ou entregar uma tarefa.
---

# Protocolo de recados (universal)

**Regra de ouro**: altere só seus caminhos (`.coord/donos.json`); para o resto, deixe recado. Recados são imutáveis.

| Quero... | Comando |
|---|---|
| Ver minha caixa | `node scripts/coord.mjs caixa <eu>` |
| Saber o dono de um arquivo | `node scripts/coord.mjs dono <caminho>` |
| Pedir algo | `node scripts/coord.mjs enviar --de <eu> --para <dono> --tipo pedido --tarefa T-nnnn --assunto "..." --corpo "Contexto \| O que preciso \| Pronto quando"` |
| Perguntar | `... --tipo pergunta ...` |
| Responder | `... --tipo resposta --responde-a <id> ...` |
| Responder e dar por resolvido | `... --tipo resposta --responde-a <id> --encerra ...` |
| Avisar todos (mudança de contrato, decisão) | `... --para todos --tipo aviso ...` |
| Sinalizar bloqueio | `... --tipo bloqueio ...` (gerente recebe cópia automática) |
| Entregar tarefa | `... --para gerente-projetos --tipo entrega --tarefa T-nnnn ...` |
| Marcar informativo como lido | `node scripts/coord.mjs lido <eu> <id>` |
| Ler um recado / a conversa | `node scripts/coord.mjs ler <id>` · `node scripts/coord.mjs fio <id>` |
| Conferir se só mexi no que é meu | `node scripts/coord.mjs verificar <eu>` |

Corpo com 3 partes separadas por `|` vira as seções Contexto / O que preciso / Pronto quando. Para textos longos, escreva num arquivo temporário fora do repo e use `--arquivo`.

Boas práticas: um assunto por recado; cite arquivos, contratos (`modulo.entidade.fato@vN`), extensões e regras (`RN-...`); diga o critério de pronto; responda rápido, mesmo que seja "recebido, entrego até o fim da tarefa".

## Lições de 15/11 (R-20261115-213800-alexandre, R-20261115-214500-gerente-projetos)
- **Antes de cada push** (erro 1: prazo, Integração ERP e Parâmetros refeitos):
  - `node scripts/coord.mjs verificar <eu> --base origin/main` sai 0;
  - todo commit de `git log origin/main..HEAD` traz `Agente: <eu>`.

  Arquivo de outro dono vai por recado, nunca no seu branch.
- **Nada só na máquina** (erro 8: o diff do #361 e o N4 ficaram só na máquina): nunca termine o turno com commit sem push (`git status -sb` sem `ahead`). Antes do lote pronto, o push vai para o PR em rascunho, que não roda CI. Fora do rascunho vale o "1 push por PR" da skill `entrega`.
- **Um dono por branch** (erro 6: o #433 caiu em "agente ambíguo" e foi refeito como #440): `nuvem/*` e `agente/*` levam um agente só no trailer de todos os commits. PR com mais de um dono só em `alexandre/*`.
- **`sa_*` e kit do Conector** (erro 3): a migração que muda a lista de funções `sa_*` ou o kit do Conector, e o teste que confere essa lista, saem juntos no PR conjunto `alexandre/migracao-<item>` (R-20261115-171000).
- **Grafo do turbo** (erro 5: o #394 lia `docs/design`, R4, e o #439 tinha caminho fora do pacote, R2): antes do push, `node scripts/ci/grafo-turbo.mjs` sai 0. Teste lê só o próprio pacote, `docs/modulos/` ou uma pasta declarada nos inputs do `turbo.json`, que se pede por recado ao `engenheiro-software`.
- **Lista do corretor antes do PR** (erro 11): passe no seu diff a lista "Antes do PR" de `.claude/agents/corretor-redundancias.md`.
- **CI vermelho no seu PR** (erro 16): leia o log, corrija no mesmo branch e escreva no PR o teste que caiu e a correção. "Pronto" só com o CI verde no head SHA.
- **Permissão** (erro 12: a L6 ficou presa num pedido de `git worktree remove --force`): não use comando que pede permissão sem necessidade e não remova worktree.
