# Marca Macuxi FDV: proposta v2 (Cocar, Monte Roraima e Serra do Tepequém)

> 2026-11-12 · design-de-marca · modo `propor` · T-0169.
> Pedido do Alexandre no chat, 12/11/2026 ~16h40 (Manaus), depois de ver a v1: "Nao gostei. Faça uma com o Cocar e uma com o monte Roraima, e outra com a serra do tepequem (cachoeiras)".
> A v1 (Rota, Sol a sol, Confluência) foi recusada e fica só como histórico em `../2026-11-12-marca-v1/`.
> **Situação: em análise.** Nada daqui entra no `docs/marca/manual.md` antes do "aprovo" do Alexandre.

As letras continuam a série da v1 (D, E e F) para não confundir com as opções A, B e C já recusadas.

| Arquivo | O que mostra |
|---|---|
| `comparativa.png` | as 3 opções lado a lado, com o custo, o ganho e o risco de cada uma |
| `opcao-d.png` | D · Cocar |
| `opcao-e.png` | **E · Monte Roraima** (recomendada) |
| `opcao-f.png` | F · Serra do Tepequém |
| `contraste.json` | a razão de contraste de cada par, conferida pelo script |

Para refazer as imagens, rode na raiz do repositório:
```bash
node docs/marca/propostas/2026-11-12-marca-v2/gerar.mjs
```

Cada prancha traz:
- o logo (símbolo e escrita) nas versões positiva, negativa, monocromática e sobre a cor principal;
- o ícone adaptativo do Android: a camada de 108 dp com a zona segura, as máscaras círculo, arredondada e gota, o ícone temático e os tamanhos 48, 32 e 24 px;
- a paleta com o papel de cada cor, a tipografia e a tabela de contraste;
- a aplicação simulada: o ícone na tela do celular, o Início do Campo, o login, o cabeçalho do PDF de pedido e a assinatura de e-mail.

## 1. As 3 opções

### D · Cocar
- **Símbolo:** sete penas longas em leque sobre a faixa da testa. O desenho é geométrico e próprio: não copia o cocar de nenhum povo, nem cores, nem trançado, nem plumária real.
- **Cores:** as de hoje, sem mudança. Penas em Laranja Macuxi `#C2540A` (no escuro, Laranja claro `#F59A52`), faixa em Grafite `#16202A`. Laranja texto `#8F3D06`, Laranja suave `#FBE9DC`, Fundo `#F3F4F1`, Verde sucesso `#1D6B4F` só para situação.
- **Escrita:** "Macuxi" em Archivo ExtraBold.
- **Custo:** baixo nas telas, porque as cores não mudam. Alto fora delas: precisa de consulta e autorização de uma organização macuxi antes de qualquer uso.
- **Ganho:** é o sinal mais direto do nome. Quem vê o ícone liga na hora à origem da marca.
- **Risco:** o cocar é peça de identidade e de cerimônia dos povos indígenas. Se uma empresa o usa sem o aval do povo, isso pode virar crítica pública e problema de imagem com cliente e parceiro. **Esta opção só pode ser usada com autorização por escrito de uma organização macuxi, com o crédito no manual.** O caminho é uma consulta formal a uma organização representativa dos povos de Roraima, como o Conselho Indígena de Roraima (CIR), ou a uma associação macuxi indicada por ela. Pode ser que o desenho mude depois dessa conversa.

### E · Monte Roraima (recomendada)
- **Símbolo:** o tepui largo, de topo plano e paredões retos, com o sol nascendo atrás e a linha do lavrado embaixo. É o começo do dia do vendedor.
- **Cores:**
  - Azul serra `#24456B`: botão principal, link, aba ativa, "PEDIDO" no PDF;
  - Azul claro `#9DB8E0`: azul sobre o grafite;
  - Azul suave `#E3EAF4`: fundo de chip e de cartão em destaque;
  - Laranja sol `#C2540A`: o sol do logo e os gráficos em destaque, como a barra da meta e o contador. No escuro, o sol usa o `#F59A52`;
  - Grafite `#16202A`, Fundo `#F3F4F1` e Verde sucesso `#1D6B4F`.
- **Escrita:** "Macuxi" em Archivo ExtraBold.
- **Ícone:** Campo com fundo azul serra, serra branca e sol laranja-claro; Gestão com fundo grafite, serra azul clara e sol laranja-claro.
- **Custo:** médio. O botão principal e os links passam do laranja para o azul serra (tokens do app e do BKO). O laranja fica nos gráficos e no sol do logo.
- **Ganho:** é o símbolo de Roraima que todo mundo reconhece, sem carga sagrada no desenho, e fica legível no ícone de 24 px.
- **Risco:** montanha é comum em logo. O que diferencia é o topo plano, que é inconfundível, junto com o sol. O monte também aparece nas narrativas dos povos da região, como a de Makunaima. Usamos só a paisagem, sem nenhuma figura dessas narrativas.

