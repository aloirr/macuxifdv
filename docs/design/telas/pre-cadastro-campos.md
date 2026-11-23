# Pré-cadastro de cliente: campos obrigatórios (BKO) e marcação no Campo

> 2026-11-23 · designer-ux · v1.0.28 (sessão A). Decisão do dono do produto (23/11/2026): o FDV só faz o pré-cadastro e
> o ERP aprova; o BKO define em Parâmetros quais campos são obrigatórios. Regras: RN-CORE-78 e RN-CORE-79 (propostas).
> Parâmetro `core` · `cliente.pre_cadastro.obrigatorios` (array de chaves configuráveis). Sem cor nem token novos.

## 1. Campos

Rótulos: `ROTULOS_CAMPOS_PRE_CADASTRO` em `modules/core/contracts` (fonte única; BKO, formulário do Campo e mensagens).

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

## 3. Campo: formulário de pré-cadastro (a tela é da sessão B)

**Marcação de obrigatório:** o mesmo padrão do BKO (`CampoFormulario`): o rótulo do campo obrigatório fica
**sem marca**; o campo não obrigatório leva **(opcional)** depois do rótulo, em 400 e `ink2`
(ex.: "Telefone (opcional)"). Nada de asterisco.
- Obrigatórios = Razão social, CPF/CNPJ e as chaves do parâmetro sincronizado. Sem parâmetro no aparelho, usa o padrão
  (só os dois travados).
- `endereco` obrigatório: todos os 6 campos do grupo ficam sem "(opcional)".
- Ao tocar em Salvar com falta: o campo fica com a borda `danger` e o erro embaixo (`CampoTexto` `erro`).
  Mensagens: `MENSAGENS_CAMPO_FALTANTE` em `modules/core/contracts` (fonte única; app e API usam o mesmo mapa).
  A de `endereco` fica embaixo do primeiro campo vazio do grupo. O foco vai ao primeiro campo com falta.
- Recusa 422 `CAMPOS_OBRIGATORIOS` vinda da API (parâmetro mudou antes do envio): a mesma mensagem por campo, do mesmo mapa.

**Situação do cadastro** (`status_cadastro`), no cartão do cliente (lista da carteira) e no alto da ficha do cliente
(`cliente.tsx`), com `ChipEstado` (`pequeno` na lista):

| `status_cadastro` | Chip | Tom |
|---|---|---|
| `pendente` | **Aguardando o ERP** | `aviso` |
| `aprovado` | sem chip (é o estado normal) | — |
| `recusado` | **Recusado pelo ERP** | `erro` |

**Motivo da recusa:** só na ficha do cliente, logo abaixo do cabeçalho, numa `Faixa tom="erro"`:
- `texto`: **Recusado pelo ERP**
- `apoio`: o `motivo_recusa` como veio, sem prefixo; sem motivo, **Sem motivo informado.**

Na ficha, com a faixa à mostra, o chip do cabeçalho sai: uma informação, um lugar. Na lista fica só o chip, sem o
motivo.
