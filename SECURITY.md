# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in Redstring, please report it responsibly:

1. **DO NOT** create a public GitHub issue
2. Email security details to: [security@theredstring.com](mailto:security@theredstring.com)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Security Considerations

- **Cloud Build**: The `cloudbuild*.yaml` files contain deployment configurations. Only trusted contributors should modify these.
- **Environment Variables**: Never commit real API keys or secrets. Use placeholder values.
- **Dependencies**: Keep all dependencies updated to latest secure versions.
- **Authentication**: GitHub App credentials should be stored securely and not committed.

## Response Timeline

- **Critical vulnerabilities**: 24-48 hours
- **High severity**: 1 week  
- **Medium/Low severity**: 2-4 weeks

Thank you for helping keep Redstring secure!
