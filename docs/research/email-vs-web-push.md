# Email or web push for bringing people back to Cadence?

Research for [issue #8](https://github.com/spprashaant/software-factories/issues/8) (map: #6). Researched 2026-11-13.

Cadence is a web app with no native app. The question is which out-of-app channel should carry Notifications when the Student (or Team Admin, or Platform Admin) is not on the site: email or web push. Terms follow `GLOSSARY.md` (Notification, Approved / Declined Refund Request).

## Short answer

Email should be the baseline channel for out-of-app Notifications. Web push can be added later as an opt-in extra for people who ask for it. It should not be the only path for anything that matters, and Refund Request decisions are the clearest case. This is input to the human's decision, not the decision itself. See [Recommendation](#recommendation).

## 1. Reach

| | Email | Web push |
| --- | --- | --- |
| Who can receive it | Everyone with an address. Cadence already needs one at sign-up and Purchase. | Only browsers that support the Push API, and only after the person grants permission on that device and browser. |
| Desktop browsers | n/a | Chrome 50+, Edge 17+, Firefox 44+, Safari 18+ full (16.1–17.6 partial). [caniuse: Push API][caniuse-push] |
| macOS Safari | n/a | Safari 16 on macOS Ventura or later. No Apple Developer Program membership needed. [WebKit: Meet Web Push][webkit-meet] |
| iOS / iPadOS | Works | **Only for web apps added to the Home Screen**, iOS/iPadOS 16.4+. The site needs a web app manifest with `display: standalone` or `fullscreen`. A normal Safari tab on iPhone cannot receive web push. [WebKit: Web Push for Web Apps on iOS and iPadOS][webkit-ios] caniuse lists iOS Safari as "partial" in every version from 16.4. [caniuse: Push API][caniuse-push] |
| Android | Works | Chrome for Android and Samsung Internet are supported. [caniuse: Push API][caniuse-push] |
| Per-device? | No. One address reaches the person anywhere. | Yes. Each `PushSubscription` belongs to one service worker registration, so one browser profile on one device. [MDN: Push API][mdn-push] |

What this means for Cadence: an iPhone Student who has never added Cadence to their Home Screen cannot get web push at all. Adding a site to the Home Screen is a manual step many users don't know about, and Cadence has no web app manifest or service worker today (`public/` holds only `favicon.svg` and `images/`; no `manifest` or `serviceWorker` references in `app/`). Email has no such gap.

## 2. Opt-in friction and permission prompts

**Email**: the address is already collected. Transactional Notifications need no extra consent (see section 5). Marketing and "come back" emails need an unsubscribe path (section 3).

**Web push** needs an explicit browser permission grant, and browsers restrict how and when a site can ask:

- The request must follow a user gesture. iOS allows it only "in response to direct user interaction" such as tapping a subscribe button [webkit-ios]. Safari requires "an explicit user gesture" [webkit-meet]. MDN says browsers are moving to disallow notifications not triggered by a user gesture, and Firefox has done so since version 72 [mdn-subscribe].
- web.dev says to ask in context, when the benefit is clear, and to use a pre-prompt first. It reports that on desktop only about 12% of prompts shown without a user signal are allowed, against about 30% after an interaction (Google data, cited by web.dev) [webdev-perms].
- A denial is effectively permanent. "Once a user has permanently denied access to a permission-gated capability, browsers honor that decision." Recovery means walking the user through browser settings [webdev-perms].
- web.dev's own advice is to **"offer email instead of push notifications"** as an alternative [webdev-perms].
- Chrome now revokes notification permission automatically for sites with very low engagement that send many notifications. Installed web apps are excluded. Google says "less than 1% of all notifications receive any interaction from users" (Google, Oct 10 2025) [google-revoke].

## 3. Deliverability requirements (email)

Gmail and Yahoo both enforce sender requirements, in effect since February 2024:

- **All senders**: SPF *or* DKIM, valid forward and reverse DNS (PTR) for sending IPs, TLS (Gmail), RFC 5322 formatting, spam rate below 0.3% in Postmaster Tools (Gmail recommends staying below 0.1%) [gmail-senders] [yahoo-senders].
- **Bulk senders** (Gmail: more than 5,000 messages a day to Gmail): SPF *and* DKIM, a DMARC record (`p=none` is enough), From: domain aligned with the SPF or DKIM domain, and one-click unsubscribe (List-Unsubscribe header, RFC 8058 POST recommended) plus a visible unsubscribe link **for marketing and subscribed messages**. Yahoo requires unsubscribes to be honoured within 2 days [gmail-senders] [yahoo-senders].
- Neither page names transactional mail as exempt from unsubscribe. Both scope the requirement to "marketing and subscribed messages", so transactional mail falls outside it by implication [gmail-senders].

In practice Cadence needs a sending domain it controls, with SPF, DKIM and DMARC DNS records. It will usually also need an email provider (ESP) that handles PTR, TLS and bounce handling. Cadence won't hit 5,000 a day soon, but meeting the bulk rules from the start costs little.

**Web push** has no DNS or sender-reputation setup. Its "deliverability" risks are different: permission can be revoked by the user or by Chrome's auto-revocation [google-revoke], subscriptions can expire, and a push that doesn't show a notification breaks the `userVisibleOnly` promise, which "will result in a push subscription being revoked" on Safari [webkit-meet].

## 4. Re-engagement effectiveness

**No independent or peer-reviewed comparison of email and web push for re-engagement turned up.** The figures that do get passed around come from push and email vendors with a commercial interest. Treat them as marketing claims:

- *Vendor claim*: average web push opt-in rates of around 5–8% of site visitors (PushPushGo, Gravitec, PushOwl), or anywhere from 23% to 92% depending on platform (Pushwoosh). These ranges contradict each other and the methods aren't published.
- *Vendor claim*: "push ROI 2x to 10x email" (Sleeknote). No methodology given.

The most credible numbers are Google's own: about 12% versus 30% prompt acceptance [webdev-perms], and "less than 1% of all notifications receive any interaction" [google-revoke]. Neither compares channels directly. Both suggest that push reaches a small, self-selected audience and that most push notifications are ignored.

## 5. Suitability for transactional Notifications (Refund Request decisions)

- **Durability**: an email stays in the inbox and can be searched later. A web push notification is short-lived on the device and isn't a record. For a decision about money (an Approved Refund Request that leads to a Refund, or a Declined Refund Request), the Student will expect a written record they can find again. This is reasoned judgement, not a cited fact.
- **Legal framing (US)**: CAN-SPAM treats messages that "facilitate, complete, or confirm a commercial transaction that the recipient already has agreed to" as transactional/relationship messages. These are subject only to the rule against false or misleading routing information [ftc-canspam]. The FTC guide doesn't name refunds explicitly. A Refund Request decision appears to fit that category, but that is **unverified legal interpretation**. Other jurisdictions (e.g. GDPR/PECR in the EU and UK) were not researched.
- **Reach**: a Refund Request decision has to reach every Student who made one. Push can't guarantee that (no iOS without Home Screen install, per-device, permission can be denied or revoked). Email can.
- **Push content**: push payloads are encrypted end to end between Cadence's server and the browser, and the browser vendor's push service can't read them [webdev-push]. They still appear on lock screens, so amounts and reasons are better kept in the email or in the in-app Notification Feed.

## 6. What each requires from the web app

**Email**

- A sending domain with SPF, DKIM and DMARC DNS records, and From: alignment [gmail-senders] [yahoo-senders].
- An ESP or SMTP relay (PTR, TLS, bounce and complaint handling).
- A List-Unsubscribe one-click endpoint and a body link for any non-transactional ("come back to your course") mail [gmail-senders] [yahoo-senders].
- Templates, plus per-person Notification preferences.

**Web push**

- HTTPS (secure context) [mdn-subscribe].
- A service worker that handles `push` events and calls `showNotification()` [mdn-push] [webdev-push].
- A VAPID key pair (ECDSA P-256). The public key is passed as `applicationServerKey` to `PushManager.subscribe()`, and each push request is signed with the private key [mdn-subscribe] [webdev-push]. `userVisibleOnly: true` is required by Chrome and Edge [mdn-subscribe].
- Server-side storage of each `PushSubscription` (endpoint plus keys, kept secret because the endpoint is a capability URL, with CSRF protection on the subscribe route) [mdn-push]. Server-side payload encryption via the Web Push protocol, usually through a web-push library [webdev-push].
- For iOS: a web app manifest with `display: standalone`/`fullscreen`, plus UI that teaches Students to add Cadence to the Home Screen. If the server's outbound traffic is firewalled, `*.push.apple.com` must be allowed [webkit-ios].
- A pre-prompt UI and a "notifications blocked" help state [webdev-perms].

## Recommendation

*Input to the human's decision, not a decision.*

1. **Use email as the out-of-app channel for v1.** It reaches every Student, Team Admin and Platform Admin, including iPhone users. It suits Refund Request decisions, which need a durable record. Setup is DNS plus an ESP, not a new client-side subsystem.
2. **Keep the in-app Notification Feed as the source of truth**, with email as the way out of the app that points back into it.
3. **Treat web push as a later, optional channel** for Students who explicitly opt in from a contextual pre-prompt, for example "Tell me when the next lesson is out". Never make it the only path for a Refund Request decision. It needs a service worker, VAPID keys, subscription storage and, for iOS, a manifest plus Home Screen install. That is a significant build for a small, self-selected audience.
4. Separate transactional Notifications (Refund Request decisions) from re-engagement ("come back to your course") email. Give the second kind one-click unsubscribe from day one.

## Unverified / open

- No independent data comparing email and web push re-engagement. All opt-in and ROI figures found are vendor marketing.
- caniuse marks iOS Safari web push as "partial" without saying what is missing. The Home Screen requirement comes from WebKit's 16.4 post. Whether later iOS versions relaxed it was not confirmed.
- Apple's developer documentation page on web push could not be fetched. Safari facts come from the WebKit blog.
- Whether Refund Request decision emails count as "transactional" under CAN-SPAM is an inference, since the FTC guide doesn't name refunds. Non-US law was not researched.
- Chrome's threshold for "low engagement" auto-revocation isn't published [google-revoke].

## Sources

- [caniuse-push]: https://caniuse.com/push-api — caniuse, Push API
- [webkit-ios]: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ — WebKit blog, Web Push for Web Apps on iOS and iPadOS
- [webkit-meet]: https://webkit.org/blog/12945/meet-web-push/ — WebKit blog, Meet Web Push
- [mdn-push]: https://developer.mozilla.org/en-US/docs/Web/API/Push_API — MDN, Push API
- [mdn-subscribe]: https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe — MDN, PushManager.subscribe()
- [webdev-perms]: https://web.dev/articles/permissions-best-practices — web.dev, Permissions best practices
- [webdev-push]: https://web.dev/articles/push-notifications-overview — web.dev, Push notifications overview
- [google-revoke]: https://blog.google/chromium/automatic-notification-permission/ — Google, Chrome automatic notification permission revocation (Oct 10 2025)
- [gmail-senders]: https://support.google.com/a/answer/81126 — Google, Email sender guidelines
- [yahoo-senders]: https://senders.yahooinc.com/best-practices/ — Yahoo Sender Hub, Best practices
- [ftc-canspam]: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business — FTC, CAN-SPAM Act compliance guide

[caniuse-push]: https://caniuse.com/push-api
[webkit-ios]: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
[webkit-meet]: https://webkit.org/blog/12945/meet-web-push/
[mdn-push]: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
[mdn-subscribe]: https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
[webdev-perms]: https://web.dev/articles/permissions-best-practices
[webdev-push]: https://web.dev/articles/push-notifications-overview
[google-revoke]: https://blog.google/chromium/automatic-notification-permission/
[gmail-senders]: https://support.google.com/a/answer/81126
[yahoo-senders]: https://senders.yahooinc.com/best-practices/
[ftc-canspam]: https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
