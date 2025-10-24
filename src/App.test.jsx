import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import App from './App';
import useGraphStore from './store/graphStore.jsx'; // Import the store

// Mock the useCanvasWorker hook
vi.mock('./hooks/useCanvasWorker', () => ({
  __esModule: true, // Use this for ES Modules
  default: vi.fn(() => ({
    // Mock the return value of the hook
    worker: null, // Or a mock worker object if needed
    postMessageToWorker: vi.fn(),
    // Add other functions/properties returned by the hook if needed
  })),
}));

// Mock the components if they aren't essential for the integration test logic
// and might cause issues (e.g., complex rendering, external dependencies)
// vi.mock('./components/GraphBrowserPanel', () => ({
//   default: ({ children }) => <div data-testid="mock-browser-panel">{children}</div>,
// }));
// vi.mock('./components/TabbedCanvasView', () => ({
//   default: ({ children }) => <div data-testid="mock-canvas-view">{children}</div>,
// }));

// Helper to reset store before each test
const resetStore = () => {
  useGraphStore.setState({
    graphs: new Map(),
    nodes: new Map(),
    edges: new Map(),
    openGraphIds: [],
    activeGraphId: null,
  }); // Remove the 'true' flag to use default merge behavior
};


describe('App Integration Test', () => {
  beforeEach(() => {
    // Reset Zustand store state before each test to ensure isolation
    resetStore();
    // You might need to clear any console mocks or other setup here
  });

  it('should render layout, load initial data, and open definition graph in a tab on click', async () => {
    render(
      <DndProvider backend={HTML5Backend}>
        <App />
      </DndProvider>
    );

    // 1. Verify initial layout and data loading
    // Check if the definition node name from mock data appears in the browser panel area
    const definitionNodeElement = await screen.findByText('Click Me To Open Definition');
    expect(definitionNodeElement).toBeInTheDocument();

    // Check if the tab container exists (assuming TabbedCanvasView renders some identifiable container)
    // This might need adjustment based on TabbedCanvasView's actual structure
    // For example, if it has a role='tablist'
    // const tabList = screen.getByRole('tablist');
    // expect(tabList).toBeInTheDocument();

    // Ensure the definition graph tab is NOT initially open
    expect(screen.queryByRole('tab', { name: /My Definition Graph/i })).not.toBeInTheDocument();


    // 2. Test basic flow: Click definition node -> Open tab
    fireEvent.click(definitionNodeElement);

    // 3. Verify that the new tab appears
    // Wait for the tab with the definition graph's name to appear
    const definitionTab = await screen.findByRole('tab', { name: /My Definition Graph/i });
    expect(definitionTab).toBeInTheDocument();

    // Optional: Verify the tab is now active (this depends on TabbedCanvasView implementation)
    // expect(definitionTab).toHaveAttribute('aria-selected', 'true');

     // Optional: Verify the main workspace graph tab might also be present if it's opened by default
     // const mainTab = await screen.findByRole('tab', { name: /Main Workspace Graph/i });
     // expect(mainTab).toBeInTheDocument();
  });
}); 