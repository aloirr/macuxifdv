# Pré-cadastro de cliente: campos obrigatórios (BKO) e marcação no Campo

> 2026-11-23 · designer-ux · v1.0.28 (sessão A). Decisão do dono do produto (23/11/2026): o FDV só faz o pré-cadastro e
> o ERP aprova; o BKO define em Parâmetros quais campos são obrigatórios. Regras: RN-CORE-78 e RN-CORE-79 (propostas).
> Parâmetro `core` · `cliente.pre_cadastro.obrigatorios` (array de chaves configuráveis). Sem cor nem token novos.

## 1. Campos

Rótulos: `ROTULOS_CAMPOS_PRE_CADASTRO` em `modules/core/contracts` (fonte única; BKO e formulário do Campo).

| Chave (contrato) | No parâmetro |
|---|---|
| `razao_social` | Sempre obrigatório (marcado e travado) |
| `documento` | Sempre obrigatório (marcado e travado) |
| `nome_fantasia` | Configurável |
| `inscricao_estadual` | Configurável |
| `telefone` | Configurável |
| `email` | Configurável |
| `endereco` | Configurável: vale para o grupo inteiro (logradouro, número, bairro, cidade, UF, CEP) |

- Ordem fixa, a da tabela.
- Padrão, quando a empresa ainda não salvou: só os dois travados marcados.
- "Contato" fica fora desta versão (não há coluna). Fica como pendência para o dono do produto.
- Rótulos do grupo Endereço no Campo: Logradouro, Número, Bairro, Cidade, UF, CEP.

## 2. BKO: Parâmetros › Clientes › painel "Pré-cadastro de cliente"

**Onde:** seção `clientes` da página Parâmetros (`ROTULO_SECAO_PARAMETROS.clientes`). O painel entra pelo manifest do
`core` com o título "Pré-cadastro de cliente", no mesmo molde de `RastreamentoParametrosPanel`
(`modules/core/web/components/rastreamento/rastreamento-parametros-panel.tsx`): `useQuery`/`useMutation`, sem
`PageHeader` próprio (o título vem da página).

**Ordem na tela:**
1. Rótulo do grupo, 12/600 `text-ink-2`: **Campos obrigatórios**.
2. Lista dos 7 campos da §1, um por linha, cada um com `label` + `input type="checkbox"`. Mesma classe do
   "Rastrear a localização no expediente": linha `min-h-[44px]`, caixa `h-5 w-5 accent-accent`, texto 15/600 `text-ink`.
   - **Razão social** e **CPF/CNPJ**: marcados e `disabled`, com o selo `Badge tone="neutral"` **Sempre** à direita do
     rótulo (a cor nunca fala sozinha). Sem dica nem explicação.
   - Os outros 5: marcar e desmarcar livremente.
3. `Button variant="primary"` **Salvar** (enquanto grava: **Salvando…**, desabilitado). É o único principal do painel.

**Estados:**

| Estado | O que aparece |
|---|---|
| Carregando | `LoadingBlock label="Carregando os campos…"`; lista e botão ocultos |
| Erro ao carregar | `ErrorBlock` com `errorMessage(erro)` e **Tentar de novo** (`onRetry` → `refetch`) |
| Salvo | `Notice tone="success"` acima da lista: **Campos obrigatórios salvos.** (fecha no ×; some ao mexer numa caixa) |
| Erro ao salvar | `Notice tone="danger"` com `errorMessage(erro)`; as marcações ficam como o usuário deixou |
| Sem permissão (analista, só GET) | Caixas `disabled` e sem o botão Salvar |

**Fora do painel (excesso, regra do corretor):** nenhum texto sobre o que o sistema faz por trás ("o app recebe…", "a
API confere…", "vale também offline…"), nenhuma contagem de marcados, nenhum aviso de "alterações não salvas".

**testIDs:** `core.pre_cadastro.parametros.painel` · `.campo.<chave>` (caixa de cada campo) · `.salvar` · `.aviso`.

## 3. Campo: ver `campo-cliente-pre-cadastro.md` §2 a §5.
