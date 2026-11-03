import { describe, expect, it } from 'vitest';
import { entidadesProduto } from './entidades-produto';

describe('entidades de sync de produto no app (T-0029)', () => {
  it('o Core puxa a entidade produto com servidor_vence', () => {
    const e = entidadesProduto.find((x) => x.nome === 'produto');
    expect(e).toMatchObject({ modulo: 'core', direcao: 'pull', conflito: 'servidor_vence' });
  });
});

describe('RN-CORE-19: medidas no aparelho', () => {
  it('o Core puxa a entidade medida (pull do tenant, servidor vence), para mostrar a sigla vendida offline', () => {
    expect(entidadesProduto.find((x) => x.nome === 'medida')).toMatchObject({ modulo: 'core', direcao: 'pull', conflito: 'servidor_vence' });
  });
});
