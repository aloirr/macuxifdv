# Catálogo de ponta a ponta (T-0052)

Rotas, telas do app, BKO de conteúdo e busca offline sobre o domain do módulo. Regras: [regras.md](./regras.md); IA da busca: [ia.md](./ia.md).

## API `/v1/catalogo` (`modules/catalogo/api/rotas.ts`)
O `createApp` confere antes de cada rota: licença do módulo (403 `MODULO_INATIVO`), ação do manifesto por perfil (403 `PERFIL_SEM_ACESSO`) e a entrada (Zod, 400). O cliente em contexto (`customer_id`) é opcional e passa pela carteira dentro da rota (`filtrar_no_dominio`; fora dela = 403 `FORA_DA_CARTEIRA`, RN-CORE-04).

| Método e caminho | Ação | O que faz |
|---|---|---|
| `GET busca?q=&customer_id=&line=&brand=&only_in_stock=&mode=&limit=&offset=` | `produto.consultar` | Busca em linguagem natural (LLM) com contingência textual e aviso; paginada (`total`, `next_offset`). RF-CAT-01/02, RN-CAT-03 |
| `GET produtos?customer_id=&line=&brand=&only_in_stock=&campaign=&limit=&offset=` | `produto.consultar` | Vitrine sem texto (ordem pelos boosts, RN-CAT-08) |
| `GET produtos/:id?customer_id=` | `produto.consultar` | Ficha rica: cartão + atributos, mídias e conteúdo (RF-CAT-03). Inativo/outro tenant = 404 |
| `GET filtros` | `produto.consultar` | Marcas e categorias do tenant (chips) |
| `GET sinonimos` · `PUT sinonimos/:id` · `DELETE sinonimos/:id` | `sinonimo.gerenciar` | Grupos de sinônimos (idempotente pelo id; vazio = 422 `SINONIMO_VAZIO`; termo já ativo em outro grupo = 409 `SINONIMO_EM_CONFLITO`) |
| `PUT produtos/:id/destaque` | `destaque.gerenciar` | Campanha/destaque (boost) |
| `PUT produtos/:id/conteudo` | `produto.enriquecer` | Descrição, argumentos, FAQ e atributos |
| `GET termos-sem-resultado?days=&limit=` | `busca.ver_sem_resultado` | Termos normalizados buscados sem resultado (RF-CAT-07) |

Escritas do BKO gravam auditoria (`tx.auditar`, RN-AUD-01) sem dado pessoal. Contratos: `contracts/rotas.ts` (`ConsultaBuscaQuery`, `RespostaBusca`, `PaginaVitrine`, `FichaProduto`, `SalvarSinonimo`, `SalvarConteudo`…).

### Fluxo da busca (RN-CAT-03, ia.md)
1. Transação curta: produtos, sinônimos e uso de IA do dia (fuso do tenant).
2. Interpretação **fora da transação** (o provedor pode levar até `ia_timeout_ms`): `verificarConsultaIa` → `interpretarComMedicao` → débito atômico condicional só se o provedor respondeu.
3. Transação curta: preço da tabela do cliente, estoque das filiais do usuário, ranking do domain (`buscarProdutos`), registro da busca (termo normalizado e nº de resultados, sem usuário).
- Modo `basica` = `interpreted_by: nenhum`, sem IA e sem aviso. Sem provedor configurado = regras, sem aviso. Falha/tempo/limite/IA desligada/cota indisponível = regras + aviso discreto (`degraded: true`).
- Log: `catalogo.busca` com contagens e desfecho; **nunca** o texto da busca, o cliente ou o usuário (testado).
- Provedor: `MACUXI_CATALOGO_IA_URL` (+ `MACUXI_CATALOGO_IA_CHAVE`) no `.env`; `ia_timeout_ms` do tenant (1–30 s, padrão 8 s; inválido = padrão).

### Repositório (`api/repositorio.ts`)
Interface `RepositorioCatalogo` com duas implementações:
- **Memória** (`criarRepositorioMemoria`): testes do módulo, isolada por tenant.
- **Postgres** (`criarRepositorioPostgres`): preço real (0008) e cadastro base pela consulta `core.cadastro_resumo@1` (ADR 0012; produtos = os que têm item de tabela de preço). **Até a migração 0013**: estoque, conteúdo, sinônimos, destaque, vendas, cota e registro de buscas devolvem vazio/neutro; a cota devolve `indisponivel` (a IA **não** é chamada — falha fechada, sem gasto sem limite); escrita do BKO = 503 `CATALOGO_CONTEUDO_INDISPONIVEL`. Marca, categoria e EAN chegam quando o Core os incluir na consulta (pedido ao modulo-core).

