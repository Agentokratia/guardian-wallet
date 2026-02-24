/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const _critical_section_1_0_acquire: () => void;
export const combine_key_share: (a: number, b: number, c: number, d: number) => [number, number, number, number];
export const extract_public_key: (a: number, b: number) => [number, number, number, number];
export const pregenerate_paillier_primes: () => [number, number, number, number];
export const run_dkg: (a: number, b: number, c: number, d: number) => [number, number, number];
export const run_dkg_with_primes: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
export const sign_create_session: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => [number, number, number];
export const sign_destroy_session: (a: number, b: number) => number;
export const sign_process_round: (a: number, b: number, c: any) => [number, number, number];
export const _critical_section_1_0_release: () => void;
export const init: () => void;
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_exn_store: (a: number) => void;
export const __externref_table_alloc: () => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __externref_table_dealloc: (a: number) => void;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
