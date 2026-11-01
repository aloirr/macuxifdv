import { describe, expect, it } from 'vitest';

import { SaudeRespostaSchema, SERVICO_API_MACUXI } from './saude';

describe('identificação do servidor Macuxi (R-20261101-023742-alexandre)', () => {
  it('aceita a resposta da API com servico macuxi-api e versão', () => {
    expect(SaudeRespostaSchema.safeParse({ ok: true, servico: SERVICO_API_MACUXI, versao: '0.1.0', modulos: ['core'] }).success).toBe(true);
  });
  it('recusa JSON de outro serviço, sem servico, sem versão ou com ok falso', () => {
    expect(SaudeRespostaSchema.safeParse({ ok: true }).success).toBe(false);
    expect(SaudeRespostaSchema.safeParse({ ok: true, servico: 'outro', versao: '1' }).success).toBe(false);
    expect(SaudeRespostaSchema.safeParse({ ok: true, servico: SERVICO_API_MACUXI }).success).toBe(false);
    expect(SaudeRespostaSchema.safeParse({ ok: false, servico: SERVICO_API_MACUXI, versao: '1' }).success).toBe(false);
  });
  it('recusa HTML e texto', () => {
    expect(SaudeRespostaSchema.safeParse('<html>ok</html>').success).toBe(false);
    expect(SaudeRespostaSchema.safeParse(null).success).toBe(false);
  });
});
