# Debounce Fix - Summary

## Problem

When typing in any search bar or input that updates a node's name, the semantic discovery system was **querying SPARQL endpoints on EVERY keystroke**:

```
User types: "S"     → SPARQL query fired
User types: "So"    → SPARQL query fired
User types: "Son"   → SPARQL query fired
User types: "Soni"  → SPARQL query fired
User types: "Sonic" → SPARQL query fired
```

This caused:
- **5+ simultaneous queries** for a simple search
- **SPARQL endpoint throttling/blocking**
- **Slow UI performance**
- **Wasted bandwidth and server resources**

---

## Solution

Added **800ms debouncing** to the ConnectionBrowser component:

```javascript
// Before: Query fires immediately on nodeData.name change
useEffect(() => {
  loadSemanticConnections();
}, [nodeData?.name]);

// After: Wait 800ms after user stops typing
useEffect(() => {
  setIsDebouncing(true);

  const debounceTimer = setTimeout(() => {
    setIsDebouncing(false);
    loadSemanticConnections();
  }, 800);

  return () => clearTimeout(debounceTimer);
}, [nodeData?.name]);
```

---

## How It Works Now

```
User types: "S"     → Start 800ms timer, show "Waiting..."
User types: "So"    → Cancel previous timer, restart 800ms timer
User types: "Son"   → Cancel previous timer, restart 800ms timer
User types: "Soni"  → Cancel previous timer, restart 800ms timer
User types: "Sonic" → Cancel previous timer, restart 800ms timer
                    ↓
[User stops typing for 800ms]
                    ↓
Query fires ONCE for "Sonic" → Show "Loading connections..."
```

---

## Visual Feedback

### During Debounce (0-800ms after typing stops)
```
┌─────────────────────────────────────────┐
│ Semantic Web                      [▼]  │
├─────────────────────────────────────────┤
│   ⟳  Waiting for input to stabilize... │
└─────────────────────────────────────────┘
```

### After Debounce (Query in progress)
```
┌─────────────────────────────────────────┐
│ Semantic Web                      [▼]  │
├─────────────────────────────────────────┤
│   ⟳  Loading connections from           │
│      semantic web...                    │
└─────────────────────────────────────────┘
```

### Results Loaded
```
┌─────────────────────────────────────────┐
│ Semantic Web              18 connections│
├─────────────────────────────────────────┤
│ Sonic → developed by → Sega      [90%] │
│ Sonic → genre → Platform game    [85%] │
│ ...                                     │
└─────────────────────────────────────────┘
```

---

## Technical Details

### State Management
```javascript
const [isDebouncing, setIsDebouncing] = useState(false);
const [isLoadingSemanticWeb, setIsLoadingSemanticWeb] = useState(false);

// Combined loading state
const isLoading = isLoadingSemanticWeb || isDebouncing;
```

### Debounce Timing
- **800ms delay** - Optimal balance between:
  - **Too short (200-400ms)**: Still fires multiple queries
  - **Just right (800ms)**: User feels responsive, saves queries
  - **Too long (1500ms+)**: Feels sluggish

### Cleanup
```javascript
return () => {
  clearTimeout(debounceTimer); // Cancel pending query if name changes
};
```

---

## Performance Impact

### Before Debouncing:
```
Typing "Sonic the Hedgehog" (20 characters):
- 20 SPARQL queries fired
- 20 x 3-8 seconds = 60-160 seconds total query time
- Most queries aborted/wasted
- SPARQL endpoints may throttle/block
```

### After Debouncing:
```
Typing "Sonic the Hedgehog" (20 characters):
- 1 SPARQL query fired (after typing stops)
- 1 x 3-8 seconds = 3-8 seconds total
- Clean, efficient
- No throttling issues
```

**Improvement: 95% reduction in queries**

---

## User Experience

### What Users See:

1. **Start typing** → Immediate "Waiting..." feedback
2. **Keep typing** → Timer keeps resetting (no queries)
3. **Stop typing** → After 800ms, switches to "Loading..."
4. **Query completes** → Results appear

### What Users Notice:

✅ **No lag while typing** - UI stays responsive
✅ **Clear feedback** - Know when it's debouncing vs loading
✅ **Faster overall** - Only one query fires instead of many
✅ **No throttling** - SPARQL endpoints aren't overwhelmed

---

## Edge Cases Handled

### 1. Quick Name Changes
```javascript
// If user changes name before debounce completes:
useEffect(() => {
  return () => clearTimeout(debounceTimer); // Old query cancelled
}, [nodeData?.name]);
```

### 2. Empty Names
```javascript
if (!nodeData?.name || nodeData.name.trim() === '') {
  setSemanticConnections([]);
  setIsDebouncing(false);
  return; // No query
}
```

### 3. Switch Away During Debounce
```javascript
// Cleanup function cancels pending queries
return () => clearTimeout(debounceTimer);
```

---

## Testing

### Test 1: Verify Debouncing Works
```
1. Select a node
2. Go to "Semantic Web" tab
3. Rapidly type in search: "S-o-n-i-c"
4. Check console logs

Expected: Only 1 query fires (for "Sonic")
Previous: 5+ queries fire
```

### Test 2: Verify Visual Feedback
```
1. Start typing
2. Should see "Waiting for input to stabilize..."
3. Stop typing for 800ms
4. Should switch to "Loading connections..."
5. Results appear

Expected: Smooth transition through states
```

### Test 3: Verify Cleanup
```
1. Start typing "Sonic"
2. Before debounce completes (< 800ms), change to "Mario"
3. Check console

Expected: Only "Mario" query fires, "Sonic" cancelled
Previous: Both queries might fire
```

---

## Configuration

To adjust debounce timing, edit line 337 in `ConnectionBrowser.jsx`:

```javascript
const debounceTimer = setTimeout(() => {
  // ...
}, 800); // Change this value (in milliseconds)
```

**Recommended values:**
- **500ms** - Faster, but may still fire extra queries
- **800ms** - Default, good balance ✅
- **1000ms** - Slower, saves more queries but feels less responsive

---

## Files Modified

- **`src/components/ConnectionBrowser.jsx`**
  - Line 287: Added `isDebouncing` state
  - Line 324-422: Added debounce logic to semantic query useEffect
  - Line 589: Combined loading states
  - Line 636: Added debounce message

---

## Console Output

### Before (5 queries for "Sonic"):
```
[ConnectionBrowser] Discovering connections for: "S"
[ConnectionBrowser] Discovering connections for: "So"
[ConnectionBrowser] Discovering connections for: "Son"
[ConnectionBrowser] Discovering connections for: "Soni"
[ConnectionBrowser] Discovering connections for: "Sonic"
```

### After (1 query for "Sonic"):
```
[ConnectionBrowser] Discovering connections for: "Sonic"
```

---

## Future Improvements

1. **Cache results** - Don't re-query same entity
2. **Abort in-flight requests** - Cancel if new query starts
3. **Progressive results** - Show partial results while loading
4. **Configurable debounce** - Let users adjust timing

---

## Summary

**Problem**: Queries fired on every keystroke
**Solution**: 800ms debounce with visual feedback
**Impact**: 95% reduction in queries, better UX

Now you can type freely without hammering the SPARQL endpoints! 🎉
