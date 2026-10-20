# Account-bound model providers

The existing account-service encrypted profile table remains authoritative. No new key store or schema is introduced. One active profile per account/application is retained: saving a provider replaces that profile. Old requests without `provider_id` still mean Bailian. Existing rows are unchanged until the owner saves a replacement.

Preset endpoint/model pairs are server-controlled; clients cannot supply arbitrary destinations. Public responses expose only a mask. The existing signed internal resolver decrypts keys. Non-Bailian profiles are restricted to KnowTrail when resolving; legacy other-application consumers cannot receive an incompatible provider key.

Supported presets: Bailian (existing defaults preserved), Kimi China platform (`kimi-k3`), DeepSeek (`deepseek-flash`). Kimi sampling parameters are omitted per official constraints. Kimi and DeepSeek presets do not advertise image generation or TTS; those BYOK operations are rejected before execution, without platform fallback. Saving from Lingbi also enables the account's BYOK preference; failure to activate is shown separately from successful encrypted storage. Removing a profile does not automatically enable paid platform calls.

Sources verified 2026-10-20:

- [Kimi official quick start](https://platform.kimi.com/docs/get-api-key)
- [Kimi model parameter constraints](https://platform.kimi.com/docs/api/models-overview)
- [DeepSeek official API](https://api-docs.deepseek.com/)

Deploy `server_member_provider_keys.py` to the account service only after backing up the previous file and verifying the expected source checksum. Compile with the account service's Python environment, restart the service, and check account and commerce health. Roll back the file if health fails. Existing encryption environment, database and model credentials must remain untouched.

Validation: `pnpm exec tsx scripts/test-model-providers.ts` uses stub upstreams, checks each provider's actual request destination/key/model, and ensures server-platform configuration cannot override BYOK. Isolated account-service HTTP tests verify encryption/decryption, public redaction, invalid-provider rejection and signed resolver access. Browser tests exercise selection, saving, refresh, masking, BYOK activation and responsive layout. These tests do not establish that a customer's key has balance or model access; real provider calls require that customer's valid API key.
