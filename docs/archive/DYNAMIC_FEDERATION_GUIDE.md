# Dynamic Federation System Guide

## Overview

The Dynamic Federation System allows users to create their own Redstring Pods using their own domains, eliminating the need for email servers and centralized providers. Each user controls their own domain and URIs, creating a truly decentralized knowledge network.

## Key Features

- **No Email Requirements**: Domain ownership verification via DNS, file upload, or meta tags
- **User-Controlled URIs**: Each user generates URIs from their own domain
- **Dynamic Discovery**: Automatic discovery of other Redstring users across domains
- **Cross-Domain Linking**: RDF-based linking between independently configured Pods
- **Self-Hosted Pods**: Node Solid Server configuration without email requirements

## Architecture

### Domain Ownership Verification

Instead of email verification, the system uses three methods:

1. **DNS Record**: Add TXT record `redstring-verification=verified`
2. **File Upload**: Create `/.well-known/redstring-verification` with content `verified`
3. **Meta Tag**: Add `<meta name="redstring-verification" content="verified">` to website

### URI Generation

Each user's domain generates a complete set of URIs:

```
https://alice.com/redstring/vocab/          # Vocabulary namespace
https://alice.com/redstring/spaces/         # Cognitive spaces
https://alice.com/profile/card#me           # WebID
https://alice.com/.well-known/redstring-discovery  # Discovery file
```

### Cross-Domain References

Users can reference concepts from other domains:

```
alice.com/redstring/vocab/references:bob.net:ClimatePolicy
    ↓ references
bob.net/redstring/vocab/ClimatePolicy
```

## User Setup Guide

### Step 1: Domain Verification

1. Enter your domain in the Federation panel
2. Choose verification method (DNS recommended)
3. Follow the provided instructions
4. Click "Verify Domain" to confirm ownership

### Step 2: Pod Configuration

Once verified, the system automatically generates:
- WebID: `https://yourdomain.com/profile/card#me`
- Pod URL: `https://yourdomain.com/`
- Vocabulary namespace: `https://yourdomain.com/redstring/vocab/`
- Spaces namespace: `https://yourdomain.com/redstring/spaces/`

### Step 3: Node Solid Server Setup

Create a `config.json` file for Node Solid Server:

```json
{
  "serverUri": "https://yourdomain.com",
  "webid": "https://yourdomain.com/profile/card#me",
  "email": false,
  "auth": {
    "type": "oidc",
    "issuer": "https://yourdomain.com",
    "requireEmail": false
  },
  "storage": {
    "type": "file",
    "path": "./data"
  },
  "cors": {
    "origin": ["https://redstring.io", "https://redstring.net"],
    "credentials": true
  }
}
```

### Step 4: Discovery File

Create `/.well-known/redstring-discovery` on your domain:

```json
{
  "version": "1.0",
  "domain": "yourdomain.com",
  "pods": [{
    "domain": "yourdomain.com",
    "webId": "https://yourdomain.com/profile/card#me",
    "podUrl": "https://yourdomain.com/",
    "vocabNamespace": "https://yourdomain.com/redstring/vocab/",
    "spacesNamespace": "https://yourdomain.com/redstring/spaces/",
    "discoveryUrl": "https://yourdomain.com/.well-known/redstring-discovery",
    "custom": true
  }],
  "lastUpdated": "2024-01-01T00:00:00Z",
  "description": "Redstring Pod discovery information"
}
```

## Technical Implementation

### Services

1. **DomainVerificationService**: Handles domain ownership verification
2. **PodDiscoveryService**: Discovers Pods across the network
3. **URIGeneratorService**: Generates dynamic URIs from user domains
4. **DynamicFederation**: UI component for user configuration

### Dynamic URI Generation

The system replaces hardcoded `redstring.io` URIs with user-controlled namespaces:

```javascript
// Before (hardcoded)
"@vocab": "https://redstring.io/vocab/"

// After (dynamic)
"@vocab": "https://alice.com/redstring/vocab/"
```

### RDF Export with User URIs

When exporting cognitive spaces, the system uses the user's domain:

```javascript
const redstringData = exportToRedstring(storeState, userDomain);
```

This generates RDF statements with the user's URIs:

