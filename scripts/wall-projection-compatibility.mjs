/** Reviewed source-equivalence exceptions, not a general version override.
 * Cooperative import changes scheduling, not the checkpoint format or finance.
 * See docs/wall-checkpoint-work-budget.md and the captured Pi comparisons.
 * Every unlisted source checksum creates its own incompatible prepared core. */
export function wallProjectionCompatibility(sourceSha256){
 if(!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('Invalid projection source checksum');
 return ['101dfc7cf817d6c0a4b28fa264842100053f507b2d5e41f98fa917700a073383','1a86cb47e20943c9c71f4614e267abe22ae507c84834cd184559ff97df041c73'].includes(sourceSha256)
  ?'c49394053a3cb680a12c9d0cd8d985e4f1a1ffe34cd20290aa4c4dcb6859938c':sourceSha256;
}
