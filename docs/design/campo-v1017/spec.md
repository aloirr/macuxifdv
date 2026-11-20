# Campo v1.0.17: sino padrão, altura do cabeçalho, hora da sincronização, filtros, Catálogo e Perfil

> 2026-11-20 · designer-ux · teste de campo do Campo v1.0.16, recado R-20261120-055304 do dono do produto (20/11/2026, ~05h50 de
> Manaus); título da Rota confirmado em R-20261120-055501. Destinatários: **modulo-core** (Início, Rota, Clientes),
> **modulo-catalogo** (Catálogo), **engenheiro-apps** (sino do shell, Mais e Perfil) e, pelo item 6, **modulo-vendedor**
> (Pedidos). Kit: `packages/ui/src/mobile` (`sino.ts`, `sino-rn.tsx`, `cabecalho.ts`, `ui.tsx`, `tokens.ts`, `theme.ts`).
> Regras do kit em `docs/design/componentes.md` §5 (listas), §5.2, §5.4 e §5.5 e em `filtro-padrao-campo/spec.md` §0.

## 0. O que vale para todas as telas
| Item | Regra | Peça do kit |
|---|---|---|
| 1 · frase do Início | `componentes.md` §5.5. | `type.fraseInicio` |
| 2 · sino | O mesmo sino em todas as telas, o que a Rota mostra hoje: `componentes.md` §5.4. | `SinoNotificacoes` |
| 5 · altura | A faixa Azul noite tem a altura do painel do Início em todas as telas: `componentes.md` §5.2. | `ALTURA_CABECALHO`, `alturaMinimaCabecalho` (já no `CabecalhoTela`) |
| 6 · hora da sincronização | Só no Início, junto do Sincronizar: `componentes.md` §5 (listas). | o `direita` do `CabecalhoTela` sem selo de hora |
| 7 · filtros | Ver `filtro-padrao-campo/spec.md` §0. | `BotaoFiltro`, `FolhaFiltro`, `EtiquetaFiltro` |

## 1. Início (`modules/core/app/telas/inicio/tela-inicio-campo.tsx`, modulo-core; sino do shell, engenheiro-apps)
- **Sino (2):** o mesmo `SinoNotificacoes` das outras telas, vindo do `ProvedorSinoCabecalho`. Sai o ajuste próprio do Início
  (`sinoBox` com `marginVertical: -10` e `linhaSaudacao` com `marginRight: -12`): o sino fica à direita da `linhaTopo`,
  centralizado na altura da foto, na posição de `componentes.md` §5.4, como na Rota. A saudação continua encolhendo até 0,75.
- **Altura (5):** o painel é a referência da altura única. Na escala do celular pequeno (`escala-inicio.ts`) o painel pode ficar
  abaixo dela; as outras telas seguem a altura única.
- **Hora da sincronização (6):** fica como está, só aqui: rodapé fixo, `Sincronizar` à esquerda e "Últ. sincronização" + hora à direita.
- **Frase (1):** a tela passa a usar `type.fraseInicio` (com o `fontSize` da escala) e `numberOfLines={LINHAS_FRASE_INICIO}` no
  lugar do estilo local; a cor e o peso vêm do token (Sol claro, 700).
- **Data (3):** sai o "· DU 14 de 21" / "· Não é dia útil" depois da data; fica só a data ("Quinta, 20 de novembro"), no mesmo
  estilo (`fonte.body` 14, `colors.faixaSub`). modulo-core.
- **Saudação (4):** com ponto final: "Bom dia, Alexandre." (e "Boa tarde, …." / "Boa noite, …."), no mesmo `type.saudacao`.
  O `accessibilityLabel` continua "Bom dia, Alexandre. Abrir perfil". modulo-core.

## 2. Rota (`modules/core/app/telas/rota.tsx` e `modules/core/app/index.ts`, modulo-core)
- **Título (8):** só `Rota` (R-20261120-055501), em qualquer dia e com qualquer filtro; a data fica só na etiqueta. Mudam o
  `tituloDaRota` e o `titulo` da página em `modules/core/app/index.ts` (hoje "Rota de hoje").
- **Sino (2):** já é o padrão; passa a ser o `SinoNotificacoes` (pelo shell).
- **Altura (5):** pelo `CabecalhoTela`; nada a fazer na tela.
- **Filtros (7):** já estão no `BotaoFiltro` (cliente, cidade, bairro e data).

## 3. Clientes (`modules/core/app/telas/clientes.tsx`, modulo-core)
- **Hora da sincronização (6):** sai o selo do `direita` (`clientes-selo-sync`). O puxar para atualizar continua.
- **Sino (2) e altura (5):** pelo `CabecalhoTela`.
- **Busca (9):** a `CampoBusca` fica na tela, ao lado do `BotaoFiltro` (exceção do item 7, `filtro-padrao-campo/spec.md` §0), e
  procura por código, CNPJ, razão social ou nome fantasia, com o placeholder **"Código, CNPJ ou nome"**. A busca não vira
  etiqueta (o texto já está no campo). A situação fica na folha "Filtrar". modulo-core.

## 4. Catálogo (`modules/catalogo/app/telas/catalogo.tsx`, modulo-catalogo)
- **Hora da sincronização (6):** sai o selo do `direita` (`catalogo-selo-sync`). O estado vazio "O catálogo ainda não
  está no aparelho" continua com a ação `Sincronizar`.
