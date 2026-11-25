# Perfis sem perfil base, permissões numa tabela: simulação (R-20261124-094327, item 12)

Base: ADR 0073 (proposta) e o plano de migração do banco. **Só simulação**: o código vem depois da aprovação do Alexandre.
Os prints são da tela real do BKO (stack local: Postgres sem Docker, migrações, seed de demonstração, API e BKO; login do Admin
da "Distribuidora Exemplo"). Nas propostas, o painel "Perfis de acesso" foi trocado pela tabela, montada com as permissões reais
de cada perfil (`GET /v1/core/perfis/:codigo`) e com as cores do manual (§3).

| Arquivo | O que mostra |
|---|---|
| `perfis-tabela-atual-1366.png` | Hoje: perfil Vendedor com "Perfil base", chaves Sim/Não, "Mais permissões (79)" escondidas e o cartão "Promotor vê pedidos" |
| `perfis-tabela-vendedor-1366.png` | Proposta, perfil Vendedor |
| `perfis-tabela-admin-1366.png` | Proposta, perfil Admin (o perfil de quem está logado) |
| `perfis-tabela-colunas-1366.png` | Variante: várias colunas, uma por perfil (Onde entra, Pedidos e Trade) |

## O que muda
- Saem o "Perfil base", o "Restaurar o padrão", o "Ativo" (desativar fica no menu "…" da lista) e o "Mais permissões (79)": as 141 permissões aparecem, todas, na mesma tabela.
- Cabeçalho do perfil: Nome e Cargo. O Cargo fica com cadeado e "Não muda enquanto houver usuários neste perfil." (ADR 0073 §2.5, item 9).
- Botões secundários "Copiar permissões de…" (perfil ou modelo, troca as caixas marcadas) e "Histórico". O único principal é "Salvar", na barra do rodapé.
- Sai o cartão "Promotor vê pedidos": vira a linha "Ver pedidos" do perfil (ADR §2.4).

## Decisões de UX
- **Caixa à esquerda.** A caixa fica colada ao nome, e o olho não atravessa 800 px entre o nome e o controle. As caixas formam uma coluna só, alinhada com a caixa do grupo. É o mesmo lado do "Novo perfil", que já usa caixas. A coluna da direita fica para o que explica a linha: cadeado e motivo, nível, de quem.
- **Grupos recolhíveis por área**, na ordem da ADR (Onde entra, Dados, Usuários e perfis, Clientes, Pedidos, Catálogo, Trade, Pesquisa, Treinamento, Metas e RV, Gestão da equipe, Integração, Administração). O cabeçalho do grupo traz a seta, o nome e "n de m ligadas".
- **Caixa do grupo:** liga ou desliga só as linhas livres (não mexe nas travadas, nas sem licença, no nível nem no "de quem"). Ela tem três estados: todas, nenhuma e parte (traço). Vale a pena, porque o caso comum ("perfil que cuida do Trade") é ligar uma área inteira.
- **Dados:** uma linha com o nível em botões (Carteira própria, Equipe, Equipes abaixo, Toda a empresa). O que passa do teto do cargo leva cadeado, com "O cargo Vendedor vai até 'Carteira própria'.".
- **"Redefinir a senha de outros usuários"** mostra o "de quem" na própria linha, com "Mudar".
- **Buscar permissão** no topo, porque são 141 linhas.
- Os motivos não citam códigos de regra (achado UX-13 da revisão geral de 24/11).

## Travas mostradas
| Onde | Linha | Motivo na tela |
|---|---|---|
| Vendedor | Entrar no backoffice, Entrar no portal | "Vendedor nunca entra no BKO" / "no portal" (RN-CORE-33) |
| Vendedor | Entrar no app Gestão | "Gestão só de supervisor e gerente" (ADR §2.5, item 3) |
| Vendedor | Dados acima de Carteira própria | cadeado no nível (RN-CORE-04) |
| Admin | Entrar no app Campo, Entrar no app Gestão | "Campo só de vendedor e promotor" / "Gestão só de supervisor e gerente" |
| Admin (o próprio perfil) | Entrar no backoffice, Gerenciar perfis, Criar, Editar e Desativar usuários | cadeado na linha e um aviso só no topo: "Você usa este perfil…" (RN-CORE-35, autogestão). O aviso fica uma vez no topo para não repetir o mesmo motivo em 5 linhas |
| Promotor (variante) | Criar, Editar, Cancelar, Excluir, Aprovar pedido e Criar em nome | cadeado (RN-PRO-01); no perfil do promotor, a linha mostra "Promotor nunca cria nem altera pedido" |
| Sem licença | Treinamento | **Simulação:** a demo tem tudo licenciado, então o Treinamento foi tratado como sem licença. O grupo aparece com o selo "Sem licença" e a frase "Ative o módulo Treinamento em Módulos para usar estas permissões.". As linhas ficam desabilitadas, com o valor guardado (ADR §2.5, item 8) |

Não mostrei a "sem efeito" (ação do BKO num perfil que não entra no BKO, ADR §2.5, item 10), porque os perfis da demo não têm esse caso. Na tela, ela seria a linha marcada e acinzentada, com "Sem efeito: o perfil não entra no BKO".

## Recomendação: um perfil por vez (linha = permissão), como o pedido
- A tabela de um perfil cabe em 1366 px com o motivo de cada cadeado escrito na linha. Na de colunas, o motivo só aparece ao passar o mouse, porque não cabe em 7 colunas de 90 px.
- A matriz cresce para o lado a cada perfil novo. Com 10 ou mais perfis personalizados, ela passa da tela e a caixa vira um alvo pequeno, com risco de clique na coluna errada.
- Editar um perfil é a tarefa do dia a dia, e salvar um de cada vez casa com o `PUT /v1/core/perfis/:codigo` da ADR, que manda o perfil inteiro com a trava otimista.
- A variante de colunas serve bem para **comparar**. Fica como sugestão de backlog: uma visão "Comparar perfis", só de leitura, sem caixa editável. Só entra com a palavra "backlog" do Alexandre.
