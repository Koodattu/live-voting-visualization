# Live Voting

The domain of running anonymous, presenter-led voting sessions for a live audience.

## Language

**Voting Session**:
A presenter-led live activity containing an ordered set of questions and one current state shared by its participants. Each voting session is controlled independently from every other session.
_Avoid_: Event, poll

**Draft Session**:
A voting session being prepared by a presenter. Its questions and options are editable, and participants cannot discover or join it.
_Avoid_: Inactive session

**Live Session**:
A voting session that the presenter has started but not ended. Its questions and options are fixed; it remains publicly discoverable and joinable, new participants enter its current state, and it cannot be deleted until it ends.
_Avoid_: Active session

**Lobby**:
The initial state of a live session before its first question opens. Participants may join while the presenter controls and presentation display show the Join Name, link, QR code, and cumulative number of joined guest identities.
_Avoid_: Waiting state, QR screen

**Ended Session**:
A voting session that the presenter has permanently finished while no question was open. It is absent from the homepage but its Session Results remain public to anyone with its Join Name. Session Results include every presented question; any unshown questions remain available only to the presenter. All questions, guest identities, and responses remain stored until explicit deletion. The session cannot be restarted, but its questions may be duplicated into a new draft session.
_Avoid_: Inactive session

**Presenter**:
The password-authorized person who prepares and runs voting sessions. Presenters have no individual accounts or session ownership boundaries.
_Avoid_: Admin, host

**Admin Session**:
A 24-hour authenticated browser session created by entering the shared admin password. It survives browser restarts and grants access to every voting session until logout, expiry, or a configured password change.
_Avoid_: Admin account, presenter account

**Participant**:
An unauthenticated audience member who joins a voting session and responds to its open question.
_Avoid_: User, voter

**Guest Identity**:
An anonymous identity unique to one participant within one immutable voting-session identity. It persists in the same browser while that session exists, distinguishes responses without linking the participant across separate sessions, and does not represent an account. Deleting a session invalidates its guest credentials even if a new session later reuses the same Join Name.
_Avoid_: Account, user profile, global voter ID

**Join Name**:
A presenter-chosen, human-readable identifier used in a voting session's public link. It is 3–24 ASCII lowercase letters (`a-z`), numbers (`0-9`), or hyphens, is case-insensitive, and remains uniquely reserved until that session is deleted.
_Avoid_: Shortname, slug, join code

**Session Language**:
The presenter's choice of Finnish or English for a voting session's built-in participant and presentation text. Authored questions, options, and comments are not translated.
_Avoid_: Locale, content language

**Question**:
An ordered prompt within a voting session. It is either a single-choice question or a feedback question.
_Avoid_: Poll

**Unshown Question**:
A configured question that has never been presented or opened. It has no responses and is omitted from participant-facing results if the session ends early.
_Avoid_: Skipped question

**Single-choice Question**:
A question answered by selecting exactly one of its two to five options.
_Avoid_: Multiple-choice question, poll

**Feedback Question**:
A question answered with one short anonymous comment. A voting session may contain at most one, and it must be last.
_Avoid_: Free-form question, open question

**Presented Question**:
The question currently selected by the presenter for shared presentation. It may be open for voting or closed with only its final results shown on the presentation display.
_Avoid_: Current question, active question

**Open Question**:
The presented question currently accepting participant input. A voting session has at most one open question.
_Avoid_: Current question, active question

**Closed Question**:
A question that permanently no longer accepts participant input. The presenter may revisit it but cannot reopen it; during a live session, the participant view shows it read-only without results.
_Avoid_: Previous question

**Option**:
One selectable choice belonging to a single-choice question.
_Avoid_: Answer, choice

**Vote**:
A participant's selected option for a single-choice question. It may be changed while that question is open, with only the latest selection stored and counted, and becomes final when the question closes.
_Avoid_: Answer, response

**Result**:
The aggregate distribution of votes across a single-choice question's options, expressed as percentages of votes cast and as raw counts. While the question is open, participation compares responses with Guest Identities joined so far. Closing freezes the participation denominator at the Guest Identities joined by that moment and makes the Result final.
_Avoid_: Chart, votes

**Session Results**:
The public end-state collection for a voting session. It contains the final Result for every presented single-choice question and the Comments from a presented feedback question unless the Comment Wall was hidden when the session ended. It omits every unshown question.
_Avoid_: Complete results, result history

**Comment**:
A participant's anonymous plain-text response to a feedback question, limited to 160 characters. It appears automatically on the comment wall without moderation, may be changed while the question is open with only the latest text stored, and becomes final when the question closes.
_Avoid_: Vote, message, chat

**Comment Wall**:
The live collection of comment bubbles on the presentation display. It keeps a bounded rotating set of recent bubbles visible while retaining every Comment. The presenter may hide or reveal the entire wall without moderating individual comments; if hidden when the session ends, comments remain absent from Session Results but available to the presenter.
_Avoid_: Chat, comment feed

**Admin Panel**:
The password-protected workspace where a presenter prepares voting sessions and controls them while live.
_Avoid_: Admin view

**Presenter Controls**:
The live-session controls within the Admin Panel used to start and end the session, close the open question, move Previous or Next through adjacent ordered questions, and hide or reveal the comment wall. Previous, Next, and End are unavailable while a question is open.
_Avoid_: Presenter view, presenter mode

**Presentation Display**:
The public, read-only projected surface showing joining instructions, the presented question, and its live or final Result or Comment Wall. When the session ends, it remains on the final presented state while Participant Views switch to Session Results.
_Avoid_: Audience display, presenter screen, big screen, projector view

**Display Theme**:
The presenter's live choice of a light or dark appearance synchronized across a voting session's presentation displays. It does not change participant or admin appearance.
_Avoid_: App theme, color scheme

**Participant View**:
The public voting surface used by a participant on their own device. During a live session it shows the synchronized question and response controls without Results, restoring that Guest Identity's latest response after refresh or reconnect. After the session ends it shows the Session Results.
_Avoid_: Audience screen, participant screen