- **Sino (2) e altura (5):** pelo `CabecalhoTela`.
- **Busca (10):** a `CampoBusca` fica na tela (exceção do item 7) e acha também pela referência cruzada, online e offline.
  Sem texto novo na tela. modulo-catalogo.
- **Famílias e sistemas (11):** saem da tela os chips (Todos, Acessórios, Arrefecimento…; `catalogo-chips-sistema` e
  `catalogo-chips-categoria`) e entram na folha "Filtrar" (`FolhaFiltro`) como grupos **Família** e **Sistema**, junto da filial;
  o que estiver ativo vira `EtiquetaFiltro`. modulo-catalogo.
- **Estoque (12):** chave liga/desliga **"Só com estoque"** numa linha de 48 dp logo embaixo da busca, fora do filtro (na exceção
  da busca, `filtro-padrao-campo/spec.md` §0). Peça: o `Switch` do React Native com `trackColor={{ false: colors.lineStrong, true: colors.accent }}`
  `thumbColor={colors.surface}` nos dois estados e `ios_backgroundColor={colors.lineStrong}`;
  rótulo `t.body` à esquerda e a linha inteira tocável. Desligada mostra com e sem estoque; ligada não vira etiqueta
  (a chave já mostra o estado). Se a folha tiver opção de estoque, ela sai. modulo-catalogo.
- **Copiar código (13):** sai da ficha do produto; fica só no card da lista. modulo-catalogo.
- **Quantidade (14):** sai toda contagem de produtos ("500 produtos") da tela e da folha (o botão da folha fica `Ver produtos`).
  O `MostrarMais` continua. modulo-catalogo.

## 5. Mais (`apps/mobile/src/app/(tabs)/mais.tsx`, engenheiro-apps)
- **Sino (2) e altura (5):** pelo `CabecalhoTela` (`<Screen cabecalho={{ titulo: 'Mais' }}>`).
- Sem hora da sincronização e sem filtro na tela.
- **Item do Perfil (16):** o rótulo vira **"Perfil da conta"**, que é também o título da tela do Perfil. engenheiro-apps.

## 6. Perfil (`apps/mobile/src/app/profile.tsx`, engenheiro-apps)
- **Sino (2) e altura (5):** pelo `CabecalhoTela`, com o voltar `‹ Início` dentro da faixa; voltar e título cabem na altura única.
- Sem hora da sincronização no cabeçalho; o puxar para atualizar continua.
- Tudo abaixo é do engenheiro-apps. Ordem da tela, de cima para baixo:
  1. **Topo (17):** foto ou iniciais na medida do Início (72 × 72, `radius.xl`; iniciais `fonte.bold` 24 em `colors.accentInk`
     sobre `colors.neutralBg`, `telas/inicio-cabecalho.md` §2) e, ao lado, nome e sobrenome (`type.h1Small`, 1 linha, reticências).
  2. **Dados (18):** `TabelaRotuloValor` com Cargo, E-mail, Empresa e Gestor imediato; a linha do gestor só aparece quando houver.
  3. **Módulos (21):** no lugar de "Meus módulos", `TabelaDados` aberta (sem recolher) com Módulo · Licença · Versão, uma linha por
     módulo licenciado, **sem o Core**. A licença vai em texto (ex.: "Ativa"), nunca só em cor.
  4. **Atualização (19):** botão secundário **"Verificar atualização"** (`Button variant="outlineDark"`, 44 dp). Conferindo:
     "Verificando…", desligado. Com versão nova: `Dialogo` "Versão {x.y.z} disponível" com `Atualizar` (principal) e `Agora não`.
     Sem versão nova: aviso no rodapé "O app já está na última versão.". Sem sinal: "Sem sinal. Tente de novo.".
  5. **Diagnóstico (22):** a seção ganha o botão **"Mostrar"** (`Button` neutro, 44 dp), que abre um `Dialogo` com o log
     (`fonte.mono` 12, rolável, até 60% da altura da tela) e o botão **"Copiar"** embaixo do log; ao copiar, aviso no rodapé
     "Log copiado.". O "Enviar diagnóstico" (`diagnostico.md`) continua.
- **Saem (20):** as seções Sincronização, "Modo sem sinal" e Servidor.

(15) Config: fora desta spec; vai para o dono do portal/BKO.

## 7. Pedidos (`modules/vendedor/app/screens/orders-screen.tsx`, modulo-vendedor), pelos itens 6 e 7
- Sai o selo do `direita` (`orders-selo-sync`).
- **Busca (7):** a busca "Cliente ou nº" sai da tela e entra na folha "Filtrar": `filtro-padrao-campo/spec.md` §5. modulo-vendedor.
- Outras telas com o selo no cabeçalho (ex.: `modules/treinamento/app/screens/treinar-screen.tsx`) seguem a mesma regra.

## 8. Para o engenheiro-apps: sino no shell (RD-2450, no lote do build)
`apps/mobile/src/components/sino.tsx` passa a desenhar o `SinoNotificacoes` do kit (`total`, `onPress` que abre o balão,
`sobreFaixa`); o balão, a contagem (`ProvedorContagemSino`) e a navegação continuam no shell. `coresDoSino`, `leituraDoSino` e
`temNovoNoSino` de `apps/mobile/src/lib/sino.ts` passam a vir do kit, com os mesmos nomes, e as cópias do shell saem.
