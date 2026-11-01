import { HttpTransport, InfoClient, SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid';

// Read-only public testnet probe. It deliberately does not construct an
// ExchangeClient, wallet, signer, or submit any Exchange endpoint request.
const principal = `0x${'0'.repeat(40)}`;
const timeoutMs = 30_000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(predicate, label) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`${label} did not arrive within ${timeoutMs} ms`);
    await pause(100);
  }
}

function accountSnapshot(value) {
  const state = value?.clearinghouseState ?? value;
  return {
    accountValue: state?.marginSummary?.accountValue ?? null,
    positions: Array.isArray(state?.assetPositions) ? state.assetPositions.length : null,
  };
}

function orderCount(value) {
  const rows = Array.isArray(value) ? value : value?.orders;
  return Array.isArray(rows) ? rows.length : null;
}

const http = new HttpTransport({ isTestnet: true, timeout: 15_000 });
const info = new InfoClient({ transport: http });
const websocket = new WebSocketTransport({ isTestnet: true, timeout: 15_000, resubscribe: true });
const subscriptions = new SubscriptionClient({ transport: websocket });
const active = [];
let reconnecting = false;
let accountMessagesAfterReconnect = 0;
let orderMessagesAfterReconnect = 0;
let latestAccount = null;
let latestOrders = null;
let subscriptionError = null;

async function readRest() {
  const [account, orders] = await Promise.all([
    info.clearinghouseState({ user: principal }),
    info.openOrders({ user: principal }),
  ]);
  return { ...accountSnapshot(account), openOrders: orderCount(orders) };
}

let openAfterReconnect = 0;
const onOpen = () => { if (reconnecting) openAfterReconnect++; };
websocket.socket.addEventListener('open', onOpen);

try {
  const restBefore = await readRest();
  const [accountSubscription, orderSubscription] = await Promise.all([
    subscriptions.clearinghouseState({ user: principal, dex: '' }, value => {
      latestAccount = accountSnapshot(value);
      if (reconnecting) accountMessagesAfterReconnect++;
    }, { onError: error => { subscriptionError = error; } }),
    subscriptions.openOrders({ user: principal, dex: '' }, value => {
      latestOrders = orderCount(value);
      if (reconnecting) orderMessagesAfterReconnect++;
    }, { onError: error => { subscriptionError = error; } }),
  ]);
  active.push(accountSubscription, orderSubscription);

  await waitFor(() => subscriptionError || latestAccount !== null && latestOrders !== null, 'initial account/open-orders snapshots');
  if (subscriptionError) throw subscriptionError;
  const websocketBefore = { ...latestAccount, openOrders: latestOrders };

  reconnecting = true;
  websocket.socket.reconnect(4000, 'read-only reconnect probe');
  await waitFor(() => subscriptionError || openAfterReconnect > 0
    && accountMessagesAfterReconnect > 0 && orderMessagesAfterReconnect > 0, 'account/open-orders resubscription after reconnect');
  if (subscriptionError) throw subscriptionError;

  const restAfter = await readRest();
  const websocketAfter = { ...latestAccount, openOrders: latestOrders };
  const equal = (left, right) => left.accountValue === right.accountValue
    && left.positions === right.positions && left.openOrders === right.openOrders;
  const result = {
    network: 'testnet',
    principal: 'public zero address',
    restBefore,
    websocketBefore,
    reconnect: {
      openEvents: openAfterReconnect,
      accountSnapshotEvents: accountMessagesAfterReconnect,
      openOrderSnapshotEvents: orderMessagesAfterReconnect,
      websocketAfter,
      restAfter,
      restMatchesWebsocketAfter: equal(restAfter, websocketAfter),
      restUnchangedAcrossReconnect: equal(restBefore, restAfter),
    },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.reconnect.restMatchesWebsocketAfter || !result.reconnect.restUnchangedAcrossReconnect) {
    process.exitCode = 1;
  }
} finally {
  websocket.socket.removeEventListener('open', onOpen);
  await Promise.allSettled(active.map(subscription => subscription.unsubscribe()));
  websocket.close();
}
