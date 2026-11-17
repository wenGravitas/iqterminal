/** Failed startup is an attempted sample, never a completed observation. Keep
 * its raw timings, but do not mix them into observation-duration statistics. */
export function completedObservation(sample) {
 const {measurement:m,observationMs}=sample;
 return !sample.error && Number.isFinite(observationMs) && observationMs>0
  && Number.isFinite(m?.observeStart) && Number.isFinite(m?.now)
  && m.now-m.observeStart>=observationMs;
}
export function observationMetric(sample,read) {
 return completedObservation(sample)?read(sample.measurement):null;
}
