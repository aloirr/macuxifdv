# T-0176: filial do usuário (e T-0175: vendedor do ERP), simulação do BKO › Usuários

Simulação para o dono do produto aprovar (critério 6 da T-0176; itens A1 e A2 da T-0175). Ela passa pelo design-de-marca antes.
- Tamanho: 1366×768, `deviceScaleFactor` 2.
- Visual: o da revisão do BKO (`docs/design/telas/bko-revisao.md`, §P1 a §P9), com a gaveta da direita (`Drawer` com `rodape`), o "⋯" na linha (`MenuAcoes`) e um selo só na Situação.
- Gerar de novo: `node docs/design/T-0176-filial-usuario/gerar.cjs`. O script grava o HTML e o PNG de cada tela nesta pasta.

Regra (R-20261115-073000, item 1; RN-CORE-39 revista):
- vendedor: **uma** filial, obrigatória;
- supervisor, promotor e gerente: **uma ou mais**;
- admin, analista e assistente: opcional.

## Telas

| PNG | O que mostra |
|---|---|
| `1-novo-vendedor.png` | Novo usuário com o perfil Vendedor: o campo **Filial** (seleção única) fica ao lado de **Código no ERP (opcional)**. |
| `2-editar-supervisor.png` | Editar usuário com o perfil Supervisor: **Filiais** em chips de seleção múltipla (marcado: traço Azul noite de 2 px, fundo `accent-soft` e o ✓). |
| `3-erro-vendedor-sem-filial.png` | Salvar um vendedor sem filial: o erro aparece no próprio campo. |
| `4-alertas-vendedores-sem-filial.png` | Alertas do BKO: **um** aviso "3 vendedores sem filial" com a ação "Ver vendedores" (RN-VEN-42). |
| `5-lista-com-filial.png` | Lista de Usuários com a coluna Filial e o filtro Filial. |
| `5b-lista-sem-filial-pelo-alerta.png` | O destino de "Ver vendedores": Perfil = Vendedor e Filial = Sem filial. |
| `6a-lista-provisorios.png` | T-0175: Situação = Provisórios e o "⋯" com "Vincular vendedor do ERP". |
| `6b-busca-codigo-erp.png` | T-0175: busca pelo código do ERP ("000034" acha VEN-000034). |
| `6c-vincular-vendedor-erp.png` | T-0175: a gaveta "Vincular vendedor do ERP", com o resumo do que muda. |
| `6d-erro-codigo-de-provisorio.png` | T-0175: erro 409 do código repetido, com a ação de vincular. |

## Textos

**Gaveta Novo/Editar usuário (aba Dados).** A ordem é: Nome · E-mail · Perfis · Onde esta pessoa entra · [Código no ERP (opcional) | Filial] · Equipe · Senha inicial. A filial fica logo depois dos perfis porque depende deles.
- Com o perfil Vendedor: o rótulo é **"Filial"** (sem "(opcional)") e o seletor começa em "Escolha".
- Com Supervisor, Promotor ou Gerente: o rótulo é **"Filiais"**, em chips com o nome de cada filial. O Código no ERP fica na linha de baixo.
- Com Admin, Analista ou Assistente: o rótulo é **"Filiais (opcional)"**, nos mesmos chips.

**Erros no campo** (do front e do 422 da API, a mesma frase):
- vendedor sem filial: **"Escolha a filial do vendedor."**
- supervisor, promotor ou gerente sem filial: **"Escolha ao menos uma filial."**
- vendedor com mais de uma filial (só a API; a tela não deixa): **"O vendedor tem uma filial só."**
- filial excluída, inexistente ou de outro tenant (só a API): **"Filial não encontrada. Escolha outra."**

**Alertas.**
- Tipo: "Cadastro". Mensagem: **"N vendedores sem filial"** ("1 vendedor sem filial" no singular). Botão na linha: **"Ver vendedores"**, que abre `/usuarios?perfil=vendedor&filial=sem`.
- O aviso conta também o vendedor que veio da carga. Não tem Dispensar e sai sozinho quando o número chega a 0.
- T-0175, item 3: **"N vendedores provisórios do ERP"**, com o botão **"Ver provisórios"** (abre Situação = Provisórios).

