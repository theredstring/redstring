# Modal Components

Two reusable modal components that integrate seamlessly with Redstring's viewport system.

## Components

### CanvasModal

Positions content within the canvas viewport area, perfect for canvas-related interactions.

**Features:**
- Positions within canvas viewport bounds
- Canvas-colored background (#bdb5b5)
- Maroon borders (#260000)
- Drop shadow for depth
- Responsive margins
- Multiple positioning options
- Escape key support
- Backdrop click to close

**Usage:**
```jsx
import CanvasModal from './components/CanvasModal';

const MyComponent = () => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <CanvasModal
      isVisible={isVisible}
      onClose={() => setIsVisible(false)}
      title="My Canvas Modal"
      width={400}
      position="center"
      margin={20}
    >
      <div>Your content here</div>
    </CanvasModal>
  );
};
```

**Props:**
- `isVisible` (boolean): Controls modal visibility
- `onClose` (function): Called when modal should close
- `children` (ReactNode): Modal content
- `title` (string): Optional modal title
- `width` (number): Modal width in pixels (default: 400)
- `height` (number|string): Modal height (default: 'auto')
- `position` (string): Position within canvas - 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'
- `margin` (number): Margin from viewport edges (default: 20)
- `className` (string): Additional CSS classes

### PanelModal

Positions content within a panel area (left or right panel).

**Features:**
- Positions within panel viewport bounds
- Canvas-colored background (#bdb5b5)
- Maroon borders (#260000)
- Drop shadow for depth
- Responsive margins
- Panel-specific positioning
- Escape key support
- Backdrop click to close

**Usage:**
```jsx
import PanelModal from './components/PanelModal';

const MyComponent = () => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <PanelModal
      isVisible={isVisible}
      onClose={() => setIsVisible(false)}
      title="My Panel Modal"
      width={320}
      panel="right"
      position="center"
      margin={16}
    >
      <div>Your content here</div>
    </PanelModal>
  );
};
```

**Props:**
- `isVisible` (boolean): Controls modal visibility
- `onClose` (function): Called when modal should close
- `children` (ReactNode): Modal content
- `title` (string): Optional modal title
- `width` (number): Modal width in pixels (default: 320)
- `height` (number|string): Modal height (default: 'auto')
- `panel` (string): Which panel to position in - 'left' or 'right'
- `position` (string): Position within panel - 'top', 'center', 'bottom'
- `margin` (number): Margin from panel edges (default: 16)
- `className` (string): Additional CSS classes

## Viewport Integration

Both modals use the same viewport calculation system as `EdgeGlowIndicator` and `UnifiedSelector`:

- **CanvasModal**: Positions within the central canvas area between left and right panels
- **PanelModal**: Positions within the specified panel area
- Automatically adjusts when panels are expanded/collapsed
- Respects TypeList visibility
- Handles window resizing

## Styling

Both modals use Redstring's design system:
- Canvas background color: `#bdb5b5`
- Maroon borders: `#260000`
- Header background: `#260000`
- Header text: `#bdb5b5`
- Drop shadow: `0 8px 32px rgba(0, 0, 0, 0.3)`

## Responsive Behavior

- Automatically adjusts size and position on window resize
- Ensures modals stay within viewport bounds
- Includes mobile-friendly responsive adjustments
- Supports high contrast mode
- Respects reduced motion preferences

## Dependencies

- `useViewportBounds` hook
- `useGraphStore` for panel state
- React hooks: `useEffect`, `useRef`

## Specialized Modals

### AlphaOnboardingModal

A specialized welcome modal for Redstring's open alpha phase that inherits from CanvasModal.

**Features:**
- Welcome message for Redstring alpha
- Information about current limitations (especially mobile)
- "Don't show again" functionality with localStorage persistence
- Matches Redstring's copy style and design system

**Usage:**
```jsx
import AlphaOnboardingModal from './components/AlphaOnboardingModal';

const MyComponent = () => {
  const [showWelcome, setShowWelcome] = useState(true);

  return (
    <AlphaOnboardingModal
      isVisible={showWelcome}
      onClose={() => setShowWelcome(false)}
      onDontShowAgain={() => {
        // Handle when user chooses not to show again
        console.log('User will not see welcome again');
      }}
    />
  );
};
```

**Props:**
- `isVisible` (boolean): Controls modal visibility
- `onClose` (function): Called when modal should close
- `onDontShowAgain` (function): Optional callback when user chooses not to show again

**Automatic Behavior:**
- Automatically persists "don't show again" preference to localStorage
- Only shows once per browser session unless forcibly displayed
- Uses CanvasModal positioning (center) with optimized width (500px)

## Demo

See `ModalDemo.jsx` for a complete example showing all modals (CanvasModal, PanelModal, and AlphaOnboardingModal) with interactive positioning controls.
