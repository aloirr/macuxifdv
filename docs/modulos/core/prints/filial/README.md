# Filial do usuário no BKO (T-0176)

Gerado por `gerar.mjs` (a `UsuariosConteudo` real, com Tailwind e fontes do BKO; dublês só de rota, sessão e dados em `_src/`; 1280×800, escala 1; dados fictícios). Compara com `14` e `15` de `docs/design/filial-cadastro-venda/`.
Uso, na raiz: `MACUXI_CHROMIUM=/opt/pw-browsers/chromium node docs/modulos/core/prints/filial/gerar.mjs`.

| Print | Cenário |
|---|---|
| `usuarios-lista.png` | Lista com a coluna Filial, selo "Sem filial" e o aviso "Ver os 2" |
| `usuarios-sem-filial.png` | Filtro "Sem filial": sem a coluna Filial e sem o aviso |
| `usuario-editar-filiais.png` | Gaveta com Filial de cadastro e Filiais de venda |
| `usuario-editar-codigo-fdv.png` | Fim da gaveta: Código FDV só de leitura com copiar, Código no ERP e "Vincular vendedor do ERP" (spec `docs/design/erp-vinculo/`, 01) |
| `vincular-escolher.png` | Escolher o provisório do mesmo perfil (02) |
| `vincular-confirmar.png` | Confirmação do vínculo (03) |

A lista (`usuarios-lista.png`) traz também a coluna Código FDV, o selo Provisório e "—" no e-mail do provisório (05). A caixa travada da filial de cadastro usa o azul-marinho da marca com `aria-disabled` (MC-1002; aprovado `15`).
