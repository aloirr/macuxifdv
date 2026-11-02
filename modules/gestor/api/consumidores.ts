/**
 * Consumidores dos eventos do Gestor (ADR 0007; T-0055): cada evento de `consome` do manifesto alimenta a projeção do
 * tenant do ENVELOPE pelo repositório (`aplicarEvento` do domain: idempotente por `evento_id` e por chave de negócio,
 * indiferente à ordem). O schema do consumidor é aberto (`z.unknown()`): quem valida é o domain, que devolve `invalido`
 * sem lançar — evento ruim vira aviso no log (sem payload, sem dado pessoal) e não trava a fila do despachante.
 * Só recebe quem tem o Gestor ativo no tenant (licença, RN-CORE-02).
 */
import { definirConsumidor, definirEvento, type ConsumidorEvento } from '@macuxi/platform-sdk';
import { z } from 'zod';
import manifest from '../manifest';
import type { RepositorioGestor } from './repositorio';

export function criarConsumidoresGestor(repo: RepositorioGestor): ConsumidorEvento[] {
  return manifest.consome.map((nome) =>
    definirConsumidor({
      evento: definirEvento(nome, z.unknown()),
      async executar(payload, ctx) {
        const r = await repo.aplicar({ db: ctx.db, tenant_id: ctx.envelope.tenant_id }, [
          { evento_id: ctx.envelope.evento_id, nome, ocorrido_em: ctx.envelope.ocorrido_em, payload },
        ]);
        if (r.contagem.invalido > 0) ctx.log.warn({ evento: nome, evento_id: ctx.envelope.evento_id }, 'Gestor: evento com payload fora do contrato ignorado na projeção');
        if (r.avisos > 0) ctx.log.info({ evento: nome, evento_id: ctx.envelope.evento_id }, 'Gestor: evento aplicado com dado incompleto (ver situacaoDaCarteira)');
      },
    }),
  );
}
