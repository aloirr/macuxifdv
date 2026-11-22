# 01 — Visão, produtos e módulos

## Problema
Distribuidoras, atacados e indústrias com venda externa ainda tiram pedido em papel, WhatsApp ou planilha; o gestor não vê a equipe em tempo real; pedido chega com preço, desconto, crédito ou estoque errados; promotores trabalham sem dado do cliente; treinamento é PDF esquecido no e-mail. As soluções grandes são caras, monolíticas e lentas para implantar.

## Proposta de valor
**Contrate só os módulos que usa, ligue o ERP em dias e trabalhe sem internet.**

## Produtos (o que o cliente recebe)
| Produto | Plataforma | Perfis | Para quê |
|---|---|---|---|
| **Macuxi Campo** | App Android (Expo; iOS possível depois) | Vendedor, Promotor | Rota, visita, catálogo, pedido/pré-venda, execução no PDV, pesquisa, treinamento |
| **Macuxi Gestão** | App Android (mesmo código, outra variante; iOS recomendado em seguida) | Supervisor, Gerente | Acompanhar a equipe, estatísticas, aprovações, pedido em nome do vendedor |
| **Backoffice Web** | Navegador | Analista, Assistente, Admin do tenant (gestor também acessa) | Cadastros, licenças de módulos, aprovações, pesquisas, conteúdos de treinamento, integrações, painéis |
| **Hub de Integração** | Nuvem + Conector no cliente | Técnico do cliente | Trazer dados do ERP e devolver pedidos |

> **Crítica e recomendação — "dois apps"**: manter **um único código** com duas variantes de build (ícone, nome e módulos diferentes) dá a separação que o usuário enxerga sem duplicar manutenção. Fazer dois projetos separados dobraria correções e testes. Usar Expo também deixa o Gestão pronto para iPhone, comum entre gerentes.

## Módulos
O **Core** vem sempre; os demais são **instaláveis/desinstaláveis por tenant, perfil e usuário** pelo Backoffice, sem reinstalar o app (ver "Instalação de módulos" em `04-arquitetura-e-dados`).

| Módulo | Onde aparece | Resumo |
|---|---|---|
| **Core** (obrigatório) | Campo, Gestão, Web | Login e perfis, carteira, Cliente 360 (cadastro + financeiro + histórico), rotas e visitas (check-in), sincronização offline, metas e indicadores básicos, central de recados/notificações |
| **Catálogo** | Campo, Gestão, Web (admin de conteúdo) | Vitrine de produtos com busca em **linguagem natural**, ficha rica, preço e estoque, "pergunte ao catálogo" |
| **Vendedor** | Campo, Web (pedidos/aprovações) | Pedido e pré-venda: carrinho, validações, alçada, crédito, estoque, PDF, fila offline |
| **Promotor** | Campo, Web (cadastros e relatórios de trade) | **Promotoria de mercado**: arrumação de gôndola, share de prateleira, pesquisa de preço e de produto (nosso e concorrência), ruptura, validade, pontos extras e tarefas de campanha. Vê os dados dos clientes da carteira só para leitura e **nunca cria, edita ou exclui pedidos** |
| **Gestor** | Gestão, Web | Tudo dos seus vendedores/promotores: painéis, ranking, mapa de visitas, alertas, aprovações e **pedido em nome do vendedor** |
| **Pesquisa** | Campo (responder), Web (criar e analisar) | Questionários cadastrados no BKO, público-alvo, obrigatórios no check-in ou avulsos, offline |
| **Treinamento** | Campo e Gestão (aprender/ranking), Web (conteúdo) | Jornada gamificada: trilhas, lições, quizzes, XP, níveis, medalhas, ranking por equipe |
| **Integração** (plataforma) | Web (monitor), Conector | Hub REST de integração, Conector on-premise, devolução de pedidos ao ERP |

### Sugestões incorporadas à sua estrutura
1. **Core separado dos módulos**: rota, visita, carteira e Cliente 360 são usados por vendedor, promotor e gestor; se ficassem no módulo Vendedor, o Promotor dependeria dele.
2. **Integração como módulo de plataforma** com agente próprio — é o ponto mais arriscado do projeto.
3. **Alerta de ruptura do promotor para o vendedor** → a falta de produto na loja vira oportunidade de venda, sem o promotor fazer pedido.
4. **Pedido em nome** do Gestor usa o motor de pedido do Vendedor por **ponto de extensão**, não por cópia.
5. **Treinamento conectado a vendas** (opcional): desafios que dão XP quando o vendedor vende itens de uma campanha — via eventos.
6. **Busca em linguagem natural híbrida**: inteligente online, busca por texto/sinônimos offline.
7. **Promotor × Pesquisa**: as coletas de trade (gôndola, share, preço, ruptura, validade) são **nativas do Promotor**, com cálculos e indicadores prontos; o módulo Pesquisa cobre questionários livres e pode ser anexado à visita do promotor.

## Perfis
Vendedor · Promotor · Supervisor · Gerente · Analista BKO · Assistente BKO · Admin do tenant · Super-admin Macuxi (plataforma). Hierarquia: Gerente → Supervisores → Vendedores/Promotores.

## Pacotes comerciais sugeridos (premissa)
- **Essencial**: Core + Catálogo + Vendedor + Gestor + Integração.
- **Trade**: + Promotor + Pesquisa.
- **Performance**: + Treinamento.
Cobrança por usuário ativo/mês por módulo.

## Fora do escopo inicial (backlog futuro)
Comissionamento, CRM de leads/funil, chat em tempo real, e-commerce B2B para o cliente final, rastreamento contínuo de GPS, roteirizador com janelas de tempo e veículos, iOS do Campo, white label, multi-idioma.

## Métricas de sucesso
- Pedido de 10 itens em < 2 min; 95% dos pedidos sem correção no BKO.
- Nova integração de tenant em ≤ 5 dias úteis com o Conector.
- Ativar/desativar um módulo refletido no app no próximo sync (< 5 min com rede).
- Adesão ao treinamento ≥ 70% dos vendedores/mês nos tenants com o módulo.
