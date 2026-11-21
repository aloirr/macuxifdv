# Massa de volume do Catálogo (T-0192)

Dono: `banco-dados`. Quem usa: `modulo-catalogo`, nos testes de tempo do aparelho (SQLite) e do servidor (Postgres).
Decisão: R-20261121-122841 (v1.0.20, melhoria E da aba Catálogo do Campo).

Não há arquivo grande versionado. A massa sai de um gerador determinístico: a mesma semente devolve as mesmas linhas,
com os mesmos ids. O teste de tempo fica no módulo (`modules/catalogo/**`), não aqui.

## O que a massa traz (padrão, 20 mil produtos)
| Tabela | Linhas | Como |
|---|---|---|
| `core.produto` | 20.000 | SKU `VOL-0000001`.., EAN-13 válido e único, ~2% inativos, custo e preço em centavos |
| `catalogo.catalogo_no` | 230 | 4 níveis: grupo (10) › subgrupo (49) › linha (111) › posição (60) |
| `catalogo.produto_no` | 20.000 | 1 por produto, sempre numa folha |
| `catalogo.tabela_preco` | 5 | `VOL-TAB-BASE`, `-ATAC`, `-VARE`, `-ESPE`, `-INTE` |
| `catalogo.tabela_preco_item` | 80.000 | 20, 18, 16, 14 e 12 mil por tabela; filial padrão, sem vigência, unidade base |
| `catalogo.deposito` | 3 | `VOL-CD`, `VOL-LJ1`, `VOL-LJ2` |
| `catalogo.estoque_saldo` | 40.000 | 20, 12 e 8 mil por depósito; ~10% zerados (ruptura) |

**RN-CAT-18:** o mesmo código de nó aparece em ramos diferentes e nunca entre irmãos. Exemplos:
- `NAO_CLASSIFICADO` sob os 10 grupos;
- `OUTROS` na raiz e como filho de Outros;
- `LEVE`, `PESADO` e `MOTO` sob todo subgrupo;
- `DIANTEIRO` e `TRASEIRO` sob as linhas de Freios e Suspensão;
- `OLEO`, `VALVULA`, `JUNTA` e `ADITIVO` em dois grupos.

Toda linha leva `id` (UUID), `tenant_id`, `created_at`, `updated_at`, `deleted_at` (nulo) e `external_id`. Os carimbos
vêm de `agora`, que tem valor fixo por padrão. A massa não tem dado pessoal.

## Como usar
```ts
import { gerarCatalogoVolume, carregarCatalogoVolume } from '@macuxi/db/teste/catalogo-volume';

const massa = gerarCatalogoVolume({ semente: 20261121 }); // opções: tenantId, filialId, produtos, agora
massa.contagens; // { produtos, precos, precosPorTabela, saldos, saldosPorDeposito, nos, nosPorNivel }
```
- **Servidor (Postgres):** `await carregarCatalogoVolume(admin, massa)`, com o cliente de admin de um banco próprio
  (`criarBancoDeTeste()` e `urlAdmin`). Assim as 160 mil linhas não entram nos pulls dos outros testes. A carga:
  - cria o tenant da massa quando ele não existe; os gatilhos semeiam a filial padrão e as medidas;
  - grava tudo numa transação, em lotes de 5.000;
  - é idempotente: a segunda carga insere 0;
  - só aceita Postgres local. Leva cerca de 10 s.
- **Tenant que já existe** (ex.: o A da fixture `dois-tenants`): passe `tenantId`. A árvore dele não pode ter grupo
  raiz com os códigos da massa, nem SKU `VOL-*`. A licença do módulo (`plataforma.tenant_modulo`) não vem na massa.
- **Aparelho (SQLite):** as listas (`massa.produtos`, `massa.precos`...) têm os nomes de coluna do Postgres, que são
  os mesmos do `dados` das entidades sincronizadas. Grave cada linha como `dados` da entidade, no mesmo formato do pull.
- **Massa menor:** `produtos: 1000` dá cerca de 4× em preços e 2× em saldos. As contagens exatas saem em
  `massa.contagens`.

## Utilitário compartilhado
`@macuxi/db/teste/massa` (`massa.ts`): `criarPrng` (sorteador mulberry32), `ean13` e `gravarEmLote` (insert em lote com
`json_populate_recordset`, repetível). Use-o em toda massa de teste nova, em vez de copiar.

## Testes
```
pnpm --filter @macuxi/db exec vitest run testes/catalogo-volume
```
