# Reteste — rodapé legal, docs do gerente, revisão do BKO e Acesso no BKO (PR #250) — 15/11/2026

Corretor-redundancias. Pedido do dono do produto pela ponte (reteste de quatro lotes; regra R-20261110-062506).
Caixa de recados: `node scripts/coord.mjs caixa corretor-redundancias` devolveu **HTTP 403** (GraphQL fora das sessões da
nuvem). O parecer fica só neste relatório; os recados aos donos, o encaminhamento ao testes e a `entrega` ao gerente
saem quando a caixa voltar.

Os achados de origem RD-0381, RD-0382, RD-0388 e RD-0389 não estão no `origin/main` nem em branch remoto. Por isso o
achado original foi tirado da mensagem de commit de cada dono e do diff. RD-0390 e RD-0391 estão em
`nuvem/reteste-283-bko-corretor-redundancias` (`2026-11-15-reteste-283-bko.md`), que ainda não entrou no `main`. As
linhas do catálogo destes RD entram aqui. Se aquele branch entrar depois, o conflito no `catalogo.md` se resolve
ficando com as linhas deste relatório para RD-0390 e RD-0391 (status `corrigido`).

Achados novos: a numeração segue do último RD existente (RD-0391).

## Lote 1 — `nuvem/rodape-login-designer-ux`

`FETCH_HEAD` = `bc858ee1` (confere com o commit citado). Diff `origin/main...bc858ee`, com foco no commit `bc858ee`.

| RD | Achado | Reteste | Status |
|---|---|---|---|
| RD-0381 | Campo Site do "Dados da Macuxi" com a ajuda "Sem https:// e sem www.", que repetia o que o campo já faz sozinho ao sair (tira `https://`, `www.` e a barra) e o que o erro já diz | `rodape-legal.md:106`: a ajuda saiu da tabela; ficam a regra e o erro "Use só o endereço, ex.: macuxifdv.com.br.". `rodape-legal-config-dados.html:31`: sem o `div.ajuda`. PNG refeito e conferido: Razão social, CNPJ, Site e Salvar, sem nenhuma linha de ajuda | **corrigido** |
| RD-0382 | Rota pública com `Cache-Control` e também `ETag`/304, dois mecanismos de cache para um dado que muda raramente e que já tem cache em memória de 60 s | `rodape-legal.md:149` (§3.4): só `Cache-Control: public, max-age=300, stale-while-revalidate=86400` e o cache em memória. `git grep -i etag` no commit: nenhuma ocorrência | **corrigido** |

Achado novo com o reparo: nenhum. Nos usos de `https://` que sobraram (l.52, l.57, l.81, l.83 e l.221), cada um está na
própria camada: o link, a regra de exibição, a acessibilidade do celular e da web, e o roteiro de teste.

**Parecer do lote 1: sem achado em aberto.**

## Lote 2 — `nuvem/docs-gerente-projetos`

`FETCH_HEAD` = `963b1f13` (confere). Diff `origin/main...963b1f1`, com foco no commit `963b1f1`.

| RD | Achado | Reteste | Status |
|---|---|---|---|
| RD-0388 | `docs/manual/vendedor.md` (problemas comuns): a coluna da mensagem citava a frase inteira da tela, e a coluna "o que fazer" repetia a instrução que a própria frase já dava ("Fale com o administrador" 2×; "Tente de novo em N minutos" × "Espere o tempo indicado") | `vendedor.md:163-164`: a mensagem fica só com o começo que identifica a tela ("Seu acesso está bloqueado", "Muitas tentativas"). A ação passa a acrescentar o que a frase não diz ("Peça ao administrador para desbloquear"; "Espere os minutos indicados ou peça ao administrador para desbloquear") | **corrigido** |
| RD-0389 | `docs/seguranca/checklist.md` S1: o parêntese "o `DEMO_SSH_KEY` da demo, desligada em 14/11/2026 pela ADR 0051, pode ser apagado" repetia o que o backlog já registra | `checklist.md:8`: S1 fica com "environments `PRODUCAO` e afins". A nota da demo e do `DEMO_SSH_KEY` fica num lugar só, `backlog.md:139` | **corrigido** |

Achado novo: nenhum.
- `manter`: a regra "Horário de Manaus" aparece em `CLAUDE.md:21` e no doc 07 (l.118) com o mesmo texto. É o padrão do
  repositório, como no "Sem Docker" das l.20 e l.117: o `CLAUDE.md` é o resumo carregado em toda sessão e o doc 07 é a
  fonte. O texto é o mesmo e não diverge.
