# Pré-cadastro de cliente: campos obrigatórios (BKO) e marcação no Campo

> 2026-11-23 · designer-ux · v1.0.28 (sessão A); v1.0.30 (sessão D): lista única (§0). Decisão do dono do produto (23/11/2026): o FDV só faz o pré-cadastro e
> o ERP aprova; o BKO define em Parâmetros quais campos são obrigatórios. Regras: RN-CORE-78 e RN-CORE-79 (propostas).
> Parâmetro `core` · `cliente.campos_obrigatorios` (lista única, §0). Sem cor nem token novos.

## 0. v1.0.30: uma lista só (R-20261123-141413 e R-20261123-142306)

Parâmetros › Clientes passa a ter **uma lista só de campos obrigatórios**, que vale para as duas regras: o cadastro completo
(lista `cliente.campos_obrigatorios`, RN-CORE-16) e o pré-cadastro, que sai dela (RN-CORE-79); `cliente.pre_cadastro.obrigatorios`
é só o espelho para o APK v1.0.28. Sai o painel "Pré-cadastro de cliente" com esse nome; entra o painel **Campos obrigatórios**. Simulação:
`pre-cadastro-v1030/05-bko-parametros-campos-obrigatorios.png` (gerador `pre-cadastro-v1030/gerar.mjs`).

## 1. Campos

Rótulos: `ROTULOS_CAMPOS_PRE_CADASTRO` em `modules/core/contracts` (fonte única; BKO, formulário do Campo e do BKO).

| Linha (rótulo) | Chave (pré-cadastro) | Chaves da RN-CORE-16 | No parâmetro |
|---|---|---|---|
| Razão social | `razao_social` | `razao_social` | Sempre obrigatório (marcado e travado) |
| CPF/CNPJ | `documento` | `documento` | Sempre obrigatório (marcado e travado) |
| Nome fantasia | `nome_fantasia` | `nome_fantasia` | Configurável |
| Inscrição estadual | `inscricao_estadual` | `inscricao_estadual` (só CNPJ; "isento" vale) | Configurável |
| Telefone | `telefone` | `telefone` | Configurável |
| E-mail | `email` | `email` | Configurável |
| Endereço | `endereco` | `logradouro`, `numero`, `bairro`, `cidade`, `uf`, `cep` | Configurável: o grupo inteiro |

- Ordem fixa, a da tabela. Uma linha por campo; nada repetido entre as duas regras.
- Padrão, quando a empresa ainda não salvou: o padrão da RN-CORE-16 (razão social, CPF/CNPJ, inscrição estadual e
  endereço). Empresa que já salvou uma das duas listas: a lista inicial é a união das duas (decisão do `modulo-core` na
  migração; a tela só mostra o que vier).
- `complemento` e `geolocalizacao`, que a RN-CORE-16 aceita, ficam fora da lista (não há campo no formulário). Pendência para
  o dono do produto se algum cliente usa.
- A regra "IE só para CNPJ" é do domain; a tela não explica.

## 2. BKO: Parâmetros › Clientes › painel "Campos obrigatórios"

**Onde:** seção `clientes` da página Parâmetros, depois de Farol e Curvas ABC (ordem 25, a do painel atual), no lugar do
"Pré-cadastro de cliente". Componente: `CamposObrigatoriosPanel` (`modules/core/web/components/pre-cadastro/campos-obrigatorios-panel.tsx`), com `useQuery`/`useMutation`, sem `PageHeader`
próprio; o título do painel vem do manifest: **Campos obrigatórios**.

**Ordem na tela:**
1. Lista das 7 linhas da §1, cada uma com `label` + `input type="checkbox"`: linha `min-h-[44px]`, caixa
   `h-5 w-5 accent-accent`, texto 15/600 `text-ink`. **Sem** o rótulo de grupo "Campos obrigatórios" acima da lista (o título do
   painel já diz).
   - **Razão social** e **CPF/CNPJ**: marcados e `disabled`, texto em `text-ink-2`, com o selo `Badge tone="neutral"`
     **Sempre** à direita do rótulo (a caixa cinza não fala sozinha). Sem dica nem explicação.
   - As outras 5: marcar e desmarcar livremente.
2. `Button variant="primary"` **Salvar** (enquanto grava: **Salvando…**, desabilitado). Único principal do painel.

**Estados:**

| Estado | O que aparece |
|---|---|
| Carregando | `LoadingBlock label="Carregando os campos…"`; lista e botão ocultos |
| Erro ao carregar | `ErrorBlock` com `errorMessage(erro)` e **Tentar de novo** (`onRetry` → `refetch`) |
| Salvo | `Notice tone="success"` acima da lista: **Campos obrigatórios salvos.** (fecha no ×; some ao mexer numa caixa) |
| Erro ao salvar | `Notice tone="danger"` com `errorMessage(erro)`; as marcações ficam como o usuário deixou |
| Sem permissão de editar (analista) | Caixas `disabled` e sem o botão Salvar |
| Sem permissão de ver | O painel não aparece |

**Fora do painel (excesso, regra do corretor):** nenhum texto sobre onde a lista vale ("vale para o faturamento", "o app
recebe…", "a API confere…"), nenhuma citação de regra, nenhuma contagem de marcados, nenhum aviso de "alterações não salvas".

**testIDs:** mantidos para não quebrar testes: `core.pre_cadastro.parametros.painel` · `.campo.<chave>` · `.salvar` · `.aviso`.

## 3. Campo: ver `campo-cliente-pre-cadastro.md` §2 a §5.
