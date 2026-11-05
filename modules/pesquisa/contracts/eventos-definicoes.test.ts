import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import * as contracts from './index';
import { DEF_RESPOSTA_REGISTRADA } from './index';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('T-0024: definições dos eventos pesquisa.* no contracts', () => {
  it('RN-PES-01: todo evento publicado no manifest tem definição exportada e nenhuma é de evento alheio', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
  });

  it('RN-PES-01: pesquisa.resposta.registrada@1 aceita o exemplo válido (versão respondida) e rejeita chave a mais', () => {
    const ev = {
      resposta_id: U(1),
      tenant_id: U(2),
      questionario_id: U(3),
      versao_id: U(4),
      usuario_id: U(5),
      equipe_id: null,
      cliente_id: U(6),
      visita_id: null,
      modo: 'avulsa',
      respondida_em: '2026-11-05T12:00:00.000Z',
      recebida_em: '2026-11-05T12:00:05.000Z',
      total_itens: 3,
    };
    expect(DEF_RESPOSTA_REGISTRADA.nome).toBe('pesquisa.resposta.registrada@1');
    expect(DEF_RESPOSTA_REGISTRADA.schema.safeParse(ev).success).toBe(true);
    expect(DEF_RESPOSTA_REGISTRADA.schema.safeParse({ ...ev, itens: [] }).success).toBe(false);
  });
});
