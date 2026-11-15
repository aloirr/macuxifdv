# T-0176: filial do usuário (e T-0175: vendedor do ERP), simulação do BKO › Usuários e do app Campo

Simulação para o dono do produto aprovar (critério 6 da T-0176; itens A1, A2, 4a e 4b da T-0175). Ela passa pelo design-de-marca antes.
- BKO: 1366×768, `deviceScaleFactor` 2. App: o aparelho "Pixel 7" do Playwright (`devices['Pixel 7']`), com o `deviceScaleFactor` dele.
- Visual do BKO: o da revisão do BKO (`docs/design/telas/bko-revisao.md`, §P1 a §P9), com a gaveta da direita (`Drawer` com `rodape`), o "⋯" na linha (`MenuAcoes`) e um selo só na Situação.
- Visual do app: o arranjo da `TelaDeErro` do kit (`packages/ui/src/mobile/tela-de-erro-rn.tsx`): ícone num círculo, título, o que fazer, `Botao` principal e secundário.
- Gerar de novo: `node docs/design/T-0176-filial-usuario/gerar.cjs`. O script grava o HTML e o PNG de cada tela nesta pasta.
- Nomes e códigos são fictícios (sobrenome "Exemplo", VEN-0001xx).

Regras:
- R-20261115-073000, item 1 (RN-CORE-39 revista): vendedor tem **uma** filial, obrigatória; supervisor, promotor e gerente, **uma ou mais**; admin, analista e assistente, opcional.
- R-20261115-080000: **vendedor sem filial fica bloqueado**, sem filial provisória. Ele não usa o app até a carga do ERP ou o BKO informar a filial.
- R-20261115-074500, item 8: **dois códigos** por usuário. **Código ERP** é igual ao do ERP (é o `external_id`, e o vínculo se faz por ele). **Código FDV** é próprio, para controle.

## Telas

| PNG | O que mostra | 2ª rodada |
|---|---|---|
| `1-novo-vendedor.png` | Novo usuário, perfil Vendedor: **Filial** (seleção única) e, embaixo, **Código ERP (opcional)**. | alterado |
| `2-editar-supervisor.png` | Editar usuário, perfil Supervisor: **Filiais** em chips e a linha **Código FDV** (só leitura) · **Código ERP**. | alterado |
| `3-erro-vendedor-sem-filial.png` | Salvar um vendedor sem filial: o erro aparece no próprio campo. | alterado |
| `4-alertas-vendedores-sem-filial.png` | Alertas do BKO: **um** aviso "3 vendedores sem filial: bloqueados no app", com a ação "Informar filial" (RN-VEN-42). | alterado |
| `5-lista-com-filial.png` | Lista de Usuários com as colunas Filial, **Código FDV** e **Código ERP**, e o selo "Bloqueado · sem filial". | alterado |
| `5b-lista-sem-filial-pelo-alerta.png` | O destino de "Informar filial": Perfil = Vendedor e Filial = Sem filial. | alterado |
| `6a-lista-provisorios.png` | T-0175: Situação = Provisórios e o "⋯" com "Vincular vendedor do ERP". | alterado |
| `6b-busca-codigo-erp.png` | T-0175: busca por parte do código ("000123" acha VEN-000123). | alterado |
| `6c-vincular-vendedor-erp.png` | T-0175: a gaveta "Vincular vendedor do ERP", com o resumo do que muda. | alterado |
| `6d-erro-codigo-de-provisorio.png` | T-0175: erro 409 do Código ERP repetido, com a ação de vincular. | alterado |
| `7-app-vendedor-sem-filial.png` | App Macuxi Campo: o vendedor sem filial, bloqueado. | **novo** |

## Textos

**Gaveta Novo/Editar usuário (aba Dados).** A ordem é: Nome · E-mail · Perfis · Onde esta pessoa entra · Filial(is) · [Código FDV | Código ERP (opcional)] · Equipe · Senha inicial. A filial fica logo depois dos perfis porque depende deles.
- Com o perfil Vendedor: o rótulo é **"Filial"** (sem "(opcional)") e o seletor começa em "Escolha".
- Com Supervisor, Promotor ou Gerente: o rótulo é **"Filiais"**, em chips com o nome de cada filial.
- Com Admin, Analista ou Assistente: o rótulo é **"Filiais (opcional)"**, nos mesmos chips.
- **Código FDV**: só leitura (fundo Névoa, sem borda), em Editar. Em Novo usuário ele não aparece: o código nasce ao salvar e passa a aparecer na lista e em Editar.
- **Código ERP (opcional)**: digitado, igual ao do ERP. O rótulo "Código no ERP" sai de todas as telas.

