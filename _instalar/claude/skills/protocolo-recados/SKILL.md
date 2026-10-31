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