- A nota "a demo foi desligada em 14/11/2026 (ADR 0051)" aparece em quatro arquivos (`CLAUDE.md:20`, doc 07 l.241,
  `backlog.md:139` e `producao/sabado.md:48`). Em cada um, ela corrige uma referência local à demo que ficaria errada
  sem ela. Não é a mesma informação repetida no mesmo lugar.

**Parecer do lote 2: sem achado em aberto.**

## Lote 3 — `nuvem/bko-revisao-designer-ux`

`FETCH_HEAD` = `ec943263` (confere). Diff `origin/main...ec94326`, com foco nos commits `3c4b751` (RD-0390, RD-0391) e
`ec94326` (§P13, decisão R-20261114-205500-alexandre).

| RD | Achado | Reteste | Status |
|---|---|---|---|
| RD-0390 | `portal-config-enxuto.md`: a mesma remissão a `modulos.tsx` aparecia 3× (§11.8, §11.9, §11.10), e a §11.10 voltava a listar o mapa id → ícone | Só a §11.10 (l.282) aponta para `modulos.tsx`, sem o mapa. A §11.8 (l.260) e a §11.9 (l.274) dizem "mapa único (§11.10)". A linha "Código do adicional" voltou a ter 4 células. O traço do ícone ficou em 1,9 (l.283), como `icons.tsx` e a §P10. As remissões internas à §11.10 (l.209, l.234, l.260, l.274) só apontam para ela, sem copiar o conteúdo | **corrigido** |
| RD-0391 | `bko-revisao.md:344` (§P12): a legenda repetia a justificativa da §P4 regra 6 e o "com a contagem" junto de "Vendedores · 8" | `bko-revisao.md:344`: "aba "Clientes" sem contagem, "Vendedores · 8"," | **corrigido** |

**§P13 (e), "Promotor" em todo lugar.** A decisão foi aplicada: em `bko-revisao.md` e em `portal-config-enxuto.md`, "avulso"
aparece só na linha do preço (`portal-config-enxuto.md:210`, "Promotor · R$ 80,00 por licença avulsa/mês"), fora da
regra e dos testIDs. "Promotor Avulso" sumiu dos docs e do kit: `adicionais.tsx` lê de `modulos.tsx`. Ficaram duas
sobras, os RD abaixo.

### Achados novos (seguram o lote: estão em doc, não em comentário de teste)

| Campo | RD-0392 |
|---|---|
| Onde | `docs/design/telas/bko-revisao.md:353` (§P13, item e) × `:308` (§P10, texto final) |
| Tipo | doc |
| O que se repete | A regra "'Promotor' em todo lugar; 'avulso' só na linha do preço" aparece **2 vezes** (l.308 e l.353). "`adicionais.tsx` lê de `modulos.tsx`" também aparece **2 vezes** (l.308 "um mapa só" e l.353 "O kit já segue"). A §P10 é a fonte da regra. A §P13 é a lista de decisões, e o item (e) agora decidido copia a regra em vez de apontar para ela |
| Impacto | manutenção: se a regra mudar, são duas linhas a trocar no mesmo doc. Leitura: o item decidido fica no meio de "Decisões em aberto" com o mesmo peso dos que ainda pedem resposta |
| Severidade | baixa |
| Proposta | l.353 antes: `e. **Nome do adicional: decidida** (R-20261114-205500-alexandre). "Promotor" em todo lugar; "avulso" só na linha do preço ("Promotor · R$ 80,00 por licença avulsa/mês"). O kit já segue (`adicionais.tsx` lê de `modulos.tsx`).` → depois: `e. ~~**Nome do adicional**~~ **Decidida** (R-20261114-205500-alexandre): §P10, texto final.` Esse é o mesmo padrão de item riscado dos decididos em `portal-config-enxuto.md` §11.7. A l.308 fica como está |
| Dono | designer-ux |

| Campo | RD-0393 |
|---|---|
| Onde | `docs/design/telas/portal-config-enxuto.md:259` (§11.8, testIDs) |
| Tipo | doc |
| O que se repete | Dois históricos sem ação no meio da lista de testIDs: "; antes `promotor-avulso`" e "(antes só `empresa.adicional-promotor-avulso-qtd`)". `git grep promotor-avulso` em `apps`, `packages`, `modules` e `tests` dá zero ocorrências, no `main` e no branch: o testID antigo nunca chegou ao código. Para o engenheiro-apps não há o que trocar. O histórico da spec já tem lugar próprio (§14) e o git |
| Impacto | leitura: a lista que o engenheiro copia para o código traz dois nomes que ele não deve usar |
| Severidade | baixa |
| Proposta | antes: ``empresa.adicional-<adicional>` (`promotor|pesquisa|treinamento`, os valores de `ADICIONAIS`; antes `promotor-avulso`), `empresa.adicional-<adicional>-qtd` (antes só `empresa.adicional-promotor-avulso-qtd`),`` → depois: ``empresa.adicional-<adicional>` (`promotor|pesquisa|treinamento`, os valores de `ADICIONAIS`), `empresa.adicional-<adicional>-qtd`,``. A l.353 da bko-revisao não repete a regra da §P10 depois do RD-0392 |
| Dono | designer-ux |

