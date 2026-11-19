"""Restricted JSON-lines bridge for the official testnet signer. Never prints credentials or signed payloads."""
import asyncio
import importlib.metadata
import json
import logging
import os
import platform
import sys
import time

PIN = "71dc79cd3cd499825f88b01adede2fe8aa183955"
ENDPOINT = "https://api.testnet.lighter.xyz"
logging.disable(logging.CRITICAL)


def verify_install():
    distribution = importlib.metadata.distribution("lighter-sdk")
    source = json.loads(distribution.read_text("direct_url.json") or "{}")
    if source.get("vcs_info", {}).get("commit_id") != PIN:
        raise RuntimeError("Install the pinned official Lighter SDK from lighter-requirements.txt")
    from lighter.signer_client import get_signer
    get_signer()  # Prove native library/platform compatibility before any key is loaded.


async def run():
    verify_install()
    if "--check-install" in sys.argv:
        print(json.dumps({"sdk_commit": PIN, "platform": platform.system(), "architecture": platform.machine(), "native_signer_loaded": True}))
        return
    import lighter
    account = int(os.environ["IQ_LIGHTER_ACCOUNT_INDEX"])
    key_index = int(os.environ["IQ_LIGHTER_API_KEY_INDEX"])
    if account < 0 or key_index < 2 or key_index > 254:
        raise RuntimeError("Invalid dedicated testnet key scope")
    # The endpoint and chain ID are deliberately inseparable; do not infer from hostname.
    signer = lighter.SignerClient(url=ENDPOINT, account_index=account,
                                  api_private_keys={key_index: os.environ["IQ_LIGHTER_API_PRIVATE_KEY"]}, chain_id=300)
    os.environ.pop("IQ_LIGHTER_API_PRIVATE_KEY", None)
    try:
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                break
            try:
                command = json.loads(line)
                if command.get("accountIndex") != account or command.get("apiKeyIndex") != key_index:
                    raise ValueError("Signer account scope mismatch")
                operation = command.get("operation")
                if operation in ("orders", "history"):
                    token, error = signer.create_auth_token_with_expiry(60, api_key_index=key_index)
                    if error:
                        raise RuntimeError("Read authorization failed")
                    result = await signer.order_api.account_active_orders(authorization=token, account_index=account) if operation == "orders" else await signer.order_api.account_inactive_orders(authorization=token, account_index=account, limit=100)
                    limits = await lighter.AccountApi(signer.api_client).account_limits(authorization=token, account_index=account) if operation == "orders" else None
                    print(json.dumps({"code": result.code, "orders": [order.to_dict() for order in result.orders], "limits": {"user_tier_name": limits.user_tier_name,
                        "current_maker_fee_tick": limits.current_maker_fee_tick, "current_taker_fee_tick": limits.current_taker_fee_tick} if limits else None}), flush=True)
                    continue
                if operation not in ("place", "modify", "cancel"):
                    raise ValueError("Only order placement, modification, cancellation and scoped reads are allowed")
                if operation != "cancel" and (not isinstance(command.get("expiresAt"), (int, float)) or command["expiresAt"] <= time.time() * 1000):
                    print(json.dumps({"code": 400, "message": "Plan expired before native signing"}), flush=True)
                    continue
                market = int(command["marketId"])
                if operation == "cancel":
                    _, response, error = await signer.cancel_order(market_index=market, order_index=int(command["orderIndex"]))
                elif operation == "modify":
                    _, response, error = await signer.modify_order(market_index=market, order_index=int(command["orderIndex"]),
                        base_amount=int(command["baseAmount"]), price=int(command["price"]), trigger_price=int(command.get("triggerPrice", "0")))
                else:
                    kind = command["kind"]
                    types = {"limit": signer.ORDER_TYPE_LIMIT, "post-only": signer.ORDER_TYPE_LIMIT,
                             "ioc": signer.ORDER_TYPE_MARKET, "stop-loss": signer.ORDER_TYPE_STOP_LOSS, "take-profit": signer.ORDER_TYPE_TAKE_PROFIT}
                    tif = signer.ORDER_TIME_IN_FORCE_POST_ONLY if kind == "post-only" else signer.ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL if kind == "ioc" else signer.ORDER_TIME_IN_FORCE_GOOD_TILL_TIME
                    _, response, error = await signer.create_order(market_index=market, client_order_index=int(command["clientOrderIndex"]),
                        base_amount=int(command["baseAmount"]), price=int(command["price"]), is_ask=command["isAsk"],
                        order_type=types[kind], time_in_force=tif, reduce_only=command["reduceOnly"], trigger_price=int(command.get("triggerPrice", "0")),
                        order_expiry=signer.DEFAULT_IOC_EXPIRY if kind == "ioc" else signer.DEFAULT_28_DAY_ORDER_EXPIRY)
                # The SDK serializes nonces under the sole configured key. Never retry here.
                print(json.dumps({"code": response.code if response is not None else 400,
                                  "transactionId": getattr(response, "tx_hash", None),
                                  "message": "Venue rejected transaction" if error else "Transaction submitted"}), flush=True)
            except Exception:
                # A transport failure may follow venue acceptance. The caller persists unknown.
                print(json.dumps({"unknown": True, "message": "Signer operation uncertain; reconcile before any further entry"}), flush=True)
    finally:
        await signer.close()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except Exception:
        print(json.dumps({"unknown": True, "message": "Pinned native signer unavailable or invalid testnet credential scope"}), flush=True)
        sys.exit(1)
