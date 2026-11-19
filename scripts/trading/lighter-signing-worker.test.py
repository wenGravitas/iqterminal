"""Bridge conformance without credentials, network or native signing."""
import asyncio
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("iq_lighter_bridge", Path(__file__).with_name("lighter-signing-worker.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeConformance(unittest.TestCase):
    def execute(self, command):
        calls = []

        class Signer:
            ORDER_TYPE_LIMIT = 0
            ORDER_TYPE_MARKET = 1
            ORDER_TYPE_STOP_LOSS = 2
            ORDER_TYPE_TAKE_PROFIT = 4
            ORDER_TIME_IN_FORCE_POST_ONLY = 2
            ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL = 0
            ORDER_TIME_IN_FORCE_GOOD_TILL_TIME = 1
            DEFAULT_IOC_EXPIRY = 0
            DEFAULT_28_DAY_ORDER_EXPIRY = -1

            def __init__(self, **values):
                calls.append(("configure", {key: value for key, value in values.items() if key != "api_private_keys"}))

            async def create_order(self, **values):
                calls.append(("create", values))
                return None, SimpleNamespace(code=200, tx_hash="fixture-transaction"), None

            async def close(self):
                calls.append(("close", {}))

        output = io.StringIO()
        with patch.object(bridge, "verify_install"), patch.object(bridge.time, "time", return_value=1_000), \
             patch.dict("sys.modules", {"lighter": SimpleNamespace(SignerClient=Signer)}), \
             patch.dict(bridge.os.environ, {"IQ_LIGHTER_ACCOUNT_INDEX": "123", "IQ_LIGHTER_API_KEY_INDEX": "2", "IQ_LIGHTER_API_PRIVATE_KEY": "fixture-only-credential"}, clear=True), \
             patch.object(bridge.sys, "stdin", io.StringIO(json.dumps(command) + "\n")), \
             patch.object(bridge.sys, "stdout", output), patch.object(bridge.sys, "argv", ["bridge"]):
            asyncio.run(bridge.run())
        self.assertNotIn("fixture-only-credential", output.getvalue())
        return calls, json.loads(output.getvalue())

    def command(self, **changes):
        return {"operation": "place", "accountIndex": 123, "apiKeyIndex": 2, "marketId": 1, "clientOrderIndex": "123456789",
                "baseAmount": "1000", "price": "1000000", "isAsk": False, "kind": "limit", "reduceOnly": False,
                "triggerPrice": "0", "expiresAt": 2_000_000, **changes}

    def test_explicit_endpoint_chain_and_exact_integer_arguments(self):
        calls, result = self.execute(self.command())
        self.assertEqual(calls[0][1], {"url": "https://api.testnet.lighter.xyz", "account_index": 123, "chain_id": 300})
        self.assertEqual(calls[1][1]["base_amount"], 1000)
        self.assertEqual(calls[1][1]["price"], 1000000)
        self.assertEqual(result["code"], 200)

    def test_expired_plan_never_calls_signer(self):
        calls, result = self.execute(self.command(expiresAt=999_999))
        self.assertEqual([kind for kind, _ in calls], ["configure", "close"])
        self.assertEqual(result["code"], 400)

    def test_other_account_or_key_never_calls_signer(self):
        for changes in ({"accountIndex": 124}, {"apiKeyIndex": 3}, {"operation": "withdraw"}):
            calls, result = self.execute(self.command(**changes))
            self.assertEqual([kind for kind, _ in calls], ["configure", "close"])
            self.assertTrue(result["unknown"])


if __name__ == "__main__":
    unittest.main()
