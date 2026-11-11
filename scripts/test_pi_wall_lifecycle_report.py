"""Synthetic report guards, not loading measurements."""
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('report',pathlib.Path(__file__).with_name('pi-wall-lifecycle-report.py'));report=importlib.util.module_from_spec(spec);spec.loader.exec_module(report)
def rows():
    result=[]
    for cycle in range(6):
        result.append({'phase':'open','cycle':cycle,'build':'a'*40,'diagnostic':{'fixture':False,'staging':{'config':{'build':'a'*40,'dataMode':'staging','historyTiles':True}},'orderWallsArchive':{'historyJobStates':[{'preparedRevisionReused':True}]}},'reference':{'from':900000,'to':108900000,'sourceFrom':0,'sourceTo':109800000,'segments':8,'valueRuns':16},'paint':{'mounted':True,'archiveSegments':8,'segments':8,'archiveValueRuns':16,'inputRevision':2,'paintedRevision':2,'pendingProjectionSegments':0,'pendingReferenceSegments':0},'marks':{'first':500,'complete':2000},'heap':{'forcedCollection':False,'workers':[]},'nativeCoverage':{'valid':True},'nativeClosedTimes':list(range(900000,108900000,900000)),'nativeClosedBoundary':109800000,'settledReadVerified':True,'requests':[{'url':'http://test/walls/source?from=0','status':200}]})
        result.append({'phase':'closed','cycle':cycle,'heap':{'forcedCollection':False,'workers':[]},'diagnostic':{'orderWallsArchive':{'warmEntries':1}}})
    return result
class Tests(unittest.TestCase):
    def test_all_five_warm_samples_required_and_slow_sample_retained(self):
        x=rows();self.assertEqual(report.summarize(x)['warmUseful1sGate'],'PASS');x[6]['marks']['first']=1300;r=report.summarize(x);self.assertEqual(r['warmUseful1sGate'],'FAIL');self.assertEqual(r['warmSampleCount'],5);self.assertIn(1300,r['warmFirstSamplesMs'])
    def test_flags_counts_and_shortened_window_do_not_certify_reuse(self):
        for field in ['coverage','span','source','reuse','native']:
            x=rows()
            if field=='coverage':x[2]['paint']['pendingReferenceSegments']=1
            if field=='span':x[2]['reference']['to']-=900000
            if field=='source':x[2]['requests']=[]
            if field=='native':x[2]['nativeClosedTimes'].pop(50)
            if field=='reuse':x[2]['diagnostic']['orderWallsArchive']['historyJobStates']=[]
            self.assertEqual(report.summarize(x)['warmUseful1sGate'],'FAIL')
    def test_forced_collection_and_missing_seed_never_become_natural_warm_samples(self):
        x=rows()
        for r in x:r['heap']['forcedCollection']=True
        self.assertEqual(report.summarize(x)['warmUseful1sGate'],'INCOMPLETE')
        x=rows()
        for r in x:
            if r['phase']=='closed':r['diagnostic']['orderWallsArchive']['warmEntries']=0
        self.assertEqual(report.summarize(x)['warmSampleCount'],0)
if __name__=='__main__':unittest.main()
