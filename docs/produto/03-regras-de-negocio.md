# 03 — Regras de negócio e permissões

Cada regra mora no `domain` do módulo dono, como função pura testada, e roda igual no app (offline), na web e na API. **A API sempre revalida.** Valores entre colchetes são parâmetros do tenant (tabela no fim).

## 1. Módulos e acesso
- **RN-CORE-01** Módulos efetivos do usuário = módulos ativos do tenant ∩ (**união dos módulos dos perfis do usuário**) − exceções do usuário. Core é sempre ativo. O usuário tem **um ou mais perfis** (multiperfil, para quem acumula funções, por exemplo vendedor + promotor) e nunca fica sem perfil. A exceção do usuário **só restringe**, nunca acrescenta módulo. *(Decisão do dono do produto, 07/11/2026, R-20261107-173950 c; tarefa T-0112.)*
- **RN-CORE-02** Módulo desativado: some do app no próximo sync, os dados locais dele são apagados do aparelho e as rotas da API respondem 403 `MODULO_INATIVO`. Os dados na nuvem ficam guardados por [90] dias para reativação.
- **RN-CORE-03** Um módulo só aparece se suas dependências estão ativas; funcionalidades que usam extensão opcional (ex.: "pedido em nome" precisa do Vendedor) somem sem erro quando o módulo provedor está inativo.
- **RN-CORE-04** Escopo de dados: vendedor/promotor veem a própria carteira; supervisor vê a carteira da equipe; gerente vê as equipes abaixo; analista/assistente/admin veem o tenant.
- **RN-CORE-05** Isolamento total entre tenants (`tenant_id` do token + Row Level Security).
- **RN-CORE-15** Bloqueio de aparelho vale para o **tenant inteiro** (decisão do Alexandre, 2026-10-31): aparelho bloqueado (perda, roubo, desligamento) não autentica nenhum usuário daquele tenant; a resposta segue a regra do login (423 só revelado a quem acertou a senha). Na próxima conexão o app apaga os dados locais do tenant e a fila não enviada, com aviso na tela, e volta ao login. Bloqueio e desbloqueio no BKO por admin ou analista, com auditoria. O corte é **imediato**: cada requisição confere se o aparelho está bloqueado (como a licença), e o acesso já emitido deixa de valer para aquele aparelho (decisão do gerente, O-5 da T-0017).

> **Esclarecimentos (gerente-projetos, 2026-10-30, T-0003/T-0006)**
> - **RN-CORE-01 — exceções só restringem (definitivo, 07/11/2026).** A exceção do usuário só **remove** módulos e nunca acrescenta. Para quem acumula funções, o caminho é o multiperfil (RN-CORE-01). A licença é checada **a cada requisição**, não fica congelada no JWT.
> - **RN-PRO-01 vale pelo perfil, não pelo módulo.** Mesmo que um promotor ganhe o Vendedor, as ações de pedido continuam negadas (UI e API).
> - **RN-CORE-02 — fila offline de módulo desativado.** Antes de apagar os dados locais, o app tenta enviar a fila (outbox) do módulo. A API rejeita os itens com 403 `MODULO_INATIVO`, e eles aparecem na tela de sync como "não enviado — módulo desativado". Os dados locais do módulo só são apagados depois que o usuário confirma que viu (nada some em silêncio).
> - **Login e e-mail (premissa).** O e-mail é único **por tenant** (`unique(tenant_id, email)`). A tela de login pede **código da empresa + e-mail + senha**; o código da empresa fica salvo no aparelho depois do primeiro login.
> - **Promotor, vendedor e supervisor nunca acessam o BKO nem o portal `config.`** (decisão do dono do produto, 07/11/2026, RN-CORE-33); usam só os apps (Campo; Gestão para supervisor e gerente). O BKO é para admin, analista, assistente e gerente.

## 2. Matriz de permissões (perfil × ação)
> **Padrão de fábrica editável (decisão do dono do produto, 07/11/2026, R-20261107-185546; T-0111).** A matriz abaixo é o **valor inicial** dos perfis de cada tenant. O admin do cliente edita as permissões na página **Perfis de acesso** do BKO e pode criar perfis a partir de um perfil base. A mudança é auditada (RN-AUD-01) e vale na próxima requisição, sem novo login. O código consulta as permissões do perfil, sem regra fixa por perfil.
> **Limites travados (a tela mostra com cadeado; nenhum perfil muda):**
> - RN-CORE-33: vendedor, promotor, supervisor e os perfis derivados deles nunca entram no BKO nem no portal;
> - RN-PRO-01: o promotor nunca cria, edita ou cancela pedido;
> - sempre há pelo menos um admin ativo, e o admin não tira de si a gestão de perfis e usuários;
> - RN-CORE-32 vale para todas as senhas.
>
> **Valores iniciais de usuários e senhas:**
> - só o admin cria, edita e desativa usuários e redefine senhas (P2);
> - o admin redefine a senha de todos os perfis, menos a de outro admin e a própria (P7);
> - o admin recupera a própria senha pelo "Esqueci a senha" (P6, a senha temporária é paralela), e o super-admin da Macuxi pode redefinir a senha do admin do cliente pelo portal;
> - o admin inicial troca a senha master no 1º uso, no BKO (P5);
> - o "Esqueci a senha" pede o código da empresa e o e-mail (P8).

| Ação | Vendedor | Promotor | Supervisor/Gerente | Analista | Assistente | Admin |
|---|---|---|---|---|---|---|
| Ver Cliente 360 (inclui financeiro) | carteira | carteira | equipe | tenant | tenant | tenant |
| Criar/editar pedido | ✅ próprio | ❌ | ✅ em nome do vendedor | ✅ | ✅ | ❌ |
| Cancelar pedido (antes do envio ao ERP; depois, só no ERP) | ✅ próprio | ❌ | ✅ equipe | ✅ | ✅ | ❌ |
| Excluir rascunho | ✅ próprio | ❌ | ✅ próprio | ✅ | ✅ | ❌ |
| Ver pedidos | próprios | carteira (leitura), desativável no perfil [`promotor_ve_pedidos` = sim] | equipe | tenant | tenant | tenant |
| Aprovar desconto/crédito | ❌ | ❌ | ✅ até a alçada | ✅ acima | ❌ | ❌ |
| Coletas de trade (gôndola, share, preço, ruptura, validade, pontos extras) | ❌ | ✅ | leitura | leitura | leitura | ❌ |
| Cadastros de trade (mix, metas de share, concorrentes, planogramas, checklists, tarefas) | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Consultar catálogo (vitrine, busca, ficha) | ✅ com preço e estoque | ✅ sem preço de tabela e sem estoque [`promotor_ve_preco_estoque` = não] | ✅ | ✅ | ✅ | ✅ |
| Conteúdo, sinônimos, destaques e termos sem resultado do catálogo | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Responder pesquisa | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Criar pesquisa / trilha | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ |
| Criar/editar/copiar metas do mês (BKO Metas e RV, T-0068) | ❌ (vê a própria no app) | ❌ | ✅ equipe (RN-CORE-04) | ✅ tenant | leitura | ✅ tenant |
| Ativar/desativar módulos e usuários | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

> **Esclarecimento (gerente-projetos, 2026-10-31, observação O-3 da T-0006)**: pela matriz acima, o promotor **lê** os pedidos da própria carteira (somente leitura) e nunca cria, edita, cancela, duplica ou exclui (RN-PRO-01). A API deve liberar a leitura com escopo de carteira e continuar negando toda escrita.
> **Decisão do Alexandre (2026-11-02, R-20261102-204544)**: a leitura é uma opção da **configuração do perfil de acesso Promotor**, por tenant, editada pelo admin no BKO, com auditoria (RN-AUD-01): `promotor_ve_pedidos`, **padrão ligado**. Desligada, a API devolve 403 nas rotas de lista, detalhe e pull de pedidos para o perfil promotor, e o app não mostra pedido em lugar nenhum (Cliente 360 inclusive). Checada a cada requisição, como a licença. A RN-PRO-01 não muda: o promotor nunca cria, edita, cancela, duplica, exclui nem aprova pedido (UI e API, 403).

## 3. Core — visita, rota, metas
- **RN-CORE-10** Check-in só dentro de [200 m] do cliente; fora do raio exige justificativa e fica sinalizado. Cliente sem coordenada: o 1º check-in sugere a coordenada para o BKO aprovar.
- **RN-CORE-11** Um atendimento aberto por vez; o esquecido fecha sozinho na virada do dia (fuso do tenant) como "não finalizado".
- **RN-CORE-12** Checkout exige as etapas obrigatórias registradas pelos módulos ativos (ex.: pesquisa obrigatória) e motivo quando não houve pedido (se Vendedor ativo).
  - *Complemento (T-0039, decisão do gerente em 05/11/2026, aceita pelo Alexandre em R-20261105-054146; dispensa manual por supervisor/admin com justificativa e auditoria; supervisor de outra equipe recebe 404):* o app continua exigindo as etapas antes do checkout. No **servidor**, a etapa de outro módulo que ainda não chegou (ex.: resposta da pesquisa enviada depois, rejeitada ou em nova tentativa) **não recusa** o checkout: a visita é aceita com **pendência** da etapa (`core.visita_etapa` 'pendente'), que some quando chegar `pesquisa.resposta.registrada@1` da mesma visita. Sem baixa em [`checkout_pendencia_alerta_h` = 24] h, vira alerta ao vendedor e ao supervisor. Motivo de "sem pedido" fora da lista do tenant continua recusado (422). Desenho: docs/desenho/T-0039.md §2.
- **RN-CORE-14** Visita sem atendimento por **cliente fechado**: motivos `loja_fechada` e `acesso_negado`, com foto da fachada obrigatória, valem para vendedor e promotor. Eles dispensam as etapas obrigatórias do checkout (inclui a pesquisa obrigatória, RN-PES-03, e o checklist da loja, RN-PRO-06). O core informa o motivo às etapas do slot `visita.etapas_checkout`.
- **RN-CORE-13** Localização: o check-in e o checkout gravam o GPS do momento. O rastreamento contínuo (Campo; no Gestão, só o supervisor) usa a permissão da RN-CORE-37 e é interno: quem é rastreado não vê o próprio trajeto, sem termo nem aceite, e só a notificação fixa do Android aparece (T-0187, P7 A). O gerente não é rastreado. O rastreamento liga quando o dono do produto mandar, pelo parâmetro do BKO (R-20261119-0545, alexandre). *(Alexandre, R-20261110-062232 e R-20261119-192029; T-0145, T-0156 e T-0187.)*
- **RN-CORE-20** Visitado = check-in no dia; positivado = ≥ 1 pedido aprovado (aprovado, integrado ou faturado) com **data de emissão** no período (mesma regra da meta de pedido, RN-CORE-21); cobertura = visitados ÷ planejados.
- **RN-CORE-21** O realizado depende do **tipo da meta**, definido na própria meta (decisão do Alexandre, 2026-11-02, R-20261102-120408):
  - **Meta de pedido:** soma dos pedidos **aprovados** (aprovado, integrado, faturado), contados na **data de emissão do pedido** (fuso do tenant). Pedido aguardando aprovação ainda não conta; ao ser aprovado, passa a contar na data de emissão; rejeitado ou cancelado não conta. A data da aprovação não muda o mês do pedido (pedido de 31/10 aprovado em 02/11 conta em outubro).
  - **Meta de faturamento:** soma do **valor faturado**, contado na **data do faturamento** informada pelo ERP (retorno `faturado_parcial` / `faturado_total`), líquido de cancelamentos e devoluções.
  - Pedido feito pelo gestor em nome do vendedor conta para o vendedor. Automático, sem escolha do usuário.
  - **Fechamento do mês** (premissa do gerente sobre a proposta do Alexandre): como aprovações tardias mudam o mês anterior, o fechamento da meta/RV roda no **2º dia útil do mês seguinte**; até lá a tela Metas mostra "parcial até o fechamento".
- **RN-CORE-22** Necessidade diária = (meta − realizado) ÷ dias úteis restantes.
- **RN-CORE-23 Sincronização no app** *(Alexandre, 2026-11-02, R-20261102-121135 e R-20261102-124413; substitui a "atualização automática de 3–5 min" do R-20261102-120408 (A) e o intervalo de 5 min do R-20261102-111438)*
  1. **Botão "Sincronizar"** sempre visível no Campo e no Gestão (Início e Perfil), com "Última sincronização hh:mm · N na fila". Faz envio da fila + pull na hora.
  2. **Envio automático da fila:** pedido, visita, pesquisa, coleta e fotos sobem sozinhos assim que houver sinal, com retentativa. Nunca dependem do botão.
  3. **Aviso do servidor:** quando muda algo que o usuário precisa saber (pedido aprovado/rejeitado/integrado/faturado, pedido para aprovar, recado, meta, rota do dia), o servidor manda um push ao(s) aparelho(s) afetado(s). Pode ser visível (RF-CORE-09) ou silencioso. O app baixa **só as entidades indicadas**.
  4. **Atualização automática leve:** ao abrir o app, ao voltar ao primeiro plano depois de [30] min, e a cada [`sync_auto_min` = 30] min com o app em uso e com sinal. Cada uma começa com **uma** chamada de novidades (`GET /v1/sync/novidades?desde=<cursor>`); só puxa as entidades que mudaram.
  5. **Puxar para baixo** nas listas = Sincronizar (com proteção de 30 s contra toques repetidos).
  6. **Gestão e BKO:** sem consulta periódica curta. Pedido para aprovar chega por push no Gestão; no BKO, o painel de aprovação atualiza a cada [`sync_auto_min`] min ou pelo botão "Atualizar".
  - Nenhum timer automático abaixo de 15 min no app e no BKO (varredura no CI). Exceção: o envio automático da fila (item 2), que só sobe o que está pendente e não consulta novidades.
