# Vincular vendedor do ERP na gaveta de Usuários do BKO (simulação)

> 2026-11-15 · designer-ux · origem: vínculo A1+A2 aprovado pelo dono do produto e a regra do modulo-core (RN-CORE-58, T-0175,
> `origin/nuvem/erp-vinculo-regra-modulo-core` 15bb4ee: `modules/core/domain/vinculo-erp.ts`, `api/vinculo-erp.ts`,
> `docs/modulos/core/usuarios.md`). **Simulação para o dono do produto**; nada vai a PR antes do ok.
> O **Código FDV** (§1) é **proposta do designer, à espera do ok** do dono do produto e do modulo-core (pedido de R-20261115-074500, item 8).
> Fonte: `erp-vinculo.html` (`?v=gaveta|escolher|confirmar|feito|lista`) e `erp-vinculo.css`, sobre a moldura e a gaveta de
> `../filial-cadastro-venda/filial.css` (telas 14 e 15). PNGs 1280 × 800, escala 2. Dados fictícios.

| PNG | O que mostra |
|---|---|
| `01-gaveta-sem-codigo.png` | gaveta "Editar usuário" rolada até o fim: `Código FDV`, `Código no ERP` vazio e o botão `Vincular vendedor do ERP` |
| `02-escolher-provisorio.png` | o `Dialog` com os provisórios do mesmo perfil, cada um com o código e a carteira |
| `03-confirmacao.png` | a confirmação, com o que passa e o que some |
| `04-vinculado.png` | o código no campo, o botão fora, o provisório fora da lista e o aviso; o `Código FDV` não muda |
| `05-lista-codigo-fdv.png` | a lista com a coluna `Código FDV` |

## 1. Campos da gaveta
- **Código no ERP** (`external_id`): o campo de hoje, último da gaveta, editável em Novo e Editar (vendedor e promotor).
  Código que já é de um provisório: a API responde 409, e a mensagem do core manda usar `Vincular vendedor do ERP`; o erro
  aparece embaixo do campo, como os outros da gaveta.
- **Código FDV (proposta, à espera do ok):** o código do Macuxi para controle interno, pedido em R-20261115-074500 (item 8).
  - Gerado pelo sistema ao criar o vendedor ou o promotor, sequencial por empresa (`FDV-0001`, `FDV-0002`…), único por empresa
    e sem reuso. Vale também para o provisório que a carga do ERP cria.
  - Na gaveta, logo acima do `Código no ERP`: só leitura (campo `lineSoft`, sem borda de edição), com o copiar à direita (alvo de 36 px,
    leitor de tela `Copiar código FDV`; aviso `Código copiado`). Em Novo usuário, o campo não aparece até salvar.
  - O vínculo não mexe nele: cada usuário fica com o seu, e o do provisório sai com ele.
  - Outros perfis: `—` na lista e o campo não aparece na gaveta.
  - Também na ficha do vendedor no Gestão, abaixo do nome, com o copiar (a tela é do modulo-gestor).

## 2. Botão `Vincular vendedor do ERP` (`01`)
- Secundário (`Button`, borda `lineStrong`, 44 px), com o ícone `users`, logo abaixo do `Código no ERP`.
- Só aparece quando os três valem: o usuário é vendedor ou promotor, o `Código no ERP` está vazio e existe provisório do mesmo
  perfil (`provisorio=true` na lista). Nos outros casos, não aparece.

## 3. Escolher o provisório (`02`)
- `Dialog` do kit web (`overlay.tsx`), título `Vincular vendedor do ERP` e a linha `Escolha o vendedor provisório que é a <nome>.`
- Uma opção por provisório do mesmo perfil (escolha única, linhas de 56 px): o nome que veio do ERP e, embaixo,
  `Código no ERP <código> · <N> clientes`. Com mais de 6, entra a busca por nome ou código no topo.
- Rodapé: `Cancelar` e `Continuar` (principal, desabilitado até escolher).

## 4. Confirmação (`03`)
- O mesmo `Dialog`, com o título `Vincular <provisório> (<código>) a <usuário>?` e o texto
  `<usuário> recebe o Código no ERP <código> e os <N> clientes da carteira. O provisório sai da lista.`
- Rodapé: `Voltar` (à escolha) e `Vincular` (principal). Durante a chamada, `Vinculando…`, sem segundo clique.
- Recusa da API (422 `VINCULO_*`): a mensagem do core num `Notice tone="danger"` dentro do `Dialog`, e o `Vincular` continua.

## 5. Depois (`04`)
- O `Dialog` fecha, o `Código no ERP` mostra o código, o botão some e a lista é recarregada sem o provisório.
- Aviso do kit (`useToast`): `Vínculo feito: <N> clientes passaram para <usuário>.`

## 6. Lista
- Coluna **`Código FDV`** (proposta), depois de `Filial`, em números tabulares (`05`).
- O provisório leva o selo `Provisório` (`Badge tone="neutral"`) ao lado do nome, como os outros selos da linha.
- A busca passa a ser `Buscar por nome, e-mail ou código`, porque a API já casa o código no ERP. O filtro `Provisórios`
  (`provisorio=true`) fica para o modulo-core decidir onde entra; a simulação não o mostra.
