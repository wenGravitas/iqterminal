/** Diagnostic capability selection only. Both arms use the same discovery
 * interception overhead; manifests, hashes and source proofs stay unchanged. */
export function selectWallTransport(document, mode) {
  if (!['canonical', 'point', 'product'].includes(mode)) throw Error('Unknown wall transport experiment');
  if (!document?.projection) return document;
  const delivery = document.projection.delivery;
  if (delivery?.version !== 1 || delivery.productTransport !== 1) {
    throw Error('Experiment requires a product-capable pinned projection');
  }
  if (mode === 'product') return document;
  if (mode === 'point') {
    if (delivery.pointTransport !== 1) throw Error('Experiment requires point capability');
    const {productTransport: _product, ...point} = delivery;
    return {...document, projection: {...document.projection, delivery: point}};
  }
  const {pointTransport: _point, productTransport: _product, ...canonical} = delivery;
  return {...document, projection: {...document.projection, delivery: canonical}};
}
