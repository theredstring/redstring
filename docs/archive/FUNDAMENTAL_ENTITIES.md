# Fundamental Entities in Redstring

This document outlines the fundamental, foundational entities that serve as the basis for all knowledge representation in Redstring. These are the core "Things" that everything else builds upon.

## Core Ontological Primitives

### **Thing** 
- **Color**: `#8B0000` (Maroon)
- **Role**: The fundamental base entity from which all other entities inherit
- **Description**: The most general concept - everything that exists is a "Thing"
- **Special Properties**: Cannot be deleted, serves as root of type hierarchy

### **Connection** 
- **Color**: `#000000` (Black)
- **Role**: The fundamental relationship primitive between any two Things
- **Description**: Represents any form of relationship, association, or link
- **Special Properties**: 
  - Bidirectional by default, can have custom directionality
  - Cannot be deleted, serves as root of edge prototype hierarchy
  - Appears in "Browse All Things" alongside node prototypes
  - Has clickable arrow toggles for direction control

## Dimensional Primitives

### **Generalization Axis**
- **Color**: TBD
- **Role**: The default abstraction dimension for organizing hierarchical relationships
- **Description**: Represents the specific → general relationship dimension
- **Usage**: Default dimension for abstraction chains, concept hierarchies

## Planned Fundamental Entities

### **Space**
- **Role**: Fundamental spatial primitive
- **Description**: Represents physical or conceptual space, location, containment

### **Time** 
- **Role**: Fundamental temporal primitive
- **Description**: Represents temporal relationships, sequence, duration, causality

### **Agent**
- **Role**: Fundamental entity with agency
- **Description**: Represents entities that can act, decide, or cause change

### **Process**
- **Role**: Fundamental dynamic primitive
- **Description**: Represents change, transformation, activity over time

### **Property**
- **Role**: Fundamental attribute primitive  
- **Description**: Represents characteristics, qualities, or attributes of Things

### **Quantity**
- **Role**: Fundamental measurement primitive
- **Description**: Represents amounts, numbers, measurements, scales

## Design Principles

1. **Minimal Set**: Keep the number of fundamentals as small as possible while maintaining expressiveness
2. **Universal**: Each fundamental should be applicable across all domains of knowledge
3. **Orthogonal**: Fundamentals should be independent and non-overlapping concepts
4. **Composable**: Complex concepts should emerge from combinations of fundamentals
5. **Extensible**: New domains can extend fundamentals without modifying the core set

## Implementation Notes

- Fundamental entities are defined with standardized colors in `src/constants.js`
- **Thing** is initialized in `src/store/graphStore.jsx` as `base-thing-prototype`
- **Connection** is initialized in `src/store/graphStore.jsx` as `base-connection-prototype`
- Both have deletion protection in their respective `delete*Prototype` functions
- Connection appears in "Browse All Things" panel alongside node prototypes
- They serve as default fallbacks throughout the system
- Cannot be deleted or fundamentally modified by users
- Form the base vocabulary for all knowledge graphs
- Should be carefully considered before adding new ones

## Color Scheme

The fundamental entities use a carefully chosen color palette to be:
- **Distinguishable**: Easy to differentiate visually
- **Meaningful**: Colors that intuitively relate to the concept
- **Accessible**: Work well for users with color vision differences
- **Consistent**: Form a cohesive visual system

Current assignments:
- **Thing**: `#8B0000` (Dark Red/Maroon) - The foundational color
- **Connection**: `#000000` (Black) - Universal, neutral relationship color
