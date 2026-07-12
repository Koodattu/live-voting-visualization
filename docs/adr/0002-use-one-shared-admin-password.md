# Use one shared admin password

The deployment uses one shared password to grant full Admin Panel access, with no usernames, individual accounts, or per-session ownership. The password is supplied as an uncommitted deployment environment secret and cannot be changed through the application; changing it invalidates every existing Admin Session. This favors a simple tool for one trusted person or team over isolating independent organizers; anyone with the password can manage every voting session.
