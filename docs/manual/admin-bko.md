# Manual do administrador — Backoffice Macuxi

Para o admin da empresa cliente. Endereço: `https://bko.macuxifdv.com.br`. O Backoffice é usado por admin, analista, assistente e gerente. Vendedor, promotor e supervisor usam só os apps. Os itens marcados com "(conferir na v1.0.5)" ainda podem mudar nesta semana.

O menu lateral mostra só as páginas dos módulos contratados e das permissões do seu perfil. Os grupos são **Operação**, **Cadastros**, **Análise**, **Administração** e **Plataforma**.

## 1. Primeiro acesso
1. Abra o Backoffice e preencha **Código da empresa**, **E-mail** e **Senha**. A senha é a senha inicial que o time da Macuxi passou.
2. Em **Crie sua senha**, digite a nova duas vezes e toque em **Salvar e entrar**. A senha precisa ter pelo menos 8 caracteres, com letra, número e caractere especial.
3. **Esqueceu a senha:** **Esqueci a senha** → código da empresa e e-mail → **Enviar senha temporária**. A temporária vale 72 h e é trocada no primeiro uso. A senha do admin só se recupera por aqui.

## 2. Usuários e perfis
### Criar usuário
1. **Administração → Usuários → Novo usuário**.
2. Preencha **Nome**, **E-mail (usado no login)** e marque um ou mais **Perfis**. Quem acumula funções, como vendedor e promotor, recebe os dois. A prévia **Onde esta pessoa entra** mostra se o usuário usa o Campo, o Gestão ou o Backoffice.
3. Escolha a **Equipe**. O superior imediato vem dela. **Código do ERP** é opcional e liga o usuário ao vendedor do ERP.
4. Em **Senha inicial**, toque em **Gerar senha** e depois em **Salvar**.
5. A senha vai para o e-mail da pessoa e vale 72 h. Se o e-mail falhar, o Backoffice mostra a senha uma vez, com **Copiar senha**: passe à pessoa por um canal seguro antes de fechar o aviso.

### Manter usuários
- **Editar**: nome, perfis, equipe.
- **Redefinir senha**: gera uma senha temporária para vendedor, promotor, supervisor, gerente, analista e assistente. Não vale para outro admin.
- **Enviar acesso**: para quem ainda não tem senha.
- **Desativar**: corta o acesso e encerra as sessões. Usuário não é apagado; **Reativar** devolve o acesso.
- Etiquetas da lista: **Sem senha**, **Troca de senha pendente**, **Senha temporária vencida**.

### Equipe inteira por planilha
A importação por CSV fica no **portal de implantação** (`https://config.macuxifdv.com.br`), aba **Bases**, cartão **Equipe**:
1. **Baixar modelo (.csv)** e preencher uma linha por pessoa.
2. **Conferir sem gravar** e corrigir o que ele apontar.
3. **Importar equipe**. Cada pessoa recebe a senha por e-mail. Sem o e-mail configurado, nada é gravado.

### Perfis de acesso
1. **Administração → Perfis de acesso** lista os 7 perfis padrão (Vendedor, Promotor, Supervisor, Gerente, Analista, Assistente, Admin) e os criados pela empresa.
2. **Editar** abre as permissões por seção: onde entra, escopo de dados, módulos, usuários e senhas, clientes, pedidos, catálogo, trade, pesquisa e treinamento, metas, integração.
3. **Novo a partir deste** cria um perfil copiando outro. Dê o nome e toque em **Criar e editar**.
4. **Salvar** mostra **Confira antes de salvar** com o que mudou. A mudança vale na próxima ação do usuário, sem novo login, e fica no **Histórico**.
5. Itens com cadeado (**Travado**) não mudam: vendedor, promotor e supervisor nunca entram no Backoffice; promotor nunca faz pedido; sempre há um admin ativo.
6. **Restaurar o padrão** volta o perfil ao valor de fábrica.

### Módulos
**Administração → Usuários e módulos**: abas **Empresa**, **Perfil** e **Usuário**. Por usuário, o módulo só pode ser retirado, nunca acrescentado além do perfil. Aqui também fica a opção **Promotor vê pedidos**.

### Aparelho perdido ou roubado
**Administração → Aparelhos → Bloquear**. O aparelho deixa de entrar com qualquer usuário da empresa e apaga os dados na próxima conexão, inclusive o que não foi enviado. **Liberar** desfaz o bloqueio.

## 3. Filiais
Filial é a unidade de onde saem as entregas. Cada cliente tem uma filial, e o preço e o estoque do pedido saem dela.

1. **Cadastros → Filiais** lista código, nome, CNPJ, cidade/UF, clientes e situação. A empresa nasce com uma filial **Padrão**, que recebe os clientes sem filial informada.
2. **Nova filial**: código, nome, **CNPJ** e **endereço**. Sem CNPJ e endereço, a filial não salva. Esses dados vão no cabeçalho do PDF do pedido.
3. Filial sem CNPJ ou endereço, vinda do ERP, aparece com o selo **Incompleta**. Abra em **Editar filial** e complete.
4. **Tornar padrão** troca a filial que recebe os clientes sem filial.
5. Os aparelhos recebem a mudança na próxima sincronização.
6. Em **Operação → Pedidos**, o filtro **Filial** mostra só os pedidos de uma filial.

Analista e admin editam; os outros perfis consultam. Filial com ERP próprio é outra empresa no Macuxi, com código, usuários e Conector próprios: peça ao time da Macuxi.

