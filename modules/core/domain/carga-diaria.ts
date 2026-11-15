/** Carga diária do estoque (RN-CORE-61, ADR 0057): a regra pura mora em `contracts/carga-diaria.ts` (o app e o Catálogo a importam de lá). */
export {
  HORA_CARGA_DIARIA_PADRAO,
  cargaDeHoje,
  cargaDiariaDevida,
  marcaCargaDiaria,
  type ParametrosCargaDiaria,
} from '../contracts/carga-diaria';
