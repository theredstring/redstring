#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔧 GitHub OAuth Setup for Redstring UI React\n');

// Check if .env file exists
const envPath = path.join(__dirname, '.env');
const envExists = fs.existsSync(envPath);

if (envExists) {
  console.log('⚠️  .env file already exists. Please check your configuration.');
  console.log('   Make sure you have set:');
  console.log('   - VITE_GITHUB_CLIENT_ID');
  console.log('   - GITHUB_CLIENT_ID');
  console.log('   - GITHUB_CLIENT_SECRET\n');
} else {
  console.log('📝 Creating .env file...');
  
  const envContent = `# GitHub OAuth Configuration
# Create a GitHub OAuth App at: https://github.com/settings/developers
# Set the Authorization callback URL to: http://localhost:4000/oauth/callback

# Server-side OAuth credentials (for token exchange)
GITHUB_CLIENT_ID=your-github-client-id-here
GITHUB_CLIENT_SECRET=your-github-client-secret-here

# Frontend OAuth client ID (for initial redirect)
VITE_GITHUB_CLIENT_ID=your-github-client-id-here

# Server Configuration
PORT=4000
`;

  fs.writeFileSync(envPath, envContent);
  console.log('✅ .env file created!\n');
}

console.log('📋 Next steps:');
console.log('1. Go to https://github.com/settings/developers');
console.log('2. Click "New OAuth App"');
console.log('3. Fill in:');
console.log('   - Application name: Redstring UI React');
console.log('   - Homepage URL: http://localhost:4000');
console.log('   - Authorization callback URL: http://localhost:4000/oauth/callback');
console.log('4. Copy the Client ID and Client Secret');
console.log('5. Update your .env file with the real values');
console.log('6. Run: npm run dev:full');
console.log('7. Test OAuth at http://localhost:4000\n');

console.log('🔗 For detailed instructions, see: setup-oauth.md'); 