- **RN-CORE-26 Meta do dia (boas-vindas, T-0073)** Meta do dia = (meta do mês − realizado até ontem) ÷ dias úteis restantes do mês, **contando hoje**. É calculada por indicador cadastrado na meta (vendas, positivação, visitas, mix…), com o realizado pela regra do tipo da meta (RN-CORE-21). No supervisor e no gerente, é a soma da equipe. Os dias úteis seguem o calendário do tenant [`dias_uteis_semana` = segunda a sábado], sem feriados até existir o cadastro de feriados. Se a meta do mês já foi batida, a tela mostra "batida", nunca valor negativo. Funciona offline com o que veio na última sincronização. Refina a RN-CORE-22 para a tela de boas-vindas. Na equipe, a meta do dia é a **soma das metas do dia de cada pessoa**, não a fórmula aplicada ao total. Se o dia virar sem sinal, o "hoje" da última cópia passa a contar como "ontem", e a tela mostra de quando é a base. **Equipe agora**: "em visita" = check-in aberto; "parado" = sem visita aberta, com paradas pendentes na rota e [`inicio.parado_min` = 60] min ou mais desde o último checkout. Não usa expediente nem GPS. **Recado do dia**: um recado que já existe, marcado como "recado do dia" no BKO pelo supervisor ou gerente, vale naquele dia (hoje no fuso do tenant, decidido pelo servidor; um recado do dia por pessoa por dia) para a equipe destinatária, dentro do escopo de quem marca. Sem recado marcado, aparece a frase padrão do tenant [`recado_do_dia_padrao`]. *(Alexandre, R-20261103-161508.)*
- **RN-CORE-27 Positivação pelas notas do ERP (Vendedor desligado, T-0080)** Com o módulo Vendedor desligado e a Integração recebendo notas, positivado no mês = cliente com ao menos 1 **nota de faturamento** do ERP **não cancelada** e não inativada, **emitida no mês** (dia civil no fuso do tenant), atribuída ao **vendedor da nota**. Cada cliente conta **uma vez** no mês, no dia da primeira nota válida (para a RN-CORE-26, "hoje" = clientes novos hoje). Nota cancelada ou inativada depois retira o cliente se ele não tiver outra nota válida no mês. Devolução não positiva nem retira. Nota sem vendedor conhecido não conta para ninguém até o vendedor chegar do ERP. Com o Vendedor ligado vale só a RN-CORE-20 (pedido); as duas fontes **nunca se somam**. Lida na hora da consulta a partir de `core.nota_erp` (sem cópia no `core.indicador_diario`). *(Proposta do engenheiro-software, registrada pelo gerente em 05/11/2026 na noite autônoma; aceita pelo Alexandre em R-20261105-054146: licença do tenant, devolução não retira; a venda do Início continua vindo do pedido.)*
- **RN-CORE-28 Farol de clientes.** Carteira = clientes ativos com vínculo de vendedor; o cliente com dois vendedores conta uma vez no total. Dias sem compra = hoje (fuso do tenant) − última compra, pela mesma fonte do Cliente 360; sem compra registrada = "sem compra". Cliente positivado no mês = verde sempre. Fora isso: até [`farol.verde_ate_dias` = 30] dias, verde; até [`farol.amarelo_ate_dias` = 45], amarelo; acima, vermelho. Positivação pela fonte do tenant (RN-CORE-20 ou RN-CORE-27, nunca somadas). Cor do vendedor ou da equipe = positivados ÷ carteira: a partir de [`farol.positivacao_verde_pct` = 70%], verde; a partir de [`farol.positivacao_amarelo_pct` = 50%], amarelo; abaixo disso, vermelho. Veem: supervisor (equipe), gerente (equipes abaixo), analista, assistente e admin. Editam os parâmetros: analista e admin, com auditoria. *(Proposta do engenheiro-software, T-0081/T-0082/T-0083, 05/11/2026; registrada pelo gerente.)*
- **RN-CORE-29 Cálculo da RV.** Atingimento = realizado ÷ meta da pessoa (RN-CORE-21). Faixa pelo maior "a partir de": zero, proporcional (até 100%) ou fixo (o % informado; 120 = acelerador). Valor = valor máximo × peso × % pago, em centavos. Gatilho abaixo da meta zera a RV; gatilho sem meta não bloqueia; indicador sem meta paga 0. Mês aberto: RV projetada (venda e visitas pela projeção em dias úteis da RN-CORE-26; positivação e cobertura pelo realizado), "parcial até o fechamento". Gatilho no mês aberto: venda e visitas pela projeção (não pelo realizado até hoje contra a meta do mês inteiro); positivação e cobertura pelo realizado, com o texto "ainda não atingido" enquanto o mês corre. Mês fechado: pelo realizado. Calculada na hora, nada gravado. *(Proposta do engenheiro-software, T-0081/T-0082/T-0083, 05/11/2026; registrada pelo gerente. Gatilho no mês aberto: revisão R-20261105-082411.)*
- **RN-CORE-30 Plano e vigência.** Um plano por tenant por mês de início, para os perfis do plano (padrão: vendedor). Indicadores = os da meta, cada um uma vez. Os pesos dos indicadores que não são gatilho somam 100. As faixas começam em 0%, sobem sem repetir e vão de 0 a 300%. Plano que já valeu para um mês fechado não muda: a mudança vira uma versão nova a partir do mês aberto. Editam: analista e admin, com auditoria. Veem a RV: supervisor (equipe), gerente, analista e admin; vendedor e promotor veem só a própria (cartão "Minha RV" no app, offline com o último cálculo recebido). O assistente não vê. *(Proposta do engenheiro-software, T-0081/T-0082/T-0083, 05/11/2026; registrada pelo gerente. Vendedor e promotor com a própria RV: decisão do gerente em 05/11, entrega R-20261105-151401.)*
- **RN-CORE-31 Onboarding de tenant.** Uma transação cria o tenant, as licenças dos módulos pedidos (core sempre; módulo sem a dependência é recusado), os módulos por perfil (os perfis padrão do manifesto) e o admin inicial. Os parâmetros não geram linha (vale o padrão do doc 03). Idempotente pelo código: rodar de novo só acrescenta os módulos que faltam, nunca desativa nada nem troca a senha (salvo `--redefinir-senha`). Senha nunca em argumento, saída ou log. Auditoria `tenant.provisionar`. *(Proposta do engenheiro-software, T-0081/T-0082/T-0083, 05/11/2026; registrada pelo gerente.)*
- **RN-CORE-32 Senha e acesso ao portal.** Toda senha da plataforma (portal `config.`, BKO e apps) tem **no mínimo 8 caracteres**, com pelo menos **uma letra, um número e um caractere especial**. A regra vale na criação e na troca; senhas já gravadas continuam valendo. O portal de implantação entra só com **e-mail e senha**, sem código de convite e sem TOTP. Se o e-mail tiver acesso a mais de uma empresa (com a senha conferida em cada uma), o usuário **escolhe a empresa** depois do login; com uma só, entra direto. O time da Macuxi (super-admin) vê todas as empresas. *(Decisão do dono do produto, 07/11/2026; substitui o convite, o TOTP e o mínimo de 12 caracteres da ADR 0029. T-0093.)*
- **RN-CORE-33 Acesso por perfil ao BKO e ao portal.** Vendedor, promotor e supervisor **nunca** acessam o BKO nem o portal `config.`: a API recusa e o login não aceita. O portal é do time da Macuxi (super-admin) e do **admin** do cliente. *(Decisão do dono do produto, 07/11/2026, T-0094.)*
- **RN-CORE-37 Permissões obrigatórias.** Na 1ª abertura, antes do login e da sincronização:
  - o app **Campo** exige notificações, localização "Permitir o tempo todo", câmera e fotos/galeria;
  - o **Gestão** exige notificações; para o **supervisor**, também a localização "Permitir o tempo todo", pedida logo depois do login, quando o app já sabe o cargo (RN-CORE-13; T-0187).

  Sem todas concedidas, o app não roda. Ele fica numa tela com o motivo de cada permissão, "Permitir" e "Abrir configurações", porque o Android para de perguntar depois de duas recusas. No Android 11+, a localização "o tempo todo" leva 2 passos, primeiro "durante o uso" e depois as configurações, e a tela guia o usuário. O app confere as permissões **a cada abertura**: se alguma foi retirada, volta à mesma tela. *(Alexandre, R-20261110-062232; T-0145.)*
- **RN-CORE-38 Fotos do PDV.**
  - **Tipos:** o admin define os tipos de foto no BKO, em Cadastros › Fotos do PDV (ex.: fachada, CNH do sócio, contrato social), e diz quais são obrigatórios.
  - **Na ficha do cliente:**
    - "Ver foto do PDV", ao lado de Mapa, abre a **fachada** e fica desligado sem ela;
    - o resumo mostra "tem/falta" para cada tipo.
  - **Captura:** o vendedor tira as que faltam com a câmera ou anexa da **galeria**. A galeria vale só aqui: as fotos de trade (RN-PRO-02) e a da fachada no checkout continuam só pela câmera.
  - **Envio e armazenamento:** funciona offline, pela fila de arquivos (ADR 0010). As fotos ficam em JPEG comprimido no bucket privado; base64 só na transmissão.
  - **Acesso:**
    - o vendedor vê só a fachada; dos outros tipos, vê só que existem e não os reabre;
    - os documentos sensíveis (CNH, contrato social) abrem só para admin, analista, **gerente** e supervisor da carteira (o gerente foi incluído pelo Alexandre em 10/11, R-20261110-085951);
    - o acesso nunca vai para o log técnico;
    - **registro de acesso** (aprovado pelo Alexandre em 10/11, entra depois da v1.0.5): quem abriu, quando e qual cliente, gravado no banco e visível só ao admin no BKO.
  - **Retenção:** enquanto o cliente estiver ativo e mais 5 anos (LGPD).
  - **Premissas do gerente** (10/11, a partir do desenho):
    - só o admin cadastra tipos (confirmado pelo Alexandre);
    - a "Fachada" já nasce cadastrada;
    - há uma foto vigente por tipo e cliente;
    - não há URL pública nem pré-assinada: a API confere perfil e carteira a cada leitura;
    - o arquivo sensível é apagado do aparelho assim que o envio é aceito.
  - **Técnico:** ADR 0041 e `docs/desenho/T-0147.md`.

  *(Alexandre, R-20261110-062234 e R-20261110-062242; T-0147.)*
- **RN-CORE-39 Filial.**
  - **O que é:** a unidade de onde saem as entregas (ex.: Manaus-AM 0001, Boa Vista-RR 0002). Pode haver várias no mesmo estado, como Belém e Santarém, no PA.
  - **Cadastro:** no BKO, com código, nome e cidade/UF. A empresa nasce com 1 **filial padrão**.
  - **CNPJ e endereço obrigatórios** (Alexandre, R-20261110-220007, 10/11/2026; T-0159):
    - **obrigatórios:** CNPJ (14 dígitos, com dígito verificador) e endereço completo (logradouro, número, bairro, cidade, UF, CEP); o telefone é opcional;
    - **BKO:** recusa a filial sem esses campos, mostrando o que falta;
    - **carga do ERP e do Conector:** rejeita o registro sem eles e mostra o erro no monitor da integração, sem gravar a filial;
    - **cabeçalho dos PDFs de pedido e de orçamento:** sempre os dados da filial de faturamento do pedido, nunca os da matriz.
  - **Filial do cliente:** cada cliente tem uma filial; sem informação, fica na padrão. Ela vem do ERP quando a empresa integra e é editada no BKO quando não integra.
  - **Estoque:** o mostrado no app (busca, Novo pedido) e no BKO é o da filial do cliente.
  - **Preço:** a **tabela de preço vale por filial**, e o preço do pedido sai da filial do cliente.
  - **Pedido:** leva a filial até o detalhe, os PDFs e a devolução ao ERP.
  - **Premissas do gerente:**
    - o pedido usa a filial do cliente, sem escolha no pedido;
    - o fallback é **por tabela**: a tabela do cliente sem nenhum item na filial dele usa os itens da filial padrão; o produto sem item na filial usada continua "Sem preço para este cliente" (RN-CAT-06);
    - sem registro de estoque na filial, o estoque é 0;
    - a filial do pedido é a do cliente **no recebimento**, e o servidor recalcula (RN-VEN-02);
    - a tabela escalonada sem filial vale para todas as filiais;
    - o cadastro de filial é feito por admin e analista;
  - **Técnico:** ADR 0040 e `docs/desenho/T-0149.md`. Tudo é aditivo: consulta `core.filiais@1`, evento `integracao.filial.atualizado@1` e Conector 1.4.0 para pedido de filial que não é a padrão.

  - **Filial do usuário** (Alexandre, R-20261115-073000 e R-20261115-080000):
    - **vendedor:** exatamente **uma** filial, obrigatória. Ela é a referência dele: preço e estoque no Catálogo e o filtro de filial que abre já marcado;
    - **supervisor, promotor e gerente:** várias filiais;
    - **quem informa:** o admin no BKO (Usuários) ou a carga do ERP;
    - **vendedor sem filial fica bloqueado** no app até a filial ser informada, inclusive quem já existe; não há filial padrão provisória.

  *(Alexandre, R-20261110-062236; T-0149.)*
