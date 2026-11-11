"""Acceptance-report regressions; synthetic inputs, never a loading measurement."""
import json
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).with_name('pi-history-report.py')
BUILD = 'a' * 40

def sample(run):
    return {'case': 'walls-30h-spot-5m', 'run': run, 'build': BUILD,
            'requested': {'from': 0, 'to': 30*3600000},
            'paintMarks': {'firstHistoryAt': 1000, 'completeAt': 2000},
            'diagnostics': {'fixture': False, 'staging': {'config': {
                'dataMode': 'staging', 'historyTiles': True, 'build': BUILD}}}}

class ReportTests(unittest.TestCase):
    def document(self, rows):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / 'samples.jsonl'
            path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            result = subprocess.check_output(['python3', str(SCRIPT), str(path)], text=True)
            return json.loads(result)

    def report(self, rows):
        return self.document(rows)['scenarios'][0]

    def test_headless_samples_are_not_described_as_normal_foreground_chromium(self):
        rows = [sample(i) for i in range(1, 6)]
        for row in rows:
            row['rendering'] = 'headless-gles'
        result = self.document(rows)
        self.assertEqual(result['renderingModes'], ['headless-gles'])
        self.assertNotIn('normal Chromium', result['method'])
        self.assertIn('does not independently certify foreground', result['method'])

    def test_wrong_environment_never_certifies_first_history(self):
        for field, value in [('fixture', True), ('historyTiles', False), ('build', 'b' * 40)]:
            rows = [sample(i) for i in range(1, 6)]
            if field == 'fixture':
                rows[2]['diagnostics'][field] = value
            else:
                rows[2]['diagnostics']['staging']['config'][field] = value
            result = self.report(rows)
            self.assertFalse(result['environmentVerified'])
            self.assertEqual(result['firstHistory3sGate'], 'FAIL')
            self.assertEqual(result['gate'], 'FAIL')

    def test_useful_history_and_complete_coverage_are_independent_gates(self):
        rows = [sample(i) for i in range(1, 6)]
        rows[3]['paintMarks']['completeAt'] = None
        result = self.report(rows)
        self.assertEqual(result['firstHistory3sGate'], 'PASS')
        self.assertEqual(result['gate'], 'FAIL')
        self.assertEqual(result['sampleCount'], 5)
        self.assertIsNone(result['medianMs'])
        self.assertIsNone(result['maximumMs'])
        self.assertEqual(result['samplesMs'], [2000, 2000, 2000, None, 2000])

    def test_supplemental_coverage_cannot_pass_latency_acceptance(self):
        rows = [sample(i) for i in range(1, 6)]
        for row in rows:
            row['extendedCoverageObservation'] = True
        result = self.report(rows)
        self.assertEqual(result['gate'], 'SUPPLEMENTAL')
        self.assertEqual(result['firstHistory3sGate'], 'SUPPLEMENTAL')

    def test_transport_experiments_and_worker_profiles_cannot_certify_release(self):
        for field, value in [('wallTransportExperiment', 'canonical'), ('wallTransportExperiment', 'product'), ('workerCpuProfile', True)]:
            rows = [sample(i) for i in range(1, 6)]
            for row in rows:
                row[field] = value
                row['wallCoverageVerification'] = {'valid': True}
            result = self.report(rows)
            self.assertEqual(result['gate'], 'SUPPLEMENTAL')
            self.assertEqual(result['firstHistory3sGate'], 'SUPPLEMENTAL')

    def test_complete_flags_cannot_certify_wall_coverage_without_reference_and_paint_proof(self):
        rows = [sample(i) for i in range(1, 6)]
        self.assertEqual(self.report(rows)['gate'], 'FAIL')
        for row in rows:
            row['wallCoverageVerification'] = {'valid': True}
        self.assertEqual(self.report(rows)['gate'], 'PASS')
        rows[2]['wallCoverageVerification']['valid'] = False
        self.assertEqual(self.report(rows)['gate'], 'FAIL')

    def footprint(self, run):
        row=sample(run);row['case']='footprint-4h-5m';row['requested']={'from':0,'to':4*3600000};row['last']={'nativeCandles':{'closedBoundary':4*3600000},'footprint':{'status':{'history':{'validated':True}},'paint':{'times':[t*300 for t in range(48)],'cells':48}}};return row

    def test_footprint_complete_flag_cannot_hide_an_interior_paint_hole(self):
        rows=[self.footprint(i) for i in range(1,6)]
        self.assertEqual(self.report(rows)['gate'],'PASS')
        rows[2]['last']['footprint']['paint']['times'].remove(600)
        rows[2]['last']['footprint']['paint']['times'].append(20000)
        result=self.report(rows);self.assertEqual(result['gate'],'FAIL');self.assertEqual(result['footprintCoverage'][2]['missing'],[600000])

    def test_shortening_the_named_view_never_turns_a_gate_green(self):
        rows=[sample(i) for i in range(1,6)]
        for row in rows:row['wallCoverageVerification']={'valid':True};row['requested']['to']-=3600000
        result=self.report(rows);self.assertFalse(result['requestedSpanVerified']);self.assertEqual(result['gate'],'FAIL')

    def test_assertion_mode_exits_nonzero_and_retains_every_failed_sample(self):
        rows=[sample(i) for i in range(1,6)]
        for row in rows:row['wallCoverageVerification']={'valid':True}
        rows[2]['paintMarks']['completeAt']=12000
        with tempfile.TemporaryDirectory() as root:
            path=pathlib.Path(root)/'samples.jsonl';path.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            result=subprocess.run(['python3',str(SCRIPT),str(path),'--assert-gates'],capture_output=True,text=True)
            self.assertEqual(result.returncode,2);self.assertEqual(json.loads(result.stdout)['scenarios'][0]['samplesMs'],[2000,2000,12000,2000,2000])

if __name__ == '__main__':
    unittest.main()
