# Retain voting session records until explicit deletion

Ended voting sessions retain their questions, session-scoped guest identities, individual votes, and comments until the presenter explicitly deletes the session. Deletion removes live data and releases the Join Name immediately, while existing backup copies age out through the 14-day backup rotation. This favors complete historical results over automatic data minimization while preventing anonymous identities from linking a participant across separate events.
