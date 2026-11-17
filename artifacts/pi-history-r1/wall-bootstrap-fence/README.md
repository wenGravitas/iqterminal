# Older bootstrap versus a newer prepared wall watermark

Fix ae8e42a2bb3d0b4ad0b534b9c41aacae9972a255; backend retained-source evidence
9bb4d7b (helpers fa5127b, runtime test code 0ccfa7a). Source gates: 81 focused /
1,110 full frontend tests pass, two full skips, typecheck/staging diagnostics build
pass. The portable projector is unchanged.

An actual 30h Spot preparation pins source watermark 18135968 after the earlier
authoritative source head 18135954 was captured as the bootstrap fence. All source
inputs end at 15679177; carry-in cursor is 14589045. Before, the reader rejects
the ready cache and falls back to legacy paging solely because its watermark is
14 higher. Source token, content and requested source interval are unchanged.

The fix rebinds transport metadata backwards only with matching independently
validated max-input and carry-in proofs, all intermediate part boundaries inside
the old fence, and an old head covering the requested time. Decoded canonical
inputs cannot exceed it. Missing proof, later inputs/anchors and inconsistent
boundaries retain refusal. It does not promote acknowledged cursors or change
financial data. Existing forward rebinding and independent final validation remain.

The same real source/fence now uses two selected batches, validates the source and
matches all 8,293 walls / 49,154 value runs and original selected state exactly at
cursor 18135954. All 35 gaps remain; financial hash
cf9d17a2b3140583cbd01e6ba8c2ad93d964079d839159ed3988650a7afd944e.
before.json and after.json preserve actual failed/successful results. The full
source/process/request/resource/reference proof is in the backend artifact folder
wall-admission-staging, including exact helper/client hashes and original projector.

This validates a real captured source-head fence through an isolated x64 staging
gateway/client protocol. It does not open a chart/current subscription, render
pixels, establish Pi latency, measure same-gateway current contention, or certify
two historical charts/custom work. Server-only current samples and cold lifecycle
results retain their separate scopes. Serving 18579d9 remains unchanged with the
bridge disabled. No collectors, retention, production or main branches changed.
All prior failed/unproven loading/current/warm/resource gates remain incomplete.
