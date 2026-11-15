# Filial de cadastro e filiais de venda: BKO e login (simulação, antes do PR)

> 2026-11-15 · designer-ux · origem: R-20261115-093000-alexandre (regra definitiva de filial, para todo perfil) e
> R-20261115-080000-alexandre (sem filial, bloqueado). **Simulação para o dono do produto**; nada vai a PR antes do ok.
> Fonte: `filial.html` (`?v=login|bko-lista|bko-editar|16a|16b|16c|16d|16e`) e `filial.css`, com os tokens de
> `../catalogo-campo-v2/simulacao.css`. PNGs: aparelho 360 × 800 e BKO 1280 × 800, escala 2. Dados fictícios.
> Os nomes dos campos são os desta simulação; o `modulo-core` propõe os campos no banco e na API.
> Catálogo (faixa, `Estoque: N`, filtro e folha; opção A, R-20261115-100000): `../catalogo-campo-v2/spec.md` §2.1, §3 e §4.

| PNG | O que mostra |
|---|---|
| `13-login-sem-filial.png` | login do app de quem está sem filial de cadastro |
| `14-bko-usuarios-sem-filial.png` | BKO › Usuários com o filtro `Filial de cadastro: Sem filial` (sem a coluna Filial) |
| `15-bko-editar-usuario-filiais.png` | BKO › Usuários › Editar usuário com `Filial de cadastro` e `Filiais de venda` |
| `16a-carregando.png` | BKO, usuário sem filial (admin, analista): a tela única, carregando as filiais |
| `16b-escolher.png` | a escolha da filial de cadastro e o Salvar |
| `16c-empresa-sem-filial.png` | a empresa não tem filial: só a ação |
| `16d-erro-ao-salvar.png` | erro ao salvar |
| `16e-salvo-entra-no-bko.png` | salvo: entra no Início do BKO, com o menu |

## 1. A regra (R-20261115-093000)
- **Filial de cadastro:** uma, obrigatória, para todo perfil (vendedor, promotor, supervisor, gerente). É a base do usuário.
- **Filiais de venda:** uma ou várias, escolhidas no BKO, para qualquer perfil (uso no Catálogo: `../catalogo-campo-v2/spec.md` §4).
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
  Com o filtro `Sem filial`, a coluna sai, porque todas as linhas diriam o mesmo. As filiais de venda não entram na lista: ficam na gaveta.
- **Filtro `Filial de cadastro`** na `FilterBar`: `Todas` (padrão), `Sem filial` e as filiais, em ordem alfabética.
- **Aviso** (`Notice tone="warning"`) no topo, só quando há usuário sem filial e o filtro não é `Sem filial`:
  `2 usuários sem filial de cadastro não entram no app.` e o botão `Ver os 2`, que aplica o filtro. Ver a gaveta `15`, ao fundo.

## 4. App: login sem filial de cadastro (`13`)
- Vale para o Campo e o Gestão, todo perfil (R-20261115-080000 ampliada por R-20261115-093000).
- O usuário digita a senha certa e toca em `Entrar`; a API recusa a entrada. A tela de login continua aberta, com o aviso no lugar do erro
  (`TelaLogin`, prop `aviso`; `Banner tone="danger"` com o ícone `alert`):
  `Sua conta está sem filial de cadastro. Peça ao administrador da empresa para informar a filial.`
- Os campos ficam preenchidos. Depois que o admin informa a filial, o mesmo `Entrar` funciona.

## 5. BKO: usuário sem filial de cadastro (`16a` a `16e`, v1.0.12)
Regra: RN-CORE-39 (a API responde 403 `USUARIO_SEM_FILIAL`; o próprio usuário se destrava em `GET|PUT /v1/core/eu/filial-cadastro`).
Decisão do dono do produto: o BKO abre **só** esta tela, sem menu e sem outra rota, até a filial ser salva.
- Moldura do login do BKO (`apps/web/components/login-screen.tsx`, `Moldura` e `MarcaNaFaixa area="Backoffice"`): coluna de 400 px
  no fundo `ground`, a faixa com o logo e, embaixo, o título `Escolha a sua filial` (Archivo 800, 28).
- **Escolher (`16b`):** campo `Filial de cadastro` (`select` 44 px, as filiais da empresa em ordem alfabética, `Escolha…` no início),
  o `Salvar` (principal, largura toda; `Salvando…` durante a chamada) e o link `Sair`, que encerra a sessão e volta ao login.
- **Carregando (`16a`):** o campo sem toque com `Carregando…` e o `Salvar` desabilitado.
- **Empresa sem filial (`16c`):** sai o campo e o `Salvar`; `Notice tone="warning"`: `Envie as filiais pela carga do ERP e tente de novo.`
  e o principal `Tentar de novo`, que busca a lista outra vez.
- **Erro ao salvar (`16d`):** `Notice tone="danger"` acima do campo: `Não deu para salvar. Tente de novo.`; a escolha continua.
- **Salvo (`16e`):** entra direto no Início do BKO, com o menu, sem aviso.
- Acessibilidade: foco inicial no campo; o aviso é região viva; `Sair` com alvo de 44 px.