- **RN-CORE-40 Indicadores de compra da ficha do cliente** (topo da ficha, Campo, Gestão e BKO; T-0146).
  - **Janela:** os 12 meses que terminam no mês de hoje, inclusive, no fuso do tenant.
  - **Fórmulas:**
    - **Compra média/mês** = total da janela ÷ 12, sempre;
    - **Ticket médio** = total da janela ÷ nº de pedidos da janela;
    - **Frequência média (dias)** = dias desde o 1º dia do 1º mês com compra na janela até hoje ÷ nº de pedidos, com 1 casa;
    - **Última compra** = a maior data de compra da janela, com "há N dias".
  - **Sem compra na janela:** "Sem compras em 12 meses" no lugar dos 4 indicadores, sem zeros.
  - **Arredondamento:** valores em centavos, meia para cima.
  - Limite disponível e títulos vencidos ficam só no bloco Financeiro.

  *Premissa do gerente, 10/11:* a média divide sempre por 12, e não pelos meses com compra. Assim, o cliente que comprou em 2 dos 12 meses aparece com média baixa, que é o sinal que o vendedor precisa ver. *(Alexandre, R-20261110-062233; pergunta do testes, R-20261110-072459.)*
- **RN-CORE-34 Criação de usuários e ciclo de senha.** O primeiro acesso de cada empresa é o do **admin do cliente**, com login e senha master inicial definidos pelo time da Macuxi no portal `config.` ao cadastrar a empresa. A partir dele, o admin cria no BKO os demais usuários (BKO, gerente, supervisor, vendedor…) com uma senha inicial (RN-CORE-32); a senha vai ao **e-mail** do usuário, que a **troca no primeiro uso**. No app há **Esqueci a senha**: uma senha nova vai ao e-mail e também precisa ser trocada no uso. O BKO pode **redefinir** a senha de vendedor, supervisor e gerente. Toda troca ou redefinição encerra as sessões abertas do usuário; senha nunca em log. *(Decisão do dono do produto, 07/11/2026, T-0093/T-0094.)*
- **RN-CORE-35 Limites dos perfis de acesso.** Nenhuma edição de perfil pode quebrar estes limites, conferidos no domain e na API (não só na tela): RN-CORE-33 (perfis com base vendedor, promotor ou supervisor, e os derivados deles, não entram no BKO nem no portal); RN-PRO-01 (o **perfil** promotor não cria, edita nem cancela pedido); sempre um admin ativo, que não tira de si a gestão de perfis e de usuários; RN-CORE-32 em todas as senhas. **Multiperfil:** nas **ações**, vale a união dos perfis (quem é vendedor + promotor vende pelo perfil de vendedor e faz trade pelo de promotor); nos **acessos** (BKO, portal), vale a regra mais restritiva (basta um perfil de base vendedor, promotor ou supervisor para fechar o BKO e o portal). *(Gerente, 07/11/2026, a partir do R-20261107-185546 e do R-20261107-173950 c; ADR 0033; combinação confirmada pelo dono do produto em 07/11 às 21h50.)*
- **RN-CORE-36 Pendências de preenchimento.** Em formulário com abas (Novo pedido e, depois, visita, pesquisa, cadastro), as pendências de preenchimento aparecem só na última aba (no pedido, o Resumo), num bloco único "Falta para salvar", acima do botão de salvar. Cada linha diz o que falta e em qual aba corrigir ("Transportadora do frete FOB — aba Entrega"; forma e prazo: "— aba Venda"). Não há botão de correção nem alerta nas outras abas; a aba com pendência ganha só uma bolinha. Enquanto houver pendência, o botão de salvar fica desabilitado. *(Alexandre, 08/11/2026; T-0125. Padrão visual em `docs/design/`, T-0126.)* **No pedido, a partir de 10/11/2026:** o "Falta para salvar" passa para a área única **"Alertas"** no topo (RN-VEN-42, R-20261110-093124). Cada linha continua dizendo o que falta e em qual aba corrigir. **A partir da v1.0.5 (T-0166, R-20261112-031457, RD-0170):**
- O campo obrigatório vazio aparece **no próprio campo**, com borda e texto curto.
- A falta só entra em Alertas **quando o vendedor tenta avançar, salvar ou enviar**. O pedido recém-aberto não mostra alerta de preenchimento.
- Falta de dado opcional nunca vira alerta.

**Cliente — cadastro mínimo** (decisão do Alexandre, 2026-11-02, R-20261102-092329)
- **RN-CORE-16** Cadastro completo: o cliente só fica **ativo para faturamento** quando todos os campos da lista `cliente_campos_obrigatorios` do tenant estão preenchidos e válidos. Padrão: razão social; CNPJ ou CPF com dígito verificador válido; inscrição estadual ou "isento" (só para CNPJ); logradouro, número, bairro, município, UF e CEP. O tenant pode acrescentar campos à lista, mas não pode tirar o CNPJ/CPF. A verificação roda na integração (Hub), na edição pelo BKO e na sincronização, e mora no `domain` do Core.
- **RN-CORE-17** Cliente com cadastro incompleto **é integrado normalmente** e aparece na carteira, na rota e no Cliente 360 (visita, pesquisa, promotoria e treinamento funcionam). O sistema escreve no topo do campo **Observações** do cliente, no app e no BKO, uma linha automática: "Cadastro incompleto: falta <campos>." A frase "Pedido só como orçamento…" saiu na v1.0.5 (RD-0183), porque explicava o sistema e o alerta do pedido já diz isso. Essa linha não apaga o texto vindo do ERP, é refeita a cada atualização do cliente e some sozinha quando o cadastro fica completo. Na carteira, o cliente mostra a etiqueta "Cadastro incompleto". *(A partir da v1.0.5 essa etiqueta sai da lista e fica na ficha e nas pendências do pedido; ver RN-CORE-47.)*
- **RN-CORE-47 Linha da lista de Clientes** (Alexandre, R-20261112-180115, 204602 e 204639; T-0171; v1.0.5; Campo e Gestão):
  - **Uma tag só, de situação**, nesta ordem: **Bloqueado** > **Devendo** (há título vencido; vermelho) > **Pré-Cadastro** > **Em dia** (verde).
  - **Pré-Cadastro**:
    - é o cliente cadastrado no app ou no BKO que ainda não voltou do ERP com o código ERP;
    - sai quando o ERP devolve o cadastro com o código ERP, o limite, o prazo e os demais dados, pelo Conector ou pela API;
    - tom neutro, proposto pelo designer-ux e validado pelo design-de-marca.
  - **A linha de baixo traz só a última visita**, pelo último check-in de qualquer vendedor e no calendário do fuso do tenant: "Visitado hoje", "Visitado ontem", "Visitado há N dias" ou "Nunca visitado".
  - **Nada mais na linha**: só o nome, a tag, a última visita e a seta. "Cadastro incompleto" fica na ficha do cliente e nas pendências do pedido.
  - **Filtros**: o filtro "Com título vencido" passa a se chamar **"Devendo"**, igual à tag. Os outros filtros ficam.
  - **Regra geral das listas**: uma informação por linha. A tag diz a situação e a linha de baixo diz um único fato.
- **RN-CORE-48 Etapas da carga de entrada** (revista em 15/11/2026, R-20261115-070200, ADR 0054; v1.0.13): a carga do Campo segue a ordem: envio do que ficou no aparelho, Clientes e rota, Pedidos e metas, Fotos e materiais e, **por último, Catálogo e preços** (a única etapa grande). Na Gestão: envio, Equipe, Metas, Alertas e, por último, Aprovações (que contém o catálogo). A tela mostra o nome e o número da etapa, e o número nunca volta.
- **RN-CORE-62 Entrada antes do fim da carga** (R-20261115-070200, ADR 0054; v1.0.13): na primeira carga, o usuário entra no app quando **Clientes e rota** terminam (na Gestão, quando **Equipe** termina). O catálogo continua carregando, com busca, ficha e preço online até terminar; sem sinal, a tela diz "Catálogo ainda carregando". O app reaberto no meio da carga entra direto.
- **RN-CORE-49 Curvas ABC do cliente** (Alexandre, chat de 14/11/2026 5h55; ficha do cliente, Campo e Gestão):
  - **Três curvas por cliente**, cada uma com o nome da dimensão na tag: **Faturamento** (R$), **Volume** (itens) e **Frequência** (pedidos). Ex.: "Faturamento A", "Volume B", "Frequência C". A tag "Curva X" sem dimensão sai.
  - **Base**: o mês atual comparado com a média dos 3 meses anteriores do próprio cliente (linhas do histórico do mesmo mês somadas; mês sem compra conta como zero).
  - **Padrões** (Alexandre, chat de 14/11/2026 6h16: "Curva A entre 20% ou mais acima da media. Curva B: abaixo de 20% até a média. Curva C abaixo da media."): **A** com +20% ou mais; **B** da média (0%) até abaixo de +20%; **C** abaixo da média. As mesmas faixas valem para as três dimensões.
  - Os percentuais são parâmetros do tenant (`cliente.curva_abc.a_min_pct` e `cliente.curva_abc.c_abaixo_pct`); ausente ou inválido vale o padrão.
  - **Sem histórico de 3 meses**, a curva não aparece. Dimensão com média zero também não.
  - O promotor sem `promotor_ve_pedidos` não vê as curvas (RN-PRO-01).
  - Na ficha, as curvas ficam no **Resumo**. "Positivado em <mês>" sai da ficha; o segmento deixa de ser tag e vira dado de **Dados cadastrais**.

**Produto — custo, preço e medidas** (decisões do Alexandre, 2026-11-02, R-20261102-094644 e R-20261102-111619)
- **RN-CORE-18** Cadastro do produto: custo e preço de venda são obrigatórios. Margem (%) = (preço − custo) ÷ preço; markup (%) = (preço − custo) ÷ custo; lucro (R$) = preço − custo; calculados, nunca digitados. Produto sem preço de venda não é vendável. Produto sem custo é vendável, mas aparece como "custo não informado" no BKO e no monitor de integração. **Custo, margem, markup e lucro são dados internos:** só o BKO (admin, analista, gerente) os vê; não vão para o app de campo nem para o PDF do cliente.
- **RN-CORE-19 Medidas** As medidas (sigla e descrição) são cadastradas pelo tenant em Parâmetros → Produtos. Todo produto tem a medida da unidade e, opcionalmente, uma embalagem (medida + quantidade de unidades). Pedido, app, BKO e PDFs mostram sempre a sigla da medida vendida. Na integração, sigla não cadastrada é linha com erro `referencia_ausente` (reprocessável, RN-INT-04).

## 4. Vendedor — preço, desconto, crédito, estoque, status
- **RN-VEN-01** Preço base = tabela vigente do cliente na data do pedido; sem preço → item não vendável.
  - **Catálogo sem cliente** (Alexandre, R-20261112-181237 e R-20261112-181527; v1.0.5):
    - o Catálogo aberto pelo menu mostra o preço da **filial do vendedor** (RN-CORE-39), pela tabela de preço da filial;
    - produto sem preço nessa filial mostra **"Sem preço"**, nunca o valor de outra tabela;
    - aberto pela ficha do cliente, o preço da tabela do cliente ajustado pelo prazo padrão dele (RN-VEN-43).
- **RN-VEN-02** Preço final do item = base × (1 − desconto do item) ou base × (1 + acréscimo do item). Total dos itens = Σ linhas × (1 − desconto do pedido) ou × (1 + acréscimo do pedido). A base do item já é a tabela ajustada pelo % do prazo (RN-VEN-43). O frete não tem valor no pedido (RN-VEN-16). Arredondamento em centavos, meia para cima, **no preço unitário** da medida vendida; total da linha = preço unitário × quantidade; o desconto ou acréscimo do pedido é calculado sobre o total dos itens e rateado nas linhas pelo maior resto. Desconto ou acréscimo em R$: no item, por unidade da medida vendida; no pedido, sobre o total dos itens, com rateio pelo maior resto *(T-0071, 03/11: fecha os números da referência aprovada, R-20261103-130003; confirmado em R-20261103-140707)*. Desconto e acréscimo do pedido são excludentes (um ou outro). *(Redação de 2026-11-02, R-20261102-093007.)*
  **A partir da v1.0.5 (T-0165, aprovada pelo dono do produto em R-20261112-031456, -031841 e -032141):**
  - **O desconto ou acréscimo é sempre no item, em %.** Não existe mais desconto ou acréscimo do pedido sobre o total.
  - O "Desc./Acrésc. geral" da aba Itens só aplica o mesmo % a todos os itens:
    - sobrescreve o desconto que cada item já tinha, com confirmação quando há diferença;
    - o item adicionado depois entra com o último geral aplicado.
  - **Arredondamento continua como acima:** meia para cima no preço unitário; total da linha = unitário × quantidade. Decisão do gerente em 12/11, achado do testes R-20261112-033854: imagens e exemplos que arredondam o total da linha valem só para o desenho, o número segue esta regra.
  - **Totais:** Valor de tabela, "Desconto (%)" (sobre o valor de tabela), "Desconto (R$)" (soma das linhas) e Valor final.
  - Pedidos já gravados com desconto do pedido continuam sendo lidos e exibidos como foram gravados.
