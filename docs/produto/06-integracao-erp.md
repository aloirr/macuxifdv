# 06 — Integração com o ERP do cliente

## Sua proposta
Banco em nuvem do Macuxi conectando-se ao banco do cliente via API REST, extraindo todos os dados necessários.

## Crítica
| Ponto | Risco | Recomendação |
|---|---|---|
| **REST como padrão** | Correto: é universal, fácil de testar, documentar (OpenAPI) e proteger. | **Manter REST** — mas com o Macuxi como **dono do contrato** (Hub de Integração), não adaptando o Macuxi a cada API de cliente. |
| **Quem expõe a API?** | A maioria dos ERPs instalados localmente não tem API REST; pedir ao cliente para criar uma atrasa a venda em meses. | **Conector Macuxi** instalado no servidor do cliente, que lê o banco do ERP (views SQL somente leitura) e **empurra** os dados ao Hub. |
| **Nuvem acessando o banco do cliente** | Exige abrir firewall/VPN, expõe o banco na internet, trava em TI do cliente. | Conexão **sempre de saída** (do cliente para a nuvem, HTTPS 443). Nada de porta aberta no cliente. |
| **"Extrair todos os dados"** | Cargas completas repetidas são lentas, caras e pesam no ERP. | **Delta**: carga inicial completa uma vez; depois só o que mudou (data de alteração/rowversion), mais reconciliação diária por contagem e totais. |
| **ERPs na nuvem** | Já têm API própria. | **Adaptador nuvem-a-nuvem** no Hub (o Hub chama a API do ERP), sem Conector. |
| **Clientes pequenos** | Sem TI, sem servidor. | **Carga por arquivo** (Excel/CSV no BKO ou SFTP) com modelo padrão. |

**Conclusão**: REST sim, em três caminhos sobre o **mesmo contrato canônico** — Conector (padrão), API nuvem-a-nuvem e arquivo.

## Fluxos
```
ERP local ──views SQL──► Conector ──HTTPS POST /integracao/v1/lotes──► Hub ──► staging ──validação──► schemas dos módulos ──► eventos ──► apps
ERP local ◄──tabela de entrada/API do ERP── Conector ◄──GET /integracao/v1/pedidos/pendentes── Hub ◄── pedidos aprovados
                                            Conector ──POST /integracao/v1/pedidos/{id}/retorno (nº ERP, status, faturamento)──► Hub
```

