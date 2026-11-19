/** T-0187 §1.2: o shell usa o mapa cargo → app rastreado do Core; sem ele no contrato, vazio (o Gestão não pede "o tempo todo"). */
import * as contratosDoCore from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';

import { APP_RASTREADO_DO_CARGO } from './app-rastreado';
import { permissoesExigidas } from './permissoes';

const doCore = (contratosDoCore as unknown as { APP_RASTREADO_DO_CARGO?: Record<string, string> }).APP_RASTREADO_DO_CARGO;

describe('APP_RASTREADO_DO_CARGO no shell', () => {
  it('é o do Core quando o contrato exporta; senão, vazio', () => {
    expect(APP_RASTREADO_DO_CARGO).toEqual(doCore ?? {});
  });

  it.skipIf(!doCore)('com o portão do Core: o supervisor pede "o tempo todo" no Gestão; o gerente não', () => {
    expect(APP_RASTREADO_DO_CARGO).toMatchObject({ vendedor: 'campo', promotor: 'campo', supervisor: 'gestao' });
    expect(APP_RASTREADO_DO_CARGO.gerente).toBeUndefined();
    expect(permissoesExigidas('gestao', 'supervisor', APP_RASTREADO_DO_CARGO)).toContain('localizacao');
    expect(permissoesExigidas('gestao', 'gerente', APP_RASTREADO_DO_CARGO)).not.toContain('localizacao');
  });
});
