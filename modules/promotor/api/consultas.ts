/**
 * Consulta `promotor.concorrentes@1` na API (ADR 0012; ADR 0034, T-0113). DEPRECADA e sem consumidor: a lista de marcas
 * concorrentes é do Catálogo (`catalogo.marcas@1`). Não lê tabela nenhuma nem guarda cópia. O `ContextoConsulta` do SDK não
 * encadeia consultas (não tem `consultar`), então a delegação prevista na ADR §5 não é possível aqui: a consulta responde
 * `ConsultaIndisponivel` apontando a nova. Sai na fase 2, não antes de 2026-12-08.
 * @deprecated use `catalogo.marcas@1` (`CONSULTA_MARCAS`, em `@macuxi/catalogo/contracts`).
 */
import { ConsultaIndisponivel, implementarConsulta } from '@macuxi/platform-sdk';
import { CONSULTA_CONCORRENTES } from '../contracts';

export const consultaConcorrentes = implementarConsulta(CONSULTA_CONCORRENTES, async () => {
  throw new ConsultaIndisponivel(
    CONSULTA_CONCORRENTES.nome,
    'promotor',
    'A consulta promotor.concorrentes@1 foi descontinuada: as marcas concorrentes ficam no Catálogo. Use catalogo.marcas@1.',
  );
});
