# Contributing

Stacksmith is early. The current priority is a stable control-plane foundation before broad provider automation.

## Development

```bash
npm install
npm run check
npm test
npm run build
```

Use `npm run dev -- <command>` while developing the CLI.

## Provider Adapter Rules

Every provider should implement the same lifecycle:

- `inspect`: read current local/provider state without mutating anything.
- `plan`: produce explicit changes and risk levels.
- `apply`: execute planned changes only.
- `health`: report readiness in a normalized shape.

Provider implementations must not print or persist secrets. Store provider identifiers in `.stacksmith/state.json`; write secrets directly to the target secret store once real adapters exist.

## Safety

Any operation that can buy a domain, change production DNS, delete data, rotate secrets, or affect live payments must be represented as a high-risk planned change and require explicit confirmation.