### Encaminhado ao testes (divergência, não é RD; não catalogado)
- As simulações `portal-config-enxuto/depois-03b-nova-empresa.html` e `prancha-icones-adicionais.html` desenham os
  ícones com `stroke-width="2"`, e a spec (§11.10, l.283) e `icons.tsx` usam 1,9. A diferença é visual e pequena, mas a
  simulação diverge da spec.

O recado ao testes (cc gerente-projetos) não saiu porque a caixa deu 403.

**Parecer do lote 3: com achado em aberto: RD-0392 e RD-0393 (baixa, doc). Seguram o lote pela R-20261110-062506.**

## Lote 4 — PR #250, `nuvem/acesso-bko-modulo-core`

`FETCH_HEAD` = `e6453f5b` (confere). Diff `origin/main...e6453f5`, com foco no commit `e6453f5`: adaptação à 0069 e ao
menu em 9 grupos (ADR 0050). Prints conferidos: `modules/core/web/docs/prints/acesso/{usuarios-lista,
usuarios-novo-vendedor,perfis-lista,perfis-novo}-1366x768.png`.

**O que foi conferido e passa:**
- **Menu.** Os grupos de `modules/core/web/index.ts` batem com a tabela da ADR 0050: `usuarios`, `perfis` e `aparelhos`
  vão para `acesso`; `clientes` para `cadastros`; `plano-rv` para `comercial`; `recados` para `comunicacao`; `produtos`
  para `produtos`. "Usuários e módulos" fica fora do menu (sem `navegacao`, §M7). Nos prints, o grupo "ACESSO" tem
  Aparelhos, Perfis de acesso e Usuários, em ordem alfabética, e nenhum item aparece em dois grupos.
- **"Preço e custo".** O item mudou de nome nos dois lugares, `navegacao` e `manifest.web.menus`, e não colide com
  "Tabelas de preço" do Catálogo no grupo Produtos.
