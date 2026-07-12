# Live Voting v1 Product Brief

## Purpose

Live Voting is a lightweight presenter-led polling application for talks and events. Participants join without accounts, answer the one Question currently open, and remain synchronized with the Presenter. The Presentation Display shows live results to the room.

## Product surfaces

- **Homepage** lists only Live Sessions. A Participant can tap one to join.
- **Participant View** is available at `/{joinName}`. It shows the Lobby, the synchronized Question and response controls during the session, and Session Results after the session ends.
- **Presentation Display** is available publicly at `/{joinName}/display`. It is read-only and contains no administrative controls.
- **Admin Panel** is password-protected and contains session setup, history, exports, deletion, and all Presenter Controls.

Hiding live Results from the Participant View is a normal UX rule, not an access-control boundary. Anyone may deliberately open the public Presentation Display.

## Access and identity

- One deployment-wide password grants access to the entire Admin Panel. There are no usernames, Presenter accounts, or ownership boundaries.
- The password is supplied through an uncommitted server environment file or deployment secret. An Admin Session lasts 24 hours, survives browser restarts, and supports explicit logout.
- Changing the configured password invalidates every existing Admin Session.
- Participants are anonymous. The server issues a Guest Identity and session-scoped secret for each browser and Voting Session.
- A Guest Identity survives refreshes, reconnects, and browser restarts, but never links a Participant across Voting Sessions.
- Guest credentials bind to an immutable internal session identity, not its Join Name. Deleting a session invalidates those credentials even if its Join Name is reused.
- One response is enforced per Guest Identity and Question. Deliberately creating a new browser identity can bypass this; stronger person-level enforcement is out of scope.

## Session setup and discovery

- A Draft Session has a title, Finnish or English Session Language, a unique Join Name, and an ordered Question set.
- Join Names are Presenter-chosen, 3–24 characters, case-insensitive, normalized to lowercase, and limited to ASCII `a-z`, `0-9`, and hyphens. System route names are reserved.
- A Join Name remains unavailable until its session is explicitly deleted.
- Questions and Options may be edited and reordered only while the session is a Draft.
- A Draft requires at least one valid Question before it can start.
- Starting freezes the entire Question set and enters the Lobby.
- Multiple Voting Sessions may be live simultaneously and independently.

## Question types

### Single-choice Question

- Contains 2–5 short, ordered Options.
- Presets may create Yes/No or five-point agreement Options, but they use the same generic model as custom Options.
- A Participant selects exactly one Option and may change it while the Question is open.
- Only the latest Vote is stored and counted. It becomes final when the Question closes.

### Feedback Question

- Optional; at most one may exist and it must be last.
- Accepts one anonymous, plain-text Comment per Participant, limited to 160 characters.
- The Participant may edit the Comment while the Question is open; only the latest text is stored.
- Comments appear immediately as floating bubbles on the public Comment Wall without individual moderation. A bounded set of recent bubbles rotates on screen while every Comment remains stored.
- Presenter Controls can hide or reveal the entire Comment Wall. If hidden when the session ends, Comments stay hidden from Session Results but remain in Admin and exports.

Multi-select, ranking, numeric rating, long text, and additional Question types are out of scope for v1.

## Live-session flow

1. **Lobby:** the Presentation Display shows the title, Join Name, direct link, QR code, and cumulative number of joined Guest Identities. Participant Views wait in sync.
2. **Open Question:** from the Lobby, the Presenter opens the first Question. Participant Views show response controls without Results. The Presentation Display shows the Question and live Result or Comment Wall.
3. **Close:** after a brief confirmation, the Presenter explicitly and irreversibly closes the Question. Responses become final while the same Question remains large for discussion.
4. **Navigate:** Previous and Next move exactly one position through configured order. Selecting an already presented Question shows it Closed; it never reopens. From the furthest presented Closed Question, Next opens the adjacent Unshown Question immediately. Navigation never skips intervening Questions.
5. **End:** after a confirmation, the Presenter may end once no Question is open, including before every configured Question was shown. Ending is permanent.

Previous, Next, and End are disabled and rejected by the server while a Question is Open; the Presenter must Close it first. All Participant Views and Presentation Displays follow Presenter navigation. During a Live Session, a revisited Closed Question remains read-only in Participant Views and does not reveal Results there. Refreshing or reconnecting restores the Guest Identity's latest Vote or Comment for the Open or revisited Question.

Multiple authenticated Admin browsers may control one Live Session. Presenter commands carry an expected control revision, and stale or duplicate transitions are rejected. Vote and Comment submissions are independent idempotent upserts for one Guest Identity and Question; they validate that the Question is Open but do not contend on the control revision.

## Results and presentation

- Single-choice Results use one horizontal bar-chart design.
- Every bar shows percentage prominently and raw Vote count secondarily. The Question also shows the response count.
- Percentages use Votes cast as their denominator. While a Question is Open, participation compares responses with Guest Identities joined so far. Closing freezes that denominator, so later arrivals do not reduce past response rates.
- The current Question occupies the main visual focus. The immediately previous Closed Question and its final Result remain in a compact, muted strip above it.
- Advancing moves the current Question gently into the previous strip while the next Question enters the main position.
- The Presenter may toggle all Presentation Displays for the Voting Session between Light and Dark themes. Participant and Admin views follow their own device preferences.
- Dynamic numbers use fixed-width numerals, headings wrap cleanly, and motion respects reduced-motion preferences.

## Ended Sessions

- Ended Sessions disappear from the homepage but remain public at `/{joinName}` until deletion.
- Anyone with the Join Name can view the Session Results. Unshown Questions remain Admin-only.
- On End, Participant Views switch to the Session Results. The Presentation Display stays on the final presented Question and its final Result or Comment Wall; if no Question was presented, it shows a simple completion screen.
- Ended Sessions cannot restart. Their Question set can be duplicated into a new Draft with a new Join Name and no responses.
- Admin may export final responses as CSV with Question, Option or Comment, Guest Identity, creation time, and last-update time. Export neutralizes spreadsheet-formula prefixes in authored text.
- A Live Session cannot be deleted. Deleting an Ended Session requires typing its Join Name; an unused Draft uses a normal confirmation.
- Deletion removes live data immediately and releases the Join Name. Existing backup copies age out within 14 days.

## Reliability and operations

- Reliability target: 100 concurrent Participants per Live Session. Stretch/load-test goal: 500.
- Presenter state and response updates should reach connected clients within one second at the reliability target.
- SQLite is authoritative. Every connection or unrecovered reconnect receives a fresh versioned snapshot.
- Votes, Comments, and Presenter commands are acknowledged, idempotent, and validated against current server state.
- The server backs up SQLite daily, retains 14 days, and creates a backup before migrations. Production backups use a separately mounted destination.
- Login, Guest Identity issuance, and response writes use burst rate limits sized for many Participants behind one venue network. Admin cookies are secure, HTTP-only, same-site cookies. User text is always treated as plain text.
- Version one assumes a cooperative event audience. It has no CAPTCHA or person-level vote enforcement, so public counts and Comments are not resistant to determined manipulation.
- A separate backup mount does not by itself protect against loss of the host. Operators requiring host-loss recovery must map it to independent or off-host storage.

## Technical shape

- TypeScript end to end.
- React and Vite SPA with React Router, served by the application server.
- Node.js 24 LTS and Fastify 5.
- Socket.IO rooms for live synchronization.
- Embedded SQLite via `better-sqlite3`, prepared SQL, small typed repositories, and immutable numbered migrations; no ORM.
- One production Docker image and Docker Compose configuration; no serverless deployment and no separate SQLite container.
