# Upload gateway configuration

Install `lingbi-upload-location.conf` as
`/etc/nginx/snippets/lingbi-upload-location.conf` and include it once inside
each Lingbi server block, before the existing `/lingbi` locations. Run
`nginx -t` before reloading. Back up modified configuration files first.

Only `/api/upload` and `/lingbi/api/upload` receive the 128 MiB request
limit and 300 second proxy timeouts. This accommodates the application’s
five-file batch limit with a 25 MiB per-file limit plus multipart overhead.
Application authentication and per-file validation remain unchanged.
Do not increase unrelated API limits or rebuild the frontend for this change.

## HTTPS renewal

The existing acme.sh renewal for `airai.world` and `www.airai.world` uses
`/var/www/stoneai` as its webroot. The port 80 ACME challenge location must
explicitly set `root /var/www/stoneai;`; the website's release directory is
not the renewal webroot. Preserve the existing certificate/key install
destinations and nginx reload hook. Never commit private keys.

## Regression checks

- Verify public HTTPS without disabling certificate validation.
- Send an 11 MiB diagnostic body to both upload paths: before the change
  nginx returned 413; after the change the application returned its JSON
  400 “没有上传文件” response. No document is created by this probe.
- Check invalid bearer credentials still receive an authentication error.
- Check nginx and knowtrail services stay active.
- A gateway probe does not prove a real Safari file upload succeeded;
  verify that separately on the affected Mac.

Rollback by restoring the backed-up nginx files, validating configuration,
and reloading nginx. No user data migration is involved.
