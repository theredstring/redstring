# Panel Performance Safeguards

## 🚨 CRITICAL: Preventing Panel Jitter During Pinch Zoom

The Panel component has been optimized to prevent jitter during pinch zoom operations. This optimization is **critical** and must be maintained when making any changes to the Panel.

## What Causes Panel Jitter?

Panel jitter occurs when the component re-renders during pinch zoom operations. This happens because:

1. **Multiple Store Subscriptions**: Each individual `useGraphStore` subscription triggers a re-render when its specific state changes
2. **View State Updates**: Pinch zoom operations update zoom level and pan offset in the store
3. **Cascade Effect**: Store updates → Panel subscriptions trigger → Panel re-renders → Jitter

## Current Optimization Strategy

The Panel uses **individual store subscriptions** (not consolidated ones) because:

- ✅ **Proven Performance**: This pattern has been tested and works perfectly
- ✅ **Zustand Optimization**: Zustand automatically optimizes individual subscriptions
- ✅ **Maintainable**: Easy to add/remove specific store properties

## 🛡️ Safeguards in Place

### 1. Visual Warning Comments
The Panel component now has prominent warning comments:
- ⚠️ **CRITICAL: PANEL PERFORMANCE SAFEGUARD** at the top of subscriptions
- ✅ **END OF STORE SUBSCRIPTIONS** marker
- 🔧 **PROPER PATTERN** examples

### 2. ESLint Rule
A custom ESLint rule (`eslintrc-panel-safeguard.js`) warns about multiple `useGraphStore` calls in Panel.jsx.

### 3. Clear Boundaries
- **Allowed**: Individual subscriptions in the designated section (lines ~3188-3209)
- **Forbidden**: Additional subscriptions outside this section
- **Forbidden**: Consolidated subscriptions (they cause infinite loops)

### 4. Hidden Subscriptions Eliminated
The following hidden subscriptions that were causing jitter have been removed:
- ✅ `const { nodePrototypes } = useGraphStore();` → Now uses `nodePrototypesMap` prop
- ✅ `const { duplicateNodePrototype } = useGraphStore();` → Now passed as prop
- ✅ `const activeGraphId = useGraphStore((state) => state.activeGraphId);` → Now uses prop
- ✅ `const graphs = useGraphStore((state) => state.graphs);` → Now uses `graphsMap` prop

## 📋 Rules for Panel Changes

### ✅ DO:
- Add new store properties to the existing individual subscriptions section
- Add comments explaining why new properties are needed
- Test pinch zoom performance after any changes
- Use the existing pattern: `const newProp = useGraphStore(state => state.newProp);`

### ❌ DON'T:
- Create new consolidated subscriptions
- Add `useGraphStore` calls outside the designated section
- Remove the warning comments
- Ignore pinch zoom performance testing

## 🔍 How to Test

After making any Panel changes:

1. **Build the project**: `npm run build`
2. **Test pinch zoom**: Use two-finger pinch on a touch device or trackpad
3. **Check for jitter**: The Panel should remain completely stable during pinch
4. **Verify smoothness**: Pinch zoom should feel smooth without Panel movement

## 🚨 If Jitter Returns

If Panel jitter returns after changes:

1. **Check for new subscriptions**: Look for additional `useGraphStore` calls
2. **Verify subscription boundaries**: Ensure all subscriptions are in the designated section
3. **Test the fix**: The NodeCanvas optimization should still prevent store updates during pinch
4. **Revert if needed**: If you can't identify the issue, revert to the last working version

## 📚 Related Files

- **Panel.jsx**: Main component with safeguards
- **NodeCanvas.jsx**: Contains pinch zoom optimization logic
- **eslintrc-panel-safeguard.js**: Custom linting rule
- **This file**: Performance safeguard documentation

## 🎯 Key Takeaway

**The Panel's current optimization is working perfectly. Don't change the subscription pattern unless you have a compelling reason and can prove it won't cause jitter.**

When in doubt, follow the existing pattern and test thoroughly.
