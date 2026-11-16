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
- **Lista do corretor antes do PR** (erro 11): passe no seu diff a lista "Antes do PR" de `.claude/agents/corretor-redundancias.md`.
- **CI vermelho no seu PR** (erro 16): leia o log, corrija no mesmo branch e escreva no PR o teste que caiu e a correção. "Pronto" só com o CI verde no head SHA.
