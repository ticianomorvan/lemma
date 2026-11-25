/**
 * zod probes for `new Function` to compile faster parsers, which the page's
 * CSP refuses (and reports as a violation). Imported first by each entry.
 */
import { z } from "zod";

z.config({ jitless: true });
