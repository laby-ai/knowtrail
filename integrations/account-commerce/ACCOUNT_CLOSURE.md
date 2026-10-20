# Account closure requests

`GET/POST /v1/lingbi/account-closure` requires a current account session. POST also requires the current password and the literal confirmation `注销账号`; five submission attempts per member are allowed in five minutes. Requests live in the account service's `lingbi_account_closure_requests` table, with a member-unique key and an audit event. Duplicate submissions return the same request.

This is a **review request**, not immediate account deletion. The UI says so before submission and after acceptance. No account, wallet, subscription or research data is removed by this endpoint. Account operations must check pending requests, contact the registered account holder, resolve team ownership, active tasks and financial obligations, and apply the organization's retention/deletion policy before completing closure. There is no automatic approval or invented completion deadline.

For operations, inspect pending requests using the account service's normal authenticated database tooling: `SELECT request_id, member_id, tenant_id, created_at FROM lingbi_account_closure_requests WHERE status='pending_review'`. Do not export passwords, sessions or provider credentials. This change does not add an automated deletion worker or an administrator review screen.

Deploy `lingbi_account_closure.py` together with the corresponding `lingbi_http.py`. They use existing account-service database/authentication libraries. Account passwords are checked in the account service and never stored in the request table. Keep the existing account-service request-body logging restrictions in place.
