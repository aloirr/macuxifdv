import { describe, expect, it } from 'vitest';
import { entidadesProduto } from './entidades-produto';

describe('entidades de sync de produto no app (T-0029)', () => {
  it('o Core puxa a entidade produto com servidor_vence', () => {
    const e = entidadesProduto.find((x) => x.nome === 'produto');
    expect(e).toMatchObject({ modulo: 'core', direcao: 'pull', conflito: 'servidor_vence' });
  });
});
