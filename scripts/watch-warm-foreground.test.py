import contextlib,importlib.util,io,json,pathlib,subprocess,sys,tempfile,unittest,uuid
from unittest.mock import patch,MagicMock
SPEC=importlib.util.spec_from_file_location('foreground',pathlib.Path(__file__).with_name('watch-warm-foreground.py'));m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
BUILD='3'*40;ROOT='/home/daz/iqterminal-wall-tail-r5-candidate-proof'
def confirmation(identity,confirmed=True):return {'cleanup':{'sessionId':identity,'build':BUILD,'root':ROOT,'confirmed':confirmed,'roles':[{'role':k,'status':'absent' if confirmed else 'unconfirmed','confirmedStopped':confirmed} for k in ['gateway','worker']]}}
class Foreground(unittest.TestCase):
 def test_explicit_client_receipt_does_not_replace_frozen_default(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);default=root/'artifacts/watch-ack-warm-acceptance';other=root/'navigation';default.mkdir(parents=True);other.mkdir();(default/'client-build.json').write_text('frozen');(other/'client-build.json').write_text('candidate')
   with patch.dict(m.os.environ,{'IQ_FOREGROUND_CLIENT_SOURCE':str(other)}):self.assertEqual(m.client_source(root),other)
   self.assertEqual((default/'client-build.json').read_text(),'frozen')
   with patch.dict(m.os.environ,{'IQ_FOREGROUND_CLIENT_SOURCE':str(root/'absent')}):
    with self.assertRaisesRegex(ValueError,'receipt required'):m.client_source(root)
   with patch.dict(m.os.environ,{},clear=True):self.assertEqual(m.client_source(root),default)
 def exercise_failed_start(self,failure):
  with tempfile.TemporaryDirectory() as tmp:
   base=pathlib.Path(tmp);fe=base/'frontend';be=base/'iqterminal-server-integration-startup-r1';source=fe/'artifacts/watch-ack-warm-acceptance';backend=be/'artifacts/watch-ack-warm-acceptance';source.mkdir(parents=True);backend.mkdir(parents=True);(be/'ops').mkdir();(be/'ops/watch-warm-candidate.py').write_text('SESSION_LIFECYCLE_VERSION=1');(be/'ops/watch-warm-remote.py').write_text('fixture');dist=fe/'dist';dist.mkdir()
   (source/'client-build.json').write_text(json.dumps({'commit':'5'*40,'exitCode':0,'outDir':str(dist),'assets':{},'nodeExecutable':sys.executable}));(backend/'build-receipt.json').write_text(json.dumps({'commit':BUILD,'bundles':{}}))
   for f in ['worker.mjs','gateway.mjs','watch-protocol.mjs']:(backend/f).write_text('fixture; never executed')
   calls=[]
   def runner(actual_be,bout,mode,timeout):
    manifest=json.loads((bout/'manifest.json').read_text());sid=manifest['sessionId'];calls.append(mode)
    if mode=='start':
     self.assertTrue(json.loads((bout/'startup-attempt.json').read_text())['remoteStartupAttempted']);self.assertEqual(sid,json.loads((bout/'startup-attempt.json').read_text())['sessionId'])
     if failure=='timeout':raise subprocess.TimeoutExpired('start',175)
     if failure=='normal':return subprocess.CompletedProcess([],0,json.dumps({'success':True,'sessionId':sid,'receipt':{'commit':BUILD}}),'')
     if failure=='lost-success':return subprocess.CompletedProcess([],0,'','')
     return subprocess.CompletedProcess([],1,'','lost/failed startup reply')
    return subprocess.CompletedProcess([],0,json.dumps(confirmation(sid)),'')
   sock=MagicMock();sock.__enter__.return_value.connect_ex.return_value=1
   children=[MagicMock(pid=100+i) for i in range(4)]
   for child in children:child.poll.side_effect=[None,None,0]
   with patch.object(m.subprocess,'Popen',side_effect=children),patch.object(m.urllib.request,'urlopen',return_value=io.StringIO(json.dumps({'build':BUILD}))),patch.object(m.time,'monotonic',side_effect=[100,100,100,1301]),patch.object(m,'__file__',str(fe/'scripts/watch-warm-foreground.py')),patch.object(m.sys,'argv',['foreground']),patch.object(m,'run_helper',side_effect=runner),patch.object(m.socket,'socket',return_value=sock),patch.object(m.signal,'signal'),contextlib.redirect_stdout(io.StringIO()):
    if failure=='normal':m.main()
    else:
     with self.assertRaises(subprocess.TimeoutExpired if failure=='timeout' else ValueError if failure=='lost-success' else RuntimeError):m.main()
   self.assertEqual(calls,['start','stop']);out=next(source.glob('manual-*'));r=json.loads((out/'cleanup.json').read_text());self.assertTrue(r['confirmed']);self.assertTrue(r['remoteStartupAttempted']);self.assertEqual(r['runError'] is None,failure=='normal')
 def test_normal_active_window_cleans_all_local_and_remote_resources(self):self.exercise_failed_start('normal')
 def test_timeout_after_remote_start_attempt_always_reconciles(self):self.exercise_failed_start('timeout')
 def test_lost_success_reply_always_reconciles(self):self.exercise_failed_start('lost-success')
 def test_failed_start_result_always_reconciles(self):self.exercise_failed_start('failure')
 def test_unreachable_cleanup_is_unknown_and_scoped_recovery_is_preserved(self):
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp);sid=str(uuid.uuid4())
   def runner(*args):raise subprocess.TimeoutExpired('stop',190)
   r=m.reconcile_remote(True,out,out,sid,BUILD,runner);self.assertFalse(r['confirmed']);self.assertEqual(r['status'],'unconfirmed');self.assertIn('IQ_WATCH_WARM_RUN_DIR=',r['recoveryCommand']);self.assertIn('watch-warm-candidate.py stop',r['recoveryCommand'])
 def test_zero_exit_without_matching_confirmation_is_not_success(self):
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp);sid=str(uuid.uuid4())
   for data in [{},confirmation(str(uuid.uuid4())),{'cleanup':{**confirmation(sid)['cleanup'],'root':'/other'}}]:
    with self.subTest(data=data):r=m.reconcile_remote(True,out,out,sid,BUILD,lambda *_:subprocess.CompletedProcess([],0,json.dumps(data),''));self.assertFalse(r['confirmed'])
 def test_capture_write_failure_does_not_obscure_actual_stop_confirmation(self):
  with tempfile.TemporaryDirectory() as tmp:
   out=pathlib.Path(tmp);sid=str(uuid.uuid4())
   with patch.object(pathlib.Path,'write_text',side_effect=OSError('log disk error')):r=m.reconcile_remote(True,out,out,sid,BUILD,lambda *_:subprocess.CompletedProcess([],0,json.dumps(confirmation(sid)),''))
   self.assertTrue(r['confirmed']);self.assertTrue(r['captureErrors'])
 def test_local_child_failure_does_not_block_remaining_cleanup(self):
  a=MagicMock(pid=1);b=MagicMock(pid=2);a.poll.return_value=None;a.terminate.side_effect=PermissionError('cannot confirm child');b.poll.side_effect=[None,0]
  results=m.cleanup_local([b,a]);self.assertFalse(results[0]['confirmedStopped']);self.assertTrue(results[1]['confirmedStopped']);b.terminate.assert_called_once()
 def test_old_helper_is_refused_before_any_start(self):
  with tempfile.TemporaryDirectory() as tmp:
   be=pathlib.Path(tmp);(be/'ops').mkdir();(be/'ops/watch-warm-candidate.py').write_text('legacy helper')
   with self.assertRaisesRegex(ValueError,'Update both tooling branches'):m.validate_helper(be)
   (be/'ops/watch-warm-candidate.py').write_text('SESSION_LIFECYCLE_VERSION=1');(be/'ops/watch-warm-remote.py').write_text('fixture');m.validate_helper(be)
 def test_never_attempted_remote_start_needs_no_network(self):
  runner=MagicMock();self.assertTrue(m.reconcile_remote(False,None,None,None,None,runner)['confirmed']);runner.assert_not_called()
if __name__=='__main__':unittest.main()