- **RN-VEN-03** Desconto efetivo do pedido = 1 − (total dos itens após descontos e acréscimos ÷ total pela tabela), **sem o frete**. Pode ser negativo (acréscimo). Exibido com 1 casa, calculado dos valores em centavos (nunca de um % já arredondado).
- **RN-VEN-10** Alçada: ≤ [vendedor 5%] aprova; ≤ [supervisor 10%] vai ao supervisor; ≤ [gerente 15%] vai ao gerente; acima → analista. Pedido feito pelo gestor usa a alçada do gestor. A alçada olha **só o desconto efetivo do pedido** (RN-VEN-03), nunca o desconto de um item: item com 30% de desconto e pedido com desconto efetivo de 5% fica dentro da alçada de 5% e não vai para aprovação. Desconto efetivo ≤ 0 (acréscimo) nunca vai para aprovação.
  - **Alçada nos Alertas** (T-0165, R-20261112-031456 regra 3; RD-0142; substitui o "Alçada só ao salvar" de R-20261110-062238):
    - acima da alçada, aparece uma linha `Desconto acima da sua alçada` nos Alertas, uma por pedido, venha o desconto do geral ou dos itens;
    - ao tocar em Salvar e enviar pedido, vem a pergunta `Enviar para aprovação?` (Enviar / Voltar);
    - nada em caixa de % nem embaixo do botão;
    - orçamento não tem alçada.
- **RN-VEN-11** Preço mínimo do item = preço de venda do cadastro do produto, ajustado pelo % do prazo (RN-VEN-43), × (1 − desconto máximo aplicável do produto; vazio = [`desconto_maximo_produto_pct` 15%]). O desconto do item (sobre a tabela ajustada, RN-VEN-02) não pode levar o preço final abaixo do preço mínimo **para enviar o pedido**: acima do máximo, o pedido só sai como orçamento (ver "Acima do máximo bloqueia o envio", abaixo, que substitui o antigo "trava o desconto no limite"). Esse teto vale por item, depende da função "Limitar desconto por item" do usuário (RN-VEN-11a) e é independente da alçada do pedido (RN-VEN-10). O mínimo é arredondado **para cima** ao centavo, igual no BKO, no app e na API. Exemplo, sem % no prazo: 1891 × 0,85 = 1607,35, então o mínimo é 1608. A API revalida no envio e no Transformar e recusa com `preco_abaixo_minimo` (422). O orçamento não trava (T-0168). *(Redação de 2026-11-02, R-20261102-094644; arredondamento decidido pelo gerente em 05/11, D-T0071-C6r.)*
  - **Acima do máximo bloqueia o envio** (Alexandre, 10/11/2026, R-20261110-062238; T-0151; substitui o "trava o desconto no limite"):
    - item com desconto acima do máximo do produto **não deixa enviar o pedido**: só "Salvar como orçamento" é permitido, porque é configuração do produto e não passa nem com aprovação;
    - o motivo aparece numa linha: "AGU-1500 acima do desconto máximo";
    - o orçamento só vira pedido depois de o desconto do item ser ajustado;
    - a recusa da API é curta e só do problema, com a **mesma frase** em todo lugar (app, API, detalhe e lista): "AGU-1500 acima do desconto máximo", sem a linha da alçada (frase única do RD-0071, 10/11).
- **RN-VEN-11a Limite de desconto por usuário** *(Alexandre, R-20261112-080845; entra na v1.0.5 por R-20261112-121131; simulação aprovada em R-20261112-183709; T-0168.)*
  - **Duas funções na aba Parâmetros do usuário (BKO)**, junto com o limite:
    - **"Limitar desconto por item"**: ligada, vale a trava da RN-VEN-11. Desligada, o item pode passar do desconto máximo do produto.
    - **"Limitar desconto por pedido"**: ligada, o desconto efetivo do pedido (RN-VEN-03) não pode passar do **"Desconto máximo do pedido (%)"** do usuário. O campo só aparece com a função ligada e é obrigatório, de 0 a 100, com 1 casa.
  - **Padrão**: para usuário novo e para todos os que já existem, "por item" ligada e "por pedido" desligada, o mesmo comportamento de antes.
  - **Combinações**:
    - as duas ligadas valem juntas: nenhum item passa do máximo do produto e o pedido não passa do limite do usuário;
    - as duas desligadas deixam só a alçada (RN-VEN-10).
  - **Acima do limite do pedido**:
    - trava o envio como na RN-VEN-11: só "Salvar como orçamento";
    - a frase única nos Alertas, na API, no detalhe e na lista, igual no Campo e no Gestão, é "Pedido acima do desconto máximo (X%)", em que X é o limite de quem faz o pedido (RD-0196, aprovado em R-20261112-183709);
    - a trava compara pelo **valor exibido**, com 1 casa: 8,04% aparece como 8,0% e não trava num limite de 8,0%, mas 8,05% trava (R-20261112-183709);
    - a ajuda da linha "por pedido" no BKO sai (RD-0197);
    - a recusa da API é `desconto_pedido_acima_limite` (422).
  - **A alçada continua valendo abaixo do limite.** Exemplo, com alçada de 5% e limite de 8%:
    - até 5%, aprova;
    - acima de 5% e até 8%, vai para aprovação (RN-VEN-10);
    - acima de 8%, trava.
  - **Quem vale**: pedido feito pelo gestor em nome do vendedor usa as funções e o limite **do gestor**, como na alçada. Orçamento não trava; a regra vale no envio e no Transformar.
  - **Offline e API**:
    - as funções e o limite vão no sync do usuário;
    - o app aplica offline;
    - a API revalida no envio, no orçamento salvo como pedido e no Transformar;
    - acréscimo (desconto efetivo ≤ 0) nunca trava.
- **RN-VEN-12** Crédito disponível = limite − saldo em aberto − pedidos aprovados não faturados. Excedeu → o pedido a prazo vai para aprovação (motivo `credito`). Sem limite vindo do ERP, o pedido a prazo também vai (P4 A). Quem aprova é o parâmetro "Quem aprova crédito" (padrão: Gerente). *(T-0184, `docs/desenho/T-0184.md` §0.)*
- **RN-VEN-13** Título vencido há mais de [5] dias → o pedido vai para aprovação (motivo `inadimplencia`), **mesmo à vista** (T-0184, P1 A). Quem aprova é o parâmetro "Quem aprova inadimplência" (padrão: Gerente). Cliente bloqueado, inativo ou com **cadastro incompleto (RN-CORE-17)** → só orçamento: o vendedor monta e salva, mas não envia para aprovação nem para o ERP. A tela do pedido mostra quais campos faltam.
- **RN-VEN-14** Condição de pagamento: substituída pela RN-VEN-24 (forma de pagamento e prazos) e pela RN-VEN-25 (prazos da forma de pagamento). *(Decisão de 2026-11-06, R-20261106-064758.)*
- **RN-VEN-15 Unidade e embalagem** A tabela de preço tem o **preço da unidade** de cada produto. O preço da embalagem (CX, FD…) é **sempre** o preço da unidade × a quantidade da embalagem. Não existe preço de caixa digitado. O vendedor escolhe UN ou a embalagem em cada item. Múltiplo e estoque são conferidos em unidades. O pedido grava a medida, a quantidade da embalagem e a quantidade em unidades. *(Nova redação de 2026-11-06, R-20261106-064758: revoga o "preço próprio da embalagem na tabela" de 2026-11-02, R-20261102-093007 e R-20261102-111619.)*
- **RN-VEN-16 Frete** Modalidade obrigatória no pedido, padrão **CIF** (parâmetro do tenant `frete_modalidade_padrao`). *(Substitui a redação anterior; R-20261102-105040.)*
  - **CIF** = a empresa que vende paga o frete. O frete está incluso no preço: o pedido não tem valor de frete nem pede transportadora.
  - **FOB** = o cliente paga o frete. **Transportadora obrigatória**, preenchida pelo vendedor: escolhida da lista cadastrada no BKO ou, se não estiver na lista, digitada (nome e CNPJ obrigatórios; telefone opcional). A transportadora digitada fica só no pedido; o BKO vê a lista das digitadas para cadastrar. O valor do frete não entra no pedido (o cliente paga direto à transportadora).
  - O frete nunca entra no desconto efetivo (RN-VEN-03) nem no realizado da meta (RN-CORE-21).
  - "Enviar pedido" fica bloqueado com FOB sem transportadora; a pendência aparece no Resumo: "Transportadora do frete FOB — aba Entrega" (RN-CORE-36). *(Nova redação: Alexandre, 08/11/2026.)*
- **RN-VEN-17** Endereço de entrega: padrão = endereço principal do cliente. O vendedor escolhe entre os endereços de entrega do cliente vindos do ERP **ou edita o endereço só para aquele pedido**. A edição **não muda o cadastro do cliente** (endereço novo no cadastro continua entrando pelo ERP). O endereço do pedido é um retrato: vai gravado no pedido e aparece no detalhe (Campo, Gestão e BKO), nos dois PDFs e na devolução ao ERP. *(Alexandre, R-20261109-054659, 09/11/2026; substitui "não digita endereço novo"; T-0141.)*
- **RN-VEN-18 Orçamento** O vendedor pode salvar o pedido como orçamento: **não expira e não some** (Alexandre, R-20261109-064818, 09/11/2026; substitui a validade de 7 dias), não reserva estoque, não passa pela alçada, não vai ao ERP e não conta na meta nem no ranking. "Transformar em pedido" segue o fluxo de "Enviar pedido" (ver preço congelado abaixo). Cliente com cadastro incompleto ou bloqueado (RN-VEN-13) só pode salvar como orçamento. Desconto ou acréscimo em R$ no item é **por unidade**; no pedido, é sobre o total dos itens; a tela mostra sempre o equivalente (% ↔ R$). O pedido gerado por "Transformar" conta na meta pela data de emissão dele (RN-CORE-21), nunca pela data do orçamento. *(Alexandre, R-20261103-123656, R-20261103-130003 e R-20261103-140707; referência visual em `docs/produto/referencias/R-20261103-130003-alexandre-novo-pedido.png` e `.html`, versão enxuta.)*
  - **Preço congelado** O orçamento **congela os preços** dos itens no momento em que é salvo. Editar o orçamento nunca reprecifica os itens já salvos; só o item **novo** incluído na edição entra pelo preço de hoje. Enquanto o **preço do orçamento** vale, "Transformar em pedido" mantém os preços do orçamento e reconfere só **estoque** e **preço mínimo** (RN-VEN-11). Se algum item ficar abaixo do mínimo, avisa qual item, sem trocar o preço sozinho. *(Alexandre, 08/11/2026: "se eu salvei o orçamento é porque eu quero os preços congelados nele"; T-0134.)*
  - **Pedido corrigido ou editado não reprecifica** (Alexandre, 10/11/2026, R-20261110-062238; T-0151): o pedido corrigido depois de uma recusa ou editado mantém os preços salvos, e só o item novo entra pelo preço do dia. Sai a faixa "Preços atualizados pela tabela de hoje do cliente". *Premissa do gerente:* o Transformar de orçamento com preço de mais de 7 dias continua com a folha "Preços de hoje", que só aparece quando o total muda (premissa (c), aprovada em R-20261109-202159).
  - **Preço do orçamento (antes "Validade")** O preço congelado vale `validade_orcamento_dias` [7] dias corridos a partir do salvamento, inclusive, até 23:59 no fuso do tenant (salvo em 09/11 com 7 dias → preço vale até 16/11, 23:59 de Manaus). Depois disso o orçamento **continua aberto** (não vence, não fica só para duplicar): "Transformar em pedido" **reprecifica pela tabela do dia** e mostra ao vendedor a diferença por item e no total antes de enviar. **Editar** o orçamento depois desse prazo também reprecifica pela tabela do dia e **renova a data do preço** para o dia da edição; editar dentro do prazo não muda a data do preço (gerente, 09/11, T-0141). A data do preço aparece na etapa "Salvo" do Histórico, nunca como "até 16/11"; o selo "preço de 09/11" saiu da tela do orçamento (premissa (a) da RN-VEN-42, Alexandre, 10/11/2026). Na lista e no PDF, ela continua como "preço de 09/11". Uma função única no domain, a mesma no app, no BKO, no PDF e na API. *(Alexandre, R-20261109-064818, 09/11/2026; T-0141. Substitui a validade da T-0135.)*
