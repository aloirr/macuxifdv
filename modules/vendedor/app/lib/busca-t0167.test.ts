import { describe, expect, it } from 'vitest';

import { semResultadoDaBusca } from './textos-pedido';

describe('T-0167: nada encontrado', () => {
  it('RF-CAT-01: com termo parecido, a frase e o "Você quis dizer" que busca o termo', () => {
    expect(semResultadoDaBusca('agau', 'água')).toEqual({ frase: 'Nenhum produto com “agau”.', sugestao: 'água', rotuloSugestao: 'Você quis dizer “água”?' });
  });
  it('RF-CAT-01: sem termo parecido, só a frase', () => {
    expect(semResultadoDaBusca(' xyzw ', null)).toEqual({ frase: 'Nenhum produto com “xyzw”.', sugestao: null, rotuloSugestao: null });
    expect(semResultadoDaBusca('xyzw', '  ').sugestao).toBeNull();
  });
});
