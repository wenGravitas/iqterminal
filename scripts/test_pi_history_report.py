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
            'requested': {'from': 1000, 'to': 2000},
            'paintMarks': {'firstHistoryAt': 1000, 'completeAt': 2000},
            'diagnostics': {'fixture': False, 'staging': {'config': {
                'dataMode': 'staging', 'historyTiles': True, 'build': BUILD}}}}

class ReportTests(unittest.TestCase):
    def report(self, rows):
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / 'samples.jsonl'
            path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            result = subprocess.check_output(['python3', str(SCRIPT), str(path)], text=True)
            return json.loads(result)['scenarios'][0]

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

if __name__ == '__main__':
    unittest.main()