- **RN-VEN-19 Aplicação no orçamento e no pedido** Em cada item do Novo pedido, quando o produto tem aplicação, a opção **"Incluir aplicação no orçamento"** vem marcada conforme o parâmetro [`aplicacao_no_orcamento_padrao` = sim] e o vendedor pode desmarcar item a item. O item grava o texto **no momento do pedido** (retrato, como o cliente do pedido), limitado a [`aplicacao_max_orcamento` = 300] caracteres e cortado na última palavra inteira com "…". O texto sai no PDF do cliente e no do BKO, no detalhe do pedido (Campo, Gestão e BKO) e no pedido enviado ao ERP. O parâmetro aceita até 1.000. Na lista de produtos, a aplicação aparece em 2 linhas, com o trecho da busca destacado. *(Decisão do Alexandre, R-20261105-110150; caixa por item, R-20261105-191229; T-0084.)*
- **RN-VEN-20** Disponível = saldo do ERP − reservas, **na filial do pedido** (RN-CORE-39); reserva quando a API aceita o pedido; libera em cancelamento, rejeição ou faturamento. Insuficiente → [permitir com aviso | bloquear | cortar]. **No app (Alexandre, 10/11/2026, R-20261110-093124):** o produto sem estoque pode ser adicionado, aparece nos Alertas (RN-VEN-42), e o pedido **só sai como orçamento**, como no desconto acima do máximo (RN-VEN-11).
  **Quais depósitos valem (gerente, 11/11/2026, divergência do corretor R-20261111-064959):** a regra é uma só, no `domain` do Catálogo, exposta pelo contrato e usada pela API e pelo app:
  - **Tenant sem nenhum depósito ligado a filial** (legado): soma todos os depósitos, como antes.
  - **Tenant com depósito ligado a filial:** só os depósitos da filial do pedido.
    - Se a filial não tem depósito, o disponível é 0.
    - Produto que tem saldo só em depósito de outra filial também fica com disponível 0 nesta filial.
  - **Produto sem nenhuma linha de saldo no tenant:** não tem controle de estoque e não bloqueia.
  - **Pedido sem filial:** comportamento anterior.
  - **Depósito sem filial (0056):** o banco não aceita depósito sem filial. Quando ele chega vazio, um gatilho grava a filial padrão. Não existe tenant com depósitos mistos.
- **RN-VEN-21** Quantidade múltipla do múltiplo de venda; item repetido soma quantidade.
- **RN-VEN-22** Pedido mínimo [desativado].
- **RN-VEN-23 Tabela de preço escalonada** O preço diferenciado por quantidade fica numa **tabela escalonada**. Cada linha tem: produto; embalagem (UN ou a embalagem do produto); **quantidade mínima**; **preço por unidade de medida** a partir dessa quantidade; vigência; e, opcionalmente, a tabela de preço ou o grupo de clientes a que se aplica.
  - **No pedido:** ao atingir a quantidade, o app aplica a faixa sozinho, e desfaz se a quantidade cair.
  - **Sugestão de venda:** a próxima faixa aparece na aba **Detalhes**, no card "Leve mais e pague menos" ("leve 10 FD por R$ 19,90/FD"), e não no item.
  - **Desconto:** o desconto do vendedor incide sobre o preço da faixa.
  - **Alçada:** o preço da faixa conta como preço de tabela e não entra na alçada.
  - **Preço mínimo:** o do produto (RN-VEN-11) continua valendo.
  *(Decisão de 2026-11-06, R-20261106-064758.)*
- **RN-VEN-24 Forma de pagamento e prazos** Cada **forma de pagamento** (ex.: Pix, Dinheiro, Cartão, Boleto) tem a lista de **prazos** permitidos.
  - **Prazo:** tem as parcelas (ex.: 28/56) e o seu **prazo médio** em dias, que é a média das parcelas (28/56 = 42; à vista = 0).
  - **No pedido:** o vendedor escolhe **primeiro a forma** e depois o prazo, entre os daquela forma.
  - **Lista de prazos:** mostra só o prazo ("28/56 dias"), sem o número do prazo médio. *(Ajuste de 2026-11-06, 6h59.)*
  *(Decisão de 2026-11-06, R-20261106-064758.)*
- **RN-VEN-25 Prazos da forma de pagamento** O cadastro do cliente tem as **formas de pagamento permitidas**. No pedido, **todos os prazos da forma escolhida ficam disponíveis**; não há trava nem aviso de prazo médio. Substitui a RN-VEN-14. *(Decisão de 2026-11-06, R-20261106-064758; prazo médio retirado do pedido em 2026-11-18, R-20261118-224720.)*
- **RN-VEN-30** Status: `rascunho` → `na_fila` → `recebido` → `em_aprovacao` → `aprovado` | `rejeitado` → `integrado_erp` → `faturado` (parcial/total); `cancelado` antes de `integrado_erp`. Na aprovação, há uma por motivo e elas correm em paralelo; o pedido sai quando todas estão aprovadas. **Rejeitar** leva a `cancelado` (final); **Devolver ao vendedor** leva a `rejeitado`, e o vendedor corrige e reenvia. Uma rejeição ou devolução encerra as aprovações pendentes (T-0184, P3 B, P6 A, P7 A e P8 A). Cada transição gera evento com autor, data/hora e motivo. O orçamento (RN-VEN-18) não é um status: é o `tipo = orcamento` do mesmo registro, com ciclo próprio (aberto → convertido ou cancelado; **não vence**, RN-VEN-18), e o pedido gerado por "Transformar" é um registro novo ligado ao orçamento (docs/desenho/T-0071.md §1.2). **Ao salvar**, o pedido passa a `na_fila` no aparelho e a tela do pedido fecha na hora; o envio é feito pela fila em segundo plano (RF-VEN-04, RN-CORE-23). Enquanto estiver `na_fila`, o pedido fica somente leitura no app. *(Alexandre, 08/11/2026.)* **Histórico em tags:** no app e no BKO, o histórico mostra só **tags de status**, com data e hora curtas, sem frase. Pedido: **Salvo** (`rascunho`) · **Na fila** (`na_fila`, sem sinal) · **Enviado** (`recebido`) · **Em aprovação** · **Aprovado** · **Rejeitado** (+ motivo em 1 linha) · **Recebido no ERP** (`integrado_erp`) · **Faturado parcial** · **Faturado** · **Cancelado** (+ motivo em 1 linha). Orçamento: **Salvo** · **Transformado em pedido nº** · **Cancelado** (sem "Vencido" desde 09/11, RN-VEN-18). O autor só aparece quando não é o vendedor do pedido (ex.: gestor). Nunca mostrar texto técnico ("Recebido pelo servidor"). *(Alexandre, 08/11/2026 tarde; T-0138.)*
- **RN-VEN-31** Editar/cancelar só antes de `integrado_erp`; editar pedido aprovado volta para revalidação. "Excluir" pedido enviado = cancelar com motivo; só rascunho é apagado. **Exceção (T-0114, decisão do dono do produto de 07/11/2026):** se o conector do tenant estiver configurado para aceitar cancelamento, o pedido já integrado pode ser cancelado no Macuxi, com motivo. O cancelamento é devolvido ao ERP pelo Hub (`vendedor.pedido.cancelado@1`), e o status final vem da confirmação do ERP. Sem essa configuração, vale a regra acima: depois de integrado, só se cancela no ERP.
- **RN-VEN-32** Orçamento não reserva estoque, não consome crédito e **não expira** (o `validade_orcamento_dias` [7] limita só o preço congelado). A regra completa é a RN-VEN-18. *(Alexandre, R-20261109-064818, 09/11/2026.)*
- **RN-VEN-33** UUID do pedido gerado no aparelho; reenvio não duplica.
- **RN-VEN-34** Pedido pode ser para cliente diferente do check-in aberto ("fora de visita").
- **RN-VEN-35** Pedido em nome: `vendedor_id` = vendedor, `autor_id` = gestor; o vendedor recebe notificação, e a venda conta para ele (RN-CORE-21). **Pela ficha da vendedora:** o seletor de clientes mostra só a carteira dela; cliente de outra carteira aparece como "Cliente da carteira de <vendedor>" e não entra (o gestor transfere antes). **Pela ficha do cliente no Gestão:** o vendedor padrão é o da carteira do cliente, e o gestor pode trocar por **qualquer vendedor ativo da sua equipe** (o supervisor) ou das equipes abaixo (o gerente); a API recusa vendedor fora do escopo (RN-CORE-04). Ninguém aprova o próprio pedido: cada motivo de nível igual ou menor que o do autor sobe para o nível seguinte. *(07/11/2026, R-20261107-173950 a; T-0187, P3 A e P4 A, R-20261119-192029.)*
- **RN-VEN-36** Alerta de ruptura do promotor aparece para o vendedor responsável por [7] dias ou até o próximo pedido do cliente.
- **RN-VEN-37** Devolução = nota de devolução do ERP, pelo total; não muda o status do pedido nem estorna o desafio de vendas. *(Proposta da T-0054, aprovada pelo Alexandre em 2026-11-02, R-20261102-110941.)*
- **RN-VEN-38 Sair do pedido** Ao sair de um Novo pedido alterado, por qualquer caminho (Voltar, gesto do Android, barra inferior, Cancelar), o app pergunta: Salvar e enviar pedido · Apenas salvar · Salvar como orçamento · Descartar · Continuar editando (rótulos iguais aos botões do Resumo, RF-VEN-11; Apenas salvar grava `rascunho` e aceita pendências). Salvar com pendência volta ao Resumo com o bloco "Falta para salvar" (RN-CORE-36). Cliente da RN-VEN-13 (bloqueado, inativo, cadastro incompleto) vê só Apenas salvar, Salvar como orçamento e Descartar. O rascunho é gravado no aparelho a cada alteração; se o app for fechado pelo sistema, ao reabrir oferece continuar ou descartar. Nenhum pedido some sem escolha do vendedor. **Nenhuma saída perde o pedido**: qualquer caminho que deixe o Novo pedido sem passar pela pergunta (Voltar do Android a partir de uma tela aberta pelo pedido, troca de aba, app em segundo plano, fechamento pelo sistema) grava o pedido como **rascunho** (RN-VEN-39). Só "Descartar" apaga. *(Alexandre, 08/11/2026; T-0128. Reforço de 09/11, R-20261109-064818: pedido perdido pelo Catálogo → Voltar; T-0141.)*
- **RN-VEN-39 Rascunhos** Pedido que o vendedor deixa sem enviar e sem salvar como orçamento (Apenas salvar ou qualquer saída da RN-VEN-38) vira **rascunho**, no aparelho. A lista **Rascunhos** (entrada definida pelo designer-ux) mostra cliente, total e a hora da última alteração (o nº de itens saiu com a RD-0214, R-20261113-124656); tocar retoma o pedido de onde parou. O rascunho **some 24 h depois da última alteração**, a não ser que vire orçamento ou pedido. *(Alexandre, R-20261109-064818, 09/11/2026; T-0141. Premissa do gerente: o "Apenas salvar" do Resumo grava o mesmo rascunho e segue a mesma regra de 24 h.)*
- **RN-VEN-40 Motivo da recusa** Quando o servidor recusa um pedido ou orçamento, a tela mostra o **motivo em português que o servidor devolveu**, em uma frase que diga ao vendedor o que corrigir, sem código técnico. O texto genérico ("fale com seu supervisor") só aparece quando o servidor não devolveu motivo. *(Alexandre, R-20261109-064818, 09/11/2026; T-0141.)*
- **RN-VEN-41 Nome do PDF** `ORC-XXXX-DDMMAAAA.pdf` (orçamento) e `PED-XXXX-DDMMAAAA.pdf` (pedido): XXXX = número gerado pelo sistema com no mínimo 4 dígitos (`0001`; acima de 9999, todos os dígitos, sem cortar); DDMMAAAA = data de emissão no fuso do tenant. O mesmo documento sempre sai com o mesmo nome. Ainda sem número (salvo no aparelho, antes de o servidor receber): `ORC-PROV-DDMMAAAA.pdf` / `PED-PROV-DDMMAAAA.pdf`; nunca inventar número no aparelho. *(Alexandre, R-20261109-064818, 09/11/2026; T-0141.)*
- **RN-VEN-42 Área "Alertas"** (Alexandre, 10/11/2026, R-20261110-093124; T-0150 e T-0148).
  - **Onde:** no Novo pedido e no pedido ou orçamento já feito, uma área única "Alertas" no topo, no lugar onde ficava o selo de situação.
  - **O que reúne:** todos os avisos que pedem atenção ou correção:
    - desconto acima do máximo do produto (RN-VEN-11);
    - informação faltante (o antigo "Falta para salvar", RN-CORE-36);
    - recusa do servidor;
    - **sem estoque** (RN-VEN-20);
    - crédito e título vencido (RN-VEN-12 e RN-VEN-13).
  - **Forma:** cada alerta numa linha curta, só o problema e o item (ex.: "AGU-1500 acima do desconto máximo"). Sem alerta, a área não aparece.
  - **Nada fora dela:** nenhum aviso solto no topo nem embaixo da tela.
  - **Menos alertas (v1.0.5, T-0166, R-20261112-031457):**
    - Alerta só para o que **bloqueia ou muda o resultado**: envio, preço, alçada, crédito, estoque e cadastro obrigatório.
    - Falta de preenchimento só entra em Alertas quando o vendedor tenta avançar, salvar ou enviar (RN-CORE-36). Antes disso, aparece no próprio campo.
    - Exceção aprovada: o "Risco de ruptura" na folha do item (T-0165).
    - O inventário completo está em `docs/qualidade/redundancias/2026-11-12-T-0166-alertas.md`.
  - **Só nas telas, nunca no PDF** (Alexandre, 11/11/2026, R-20261111-085235): os Alertas não vão a nenhuma das 4 versões do PDF (pedido e orçamento, cliente e escritório). Isso substitui os "Alertas da gaveta do BKO no PDF do escritório" da v1.0.3.
  - **Situação só no Histórico:** na tela do pedido ou orçamento aberto, a situação aparece só no Histórico, e a última etapa é a situação atual; sai o selo de cima. Na **lista de Pedidos**, o selo de cada linha continua, porque ali é a única forma de ver a situação de vários pedidos.
  - **Uma informação, um lugar:** se uma seção da tela já mostra uma informação, ela não aparece em outro lugar da mesma tela. Exemplos: o Histórico mostra a situação, os Totais mostram o %, os Alertas mostram o problema. Regra permanente do corretor, para todas as telas (doc 07).
  - **Premissas aprovadas com as imagens v2** (Alexandre, R-20261110-114411; spec em `docs/design/pedido-v4.md` §0.1):
    - (a) sai o selo "Preço de dd/mm" do orçamento: a etapa "Salvo" do Histórico mostra a data do preço;
    - (b) dentro do pedido, sai a bolinha das abas: cada linha dos Alertas diz em que aba corrigir;
    - (c) orçamento com alerta não mostra "Transformar"; a ação principal é Editar;
    - (d) os Alertas aparecem em todas as abas do Novo pedido, e o Histórico aparece sempre;
    - (e) com alerta que bloqueia o envio, ficam "Salvar como orçamento" e "Apenas salvar"; "Salvar e enviar" sai.
