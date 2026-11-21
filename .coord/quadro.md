# Quadro — Sprint 0 (Fundação modular)

> Dono: gerente-projetos. Status: aberta → em_andamento → em_teste → em_revisao → concluida (ou bloqueada).

> **v1.0.16 no ar, servidor e APK** (20/11; R-20261120-013200 e R-20261120-022300). Horários de Manaus.
> - **No main:**
>   - governança: #518 (diagnóstico da outbox, só leitura);
>   - PR conjunto: #519 ([T-0187](tarefas/T-0187.md), PDF na ficha, tabela Carteira do Gestão, barra de 6 abas e o resto do trajeto no Gestão da T-0156, pela S6 do modulo-gestor).
> - **SHA** 85b9e9b47f5a8e08708d86367363a1c34b5ed44c (CI do main, run 44680009884). Publicado à 1h57 (issue #520; aprovação R-20261120-014547-alexandre e R-20261120-014839-alexandre). APK Campo e Gestão v1.0.16 (run 44684485331).
> - **ADRs no main:** 0063 (supervisor rastreado no Gestão; revisa a 0061) e 0064 (PDF nativo no app).
> - **Doc 03, no fechamento:** RN-VEN-43 a 46 (tabela ajustada pelo prazo) e RN-VEN-47 (cards de Pedidos, T-0170), pelo ponto 3 de R-20261117-201110.
> - **Pendências para o lote seguinte:**
>   - RD-2379, RD-2413, RD-2448 e RD-2450 (só comentário) e o comentário do teste do trajeto;
>   - banco-dados: o deadlock em `db/testes/empresa-acoes.db.test.ts:415`;
>   - governança: o SSH comum dos workflows;
>   - o 🟢 do "Enviando…" e a MC-1803 (logo do e-mail);
>   - OUTBOX_PARADA (36 eventos, desde a v1.0.14): o diagnóstico do #518 espera o §6 e os códigos das empresas. Reprocessar exige o "sim" do dono do produto.

> **v1.0.15 no ar, servidor e APK** (19/11; R-20261119-172300 e R-20261119-180100). Horários de Manaus.
> - **No main:**
>   - governança: #504;
>   - P-6: #495, #494 e #507;
>   - rastreamento: #498, #499 e #502;
>   - prazo médio e Alertas: #506 e #508;
>   - catálogo v2: #503;
>   - login e e-mails: #501 e #510;
>   - #509 e #492;
>   - ficha do cliente v2 (T-0186): #514;
>   - limpeza do reteste: #515;
>   - envio do trajeto (T-0156): #516.
>   - Fechados sem merge: #453, #493, #496, #497, #500, #505, #511, #512 e #513.
> - **SHA** 53baf7c3fc854a4a1a00436c80fb585c48e55276 (CI do main, run 44616710113). Publicado às 17h37 (issue #517). APK Campo e Gestão v1.0.15 (run 44618378737).
> - **Pendências:** seguem na lista da v1.0.16.

> **v1.0.14 = cenário A, só servidor** (R-20261117-063420-alexandre e R-20261118-003807-alexandre). O Cline tocou de 16 a 18/11, e a nuvem voltou em 18/11 às 20h57 (R-20261118-205700). Horários de Manaus.
> - **No main:** #420, #486, #403, #396 (0087), #483, #412, #484, #478, #479, #480, #481, #482, #414, #416, #415, #488 e #489 (último: 555c719a, 17/11 às 23h44).
> - **#485** (testes da T-0173): no main em b52ca64d (18/11, 20h58), no SHA da frase 2878f90b (R-20261118-003807).
> - **Main verde** em b52ca64dfc92dad5428921f9d1af2fe7910a5e97 (CI do push, run 44433316282, 18/11 às 21h08).
> - **Reteste sobre o main b52ca64d** (18/11, 21h10):
>   - corretor: LIBERADO. Fica a RD-2220 (baixa, linha velha em `docs/testes/T-0173.md:6`, dono `testes`), que vai para a v1.0.15, como decidiu a rodada 62;
>   - marca: LIBERADO. A MC-0068 (cinzas do PDF do pedido, já em produção) vai para o `modulo-vendedor` na v1.0.15.
> - **"PRONTO PARA LIBERAR v1.0.14 (só servidor)"** no SHA b52ca64d. Deploy pela ponte (R-20261118-003807).
> - **Fechados sem merge:** #487 e #384 (a reconferência de marca da v1.0.13 os substitui) e #345 (substituído pelo #488).
> - **Sem advogado** (R-20261119-0545, alexandre: "quem decide tudo sou eu"): nenhuma condição de "revisão de advogado". O rastreamento é interno e liga quando o dono do produto mandar, pelo parâmetro do BKO. Corrigidos: T-0156, doc 03 (RN-CORE-13), ADR 0061, `docs/desenho/tracking.md` e `T-0156-legal-finalidade.md` (#510).
> - **Economia do Actions** (R-20261117-065555), além do `CLAUDE.md`:
>   - PR só quando é obrigatório;
>   - não juntar o main sem conflito;
>   - pareceres só como comentário no PR;
>   - documentação e diários num PR só, por dono, no fechamento da versão;
>   - um build do Android por versão.
> - **Merges em sequência** (blocos 2 e 3, R-20261117-065959 e R-20261117-184956): sem esperar o CI do main entre um merge e outro, mas cada PR com a sua frase, o CI do head verde, `clean` e o parecer no SHA. Se o CI do main ficar vermelho, nenhum merge novo sai.

> **Manhã de 10/11 — teste da v1.0.2 (dono do produto, 05h32–06h02; 11 recados às 06h22 + regra do corretor às 06h25; "tudo na esteira já"):**
> - **Build v1.0.2 pronto** (f25bbe88, R-20261109-204045).
> - **Tarefas novas:**
>   - T-0144: queda na 1ª abertura; prioridade 1, bloqueia a v1.0.5.
>   - T-0145: permissões obrigatórias.
>   - T-0146: ficha sem repetição.
>   - T-0147: fotos do PDV.
>   - T-0148: aba Itens com popup.
>   - T-0149: filial.
>   - T-0150: Resumo e detalhe em tabela.
>   - T-0151: regras e defeitos do pedido.
>   - T-0152: auditoria do corretor.
>   - T-0153: revisão de todas as telas.
>   - T-0154: GHCR com novas tentativas.
>   - T-0155: demo com faturados.
> - **Vagas (7):**
>   1. engenheiro-apps — T-0144, depois a lógica da T-0145.
>   2. modulo-vendedor — T-0151, depois T-0150/T-0148 com imagem aprovada.
>   3. designer-ux — imagens T-0150 → T-0148 → T-0145 → T-0147 → T-0153.
>   4. engenheiro-software — desenho T-0149 → desenho T-0147 → T-0154 → LGPD T-0145.
>   5. banco-dados — T-0155, depois schemas T-0149/T-0147.
>   6. modulo-core — T-0146, depois T-0147.
>   7. corretor-redundancias — T-0152.
> - **Regra permanente:** o corretor avalia toda entrega antes do lote e do build; qualquer achado em aberto segura (CLAUDE.md e doc 07).
> - **Plano por dia** em R-20261110-061653 e no doc 05.
> - **Timer do gerente:** caixa e pendências no GitHub a cada 5 min (chat do dono do produto, R-20261110-061853).

> **Tarde de 09/11 — lote 03 no main (7c9dafe8, 15 commits por dono; árvore = retrato 6071c775 com CI e stack verdes; verificar --por-commit e trailer sem violação):** T-0140 (lote 03, sem achado alto), T-0141 (Novo pedido v3 aprovado pela imagem; UX sem 🔴; engenheiro sem 🔴), T-0142 (Catálogo pela hierarquia; 🔴 do parâmetro `no` corrigido), T-0117 (refresh do BKO em cookie httpOnly, ADR 0038), T-0098 (download do Conector, ADR 0037), T-0033 (banco modelo), datas impossíveis (Core/Gestor), RD-0045/0046. Lote seguinte (esteira): 7 🟡 de UX da T-0141 e aviso F.4, PDF do BKO com created_at, RD médios/baixos do relatório 2026-11-09-lote03.md, expo-location no package do Core. **T-0143 (recados direto no GitHub)** aguarda o "aprovo" do dono do produto (patch de governança em docs/desenho/T-0143.patch, ADR 0039). Telegram: 403 (bot sem permissão no chat) — passos com o dono do produto. Próximo: demo publicada + base recriada + fotos + smoke do cookie → build Campo-Demo-v1.0.2 / Gestao-Demo-v1.0.2.

> **Manhã de 09/11:** corte dos recados feito pelo dono do produto às 05h24 (junções para C:\macuxifdv-recados); commit 9d097404 (Agente: alexandre) no main com CI verde, inclusive governança. Falta o dono do produto cadastrar o agendador (agendar-sincronizacao.ps1); até lá o clone local fica atrás do GitHub e os agentes leem recados novos por `git show origin/main`. Scripts do corte corrigidos pelo engenheiro-software (na árvore, entram no lote 03). **Lote 03** (T-0140): reteste do corretor em `docs/qualidade/redundancias/2026-11-09-lote03.md` (6 fechados, 9 parciais, RD-0042 novo, nenhum alto); RD-0025 feito (promotor); shell (engenheiro-apps) e T-0098 rota (engenheiro-software) em andamento. **Teste do v1.0.1 (dono do produto, 09/11 05h44–06h56):** T-0141 Novo pedido v3 (designer-ux specs com imagem para aprovação; modulo-vendedor D, E, G, H, I e domain de F) e T-0142 Catálogo pela hierarquia (designer-ux + modulo-catalogo). Docs 02/03 atualizados (RN-VEN-17, 18, 30, 32, 38, 39, 40, 41; RF-VEN-11; RF-CAT-09). Próximo build: Campo-Demo-v1.0.2 / Gestao-Demo-v1.0.2 com lote 03 + T-0141 + T-0142.

> **Madrugada de 09/11:** lote 02 no main (338e9976, 13 commits por dono, árvore = retrato bc7c574 com CI e stack verdes; CI do main vermelho só na governança por dois erros de registro do gerente: trailer da N17 fora do último bloco e diários de outros agentes no commit do gerente — sem efeito no código, registrado ao dono do produto em R-20261109-041423). Demo publicada por dispatch manual, base recriada e 30 fotos recarregadas. **BUILD PRONTO Campo-Demo-v1.0.1 / Gestao-Demo-v1.0.1 (338e9976)** às 04h38 (R-20261109-043936). Depois do build: RD-0013..0041 restantes já feitos na árvore local (core, vendedor, designer, gestor, catálogo, engenheiro-software) para o lote 03; T-0117, T-0098 (rota), zod 4, devolução ligada. Corte dos recados às 5h pelo dono do produto.
>
> **Lote 01 no main (08/11 19h04, 714d0d1b, 15 commits por dono; CI e stack verdes na verificacao/lote01-2026-11-08-1855):** T-0093, T-0094, T-0095, T-0097 (fotos), T-0099, T-0103, T-0106, T-0111, T-0113, T-0114, T-0118, T-0119 (p95 em it.fails), T-0124 (RD-0001 a RD-0012), T-0126, T-0127 a T-0130, T-0133 a T-0137; migrações 0039 a 0049. Recados e lidos ficaram fora do commit: vão para o repositório de recados no corte (T-0139). Build Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0 com o engenheiro-apps. **v1.0.1 em andamento:** M (T-0138, com D1 e Equivale a), cursor do Hub e erp_aceita_cancelamento (Integração), p95 da busca e retrato (Catálogo), calendário único e RD do Core; depois Gestor (calendário e emitido_em) e os RD-0014 a RD-0031 restantes.
>
> **Redundâncias antes do build (gerente, 08/11 17h50):** como o dono do produto pediu todas as correções antes do build, os RD médios e baixos também entram (lote: RD-0014 a RD-0031, relatório docs/qualidade/redundancias/2026-11-08-lote.md; Início: RD-0002 a RD-0013). Ordem do RD-0019/0020 (ciclo de senha duplicado): modulo-core e engenheiro-software primeiro (contratos e packages/comum), depois engenheiro-apps. Rótulos dos 7 perfis (RD-0014): texto do designer-ux.
>
> **Organograma (08/11, T-0123):** dono do produto → gerente-projetos → engenheiro-software · engenheiro-apps · designer-ux · banco-dados · testes · **corretor-redundancias** (audita redundâncias; não corrige código de outro agente) → modulo-core · catalogo · vendedor · promotor · gestor · pesquisa · treinamento · integracao. Detalhe no doc 07.
>
> **Novo pedido v2 (T-0131, tarefa-mãe; dono do produto, 08/11 ~13h05):** prioridade T-0093 → T-0094 → **Novo pedido v2** → build único. Sequência no modulo-vendedor: F T-0129 (feita) → J T-0135 e I T-0134 → K T-0136 → L T-0137 (absorve a D T-0127, feita) → E T-0128 (em andamento; rótulos da folha mudam na L) → G T-0130 → M T-0138. H: docs T-0132 (feita) e design T-0133 (designer-ux). Fila extra, decidida pelo gerente (todas as correções antes do build): "Equivale a" no PDF interno do pedido (desenho da T-0085) entra com a M; hook `useBloquearSaida` no shell (engenheiro-apps) para a E; 4 🟡 do app e 5 do BKO do Catálogo (R-20261108-130157) com o modulo-catalogo. "aba Detalhes" → "aba Venda" / "aba Entrega".
>
> **Rodada do teste de campo de 08/11 (T-0123 a T-0130):** os 4 bugs do Novo pedido entram antes do build, em sequência no modulo-vendedor para não colidir: F (T-0129) → D (T-0127) → E (T-0128) → G (T-0130); a B (T-0124) depende da A (T-0123); a C (T-0125) já está nos docs e a T-0126 (padrão de pendências) fica com o designer-ux. Depois de D a G: APK de teste e entrega ao dono do produto com o que retestar.
>
> **Fila do lote 2 (08/11 10h):** D-1 no Vendedor (depois do SDK); botão de cancelar pedido integrado e `erp_aceita_cancelamento` no pull; 9 🟡 de UX da página Perfis de acesso e 🟡 das telas de senha; aviso da etapa pendente do Gestão ligado na ficha do cliente (Core) e no registro (Gestor), achado do roteiro R-20261108-095042; fotos de produto no seed da demo, para testar a miniatura; troca do laranja cru por `accentInk` nas telas (lista em R-20261108-103725: modulo-core, engenheiro-apps, pesquisa, treinamento, gestor, promotor); T-0097 b; T-0118; T-0119. Roteiro: `apps/mobile/docs/roteiro-campo-demo-v1.0.0.md` (recriar a base antes de testar).
>
> **Build único só com todas as correções (dono do produto, 08/11 ~09h):** sem defeito conhecido; antes dele, o lote 1 (pronto e revisado) e o lote 2 (D-1, D-MP1/2, 🟡 de UX, T-0114 completa, T-0118, T-0119, T-0097 b, contraste do kit). Sem pressa de horário.
>
> **Próximo build único (R-20261107-163525, substitui as condições anteriores):** Campo e Gestão juntos, com o nome **Campo-Demo-v1.0.0 / Gestao-Demo-v1.0.0** (R-20261107-151653, doc 07 §5). Ele sai quando:
> 1. a T-0093 e a T-0094 estiverem no main, com CI verde e a demo publicada no commit exato;
> 2. a T-0109 (nome e versão) estiver no main;
> 3. nada estiver em andamento em `apps/mobile` ou `modules/*/app`.
>
> O build leva tudo o que entrou desde o d1e0d2a e um **roteiro único desde o e9a65286**, incluindo a passagem para o SQLite e o ciclo de senha. O dono do produto não testa o d1e0d2a.
>
> **Esteira permanente (R-20261107-164646):** backlog só com a autorização escrita do dono do produto; 4 vagas locais sempre ocupadas; frentes na nuvem quando não houver trabalho local sem colisão. Prioridade: T-0093 → T-0094 → build único → o resto.
>
> **Vagas locais (07/11 22h40, limite de 7 pelo dono do produto):** 1. modulo-core — T-0094 C (+ 🟡 da T-0095); 2. banco-dados — 0041 (T-0111/T-0112); 3. engenheiro-apps — T-0094 W; 4. testes — T-0094 T; 5. engenheiro-software — T-0094 S (e-mail na outbox, perfis na API, RN-CORE-35); 6. designer-ux — spec visual da T-0111. 7. modulo-catalogo — pendências da T-0096 e da T-0097; 8. modulo-integracao — pendências da T-0099 e T-0103 (aplicar-lote). Na fila para a próxima vaga: testes, com a T-0110 (conferência).
>
> **Nuvem (07/11 21h55):** N4 #103, N5 #104, N6 #100, N7 #105, N8 #101 e N9 #102 integrados no main (até e00a52df). Abertos ainda: #85–#89 (04/11), em conferência na T-0110.

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0001](tarefas/T-0001.md) | Reestruturar o monorepo em modules/ + platform-sdk | engenheiro-software | local | concluida (277/277 da Fase M · Fase M intacta · fronteiras ✅ · revisão sem 🔴) |
| [T-0002](tarefas/T-0002.md) | Banco: schemas plataforma e core, RLS e migrações | banco-dados | local | concluida (94 testes de banco no Docker · vazamento verde · revisão sem 🔴 · 🟡 corrigidos) |
| [T-0003](tarefas/T-0003.md) | Auth, perfis e licenças de módulos | modulo-core | local | concluida (3 critérios ✅ no Postgres real · 245 testes no core, 51 na API) |
| [T-0004](tarefas/T-0004.md) | Shells mobile (campo/gestao), web e api montando módulos pelo manifesto | engenheiro-software | local | concluida (APKs de desenvolvimento campo e gestao gerados no EAS · previews na sequência) |
| [T-0005](tarefas/T-0005.md) | CI e verificação de donos | engenheiro-software | local | concluida (verificar --base e casos A–B · CI do main verde · run 41207939579 foi cancelamento por concorrência) |
| [T-0006](tarefas/T-0006.md) | Plano de testes da fundação | testes | local | concluida (relatório final da Sprint 0 · 230 casos em tests/ com banco real) |

## Conta nova — todo o lote (gerente session_019xHEXs75xqGq9m52u565UD; R-20261115-161800-alexandre e R-20261115-163500-gerente-projetos)
> A conta antiga parou por falta de créditos (16h18) e não toca nada até o dono do produto mandar. A conta nova toca a v1.0.12, a v1.0.13 e a v1.0.14, nessa ordem; onde um arquivo colidir, a v1.0.12/v1.0.13 passa na frente e o PR `nuvem/v1014-*` faz `git merge origin/main` depois.
> **v1.0.12/v1.0.13 (sessões L):** os branches e PRs deixados pela conta antiga (#361, #366, #367, #369, #373, #375, #382–#388, carga T-0181, fotos T-0174, fonte, filtro, catálogo onda 1, Expo, Sincronizar), conferido o último commit de cada um.
> **v1.0.14 (sessões N):** prazo Desc./Acrésc. · logo do cliente (T-0182) · Planos · alertas (T-0180) · Integração ERP simplificada (T-0173) · menu Parâmetros · catálogo v2 (só depois do #361, #382, #386 e #387). Branches novos `nuvem/v1014-<item>-<dono>`, um commit por dono, a partir do main; os branches antigos desses itens ficam congelados (só base).

| Sessão (conta nova) | Dono(s) | Caminhos | Branches | Onde | Desde |
|---|---|---|---|---|---|
| L1 | modulo-core | #361, #386, #385, #375 (arquivos desses PRs) | `nuvem/v1012b-modulo-core`, `catalogo-v1013-modulo-core`, `filtro-padrao-modulo-core-3`, `fonte-sistema-modulo-core-pr` | conta nova, session_019xHEXs6pbzHcfXgipiZQ9J | 2026-11-15 16h29 |
| L2 | testes | `tests/**` dos testes da filial, da fonte, do T-0174 e da carga | `nuvem/v1012b-testes-tol`, `fonte-sistema-testes-*`, `T-0174-testes`, `carga-frases-testes-v5`, `nuvem/v1013-*-testes` | conta nova, session_019xHEXrN9KF9DeuxuBf3yPZ | 2026-11-15 16h29 |
| L3 | engenheiro-apps | `apps/**` dos apps da filial, Expo, fonte, carga, catálogo onda 1, Sincronizar, fotos | `nuvem/v1012b-engenheiro-apps`, `expo-limpeza-v2-engenheiro-apps`, `fonte-sistema-engenheiro-apps-pr`, `carga-frases-engenheiro-apps-v4`, `catalogo-v1013-engenheiro-apps`, `nuvem/v1013-*-engenheiro-apps` | conta nova, session_019xHEXrJAhWZJgUVp4v1w8p | 2026-11-15 16h30 |
| L4 | designer-ux, modulo-catalogo | kit e catálogo de #366, #367, #382, #387, onda 1, Sincronizar, fonte e busca do catálogo | `nuvem/T-0174-designer-ux`, `carga-frases-designer-ux-v4`, `catalogo-v1013-designer-ux-b`, `sync-completa-designer-ux`, `T-0174-modulo-catalogo`, `catalogo-v1013-modulo-catalogo-onda1`, `fonte-sistema-modulo-catalogo-pr`, `busca-marca-ref-modulo-catalogo` | conta nova, session_019xHEXpfo9hF3FwkT9jFWRk | 2026-11-15 16h30 |
| L5 | banco-dados, engenheiro-software, modulo-vendedor, modulo-integracao | carga 0081 e SDK das frases, T-0174 banco/plataforma, docs de 15/11, fonte do vendedor | `nuvem/carga-frases-banco-dados-v6`, `carga-frases-engenheiro-software-v7`, `T-0174-banco-adr0058`, `T-0174-engenheiro-software`, `docs-regras-1511-*`, `fonte-sistema-modulo-vendedor-pr` | conta nova, session_019xHEXsTZHFASgGQtM4kfkU | 2026-11-15 16h30 |
| L7 | modulo-integracao | conversor dos CSVs da thathyany (kit) | `nuvem/v1013-csv-thathyany-modulo-integracao` | conta nova, session_019xHEXqYGjX3qympAQnRTsY | 2026-11-15 17h50 |
| L6 | corretor-redundancias, design-de-marca | `docs/qualidade/redundancias/**`, `docs/marca/**` (pareceres v1.0.12/v1.0.13 e regras da fonte no manual) | `nuvem/v1013-pareceres-corretor-redundancias`, `nuvem/v1013-pareceres-design-de-marca` | conta nova, session_019xHEXoKagvotNxpZHQSNwQ | 2026-11-15 16h31 |
| N1 | banco-dados | `db/**`, `docs/banco/**`, `modules/*/db/**` | `nuvem/v1014-*-banco-dados` | conta nova, session_019xHEXs1QQawy5WjArBfqTZ | 2026-11-15 16h30 |
| N2 | engenheiro-software | `packages/platform-sdk/**`, `packages/comum/**`, `apps/api/**`, `docs/decisoes/**`, `docs/desenho/**`, `.coord/contratos/**`, `scripts/deploy/**` | `nuvem/v1014-*-engenheiro-software` | conta nova, session_019xHEXsTypiamCHw7nkkHyF | 2026-11-15 16h30 |
| N3 | modulo-vendedor, modulo-integracao | `modules/vendedor/**`, `modules/integracao/**`, `apps/conector/**` (menos `modules/*/db/**`) | `nuvem/v1014-*-modulo-vendedor`, `nuvem/v1014-*-modulo-integracao` | conta nova, session_019xHEXt2Ab1EsAyLPofMWSi | 2026-11-15 16h30 |
| N4 | modulo-core, modulo-gestor | `modules/core/**`, `modules/gestor/**` (menos `modules/*/db/**` e os arquivos da L1) | `nuvem/v1014-*-modulo-core`, `nuvem/v1014-*-modulo-gestor` | conta nova, session_019xHEXpQMD1MLrvrR4e1FqU | 2026-11-15 16h30 |
| N5 | engenheiro-apps, designer-ux | `apps/web/**`, `apps/mobile/**`, `packages/ui/**`, `docs/design/**` (menos os arquivos da L3 e da L4) | `nuvem/v1014-*-engenheiro-apps`, `nuvem/v1014-*-designer-ux` | conta nova, session_019xHEXonoo8ujZvMy8Bk69C | 2026-11-15 16h30 |
| N6 | modulo-catalogo, modulo-pesquisa, modulo-promotor, modulo-treinamento | `modules/{catalogo,pesquisa,promotor,treinamento}/**` (menos `modules/*/db/**` e os arquivos da L4) | `nuvem/v1014-*-modulo-<m>` | conta nova, session_019xHEXs2YNCFCb29RoFrasE | 2026-11-15 16h30 |
| N7 | testes | `tests/**`, `docs/testes/**` | `nuvem/v1014-*-testes` | conta nova, a abrir quando os PRs de código existirem | — |
| N8 | corretor-redundancias, design-de-marca | `docs/qualidade/redundancias/**`, `docs/marca/**` | `nuvem/v1014-pareceres-*` | conta nova, session_019xHEXs6eBVQkAQVGXk8Ged | 2026-11-15 17h01 |
| gerente | gerente-projetos | `.coord/quadro.md`, `.coord/tarefas/**`, `docs/produto/**` | `nuvem/v1014-*-gerente-projetos` | conta nova, session_019xHEXs75xqGq9m52u565UD | 2026-11-15 16h15 |

## Travado pela nuvem
| Caminho | Tarefa | Branch | Desde |
|---|---|---|---|
| `docs/desenho/tracking.md`, ADR nova do tracking (próximo número livre) e `docs/legal/**` (novos) | T-0156 (N20) tracking contínuo e base LGPD, retomada pela conta nova (session_019xHEXs8jSESDD7n7NnhckY) | `nuvem/T-0156-tracking-lgpd-engenheiro-software` | 2026-11-15 17h56 |
| `modules/integracao/kit-thathyany/scripts/` (conversor novo) e o zip em `recados/anexos/` do repositório de recados | L7 CSVs da thathyany no modelo novo do kit (R-20261115-174800-alexandre), session_019xHEXqYGjX3qympAQnRTsY | `nuvem/v1013-csv-thathyany-modulo-integracao` | 2026-11-15 17h50 |

As sessões da conta nova (L1–L7, N1–N8) estão na tabela "Conta nova — todo o lote", acima.
Nenhuma sessão altera caminho listado aqui. Destravar quando o merge chegar no `main`.
Destravados em 2026-11-15 17h56 (conta nova; já no main ou superados): T-0116 (N15, #113), T-0104 (N16, #112), T-0122 (N17: guardião v7 e `carga-t0107.yml` no main), T-0157 (N21, #115), T-0169 (#116), T-0170 N-A, N-B, N-C, N-G e N-I (#158–#166), T-0171 N-J. A T-0156 (N20) foi retomada (linha acima).
Destravados em 2026-11-08 13h40 (PRs da nuvem já no main; o N14 entrou pelo #111): T-0108 (N4), T-0094 (N5), T-0109 (N6), T-0096 (N7), T-0099 (N8), T-0097 (N9), T-0105 (N10), T-0101 (N11), T-0102 (N12), T-0105 (N13), T-0107 (N14).
Destravados em 2026-11-05: T-0072 visual (`modules/core/app/**` PR #94 21aa690, regra A, revisões do designer-ux e do engenheiro-software sem 🔴); T-0072 visual (`modules/promotor/app/**` PR #91 7f97cd2; `modules/treinamento/app/**` PR #92 0be65bf; `modules/pesquisa/app/**` PR #93 ae7b7ce). Destravados em 2026-11-03: T-0067/T-0068 (`modules/core/{api,contracts,domain,web}/**`, PRs #82 faad794 e #83 ac4ca3b); T-0069 (`modules/promotor/{api,contracts,domain,web}/**`, PR #81, 4d6b443). Destravados em 2026-11-02: T-0054 (`modules/vendedor/**`, PR #44, f894246); T-0055 (`modules/gestor/**`, PR #40, ad7f643); T-0058 (`modules/treinamento/**`, PR #42, d64dd76); T-0057 (`modules/pesquisa/**`, PR #43, 15698e6); T-0056 (`modules/promotor/**`, PR #41, 2bacad4); T-0051 (`modules/integracao/web/**`, PR #38, cf13f6d); T-0053 (`modules/vendedor/**`, PR #39, 4067742; travado de novo pela T-0054) e T-0052 etapa 1 (`modules/catalogo/**`, PR #45, 39a7e9c); T-0050 (`.claude/hooks/**`, `.claude/settings.json`, `scripts/coord*.mjs`; 7d87a32). Destravados em 2026-11-01: T-0046 (`modules/gestor/**`, PR #33); T-0048 (`apps/conector/**`, `conector.md`; 12e45b3) e T-0049 (`.github/**`, `scripts/ci/**`; 78cce46); T-0044 (`.claude/hooks/**`, `.claude/settings.json`, `scripts/coord*.mjs`; f86f59b) e T-0043 (`packages/config/**`, `packages/comum/**`, `eslint.config.*`; dd9ff94); T-0033 (`.github/**`, `turbo.json`, `package.json` da raiz, `scripts/**`; fa6d5fa) e T-0040 (`modules/promotor/contracts|domain/**`, 3090263); T-0036 (`modules/treinamento/**`, 789a191) e T-0037 (`modules/core/domain|contracts/**`, 4c08b91). Destravados em 2026-10-31 (merges no main): `scripts/coord*.mjs` e `.claude/**` (T-0005, 23b4192); T-0011, T-0008 parte 1 e T-0005 casos A–B (dcc044d, 0d1c8a1, 3215b2f); T-0007, T-0012 e `.claude/hooks/**` (6fba044, f4fdbe5, d277a55); T-0011 v2 (9f06e77); guardião v2 (c2f0005) e v3 (5d7e317); T-0013 (`apps/conector/**`, 588da33 — travado de novo pela T-0023); `.claude/settings.json` (PostToolUse religado). T-0021 ajustes (`modules/catalogo/...`, 7b3bb50). Push liberado (main, nuvem/*, alexandre/*, agente/*; sem force/delete).
Regras: `docs/produto/07-agentes-e-coordenacao.md`, seção "Frentes de trabalho: local e nuvem".

## ✅ Main verde desde 2026-11-01 (CI 41286326232, todas as suítes rodando)
Causas corrigidas: teste de db dependente da hora (banco-dados); S1-043c era tempo do teste, não duplicação (testes, core); CI com --continue (engenheiro); commit de rodada por dono (doc 07).

## Meta: fechar a Sprint 0 até sexta, 06/11 (Alexandre, R-20261031-103502)
1. **T-0004** (shells com os 8 módulos, `createApp`, EAS, pendências da T-0002 §6) → **T-0003 Fase 2** (T-0007 já mergeada) → **execução da T-0006** e relatório da Sprint 0.
2. Ajustes pendentes: só os do backlog.
3. Concluídas: T-0001, T-0002, T-0003, T-0005, T-0006, T-0007, T-0009, T-0010, T-0011, T-0012. **Sprint 0 fechada em 2026-11-01** (APKs de desenvolvimento gerados). T-0004 em teste.

## Sprint 1 — Core (planejada em 2026-10-31; meta do roadmap: modo avião — abrir cliente, rota e fazer check-in; sincroniza depois)
Ordem (ondas do desenho, docs/desenho/T-0016.md §9): onda 1 banco lote A + core contratos/domínio + engenheiro E1–E3 (após T-0015) → onda 2 T-0017 + vendedor pull + E4 → onda 3 T-0018 + T-0008 P3/P5 → onda 4 T-0019 + T-0022 (+ T-0020 fase 1) → onda 5 testes e revisão.

| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0028](tarefas/T-0028.md) | Matriz de testes ponta a ponta da demo | testes | local | concluida (tests/plano/demo-matriz.md) |
| [T-0030](tarefas/T-0030.md) | BKO: páginas da Fase M na API nova (Rotas, Clientes, Metas, RV, Auditoria) | modulo-core | local | concluida (Rotas migrada · 3 páginas "em construção" · Auditoria e F5 · Playwright na raiz) |
| [T-0029](tarefas/T-0029.md) | Fatia vertical do pedido para a demo (com PDF) | engenheiro-software | local | concluida (8cf1021 · CI verde · APKs preview campo 6490e5e6 e gestão c0bf3d91) |
| [T-0026](tarefas/T-0026.md) | Demonstração com o gestor externo (prioridade) | engenheiro-software | local | concluida (APKs de preview + scripts + túnel · docs/status/demo.md) |
| [T-0015](tarefas/T-0015.md) | Ajustes pós-Sprint 0: O-3 (promotor lê pedidos da carteira) e D-1 | engenheiro-software | local | concluida (O-3 e D-1 provados com Postgres) |
| [T-0016](tarefas/T-0016.md) | Desenho técnico e contratos da Sprint 1 | engenheiro-software | local | concluida (aprovado; ADRs 0009/0010) |
| [T-0017](tarefas/T-0017.md) | Carteira e Cliente 360 | modulo-core | local | concluida (critérios ✅ · revisão final sem 🔴) |
| [T-0018](tarefas/T-0018.md) | Rotas e visitas reais, sync de visita e pedido (D-2) | modulo-core | local | concluida (🔴 da revisão corrigido · D-2..D-5 fechados · meta da sprint demonstrada) |
| [T-0019](tarefas/T-0019.md) | Central de notificações | modulo-core | local | concluida (revisão sem 🔴 · push real depende do EAS) |
| [T-0020](tarefas/T-0020.md) | Metas e indicadores básicos — só fase 1 | modulo-core | local | concluida (fase 1 · revisão sem 🔴 · realizado de venda nas Sprints 4–5) |
| [T-0022](tarefas/T-0022.md) | Despachante da outbox (onda 4) | engenheiro-software | local | concluida (revisão sem 🔴) |
| [T-0008](tarefas/T-0008.md) | Adaptador SQLite no aparelho — parte 2 | engenheiro-software | local | em_teste (05/11: expo-sqlite pela ADR 0023 no main; tela oculta de medição nos APKs desde o 68ea7d9; leituras novas do motor e índices v2 do Catálogo; faltam os números da medição no aparelho) |

## Adiantadas (domínio sem banco/telas) e backlog de outras sprints
| Tarefa | Título | Responsável | Onde | Status |
|---|---|---|---|---|
| [T-0007](tarefas/T-0007.md) | Produto no dono definitivo (ADR-0005) | engenheiro-software | nuvem → local (merge 6fba044) | concluida (🔴 da fixture corrigido · 🟡 aplicados · API 37/37 com banco) |
| [T-0011](tarefas/T-0011.md) | Treinamento — domínio (trilhas, XP, níveis, medalhas, ranking) | modulo-treinamento | nuvem → local (merge 9f06e77) | concluida (230 testes · revisão sem 🔴 · RN-TRE-01..08 aplicadas) |
| [T-0012](tarefas/T-0012.md) | Pesquisa — domínio | modulo-pesquisa | nuvem → local (merge f4fdbe5) | concluida (215 testes · revisão sem 🔴 · decisões do Alexandre aplicadas · cliente fechado via RN-CORE-14) |
| [T-0013](tarefas/T-0013.md) | Conector v1 (lado do cliente) — Sprint 2 | modulo-integracao | nuvem → local (merges a7cd2fe, 588da33) | concluida (revisões do dono e do engenheiro sem 🔴 · correções na T-0023) |
| [T-0014](tarefas/T-0014.md) | Gestor — domínio — Sprint 6 | modulo-gestor | nuvem → local (merges b379fe6, f29ad65) | concluida (🔴 da revisão corrigidos na T-0046, PR #33) |
| [T-0021](tarefas/T-0021.md) | Catálogo — domínio — Sprint 3 | modulo-catalogo | nuvem → local (merges 706a31e, 7b3bb50) | concluida (236 testes · revisões do dono e do engenheiro sem 🔴) |
| [T-0023](tarefas/T-0023.md) | Conector: ajustes v1.1 e adaptador Oracle — Sprint 2 | modulo-integracao | nuvem → local (merges bb308bf, e5cb1b9) | concluida (🔴 da nota faturada 2x corrigido na T-0048, 12e45b3; lado do Hub na T-0032) |
| [T-0024](tarefas/T-0024.md) | Payload dos eventos no contracts de cada módulo — Sprint 2 | engenheiro-software | local | concluida (main 6113a9b, lote C2: eventos de todos os módulos no contracts, catraca sem pendentes, subpath @macuxi/platform-sdk/eventos; CI 41987438862 verde; revisão sem 🔴) |
| [T-0025](tarefas/T-0025.md) | Hub /integracao/v1 — desenho, contratos e domínio — Sprint 2 | modulo-integracao | nuvem → local (merge c77278f) | concluida (🔴 do hash → SHA-256 corrigido na T-0032) |
| [T-0027](tarefas/T-0027.md) | Conector ↔ Hub: alinhamento — Sprint 2 | modulo-integracao | nuvem (PR #24, fa837c4) | concluida (falta só a revisão do PR #24 pelo engenheiro, na T-0032) |
| [T-0033](tarefas/T-0033.md) | CI e testes mais rápidos (paralelo, cache Turborepo, banco modelo) — Sprint 2 | engenheiro-software | nuvem (PR #26, fa6d5fa) | concluida |
| [T-0032](tarefas/T-0032.md) | Hub /integracao/v1 — rotas e banco — Sprint 2 | engenheiro-software, banco-dados | local | concluida (0 🔴 · e2e do ciclo com ERP simulado 9f7b165 · carga por arquivo 6f58c94 · core.medidas@1 no Hub e2a066a) |
| [T-0031](tarefas/T-0031.md) | Hub P-3/P-4 e mensagem do Conector conflitante (P-6) — Sprint 2 | modulo-integracao | nuvem (PR #25, 697ab42) | concluida (rotas na T-0032) |
| [T-0034](tarefas/T-0034.md) | engenheiro-apps: next-env definitivo, abas ⛔ dos shells, revisão das telas da T-0029 — Sprint 2 | engenheiro-apps | local | concluida (ajustes da revisão em 13550ad) |
| [T-0035](tarefas/T-0035.md) | Vendedor: 🟡 da T-0029 (fronteira do fuso, /alcadas sem promotor) — Sprint 2 | modulo-vendedor | local | concluida (3 itens no main em 01/11, com a T-0042) |
| [T-0036](tarefas/T-0036.md) | Treinamento: 🟡 e 🟢 da revisão final — Sprint 2 | modulo-treinamento | nuvem (PR #28, 789a191) | concluida |
| [T-0037](tarefas/T-0037.md) | Core: RN-CORE-12 como função pura no domain — Sprint 2 | modulo-core | nuvem (PR #27, 4c08b91) | concluida |
| [T-0038](tarefas/T-0038.md) | Domínio fixo da demo (api-demo/bko-demo.macuxifdv.com.br) — Sprint 2 | engenheiro-software, engenheiro-apps | local (depois do main verde) | concluida (api-demo/bko-demo.macuxifdv.com.br em uso na demo de 03/11) |
| [T-0039](tarefas/T-0039.md) | Checkout validado na API (RN-CORE-12) — Sprint 2 | engenheiro-software, modulo-core | local (destravada; depois da T-0038) | em_teste (05/11: alerta no Gestão, subtipo e baixa, chip na Rota e aviso na ficha no main f0dcf03; D-T0039d da fila do motor corrigido; testes do aparelho verdes no CI; falta a conferência no APK; Ver fila, Gestão §2.2 e selo do BKO no backlog) |
| [T-0040](tarefas/T-0040.md) | Promotor: payloads Zod dos eventos promotor.*@1 — Sprint 2 | modulo-promotor | nuvem (PR #30, 3090263) | concluida |
| [T-0041](tarefas/T-0041.md) | Catálogo: timeout real do provedor de IA — Sprint 2 | modulo-catalogo | nuvem (PR #29, b8cae16) | concluida |
| [T-0042](tarefas/T-0042.md) | "Hoje" no fuso do tenant (C6, produção) e testes com hora fixa — Sprint 2 | modulo-core, banco-dados, modulo-vendedor | local | concluida (revisão 0 🔴, R-20261102-095308; 🟡 da carteira com o modulo-core) |
| [T-0043](tarefas/T-0043.md) | Prevenção de hora fixa: relógio de teste e lint (sem o job do CI) — Sprint 2 | engenheiro-software | nuvem (PR #34, dd9ff94) | concluida (lint vira erro em 16/11) |
| [T-0044](tarefas/T-0044.md) | Guardião v5: gh pr merge só com trava — Sprint 2 | alexandre | nuvem (PR #31, f86f59b) | concluida |
| [T-0045](tarefas/T-0045.md) | Revisões pendentes do engenheiro (T-0014, T-0023, T-0025) — Sprint 2 | engenheiro-software | nuvem (PR #32, 2903882) | concluida (🔴 encaminhados) |
| [T-0046](tarefas/T-0046.md) | Gestor: espelhos de eventos + 🔴/🟡 da revisão da T-0014 — Sprint 2 | modulo-gestor | nuvem (PR #33) | concluida |
| [T-0047](tarefas/T-0047.md) | Busca do Catálogo de ponta a ponta (próximo APK de demo) — Sprint 2 | modulo-catalogo (+ eng-software, banco, eng-apps, testes) | local (depois da T-0038) | concluida (busca online e offline no smoke da demo, S2a/S2b) |
| [T-0048](tarefas/T-0048.md) | Conector 1.2.1: nota faturada sem itens repetidos (🔴 da T-0023) — Sprint 2 | modulo-integracao | nuvem (PR #36, 12e45b3) | concluida |
| [T-0049](tarefas/T-0049.md) | Brechas do guardião v5 no CI — Sprint 2 | engenheiro-software | nuvem (78cce46) | concluida |
| [T-0050](tarefas/T-0050.md) | Guardião v6 — Sprint 2 | alexandre | nuvem (PR #37, governança) | concluida |
| [T-0051](tarefas/T-0051.md) | Integração: monitor básico no BKO — Sprint 2 | modulo-integracao | nuvem (PR #38, cf13f6d) | concluida |
| [T-0052](tarefas/T-0052.md) | Catálogo de ponta a ponta: rota de busca, ficha, telas do app e BKO de conteúdo — Sprint 3 | modulo-catalogo | nuvem (PR #45, 39a7e9c) | concluida (etapa 1 39a7e9c; etapa 2, aba e atalho, em de7eb65) |
| [T-0053](tarefas/T-0053.md) | Vendedor parte 1: pré-venda e envio ao ERP pelo Hub — Sprint 4 | modulo-vendedor | nuvem (PR #39, 4067742) | concluida (Vendedor parte 1; a parte da T-0061 segue no local e na T-0054) |
| [T-0054](tarefas/T-0054.md) | Vendedor parte 2: retorno do ERP, faturado no app e devolução — Sprint 5 | modulo-vendedor | nuvem (PR #44, f894246) | concluida |
| [T-0055](tarefas/T-0055.md) | Gestor: rotas e telas (painéis, ranking, aprovações, pedido em nome) — Sprint 6 | modulo-gestor | nuvem (PR #40, ad7f643) | concluida (migração 0014 no PR #46) |
| [T-0056](tarefas/T-0056.md) | Promotor: rotas das coletas e telas da Loja — Sprint 7 | modulo-promotor | nuvem (PR #41, 2bacad4) | concluida (migração 0015 no PR #49) |
| [T-0057](tarefas/T-0057.md) | Pesquisa: construtor no BKO, resposta no app e resultados — Sprint 7 | modulo-pesquisa | nuvem (PR #43, 15698e6) | concluida (migração 0016 no PR #47) |
| [T-0058](tarefas/T-0058.md) | Treinamento: rotas, jornada no app e BKO — Sprint 8 | modulo-treinamento | nuvem (PR #42, d64dd76) | concluida (migração 0017 no PR #48) |
| [T-0060](tarefas/T-0060.md) | Cadastro mínimo do cliente (RN-CORE-16/17, RN-VEN-13, RN-INT-14) — Sprint 4 | modulo-core | local (+ Vendedor na T-0053) | concluida (cadastro mínimo no Core, Hub e app; RN-VEN-13 do incompleto na T-0071; "bloqueado" no core.cadastro_resumo@1 vai com a T-0073) |
| [T-0061](tarefas/T-0061.md) | Novo pedido: árvore, UN/CX, desconto e acréscimo por item, frete, entrega — Sprint 4 | modulo-vendedor | misto (desenho e schema local; telas na T-0052/T-0053) | concluida (#75 45d8447, #65 a42c3f5, promotor_ve_pedidos na API e no pull; a versão nova das 3 abas + orçamento segue na T-0071) |
| [T-0062](tarefas/T-0062.md) | Produto: custo, preço, margem e desconto máximo (preço mínimo) — Sprint 4 | modulo-core | local (+ Vendedor) | concluida (domain produto-preco e cadastro do produto no BKO, 04e0bc6; teto do preço mínimo no novo pedido da T-0071) |
| [T-0063](tarefas/T-0063.md) | Cadastro de medidas do produto e medida no pedido — Sprint 4 | modulo-vendedor | local + nuvem | concluida (0018 c1fc58c · BKO de medidas e core.medidas@1 70b6999 · medida no pedido no #75 · Hub com medidas e2a066a · seed da demo 3b61a43) |
| [T-0067](tarefas/T-0067.md) | BKO de usuários e hierarquia — demo das 15h | modulo-core | nuvem (PR #82) | concluida (revisão sem 🔴 · mesclado em faad794 · 🟡 para depois da demo) |
| [T-0068](tarefas/T-0068.md) | BKO de metas (Metas e RV sai do "em breve") — demo das 15h | modulo-core | nuvem (PR #83) | concluida (revisão sem 🔴 · mesclado em ac4ca3b · 🟡 para depois da demo) |
| [T-0069](tarefas/T-0069.md) | Cadastros de trade no BKO — demo das 15h | modulo-promotor | nuvem (PR #81) | concluida (revisão sem 🔴 · mesclado em 4d6b443 · preço do concorrente na 0020) |
| [T-0071](tarefas/T-0071.md) | Novo pedido em 3 abas (Itens · Detalhes · Resumo) e orçamento (RN-VEN-18) — Sprint 4 | modulo-vendedor | local | em_andamento (fatias 1–5 no main em 04/11, e2064a0; 🟡 de Transformar/Duplicar e usaConsultas sugestoes_pedido@1 resolvidos e fatia 6 em estrutura — 3 abas, folha do Salvar, chips Pedidos/Orçamentos — no main e626d0b; restante da fatia 6 com o modulo-vendedor, integração do orçamento e demo-no-ar com o testes) |
| [T-0072](tarefas/T-0072.md) | Novo visual do app (tokens, botões em níveis, folha, movimento) no Campo e no Gestão — Sprint 4 | designer-ux | local (base e shell) + nuvem (telas dos módulos fora da T-0071) | em_andamento (04/11 23h: PRs da nuvem do visual #91 promotor 13e65a3, #92 treinamento 6fe1a6f, #93 pesquisa 333b3a6 prontos e #94 core a7ecfde aberto, todos só em modules/<m>/app/**; revisões designer-ux + engenheiro-software e merge pela regra A na ordem #91→#92→#93→#94 (R-20261104-231124/231147/231218/231248); base do visual no main 79dc3db em 04/11; transições do shell e BarraAbas com o engenheiro-apps) |
| [T-0073](tarefas/T-0073.md) | Tela de boas-vindas (Início) do Campo e do Gestão — RN-CORE-26 — Sprint 4 | modulo-core | local (0021, shell, Gestor) + nuvem (Core, `nuvem/T-0073-boas-vindas`, 9a9a907) | em_andamento (passo 7 e positivação do mês no main b0e0462; pendente: quem grava indicador_diario e o 🟢 do app do Core, travado pela nuvem) |
| [T-0074](tarefas/T-0074.md) | Ambiente demo/homologação na Magalu Cloud (VM, Compose, túnel novo, CI/CD, Object Storage, backup) — Sprint 9 | engenheiro-software | local + GitHub Actions | em_andamento (ADR 0020 proposta, compose, Dockerfile da API, workflows e adaptador S3 no main e626d0b (Dockerfile do BKO com o engenheiro-apps); primeiro deploy pelo workflow demo-publicar; backup com o banco-dados) |
| [T-0075](tarefas/T-0075.md) | Teste de compatibilidade do DBaaS PostgreSQL da Magalu em instância temporária — Sprint 9 | banco-dados | local × instância temporária | em_andamento (05/11: 3 execuções no DBaaS — compatível com o plano B, que está no main fb1ef19; suíte 898 ✅ e arnês ajustado; ADR 0024 proposta; falta o custo do BV1-4-10 para virar aceita; instância pode ser apagada) |
| [T-0076](tarefas/T-0076.md) | Início pela referência aprovada (boas-vindas, recados, meta, orçamentos, a faturar, Sincronizar) e Cliente 360 sem Ver catálogo — Sprint 9 | modulo-core | local | em_teste (no main aab84fa, lote 2; CI e deploy da demo verdes; APK final Campo a9cc6469 e Gestão 6f506651 do aab84fa; espera o teste do dono do produto) |
| [T-0077](tarefas/T-0077.md) | Pedidos: busca, período Dia/Mês/Ano, uma linha de situações; Gestão com filtro por vendedor — Sprint 9 | modulo-vendedor | local | em_teste (no main aab84fa, lote 2; D1 e D2 corrigidos; no APK final do aab84fa; item 6 no backlog) |
| [T-0078](tarefas/T-0078.md) | Robustez essencial: checklist de segurança e LGPD, observabilidade mínima e carga básica do sync — Sprint 9 | engenheiro-software | local | em_andamento (no main b0e0462: /v1/saude com dependências, métricas, 0024 LGPD e RLS, testes L1/C1; D-L1a e D-C1a com o engenheiro-software; decisões G1/G3 do dono do produto) |
| [T-0079](tarefas/T-0079.md) | App percebe a base recriada (geracao_base) e apaga o que o servidor não tem mais, sem perder a fila — Sprint 9 | engenheiro-software | local | em_teste (no main b0e0462: geracao_base 0022, SDK, API e aparelho; teste ponta a ponta 12 casos sem banco; falta a parte com Postgres e o APK) |
| [T-0080](tarefas/T-0080.md) | Positivação do mês com o Vendedor desligado: fonte nas notas do ERP — Sprint 9 | engenheiro-software | local | em_teste (main 6113a9b: RN-CORE-27, 0025, consumidor e Início pela licença do tenant; testes de integração no CI; premissas ao dono do produto) |
| [T-0081](tarefas/T-0081.md) | Farol de clientes no BKO — Sprint 9 | modulo-core | local | concluida (05/11: BKO do Farol no main 9e5e931 e ajustes até f702090; RN-CORE-28 pela licença do tenant, CSV protegido contra fórmula, 422 para mês futuro; UX e revisão final sem 🔴; testes de perfil, escopo, tenant e licença verdes no CI) |
| [T-0082](tarefas/T-0082.md) | Plano de RV no BKO — Sprint 9 | modulo-core | local | em_teste (05/11: 0028, API, BKO e RV pela licença do tenant (ADR 0025) no main; cartão Minha RV no app no f0dcf03 (RN-CORE-30: vendedor e promotor veem a própria); revisões sem 🔴; falta a conferência no APK do f0dcf03) |
| [T-0083](tarefas/T-0083.md) | Onboarding de tenant — Sprint 9 | engenheiro-software | local | concluida (05/11: 0029 no main c6a60b5, pnpm tenant:criar no 9e5e931 com a política do Core; isolamento do tenant novo 11/11 verde no CI; RN-CORE-31; revisão sem 🔴) |
| [T-0084](tarefas/T-0084.md) | Aplicação do produto (descrição 2): cadastro, busca com ano em faixa, orçamento e pedido — Sprint 9 | engenheiro-software, banco-dados, modulo-catalogo, modulo-vendedor, modulo-integracao | local (A, B) + nuvem (C `nuvem/T-0085-exportacao-bko`, D `nuvem/T-0085-lista-por-linha`) | em_andamento (06/11 22h31: critérios 2, 3 e 7 no main; critério 5 com a pré-seleção FTS5 e a tela de medição no main, falta medir no APK; depende também da T-0088) |
| [T-0085](tarefas/T-0085.md) | Catálogo do cadastro: referência cruzada, oferece junto, lista por linha, busca pelo código do concorrente, exportação PDF/Excel — Sprint 9 | engenheiro-software, banco-dados, modulo-catalogo, modulo-promotor, modulo-integracao | local (A, B) + nuvem (C `nuvem/T-0085-exportacao-bko`, D `nuvem/T-0085-lista-por-linha`) | em_andamento (07/11 11h30: C #96 e D #95 no main em ad56fa09 e 7a43e824; atalho "Ver por linha" com o modulo-catalogo; depois, o build único) |
| [T-0086](tarefas/T-0086.md) | Produção na Magalu: pronta para ligar às 8h de 06/11, no ar até 12h (compose, publicar por tag + aprovação, DBaaS plano B, backup e restauração, alertas, EAS production) — Sprint 9 | engenheiro-software, banco-dados, engenheiro-apps | local | em_andamento (06/11 22h31: tudo no main, inclusive os workflows de produção aprovados; falta o dono do produto criar os recursos e avisar) |
| [T-0087](tarefas/T-0087.md) | Portal de implantação config.macuxifdv.com.br (empresa, equipe e bases por CSV, integração automática) — Sprint 9 | engenheiro-apps, modulo-core, modulo-integracao, engenheiro-software | local (P, E) + nuvem (N1 `nuvem/T-0087-modelos-csv`, N2 `nuvem/T-0087-openapi`, N3 `nuvem/T-0087-carga-em-partes`) | em_andamento (07/11 12h: N1 #97 no main em 4694563d, N2 #99 em d27f7903, N3 antes; portal P com os 🟡 de UX e de segurança e config-demo no main em d0201f7a; falta a §4b do carga-arquivo.md e o aceite ponta a ponta na produção) |
| [T-0088](tarefas/T-0088.md) | SQLite no motor de sync do app (Campo e Gestão), para a busca offline com 20 mil produtos (critério 5 da T-0084) — Sprint 9 | engenheiro-software, engenheiro-apps, banco-dados, modulo-catalogo, testes | local | em_teste (07/11 0h54: no main em e9a65286, CI verde e demo publicada; APK de preview em build; falta a conferência e a medição no aparelho) |
| [T-0089](tarefas/T-0089.md) | Novo pedido: aba Itens revisada; formas de pagamento e prazos com prazo médio; tabela escalonada; crédito do cliente em Detalhes; bug do + — Sprint 9 | engenheiro-software, banco-dados, modulo-vendedor, modulo-core, modulo-integracao, engenheiro-apps, designer-ux, testes | local | em_teste (07/11 11h: B2, as views-modelo do Conector, no main em 638faa69 com revisão sem 🔴; 06/11 22h31: no main em 5a1848a9, com CI e stack verdes e revisões sem 🔴; falta a conferência do dono do produto no APK e a base demo recriada) |
| [T-0090](tarefas/T-0090.md) | Pedidos: filtro de período num botão só (modelo A) e troca sem atraso (< 100 ms) — Sprint 9 | modulo-vendedor, designer-ux, engenheiro-apps, testes | local | em_teste (07/11 11h: 🟡 de UX no main em 638faa69, reconferência sem 🔴; falta a conferência no APK do próximo build único) |
| [T-0091](tarefas/T-0091.md) | Super-admin em papel de banco próprio (condição da ADR 0029, antes do 1º cliente real) — Sprint 10 | engenheiro-software, banco-dados, modulo-core, testes | local | em_teste (07/11 13h30: diffs aprovados e aplicados, main d1e0d2ad com CI e stack verdes; portal da demo responde 401 pelo macuxi_portal; falta o secret e a rota config-demo, do dono do produto, e o 1º acesso) |
| [T-0092](tarefas/T-0092.md) | Hub: openapi.json público, ajv/ajv-formats devDependency, hub-api.md §15 (pendências do #99) — Sprint 10 | engenheiro-software, modulo-integracao | local | em_revisao (07/11 11h: no main em 638faa69, revisão final sem 🔴, matriz em docs/testes/T-0092.md; fecha com o CI do main verde e o botão do portal no lote seguinte) |
| [T-0093](tarefas/T-0093.md) | Portal config.: login só com e-mail e senha (8+ com letra, número e especial), sem convite e sem TOTP, com escolha de empresa — Sprint 10 | engenheiro-software, banco-dados, modulo-core, engenheiro-apps, designer-ux, testes | local | em_andamento (07/11 15h: desenho com o engenheiro-software) |
| [T-0094](tarefas/T-0094.md) | Acesso e senhas: admin cria usuários no BKO com senha inicial por e-mail, troca no 1º uso, Esqueci a senha no app, reset pelo BKO; vendedor e supervisor sem BKO e sem config — Sprint 10 | engenheiro-software, banco-dados, modulo-core, engenheiro-apps, designer-ux, testes | local | em_andamento (07/11 18h: desenho e ADR 0032 prontos; fatia B rodando; C, U e N5 em seguida) |
| [T-0095](tarefas/T-0095.md) | ERP: guarda de ordem nos consumidores e não reativar o que o admin desligou — Sprint 10 | banco-dados, modulo-core, modulo-catalogo, modulo-integracao | local | aberta (07/11 17h: esteira, 1ª depois do build único (antes do 1º tenant real)) |
| [T-0096](tarefas/T-0096.md) | Catálogo: faixa aberta de ano no índice local (prazo 31/12/2026) — Sprint 10 | modulo-catalogo | nuvem | aberta (07/11 17h: esteira, em paralelo, já) |
| [T-0097](tarefas/T-0097.md) | Catálogo: miniatura do produto no contrato do pull, baixada sob demanda — Sprint 10 | modulo-catalogo, engenheiro-software | nuvem | aberta (07/11 17h: esteira, em paralelo, já) |
| [T-0098](tarefas/T-0098.md) | Portal: download do Conector por link temporário de bucket privado — Sprint 10 | engenheiro-software, modulo-integracao, engenheiro-apps | local | aberta (07/11 17h: esteira, 2ª depois do build único) |
| [T-0099](tarefas/T-0099.md) | Conector: aviso de ordem divergente e opt-in "nulo: limpa" por campo — Sprint 10 | modulo-integracao | nuvem | aberta (07/11 17h: esteira, em paralelo, já) |
| [T-0100](tarefas/T-0100.md) | BKO: carga por arquivo self-service e modelos CSV liberados ao admin da empresa — Sprint 10 | modulo-integracao, engenheiro-apps, designer-ux | local | aberta (07/11 17h: esteira, 3ª depois do build único) |
| [T-0101](tarefas/T-0101.md) | Vendedor: triagem de 05/11 e acabamento visual de Início, Cliente 360 e Pedidos — Sprint 10 | modulo-vendedor, modulo-core, designer-ux | local | aberta (07/11 17h: esteira, 4ª depois do build único) |
| [T-0102](tarefas/T-0102.md) | Core: etapa pendente, positivação do mês, base recriada no app, RN-CORE-12 no domain, canApprove no SDK, limpeza de sessões — Sprint 10 | modulo-core, banco-dados, engenheiro-software | local | aberta (07/11 17h: esteira, 5ª depois do build único) |
| [T-0103](tarefas/T-0103.md) | Integração: aplicar-lote com parâmetros do tenant e aviso de marca desconhecida no monitor — Sprint 10 | modulo-integracao, modulo-catalogo | local | aberta (07/11 17h: esteira, 6ª depois do build único) |
| [T-0104](tarefas/T-0104.md) | Kit: Tabs, Progress e ButtonLink; cartões das bases do portal com a última carga — Sprint 10 | designer-ux, modulo-integracao, engenheiro-apps | local | aberta (07/11 17h: esteira, 7ª depois do build único) |
| [T-0105](tarefas/T-0105.md) | Plataforma e CI: lint hora-fixa como erro (16/11), zod ≥ 4.6.6, job de desempenho, relógio deslocado, CI sem superusuário, feriados, gh no PATH do guardião — Sprint 10 | engenheiro-software, banco-dados | local | aberta (07/11 17h: esteira, o lint até 16/11; o resto em 8º) |
| [T-0106](tarefas/T-0106.md) | Treinamento: 🟡 da revisão final e tabela de lançamento de XP — Sprint 10 | modulo-treinamento, banco-dados | local | aberta (07/11 17h: esteira, 9ª) |
| [T-0107](tarefas/T-0107.md) | Carga com 20 mil SKUs e onboarding de tenant (antes do piloto real) — Sprint 10 | testes, engenheiro-software | local | aberta (07/11 17h: esteira, 10ª) |
| [T-0108](tarefas/T-0108.md) | Kit do TI do cliente: coleção Postman/Insomnia e exemplos em Node, C# e Python — Sprint 10 | modulo-integracao | nuvem | aberta (07/11 17h: esteira, em paralelo, já) |
| [T-0109](tarefas/T-0109.md) | Nome e versão dos builds (Campo-Demo-vX.Y.Z / Gestao-Demo-vX.Y.Z) — Sprint 10 | engenheiro-apps | nuvem | aberta (07/11 17h: esteira, em paralelo, já; precisa estar no main antes do build único) |
| [T-0110](tarefas/T-0110.md) | Backlog antigo (Sprints 0 a 2): conferir o que já foi feito e executar o resto — Sprint 10 | gerente-projetos, testes | local | aberta (07/11 17h: esteira, contínua, sem ocupar vaga de implementação) |
| [T-0111](tarefas/T-0111.md) | Perfis de acesso no BKO e motor de permissões por perfil (entra com a T-0094) — Sprint 10 | engenheiro-software, banco-dados, modulo-core, designer-ux, engenheiro-apps, testes | local | em_andamento (07/11 19h: desenho da tela enviado ao dono do produto; motor junto com a T-0094) |
| [T-0112](tarefas/T-0112.md) | Multiperfil: usuário com um ou mais perfis (RN-CORE-01) — Sprint 10 | banco-dados, modulo-core, engenheiro-software | local | aberta (07/11 19h: esteira, junto com a T-0111 (mesmo motor)) |
| [T-0113](tarefas/T-0113.md) | Cadastro de marcas no Catálogo (ADR que substitui a 0027) — Sprint 10 | engenheiro-software, banco-dados, modulo-catalogo, modulo-promotor | local | aberta (07/11 19h: esteira, logo depois da T-0094, antes do 1º cliente real) |
| [T-0114](tarefas/T-0114.md) | Cancelamento do pedido devolvido ao ERP (para ERPs que aceitam) — Sprint 10 | modulo-vendedor, modulo-integracao, engenheiro-software | local | aberta (07/11 19h: esteira, depois da T-0113) |
| [T-0115](tarefas/T-0115.md) | Campo "canal" no cliente do Core (público-alvo da Pesquisa) — Sprint 10 | banco-dados, modulo-core, modulo-pesquisa, modulo-integracao | local | aberta (07/11 19h: esteira, junto com a T-0114) |
| [T-0116](tarefas/T-0116.md) | Conector v2: atualização automática — Sprint 10 | modulo-integracao, engenheiro-software | local | aberta (07/11 19h: esteira, logo depois da T-0098 (mesma área)) |
| [T-0117](tarefas/T-0117.md) | BKO: refresh em cookie httpOnly (+ CSRF), no lugar do localStorage — antes de ligar a produção — Sprint 10 | engenheiro-software, engenheiro-apps | local | aberta (08/11 08h30: esteira, 1ª depois do build único) |
| [T-0118](tarefas/T-0118.md) | API: pool de conexões trava com pushes de pedido simultâneos (D-T0107a) — Sprint 10 | engenheiro-software, modulo-vendedor, modulo-core | local | aberta (08/11 08h30: esteira, 2ª depois do build único (antes do piloto)) |
| [T-0119](tarefas/T-0119.md) | Catálogo: busca da API com 20 mil produtos em ~5 s (p95 15–20 s), meta 300 ms (D-T0107b) — Sprint 10 | modulo-catalogo, banco-dados, engenheiro-software | local | aberta (08/11 08h30: esteira, 3ª depois do build único (antes do piloto)) |
| [T-0120](tarefas/T-0120.md) | Onboarding: de-para da condição de pagamento no BKO e vínculo cliente → tabela de preço vindo do ERP — Sprint 10 | modulo-integracao, modulo-vendedor, modulo-catalogo, engenheiro-apps | local | aberta (08/11 08h30: esteira, 4ª depois do build único) |
| [T-0121](tarefas/T-0121.md) | Plataforma: push do Expo fora da transação do consumidor, poda local e variacaoEscopo no sync (N2, N3 da T-0110) — Sprint 10 | engenheiro-software, modulo-core, modulo-catalogo | local | aberta (08/11 08h30: esteira, 5ª depois do build único) |
| [T-0122](tarefas/T-0122.md) | Pequenos itens da conferência T-0110 (N4, N5, N7, N8) e job de CI da carga — Sprint 10 | banco-dados, engenheiro-software, modulo-core, modulo-integracao | local | aberta (08/11 08h30: esteira, 6ª depois do build único) |
| [T-0123](tarefas/T-0123.md) | Frente A — novo agente corretor-redundancias (definição, donos, CLI e guardião) — Sprint 10 | engenheiro-software, gerente-projetos | local | aberta (08/11 11h: agora, em paralelo ao lote) |
| [T-0124](tarefas/T-0124.md) | Frente B — 1ª auditoria do corretor-redundancias: Início do app Campo (vendedor), RD-0001..0011 — Sprint 10 | corretor-redundancias, modulo-core, modulo-vendedor | local | aberta (08/11 11h: depois da T-0123) |
| [T-0125](tarefas/T-0125.md) | Frente C — decisões de produto de 08/11 nos docs 02 e 03 (RN-CORE-36, RN-VEN-38, RN-VEN-16, RN-VEN-30, RF-VEN-11) — Sprint 10 | gerente-projetos | local | concluída (08/11 11h: docs 02 e 03) |
| [T-0126](tarefas/T-0126.md) | Frente C — padrão de pendências de preenchimento em docs/design (vale para o app inteiro) — Sprint 10 | designer-ux | local | concluída (08/11 11h40: spec em docs/design/formulario-pendencias.md e 3 componentes no kit, R-20261108-113954) |
| [T-0127](tarefas/T-0127.md) | Frente D — bug: pendência fora do Resumo e botão "Corrigir frete" no Novo pedido — Sprint 10 | modulo-vendedor, designer-ux, testes | local | aberta (08/11 11h: 2ª do Novo pedido (F → D → E → G), antes do build) |
| [T-0128](tarefas/T-0128.md) | Frente E — bug: sair do Novo pedido sem salvar apaga o pedido (RN-VEN-38) — Sprint 10 | modulo-vendedor, engenheiro-apps, testes | local | aberta (08/11 11h: 3ª do Novo pedido (F → D → E → G), antes do build) |
| [T-0129](tarefas/T-0129.md) | Frente F — bug: forma de pagamento volta sozinha para Pix / À vista (cliente inadimplente) — Sprint 10 | modulo-vendedor, testes | local | aberta (08/11 11h: 1ª do Novo pedido (F → D → E → G), antes do build) |
| [T-0130](tarefas/T-0130.md) | Frente G — bug: Salvar fica processando com a tela do pedido aberta (fila em segundo plano) — Sprint 10 | modulo-vendedor, modulo-core, testes | local | aberta (08/11 11h: 4ª do Novo pedido (F → D → E → G), antes do build) |
| [T-0131](tarefas/T-0131.md) | Novo pedido v2 — tarefa-mãe (manhã D, E, F, G + tarde H a M) — Sprint 10 | modulo-vendedor, designer-ux, engenheiro-apps, modulo-core, testes, engenheiro-software | local | aberta (08/11 13h20: antes do build único, logo depois da T-0094) |
| [T-0132](tarefas/T-0132.md) | Frente H — docs 02 e 03 do Novo pedido v2 (RF-VEN-11 em 4 abas, RF-VEN-05 detalhe, RN-VEN-18 preço congelado e validade, RN-VEN-30 tags, RN-VEN-38 rótulos) — Sprint 10 | gerente-projetos | local | concluída (08/11 13h20: docs 02 e 03) |
| [T-0133](tarefas/T-0133.md) | Frente H — padrão em docs/design: abas do pedido, desconto compacto (componente único em packages/ui), detalhe do pedido e tags de histórico — Sprint 10 | designer-ux | local | concluída (08/11 14h35: docs/design/pedido-v2.md e kit — DescontoCompacto, HistoricoEmTags, RodapeAcoes; R-20261108-143253) |
| [T-0134](tarefas/T-0134.md) | Frente I — bug: editar orçamento reprecifica os itens (preço congelado, RN-VEN-18) — Sprint 10 | modulo-vendedor, testes | local | aberta (08/11 13h20: depois da J (ou junto, se não colidir)) |
| [T-0135](tarefas/T-0135.md) | Frente J — bug: validade do orçamento diferente na mesma tela (15/11 × 16/11) — Sprint 10 | modulo-vendedor, testes | local | aberta (08/11 13h20: primeira da tarde (em paralelo com a H)) |
| [T-0136](tarefas/T-0136.md) | Frente K — Novo pedido em 4 abas: Venda · Itens (n) · Entrega · Resumo — Sprint 10 | modulo-vendedor, designer-ux, engenheiro-apps | local | aberta (08/11 13h20: depois da I e da J) |
| [T-0137](tarefas/T-0137.md) | Frente L — Resumo completo, 4 botões e desconto compacto (absorve a D) — Sprint 10 | modulo-vendedor, designer-ux | local | aberta (08/11 13h20: depois da K) |
| [T-0138](tarefas/T-0138.md) | Frente M — detalhe do orçamento/pedido e histórico em tags (Campo, Gestão e BKO) — Sprint 10 | modulo-vendedor, designer-ux, modulo-gestor | local | aberta (08/11 13h20: última da tarefa-mãe) |
| [T-0139](tarefas/T-0139.md) | Recados online: repositório próprio, junções no PC, sincronização a cada 2 min, formulário de issue e Telegram — Sprint 10 | engenheiro-software, gerente-projetos, testes | local | aberta (08/11 13h30: na esteira, sem esperar o build) |
| [T-0187](tarefas/T-0187.md) | Supervisor em campo no app Gestão: rota com check-in/checkout, rastreamento interno, ficha com Check-in, Pesquisa e Novo pedido em nome do vendedor | gerente-projetos | nuvem (S1 a S7 da v1.0.16) | concluida (v1.0.16) |
| [T-0188](tarefas/T-0188.md) | Troca de prazo mantém o preço final: tabela muda e o desconto do item é refeito (RN-VEN-44 nova) | modulo-vendedor | — | aberta (v1.0.17) |
| [T-0189](tarefas/T-0189.md) | Início do BKO: Precisa de você, Hoje e Equipe no mês por perfil, escopo e licença (RN-CORE-64/65/66) | modulo-core, engenheiro-apps, designer-ux, design-de-marca, testes, corretor-redundancias | nuvem (esta sessão; travados: modules/core/{domain,api,contracts,web}/inicio-bko*, apps/web/app/(bko)/page.tsx) | em_revisao (v1.0.19; caminhos destravam no merge dos PRs da T-0189) |
| [T-0191](tarefas/T-0191.md) | BKO → Rotas: criar a rota do vendedor por proximidade a partir do endereço base (R1 a R3) e o botão Gerar coordenada pelo OpenStreetMap (R5); RN-CORE-75 a 77 | gerente-projetos, engenheiro-software, banco-dados, modulo-core, designer-ux, design-de-marca, testes, corretor-redundancias | nuvem (session_0157qAhoxesgkmgVLQP9wZkt) | em_revisao (v1.0.19; 9 PRs na ordem da tarefa; migração 0093; revisões sem achado em aberto) |
| [T-0070](tarefas/T-0070.md) | Pendências locais antes da demo das 15h (seed, espelhos, Hub, revisão do Treinamento, testes) | gerente-projetos | local | concluida (demo das 15h no ar em ca61571 · APKs do ac4ca3b · demo-no-ar 41 OK) |
| [T-0066](tarefas/T-0066.md) | Consumidores dos eventos da Integração nos módulos donos (ciclo ERP → Macuxi) — Sprint 2 | modulo-core | local | concluida (consumidor de nota 96a567f; 🟡 da guarda de ordem no backlog, antes do 1º tenant real) |
| [T-0065](tarefas/T-0065.md) | Apuração da meta pelo tipo e atualização automática de 3–5 min — Sprint 4 | modulo-core | local + nuvem | concluida no escopo da demo (apuração por tipo, push, Sincronizar, banco de testes 5434); falta o passo pnpm timers no CI (ci.yml de governança, aguarda autorização) |
| [T-0064](tarefas/T-0064.md) | Correções do teste de campo 02/11 tarde (PDFs, vendedor, área segura, Gestão, puxar para atualizar) — vaga de correção | modulo-vendedor | local (Vendedor e Gestor esperam o merge do #44/#40) | concluida (PDFs 091da4b; acabamento #58–#61; itens do Vendedor no main) |
| [T-0059](tarefas/T-0059.md) | Teste de campo 02/11: sincronização e detalhe do pedido no BKO — Sprint 4 | engenheiro-apps | local | concluida (Sincronizar, motor que retoma, detalhe do BKO; no APK de 03/11) |
| [T-0009](tarefas/T-0009.md) | Integração: domínio e contratos do Hub | modulo-integracao | nuvem → local (merge e20f6ac) | concluida (cancelado do ERP ✅ · revisão sem 🔴 · OrderStatus depois do merge da T-0007) |
| [T-0010](tarefas/T-0010.md) | Promotor: domínio de trade marketing (sem banco, sem telas) | modulo-promotor | local (1ª entrega veio da nuvem, merge 3352d2e) | concluida (155 testes · revisão sem 🔴 · decisões do Alexandre aplicadas) |

## Próximas sprints
Ver `docs/produto/05-roadmap.md`.
