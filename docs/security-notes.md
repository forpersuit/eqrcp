# Security Notes

`eqrcp` is designed for short-lived local-network file transfer. It should not be exposed directly to the public internet.

## Current Security Model

The current transfer model relies on:

- A randomly generated URL path by default.
- A local HTTP server that exits after transfer unless `--keep-alive` is set.
- A receive path that writes uploaded files into a chosen directory.
- A send path that serves only the selected file or generated zip.
- Optional HTTPS with user-provided certificate and key.

## Boundaries

This is not a full authentication system.

Anyone who can reach the generated URL can download from or upload to the active transfer endpoint while the server is running.

The random path reduces accidental discovery, but it is not a replacement for authentication when running on an untrusted network.

## Desktop Integration Risks

Desktop right-click sharing makes launching transfers easier, which also makes accidental exposure easier.

Risks to handle:

- User may start a transfer on an untrusted Wi-Fi network.
- User may accidentally choose `--keep-alive`.
- Desktop launch errors may be invisible without a terminal.
- File manager paths may include unusual characters or network paths.
- Receive mode can accept large uploads up to the configured limit.

## Recommendations For Desktop Mode

Desktop mode should:

- Prefer a short-lived one-transfer server by default.
- Open a visible QR page immediately.
- Show the bound address and port clearly.
- Make `keep alive` explicit in the UI or menu label.
- Avoid silently falling back to public or external IP addresses.
- Warn when binding to all interfaces.
- Keep receive output directory explicit.

## HTTPS

HTTPS currently requires a certificate and key:

```sh
eqrcp --secure --tls-cert /path/to/cert.pem --tls-key /path/to/key.pem file.txt
```

For local phone transfers, self-signed or private CA certificates may trigger browser warnings unless the device trusts the CA.

Desktop mode should not enable HTTPS automatically unless certificate configuration is already valid.

## Future Hardening Options

Possible future improvements:

- Optional one-time PIN displayed next to the QR code.
- Optional upload confirmation before writing files.
- Smaller default upload limit for desktop receive mode.
- Clear warning when listening on `0.0.0.0`.
- Explicit allowlist of local network interfaces.
- Dedicated local status page with a stop button.