- **RN-VEN-43 Tabela ajustada pelo prazo** O "Desc./Acrésc. (%)" do prazo de pagamento (−99,99 a +99,99, 2 casas; negativo = desconto) muda o valor de tabela de cada produto.
  - **Conta:** `ajustada = meia-para-cima(tabela × (10 000 + bp) ÷ 10 000)`, com `bp` = o % em centésimos de ponto, inteiro (−1,71 → −171). Em centavos, por unidade base, antes da quantidade e do fator da embalagem. A faixa da tabela escalonada (RN-VEN-23) vale antes do %. Sem % (ou 0), a tabela fica como está.
  - **Onde vale:** nos itens do pedido e do orçamento, e no preço do Catálogo aberto pela ficha do cliente, que sai no prazo padrão dele (a primeira forma aceita e o primeiro prazo ativo dela, RN-VEN-24/25). Sem cliente, ou com cliente sem prazo padrão, a tabela pura.
  - **Sobre a tabela ajustada:** desconto, alçada, preço mínimo (RN-VEN-11) e crédito. O ajuste do prazo não é desconto do vendedor e não conta na alçada, salvo o desconto refeito na troca de prazo (RN-VEN-44).
  - **Preço congelado do orçamento** (RN-VEN-18): já está gravado ajustado e nunca ajusta de novo; na troca de prazo vale a RN-VEN-44.
  - **O % não aparece:** nem nos totais, nem na lista de prazos (RN-VEN-24), nem no PDF. Ao ERP, os preços vão já ajustados.
  *(Alexandre, R-20261115-111000 e R-20261115-121000; proposta aprovada em R-20261115-123000, `docs/modulos/vendedor/prazo-desconto-acrescimo.md` no SHA 454ee68, §1 a §4; v1.0.14, migração 0082.)*
- **RN-VEN-44 Troca de prazo** O item guarda o **preço final** em centavos. Trocar o prazo no pedido ou no orçamento com itens mantém esse preço final; mudam a tabela e o desconto:
  - **Tabela:** a tabela original do produto ajustada pelo % do prazo novo (RN-VEN-43). Trocar o prazo e voltar devolve a mesma tabela.
  - **Desconto ou acréscimo do vendedor:** é recalculado a partir do preço final e da tabela nova. Se a tabela sobe, o desconto aumenta; se cai, diminui ou vira acréscimo. Esse desconto conta na alçada (RN-VEN-10), no preço mínimo (RN-VEN-11) e nos Alertas (RN-VEN-42).
  *(Alexandre, R-20261120-051003-gerente-projetos e R-20261120-055501-alexandre, 20/11/2026. Implementação: T-0188.)*
- **RN-VEN-45 Percentual congelado no pedido** O pedido e o orçamento guardam o % do prazo do momento da escolha (retrato `pedido.prazo_percentual_ajuste`), e o total não muda com o pull seguinte. Sem prazo (condição legada, RN-VEN-14), o retrato fica vazio.
  - **A API revalida** no envio e recalcula os preços pelo % do pedido:
    - igual ao vigente: aceita;
    - diferente, e o cadastro do prazo mudou depois da criação do pedido: aceita o % do pedido e grava um aviso na linha do tempo. Esse % fica fora da alçada (R-20261115-124833);
    - diferente, sem mudança posterior no cadastro: recusa com o código `RN-VEN-45` e "Este prazo de pagamento mudou. Atualize o app e refaça o pedido." (RN-VEN-40).
  *(Mesma origem da RN-VEN-43, proposta §5. A trava de R-20261118-210200-alexandre caiu em R-20261119-184441-alexandre.)*
- **RN-VEN-46 % do prazo vem do ERP** O % de cada prazo ("% Acres.Fin." no ERP) chega pela Integração; ausente = 0. No BKO, a tabela e o CSV de prazos mostram a coluna "Desc./Acrésc. (%)", com sinal, vírgula e 2 casas, **só para leitura**: salvar o prazo no BKO não muda o %. O prazo criado no BKO entra com 0,00. *(Mesma origem da RN-VEN-43, proposta §7; R-20261115-121500 e R-20261115-122000.)*
- **RN-VEN-47 Cards de Pedidos** No topo da tela Pedidos, no Campo e no Gestão, três cards resumem o período da tela pela **data de emissão** no fuso do tenant (o orçamento, pela data em que foi salvo):
  - **Orçamentos:** os orçamentos em aberto, não convertidos e não cancelados (RN-VEN-18);
  - **Pedidos:** os enviados (RN-VEN-30): recebido, em aprovação, aprovado, enviado ao ERP, integrado, faturado parcial e faturado;
  - **Total:** a soma dos dois.
  - Cada card mostra quantidade e valor (total do documento, RN-VEN-02; no faturado parcial, o valor do pedido). Sem resposta do servidor, traço.
  - Busca e chip de situação filtram só a lista. Pedido emitido num período e faturado em outro entra só nos cards do período da emissão (D5).
  - Tocar em Orçamentos ou Pedidos filtra a lista; Total não navega. Sem documento no período e sem busca, os cards não aparecem.
  - No Gestão, os cards somam a equipe ou o vendedor escolhido no filtro (D6).
  *(T-0170, desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §4, D5 e D6 aprovadas. O desenho a numerou como RN-VEN-43; o número passou a RN-VEN-47 porque a RN-VEN-43 é a da tabela ajustada pelo prazo, R-20261117-201110, ponto 3.)*
- **Cancelamento depois do envio ao ERP**: a partir do status 'enviado', o pedido não pode ser cancelado no Macuxi (UI e API respondem 422 com o código da regra e a mensagem "Pedido já enviado ao ERP — cancele no ERP"); o cancelamento é feito no ERP e chega pelo retorno do Hub como status 'cancelado'.

## 5. Promotor (trade marketing)
- **RN-PRO-01** Promotor nunca cria, edita, cancela, duplica ou exclui pedido — regra aplicada na UI **e** na API (403).
- **RN-PRO-02** Coletas (fotos, gôndola, share, preço, ruptura, validade) só com check-in aberto na loja; fotos tiradas na hora pela câmera do app [galeria bloqueada], com data/hora. A coordenada é registrada quando disponível; sem sinal de GPS a foto é aceita com `sem_gps = true`. A prova de presença é o check-in da visita. O gestor vê o % de fotos sem GPS por promotor.
- **RN-PRO-03** Share (%) = frentes nossas ÷ frentes totais da categoria × 100 (ou cm nossos ÷ cm totais, quando medido em centímetros). Atingimento = share ÷ meta de share da loja/categoria.
- **RN-PRO-04** Índice de preço = preço nosso ÷ preço do concorrente de referência × 100. Preço que varia mais de [50%] em relação à última coleta pede confirmação (evita erro de digitação).
- **RN-PRO-05** Ruptura (%) = itens do mix obrigatório em ruptura (ruptura total + ruptura na gôndola com produto no depósito) ÷ itens do mix obrigatório × 100. A ruptura na gôndola com produto no depósito também é mostrada à parte (falha de reposição). *(Confirmado pelo Alexandre em 2026-11-02, R-20261102-204330: a falha de reposição entra no ruptura_pct e é contada à parte.)*
- **RN-PRO-06** Checkout da visita exige as etapas obrigatórias do checklist da loja, exceto cliente fechado (`loja_fechada` ou `acesso_negado`, com foto da fachada — RN-CORE-14).
- **RN-PRO-07** Visita só conta nos indicadores com permanência mínima de [10 min]; abaixo disso é sinalizada ao gestor.
- **RN-PRO-08** Validade: vencido (dias < 0) · crítico ≤ [7] dias · atenção ≤ [30] dias · ok. Validade próxima = vencido + crítico + atenção. *(Faixas confirmadas pelo Alexandre em 2026-11-02, R-20261102-204330.)*
- **RN-PRO-09** Alerta de ruptura vai ao vendedor responsável pelo cliente; se houver mais de um, ao da [linha do produto] ou ao primeiro da carteira.
- **RN-PRO-10** Checklist, mix obrigatório e metas de share valem por vigência; a coleta guarda a versão vigente no momento.
- **RN-PRO-11** Conformidade da gôndola (%) = (conformes + parciais × [peso do parcial]) ÷ gôndolas registradas × 100; peso padrão [0] (confirmado pelo Alexandre em 2026-11-02, R-20261102-204330: item parcial vale 0, parametrizável por tenant). Motivo obrigatório quando não conforme; o total de parciais aparece à parte.
- **RN-PRO-12** Cadastro de trade em uso não se desativa no BKO: categoria com meta de share, mix ou produto de concorrente vivos, recebem 422 `CADASTRO_EM_USO` com as contagens (só do próprio tenant); desative antes os dependentes. Toda alteração de cadastro de trade grava auditoria (T-0069). **(07/11/2026, T-0113)** As marcas concorrentes deixaram de ser cadastro do Promotor: ficam no Catálogo (RN-CAT-13), e o Promotor só cadastra os produtos do concorrente, validando a marca pela lista do Catálogo.

## 6. Pesquisa
> Decisões do Alexandre em 2026-10-31 (R-20261031-125833), a partir das premissas da T-0012. As demais premissas de `docs/modulos/pesquisa/regras.md` ficam aceitas.
- **RN-PES-01** Pesquisa publicada é imutável; mudanças geram nova versão; respostas guardam a versão. Resultado consolidado entre versões só para perguntas com o mesmo identificador estável; as demais aparecem por versão.
- **RN-PES-02** Frequência conta **por cliente** (não por cliente + usuário), em períodos civis (semana ou mês) no fuso do tenant.
- **RN-PES-03** Pesquisa obrigatória no checkout bloqueia o checkout até ser respondida, exceto cliente fechado (RN-CORE-14).
- **RN-PES-04** Resposta offline guarda a hora do aparelho e o servidor grava `recebido_em`. Relógio do aparelho adiantado mais de [24 h] ou resposta fora da vigência: **aceita e sinalizada** (flag de suspeita visível no resultado), nunca recusada.
- **RN-PES-05** Regras condicionais: "mostrar" combina com OU; "ocultar" vence. Público-alvo: a lista de clientes soma (OU) aos segmentos. O **canal** do cliente (campo do Core, vindo do ERP com de-para no Hub; T-0115, decisão do dono do produto R-20261107-173950 d) entra no público-alvo como mais um critério, combinado do mesmo jeito (OU com a lista de clientes e os segmentos).
- **RN-PES-06** Código de barras com dígito GS1 inválido: aviso, não bloqueio. Foto: no máximo [1600 px] no maior lado, JPEG qualidade [80] (mesma regra do Promotor).
- **RN-PES-07** Limites do construtor (parâmetros do tenant): [50] perguntas, [20] opções por pergunta, [10] fotos, [2000] caracteres por resposta de texto.

