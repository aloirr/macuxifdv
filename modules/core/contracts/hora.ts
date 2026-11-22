/** HH:MM de 00:00 a 23:59: a única regex de hora dos contratos do Core. */
import { z } from 'zod';

export const HoraHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