## App (Campo e Gestão; `modules/catalogo/app`)
- **Aba Catálogo** (`catalogo`, ordem 60 → fica no "Mais" do vendedor) e **ficha** (`produto`), ação `produto.consultar`, para todos os perfis do módulo.
- **Offline-first**: vitrine e ficha sempre do aparelho (`app/lib/local.ts`, mesmo domain da API). Busca com texto: API quando há sinal; sem sinal ou em falha, busca local com aviso (`AVISO_BUSCA_OFFLINE` / `AVISO_BUSCA_FALHOU`). Em catálogo grande (> 2.000 produtos) o FTS5 pré-seleciona os candidatos.
- **Cliente em contexto** pela URL (`/m/catalogo?cliente=<id>`); atalho **"Ver catálogo"** na ficha do cliente (slot `cliente.acoes` do Core). Sem cliente, o cartão pede para escolher o cliente (o tenant não tem tabela padrão).
- **RN-CAT-05**: sem permissão, nada de preço/estoque (nem filtro "Com estoque").
- **Ações do produto** só pela extensão `produto.acoes` (`AcaoProduto` em `contracts/extensoes.ts`): o Vendedor registra "Adicionar ao pedido" com `acao: 'pedido.criar'`; o promotor nunca vê (RN-PRO-01).
- **Índice FTS5** (`app/indice.ts`): colunas e pesos da v1 do banco-dados (`sku 10, ean 10, codigos 8, nome 5, marca 3, categoria 2, atributos 1`), fontes `produto` e `produto_atributo`.
- **Entidades de sync novas (só pull)**: `produto_atributo`, `sinonimo`, `deposito`, `estoque_saldo`, `produto_conteudo` (`contracts/sync-conteudo.ts`). Até os provedores existirem (depois da 0013) o servidor responde 501 e o motor registra aviso (ADR 0009 §7).

## BKO (`modules/catalogo/web`)
Página **Catálogo** (grupo Cadastros) com abas: **Produtos** (busca, categoria, CSV, destaque e editor de conteúdo), **Sinônimos** e **Buscas sem resultado**. Filtros na URL (`?aba=&q=&linha=`). Abas e botões de edição só para quem tem a ação (RN-CAT-04); a API confere de novo.

## Relevância na base demo (critério da Sprint 3)
`domain/relevancia-demo.test.ts`: **32 consultas** sobre os 24 produtos da demo (`fixtures/base-demo.ts`, cópia de `db/seeds/demo/demo.ts`), caminho completo sem LLM (o mesmo do offline e da contingência): nome com e sem acento, medidas, sinônimos do tenant, erro de digitação, código, atributo, marca, categoria, preço e ordenação; mais Atacado sem preço (RN-CAT-06) e promotor (RN-CAT-05). A fixture também traz a **proposta de conteúdo da demo** (atributos, sinônimos, destaques, vendas e estoque) pedida ao banco-dados para a 0013.
Achado e corrigido aqui: sinônimo de várias palavras com palavra de ligação ("pasta de dente", "sabão em pó") não casava — a consulta perde a stopword e o grupo não. `expandirSinonimos` agora usa `tokensDeBusca` dos dois lados.

## Pendências (fora dos caminhos do Catálogo)
- **banco-dados**: migração 0013 (estoque, conteúdo, sinônimos, destaque, cota atômica, `busca_log`) + seed do conteúdo da demo; depois o Catálogo liga o Postgres e os provedores de pull.
- **modulo-core**: `ean`, `marca` e `categoria` em `core.cadastro_resumo@1` (aditivo).
- **modulo-vendedor**: "Adicionar ao pedido" no slot `produto.acoes`.
- **testes**: `tests/modulos/demo-abas.test.ts` (D-C00c vira `it`; D-G00 passa a ter "Catálogo") e e2e da busca (IA falsa, contingência, offline).
- **engenheiro-software**: espelho do manifesto (`usaConsultas`, `usaExtensoes`), registro do slot `produto.acoes`, variáveis do `.env` e revisão do lock.