**Erros no campo** (do front e do 422 da API, a mesma frase):
- vendedor sem filial: **"Escolha a filial do vendedor."**
- supervisor, promotor ou gerente sem filial: **"Escolha ao menos uma filial."**
- vendedor com mais de uma filial (só a API; a tela não deixa): **"O vendedor tem uma filial só."**
- filial excluída, inexistente ou de outro tenant (só a API): **"Filial não encontrada. Escolha outra."**

**Erro 409 do Código ERP repetido** (Novo/Editar, embaixo do campo Código ERP, uma linha):
- o código é de um provisório: **"Este Código ERP já está num usuário provisório."** e, embaixo, o botão **"Vincular vendedor do ERP"**. O botão abre a gaveta do vínculo já com o provisório e este usuário. Em Novo usuário, o botão salva antes o usuário sem o código;
- o código é de outro usuário (não provisório): **"Este Código ERP já é de Carla Exemplo."**, sem botão.

**Alertas.**
- Tipo "Cadastro". Mensagem: **"N vendedores sem filial: bloqueados no app"** (singular: **"1 vendedor sem filial: bloqueado no app"**). Botão: **"Informar filial"**, que abre `/usuarios?perfil=vendedor&filial=sem`.
- O aviso conta também o vendedor que veio da carga. Não tem Dispensar e sai quando o número chega a 0.
- T-0175, item 3: **"N vendedores provisórios do ERP"**, com o botão **"Ver provisórios"** (abre Situação = Provisórios).

**Lista de Usuários.**
- Título: "Usuários · N".
- Colunas: Nome · Perfis · Filial · Equipe · Código FDV · Código ERP · Situação · ⋯.
- Filial: uma filial mostra o nome; várias, até duas ("Boa Vista, Manaus"); passando disso, "Boa Vista +2", com todas no `title`. Sem filial: "—".
- Situação do vendedor sem filial: o selo `danger` **"Bloqueado · sem filial"** (um selo só, na Situação; a Filial fica "—").
- Filtros: a busca **"Buscar nome, e-mail ou código"** (acha por parte do Código FDV ou do Código ERP), Perfil, **Filial** (Todas, Sem filial e cada filial), Equipe e Situação (Todas, Ativos, Inativos, **Provisórios**).
- Selo **"Provisório"** (`warning`) antes de "Ativo" (§P5: o que pede ação primeiro).
- "⋯" do provisório: **"Vincular vendedor do ERP"**, "Editar", traço, "Desativar" (em vermelho).

**Gaveta "Vincular vendedor do ERP"** (aberta pelo "⋯" do provisório):
- quadro "Vendedor do ERP" com o nome do provisório ("Vendedor Exemplo");
- campo **"Usuário do BKO"**: só usuários ativos do mesmo perfil e sem Código ERP; cada opção mostra o nome e o e-mail;
- quadro **"Passa para o usuário do BKO"**: "Código ERP · VEN-000123" e "Carteira · 48 clientes" (sem cliente: "Carteira · nenhum cliente");
- botões "Cancelar" e **"Vincular"**; depois, o aviso no rodapé: **"Vendedor vinculado."**;
- erros da API (422, RN-CORE-58), num `Notice` de perigo no topo do corpo: "Este usuário já tem outro Código ERP.", "Escolha um usuário com o mesmo perfil." e "Este usuário não é provisório.".

**App Macuxi Campo: vendedor sem filial** (`7-app-vendedor-sem-filial.png`). Tela inteira, sem a barra de abas:
- ícone de cadeado (âmbar, decorativo);
- título: **"Seu cadastro está sem filial"**;
- texto: **"Peça ao administrador para informar a sua filial."**;
- **"Tentar de novo"** (principal, o único): confere de novo e, com a filial informada, segue para o Início;
- **"Sair"** (secundário): encerra a sessão e volta ao login (aparelho de uso comum).
- Leitor de tela: anuncia título e texto ao aparecer, como a `TelaDeErro`.
- Componentes: `TelaDeErro` do kit (ícone `lock` em vez de `alert`) ou uma variante dela; a ligação no shell é do engenheiro-apps.

