# Core — rotas e visitas reais (T-0018)

Desenho: `docs/desenho/T-0016.md` §2, §4 e §9; ADR 0009 (sync de escrita, escopo, D-2) e ADR 0010 (fotos).

## Sync
| Entidade | Direção | Escopo | Janela |
|---|---|---|---|
| `motivo` | pull | tenant | — |
| `rota`, `rota_parada` | pull | usuários visíveis (RN-CORE-04) | data ≥ hoje − 40 (sem limite superior: ADR 0009, adendo §5) |
| `visita` | ambos | usuários visíveis | `data_local` ≥ hoje − 40; push = check-in (id = id da visita) |
| `visita_checkout` | push | — | id = UUID do comando, gravado em `visita.checkout_id` |

## Regras que o servidor revalida (`modules/core/api/visita-push.ts`)
- RN-CORE-10: fora do raio (`core.checkin.raio_m`, padrão 200 m) exige justificativa → `rejeitado/RN-CORE-10`; com ela, `fora_do_raio` fica gravado; cliente sem coordenada → `sugere_coordenada` (aprovação no BKO grava a coordenada, audita e publica `core.cliente.atualizado@1`).
- RN-CORE-11: um atendimento aberto por usuário; o novo check-in fecha o anterior como `auto`/`nao_finalizado` (virada do dia no fuso do tenant); o checkout do usuário vence o fechamento automático.
- RN-CORE-12: com Vendedor efetivo, `sem_pedido` exige motivo; sem Vendedor o resultado é `atendido`. Etapas de outros módulos: o servidor só guarda (`visita_etapa`); a conferência por módulo entra com a primeira etapa real.
- RN-CORE-13: o GPS só chega no check-in e no checkout; sem GPS o atendimento segue marcado `sem_gps`. O app não usa mais a coordenada do cliente como reserva.
- RN-CORE-14: `cliente_fechado` exige motivo do tipo `cliente_fechado` + `foto_fachada_id` (`tx.registrarArquivo`; foto de outra visita = `ARQUIVO_JA_REFERENCIADO`). Motivos de sistema não se editam nem removem (422).
- Idempotência: reenviar o mesmo id é `aceito` sem duplicar; mesmo id de outro usuário = `ID_EM_USO`; visita de outro usuário ou inexistente = `VISITA_NAO_ENCONTRADA`; checkout diferente sobre visita já fechada pelo usuário = `conflito`.

## Rotas `/v1/core`
`GET rotas` · `GET rotas/:usuarioId/:data` · `PUT rotas/:usuarioId/:data` (`rota.editar`) · `POST rotas/:usuarioId/:data/copiar` · `POST rotas/gerar` (idempotente, semana = segunda-feira) · `GET usuarios/:id/clientes` (carteira vigente do usuário) · `GET visitas` · `GET coordenadas-sugeridas` e `PUT clientes/:id/coordenada` (`cliente.aprovar_coordenada`) · `GET motivos`, `PUT/DELETE motivos/:id` (`motivo.editar`).

## App
A folha de checkout aplica a RN-CORE-12 com `prepararCheckoutVisita` (domain, T-0037; detalhes em `telas-b2.md`). O estado (clientes, rota do dia, visitas) é montado só das linhas do aparelho ⊕ fila (`app/lib/rota-local.ts`); check-in e checkout entram na fila (`visita`, `visita_checkout`) e a foto da fachada na fila de arquivos depois do comando. Cargas REST da Fase M: só `metas` e `pedidos-da-visita` (saem na T-0020 e com o Vendedor).

## BKO
Rotas (editor herdado da Fase M sobre `/v1/core/rotas`: reordenar, adicionar da carteira, 2-opt, copiar dia), Visitas (filtros na URL, CSV, foto da fachada), Coordenadas sugeridas, Motivos, Carteira e Cliente 360 (T-0017).
