# Check-in fora de rota (RN-CORE-52)

Decisão do dono do produto (14/11/2026, 7h28): "checkin botão dentro do cliente e na rota apenas. É importante ter no BKO a permissão de habilitar checkin para clientes fora de rota, para o BKO ativar ou desativar no perfil de acesso de usuário."

## RN-CORE-52 — check-in na rota do dia ou com a ação no perfil
- O check-in é permitido no cliente que está nas paradas da **rota do dia** do usuário (no fuso do tenant; rota cancelada não conta).
- Em cliente **fora da rota** (ou sem rota no dia), só com a ação **`visita.checkin_fora_de_rota`** ("Check-in fora de rota") no perfil de acesso.
- A ação está no catálogo do Core (`manifest.ts`) e liga/desliga por perfil na página **Perfis de acesso** do BKO (T-0095, ADR 0033).
- **Padrão de fábrica: ligada nos sete perfis.** Preserva o que existe hoje (todo cliente da carteira aceita check-in). Desligar é escolha do tenant, por perfil.
- Botão na ficha: RN-CORE-51, ver `performance-cliente.md`. Na Rota, todas as paradas são da rota e o botão segue.
- **API (`POST /v1/sync/push`, entidade `visita`)** revalida na ordem: idempotência, carteira (RN-CORE-04), **rota do dia/ação (RN-CORE-52)**, raio e justificativa (RN-CORE-10), um atendimento aberto (RN-CORE-11). A licença do módulo já é conferida pelo sync. Recusa o item com `status: 'rejeitado'`, `codigo: 'CHECKIN_FORA_DE_ROTA'` (`CODIGO_CHECKIN_FORA_DE_ROTA`, contrato `modules/core/contracts/visita.ts`) e a mensagem `MENSAGEM_CHECKIN_FORA_DE_ROTA` (mesmo arquivo)
- A rota do dia no servidor usa o dia do `checkin_em` no fuso do tenant e `core.rota_parada` (usuário, data, cliente) com `core.rota.situacao <> 'cancelada'`.

## Onde está
- Regra pura: `modules/core/domain/checkin-rota.ts` (`checkinPermitido`); rodapé: `botoesDoRodapeCliente` em `domain/performance-cliente.ts`.
- Testes: `domain/checkin-rota.test.ts`; integração com banco: `api/visita.db.test.ts` (roda no CI).
- App: `usePode('visita.checkin_fora_de_rota')` na ficha (`app/telas/cliente.tsx`), com a rota do aparelho.
