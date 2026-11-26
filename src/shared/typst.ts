/**
 * Typst facts the server and client share, kept apart from `blocks.ts` so
 * the protocol (in the first load) doesn't pull in the block tables.
 */

/** The longest `typst` block (or other diagram source) the server compiles. */
export const MAX_TYPST_SOURCE = 20_000;

/** A Typst file, by its name. */
export const isTypstFile = (path: string) => /\.typ$/i.test(path);
