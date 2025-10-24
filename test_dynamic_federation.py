#!/usr/bin/env python3
"""
Test script for Dynamic Federation System
Tests domain verification, URI generation, and Pod discovery
"""

import json
import requests
from urllib.parse import urlparse
import sys

def test_domain_verification():
    """Test domain verification methods"""
    print("=== Testing Domain Verification ===")
    
    # Test DNS verification
    test_domains = [
        "example.com",
        "redstring.io", 
        "test.invalid"
    ]
    
    for domain in test_domains:
        print(f"\nTesting DNS verification for {domain}:")
        try:
            # Check for TXT record
            response = requests.get(f"https://dns.google/resolve?name={domain}&type=TXT")
            if response.status_code == 200:
                data = response.json()
                if data.get('Answer'):
                    for answer in data['Answer']:
                        txt_record = answer['data'].replace('"', '')
                        if txt_record == 'redstring-verification=verified':
                            print(f"  ✓ Verified via DNS")
                            break
                    else:
                        print(f"  ✗ No verification record found")
                else:
                    print(f"  ✗ No TXT records found")
            else:
                print(f"  ✗ DNS lookup failed")
        except Exception as e:
            print(f"  ✗ Error: {e}")

def test_uri_generation():
    """Test URI generation for different domains"""
    print("\n=== Testing URI Generation ===")
    
    test_domains = [
        "alice.com",
        "bob.net", 
        "charlie.org"
    ]
    
    for domain in test_domains:
        print(f"\nURIs for {domain}:")
        
        # Generate URIs (simulating the JavaScript logic)
        normalized_domain = domain.lower().replace('www.', '')
        
        uris = {
            "vocab": f"https://{normalized_domain}/redstring/vocab/",
            "spaces": f"https://{normalized_domain}/redstring/spaces/",
            "webId": f"https://{normalized_domain}/profile/card#me",
            "pod": f"https://{normalized_domain}/",
            "discovery": f"https://{normalized_domain}/.well-known/redstring-discovery",
            "verification": f"https://{normalized_domain}/.well-known/redstring-verification"
        }
        
        for uri_type, uri in uris.items():
            print(f"  {uri_type}: {uri}")

def test_pod_discovery():
    """Test Pod discovery from well-known files"""
    print("\n=== Testing Pod Discovery ===")
    
    well_known_urls = [
        "https://redstring.io/.well-known/redstring-domains",
        "https://redstring.net/.well-known/redstring-domains"
    ]
    
    for url in well_known_urls:
        print(f"\nChecking {url}:")
        try:
            response = requests.get(url, headers={'Accept': 'application/json'})
            if response.status_code == 200:
                data = response.json()
                if data.get('domains'):
                    print(f"  ✓ Found {len(data['domains'])} domains:")
                    for domain in data['domains']:
                        print(f"    - {domain}")
                else:
                    print(f"  ✗ No domains found")
            else:
                print(f"  ✗ Not found (status: {response.status_code})")
        except Exception as e:
            print(f"  ✗ Error: {e}")

def test_cross_domain_references():
    """Test cross-domain reference generation"""
    print("\n=== Testing Cross-Domain References ===")
    
    source_domain = "alice.com"
    target_domain = "bob.net"
    concept = "ClimatePolicy"
    
    print(f"Source: {source_domain}")
    print(f"Target: {target_domain}")
    print(f"Concept: {concept}")
    
    # Generate cross-domain reference
    normalized_source = source_domain.lower().replace('www.', '')
    normalized_target = target_domain.lower().replace('www.', '')
    normalized_concept = ''.join(c for c in concept if c.isalnum() or c in '-_').lower()
    
    reference_uri = f"https://{normalized_source}/redstring/vocab/references:{normalized_target}:{normalized_concept}"
    target_uri = f"https://{normalized_target}/redstring/vocab/{normalized_concept}"
    
    print(f"Reference URI: {reference_uri}")
    print(f"Target URI: {target_uri}")

def test_json_ld_context():
    """Test JSON-LD context generation"""
    print("\n=== Testing JSON-LD Context Generation ===")
    
    domain = "alice.com"
    normalized_domain = domain.lower().replace('www.', '')
    vocab_uri = f"https://{normalized_domain}/redstring/vocab/"
    
    context = {
        "@version": 1.1,
        "@vocab": vocab_uri,
        "redstring": vocab_uri,
        "Graph": "redstring:Graph",
        "Node": "redstring:Node",
        "Edge": "redstring:Edge",
        "name": "http://schema.org/name",
        "description": "http://schema.org/description",
        "references": "redstring:references",
        "linkedThinking": "redstring:linkedThinking"
    }
    
    print(f"Generated context for {domain}:")
    print(json.dumps(context, indent=2))

def main():
    """Run all tests"""
    print("Dynamic Federation System Tests")
    print("=" * 50)
    
    try:
        test_domain_verification()
        test_uri_generation()
        test_pod_discovery()
        test_cross_domain_references()
        test_json_ld_context()
        
        print("\n" + "=" * 50)
        print("All tests completed!")
        
    except KeyboardInterrupt:
        print("\nTests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nTest failed with error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 