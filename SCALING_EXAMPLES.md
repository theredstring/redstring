# Auto-Scaling Examples

## Visual Guide to Node Count Scaling

### Small Graph (5 nodes)
```
Scale: 1.0× | Distance: 400px

    O-----O
    |     |
    O  O  O
    
Compact and readable
```

### Medium Graph (20 nodes)
```
Scale: 1.4× | Distance: 560px

O     O     O     O
  
  O     O     O
  
O     O     O     O

  O     O     O

O     O     O     O

    O     O     O

More breathing room
```

### Large Graph (50 nodes)  
```
Scale: 1.9× | Distance: 760px

O       O       O       O       O

    O       O       O       O

O       O       O       O       O

    O       O       O       O

O       O       O       O       O

(... 30 more nodes with generous spacing)

Very spacious, no overlap
```

## Cluster Separation Examples

### 2 Disconnected Clusters (10 nodes each)
```
Node scale: 1.15×
Cluster scale: 1.09×
Total: 1.25×

       Cluster A              Cluster B
    O-----O-----O          O-----O-----O
    |     |     |          |     |     |
    O-----O-----O          O-----O-----O
    |     |     |          |     |     |
    O-----O-----O          O-----O-----O

    <-- 750px gap -->

Clusters stay separated
```

### 5 Disconnected Clusters (5 nodes each)
```
Node scale: 1.0× (small clusters)
Cluster scale: 1.21×
Total: 1.21×

         Cluster A
           O---O
           |   |
           O---O
             |
             O

  Cluster E       Cluster B
    O   O           O
     \ /           / \
      O           O---O
       \
        O

  Cluster D       Cluster C
    O---O         O---O
    |   |         |   |
    O---O         O---O

Each cluster gets its own space
```

## Scale Preset Interaction

### Balanced Preset (400px base)
```
Nodes | Auto Scale | Final Distance
------|------------|---------------
5     | 1.0×       | 400px
10    | 1.15×      | 460px
20    | 1.4×       | 560px
50    | 1.9×       | 760px
```

### Spacious Preset (550px base)
```
Nodes | Auto Scale | Final Distance
------|------------|---------------
5     | 1.0×       | 550px
10    | 1.15×      | 633px
20    | 1.4×       | 770px
50    | 1.9×       | 1045px
```

### User Slider at 2.0×
```
Nodes | Auto Scale | User Mult | Final Distance
------|------------|-----------|---------------
5     | 1.0×       | 2.0×      | 800px
10    | 1.15×      | 2.0×      | 920px
20    | 1.4×       | 2.0×      | 1120px
50    | 1.9×       | 2.0×      | 1520px
```

## Real-World Scenarios

### Scenario 1: Importing a Small Ontology
- **Input**: 8 concepts, fully connected
- **Auto scale**: 1.09×
- **Cluster scale**: 1.0× (single cluster)
- **Result**: ~435px distances, compact and readable

### Scenario 2: Knowledge Graph (Medium)
- **Input**: 25 nodes, 3 disconnected clusters
- **Auto scale**: 1.53× (from nodes)
- **Cluster scale**: 1.14× (from clusters)
- **Result**: ~700px distances, clusters well-separated

### Scenario 3: Large Import (Wikipedia data)
- **Input**: 80 nodes, 15 disconnected clusters
- **Auto scale**: 2.18× (from nodes)
- **Cluster scale**: 1.35× (from clusters)
- **Result**: ~1175px distances, extremely spacious

### Scenario 4: Generated Test Graph
- **Input**: 10 nodes, 2 clusters (Auto Graph Generator)
- **Auto scale**: 1.15× (from nodes)
- **Cluster scale**: 1.09× (from clusters)
- **Result**: ~500px distances, immediately looks good

## Comparison: Before vs After

### Before Auto-Scaling

**5 nodes**: Too spread (400px)
```
O           O           O
                              ← Empty space
        O       O
```

**50 nodes**: Cramped (400px)
```
OOOOOOO
OOOOOOO  ← Overlapping!
OOOOOOO
```

### After Auto-Scaling

**5 nodes**: Compact (400px, same)
```
O-----O-----O
|           |
O-----O
```

**50 nodes**: Spacious (760px, 1.9×)
```
O    O    O    O    O

  O    O    O    O

O    O    O    O    O

(... clear spacing throughout)
```

## Testing Your Graph

After auto-layout runs, check:

1. **Can you read all labels?** ✅ Should be clear
2. **Are edges visible?** ✅ Should see connections
3. **Do clusters overlap?** ❌ Should be separated
4. **Does it use ~60-80% of canvas?** ✅ Good fill
5. **Can you click individual nodes?** ✅ Not too dense

If any check fails, adjust the layout scale slider!