## 7. Treinamento
> Decisões do Alexandre em 2026-10-31 (R-20261031-103502), a partir das premissas da T-0011. Valores entre colchetes são parâmetros do tenant.
- **RN-TRE-01** XP: lição concluída [10]; acerto no quiz [5 por questão]; trilha concluída [50]; streak diário [2 × dias, até 20]. Teto diário de [200] XP somando lição, quiz, trilha e streak; com o teto estourado, grava lançamento de 0. XP é append-only e idempotente.
- **RN-TRE-02** Quiz: nota mínima [70%] para concluir; até [3] tentativas por dia no fuso do tenant; XP de acerto só na 1ª tentativa, mesmo reprovada. Refazer quiz aprovado é permitido, sem XP; vale a melhor nota (configurável); intervalo entre tentativas [0] (desligado).
- **RN-TRE-03** Ranking por XP no período; desempate: XP → quem atingiu primeiro → trilhas concluídas → nome → id. Ranking visível apenas dentro do mesmo tenant; padrão só vendedor e promotor (configurável). Semana do ranking: segunda a domingo no fuso do tenant.
- **RN-TRE-04** Progresso feito offline sincroniza e é validado no servidor. Tempo mínimo da lição para contar = o maior entre [30 s] e [50%] da duração estimada (quando informada).
- **RN-TRE-05** Streak: o dia conta com lição concluída ou quiz respondido até o fim (abrir e abandonar não conta); paga 1 vez por dia.
- **RN-TRE-06** Níveis: faixas [0/100/250/450/700/1000/1400/1900/2500/3200] XP. Medalhas padrão: primeira trilha, nota 100, 7 dias seguidos.
- **RN-TRE-07** Público-alvo: perfis e equipes; com os dois preenchidos vale a interseção, com um só vale esse, vazio = tenant todo.
- **RN-TRE-08** Desafio de vendas: paga XP quando o pedido é **faturado** (evento `vendedor.pedido.faturado@1`), não quando é criado; idempotente pelo `evento_id` do envelope (faturamento parcial soma os itens de cada retorno; um segundo faturamento total do mesmo pedido não paga); faturamento parcial sem itens é ignorado; fora do teto diário, com teto próprio [`xp_max_por_desafio`] e `xp_max_por_pedido` acumulado entre eventos. Sem estorno nesta fase. O XP de um mesmo vendedor é processado um de cada vez (tenant + usuário).

## 8. Catálogo
> Decisões do Alexandre em 2026-10-31 (R-20261031-172619), aplicadas no módulo pela T-0021 (texto de `docs/modulos/catalogo/regras.md` §9).
- **RN-CAT-01** Busca inteligente só responde com produtos do tenant e respeita o escopo (preço da tabela do cliente em contexto).
- **RN-CAT-02** "Pergunte ao catálogo" responde só com conteúdo cadastrado e cita a fonte; sem base → informa que não encontrou.
- **RN-CAT-03** Limite de consultas de IA por usuário/dia [200] para controle de custo; só consulta respondida pelo provedor conta. Falha do provedor (erro ou tempo esgotado), resposta do cache, busca offline e busca simples não consomem. O dia vira no fuso do tenant.
- **RN-CAT-04** Consulta do catálogo (busca, ficha, fotos, "pergunte ao catálogo") para todos os perfis; conteúdo, sinônimos, destaques e termos sem resultado só analista e admin.
- **RN-CAT-05** (revista em 15/11/2026, R-20261115-090000, R-20261115-100000 e R-20261115-104500; v1.0.13) O estoque é visível a todos os perfis, **só das filiais de venda do usuário** (`filial_venda_ids`, RN-CORE-39): o "Estoque: N" do cartão, da busca e da ficha soma as filiais de venda (com uma filial no filtro, só ela; com cliente, a filial do cliente), e a folha "Estoque por filial" lista só as filiais de venda, a de cadastro primeiro. Usuário sem filial não vê preço nem estoque. O promotor vê a ficha, as fotos e o estoque, mas não vê preço de tabela nem filtra/ordena por preço [`promotor_ve_preco_estoque` = não]; com o parâmetro ligado, vê o preço como o vendedor.
- **RN-CAT-06** Item fora da tabela de preço do cliente em contexto, **na filial do cliente** (RN-CORE-39), aparece como "Sem preço para este cliente" e não é vendável; nunca cai na tabela padrão do tenant.
- **RN-CAT-07** Estoque: "baixo" de 1 até [10] unidades, número exato visível [sim], "desatualizado" depois de [24 h] sem atualização; a tela sempre mostra "atualizado às hh:mm" (fuso do tenant).
- **RN-CAT-08** Ranking da busca: pesos [semântico 0,4; estoque 0,10; mais vendido 0,10; campanha 0,05] e cache [10 min, a partir da 2ª repetição] são parâmetros do tenant; serão calibrados no critério de aceite da Sprint 3.
- **RN-CAT-09 Referência cruzada** Cada produto tem **até 3** referências cruzadas, cada uma com **código** (até 30 caracteres) e, se houver, a **marca concorrente** (RN-CAT-13). O **analista** preenche no BKO; o ERP também pode mandar. A busca (app e BKO, offline) acha o produto pelo código do concorrente, ignorando espaços, hífens, pontos e maiúsculas ("cb3401" acha "CB 3401"), e mostra "Equivale a: <marca> <código>" com o trecho destacado; referência **sem marca** mostra só o código; referência com marca **inativa ou que não existe** não aparece (ficha, cartão, busca e exportação). O **oferece junto** tem até 5 produtos. *(Decisão do Alexandre, R-20261105-112117 e R-20261105-191229; marca opcional em R-20261115-073000; T-0085.)*
- **RN-CAT-10 O que sai para o cliente** Aplicação no orçamento e no PDF do cliente segue a RN-VEN-19. A referência cruzada **não** sai no PDF do cliente por padrão [`referencia_no_orcamento` = não]; sai no catálogo, no app e no PDF interno. *(Decisão do Alexandre, R-20261105-112117 e R-20261105-191229; T-0085.)*
- **RN-CAT-11 Aplicação do produto** O produto tem o campo **Aplicação** (descrição 2), texto livre de até [`aplicacao_max_cadastro` = 2.000] caracteres, vindo do ERP ou editado no BKO. Texto maior chega cortado nesse limite, e o monitor de integração mostra um aviso. A aplicação entra na busca de produtos (app e BKO, offline) e aparece na ficha do produto. *(Decisão do Alexandre, R-20261105-110150, que a chamou de RN-CAT-08; o número 08 já era o ranking da busca, por isso ficou 11. T-0084.)*
- **RN-CAT-12 Busca pela aplicação** (complemento de R-20261105-191229; T-0084)
  - **Ano dentro de faixa:** uma função pura do domain (`expandirAplicacao`), a mesma no app e na API, faz "pastilha uno 2012" achar "Uno 1.0/1.4 2010–2014".
    - Faixas de 4 dígitos ("2010–2014", "2010-2014", "2010 a 2014", "2010/2014") geram também os anos do meio.
    - "2012>", "2012 em diante" e "a partir de 2012" vão até o ano atual + 1.
    - Faixa invertida ou com mais de 40 anos fica só como texto.
    - Nunca expande "1.0/1.4" nem "G5/G6".
    - Os outros formatos da BAP, o ano de 2 dígitos e o ano válido estão na RN-CAT-16 (v1.0.19).
  - **Campo próprio no índice:**
    - servidor: coluna `aplicacao` em `catalogo.produto_busca`, com peso C;
    - aparelho: coluna na FTS5, com peso 2;
    - ranking: `PESO_CAMPO.aplicacao` = [`peso_aplicacao` = 0,5] (atributos continuam 0,3); produto que casa pelo nome vem antes de produto que casa só pela aplicação.
  - **Trecho "Serve em":** quando a aplicação contribuiu para o acerto, o resultado mostra o segmento que casou, com até 90 caracteres, os termos marcados e "inclui 2012" quando o ano veio de faixa.
    - Vale o segmento com mais palavras da consulta casadas.
    - **Desempate** (v1.0.18), nesta ordem: o segmento com mais palavras casadas exatas (sem prefixo, erro de digitação nem ano por faixa) → o segmento mais curto → o primeiro da aplicação. Assim "amortecedor palio" mostra "Palio 1.0 2001" e não "Palio Weekend Adventure 1.8 2001–2010 / Siena".
  - **Sinônimos e busca online:** os sinônimos do tenant valem na aplicação (VW = Volkswagen, GM = Chevrolet). A busca em linguagem natural online mantém modelo, motor e ano no texto livre.
  - **Desempenho:** com 20 mil produtos com aplicação longa, a busca offline tem p95 < 300 ms na tela de medição. Tenant sem aplicação mantém resultados e tempos iguais aos de antes.

- **RN-CAT-15 Apelidos de montadora** (v1.0.19; R-20261120-214252 e R-20261120-230805, auditoria `docs/modulos/catalogo/auditoria-busca-modelo-bap.md` §2 item 1, etapa 1)
  - Uma lista padrão do domínio do Catálogo, igual para todo tenant, liga os apelidos de montadora: VW ↔ Volkswagen, GM ↔ Chevrolet ↔ Chevy, MB ↔ Mercedes ↔ Mercedes-Benz, e as outras da lista do módulo.
  - A lista padrão soma-se aos sinônimos do tenant (RN-CAT-12): vale nos dois sentidos, em todos os campos (inclusive a aplicação), na busca online, na do aparelho e no seletor do pedido. O sinônimo do tenant não apaga o apelido padrão.
  - Exemplo: "vw gol 2018" e "2018 gol vw" acham o "Amortecedor Gol G5 2014–2019" cadastrado como Volkswagen.
- **RN-CAT-16 Ano na aplicação: formatos da BAP** (v1.0.19; mesmas decisões, auditoria §5, etapa 1; complementa a RN-CAT-12)
  - Faixa fechada também com "até"/"ATE" ("2007 até 2011"), ">" entre dois anos ("1998>2009"), "→" ("2008→2012"), mês/ano ("06/2008–06/2012" vale de 2008 a 2012) e "../08" (até 2008; sem início escrito, a faixa começa 40 anos antes, no limite da RN-CAT-12, e nunca antes de 1950).
  - Faixa aberta também com "+" ("2015+"), até o ano atual + 1, como a "2012>".
  - Ano de 2 dígitos passa a valer dentro de faixa ou de mês/ano: até 35 é 20xx, acima de 35 é 19xx ("01/89 - 12/97" vale de 1989 a 1997; "(83-92)" de 1983 a 1992; "Civic 07–11" de 2007 a 2011).
  - Ano válido: de 1950 até o ano atual + 2. Número fora dessa faixa fica só como texto (2035 e 1938 deixam de ser ano).
  - Polegada não é ano: "13"", "16"" e afins ficam só como texto.
  - O "·" separa trechos da aplicação: o ano de um trecho ("Fit 2003>") não vale para o veículo de outro ("Civic 07–11").
- **RN-CAT-17 Busca sem resultado completo: lista vazia** (v1.0.19; R-20261120-194335, auditoria §4, etapa 2)
  - Com texto na busca, aparece só o produto que casa **todas** as palavras (ou grupos de sinônimos) em algum campo; o código exato (SKU, EAN, código ERP, referência) conta como casa-tudo.
  - Se ninguém casa tudo, a lista é vazia (total 0).
  - Vale igual na busca online, na do aparelho e no seletor do pedido. Exemplo: "xyzqwk amortecedor" → lista vazia.

## 9. Integração (Hub `/integracao/v1`)
> Registradas na T-0009 (2026-10-31) a partir das "Regras técnicas" do doc 06. Valores entre colchetes são parâmetros do tenant.
- **RN-CAT-13 Marcas concorrentes** O cadastro de marcas concorrentes é do **Catálogo** (BKO → Catálogo → Marcas), numa lista só por tenant, que funciona com ou sem o Promotor licenciado. O Promotor e a referência cruzada leem a lista por contrato (`catalogo.marcas@1`). Marca em uso não se apaga: inativa-se, e a referência com marca inativa deixa de aparecer (RN-CAT-09). A ação é `marca.gerenciar` (padrão de fábrica: analista e admin). *(Decisão do dono do produto, 07/11/2026, R-20261107-173950 b; ADR 0034, que substitui a 0027; T-0113.)*
- **RN-INT-01** Lote: uma entidade por lote, `modo` completo | delta, até [5.000] registros; o Hub responde 202 com o id do lote e processa de forma assíncrona. Envelope inválido (entidade desconhecida, lote vazio, acima do limite, versão de contrato não suportada) é recusado inteiro, sem processar linha.
- **RN-INT-02** Idempotência: a chave do registro é (tenant, entidade, `external_id`) + hash do conteúdo canônico. Reenvio com o mesmo hash não altera nada nem publica evento; hash diferente atualiza e publica `integracao.<entidade>.atualizado@1`. `external_id` repetido no mesmo lote: vale a **última** ocorrência e as anteriores ficam como aviso `duplicado_no_lote` (não é erro).
- **RN-INT-03** Erro por linha: linha inválida vai para `lote_linha_erro` com código, campo e motivo legível no BKO, sem o valor de dado pessoal; não trava o lote. Resultado do lote: `concluido` (sem erro), `concluido_com_erros` (parte das linhas com erro) ou `falhou` (todas as linhas com erro ou falha de processamento). Erros de referência ausente são reprocessáveis; erros de validação exigem reenvio corrigido.
- **RN-INT-04** Ordem de dependência da carga: vendedor → cliente → (rota, título, nota/histórico); produto → (preço, estoque). Linha que cita `external_id` de outra entidade ainda inexistente fica com erro `referencia_ausente` (reprocessável), nunca cria registro órfão.
- **RN-INT-05** Delta por cursor: o cursor é por (tenant, conector, entidade) e vale o maior par (`alterado_em`, `external_id`) das linhas aceitas; só avança quando o lote termina (`concluido` ou `concluido_com_erros`) e nunca retrocede (reenvio antigo é aceito sem voltar o cursor).
- **RN-INT-06** Carga completa: pode ocupar vários lotes da mesma sessão (parte n, último = sim); só ao concluir o último lote os registros da entidade ausentes da carga são inativados (`deleted_at`), nunca apagados. Sessão incompleta não inativa nada.
  - **Trava de inativação em massa** (confirmada pelo Alexandre em 2026-10-31): se uma carga for inativar mais de [30%] dos registros ativos de uma entidade, o lote fica parado aguardando confirmação no BKO. Parâmetro `limite_inativacao_pct`.
