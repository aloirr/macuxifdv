# Fotos do cliente por item: até 3 no BKO, só a última no app (v1.0.39)

> 2026-11-26 · designer-ux. Pedidos: R-20261126-204135 e R-20261126-204214-alexandre. Imagens (fonte: o `.html` de mesmo
> nome, gerados por `fotos-cliente-v1039/gerar.mjs`): `fotos-cliente-v1039/01-bko-fotos-cliente.png`,
> `02-bko-ampliar-foto.png` e `03-app-so-a-ultima.png`. Aguardam aprovação do Alexandre; vale a imagem aprovada.
> Base: `permissoes-e-fotos-pdv.md` §2 (tipos de foto do BKO, RN-CORE-38). Ficha e pré-cadastro no BKO: modulo-core.

## 1. BKO: seção "Fotos" (ficha do cliente e pré-cadastro)
- Quadro branco (`Panel`) com o título **"Fotos"**, logo abaixo do cabeçalho do cliente. Grade de 2 colunas a 1.366 px;
  1 coluna na gaveta do pré-cadastro (560 px). Um cartão por tipo de foto, na ordem de Cadastros › Fotos do PDV.
- Cartão: borda `line`, raio 12, respiro 14. Título = nome do tipo (16/600).
- Foto mais recente em destaque: largura toda do cartão, 16:9, raio 10, recorte central. Botão **Ampliar** 40×40 (ícone,
  `title`/`aria-label` "Ampliar") no canto de cima à direita; a foto inteira também amplia.
- Legenda abaixo: selo **"Mais recente"** (`text-accent-ink bg-accent-soft`) + `dd/mm/aaaa hh:mm · Nome de quem enviou`.
- As anteriores (até 2), da mais nova para a mais antiga: linha de 60 com miniatura 64×48 + `dd/mm/aaaa hh:mm · Nome`. A linha
  inteira amplia aquela foto.
- Data e hora no fuso do tenant. Sem o autor no BKO (foto antiga ou vinda do ERP), só a data e a hora, sem traço.

### Estados
| Fotos | O cartão mostra |
|---|---|
| 0 | Caixa tracejada de 120 com ícone de foto e **"Sem foto"** (`ink-2`, 15/600). Sem botão. |
| 1 | Só a foto em destaque e a legenda. |
| 2 | Destaque + 1 linha. |
| 3 | Destaque + 2 linhas. A 4ª que chega entra em destaque e a mais antiga some do cartão, sem aviso. |
| Carregando | Retângulos `neutral-soft` no lugar das fotos (mesmo tamanho). |
| Erro ao baixar | No lugar da foto: "Foto indisponível" + **Tentar de novo** (secundário). |

Tipo sensível (CNH, contrato): o perfil sem acesso não vê o cartão.

## 2. BKO: ampliar
- Diálogo de tela cheia, fundo `ink` a 94%. Cima à esquerda: nome do tipo (17/700, branco) e o cliente (14, `faixa-texto`).
  Cima à direita: **"2 de 3"** (só com 2 ou mais fotos) e **Fechar** 44×44 (✕).
- Foto ao centro, inteira (sem recorte). Setas **anterior / próxima** de 48 dos lados (só com 2 ou mais; somem nas pontas).
- Rodapé: `dd/mm/aaaa hh:mm · Nome`. Teclado: ← →, Esc fecha; o foco volta para onde abriu.

## 3. App (Campo e Gestão): só a última
- A seção "FOTOS DO PDV" da ficha não muda (`permissoes-e-fotos-pdv.md` §2): uma linha por tipo, "✓ Tem" / "Falta" + Adicionar.
- O visualizador abre só a última foto do item: ✕, o cliente, **"Fachada · dd/mm/aaaa hh:mm"** e ⋮ (Trocar foto). Sem
  contador, sem setas, sem as anteriores.

## Textos exatos
"Fotos" · "Mais recente" · "Sem foto" · "Ampliar" · "Fechar" · "Foto anterior" · "Próxima foto" · "n de 3" ·
"Foto indisponível" · "Tentar de novo". Nenhum texto sobre o limite de 3 nem sobre a exclusão da mais antiga.
