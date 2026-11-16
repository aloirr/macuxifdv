import { describe, expect, it } from 'vitest';
import { PILHA_MONO, PILHA_MONO_EMAIL, PILHA_SISTEMA, PILHA_SISTEMA_EMAIL } from './fonte';
import { PILHA_SISTEMA as PILHA_SISTEMA_RAIZ } from './index';

// Valores escritos à mão: são os do manual da marca §5.1 (R-20261115-110600).
describe('pilhas da fonte do sistema (RD-0943)', () => {
  it('texto e mono para TS, PDF e web', () => {
    expect(PILHA_SISTEMA).toBe('system-ui, "Segoe UI", Roboto, -apple-system, sans-serif');
    expect(PILHA_MONO).toBe('ui-monospace, "Cascadia Mono", "Roboto Mono", monospace');
    expect(PILHA_SISTEMA_RAIZ).toBe(PILHA_SISTEMA);
  });

  it('e-mail: Arial/Helvetica e Consolas/Courier New antes do genérico, em aspas simples', () => {
    expect(PILHA_SISTEMA_EMAIL).toBe("system-ui,'Segoe UI',Roboto,-apple-system,Arial,Helvetica,sans-serif");
    expect(PILHA_MONO_EMAIL).toBe("ui-monospace,'Cascadia Mono','Roboto Mono',Consolas,'Courier New',monospace");
    expect(PILHA_SISTEMA_EMAIL).not.toContain('"');
    expect(PILHA_MONO_EMAIL).not.toContain('"');
  });
});