- **Telas.** Usuários: busca, Perfil, Situação, a tabela Nome · E-mail · Perfil · Módulos · ⋯ e um botão principal.
  Novo usuário: Nome, E-mail, Perfil, Supervisor, Código no ERP e Módulos, com o cargo pedindo só o que é preciso
  (RN-CORE-55..57). Perfis: Perfil · Cargo · Usuários. Novo perfil: Nome e Cargo. Nenhum texto explica funcionamento e
  nenhum aviso aparece fora da área de alertas. Os números da coluna Usuários de Perfis (2, 1, 1, 1, 1, 0, 1, 0) batem
  com a lista de Usuários (2 vendedores e 1 de cada um dos outros perfis). Em Perfis, a coluna Cargo repete o nome nos
  perfis de fábrica (Vendedor/Vendedor), mas ela é a única que diz o cargo dos perfis personalizados ("Vendedor e
  promotor" → Vendedor): `manter`.
- **Fim do multiperfil.** Saíram os testes e os textos mortos (`ondeEntraDosPerfis`, os `describe` de multiperfil no
  domain e na API) e o `docs/modulos/core/usuarios.md` foi atualizado.

### Achados novos

| Campo | RD-0394 |
|---|---|
| Onde | Sobras do multiperfil no Core: `modules/core/api/usuarios.test.ts:392-413` (`describe` "editar e desativar olham todos os perfis do alvo", 2 testes com o alvo `[analista, admin]`); comentários em `modules/core/contracts/usuarios.ts:56` ("todos os perfis do usuário, o principal primeiro"), `modules/core/api/usuario-perfis.ts:14` ("o primeiro é o principal") e `modules/core/api/usuarios.ts:474` ("TODOS os perfis reais do alvo (um [analista, admin] é admin)") |
| Tipo | teste · comentário |
| O que se repete | Os 2 testes cobrem um estado que a 0069 impede (`usuario_perfil_um_vivo`) e que a API recusa (422 com mais de um perfil). Eles repetem o caso "último admin" que o `describe` de desativar, logo abaixo, já cobre com um perfil só. Os 3 comentários descrevem a lista com "principal primeiro", que o próprio contrato desmente na l.25 ("RN-CORE-54: um só") |
| Impacto | manutenção: teste de um caso impossível, e no mesmo arquivo um comentário diz o contrário do outro |
| Severidade | baixa: só teste e comentário, **não segura** o lote (R-20261111-190159); entra no lote seguinte |
| Proposta | Apagar o `describe` das l.392-413. Comentários: `contracts/usuarios.ts:56` → `/** O perfil do usuário (RN-CORE-54: lista de um item). */`; `usuario-perfis.ts:14` → `/** O perfil ativo escolhido (RN-CORE-54: um só). Código inexistente ou inativo = 422. */`; `usuarios.ts:474` → `// T-0111: o perfil real do alvo (personalizado inclusive); a lista da chave tem de cobri-lo` |
| Dono | modulo-core |

| Campo | RD-0395 |
|---|---|
| Onde | `modules/core/web/components/acesso/icones-modulo.tsx` (arquivo inteiro, 88 linhas) e `modules/core/web/lib/acesso.ts:15-29` (`NOME_DO_MODULO_ACESSO`) |
| Tipo | código |
| O que se repete | Um mapa próprio id → ícone e id → nome dos módulos. O `main` já tem no kit `IconPromotor`, `IconPesquisa` e `IconTreinamento` (`packages/ui/src/web/icons.tsx:150-177`, MC-0042) e `adicionais.tsx`. A revisão do BKO (`bko-revisao.md` §P10, lote 3) faz de `modulos.tsx` a fonte única de id → nome → ícone e cita "Perfis (módulos do perfil), gaveta de Novo usuário" entre as telas que mudam. Os desenhos não são os mesmos: no PR, o Promotor é uma fachada de loja, e no kit é uma gôndola com produtos. A Pesquisa e o Treinamento também têm traços diferentes. Os nomes também divergem: o Core se chama "Geral" e a Integração se chama "Integração", contra "Core" e "Integração com o ERP" da §P10. O comentário da l.6, "O kit (`packages/ui`) ainda não tem ícones de módulo", não vale mais no `main` |
| Impacto | leitura: o mesmo módulo aparece com dois ícones no BKO (Usuários e Perfis × Licenças e portal). Manutenção: passam a existir 4 mapas para manter, e a §P10 nasceu para que fosse um só |
| Severidade | média (polui; código de produção, **segura** o lote) |
| Proposta | Agora, no PR #250: `icones-modulo.tsx` importa `IconPromotor`, `IconPesquisa` e `IconTreinamento` de `@macuxi/ui` no lugar dos desenhos próprios. Ficam só Gestor, Vendedor e Core, até o kit ter os ícones deles, e o comentário da l.6 passa a ser: `Gestor, Vendedor e Core ainda não estão no kit; os adicionais vêm de @macuxi/ui (MC-0042).` Quando o `modulos.tsx` da revisão do BKO entrar no `main`, saem `icones-modulo.tsx` e `NOME_DO_MODULO_ACESSO`, e Usuários e Perfis leem nome e ícone de `modulos.tsx`. Para isso o PR #250 combina com o designer-ux a ordem dos merges. O nome do Core ("Geral" × "Core") é decisão do designer-ux na §P10 |
| Dono | modulo-core (código), com o designer-ux (`modulos.tsx`, §P10) |

### Encaminhado ao testes (texto que contradiz a regra; não é RD, não catalogado)
- `modules/core/web/lib/perfis.ts:54`: a descrição da permissão "Editar usuário" diz "Nome, e-mail, equipe e
  **perfis**." (plural), e a RN-CORE-54 diz que é um perfil só.
- `modules/core/api/usuario-perfis.ts:12`: `MENSAGEM_PERFIL_INDISPONIVEL` = "Um dos **perfis escolhidos** foi desativado.",
  também no plural, e o usuário escolhe um perfil só.

O recado ao testes (cc gerente-projetos) não saiu porque a caixa deu 403.

**Parecer do lote 4 (PR #250): com achado em aberto: RD-0395 (média, código; segura). RD-0394 (baixa, só teste e
comentário) não segura e entra no lote seguinte.**

## Resumo

| Lote | SHA | RD retestados | Achados novos | Parecer |
|---|---|---|---|---|
| 1 · rodapé legal | `bc858ee` | RD-0381, RD-0382 corrigidos | — | sem achado em aberto |
| 2 · docs do gerente | `963b1f1` | RD-0388, RD-0389 corrigidos | — | sem achado em aberto |
| 3 · revisão do BKO | `ec94326` | RD-0390, RD-0391 corrigidos; §P13 (e) aplicada | RD-0392, RD-0393 (baixa, doc) | segura |
| 4 · PR #250 Acesso | `e6453f5` | — | RD-0395 (média, código); RD-0394 (baixa, teste/comentário, não segura) | segura |