## 4. Fotos do PDV
### Tipos de foto
**Cadastros → Fotos do PDV** define os tipos de foto que aparecem na ficha do cliente no app (Fachada, CNH do sócio, Contrato social…).
1. **Novo tipo de foto**: nome e regras (**Obrigatório** ou **Opcional**, **Sensível**).
2. **Sensível** é para documento: a foto sai do aparelho depois de enviada e o vendedor não abre.
3. A **Fachada** já vem cadastrada: não se apaga, não se inativa e nunca é sensível. É o único tipo que o vendedor abre.
4. Os aparelhos recebem o tipo novo na próxima sincronização. Só o admin edita os tipos.

### Onde ver as fotos
| Foto | Onde ver |
|---|---|
| Fachada de cliente fechado | **Operação → Visitas**, coluna **Fachada** → **Ver foto** |
| Posição da loja sugerida no 1º check-in | **Cadastros → Coordenadas sugeridas** → **Ver no mapa** → **Aprovar esta posição** |
| Fotos de pesquisa | **Cadastros → Pesquisas** → **Resultados** → galeria |
| Fotos do PDV de cada cliente, gôndola e validade do promotor | (conferir na v1.0.5) |

Os motivos que exigem foto estão em **Cadastros → Motivos**.

## 5. Catálogo e produtos
### Preço, custo e medidas
1. **Cadastros → Produtos**, aba **Produtos**: custo, preço, margem, markup, lucro, desconto máximo e preço mínimo. **Editar** muda custo, preço de venda e desconto máximo quando a empresa não integra com o ERP.
2. Custo, margem, markup e lucro aparecem só no Backoffice; nunca vão para o app nem para o PDF do cliente.
3. Aba **Parâmetros**: **Desconto máximo padrão** (15%), usado no produto sem desconto máximo próprio.
4. Aba **Medidas**: **Nova medida** (sigla de 1 a 4 letras e descrição). Medida em uso não se apaga; use **Inativar**. O botão **Medidas** de cada produto define a medida da unidade e a embalagem.

### Conteúdo do catálogo
1. **Cadastros → Catálogo** navega por **Sistema › Grupo › Linha**, como no app. A hierarquia vem do ERP ou da carga "Árvore do catálogo".
2. **Editar conteúdo** no produto: descrição, argumentos de venda, ficha técnica, perguntas frequentes, aplicação, oferece junto e referência cruzada.
3. Aba **Sinônimos**: **Novo grupo** com as palavras que o vendedor usa para o mesmo produto ("refri", "refrigerante").
4. Aba **Buscas sem resultado**: o que os vendedores procuraram e não acharam. Use para criar sinônimos.
5. **Exportar catálogo**: **Catálogo em PDF** ou **Catálogo em Excel**, do nível aberto para baixo.

### Outros cadastros do pedido
- **Formas de pagamento e prazos** (Administração): **Nova forma** e **Novo prazo**. Necessário só se o ERP não manda as formas.
- **Transportadoras**: **Nova transportadora** e, em **Digitadas pelos vendedores**, **Cadastrar** as que vieram no FOB.
- **Alçadas**: consulta das faixas e das decisões recentes. Os percentuais (vendedor, supervisor, gerente) e a validade do preço do orçamento são definidos pelo time da Macuxi no portal, ao cadastrar a empresa.

## 6. Carga por arquivo
Para a implantação ou para quem não usa o Conector. Na implantação, o time da Macuxi faz a mesma carga pelo portal (aba **Bases**).

1. **Administração → Carga por arquivo**.
2. Em **Modelos de arquivo (CSV)**, baixe o **Modelo** e o **Dicionário** de cada entidade.
3. Monte o arquivo: `.csv` separado por `;`, até 25 MB.
4. Envie na ordem da tabela de modelos: filiais e vendedores antes dos clientes; árvore do catálogo e produtos antes de preços, tabela escalonada e estoque; clientes antes de endereços, rotas, títulos e notas. Fora da ordem, a linha fica com erro de referência.
5. Escolha o **Modo**: **Delta (só o que mudou)** ou **Completo (lista inteira)**. No completo, o que não veio no arquivo é inativado.
6. **Enviar arquivo**. O resultado abre em **Integração ERP**, no lote.
7. Linhas com erro aparecem com linha, código no ERP, campo e mensagem. **Corrigir no ERP** pede um arquivo novo; as de referência ausente se resolvem ao enviar a entidade que faltava.

## 7. Monitor da integração
**Administração → Integração ERP**. **Atualizar** traz a situação mais recente.

1. No topo: **Conectores no ar**, **Lotes com erro**, **Inativações aguardando**, **Pedidos presos ou retidos**.
2. **Conectores**: sinal de vida ("No ar", "Sinal atrasado", "Sem sinal", "Parado por versão") e versão. Sem sinal: peça ao TI que confira o serviço **Macuxi Conector** no servidor.
3. **Lotes recentes** e **Carga por entidade**: cada lote termina como **Aplicado**, **Aplicado com erros** ou **Falhou**. Toque no lote para ver os erros por linha e **Exportar CSV**.
4. **Inativação em massa**: carga completa que inativaria mais de 30% de uma entidade fica parada. Confira as contagens e toque em **Confirmar** ou **Recusar**. A confirmação vale por 7 dias.
5. **Pedidos no ERP**: **Presos sem retorno**, **Retidos sem mapeamento** e **Erros de retorno**.
6. **De-para de códigos**: liga o código do Macuxi ao do ERP (forma de pagamento, depósito). **Salvar de-para** libera sozinho os pedidos retidos.
7. **Alertas**: inclui a reconciliação diária quando as contagens do ERP e do Macuxi não batem.

A chave do Conector é gerada no portal de implantação, aba **Integração automática**, **Gerar credencial**. Ela aparece uma vez: copie e entregue ao TI que instala o Conector.

## 8. Auditoria
**Plataforma → Auditoria** registra quem mudou usuários, perfis, módulos, aparelhos, parâmetros e inativações, com data e hora.
