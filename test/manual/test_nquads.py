#!/usr/bin/env python3
"""
Test script for Redstring N-Quads export
Analyzes the RDF data structure and content
"""

import sys
import os
import time
from rdflib import Graph, Namespace
from rdflib.namespace import RDF, RDFS, XSD
from collections import defaultdict

def analyze_nquads_file(filename):
    """Analyze an N-Quads file and provide insights about the data"""
    
    if not os.path.exists(filename):
        print(f"❌ File not found: {filename}")
        return
    
    print(f"🔍 Analyzing: {filename}")
    print("=" * 60)
    
    # Get file size info first
    file_size = os.path.getsize(filename)
    print(f"📁 File size: {file_size:,} bytes")
    
    # Count lines quickly
    with open(filename, 'r') as f:
        line_count = sum(1 for _ in f)
    print(f"📄 Lines: {line_count:,}")
    
    # Load the N-Quads file with timeout protection
    g = Graph()
    start_time = time.time()
    
    try:
        print("⏳ Loading N-Quads file...")
        g.parse(filename, format='nquads')
        load_time = time.time() - start_time
        print(f"✅ Successfully loaded {len(g)} triples in {load_time:.2f} seconds")
    except Exception as e:
        print(f"❌ Error loading file: {e}")
        return
    
    print(f"\n📊 Basic Statistics:")
    print(f"   Total triples: {len(g):,}")
    
    # Count unique entities more efficiently
    subjects = set()
    predicates = set()
    objects = set()
    
    print("⏳ Counting unique entities...")
    for s, p, o in g:
        subjects.add(s)
        predicates.add(p)
        objects.add(o)
    
    print(f"   Unique subjects: {len(subjects):,}")
    print(f"   Unique predicates: {len(predicates):,}")
    print(f"   Unique objects: {len(objects):,}")
    
    # Analyze predicates (relationship types)
    print(f"\n🔗 Predicates (Relationship Types):")
    predicates_count = defaultdict(int)
    for s, p, o in g:
        predicates_count[str(p)] += 1
    
    # Show top 10 predicates
    for pred, count in sorted(predicates_count.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"   {pred}: {count:,} occurrences")
    
    # Look for Redstring-specific patterns
    print(f"\n🎯 Redstring-Specific Analysis:")
    
    # Check for node definitions
    node_nodes = set()
    edge_nodes = set()
    graph_nodes = set()
    
    for s, p, o in g:
        s_str = str(s)
        if 'node:' in s_str:
            node_nodes.add(s_str)
        elif 'edge:' in s_str:
            edge_nodes.add(s_str)
        elif 'graph:' in s_str:
            graph_nodes.add(s_str)
    
    print(f"   Node entities: {len(node_nodes):,}")
    print(f"   Edge entities: {len(edge_nodes):,}")
    print(f"   Graph entities: {len(graph_nodes):,}")
    
    # Show some sample triples
    print(f"\n📝 Sample Triples (first 5):")
    for i, (s, p, o) in enumerate(g):
        if i >= 5:
            break
        print(f"   {s} {p} {o}")
    
    # Check for RDF statements (edges) - more efficiently
    print(f"\n🔗 RDF Statements (Edges):")
    statements = []
    for s, p, o in g:
        if str(p) == 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' and str(o) == 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Statement':
            statements.append(s)
    
    print(f"   Found {len(statements):,} RDF Statement entities")
    
    # Show statement details (limit to first 3)
    for stmt in statements[:3]:
        subject = None
        predicate = None
        object_ = None
        name = None
        
        for s, p, o in g:
            if s == stmt:
                if str(p).endswith('#subject'):
                    subject = str(o)
                elif str(p).endswith('#predicate'):
                    predicate = str(o)
                elif str(p).endswith('#object'):
                    object_ = str(o)
                elif str(p).endswith('#name'):
                    name = str(o)
        
        if subject and predicate and object_:
            print(f"   Statement: {subject} --[{predicate}]--> {object_}")
            if name:
                print(f"     Name: {name}")
    
    # Check for abstraction hierarchies
    print(f"\n📈 Abstraction Hierarchies:")
    subClassOf_triples = []
    for s, p, o in g:
        if str(p).endswith('#subClassOf'):
            subClassOf_triples.append((s, o))
    
    print(f"   Found {len(subClassOf_triples)} subClassOf relationships")
    for s, o in subClassOf_triples[:3]:  # Show first 3
        print(f"   {s} is a subclass of {o}")
    
    # Check for blank nodes
    blank_nodes = set()
    for s, p, o in g:
        if str(s).startswith('_:b'):
            blank_nodes.add(s)
        if str(o).startswith('_:b'):
            blank_nodes.add(o)
    
    print(f"\n🔲 Blank Nodes:")
    print(f"   Found {len(blank_nodes):,} unique blank nodes")
    
    print(f"\n✅ Analysis complete!")

if __name__ == "__main__":
    # Look for N-Quads files in current directory
    nq_files = [f for f in os.listdir('.') if f.endswith('.nq')]
    
    if not nq_files:
        print("❌ No .nq files found in current directory")
        print("   Please export an RDF file from Redstring first")
        sys.exit(1)
    
    if len(nq_files) == 1:
        analyze_nquads_file(nq_files[0])
    else:
        print("Found multiple .nq files:")
        for i, f in enumerate(nq_files):
            print(f"   {i+1}. {f}")
        
        try:
            choice = int(input("Enter number to analyze: ")) - 1
            if 0 <= choice < len(nq_files):
                analyze_nquads_file(nq_files[choice])
            else:
                print("Invalid choice")
        except (ValueError, KeyboardInterrupt):
            print("Cancelled") 