## Código FDV: proposta
- **Gerado** pelo sistema, não digitado. Motivo: numerado pelo sistema, nunca repete nem tem erro de digitação, e não muda quando o Código ERP muda ou ainda não existe.
- **Único na empresa** (tenant), sequencial, com 4 dígitos ("0014"); não se edita e não se reaproveita (nem o de usuário excluído ou de provisório desativado).
- **Onde aparece**: na lista de Usuários (coluna própria, ao lado do Código ERP), em Editar usuário (só leitura), na busca da lista e, no app, na tela Perfil, embaixo do nome.
- Até a aprovação, o modulo-core não cria campo nem migração para ele (T-0175, 4a).

## Decisões tomadas aqui
1. Vendedor: seletor simples (uma escolha). Os demais perfis: chips, porque a empresa tem poucas filiais. Com mais de 12 filiais, os chips viram a lista de caixas com busca do `SeletorDePerfis`.
2. Quando o perfil passa para Vendedor e havia várias filiais marcadas, o seletor volta para "Escolha". A tela não escolhe pelo admin.
3. Saem da lista as colunas **E-mail** e **Superior imediato**. O e-mail continua na busca e na gaveta, e o superior na gaveta. A lista fica com 7 colunas de dado (exceção ao §P2: os dois códigos ficam juntos), sem rolagem em 1366 px.
4. O rótulo é **"Código ERP"** em todas as telas (campo, coluna, resumo do vínculo e erros); a busca diz só "código", porque acha os dois.
5. O aviso aparece só na tela Alertas: não há faixa na tela de Usuários. Na lista, o bloqueio é o selo da Situação, não um aviso.
6. O vendedor sem filial mostra **um** selo, "Bloqueado · sem filial", na Situação; a coluna Filial fica "—" (antes era o selo "Sem filial" na Filial e "Ativo" na Situação, o que escondia o bloqueio).
7. No vínculo, o Código ERP aparece só no resumo, não no quadro do provisório. A desativação do provisório não aparece em texto: ele some da lista, e o aviso no rodapé confirma.
8. O erro 409 do provisório não traz mais o nome: a frase diz o problema e o botão logo abaixo é a ação.
9. No app, a tela de bloqueio não explica a carga do ERP nem o BKO: o vendedor só precisa saber o que falta e a quem pedir.

## Em aberto para o dono do produto
Novas (2ª rodada):
1. **Código FDV gerado** (proposta acima), único na empresa, com 4 dígitos e sem prefixo: aprova? Ou prefere digitado?
2. **Onde o Código FDV aparece no app**: só na tela Perfil (proposta), ou também no cabeçalho do Início?
3. **Vendedor já logado e sem sinal**: o bloqueio aparece na próxima sincronização (proposta) ou o app bloqueia já com o cadastro guardado no aparelho?

Da 1ª rodada, continuam valendo:
4. **Usuário com Vendedor e mais um perfil** (ex.: vendedor e supervisor): vale a regra do vendedor (uma filial só)? A simulação supõe que sim, sempre que Vendedor estiver marcado.
5. **Lugar do aviso:** a tela Alertas hoje é do módulo Gestor (Comunicação › Alertas) e depende da licença dele. Sem o Gestor, o aviso de cadastro vai para onde? A proposta é a tela Alertas ficar no Core para os avisos de cadastro.
6. **Gerente com todas as filiais:** mostrar "Todas", ou "Boa Vista +3" como na simulação? Com "Todas", a filial nova entraria sozinha para ele, o que é outra regra.
7. **Na lista filtrada por "Sem filial"**, todas as linhas repetem o selo "Bloqueado · sem filial". Manter (simulação) ou trocar por "Bloqueado" quando o filtro já diz a causa?
8. **Erro 409 em Novo usuário:** o botão "Vincular vendedor do ERP" salva o usuário sem o código e abre o vínculo. Fica assim, ou o erro só orienta e o admin faz o vínculo pela lista?
9. **Analista vincula?** A T-0175 deixa o analista de fora até a decisão do dono do produto.