**Lista de Usuários.**
- Título: "Usuários · N".
- Colunas: Nome · Perfis · Filial · Equipe · Código no ERP · Situação · ⋯.
- Filial: uma filial mostra o nome. Várias mostram até duas ("Boa Vista, Manaus"); passando disso, "Boa Vista +2", com todas no `title`. Sem filial: "—". Vendedor sem filial: o selo `warning` "Sem filial".
- Filtros: a busca "Buscar nome, e-mail ou código no ERP" (acha por parte do código), Perfil, **Filial** (Todas, Sem filial e cada filial), Equipe e Situação (Todas, Ativos, Inativos, **Provisórios**).
- Selo da Situação: **"Provisório"** (`warning`) vem antes de "Ativo" (§P5: o que pede ação primeiro).
- "⋯" do provisório: **"Vincular vendedor do ERP"**, "Editar", traço, "Desativar" (em vermelho).

**Gaveta "Vincular vendedor do ERP"** (aberta pelo "⋯" do provisório):
- quadro "Vendedor do ERP" com o nome do provisório ("Anderson Souza");
- campo **"Usuário do BKO"**: lista só os usuários ativos do mesmo perfil e sem código no ERP; cada opção mostra o nome e o e-mail;
- quadro **"Passa para o usuário do BKO"**: "Código no ERP · VEN-000034" e "Carteira · 48 clientes" (sem cliente: "Carteira · nenhum cliente");
- botões "Cancelar" e **"Vincular"**; depois de vincular, o aviso no rodapé diz **"Vendedor vinculado."**;
- erros da API (422, RN-CORE-58), num `Notice` de perigo no topo do corpo:
  - "Este usuário já tem outro código no ERP.";
  - "Escolha um usuário com o mesmo perfil.";
  - "Este usuário não é provisório.".

**Erro 409 do código repetido** (Novo/Editar, embaixo do campo Código no ERP):
- se o código é de um provisório: **"Código do provisório Anderson Souza."** e, embaixo, o botão **"Vincular vendedor do ERP"**. O botão abre a gaveta do vínculo já com o provisório e este usuário. Em Novo usuário, o botão salva antes o usuário sem o código;
- se o código é de outro usuário (não provisório): **"Código já usado por Carla Souza."**, sem botão.

## Decisões tomadas aqui
1. Vendedor: seletor simples (uma escolha, como manda a regra). Os demais perfis: chips, porque a empresa tem poucas filiais e todas ficam à vista. Com mais de 12 filiais, os chips viram a lista de caixas com busca do `SeletorDePerfis`.
2. Quando o perfil passa para Vendedor e havia várias filiais marcadas, o seletor volta para "Escolha". A tela não escolhe uma filial pelo admin.
3. Saem da lista as colunas **E-mail** e **Superior imediato**, para caber a Filial em 1366 px sem rolagem (§P2, no máximo 6 colunas). O e-mail continua na busca e na gaveta, e o superior na gaveta. Com isso, o e-mail `@sem-email.invalid` do provisório não aparece mais na lista.
4. O rótulo passa de "Código do ERP" para **"Código no ERP"** (é o termo da T-0175 e do dono do produto), no campo, na coluna e na busca.
5. O aviso aparece só na tela Alertas: não há faixa na tela de Usuários. Na lista, o "Sem filial" é o dado da coluna Filial, não um aviso.
6. No vínculo, o código do ERP aparece só no resumo, e não no quadro do provisório, para não se repetir. A desativação do provisório não aparece em texto: ele some da lista, e o aviso no rodapé confirma.

## Em aberto para o dono do produto
1. **Usuário com Vendedor e mais um perfil** (ex.: vendedor e supervisor): vale a regra do vendedor (uma filial só)? A simulação supõe que sim, sempre que Vendedor estiver marcado.
2. **Lugar do aviso:** a tela Alertas hoje é do módulo Gestor (Comunicação › Alertas) e depende da licença dele. Sem o Gestor, o aviso de cadastro vai para onde? A proposta é a tela Alertas ficar no Core para os avisos de cadastro.
3. **Gerente com todas as filiais:** mostrar "Todas", ou "Boa Vista +3" como na simulação? Com "Todas", a filial nova entraria sozinha para ele, o que é outra regra.
4. **Na lista filtrada por "Sem filial"**, todas as linhas repetem o selo "Sem filial". Manter a coluna (simulação) ou escondê-la quando o filtro já diz?
5. **Erro 409 em Novo usuário:** o botão "Vincular vendedor do ERP" salva o usuário sem o código e abre o vínculo. Fica assim, ou o erro só orienta e o admin faz o vínculo pela lista?
6. **Analista vincula?** A T-0175 deixa o analista de fora até a decisão do dono do produto.