- **RN-INT-07** Reconciliação diária por entidade: compara contagem de registros ativos e soma de controle (centavos ou quantidades) informadas pelo ERP com as do Macuxi; divergência acima da tolerância [contagem 0; soma 0,5%] gera alerta no monitor.
- **RN-INT-08** Devolução de pedido ao ERP: só pedido `aprovado` entra na fila de pendentes; a entrega é idempotente pelo UUID do pedido. Retorno: `pendente` → `enviado` (Conector retirou) → `integrado` (nº ERP) | `rejeitado_erp` (motivo); `integrado` → `faturado_parcial` → `faturado_total`. `enviado` sem confirmação em [10 min] volta a `pendente`. Cancelamento feito no ERP volta pelo retorno como `enviado`/`integrado`/`faturado_*` → `cancelado`, com o motivo quando o ERP informar; o Macuxi nunca escreve cancelamento no ERP. Cada retorno publica `integracao.pedido.retorno_erp@1`. **Exceção (T-0114):** para os conectores com cancelamento habilitado, o Hub devolve ao ERP o cancelamento feito no Macuxi; para os demais, o Macuxi não escreve cancelamento no ERP.
- **RN-INT-14** Cliente recebido sem algum campo de `cliente_campos_obrigatorios` **não** é linha com erro: entra com o indicador `cadastro_incompleto` e a lista de campos faltantes, e aparece no monitor de integração do BKO como aviso. CNPJ/CPF com dígito verificador inválido é tratado como ausente (RN-CORE-16). *(Alexandre, 2026-11-02, R-20261102-092329.)*
- **RN-INT-09** Contrato `/integracao/v1`: dinheiro em centavos inteiros, datas ISO 8601 UTC, `external_id` obrigatório; campo novo opcional é compatível; mudança incompatível vira `/v2` com ADR e a versão anterior fica ativa por [6 meses].

> **Conector (decisões do Alexandre em 2026-10-31, T-0013)**: linhas inválidas vão ao Hub com o motivo, até [500] por entidade por lote (acima disso, só a contagem). Atualização na v1 = pacote assinado para baixar + aviso no monitor do Hub quando o Conector estiver abaixo da versão mínima ou recomendada (atualização automática na v2). Uma chave de API por Conector (não por tenant), rotacionável no BKO, escopo só `/integracao/v1`, guardada no Windows Credential Manager. Bancos: Oracle primeiro, Firebird depois, MySQL sob demanda.

> **Regras do Hub aprovadas pelo Alexandre em 2026-11-01 (R-20261101-014652; desenho em `docs/modulos/integracao/hub-api.md` §18)**
> - **Guarda monotônica (emenda à RN-INT-02/05)**: linha com `alterado_em` menor que o do registro atual é `obsoleta` (não troca o registro, não publica `atualizado@1`, conta no resumo e no monitor); empate com hash diferente é `atualizada`. Vale para reenvio antigo e reprocessamento.
> - **RN-INT-10 Credencial do Conector**: uma chave por Conector, escopo só `integracao.v1`, guardada só como hash, mostrada uma vez; rotação com convivência da anterior [24 h] (parâmetro; máx. 7 dias; no máximo duas chaves válidas); recusa genérica 401. **Gestão de chaves só pelo admin** (P-3).
> - **RN-INT-11 Política de versão**: abaixo da mínima, o Hub recusa os dados (426) e o Conector para; abaixo da recomendada, só avisa; o sinal de vida está sempre liberado; versão ausente ou sem política nunca bloqueia.
>   - **Emenda (Alexandre, 2026-11-01, R-20261101-203953)**: o Conector que **recebe pedidos** precisa de versão **≥ 1.2.1**. O 1.2.0 ainda reenvia os itens no fechamento sem nota nova (T-0048). O Hub aplica isso pela política de versão mínima, com 426 e a mensagem para atualizar (T-0032).
> - **RN-INT-12 Limites e idempotência do lote**: `Idempotency-Key` obrigatória em `POST /lotes` (mesma chave e conteúdo repete a resposta; conteúdo diferente = 409); corpo ≤ [8 MiB]; taxa por Conector.
> - **RN-INT-01 (emenda, P-1)**: lote só com linhas inválidas termina **"concluído com erros"** (não "falhou").
> - **RN-INT-03 (emenda)**: linhas inválidas do Conector contam em recebidas/com erro, não são reprocessáveis e valem até [500] por entidade e lote.
> - **RN-INT-06 (emendas, P-2 e P-3)**: "lote parado" = lote **aplicado**, com só as inativações aguardando confirmação (o cursor avança); a confirmação da inativação em massa é feita por **admin ou analista**, com auditoria, e expira em [7 dias]; linha inválida com `external_id` conta como recebida e **registro que veio como inválido nunca é inativado**; linha sem id impede a inativação; só ativos não vistos desde o início da sessão são candidatos.
> - **RN-INT-08 (emendas, P-4)**: confirmação tardia vale; `numero_erp` imutável; retorno de pedido com item faturado inválido é **aceito** (o status vale) **sem os itens inválidos**, com erro no monitor; itens faturados conferidos por sequência, produto e saldo; idempotência por pedido, status e nota.
> - **RN-INT-13 Topologia na v1 (P-6, P-7)**: um Conector por entidade por empresa; filial com ERP próprio vira outra empresa; o Hub recusa configuração conflitante. Um ERP de destino de pedidos por empresa (mais de um: backlog).
> - Premissas aprovadas: aplicação do lote pela outbox (ADR 0007); ADR nova para as rotas do Conector (prefixo `/integracao/v1`, chave por Conector) com o engenheiro; reprocessamento de lote no BKO.

## 10. Auditoria
- **RN-AUD-01** Ficam na auditoria: alterações de preço, limite, alçada, status de pedido, licenças de módulos, perfis, parâmetros e publicações de pesquisa/trilha (quem, quando, antes/depois).

## 11. Gestor
> Decisões do Alexandre em 2026-10-31 (R-20261031-165536), a partir das premissas da T-0014.
- **RN-GES-01** Alerta "cliente sem visita": frequência de visita do cliente + [50%] (semanal → 10 dias; quinzenal → 21; mensal → 45); [30] dias só para cliente sem frequência. O alerta dispara quando **passa** do limite (quinzenal: dia 21 não alerta, dia 22 alerta). Outros alertas: ritmo mínimo da meta [80%], aprovação parada além do prazo da RN-GES-03, [3] rupturas em [14] dias, [20%] de fotos sem GPS.
- **RN-GES-02** Cliente nunca visitado só gera alerta depois de **passar** da carência de [15] dias na carteira (dia 15 não alerta, dia 16 alerta).
- **RN-GES-03** Prazo da aprovação em **dias úteis** [1] (não em horas): pedido de sexta 17:00 vence segunda 17:00. Dias úteis pelo calendário de `packages/comum` (herdado da Fase M), com feriados nacionais e os feriados cadastrados pelo tenant, no fuso do tenant. O alerta de aprovação parada usa o mesmo prazo.
- **RN-GES-04** O gerente pode decidir item do nível do supervisor; fica na auditoria e o supervisor é avisado.
- **RN-GES-05** Cobertura de rota = visitas planejadas realizadas ÷ planejadas (máximo 100%); visitas fora da rota viram o indicador "visitas extras".
- **RN-GES-06** Dois números de venda: "vendido" (valor do pedido) e "faturado" (o que o ERP faturou); a diferença aparece como "a faturar".
- **RN-GES-07** Analista e admin veem os painéis do tenant em modo leitura no BKO.
- **RN-GES-08** Comentário obrigatório só na rejeição; aprovar continua em 1 toque.

## Parâmetros do tenant (padrões)
| Parâmetro | Padrão |
|---|---|
| Alçadas vendedor / supervisor / gerente | 5% / 10% / 15% |
| Crédito excedido | enviar para aprovação |
| Dias de atraso para restringir | 5 |
| Estoque insuficiente | permitir com aviso |
| Pedido mínimo | desativado |
| Campos obrigatórios do cadastro do cliente (`cliente_campos_obrigatorios`) | razão social, CNPJ/CPF, IE ou isento (PJ), logradouro, número, bairro, município, UF, CEP |
| Modalidade de frete padrão (`frete_modalidade_padrao`) | CIF |
| Validade do orçamento (`validade_orcamento_dias`) | 7 dias |
| Dias úteis da semana para a meta do dia (`dias_uteis_semana`; no código `metas.dias_uteis_semana`) | segunda a sábado |
| Frase padrão do recado do dia (`recado_do_dia_padrao`; no código `inicio.recado_do_dia_padrao`) | "Bom trabalho hoje!" |
| Curva ABC do cliente, por dimensão (`cliente.curva_abc.a_min_pct` / `cliente.curva_abc.c_abaixo_pct`; RN-CORE-49) | A com +20% ou mais · B da média até abaixo de +20% · C abaixo da média dos 3 meses |
| Minutos sem visita para "parado" na Equipe agora (`inicio.parado_min`) | 60 |
| Desconto máximo padrão do produto (`desconto_maximo_produto_pct`) | 15% |
| Raio de check-in | 200 m |
| Validade do orçamento | 7 dias |
| Alerta de ruptura ao vendedor | 7 dias |
| Permanência mínima na loja (promotor) | 10 min |
| Validade crítica (`validade_critica_dias`) | 7 dias |
| Janela de validade próxima (`validade_proxima_dias`) | 30 dias |
| Peso do parcial na conformidade de gôndola (`peso_parcial_conformidade`) | 0 |
| Tolerância de variação de preço | 50% |
| Fotos de trade só pela câmera | sim |
| Base de apuração de metas | deixou de ser parâmetro: é o **tipo da meta** (pedido \| faturamento) no cadastro da meta (RN-CORE-21) |
| Atualização automática do app e do BKO (`sync_auto_min`) | 30 min (mínimo 15) |
| Voltar ao primeiro plano dispara verificação após | 30 min |
| Retenção de dados de módulo desativado | 90 dias |
| Limite de consultas de IA | 200/usuário/dia |
| Registros por lote de integração | 5.000 |
| Tolerância da reconciliação (contagem / soma) | 0 / 0,5% |
| Reenvio de pedido ao ERP sem confirmação | 10 min |
| Teto diário de XP (`xp_teto_diario`) | 200 |
| Teto de XP por desafio de vendas (`xp_max_por_desafio`) | definido no desafio |
| Tempo mínimo da lição (`licao_tempo_min_s` / `licao_tempo_min_pct`) | 30 s / 50% da duração |
| Nota mínima do quiz / tentativas por dia | 70% / 3 |
| Intervalo entre tentativas de quiz | 0 (desligado) |
| Ranking padrão (perfis) | vendedor, promotor |
| Limite de inativação em massa na integração (`limite_inativacao_pct`) | 30% |
| Limites do construtor de pesquisa (perguntas / opções / fotos / caracteres) | 50 / 20 / 10 / 2000 |
| Tolerância do relógio do aparelho (pesquisa) | 24 h (acima disso, sinaliza) |
| Foto (maior lado / qualidade JPEG) | 1600 px / 80 |
| Promotor vê preço de tabela e estoque no catálogo (`promotor_ve_preco_estoque`) | não |
| Promotor vê os pedidos da carteira, só leitura (`promotor_ve_pedidos`, configuração do perfil Promotor) | sim |
| Estoque baixo até (`estoque_baixo_ate`) / mostrar quantidade (`estoque_mostrar_quantidade`) / desatualizado após (`estoque_defasado_horas`) | 10 / sim / 24 h |
| Cache da busca (`cache_ttl_s` / `cache_min_ocorrencias`) | 600 s / 2 |
| Ranking da busca (semântico / estoque / mais vendido / campanha) | 0,4 / 0,10 / 0,10 / 0,05 |
| Linhas inválidas enviadas pelo Conector por entidade e lote | 500 |
| Convivência da chave anterior do Conector na rotação | 24 h (máx. 7 dias) |
| Corpo máximo do lote do Hub | 8 MiB |
| Validade da confirmação de inativação em massa | 7 dias |
| Alertas do gestor: tolerância sobre a frequência (`pct_tolerancia_frequencia`) / sem frequência (`dias_sem_visita_padrao`) | 50% / 30 dias |
| Alertas do gestor: carência de cliente novo (`dias_carencia_cliente_novo`) / ritmo mínimo / rupturas / fotos sem GPS | 15 dias / 80% / 3 em 14 dias / 20% |
| Prazo da aprovação (`prazo_aprovacao_dias_uteis`) | 1 dia útil |
| Horário comercial (`horario_comercial`) | seg–sex 08:00–18:00, fuso do tenant, feriados nacionais + do tenant |
| Fuso horário | America/Manaus |