## Contrato canônico (entidades e frequência sugerida)
| Entidade | Direção | Frequência | Observação |
|---|---|---|---|
| Clientes, contatos, carteira | ERP → Macuxi | 1 h | carteira pode ser mantida no Macuxi se o ERP não tiver; cliente sem campo obrigatório entra com `cadastro_incompleto` (RN-INT-14) |
| Produtos, categorias, marcas | ERP → Macuxi | 1 h | conteúdo rico (fotos, argumentos) é do Macuxi |
| Árvore do catálogo (nós e produto → nó) | ERP → Macuxi | diário | níveis e nomes do ERP (RF-CAT-04) |
| Unidades de venda do produto | ERP → Macuxi | 1 h | medida da unidade e embalagem (sigla + quantidade) pelas **siglas cadastradas** no tenant (sigla desconhecida = `referencia_ausente`, RN-CORE-19); EAN; preço próprio da embalagem opcional na tabela (RN-VEN-15) |
| Custo e preço de venda do produto | ERP → Macuxi | 1 h | `custo_cents`, `preco_venda_cents`, `desconto_maximo_pct` opcional; o custo nunca vai ao app (RN-CORE-18) |
| Aplicação do produto (descrição 2) | ERP → Macuxi | 1 h | `aplicacao`, texto até 2.000; texto maior chega cortado em 2.000, com aviso no monitor de integração (RN-CAT-11, T-0084) |
| Referência cruzada do produto | ERP → Macuxi | 1 h | `referencias: [{ marca_external_id \| marca_nome, codigo }]`, até 3, código até 30. O ERP não conhece os ids do Macuxi, por isso manda a marca pelo `external_id` ou pelo nome da marca concorrente cadastrada no Promotor; marca desconhecida descarta a referência, com aviso no monitor (RN-CAT-09, T-0085) |
| Oferece junto do produto | ERP → Macuxi | 1 h | `oferece_junto: [produto_external_id]`, até 5 (RF-CAT-09, T-0085) |
| Endereços de entrega do cliente | ERP → Macuxi | 1 h | principal + outros (RN-VEN-17) |
| Transportadoras | ERP → Macuxi | diário | opcional; o BKO também cadastra (RF-VEN-13) |
| Tabelas de preço | ERP → Macuxi | 15 min | vigência |
| Estoque por depósito | ERP → Macuxi | 5–15 min | só saldo; reservas são do Macuxi |
| Financeiro (limite, saldo) e títulos | ERP → Macuxi | 1 h | títulos abertos + baixados recentes |
| Condições de pagamento | ERP → Macuxi | diário | |
| Faturamento / devoluções | ERP → Macuxi | 15 min | alimenta metas e status |
| Pedidos aprovados | Macuxi → ERP | contínuo (poll 1–2 min) | idempotente por UUID; cada item leva `aplicacao` (retrato gravado no pedido, até 1.000, nulo quando o vendedor desmarcou; RN-VEN-19, T-0084); leva endereço de entrega, frete (modalidade e, no FOB, transportadora cadastrada ou digitada; sem valor), medida, quantidade da embalagem e quantidade em unidades por item, descontos e acréscimos do item e do pedido (RN-INT-08) |
| Retorno do pedido (nº ERP, status, nota) | ERP → Macuxi | contínuo | |

### Bloco `frete` do pedido devolvido ao ERP (RN-VEN-16, R-20261102-105040)
```json
"frete": { "modalidade": "CIF" }
"frete": { "modalidade": "FOB", "transportadora": { "tipo": "cadastrada", "id": "…" } }
"frete": { "modalidade": "FOB", "transportadora": { "tipo": "digitada", "nome": "…", "cnpj": "…", "telefone": "…" } }
```
O mapeamento para a NF-e é do ERP (orientação ao cliente): CIF → `modFrete` 0 (transportadora contratada pela empresa) ou 3 (frota própria); FOB → `modFrete` 1, com o grupo da transportadora preenchido com os dados enviados.

## Regras técnicas
- **Lote**: `POST /integracao/v1/lotes` com `entidade`, `modo` (completo | delta), `cursor`, até 5.000 registros; resposta 202 com id do lote; processamento assíncrono em staging; resultado por linha.
- **Idempotência**: chave `external_id` + hash do registro; reenvio não duplica.
- **Validação** com os schemas Zod de `modules/integracao/contracts`; linhas com erro vão para `lote_linha_erro` com motivo legível no BKO; não travam o lote inteiro.
- **Segurança**: credencial por Conector (OAuth2 client credentials ou chave de API rotacionável), escopo por tenant, opção de lista de IPs; usuário do banco do ERP **somente leitura nas views** (e escrita só na tabela de entrada de pedidos).
- **Resiliência**: Conector com fila local em disco, reenvio com backoff, sinal de vida a cada 1 min; alerta no BKO se ficar 15 min sem sinal.
- **Mapeamento**: tela no BKO para de-para de códigos (condição de pagamento, depósito, status).
- **Views-modelo**: `db/conector/views-modelo.sql` com as colunas esperadas por entidade — o técnico do cliente adapta o `SELECT` ao ERP dele.

## Conector Macuxi
Node + TypeScript empacotado como executável e serviço Windows; configuração por arquivo + tela local simples; drivers SQL Server, PostgreSQL, Oracle, MySQL e Firebird (prioridade pela base de clientes); atualização automática; logs locais por 30 dias.
