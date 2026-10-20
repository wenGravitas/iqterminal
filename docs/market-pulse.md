# Market Pulse calendar

Market Pulse is a local schedule display. It does not connect to exchange status services and does not confirm that an exchange or venue is reachable. Crypto is shown as a scheduled 24/7 baseline; venue outages and unannounced maintenance are outside this calendar.

The footer clock and timeline use either the browser's detected IANA timezone (`Local`, the default) or UTC. The preference is stored separately as `basis.market-pulse.timezone.v1`; changing it does not update the dock layout. Chart bars and feed timestamps remain UTC instants. The installed OpenAlgo chart API changes its time axis in place, and the ticker formats retained event instants again without reconnecting its feed.

The timeline is a rolling 24 elapsed hours. That keeps the width stable when a timezone changes daylight-saving time; selected-zone tick labels therefore skip or repeat a wall-clock hour at the corresponding transition. Every interval tooltip includes the exchange-zone and display-zone date and time.

## Modeled schedules

| Market | Schedule and zone | Annual coverage |
|---|---|---|
| NYSE | Weekdays, 09:30–16:00 America/New_York; listed early closes at 13:00 | 2026–2027 |
| LSE | Weekdays, 08:00–16:30 Europe/London; listed half-days at 12:30 | 2026–2027 |
| TSE cash equities | Weekdays, 09:00–11:30 and 12:30–15:30 Asia/Tokyo | 2026–2027 |
| ASX cash market | Weekdays, 10:00–16:00 Australia/Sydney; listed early closes at 14:10 | 2026–2027 |
| CME Bitcoin Globex | Scheduled 24/7 baseline after 2026-05-29 16:00 America/Chicago; maintenance Monday–Friday 16:00–16:02 and Saturday 02:00–04:00 | Effective-date boundary plus recurring published windows |
| Crypto asset markets | 24/7 UTC baseline | No annual holidays |

The annual cash-market tables contain official published holidays and the listed early closes for 2026 and 2027. Outside those calendar years, an ordinary weekend remains known as closed from the weekly rule; weekday holiday/early-close status is unknown. If an upcoming unverified weekday is reached before a later known opening, Market Pulse says the schedule becomes unverified and does not promise that the market opens then. CME's official 24/7 rule says weekend and holiday trading continues with trade date processing on the following business day. Its transition from the earlier regime is not modeled: times before the effective instant are unknown.

Cash-session intervals use the regular trading-hours envelope. They do not model opening and closing auctions or exchange-specific order-entry phases separately. ASX's randomized opening is approximated as a continuous-session start at 10:00. Tokyo's lunch closure is represented as two separate sessions. Early closes are only applied on the enumerated dates. These are schedule conventions, not a quote-feed or trading-status guarantee.

The schedule was checked against official pages on 2026-10-20:

- [NYSE holidays and trading hours](https://www.nyse.com/trade/hours-calendars)
- [London Stock Exchange business days](https://www.londonstockexchange.com/securities-trading/trading-access/business-days) and [service and technical description](https://docs.londonstockexchange.com/sites/default/files/documents/Service%20Technical%20Description-%2010.11.2020.pdf)
- [JPX/TSE trading hours](https://www.jpx.co.jp/english/equities/trading/domestic/01.html) and [JPX market calendar](https://www.jpx.co.jp/english/corporate/about-jpx/calendar/)
- [ASX cash-market hours](https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours) and [ASX trading calendar](https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar)
- [CME cryptocurrency futures FAQ](https://www.cmegroup.com/articles/faqs/frequently-asked-questions-cryptocurrency-futures.html) and [CME Globex notice for the 24/7 start](https://www.cmegroup.com/notices/electronic-trading/2026/04/20260427.html)

To extend the annual calendars, update the corresponding market's explicit holiday and early-close tables in `src/market-sessions.ts`, verify dates and times against that venue's published calendar, extend `CALENDAR_COVERAGE`, and add deterministic tests for the new boundary and exceptions.
