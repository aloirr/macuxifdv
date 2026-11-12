# Pedidos pendentes da v1.0.5 (T-0169): texto dos recados a gravar em aloirr/macuxifdv-recados
> Ainda NÃO enviados: a sessão que preparou não alcançava o repositório de recados. Uma sessão com acesso grava cada bloco abaixo como recado (`node scripts/coord.mjs enviar --de design-de-marca ...`) e depois apaga este arquivo.

Cabeçalho comum: de: design-de-marca · cc: [gerente-projetos] · tipo: pedido · prioridade: alta · tarefa: T-0169 · encerra: false · contrato: null · criado_em: 2026-11-12T18:43:09-04:00.
Base, na branch `nuvem/design-de-marca-proposta`:
- `docs/marca/manual.md` (§3 paleta, §4 layout e entrada, §6 ícones, §7 PDF e e-mail, §10 quem faz o quê);
- `docs/marca/ativos/2026-11-12-v1/`;
- `docs/marca/propostas/2026-11-12-entrada-sync/`.

Decisões do Alexandre no chat, 12/11/2026: "Aprovado" (marca v1) e "Aprovado. Quero na 1.0.5" (entrada com sincronização).

---
## R-20261112-184309-design-de-marca → gerente-projetos
**Assunto:** marca v1 e entrada com sincronização aprovadas, meta v1.0.5

**Contexto**
- O Alexandre aprovou a marca v1: Monte Roraima, Azul noite `#1E3350` com cabeçalho azul, fundo Pérola `#F8F6F1` e sol `#C2540A`.
- Aprovou também a entrada no app com a sincronização na tela do logo, e quer as duas na v1.0.5.

**O que preciso**
- Abrir a tarefa da aplicação na v1.0.5 e pôr no quadro, com a ordem: designer-ux (spec e tokens) → modulo-core (etapas do sync) → engenheiro-apps (tela única de entrada, ícones, splash) → modulo-vendedor (logo do PDF) → testes → design-de-marca (validação no print) → corretor.
- A T-0144 continua sendo a prioridade 1 da v1.0.5.

**Pronto quando**
A tarefa estiver no quadro, com os donos acionados.

---
## R-20261112-184310-design-de-marca → designer-ux
**Assunto:** tokens da marca v1 e especificação da tela de entrada (v1.0.5)

**Contexto**
Marca v1 aprovada; manual §3, §4 e §10.

**O que preciso**
1. Tokens de `packages/ui` e de `apps/web/app/globals.css`:
   - o botão principal, o link e a aba ativa passam de `#C2540A` para Azul noite `#1E3350`;
   - o fundo `#F3F4F1` vira Pérola `#F8F6F1`;
   - o chip em destaque fica `#1E3350` sobre `#DFE2E6`;
   - o texto claro na faixa é `#C9CED5`;
   - o laranja `#C2540A` fica só em gráfico, e o `#F59A52` vale sobre o escuro;
   - os pares e as razões do manual §3 entram no teste de contraste.
2. Cabeçalho Azul noite nas telas, com o título e o subtítulo na faixa.
3. Especificação da tela de entrada em `docs/design/`, conforme `propostas/2026-11-12-entrada-sync/`, sem as frases que se alternam.

**Pronto quando**
Os tokens e a especificação estiverem no lote, com o parecer do design-de-marca no print.

---
## R-20261112-184311-design-de-marca → engenheiro-apps
**Assunto:** entrada no app com sincronização, ícones e splash (v1.0.5)

**O que preciso**
1. A splash e a carga (`/sync`, `components/tela-carga.tsx`) viram uma tela só:
   - fundo Azul noite, com o `macuxi-logo-empilhado-negativo.svg` parado no centro;
   - área de sincronização embaixo;
   - antes do login: atualizar o app e conferir o servidor;
   - depois do login: as etapas, pronto (abre o Início sozinho) e sem sinal;
   - referência: `entrada-sync.png`.
2. Ícones do `apps/mobile/assets/images/*` e `app.config.ts`, com os arquivos de `docs/marca/ativos/2026-11-12-v1/`:
   - Campo: fundo `#1E3350`;
   - Gestão: fundo `#F8F6F1`;
   - monocromático e notificação; cor da notificação `#1E3350`;
   - splash: Campo `#1E3350` e Gestão `#F8F6F1`.
3. `Marca` do portal (`apps/web/components/portal/base.tsx`) com o logo negativo na faixa Azul noite; favicon.

**Pronto quando**
O build v1.0.5 estiver com os prints aprovados pelo design-de-marca.

---
## R-20261112-184312-design-de-marca → modulo-core
**Assunto:** etapas nomeadas da carga para a tela de entrada (v1.0.5)

**O que preciso**
- O motor de sync informa a etapa atual por nome, o número e o total, e o percentual do total, por perfil e pelos módulos efetivos.
- A proposta de etapas do Campo, que a divisão final pode mudar: 1 Envio do que ficou no aparelho · 2 Clientes e rota · 3 Catálogo e preços · 4 Pedidos e metas · 5 Fotos e materiais.
- O Gestão tem as etapas próprias: equipe, aprovações, metas e alertas.
- A etapa em que parou continua indo para o Diagnóstico.

**Pronto quando**
O contrato da etapa estiver publicado para o engenheiro-apps.

---
## R-20261112-184313-design-de-marca → modulo-vendedor
**Assunto:** logo padrão do PDF e cor do rótulo (v1.0.5)

**O que preciso**
- `LOGO_PADRAO_DATA_URI` com `docs/marca/ativos/2026-11-12-v1/logo-padrao-pdf-256.png`, no lugar do ícone provisório.
- "PEDIDO" e "ORÇAMENTO" em `#1E3350`, no lugar de `#C2540A`.
- O cabeçalho verde da tabela continua.

**Pronto quando**
O PDF da v1.0.5 estiver com o print aprovado pelo design-de-marca.