```turtle
@prefix alice: <https://alice.com/redstring/vocab/> .
@prefix bob: <https://bob.net/redstring/vocab/> .

alice:ClimatePolicy alice:influences bob:EconomicImpact .
```

## Federation Network

### Discovery Process

1. **Local Discovery**: Check user's domain for Pod
2. **Well-Known Discovery**: Check `/.well-known/redstring-domains` files
3. **Cross-Reference Discovery**: Follow RDF links between domains
4. **Caching**: Cache discovered Pods for 30 minutes

### Informal Knowledge Pool

Users with domains create an emergent knowledge network:

```
alice.com/redstring/vocab/ClimatePolicy
    ↓ influences
bob.net/redstring/vocab/EconomicImpact  
    ↓ relates_to
charlie.org/redstring/vocab/MarketForces
```

### Cross-Domain Linking

When a user references a concept from another domain:

1. **Reference Creation**: Generate cross-domain reference URI
2. **RDF Statement**: Create RDF statement linking the concepts
3. **Discovery**: Other users can discover the link
4. **Network Growth**: Informal knowledge pool expands

## Benefits

### For Users

- **Sovereignty**: Complete control over domain and data
- **No Barriers**: No email server requirements
- **Flexibility**: Choose any domain and hosting provider
- **Interoperability**: Standard RDF format for sharing

### For the Network

- **Decentralization**: No central authority controls the network
- **Scalability**: Each user adds their own infrastructure
- **Resilience**: Network survives if individual Pods go offline
- **Emergence**: Knowledge connections form organically

## Example Workflow

### Alice Sets Up Her Pod

1. Alice owns `alice.com`
2. She adds DNS record: `redstring-verification=verified`
3. System verifies ownership and generates URIs
4. Alice sets up Node Solid Server on her domain
5. Alice creates cognitive space about climate policy

### Bob Discovers Alice

1. Bob owns `bob.net` and has his own Pod
2. Bob's system discovers Alice's Pod through well-known files
3. Bob sees Alice's climate policy work
4. Bob creates economic impact analysis
5. Bob links his work to Alice's concepts

### Cross-Domain Knowledge Network

```
alice.com/redstring/vocab/ClimatePolicy
    ↓ influences
bob.net/redstring/vocab/EconomicImpact
    ↓ affects
charlie.org/redstring/vocab/MarketForces
    ↓ drives
diana.net/redstring/vocab/PolicyDecisions
```

## Troubleshooting

### Domain Verification Issues

- **DNS Propagation**: DNS changes can take up to 24 hours
- **CORS Issues**: Ensure your domain allows requests from Redstring
- **HTTPS Required**: All verification methods require HTTPS

### Pod Discovery Issues

- **Well-Known Files**: Ensure discovery files are accessible
- **Caching**: Clear discovery cache if Pods aren't found
- **Network Issues**: Check if domains are accessible

### RDF Export Issues

- **URI Generation**: Verify domain is properly normalized
- **Context Generation**: Check JSON-LD context includes user URIs
- **Cross-References**: Ensure reference URIs are properly formatted

## Future Enhancements

### Planned Features

1. **Automatic Pod Setup**: Scripts to automate Node Solid Server deployment
2. **Enhanced Discovery**: Machine learning for concept matching
3. **Visual Network**: Graph visualization of cross-domain connections
4. **Collaborative Editing**: Real-time collaboration across domains

### Integration Possibilities

1. **Academic Networks**: University domains for research collaboration
2. **Corporate Knowledge**: Company domains for internal knowledge management
3. **Open Source Projects**: Project domains for documentation and design
4. **Personal Knowledge**: Individual domains for personal knowledge bases

## Conclusion

The Dynamic Federation System transforms Redstring from a single-application tool into a platform for planetary cognition. By eliminating email requirements and enabling user-controlled domains, it creates a truly decentralized knowledge network where each user maintains sovereignty over their data while contributing to a collective intelligence that emerges through RDF-based linking.

The system scales from a single user to millions, with no central authority controlling the network. Each user's domain becomes a node in an informal knowledge pool that grows organically as users discover and link to each other's work.

This is the foundation for planetary cognition - where individual thinking becomes collective intelligence through the power of semantic web standards and user-controlled infrastructure. 