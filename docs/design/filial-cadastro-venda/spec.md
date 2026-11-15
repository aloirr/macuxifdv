# Filial de cadastro e filiais de venda: BKO e login (simulação, antes do PR)

> 2026-11-15 · designer-ux · origem: R-20261115-093000-alexandre (regra definitiva de filial, para todo perfil) e
> R-20261115-080000-alexandre (sem filial, bloqueado). **Simulação para o dono do produto**; nada vai a PR antes do ok.
> Fonte: `filial.html` (`?v=grade-a|grade-b|folha-a|folha-b|login|bko-lista|bko-editar`) e `filial.css`, com os tokens de
> `../catalogo-campo-v2/simulacao.css`. PNGs: aparelho 360 × 800 e BKO 1280 × 800, escala 2. Dados fictícios.
> Os nomes dos campos são os desta simulação; o `modulo-core` propõe os campos no banco e na API.
> Catálogo (faixa, `Estoque: N`, filtro e folha): `../catalogo-campo-v2/spec.md` §2.1, §3 e §4.

| PNG | O que mostra |
|---|---|
| `09-grade-opcao-a.png` | Catálogo, opção A: N = soma das 3 filiais de venda; faixa `Filial Boa Vista`; chip `Suas filiais (3)` |
| `10-grade-opcao-b.png` | Catálogo, opção B: N = filial de cadastro; sem selo e sem chip |
| `11-folha-opcao-a.png` | folha "Estoque por filial" na opção A: só as filiais de venda, a de cadastro marcada |
| `12-folha-opcao-b.png` | a mesma folha na opção B, com a linha `Total` |
| `13-login-sem-filial.png` | login do app de quem está sem filial de cadastro |
| `14-bko-usuarios-sem-filial.png` | BKO › Usuários com o filtro `Filial de cadastro: Sem filial` |
| `15-bko-editar-usuario-filiais.png` | BKO › Usuários › Editar usuário com `Filial de cadastro` e `Filiais de venda` |

## 1. A regra (R-20261115-093000)
- **Filial de cadastro:** uma, obrigatória, para todo perfil (vendedor, promotor, supervisor, gerente). É a base do usuário.
- **Filiais de venda:** uma ou várias, escolhidas no BKO, para qualquer perfil. O Catálogo usa só elas.
- **Proposta do designer:** a filial de cadastro é sempre uma das de venda. Assim a folha sempre tem a filial marcada, e o
  usuário nunca fica sem filial de venda.
- Carga do ERP: o `filial_external_id` do `vendedor.csv` é a filial de cadastro; as de venda vêm do BKO.

## 2. BKO › Usuários › Editar usuário (`15`)
Gaveta de hoje (`Drawer`, `modules/core/web/components/usuarios/usuarios-page.tsx`), com dois campos novos depois da
hierarquia (Gerente, Supervisor, Nome da equipe) e antes de `Código no ERP`:
- **Filial de cadastro:** `select` no padrão do `Campo` da gaveta, 44 px, opção inicial `Escolha…`. Obrigatória: sem ela, o
  Salvar marca o campo com `Escolha a filial de cadastro.` (`text-danger`, como os outros erros da gaveta).
- **Filiais de venda:** `fieldset` com uma caixa de marcar por filial, no padrão da lista de `Módulos` (linhas de 44 px,
  borda `line`), em duas colunas, em ordem alfabética.
  - A filial de cadastro fica **marcada e travada**, com `filial de cadastro` em 12 `ink2` ao lado do nome.
  - Trocar a filial de cadastro marca e trava a nova; a antiga continua marcada, e o admin desmarca se quiser.
  - Leitor de tela: `Boa Vista, filial de cadastro, marcada, indisponível`.
- Novo usuário: a mesma gaveta, com os dois campos vazios.

## 3. BKO › Usuários, lista (`14`)
- **Coluna `Filial`**, depois de `Perfil`: o nome da filial de cadastro; sem ela, o selo `Sem filial` (`Badge tone="danger"`).
  As filiais de venda não entram na lista: ficam na gaveta.
- **Filtro `Filial de cadastro`** na `FilterBar`: `Todas` (padrão), `Sem filial` e as filiais, em ordem alfabética.
- **Aviso** (`Notice tone="warning"`) no topo, só quando há usuário sem filial e o filtro não é `Sem filial`:
  `2 usuários sem filial de cadastro não entram no app.` e o botão `Ver os 2`, que aplica o filtro. Ver a gaveta `15`, ao fundo.

## 4. App: login sem filial de cadastro (`13`)
- Vale para o Campo e o Gestão, todo perfil (R-20261115-080000 ampliada por R-20261115-093000).
- O usuário digita a senha certa e toca em `Entrar`; a API recusa a entrada. A tela de login continua aberta, com o aviso no lugar do erro
  (`TelaLogin`, prop `aviso`; `Banner tone="danger"` com o ícone `alert`):
  `Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial.`
- Os campos ficam preenchidos. Depois que o admin informa a filial, o mesmo `Entrar` funciona.
