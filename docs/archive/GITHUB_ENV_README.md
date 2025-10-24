# GitHub App Environment Configuration

## Quick Setup

1. **Edit `github.env`** with your GitHub App credentials:
   ```bash
   # Copy your .pem file to the project directory
   cp /path/to/your/downloaded/app.private-key.pem ./github-app.private-key.pem
   
   # Edit the configuration file
   nano github.env
   ```

2. **Update the values** in `github.env`:
   - Replace placeholder values with your actual GitHub App credentials
   - Set the correct path to your `.pem` file
   - Choose your deployment target (1=local, 2=gcp, 3=both)

3. **Run the setup script**:
   ```bash
   ./setup-github-app.sh
   ```

## Configuration Options

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_APP_ID` | Your GitHub App ID | `"123456"` |
| `GITHUB_APP_CLIENT_ID` | Your GitHub App Client ID | `"Iv1.abc123def456"` |
| `GITHUB_APP_CLIENT_SECRET` | Your GitHub App Client Secret | `"your_secret_here"` |
| `GITHUB_APP_WEBHOOK_SECRET` | Your webhook secret | `"webhook_secret_here"` |
| `PRIVATE_KEY_PATH` | Path to your .pem file | `"./github-app.private-key.pem"` |
| `GCP_PROJECT_ID` | Google Cloud Project ID (optional) | `"your-project-id"` |
| `DEPLOY_TARGET` | Deployment mode | `"3"` (both local and GCP) |

## Deployment Targets

- **1**: Local development only (creates `.env.github-app`)
- **2**: Google Cloud production only (creates GCP secrets)
- **3**: Both local and Google Cloud (recommended)

## Security Notes

- The `github.env` file is automatically added to `.gitignore`
- Never commit your actual credentials to version control
- The script validates that you've updated the placeholder values
- Private keys are stored securely in Google Cloud Secret Manager

## Troubleshooting

If you get validation errors:
1. Make sure you've updated all placeholder values in `github.env`
2. Verify the path to your `.pem` file is correct
3. Ensure your GitHub App credentials are valid
4. Check that your Google Cloud project is accessible