### F · Serra do Tepequém
- **Símbolo:** a serra de perfil terminando num paredão, a água caindo dele em dois fios e o poço embaixo. A referência são as cachoeiras da serra: Paiva, Barata e Sobe e Desce.
- **Cores:** Verde-água `#0A6670` (botão, link, ícone, "PEDIDO" no PDF), Água clara `#7FD3DB` (sobre o grafite), Água suave `#DDF0F1`, Grafite `#16202A`, Fundo `#F3F4F1` e Verde sucesso `#1D6B4F`.
- **Escrita:** "Macuxi" em IBM Plex Sans Bold.
- **Custo:** médio. Troca o laranja pelo verde-água em todas as telas e no BKO. Como o verde de "sucesso" fica parecido, ele precisa de outro tom.
- **Ganho:** é uma paisagem bonita e própria de Roraima, com cara de natureza e de frescor.
- **Risco:** a cachoeira some nos tamanhos pequenos, e no ícone de 24 px quase vira só uma serra. A serra é pouco conhecida fora de Roraima e precisa de explicação.

## 2. Contraste conferido
É a mesma conta do `packages/ui/src/comum/contraste.ts` (WCAG 2.x): texto ≥ 4,5:1; gráfico e ícone ≥ 3:1. A lista completa está em `contraste.json`, e todos os pares passam.

| Opção | Par | Razão |
|---|---|---|
| D | branco no botão laranja `#FFFFFF`/`#C2540A` | 4,60 ✓ |
| D | laranja texto no fundo `#8F3D06`/`#F3F4F1` | 6,70 ✓ |
| D | laranja claro no grafite `#F59A52`/`#16202A` | 7,56 ✓ |
| D | faixa grafite no ícone laranja (gráfico) `#16202A`/`#C2540A` | 3,58 ✓ |
| E | branco no botão azul `#FFFFFF`/`#24456B` | 9,82 ✓ |
| E | azul no fundo `#24456B`/`#F3F4F1` | 8,89 ✓ |
| E | azul claro no grafite `#9DB8E0`/`#16202A` | 8,14 ✓ |
| E | sol laranja no branco (gráfico) `#C2540A`/`#FFFFFF` | 4,60 ✓ |
| E | sol laranja-claro no grafite (gráfico) `#F59A52`/`#16202A` | 7,56 ✓ |
| F | branco no botão verde-água `#FFFFFF`/`#0A6670` | 6,67 ✓ |
| F | verde-água no fundo `#0A6670`/`#F3F4F1` | 6,04 ✓ |
| F | água clara no grafite `#7FD3DB`/`#16202A` | 9,61 ✓ |

O texto grafite no fundo dá 14,93 ✓ nas 3 opções.

## 3. Recomendação: opção E · Monte Roraima
1. **Todo mundo reconhece.** O topo plano do Monte Roraima é a imagem do estado. O cliente bate o olho e liga a marca a Roraima sem precisar de explicação.
2. **Funciona pequeno.** No ícone de 24 px e no ícone temático do Android, a serra com o sol continua legível. Na F, a cachoeira se perde nesse tamanho.
3. **Não depende de autorização de terceiros.** É paisagem, não peça de identidade de um povo. A D, do Cocar, só pode sair com a autorização por escrito de uma organização macuxi, o que leva tempo e pode mudar o desenho.
4. **Mantém o laranja.** O sol e os gráficos continuam no laranja que o vendedor já vê hoje, então a troca para o azul nos botões não apaga tudo o que ele já conhece.

Se você preferir o Cocar, o próximo passo é a consulta à organização macuxi, antes de qualquer arte final ou uso público.

## 4. Cultura macuxi
- O Cocar (D) é inspiração cultural direta. A origem fica registrada aqui: o cocar é peça de identidade e de cerimônia dos povos indígenas, inclusive dos Macuxi. O desenho da proposta é geométrico e não reproduz nenhum cocar real. Ele só entra na marca com autorização e crédito de artista ou organização macuxi.
- O Monte Roraima (E) e a Serra do Tepequém (F) são paisagem. Nenhuma opção usa grafismo tradicional, pintura corporal, figura mitológica ou ritual.
- "Macuxi" é o nome de um povo: a escrita fica sempre inteira, com inicial maiúscula, sem letra deformada, sem sombra e sem contorno.

## 5. Depois do "aprovo"
1. design-de-marca: registra a opção no `docs/marca/manual.md` e no `docs/marca/decisoes.md` e gera os ativos finais em `docs/marca/ativos/`:
   - SVG do símbolo e da escrita;
   - PNG do ícone em 1024 px;
   - camadas do ícone adaptativo (frente, fundo e monocromática) em 432 px;
   - splash.
2. designer-ux: na E e na F, troca os tokens de cor de `packages/ui` e o `apps/web/app/globals.css`, com o teste de contraste. Na D, nenhum token muda.
3. engenheiro-apps: troca o ícone e o splash do app (`apps/mobile/assets/images/*`, `app.config.ts`) e a `Marca` do portal (`apps/web/components/portal/base.tsx`).
4. modulo-vendedor: troca o logo padrão do PDF (`LOGO_PADRAO_DATA_URI`) pelo ícone novo.
5. design-de-marca: valida tudo no print do aparelho, do PDF e do navegador antes do lote e do build.

## Premissas
- "Não gostei" vale para os símbolos e as cores da v1. As cores de cada opção nova seguem o tema dela: a D mantém as de hoje, a E e a F trazem cores novas. Qualquer símbolo pode ser usado com outra paleta, se você preferir.
- Empresas, pessoas, CNPJ e endereços das simulações são fictícios.
- O nome dos apps continua "Macuxi Campo" e "Macuxi Gestão", e o domínio continua `macuxifdv.com.br`.
- O Início do Campo não ganha logo: a marca aparece na cor do destaque, na aba ativa e na barra da meta.
- O cabeçalho verde da tabela do PDF (`#00843D`, T-0159) fica como você aprovou.
