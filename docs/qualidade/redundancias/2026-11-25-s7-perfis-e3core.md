# Parecer de redundâncias — Perfis pelo cargo, parte do Core (ADR 0073, etapa E3)

- Data: 25/11/2026, Manaus. Sessão S7, corretor-redundancias.
- Dono: modulo-core. SHA revisado: `c6ea313e802c1dce6188b97ca17a5746b04dbf6f` (1 commit sobre a E1 `e867c9f4769ac7fedda4f9b7d13a293a72016cf5`).
- Escopo: `modules/core/contracts/perfis.ts` (bloco V2), `modules/core/domain/perfis-cargo.ts` e `.test.ts`, `domain/index.ts`.
- Referência: `packages/platform-sdk/src/perfis-por-cargo.ts` e `.test.ts` (E1).

## Parecer: NÃO LIBERADO (primeira rodada; ver Reteste)

| ID | Onde | Tipo | Sev. | Correção |
|---|---|---|---|---|
| RD-3093 | `domain/perfis-cargo.ts:114-124` (`validarTrocaDeSenhaAlvo`) | código | alta | Reescreve a RN-CORE-34 que o SDK já decide em `podePeloCargo(p, 'senha.redefinir', { proprio, perfil: { codigo, gerePerfis } })` (`nuncaNoProprio` + `protegidoDaSenha`) e na escrita em `validarPerfilPeloCargo` (:376), com uma terceira frase para a mesma recusa ("...gerencia perfis e usuários não é redefinida por outro." × SDK "...gerencia perfis não é redefinida por aqui."). Apagar a função, o `protegidoDaSenha` do import e o caso `perfis-cargo.test.ts:79-83`; a API (E4b) chama `podePeloCargo`. |
| RD-3094 | `domain/perfis-cargo.ts:94-112` (`MENSAGEM_DA_TELA` + `validarEscritaDePerfis`) | código | média | Segundo texto para os mesmos códigos do SDK (ex.: `PERMISSAO_SEM_LICENCA` "Este módulo não está licenciado na empresa." × SDK :341 "Esta permissão é de um módulo que a empresa não contratou."; `CARGO_EM_USO` × SDK :484). Uma recusa, um texto: apagar `MENSAGEM_DA_TELA`, `ResultadoEscrita` e `validarEscritaDePerfis` (e `ViolacaoLimite`/`EntradaValidacaoPorCargo`/`validarAcessoPeloCargo` do import); a API chama `validarAcessoPeloCargo` direto (lista vazia = ok). Se as frases da tela forem as escolhidas, trocam-se no SDK (`perfis-por-cargo.ts:341, 395, 475, 484, 509`), por recado ao engenheiro-software. Atualizar o cabeçalho (:3-4): "aqui só se monta o catálogo, a cópia e a trava otimista". |
| RD-3095 | `contracts/perfis.ts:134-136, 139, 208` | código | média | Lista dos 7 modelos e regex da chave copiados do SDK (`MODELOS_PERFIL`, `ModeloPerfil`, `ACAO_RE`). → `import { ACAO_RE, CargoSchema, MODELOS_PERFIL } from '@macuxi/platform-sdk';` · `export const ModeloDePerfilSchema = z.enum(MODELOS_PERFIL);` · apagar `MODELOS_DE_PERFIL`, `ModeloDePerfilContrato` (usar `ModeloPerfil` do SDK) e `CHAVE_RE`; :208 `chave: z.string().regex(ACAO_RE)`. |
| RD-3096 | `domain/perfis-cargo.ts:63, 88, 91` | código | baixa | Literais repetidos das constantes do contrato do mesmo commit: :63 `motivo: disponivel ? null : MOTIVO_MODULO_SEM_LICENCA`; :88 tipo `{ ok: false; status: typeof STATUS_PERFIL_ALTERADO; codigo: typeof CODIGOS_ERRO_PERFIL_V2.alterado }`; :91 `{ ok: false, status: STATUS_PERFIL_ALTERADO, codigo: CODIGOS_ERRO_PERFIL_V2.alterado }` (importar os três de `../contracts/perfis`). |
| RD-3097 | `domain/perfis-cargo.test.ts:56-91` | teste | baixa (só teste; não segura, R-20261111-190159) | Último admin, RN-PRO-01, RN-CORE-33, RN-CORE-34 e licença guardada repetem `perfis-por-cargo.test.ts:386, 118, 134, 214, 355` do SDK. Com RD-3093 e RD-3094 aplicados, apagar o `describe` inteiro e o import de `validarEscritaDePerfis`/`validarTrocaDeSenhaAlvo`. |

## Mantidos (sem achado)
- `PerfilDaRequisicaoV2` e `Concessao`: o contrato do Core não os redefine (usa o SDK só pela forma de entrada/saída das rotas).
- `PermissaoDoPerfilSchema` (saída da tela, com `concedida`, `trava`, `disponivel`) e `PermissaoConcedidaV2Schema` (entrada com limites de tamanho) × `PermissoesDoPerfilSchema` do SDK: formas de rota diferentes do registro interno; só a regex repetia (RD-3095).
- `Nivel` local do contrato: anterior a este commit (bloco antigo, sai na E6).
- `ROTULO_AREA`: o SDK não tem rótulo de área de permissão (`shell.ts:129` é rótulo de módulo).
- `montarCatalogoPorArea`, `aplicarCopiarDe`, `conferirTravaOtimista` e seus testes (:18-54): sem par no SDK.
- `CODIGOS_ERRO_PERFIL_V2` × `CODIGOS_PERFIL` antigo: convivência aditiva até a E6.

## Reteste — `3308a6c5f5f09f783062a09f539f7d47342cba43`: LIBERADO
Diff contra `c6ea313`, 25/11/2026, Manaus.
- RD-3093 e RD-3094 corrigidos: saíram `validarTrocaDeSenhaAlvo`, `MENSAGEM_DA_TELA`, `ResultadoEscrita`, `validarEscritaDePerfis` e os imports do SDK; o cabeçalho diz que as regras são do SDK.
- RD-3095 corrigido: `z.enum(MODELOS_PERFIL)` e `ACAO_RE` do SDK; `MODELOS_DE_PERFIL`, `ModeloDePerfilContrato` e `CHAVE_RE` apagados (nenhum uso restante no repositório).
- RD-3096 corrigido: `MOTIVO_MODULO_SEM_LICENCA`, `STATUS_PERFIL_ALTERADO` e `CODIGOS_ERRO_PERFIL_V2.alterado` no domain.
- RD-3097 corrigido: `describe` repetido do SDK apagado.
- Mantido: o literal `'PERFIL_NAO_ENCONTRADO'` em `aplicarCopiarDe` (:66, :80). O par `CODIGOS_PERFIL.naoEncontrado` é do bloco antigo, que sai na E6. Apontar para ele prenderia o V2 ao que sai.
