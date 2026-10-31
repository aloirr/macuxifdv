# Macuxi FDV — LEIA-ME (kit v3)

Esta pasta (`C:\macuxifdv`) é o **repositório novo** do Macuxi FDV, já configurado para o Claude Code com o time de 12 agentes. A Fase M continua em `C:\Users\domon\dev\forca-vendas`: os agentes só leem e copiam de lá, nunca alteram (o guardião bloqueia).

## 1. Projeto no claude.ai
1. Projeto **Macuxi FDV** → **Instruções do projeto** → apague o texto atual e cole o de `docs/claude-ai/00-INSTRUCOES-DO-PROJETO.md` (abaixo da linha).
2. O conhecimento do Projeto (docs 01 a 07) já está atualizado; as mesmas versões estão em `docs/produto/`.

## 2. O que tem aqui
| Item | Para quê |
|---|---|
| `CLAUDE.md` | Guia do repositório lido pelo Claude Code |
| `.claude/agents/` | 12 agentes: gerente-projetos, engenheiro-software, banco-dados, testes + 8 de módulo |
| `.claude/skills/` | `protocolo-recados` (todos usam), `/status`, `/feature`, `/entrega` |
| `.claude/settings.json` | Sessão principal = gerente-projetos; permissões; guardião; leitura da pasta da Fase M |
| `.claude/hooks/guarda-donos.mjs` | Bloqueia edição fora dos caminhos do agente, alteração de recados e escrita na Fase M |
| `scripts/coord.mjs` | CLI de recados: `caixa`, `enviar`, `pendencias`, `fio`, `dono`, `verificar` |
| `.coord/` | Donos, quadro e tarefas da Sprint 0, recados, diários e contratos entre módulos |
| `docs/produto/` | Visão, módulos (RF), regras (RN), arquitetura, roadmap, integração, agentes |

## 3. Primeiro uso
0. **Dê dois cliques em `instalar-claude.cmd`** — ele cria a pasta `.claude` (agentes, skills, hooks e settings) a partir de `_instalar\claude`. Por segurança, a conexão remota do Claude não pode gravar direto em pastas `.claude`; por isso esse passo é seu. Depois, se quiser, apague `_instalar`.
1. Instale **Node 20+** e **Git**; no terminal: `cd C:\macuxifdv` → `git init` → `git add -A` → `git commit -m "chore: kit inicial Macuxi FDV"`.
2. Abra a pasta no VS Code, inicie o Claude Code **na raiz** e aceite o aviso de confiança da pasta (sem isso os hooks não rodam).
3. Ele abre como **gerente-projetos** e mostra o status. Confira os agentes com `/agents`.
4. Teste o guardião: *"peça ao modulo-promotor para criar modules/vendedor/teste.ts"* → deve ser bloqueado e virar recado ao `modulo-vendedor` (`node scripts/coord.mjs pendencias`).
5. Comece: *"Execute a Sprint 0 conforme o quadro, começando pela T-0001 e T-0002."*

Dia a dia: `/status` · `/feature RF-PRO-04 share de gôndola` · `/entrega`. Seus recados: `node scripts/coord.mjs caixa alexandre`.

## 4. Opções
- **Equipe ao vivo (experimental)**: em `.claude/settings.json` adicione `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`; o combinado ao vivo também deve virar recado.
- **Sem guardião (uso manual)**: `$env:MACUXI_GUARDA="off"` antes de abrir o Claude Code, ou `claude --agent engenheiro-software`.

## Premissas
- Mudanças desta versão: Promotor focado em **promotoria de mercado** (checklist da loja, gôndola antes/depois, share, preço nosso × concorrência, ruptura, validade, pontos extras, tarefas de campanha); a sugestão de pedido saiu e virou **alerta de ruptura** ao vendedor (P1).
- Reconhecimento de imagem por IA (contar frentes pela foto) ficou como P2.
- Demais premissas da v2 mantidas (instalação lógica de módulos, Hub + Conector, schema por módulo, opus nos seniores e sonnet nos módulos).
